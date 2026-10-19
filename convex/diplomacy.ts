import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import { DIPLOMACY, requireFavorRoom, donationReduction, tributeProgress } from "./diplomacyRules";
import { ensureRelations, relations, donationWindow } from "./diplomacyHelpers";
import { materializeHostilityDecay, reclamationDefense } from "./worldPressureRules";
import { reduceHostility, reconcileRetaliationSchedule } from "./worldPressure";
import { activeSeason, observePlateauNeutralized } from "./seasonLedger";
import { reconcileResearch } from "./researchHelpers";
import { settlePlayerEconomy } from "./economyHelpers";

type ReadCtx = QueryCtx | MutationCtx;
async function readHostility(ctx: ReadCtx, playerId: Id<"players">, now: number) {
  const pressure = await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", q => q.eq("playerId", playerId)).unique();
  return materializeHostilityDecay({ hostility: pressure?.hostility ?? 0, lastPlayerAggressionAt: pressure?.lastPlayerAggressionAt, decayIntervalsApplied: pressure?.decayIntervalsApplied ?? 0, now }).hostility;
}
const availablePlateau = (p: Doc<"plateaus"> | null) => p && p.status === "owned" && p.origin !== "home" &&
  (p.origin === "neutral" || p.neutralDefenseInitial > 0) && !p.activeSiegeId && !p.activeConflictBoardId;
