import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { conclaveRank, RESEARCH_RULES, type EconomicDoctrineKey, type ResearchProjectKey } from "./rules";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { createNotification } from "./notificationHelpers";
import { awardSeasonPoints } from "./seasonLedger";
import { SEASON_SCORING_RULES } from "./seasonScoringRules";

type Ctx = QueryCtx | MutationCtx;

export async function researchForPlayer(ctx: Ctx, playerId: Id<"players">) {
  return await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
}

export async function researchSpeed(ctx: Ctx, player: { _id: Id<"players">; buildings: { ardentMonastery?: number } }) {
  const conclaves = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId", (q) => q.eq("ownerPlayerId", player._id)).take(10);
  const counts = await plateauCountsForPlayer(ctx, player._id);
  const state = await researchForPlayer(ctx, player._id);
  const religiousLevel = Math.max(0, Math.floor(state?.completedLevels.religiousStudies ?? 0));
  const virtualAncient = Math.floor(state?.completedLevels.sprenStudies ?? 0) >= 3 ? 1 : 0;
  const monastery = Math.max(0, player.buildings.ardentMonastery ?? 0) * RESEARCH_RULES.monasterySpeedPerLevelPercent;
  const conclave = conclaves.reduce((sum, entry) => sum + (religiousLevel >= 3 && entry.missionId ? 0 : conclaveRank(entry.xp) + (religiousLevel >= 2 ? 1 : 0)), 0);
  const ancient = Math.floor((counts.ancient ?? 0) / RESEARCH_RULES.ancientPlateausPerSpeedPercent);
  return { monastery, conclave, ancient, total: Math.min(RESEARCH_RULES.speedCapPercent, monastery + conclave + ancient), ancientCount: counts.ancient ?? 0, virtualAncient, researchAncientCount: (counts.ancient ?? 0) + virtualAncient, gemheartPlateauCount: counts.gemheart ?? 0 };
}

export async function completedResearch(ctx: Ctx, playerId: Id<"players">) {
  const state = await researchForPlayer(ctx, playerId);
  const completed = { ...(state?.completedLevels ?? {}) };
  if (state?.economicDoctrine === "taxItAll") completed.__doctrineTaxItAll = 1;
  if (state?.economicDoctrine === "militaryState") completed.__doctrineMilitaryState = 1;
  if (state?.economicDoctrine === "gemheartBaron") completed.__doctrineGemheartBaron = 1;
  return completed;
}

export async function recordSuccessfulDefensiveSiege(ctx: MutationCtx, playerId: Id<"players">, now = Date.now()) {
  const state = await researchForPlayer(ctx, playerId);
  if (state) {
    await ctx.db.patch(state._id, { successfulDefensiveSieges: (state.successfulDefensiveSieges ?? 0) + 1, updatedAt: now });
  } else {
    await ctx.db.insert("playerResearch", { playerId, completedLevels: {}, doctrineChangeCount: 0, successfulDefensiveSieges: 1, createdAt: now, updatedAt: now });
  }
}

