import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin } from "./admin";
import { requireCurrentPlayer } from "./ownership";
import {
  chainMultiplier,
  publicSeasonScoringRules,
  SEASON_SCORING_RULES,
  type SeasonCategory,
} from "./seasonScoringRules";
import { resetWorldPressureForSeason } from "./worldPressure";

const EMPTY_TOTALS: Record<SeasonCategory, number> = {
  military: 0,
  research: 0,
  economy: 0,
  territory: 0,
};

export async function activeSeason(ctx: { db: MutationCtx["db"] }) {
  return await ctx.db.query("seasons").withIndex("by_status", (q) => q.eq("status", "active")).unique();
}

export async function createFreshSeason(ctx: MutationCtx, number: number, now = Date.now()) {
  return await ctx.db.insert("seasons", {
    number,
    name: `Season ${number}`,
    status: "active",
    startsAt: now,
  });
}

export async function ensureActiveSeason(ctx: MutationCtx, now = Date.now()) {
  const existing = await activeSeason(ctx);
  if (existing) return existing;
  const seasonId = await createFreshSeason(ctx, 1, now);
  return (await ctx.db.get(seasonId))!;
}

export async function awardSeasonPoints(ctx: MutationCtx, args: {
  seasonId?: Id<"seasons">;
  playerId: Id<"players">;
  category: SeasonCategory;
  sourceType: string;
  sourceKey: string;
  basePoints: number;
  multiplier?: number;
  description: string;
  opponentPlayerId?: Id<"players">;
  entityType?: string;
  entityId?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const season = args.seasonId ? await ctx.db.get(args.seasonId) : await ensureActiveSeason(ctx, now);
  if (!season || season.status !== "active") return { awarded: false, reason: "inactive_season" as const };
  const existing = await ctx.db.query("seasonScoreEvents")
    .withIndex("by_seasonId_and_playerId_and_sourceKey", (q) => q.eq("seasonId", season._id).eq("playerId", args.playerId).eq("sourceKey", args.sourceKey))
    .unique();
  if (existing) return { awarded: false, reason: "duplicate" as const, eventId: existing._id };
  const points = Math.max(0, Math.round(args.basePoints * (args.multiplier ?? 1)));
  if (points < 1) return { awarded: false, reason: "zero" as const };
  const eventId = await ctx.db.insert("seasonScoreEvents", {
    seasonId: season._id,
    playerId: args.playerId,
    category: args.category,
    sourceType: args.sourceType,
    sourceKey: args.sourceKey,
    basePoints: args.basePoints,
    points,
    ...(args.multiplier !== undefined ? { multiplier: args.multiplier } : {}),
    description: args.description,
    ...(args.opponentPlayerId ? { opponentPlayerId: args.opponentPlayerId } : {}),
    ...(args.entityType ? { entityType: args.entityType } : {}),
    ...(args.entityId ? { entityId: args.entityId } : {}),
    createdAt: now,
  });
  const score = await ctx.db.query("seasonScores")
    .withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", season._id).eq("playerId", args.playerId))
    .unique();
  const totals = { ...EMPTY_TOTALS, ...(score?.categoryTotals ?? {}) };
  totals[args.category] = (totals[args.category] ?? 0) + points;
  if (score) await ctx.db.patch(score._id, { total: score.total + points, categoryTotals: totals, updatedAt: now });
  else await ctx.db.insert("seasonScores", { seasonId: season._id, playerId: args.playerId, total: points, categoryTotals: totals, updatedAt: now });
  return { awarded: true, points, eventId, seasonId: season._id };
}

export async function unlockAchievement(ctx: MutationCtx, args: {
  seasonId: Id<"seasons">;
  playerId: Id<"players">;
  key: keyof typeof SEASON_SCORING_RULES.achievements;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const existing = await ctx.db.query("seasonAchievements")
    .withIndex("by_seasonId_and_playerId_and_key", (q) => q.eq("seasonId", args.seasonId).eq("playerId", args.playerId).eq("key", args.key))
    .unique();
  if (existing) return false;
  const rule = SEASON_SCORING_RULES.achievements[args.key];
  const award = await awardSeasonPoints(ctx, {
    seasonId: args.seasonId, playerId: args.playerId, category: rule.category,
    sourceType: "achievement", sourceKey: `achievement:${args.key}`,
    basePoints: rule.points, description: `${rule.name} earned`, now,
  });
  if (!award.awarded) return false;
  await ctx.db.insert("seasonAchievements", { seasonId: args.seasonId, playerId: args.playerId, key: args.key, category: rule.category, points: rule.points, earnedAt: now });
  await ctx.db.insert("messages", {
    toPlayerId: args.playerId, kind: "system", subject: `Season distinction: ${rule.name}`,
    body: `${rule.flavor} ${rule.requirement} (+${rule.points} ${rule.category} score.)`,
    eventType: "season_achievement", destinationView: "intelligence", destinationTab: "ledger",
    entityType: "season_achievement", entityId: args.key, createdAt: now,
  });
  return true;
}

export async function recordOpponentAttack(ctx: MutationCtx, attackerId: Id<"players">, opponentId: Id<"players">, now = Date.now()) {
  const season = await ensureActiveSeason(ctx, now);
  const existing = await ctx.db.query("seasonOpponentChains")
    .withIndex("by_seasonId_and_attackerId_and_opponentId", (q) => q.eq("seasonId", season._id).eq("attackerId", attackerId).eq("opponentId", opponentId))
    .unique();
  const reset = !existing || now - existing.lastAttackAt >= SEASON_SCORING_RULES.opponentChains.resetAfterMs;
  const chainCount = reset ? 1 : existing.chainCount + 1;
  if (existing) await ctx.db.patch(existing._id, { chainCount, lastAttackAt: now });
  else await ctx.db.insert("seasonOpponentChains", { seasonId: season._id, attackerId, opponentId, chainCount, lastAttackAt: now });
  return { seasonId: season._id, chainPosition: chainCount, multiplier: chainMultiplier(chainCount) };
}

async function maybeUnlockVariedOpposition(ctx: MutationCtx, seasonId: Id<"seasons">, playerId: Id<"players">, now: number) {
  const events = await ctx.db.query("seasonScoreEvents")
    .withIndex("by_seasonId_and_playerId_and_createdAt", (q) => q.eq("seasonId", seasonId).eq("playerId", playerId))
    .order("desc").take(200);
  const rivals = new Set(events.filter((event) => event.sourceType === "siege_victory" || event.sourceType === "siege_defense").map((event) => event.opponentPlayerId).filter(Boolean));
  if (rivals.size >= SEASON_SCORING_RULES.variedOppositionCount) await unlockAchievement(ctx, { seasonId, playerId, key: "variedOpposition", now });
}

export async function recordSiegeVictoryScore(ctx: MutationCtx, args: {
  siegeId: Id<"sieges">; seasonId: Id<"seasons">; attackerId: Id<"players">; defenderId: Id<"players">;
  attackerName: string; defenderName: string; plateauName: string; chainPosition: number; now: number;
}) {
  const multiplier = chainMultiplier(args.chainPosition);
  const result = await awardSeasonPoints(ctx, {
    seasonId: args.seasonId, playerId: args.attackerId, category: "military", sourceType: "siege_victory",
    sourceKey: `siege:${args.siegeId}:attacker`, basePoints: SEASON_SCORING_RULES.military.pvpSiegeVictory,
    multiplier, description: `Captured ${args.plateauName} from ${args.defenderName}${multiplier < 1 ? ` (${Math.round(multiplier * 100)}% repeated-opponent value)` : ""}`,
    opponentPlayerId: args.defenderId, entityType: "siege", entityId: String(args.siegeId), now: args.now,
  });
  if (result.awarded) {
    await unlockAchievement(ctx, { seasonId: args.seasonId, playerId: args.attackerId, key: "firstBlood", now: args.now });
    await maybeUnlockVariedOpposition(ctx, args.seasonId, args.attackerId, args.now);
  }
}

export async function recordSiegeDefenseScore(ctx: MutationCtx, args: {
  siegeId: Id<"sieges">; seasonId: Id<"seasons">; defenderId: Id<"players">; attackerId: Id<"players">;
  attackerName: string; plateauName: string; now: number;
}) {
  const result = await awardSeasonPoints(ctx, {
    seasonId: args.seasonId, playerId: args.defenderId, category: "military", sourceType: "siege_defense",
    sourceKey: `siege:${args.siegeId}:defender`, basePoints: SEASON_SCORING_RULES.military.pvpSiegeDefense,
    description: `Held ${args.plateauName} against ${args.attackerName}`, opponentPlayerId: args.attackerId,
    entityType: "siege", entityId: String(args.siegeId), now: args.now,
  });
  if (result.awarded) {
    await unlockAchievement(ctx, { seasonId: args.seasonId, playerId: args.defenderId, key: "holdTheLine", now: args.now });
    await maybeUnlockVariedOpposition(ctx, args.seasonId, args.defenderId, args.now);
  }
}

async function scheduleHold(ctx: MutationCtx, hold: Doc<"seasonPlateauHolds">, plateauType: string, now: number) {
  const due = [hold.heldSince + (hold.territoryIntervalsAwarded + 1) * SEASON_SCORING_RULES.territory.holdIntervalMs];
  if (plateauType === "ancient" || plateauType === "ancient_ruins") due.push(hold.heldSince + (hold.researchIntervalsAwarded + 1) * SEASON_SCORING_RULES.research.ancientHoldIntervalMs);
  if (!hold.custodianAwarded && (plateauType === "ancient" || plateauType === "ancient_ruins")) due.push(hold.heldSince + SEASON_SCORING_RULES.ancientCustodianMs);
  await ctx.scheduler.runAt(Math.max(now + 1000, Math.min(...due)), internal.seasonLedger.evaluatePlateauHold, {
    seasonId: hold.seasonId, plateauId: hold.plateauId, playerId: hold.playerId, heldSince: hold.heldSince,
  });
}

async function updateTerritoryCount(ctx: MutationCtx, seasonId: Id<"seasons">, playerId: Id<"players">, now: number, awardCrossings: boolean) {
  const count = (await ctx.db.query("plateaus").withIndex("by_owner", (q) => q.eq("ownerPlayerId", playerId)).take(100)).length;
  const state = await ctx.db.query("seasonTerritoryStates").withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", seasonId).eq("playerId", playerId)).unique();
  const previous = state?.lastCount ?? (awardCrossings ? Math.max(0, count - 1) : count);
  if (awardCrossings) for (const milestone of SEASON_SCORING_RULES.territory.milestones) {
    if (previous < milestone.count && count >= milestone.count) await awardSeasonPoints(ctx, {
      seasonId, playerId, category: "territory", sourceType: "territory_milestone", sourceKey: `territory:milestone:${milestone.count}`,
      basePoints: milestone.points, description: `Controlled ${milestone.count} plateaus simultaneously`, now,
    });
  }
  if (state) await ctx.db.patch(state._id, { lastCount: count, updatedAt: now });
  else await ctx.db.insert("seasonTerritoryStates", { seasonId, playerId, lastCount: count, updatedAt: now });
}

export async function observePlateauOwnership(ctx: MutationCtx, args: {
  plateauId: Id<"plateaus">; previousOwnerId?: Id<"players">; newOwnerId: Id<"players">; heldSince: number; now?: number;
}) {
  const now = args.now ?? Date.now();
  const season = await ensureActiveSeason(ctx, now);
  if (args.previousOwnerId && args.previousOwnerId !== args.newOwnerId) {
    const priorClaim = await ctx.db.query("seasonPlateauClaims").withIndex("by_seasonId_and_plateauId_and_playerId", (q) => q.eq("seasonId", season._id).eq("plateauId", args.plateauId).eq("playerId", args.previousOwnerId!)).unique();
    if (priorClaim) await ctx.db.patch(priorClaim._id, { lostToPlayerAt: now, updatedAt: now });
    else await ctx.db.insert("seasonPlateauClaims", { seasonId: season._id, plateauId: args.plateauId, playerId: args.previousOwnerId, lostToPlayerAt: now, updatedAt: now });
    await updateTerritoryCount(ctx, season._id, args.previousOwnerId, now, false);
  }
  const claim = await ctx.db.query("seasonPlateauClaims").withIndex("by_seasonId_and_plateauId_and_playerId", (q) => q.eq("seasonId", season._id).eq("plateauId", args.plateauId).eq("playerId", args.newOwnerId)).unique();
  const reclaimed = Boolean(claim?.lostToPlayerAt);
  if (claim) await ctx.db.patch(claim._id, { lostToPlayerAt: undefined, updatedAt: now });
  else await ctx.db.insert("seasonPlateauClaims", { seasonId: season._id, plateauId: args.plateauId, playerId: args.newOwnerId, updatedAt: now });
  const oldHold = await ctx.db.query("seasonPlateauHolds").withIndex("by_seasonId_and_plateauId", (q) => q.eq("seasonId", season._id).eq("plateauId", args.plateauId)).unique();
  if (oldHold) await ctx.db.delete(oldHold._id);
  const holdId = await ctx.db.insert("seasonPlateauHolds", { seasonId: season._id, plateauId: args.plateauId, playerId: args.newOwnerId, heldSince: Math.max(args.heldSince, season.startsAt), territoryIntervalsAwarded: 0, researchIntervalsAwarded: 0, custodianAwarded: false, updatedAt: now });
  const hold = (await ctx.db.get(holdId))!;
  const plateau = await ctx.db.get(args.plateauId);
  if (plateau) {
    await scheduleHold(ctx, hold, plateau.type, now);
    if (plateau.type === "ancient" || plateau.type === "ancient_ruins") {
      const newOwner = await ctx.db.get(args.newOwnerId);
      if (newOwner && !newOwner.researchTeasedAt) await ctx.db.patch(newOwner._id, { researchTeasedAt: now });
    }
  }
  await updateTerritoryCount(ctx, season._id, args.newOwnerId, now, true);
  if (reclaimed) await unlockAchievement(ctx, { seasonId: season._id, playerId: args.newOwnerId, key: "reclamation", now });
}

export async function observePlateauNeutralized(ctx: MutationCtx, args: {
  plateauId: Id<"plateaus">;
  previousOwnerId: Id<"players">;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const season = await activeSeason(ctx);
  if (!season) return;
  const hold = await ctx.db
    .query("seasonPlateauHolds")
    .withIndex("by_seasonId_and_plateauId", (q) =>
      q.eq("seasonId", season._id).eq("plateauId", args.plateauId),
    )
    .unique();
  if (hold) await ctx.db.delete(hold._id);
  await updateTerritoryCount(ctx, season._id, args.previousOwnerId, now, false);
}

export const evaluatePlateauHold = internalMutation({
  args: { seasonId: v.id("seasons"), plateauId: v.id("plateaus"), playerId: v.id("players"), heldSince: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const season = await ctx.db.get(args.seasonId);
    const plateau = await ctx.db.get(args.plateauId);
    const hold = await ctx.db.query("seasonPlateauHolds").withIndex("by_seasonId_and_plateauId", (q) => q.eq("seasonId", args.seasonId).eq("plateauId", args.plateauId)).unique();
    if (!season || season.status !== "active" || !plateau || plateau.ownerPlayerId !== args.playerId || !hold || hold.playerId !== args.playerId || hold.heldSince !== args.heldSince) return { awarded: false };
    const elapsed = now - hold.heldSince;
    const territoryCompleted = Math.floor(elapsed / SEASON_SCORING_RULES.territory.holdIntervalMs);
    const valuableBonus = (SEASON_SCORING_RULES.territory.valuableTypeBonus as Record<string, number>)[plateau.type] ?? 0;
    for (let interval = hold.territoryIntervalsAwarded + 1; interval <= territoryCompleted; interval += 1) await awardSeasonPoints(ctx, {
      seasonId: season._id, playerId: args.playerId, category: "territory", sourceType: "plateau_hold", sourceKey: `plateau:${plateau._id}:epoch:${hold.heldSince}:territory:${interval}`,
      basePoints: SEASON_SCORING_RULES.territory.holdPoints + valuableBonus, description: `${plateau.name} held for ${interval * 12} continuous hours`, entityType: "plateau", entityId: String(plateau._id), now,
    });
    const ancient = plateau.type === "ancient" || plateau.type === "ancient_ruins";
    const researchCompleted = ancient ? Math.floor(elapsed / SEASON_SCORING_RULES.research.ancientHoldIntervalMs) : 0;
    for (let interval = hold.researchIntervalsAwarded + 1; interval <= researchCompleted; interval += 1) await awardSeasonPoints(ctx, {
      seasonId: season._id, playerId: args.playerId, category: "research", sourceType: "ancient_hold", sourceKey: `plateau:${plateau._id}:epoch:${hold.heldSince}:research:${interval}`,
      basePoints: SEASON_SCORING_RULES.research.ancientHoldPoints, description: `${plateau.name} scholarship milestone: ${interval * 12} hours`, entityType: "plateau", entityId: String(plateau._id), now,
    });
    let custodianAwarded = hold.custodianAwarded;
    if (ancient && !custodianAwarded && elapsed >= SEASON_SCORING_RULES.ancientCustodianMs) {
      await unlockAchievement(ctx, { seasonId: season._id, playerId: args.playerId, key: "ancientCustodian", now });
      // This flag records that this hold's 24-hour checkpoint was evaluated.
      // The achievement itself is kingdom-wide, so a duplicate result must not
      // leave this plateau rescheduling an already-past deadline every second.
      custodianAwarded = true;
    }
    await ctx.db.patch(hold._id, { territoryIntervalsAwarded: territoryCompleted, researchIntervalsAwarded: researchCompleted, custodianAwarded, updatedAt: now });
    const updated = (await ctx.db.get(hold._id))!;
    await scheduleHold(ctx, updated, plateau.type, now);
    return { awarded: true };
  },
});

export async function initializeSeasonBaseline(ctx: MutationCtx, season: Doc<"seasons">, now: number) {
  const players = await ctx.db.query("players").take(200);
  for (const player of players) await updateTerritoryCount(ctx, season._id, player._id, now, false);
  const plateaus = await ctx.db.query("plateaus").withIndex("by_status", (q) => q.eq("status", "owned")).take(500);
  for (const plateau of plateaus) if (plateau.ownerPlayerId) {
    const claim = await ctx.db.query("seasonPlateauClaims").withIndex("by_seasonId_and_plateauId_and_playerId", (q) => q.eq("seasonId", season._id).eq("plateauId", plateau._id).eq("playerId", plateau.ownerPlayerId!)).unique();
    if (!claim) await ctx.db.insert("seasonPlateauClaims", { seasonId: season._id, plateauId: plateau._id, playerId: plateau.ownerPlayerId, updatedAt: now });
    const hold = await ctx.db.query("seasonPlateauHolds").withIndex("by_seasonId_and_plateauId", (q) => q.eq("seasonId", season._id).eq("plateauId", plateau._id)).unique();
    if (!hold) {
      const holdId = await ctx.db.insert("seasonPlateauHolds", { seasonId: season._id, plateauId: plateau._id, playerId: plateau.ownerPlayerId, heldSince: now, territoryIntervalsAwarded: 0, researchIntervalsAwarded: 0, custodianAwarded: false, updatedAt: now });
      await scheduleHold(ctx, (await ctx.db.get(holdId))!, plateau.type, now);
    }
  }
}

export const rolloverSeason = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.confirm !== "START NEW SEASON") throw new Error('Type "START NEW SEASON" to confirm.');
    const pendingRaid = await ctx.db.query("raids").withIndex("by_status_arrival", (q) => q.eq("status", "pending")).first();
    const pendingSiege = await ctx.db.query("sieges").withIndex("by_status_resolve", (q) => q.eq("status", "pending")).first();
    const openRun = await ctx.db.query("plateauRuns").withIndex("by_status", (q) => q.eq("status", "open")).first();
    const pendingEspionage = await ctx.db.query("espionageMissions").withIndex("by_status_and_resolveAt", (q) => q.eq("status", "pending")).first();
    if (pendingRaid || pendingSiege || openRun || pendingEspionage) throw new Error("Resolve all raids, sieges, Plateau Runs, and espionage investigations before starting a new season.");
    const now = Date.now();
    await resetWorldPressureForSeason(ctx, now);
    const pressurePlateaus = await ctx.db.query("plateaus").take(500);
    for (const plateau of pressurePlateaus) {
      const baseNeutralDefense = plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial;
      if (plateau.status === "neutral" && (plateau.parshendiReclamationCount ?? 0) > 0) {
        const progress = plateau.neutralDefenseInitial > 0
          ? plateau.neutralDefenseRemaining / plateau.neutralDefenseInitial
          : 1;
        await ctx.db.patch(plateau._id, {
          baseNeutralDefense,
          parshendiReclamationCount: 0,
          reclamationSeasonId: undefined,
          neutralDefenseInitial: baseNeutralDefense,
          neutralDefenseRemaining: Math.max(1, Math.round(baseNeutralDefense * progress)),
          updatedAt: now,
        });
      } else if ((plateau.parshendiReclamationCount ?? 0) > 0 || plateau.reclamationSeasonId) {
        await ctx.db.patch(plateau._id, {
          baseNeutralDefense,
          parshendiReclamationCount: 0,
          reclamationSeasonId: undefined,
          updatedAt: now,
        });
      }
    }
    const current = await activeSeason(ctx);
    if (current) await ctx.db.patch(current._id, { status: "closed", endsAt: now, closedAt: now });
    const nextNumber = (current?.number ?? 0) + 1;
    const seasonId = await createFreshSeason(ctx, nextNumber, now);
    const season = (await ctx.db.get(seasonId))!;
    await initializeSeasonBaseline(ctx, season, now);
    return { seasonId, number: nextNumber, name: season.name };
  },
});

export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const season = await ctx.db.query("seasons").withIndex("by_status", (q) => q.eq("status", "active")).unique();
    if (!season) return { season: null, total: 0, categoryTotals: EMPTY_TOTALS, events: [], achievements: [], rules: publicSeasonScoringRules(), opponentChains: [] };
    const score = await ctx.db.query("seasonScores").withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", season._id).eq("playerId", player._id)).unique();
    const events = await ctx.db.query("seasonScoreEvents").withIndex("by_seasonId_and_playerId_and_createdAt", (q) => q.eq("seasonId", season._id).eq("playerId", player._id)).order("desc").take(50);
    const achievements = await ctx.db.query("seasonAchievements").withIndex("by_seasonId_and_playerId_and_key", (q) => q.eq("seasonId", season._id).eq("playerId", player._id)).take(20);
    const chains = await ctx.db.query("seasonOpponentChains").withIndex("by_seasonId_and_attackerId_and_opponentId", (q) => q.eq("seasonId", season._id).eq("attackerId", player._id)).take(100);
    return { season, total: score?.total ?? 0, categoryTotals: { ...EMPTY_TOTALS, ...(score?.categoryTotals ?? {}) }, events, achievements, rules: publicSeasonScoringRules(), opponentChains: chains };
  },
});