async function eligibility(ctx: ReadCtx, p: Doc<"players">, petition: Doc<"parshendiPetitions">) {
  if (petition.kind === "supplies") return { missing: "Resource payments are available only through standing tribute. Refresh Diplomacy." };
  if (!petition.active || petition.expiresAt <= Date.now()) return { missing: "This petition has expired or was fulfilled." };
  if (petition.kind === "plateau") {
    const plateau = petition.plateauId ? await ctx.db.get(petition.plateauId) : null;
    return { missing: availablePlateau(plateau) && plateau!.ownerPlayerId === p._id ? null : "You must currently own this plateau, free of active conflict or siege." };
  }
  const victories = await ctx.db.query("parshendiVictories").withIndex("by_winnerId_and_at", q => q.eq("winnerId", p._id).gte("at", petition.createdAt)).take(200);
  const victory = victories.find(row => row.targetIds.includes(petition.targetId!) && row.at < petition.expiresAt && !row.petitionId);
  return { missing: victory ? null : "Win a PvP battle against this kingdom during this petition: enemy Power ≥100 and ≥10 enemy troop losses. Only the first three attacks in a rivalry chain qualify (resets after 24 peaceful hours).", victory };
}
export const get = query({
  args: {},
  handler: async ctx => {
    const p = await requireCurrentPlayer(ctx);
    const rel = await relations(ctx, p._id);
    const now = Date.now();
    const hostility = await readHostility(ctx, p._id, now);
    const petitions = await ctx.db.query("parshendiPetitions").withIndex("by_active_and_slot", q => q.eq("active", true)).take(3);
    const favor = rel?.favor ?? 0;
    const window = donationWindow(rel, now);
    const reserve = await ctx.db.query("parshendiReserve").withIndex("by_key", q => q.eq("key", "shared")).unique();
    return {
      favor, hostility, cap: DIPLOMACY.favorCap, tiers: DIPLOMACY.tiers,
      activeConflictId: rel?.activeConflictId ?? null, reserveGemhearts: reserve?.gemhearts ?? 0,
      tribute: {
        spheres: DIPLOMACY.tributeSpheres, gemhearts: DIPLOMACY.tributeGemhearts,
        sphereCredit: rel?.sphereCredit ?? 0, gemheartCredit: rel?.gemheartCredit ?? 0,
        window, windowResetsAt: window.spheres || window.gemhearts ? rel!.tributeWindowAt + DIPLOMACY.tributeWindowMs : null,
        hostilityReduction: donationReduction(window, "spheres", DIPLOMACY.tributeSpheres) + donationReduction({ ...window, spheres: window.spheres + DIPLOMACY.tributeSpheres }, "gemhearts", DIPLOMACY.tributeGemhearts),
      },
      petitions: await Promise.all(petitions.filter(petition => petition.kind !== "supplies").map(async petition => {
        const result = await eligibility(ctx, p, petition);
        const missing = p.isAdminObserver ? "Observers cannot fulfill petitions." : favor + petition.favor > DIPLOMACY.favorCap ? "Spend Favor first: this reward would exceed the cap of 5. Nothing will be consumed." : result.missing;
        return { id: petition._id, kind: petition.kind, title: petition.title, objective: petition.objective, sphereCost: petition.sphereCost, favor: petition.favor, hostilityReduction: petition.hostilityReduction, expiresAt: petition.expiresAt, missing };
      })),
    };
  },
});
export const tribute = mutation({
  args: { requestId: v.string(), resource: v.optional(v.union(v.literal("spheres"), v.literal("gemhearts"))), amount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const current = await requireCompetitivePlayer(ctx);
    if (!args.requestId || args.requestId.length > 120) throw Error("A tribute request identity is required.");
    const fingerprint = JSON.stringify([args.resource ?? null, args.amount ?? null]);
    const old = await ctx.db.query("parshendiTributes").withIndex("by_playerId_and_requestId", q => q.eq("playerId", current._id).eq("requestId", args.requestId)).unique();
    if (old) {
      if (old.fingerprint !== undefined ? old.fingerprint !== fingerprint : args.resource !== undefined || args.amount !== undefined) throw Error("This donation identity was already used for a different payment.");
      return old.result ?? null;
    }
    if (!args.resource || args.amount === undefined) throw Error("Standing tribute has changed. Refresh Diplomacy to donate Spheres or Gemhearts separately.");
    const resource = args.resource, amount = args.amount;
    const maximum = resource === "spheres" ? DIPLOMACY.maximumSphereDonation : DIPLOMACY.maximumGemheartDonation;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maximum) throw Error(`Choose a whole donation from 1 to ${maximum.toLocaleString("en-US")}.`);
    const rel = await ensureRelations(ctx, current._id);
    requireFavorRoom(rel.favor);
    const credits = tributeProgress((rel.sphereCredit ?? 0) + (resource === "spheres" ? amount : 0), (rel.gemheartCredit ?? 0) + (resource === "gemhearts" ? amount : 0), rel.favor);
    await settlePlayerEconomy(ctx, current);
    const p = (await ctx.db.get(current._id))!;
    if (p[resource] < amount) throw Error(`Not enough ${resource === "spheres" ? "Spheres" : "Gemhearts"}.`);
    const now = Date.now(), window = donationWindow(rel, now);
    const reduction = donationReduction(window, resource, amount);
    const startsWindow = !window.spheres && !window.gemhearts;
    const nextWindow = { ...window, [resource]: window[resource] + amount };
    if (!Number.isSafeInteger(nextWindow[resource])) throw Error("Donation history exceeds the current accounting limit.");
    await ctx.db.patch(p._id, { [resource]: p[resource] - amount });
    await ctx.db.patch(rel._id, {
      favor: rel.favor + credits.favorGranted, sphereCredit: credits.sphereCredit, gemheartCredit: credits.gemheartCredit,
      tributeWindowAt: startsWindow ? now : rel.tributeWindowAt, tributeCount: 0,
      windowSpheres: nextWindow.spheres, windowGemhearts: nextWindow.gemhearts,
    });
    if (resource === "gemhearts") {
      const reserve = await ctx.db.query("parshendiReserve").withIndex("by_key", q => q.eq("key", "shared")).unique();
      if (reserve) await ctx.db.patch(reserve._id, { gemhearts: reserve.gemhearts + amount });
      else await ctx.db.insert("parshendiReserve", { key: "shared", gemhearts: amount });
    }
    const beforeHostility = await readHostility(ctx, p._id, now);
    const afterHostility = await reduceHostility(ctx, p._id, reduction, now);
    const result = { ...credits, hostilityReduction: beforeHostility - afterHostility };
    await ctx.db.insert("parshendiTributes", { playerId: p._id, requestId: args.requestId, at: now, fingerprint, result });
    return result;
  },
});
export const fulfill = mutation({
  args: { petitionId: v.id("parshendiPetitions") },
  handler: async (ctx, args) => {
    const current = await requireCompetitivePlayer(ctx);
    const petition = await ctx.db.get(args.petitionId);
    if (!petition) throw Error("This petition is no longer available.");
    const rel = await ensureRelations(ctx, current._id);
    requireFavorRoom(rel.favor, petition.favor);
    await settlePlayerEconomy(ctx, current);
    const p = (await ctx.db.get(current._id))!;
    const result = await eligibility(ctx, p, petition);
    if (result.missing) throw Error(result.missing);
    const now = Date.now();
    if (petition.kind === "plateau") {
      const plateau = (await ctx.db.get(petition.plateauId!))!;
      const season = await activeSeason(ctx);
      const count = (season && plateau.reclamationSeasonId === season._id ? plateau.parshendiReclamationCount ?? 0 : 0) + 1;
      const base = plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial;
      const defense = reclamationDefense(base, count);
      await ctx.db.patch(plateau._id, { status: "neutral", ownerPlayerId: undefined, heldSince: undefined, lastGemheartAt: undefined, nextGemheartAt: undefined, baseNeutralDefense: base, parshendiReclamationCount: count, ...(season ? { reclamationSeasonId: season._id } : {}), neutralDefenseInitial: defense, neutralDefenseRemaining: defense, updatedAt: now });
      await observePlateauNeutralized(ctx, { plateauId: plateau._id, previousOwnerId: p._id, now });
      await reconcileResearch(ctx, p._id, now);
      await reconcileRetaliationSchedule(ctx, p._id, now);
    } else {
      await ctx.db.patch(result.victory!._id, { petitionId: petition._id });
    }
    await ctx.db.patch(rel._id, { favor: rel.favor + petition.favor });
    await reduceHostility(ctx, p._id, petition.hostilityReduction, now);
    await ctx.db.patch(petition._id, { active: false, fulfilledBy: p._id, fulfilledAt: now });
  },
});