export async function reconcileResearch(ctx: MutationCtx, playerId: Id<"players">, now = Date.now()) {
  const state = await researchForPlayer(ctx, playerId);
  if ((!state?.activeProject && !state?.activeDoctrine) || !state.status) return state;
  const player = await ctx.db.get(playerId);
  if (!player) return state;
  const key = state.activeProject as ResearchProjectKey | undefined;
  const rule = key ? RESEARCH_RULES.projects[key] : undefined;
  if (key && !rule) return state;
  const speed = await researchSpeed(ctx, player);
  const level = state.activeLevel ?? 1;
  const requiredAncient = rule?.ancient[level - 1] ?? 0;
  const requiresGemheartPlateau = Boolean((rule as unknown as { requiresGemheartPlateau?: readonly boolean[] } | undefined)?.requiresGemheartPlateau?.[level - 1]);
  let accumulated = state.accumulatedBaseMs ?? 0;
  if (state.status === "active" && state.lastAdvancedAt) accumulated += (now - state.lastAdvancedAt) * (1 + speed.total / 100);
  const duration = state.activeDoctrine
    ? RESEARCH_RULES.doctrine.baseDurationMs + (state.economicDoctrine ? (state.doctrineChangeCount ?? 0) + 1 : 0) * RESEARCH_RULES.doctrine.switchDurationIncreaseMs
    : rule!.durationsMs[level - 1];
  if (accumulated >= duration) {
    const completingDoctrine = state.activeDoctrine as EconomicDoctrineKey | undefined;
    const completedLevels = key ? { ...state.completedLevels, [key]: level } : state.completedLevels;
    const doctrineChanged = Boolean(completingDoctrine && state.economicDoctrine && state.economicDoctrine !== completingDoctrine);
    const unlockFuture = (key === "sprenStudies" || key === "religiousStudies") && level >= 4;
    await ctx.db.patch(state._id, { completedLevels, economicDoctrine: completingDoctrine ?? state.economicDoctrine, doctrineChangeCount: (state.doctrineChangeCount ?? 0) + (doctrineChanged ? 1 : 0), futurePathUnlocked: state.futurePathUnlocked || unlockFuture || undefined, activeProject: undefined, activeDoctrine: undefined, activeLevel: undefined, status: undefined, accumulatedBaseMs: undefined, lastAdvancedAt: undefined, projectedCompletionAt: undefined, updatedAt: now });
    const completedName = completingDoctrine ? completingDoctrine : rule!.name;
    if (key) await awardSeasonPoints(ctx, {
      playerId, category: "research", sourceType: "research_completion", sourceKey: `research:${state._id}:${key}:${level}`,
      basePoints: SEASON_SCORING_RULES.research.levelPoints[Math.min(level, SEASON_SCORING_RULES.research.levelPoints.length) - 1] ?? 0,
      description: `${rule!.name} level ${level} completed`, entityType: "research", entityId: String(state._id), now,
    });
    const completionBody = completingDoctrine ? "A new Economic Doctrine is now in force." : `${completedName} level ${level} is complete.`;
    await ctx.db.insert("messages", {
      toPlayerId: playerId, kind: "system", subject: "Research Complete", body: completionBody,
      eventType: "research_completed", destinationView: "research", destinationTab: "current",
      entityType: "research", entityId: String(state._id), createdAt: now,
    });
    await createNotification(ctx, {
      playerId, category: "research", eventType: "research_completed", title: "Research Complete",
      body: completionBody, destinationView: "research", destinationTab: "current",
      entityId: String(state._id), dedupeKey: `research:${state._id}:${key ?? completingDoctrine}:${level}:completed`, createdAt: now,
    });
    return await ctx.db.get(state._id);
  }
  const status = speed.researchAncientCount >= requiredAncient && (!requiresGemheartPlateau || speed.gemheartPlateauCount > 0) ? "active" : "paused";
  const remainingBase = duration - accumulated;
  const projectedCompletionAt = status === "active" ? now + remainingBase / (1 + speed.total / 100) : undefined;
  await ctx.db.patch(state._id, { status, accumulatedBaseMs: accumulated, lastAdvancedAt: status === "active" ? now : undefined, projectedCompletionAt, updatedAt: now });
  if (status !== state.status) {
    await createNotification(ctx, {
      playerId, category: "research", eventType: status === "paused" ? "research_paused" : "research_resumed",
      title: status === "paused" ? "Research Paused" : "Research Resumed",
      body: status === "paused" ? `${rule?.name ?? "Doctrine research"} paused because a territory requirement is no longer met.` : `${rule?.name ?? "Doctrine research"} has resumed.`,
      destinationView: "research", destinationTab: "current", entityId: String(state._id),
      dedupeKey: `research:${state._id}:${key}:${state.activeLevel}:${status}:${now}`, createdAt: now,
    });
  }
  if (status === "active" && projectedCompletionAt) await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId });
  return await ctx.db.get(state._id);
}
