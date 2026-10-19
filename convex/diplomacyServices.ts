import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { DIPLOMACY } from "./diplomacyRules";
import { activeHighstorm } from "./highstorms";
import { categoryIntelAmount, intelResource } from "./intelResourceHelpers";
import { seededFraction } from "./worldPressureRules";
import { ESPIONAGE_CATEGORIES } from "./espionageRules";
import { settlePlayerEconomy } from "./economyHelpers";
import { addUnits } from "./rules";

type Ctx = QueryCtx | MutationCtx;
export async function intelBalance(ctx: Ctx, playerId: Id<"players">, petition: Doc<"parshendiPetitions">) {
  if (!petition.targetId || !petition.category) throw Error("Invalid Intel request.");
  const row = await intelResource(ctx, playerId, petition.targetId);
  const report = await ctx.db.query("kingdomIntelligence").withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", q =>
    q.eq("viewerPlayerId", playerId).eq("targetPlayerId", petition.targetId!).eq("category", petition.category!)).unique();
  return { row, amount: categoryIntelAmount(row, petition.category, report) };
}
export async function serviceEligibility(ctx: Ctx, player: Doc<"players">, petition: Doc<"parshendiPetitions">) {
  if (petition.kind === "intel") {
    const target = petition.targetId ? await ctx.db.get(petition.targetId) : null;
    if (!target || target.isAdminObserver || target._id === player._id || (player.authUserId && player.authUserId === target.authUserId)) return "Share intelligence about another account's kingdom; this target is not eligible for you.";
    const balance = await intelBalance(ctx, player._id, petition);
    return balance.amount < DIPLOMACY.intelCost ? `Need ${DIPLOMACY.intelCost} ${petition.category} Intel about ${target.name}; you have ${balance.amount}.` : null;
  }
  if (petition.kind === "escort" || petition.kind === "storm") {
    const away = await ctx.db.query("parshendiAssignments").withIndex("by_playerId_and_status", q => q.eq("playerId", player._id).eq("status", "away")).first();
    if (away) return "Your kingdom already has a Parshendi troop assignment. Wait for its return.";
    if (petition.kind === "storm") {
      const weather = await activeHighstorm(ctx, Date.now());
      if (!weather.active || (petition.stormId && petition.stormId !== weather.storm.stormId)) return "Research dispatch is available only during the requested active Highstorm.";
    }
    return null; // The dispatch mutation also validates the selected troops, never the home army alone.
  }
  return null;
}
export async function consumeIntel(ctx: MutationCtx, player: Doc<"players">, petition: Doc<"parshendiPetitions">) {
  const now = Date.now(), hour = Math.floor(now / 3_600_000);
  const counter = await ctx.db.query("parshendiIntelHours").withIndex("by_hour", q => q.eq("hour", hour)).unique();
  if ((counter?.purchases ?? 0) >= DIPLOMACY.intelPurchasesPerHour) throw Error("Three Intel requests have already been purchased this hour.");
  const { row, amount } = await intelBalance(ctx, player._id, petition);
  if (amount < DIPLOMACY.intelCost) throw Error("Not enough Intel.");
  const field = `${petition.category}Amount` as "militaryAmount" | "economyAmount" | "researchAmount" | "territoryAmount";
  const patch = { [field]: amount - DIPLOMACY.intelCost, updatedAt: now };
  if (row) await ctx.db.patch(row._id, patch);
  else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: player._id, targetPlayerId: petition.targetId!, amount: 0, ...patch });
  if (counter) await ctx.db.patch(counter._id, { purchases: counter.purchases + 1 });
  else await ctx.db.insert("parshendiIntelHours", { hour, purchases: 1 });
}
/** Used by both the hourly refresh and a successful purchase, in the same transaction. */
export async function fillIntelPetition(ctx: MutationCtx, now: number) {
  const hour = Math.floor(now / 3_600_000);
  const count = await ctx.db.query("parshendiIntelHours").withIndex("by_hour", q => q.eq("hour", hour)).unique();
  if ((count?.purchases ?? 0) >= DIPLOMACY.intelPurchasesPerHour) return;
  const existing = await ctx.db.query("parshendiPetitions").withIndex("by_active_and_slot", q => q.eq("active", true).eq("slot", 1)).first();
  if (existing && existing.expiresAt > now) return; // Preserve published pre-upgrade world petitions.
  const candidates = (await ctx.db.query("players").order("desc").take(200)).filter(p => !p.isAdminObserver);
  if (candidates.length < 2) return;
  const seed = `intel:${hour}:${count?.purchases ?? 0}`;
  const target = candidates[Math.floor(seededFraction(seed + ":target") * candidates.length)];
  const category = ESPIONAGE_CATEGORIES[Math.floor(seededFraction(seed + ":category") * ESPIONAGE_CATEGORIES.length)];
  await ctx.db.insert("parshendiPetitions", { slot: 1, active: true, kind: "intel", targetId: target._id, category,
    title: "Share Intelligence", objective: `Share ${DIPLOMACY.intelCost} ${category} Intel about ${target.name}. This spends that category's Intel and may reduce its disclosure tier; other categories stay intact.`,
    sphereCost: 0, favor: 1, hostilityReduction: DIPLOMACY.petitionHostilityReduction, createdAt: now, expiresAt: (hour + 1) * 3_600_000 });
}
export async function insertTroopPetition(ctx: MutationCtx, now: number, stormOnly = false) {
  const { storm, active } = await activeHighstorm(ctx, now);
  if (stormOnly && !active) return false;
  const kind = active ? "storm" as const : "escort" as const;
  await ctx.db.insert("parshendiPetitions", { slot: 0, active: true, kind, title: active ? "Investigate New Forms" : "Escort the Parshendi",
    objective: active ? "Lend troops during this Highstorm to investigate new forms. One dangerous exposure roll on dispatch; survivors return at storm end. No equipment or Conclaves." : "Lend troops for a four-hour escort. All return safely; no cancellation, equipment or Conclaves.",
    sphereCost: 0, favor: 1, hostilityReduction: DIPLOMACY.petitionHostilityReduction,
    createdAt: now, expiresAt: active ? storm.endAt : now + DIPLOMACY.escortDurationMs, ...(active ? { stormId: storm.stormId } : {}) });
  return true;
}

const returnRef = makeFunctionReference<"mutation">("diplomacyServices:returnAssignment");
export async function scheduleReturn(ctx: MutationCtx, id: Id<"parshendiAssignments">, at: number) {
  await ctx.scheduler.runAt(at, returnRef, { assignmentId: id });
}
async function returnOne(ctx: MutationCtx, id: Id<"parshendiAssignments">) {
  const assignment = await ctx.db.get(id);
  if (!assignment || assignment.status !== "away" || assignment.returnAt > Date.now()) return;
  const player = await ctx.db.get(assignment.playerId);
  if (!player) return;
  await settlePlayerEconomy(ctx, player);
  const current = (await ctx.db.get(player._id))!;
  await ctx.db.patch(player._id, { units: addUnits(current.units, assignment.units) });
  await ctx.db.patch(id, { status: "returned", returnedAt: Date.now() });
}
export const returnAssignment = internalMutation({ args: { assignmentId: v.id("parshendiAssignments") }, handler: async (ctx, args) => returnOne(ctx, args.assignmentId) });
export const recoverReturns = internalMutation({ args: {}, handler: async ctx => {
  const due = await ctx.db.query("parshendiAssignments").withIndex("by_status_and_returnAt", q => q.eq("status", "away").lte("returnAt", Date.now())).take(100);
  for (const assignment of due) await returnOne(ctx, assignment._id);
} });
