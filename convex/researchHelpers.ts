import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { conclaveRank, RESEARCH_RULES, type ResearchProjectKey } from "./rules";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { createNotification } from "./notificationHelpers";

type Ctx = QueryCtx | MutationCtx;

export async function researchForPlayer(ctx: Ctx, playerId: Id<"players">) {
  return await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
}

export async function researchSpeed(ctx: Ctx, player: { _id: Id<"players">; buildings: { ardentMonastery?: number } }) {
  const conclaves = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId", (q) => q.eq("ownerPlayerId", player._id)).take(10);
  const counts = await plateauCountsForPlayer(ctx, player._id);
  const monastery = Math.max(0, player.buildings.ardentMonastery ?? 0) * RESEARCH_RULES.monasterySpeedPerLevelPercent;
  const conclave = conclaves.reduce((sum, entry) => sum + conclaveRank(entry.xp), 0);
  const ancient = Math.floor((counts.ancient ?? 0) / RESEARCH_RULES.ancientPlateausPerSpeedPercent);
  return { monastery, conclave, ancient, total: Math.min(RESEARCH_RULES.speedCapPercent, monastery + conclave + ancient), ancientCount: counts.ancient ?? 0 };
}

export async function completedResearch(ctx: Ctx, playerId: Id<"players">) {
  return (await researchForPlayer(ctx, playerId))?.completedLevels ?? {};
}

export async function reconcileResearch(ctx: MutationCtx, playerId: Id<"players">, now = Date.now()) {
  const state = await researchForPlayer(ctx, playerId);
  if (!state?.activeProject || !state.activeLevel || !state.status) return state;
  const player = await ctx.db.get(playerId);
  if (!player) return state;
  const key = state.activeProject as ResearchProjectKey;
  const rule = RESEARCH_RULES.projects[key];
  if (!rule) return state;
  const speed = await researchSpeed(ctx, player);
  const requiredAncient = rule.ancient[state.activeLevel - 1];
  let accumulated = state.accumulatedBaseMs ?? 0;
  if (state.status === "active" && state.lastAdvancedAt) accumulated += (now - state.lastAdvancedAt) * (1 + speed.total / 100);
  const duration = RESEARCH_RULES.durationsMs[state.activeLevel - 1];
  if (accumulated >= duration) {
    await ctx.db.patch(state._id, { completedLevels: { ...state.completedLevels, [key]: state.activeLevel }, activeProject: undefined, activeLevel: undefined, status: undefined, accumulatedBaseMs: undefined, lastAdvancedAt: undefined, projectedCompletionAt: undefined, updatedAt: now });
    await createNotification(ctx, {
      playerId, category: "research", eventType: "research_completed", title: "Research Complete",
      body: `${rule.name} level ${state.activeLevel} is complete.`, destinationView: "research",
      entityId: String(state._id), dedupeKey: `research:${state._id}:${key}:${state.activeLevel}:completed`, createdAt: now,
    });
    return await ctx.db.get(state._id);
  }
  const status = speed.ancientCount >= requiredAncient ? "active" : "paused";
  const remainingBase = duration - accumulated;
  const projectedCompletionAt = status === "active" ? now + remainingBase / (1 + speed.total / 100) : undefined;
  await ctx.db.patch(state._id, { status, accumulatedBaseMs: accumulated, lastAdvancedAt: status === "active" ? now : undefined, projectedCompletionAt, updatedAt: now });
  if (status !== state.status) {
    await createNotification(ctx, {
      playerId, category: "research", eventType: status === "paused" ? "research_paused" : "research_resumed",
      title: status === "paused" ? "Research Paused" : "Research Resumed",
      body: status === "paused" ? `${rule.name} paused because its Ancient Plateau requirement is no longer met.` : `${rule.name} has resumed.`,
      destinationView: "research", entityId: String(state._id),
      dedupeKey: `research:${state._id}:${key}:${state.activeLevel}:${status}:${now}`, createdAt: now,
    });
  }
  if (status === "active" && projectedCompletionAt) await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId });
  return await ctx.db.get(state._id);
}
