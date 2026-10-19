import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Event } from "../conflict-board/types";
import { totalUnits } from "./rules";
import { DIPLOMACY } from "./diplomacyRules";

export const relations = (ctx: QueryCtx | MutationCtx, playerId: Id<"players">) =>
  ctx.db.query("parshendiRelations").withIndex("by_playerId", q => q.eq("playerId", playerId)).unique();
export async function ensureRelations(ctx: MutationCtx, playerId: Id<"players">) {
  const existing = await relations(ctx, playerId);
  if (existing) return existing;
  const id = await ctx.db.insert("parshendiRelations", { playerId, favor: 0, tributeCount: 0, tributeWindowAt: Date.now() });
  return (await ctx.db.get(id))!;
}
export function donationWindow(rel: Doc<"parshendiRelations"> | null, now: number) {
  if (!rel || now - rel.tributeWindowAt >= DIPLOMACY.tributeWindowMs) return { spheres: 0, gemhearts: 0 };
  // Already-rewarded V1 contracts affect diminishing returns, never new Favor credit.
  return { spheres: rel.windowSpheres ?? rel.tributeCount * DIPLOMACY.tributeSpheres,
    gemhearts: rel.windowGemhearts ?? rel.tributeCount * DIPLOMACY.tributeGemhearts };
}
/** Only real battle results enter this ledger. No client-submitted result or grant API. */
export async function recordDiplomacyVictories(ctx: MutationCtx, conflictId: Id<"boardConflicts">, events: Event[], at: number) {
  for (const e of events) {
    if (e.type !== "battle" || !e.winner || e.annihilated) continue;
    const winnerId = e.winner as Id<"players">;
    const winner = await ctx.db.get(winnerId);
    if (!winner || winner.isAdminObserver) continue;
    const targets: Id<"players">[] = [];
    const participants = await ctx.db.query("boardParticipants").withIndex("by_conflictId_and_playerId", q => q.eq("conflictId", conflictId)).take(200);
    for (const enemy of e.forces) {
      if (enemy.kingdom === e.winner || enemy.power < DIPLOMACY.minimumEnemyPower || totalUnits(enemy.casualties) < DIPLOMACY.minimumEnemyCasualties) continue;
      const targetId = enemy.kingdom as Id<"players">;
      const target = await ctx.db.get(targetId);
      if (!target || target.isAdminObserver || (winner.authUserId && winner.authUserId === target.authUserId)) continue;
      const attacker = participants.find(p => p.playerId === winnerId && p.chainPosition !== undefined) ?? participants.find(p => p.playerId === targetId && p.chainPosition !== undefined);
      // Repeated attacks beyond the season ledger's first three engagements do not earn Favor.
      if (!attacker?.chainPosition || attacker.chainPosition > 3) continue;
      targets.push(targetId);
    }
    // One battle receipt, consumable once even when several aggressors lose.
    const key = `${conflictId}:${at}:${e.step}:${e.position}`;
    if (targets.length && !await ctx.db.query("parshendiVictories").withIndex("by_key", q => q.eq("key", key)).unique())
      await ctx.db.insert("parshendiVictories", { key, winnerId, targetIds: targets, at });
  }
}