/** Hourly fill of three durable slots; no personal acceptance or progress state. */
export const refreshPetitions = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    const active = await ctx.db.query("parshendiPetitions").withIndex("by_active_and_slot", q => q.eq("active", true)).take(20);
    for (const p of active) if (p.expiresAt <= now || p.kind === "supplies") await ctx.db.patch(p._id, { active: false });
    const recent = await ctx.db.query("parshendiPetitions").withIndex("by_expiresAt", q => q.gte("expiresAt", now - DIPLOMACY.petitionDurationMs)).take(100);
    const plateaus = await ctx.db.query("plateaus").withIndex("by_status_and_heldSince", q => q.eq("status", "owned").gte("heldSince", now - DIPLOMACY.petitionDurationMs)).order("desc").take(200);
    const pressures = await ctx.db.query("kingdomWorldPressure").withIndex("by_hostility", q => q.gte("hostility", DIPLOMACY.aggressorHostility)).order("desc").take(200);
    for (let slot = 0; slot < 3; slot++) {
      if (active.some(p => p.slot === slot && p.expiresAt > now && p.kind !== "supplies")) continue;
      const common = { slot, active: true, favor: 1, hostilityReduction: DIPLOMACY.petitionHostilityReduction, createdAt: now, expiresAt: now + DIPLOMACY.petitionDurationMs };
      const plateau = plateaus.find(p => availablePlateau(p) && p.heldSince !== undefined && p.heldSince >= now - DIPLOMACY.petitionDurationMs && !recent.some(r => r.plateauId === p._id));
      const pressure = pressures.find(p => materializeHostilityDecay({ ...p, now }).hostility >= DIPLOMACY.aggressorHostility && !recent.some(r => r.targetId === p.playerId));
      let id: Id<"parshendiPetitions">;
      if (plateau && (slot % 2 === 0 || !pressure)) {
        id = await ctx.db.insert("parshendiPetitions", { ...common, kind: "plateau", title: `Return ${plateau.name}`, objective: `Donate ${plateau.name} to the Parshendi. The current owner must relinquish it immediately, free of active conflict.`, plateauId: plateau._id, sphereCost: 0 });
      } else if (pressure) {
        const target = await ctx.db.get(pressure.playerId);
        id = await ctx.db.insert("parshendiPetitions", { ...common, kind: "aggressor", title: "Challenge the Aggressor", objective: `Win a qualifying PvP battle against ${target?.name ?? "the aggressor"} during this petition, then claim the reward here.`, targetId: pressure.playerId, sphereCost: 0 });
      } else continue;
      recent.push((await ctx.db.get(id))!);
    }
  },
});
