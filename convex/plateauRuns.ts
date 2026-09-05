import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin } from "./admin";
import { insertGameEvent } from "./eventHelpers";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { assignConclave, missionXpBudget, releaseConclave } from "./ardentiaHelpers";
import { completedResearch } from "./researchHelpers";
import { createNotification } from "./notificationHelpers";
import { awardSeasonPoints, ensureActiveSeason } from "./seasonLedger";
import { SEASON_SCORING_RULES } from "./seasonScoringRules";
import { subtractAvailableUnits, unitCountsValidator, validateMissionUnits } from "./armyRules";
import {
  addUnits,
  applySurvivalLosses,
  baseCasualtyRate,
  casualtySummary,
  effectivePower,
  effectiveSpeed,
  doctrineFromResearch,
  bridgedTravelReduction,
  normalizeUnits,
  PLATEAU_RUN_RULES,
  plateauRunBaseDifficulty,
  plateauRunFinalSpeed,
  plateauRunJoinSpeedBonus,
  plateauRunPowerLabel,
  plateauRunRewardMultiplier,
  plateauRunSeasonMultiplier,
  PLATEAU_RUN_SCHEDULE,
  totalUnits,
  unitPlunder,
  rewardLabel,
  unitSpeed,
  travelMsForUnits,
  type UnitCounts,
} from "./rules";
import { applyHostility } from "./worldPressure";
import { WORLD_PRESSURE_RULES } from "./worldPressureRules";
import { economyIntelDisclosureLevel } from "./espionageRules";
import { presentIntelNumber } from "./intelligenceRules";
import { applyFabrialCasualtyProtection, soulcasterRecovery } from "./fabrialRules";
import { reserveFabrial, settleReusableFabrial } from "./fabrialHelpers";

function seededInt(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

function cleanUnits(units: UnitCounts) {
  return normalizeUnits(units);
}

async function activePlayerCount(ctx: MutationCtx, now: number) {
  const cutoff = now - PLATEAU_RUN_RULES.activePlayerWindowMs;
  const activePlayers = await ctx.db
    .query("players")
    .withIndex("by_last_active", (q) => q.gte("lastActiveAt", cutoff))
    .collect();
  return Math.max(1, activePlayers.filter((player) => !player.isAdminObserver).length);
}

async function createPlateauRun(
  ctx: MutationCtx,
  now: number,
  options: { scheduleKey?: string; source: "admin" | "schedule" },
) {
  const existing = await ctx.db
    .query("plateauRuns")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .first();
  if (existing) {
    return { created: false, plateauRunId: existing._id };
  }

  if (options.scheduleKey) {
    const alreadyStarted = await ctx.db
      .query("plateauRuns")
      .withIndex("by_schedule_key", (q) =>
        q.eq("scheduleKey", options.scheduleKey),
      )
      .unique();
    if (alreadyStarted) {
      return { created: false, plateauRunId: alreadyStarted._id };
    }
  }

  const activeCount = await activePlayerCount(ctx, now);
  const scoringSeason = await ensureActiveSeason(ctx, now);
  const difficultyVariance = seededInt(
    `${now}:plateau:difficulty:variance`,
    -PLATEAU_RUN_RULES.difficultyVariancePercent,
    PLATEAU_RUN_RULES.difficultyVariancePercent,
  );
  const difficulty = Math.round(
    plateauRunBaseDifficulty(activeCount) *
      plateauRunSeasonMultiplier(scoringSeason.startsAt, now) *
      (1 + difficultyVariance / 100),
  );
  const sphereVariance = seededInt(
    `${now}:plateau:spheres:variance`,
    -PLATEAU_RUN_RULES.sphereRewardVariancePercent,
    PLATEAU_RUN_RULES.sphereRewardVariancePercent,
  );
  const spherePool = Math.round(
    (PLATEAU_RUN_RULES.sphereRewardBase + activeCount * PLATEAU_RUN_RULES.sphereRewardPerActivePlayer) *
      plateauRunRewardMultiplier(scoringSeason.startsAt, now) *
      (1 + sphereVariance / 100),
  );
  const closesAt = now + PLATEAU_RUN_RULES.joinRealMs;

  const plateauRunId = await ctx.db.insert("plateauRuns", {
    status: "open",
    opensAt: now,
    closesAt,
    resolvesAt: closesAt,
    difficulty,
    spherePool,
    gemheartReward: PLATEAU_RUN_RULES.gemheartReward,
    scoringSeasonId: scoringSeason._id,
    ...(options.scheduleKey ? { scheduleKey: options.scheduleKey } : {}),
  });

  await ctx.scheduler.runAfter(0, internal.notifications.notifyPlateauRunOpenBatch, {
    plateauRunId,
    body: `A ${plateauRunPowerLabel(difficulty)} Chasmfiend has appeared, with a ${rewardLabel(spherePool).toLowerCase()} sphere pool.`,
    createdAt: now,
    paginationOpts: { numItems: 40, cursor: null },
  });

  await insertGameEvent(ctx, {
    kind: "plateau_run",
    text: `A ${options.source === "schedule" ? "scheduled " : ""}Plateau Run opened for ${activeCount} active warcamps. Difficulty ${difficulty}.`,
    createdAt: now,
  });

  await ctx.scheduler.runAt(closesAt, internal.plateauRuns.resolvePlateauRun, {
    plateauRunId,
  });

  return {
    created: true,
    plateauRunId,
    activeCount,
    difficulty,
    spherePool,
    closesAt,
  };
}

function mountainScheduleSlot(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));

  const slot = PLATEAU_RUN_SCHEDULE.find((entry) => entry.hour === hour && minute >= entry.minute && minute < entry.minute + 15);
  if (!slot) {
    return null;
  }

  return {
    label: `${slot.label} Mountain`,
    scheduleKey: `${value("year")}-${value("month")}-${value("day")}:${hour}`,
  };
}

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const run = await ctx.db
      .query("plateauRuns")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .first();
    if (!run) return null;

    const commitments = await ctx.db
      .query("plateauCommitments")
      .withIndex("by_run", (q) => q.eq("plateauRunId", run._id))
      .collect();
    const players = await ctx.db.query("players").collect();

    const decoratedCommitments = await Promise.all(commitments
      .sort((a, b) => a.committedAt - b.committedAt)
      .map(async (commitment, index) => {
        const player = players.find((entry) => entry._id === commitment.playerId);
        const joinOrderSpeedBonus = plateauRunJoinSpeedBonus(index, commitment.doctrineJoinSpeedMultiplier ?? 1);
        const intelResource = commitment.playerId === viewer._id
          ? null
          : await ctx.db
              .query("kingdomIntelResources")
              .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) =>
                q.eq("viewerPlayerId", viewer._id).eq("targetPlayerId", commitment.playerId),
              )
              .unique();
        const militaryIntel = Math.max(0, Math.min(100, Math.floor(
          intelResource?.militaryAmount ?? intelResource?.amount ?? 0,
        )));
        const ledgerLevel = commitment.playerId === viewer._id
          ? 2
          : economyIntelDisclosureLevel(militaryIntel);
        const presentationLevel = ledgerLevel === 2 ? 3 : ledgerLevel === 1 ? 2 : 0;
        const shared = {
          _id: commitment._id,
          playerId: commitment.playerId,
          committedAt: commitment.committedAt,
          joinOrder: index + 1,
          joinOrderSpeedBonus,
          speedScore: plateauRunFinalSpeed(commitment.speed, index, commitment.doctrineJoinSpeedMultiplier ?? 1),
          playerName: player?.name ?? "Unknown",
          powerIntel: presentIntelNumber(commitment.power, presentationLevel),
        };
        return commitment.playerId === viewer._id
          ? { ...commitment, ...shared }
          : shared;
      }));

    return {
      run,
      commitments: decoratedCommitments,
    };
  },
});

export const startPlateauRun = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await createPlateauRun(ctx, Date.now(), { source: "admin" });
  },
});

export const maybeStartScheduledPlateauRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const slot = mountainScheduleSlot(now);
    if (!slot) {
      return { created: false, reason: "outside_schedule" };
    }

    const result = await createPlateauRun(ctx, now, {
      source: "schedule",
      scheduleKey: slot.scheduleKey,
    });

    return { ...result, scheduleLabel: slot.label };
  },
});

export const joinPlateauRun = mutation({
  args: {
    plateauRunId: v.id("plateauRuns"),
    units: unitCountsValidator,
    conclaveId: v.optional(v.id("ardentConclaves")),
    fabrial: v.optional(v.union(v.literal("painrial"), v.literal("soulcaster"), v.literal("halfShard"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const run = await ctx.db.get(args.plateauRunId);
    if (!run || run.status !== "open") {
      throw new Error("No open Plateau Run found.");
    }
    if (now > run.closesAt) {
      throw new Error("This Plateau Run is already closed.");
    }

    const player = await requireCompetitivePlayer(ctx);

    const existingCommitment = await ctx.db
      .query("plateauCommitments")
      .withIndex("by_run_player", (q) =>
        q.eq("plateauRunId", run._id).eq("playerId", player._id),
      )
      .unique();
    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) {
      throw new Error("Commit at least one unit.");
    }
    validateMissionUnits(player.buildings, units);

    const availableUnits = existingCommitment
      ? addUnits(player.units, existingCommitment.units)
      : player.units;
    const remainingUnits = subtractAvailableUnits(availableUnits, units);
    const completed = await completedResearch(ctx, player._id);
    const conclaveCombat = Boolean(args.conclaveId);
    const power = effectivePower(units, completed, conclaveCombat);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const bridgedReduction = bridgedTravelReduction(plateauCounts);
    const speed = effectiveSpeed(units, completed, conclaveCombat) + bridgedReduction * 100;
    const travelMinutes = Math.max(
      1,
      Math.round(travelMsForUnits(units, plateauCounts, completed, conclaveCombat) / 60000),
    );

    if (existingCommitment?.fabrialKind !== args.fabrial) {
      await settleReusableFabrial(
        ctx,
        player._id,
        existingCommitment?.fabrialKind,
        "clean_success",
        `plateau-run:${run._id}:replace:${existingCommitment?._id ?? "new"}`,
        now,
      );
      await reserveFabrial(ctx, player._id, args.fabrial, now);
    }

    await ctx.db.patch(player._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });

    const commitment = {
      units,
      power,
      speed,
      bridgedTravelReductionPercent: Math.round(bridgedReduction * 100),
      travelMinutes,
      doctrineJoinSpeedMultiplier: doctrineFromResearch(completed) === "gemheartBaron" ? 2 : 1,
      ...(args.conclaveId ? { conclaveId: args.conclaveId } : {}),
      ...(args.fabrial ? { fabrialKind: args.fabrial } : {}),
    };
    const commitmentId = existingCommitment
      ? existingCommitment._id
      : await ctx.db.insert("plateauCommitments", {
          plateauRunId: run._id,
          playerId: player._id,
          ...commitment,
          committedAt: now,
        });
    if (existingCommitment) {
      if (existingCommitment.conclaveId && existingCommitment.conclaveId !== args.conclaveId) await releaseConclave(ctx, existingCommitment.conclaveId);
      await ctx.db.patch(existingCommitment._id, {
        ...commitment,
        conclaveId: args.conclaveId,
        fabrialKind: args.fabrial,
      });
    }
    if (args.conclaveId && existingCommitment?.conclaveId !== args.conclaveId) await assignConclave(ctx, player._id, args.conclaveId, "plateau_run", String(commitmentId));

  await insertGameEvent(ctx, {
      kind: "plateau_run",
      text: `${player.name} ${existingCommitment ? "updated" : "committed"} forces for the Plateau Run.`,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.highstorms.processActiveStorm, {});
    return { commitmentId, power, speed, travelMinutes, updated: Boolean(existingCommitment) };
  },
});

export const cancelPlateauRunCommitment = mutation({
  args: {
    plateauRunId: v.id("plateauRuns"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const run = await ctx.db.get(args.plateauRunId);
    if (!run || run.status !== "open" || now > run.closesAt) {
      throw new Error("This Plateau Run has already begun.");
    }
    const player = await requireCompetitivePlayer(ctx);
    const commitment = await ctx.db
      .query("plateauCommitments")
      .withIndex("by_run_player", (q) =>
        q.eq("plateauRunId", run._id).eq("playerId", player._id),
      )
      .unique();
    if (!commitment) throw new Error("You have no commitment to cancel.");

    await ctx.db.patch(player._id, {
      units: addUnits(player.units, commitment.units),
      lastActiveAt: now,
    });
    await releaseConclave(ctx, commitment.conclaveId);
    await settleReusableFabrial(ctx, player._id, commitment.fabrialKind, "clean_success", `plateau-run:${run._id}:cancel:${commitment._id}`, now);
    await ctx.db.delete(commitment._id);
    await insertGameEvent(ctx, {
      kind: "plateau_run",
      text: `${player.name} withdrew from the Plateau Run before it began.`,
      createdAt: now,
    });
    return { cancelled: true };
  },
});

export const forceResolvePlateauRun = mutation({
  args: {
    plateauRunId: v.id("plateauRuns"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.plateauRuns.resolvePlateauRun, {
      plateauRunId: args.plateauRunId,
    });
    return { scheduled: true };
  },
});

export const resolvePlateauRun = internalMutation({
  args: {
    plateauRunId: v.id("plateauRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.plateauRunId);
    if (!run || run.status === "resolved") {
      return { resolved: false };
    }

    const now = Date.now();
    const commitments = await ctx.db
      .query("plateauCommitments")
      .withIndex("by_run", (q) => q.eq("plateauRunId", run._id))
      .collect();

    if (commitments.length === 0) {
      await ctx.db.patch(run._id, {
        status: "resolved",
        resolvedAt: now,
      });
  await insertGameEvent(ctx, {
        kind: "plateau_run",
        text: "The Plateau Run closed with no warcamps committed.",
        createdAt: now,
      });
      return { resolved: true, won: false, reason: "no_commitments" };
    }

    const sorted = [...commitments].sort((a, b) => a.committedAt - b.committedAt);
    const entries = sorted.map((commitment, index) => {
      const joinOrderSpeedBonus = plateauRunJoinSpeedBonus(index, commitment.doctrineJoinSpeedMultiplier ?? 1);
      return {
        ...commitment,
        joinOrder: index + 1,
        joinOrderSpeedBonus,
        speedScore: plateauRunFinalSpeed(commitment.speed, index, commitment.doctrineJoinSpeedMultiplier ?? 1),
        effectivePower: commitment.power,
      };
    });
    let fastest = entries[0];
    for (const entry of entries) {
      if (entry.speedScore > fastest.speedScore) fastest = entry;
    }

    const finalEntries = entries.map((entry) => ({
      ...entry,
      effectivePower:
        entry._id === fastest._id
          ? entry.effectivePower * (1 + PLATEAU_RUN_RULES.fastestPowerBonus)
          : entry.effectivePower,
    }));
    const combinedPower = finalEntries.reduce(
      (sum, entry) => sum + entry.effectivePower,
      0,
    );
    const runBaseCasualtyRate = baseCasualtyRate(combinedPower, run.difficulty);
    const won = combinedPower >= run.difficulty;
    const conclaveXp = missionXpBudget(run.difficulty);

    if (!won) {
      for (const entry of finalEntries) {
        const player = await ctx.db.get(entry.playerId);
        if (!player) continue;
        const completed = await completedResearch(ctx, player._id);
        const rawLossResult = applySurvivalLosses(
          entry.units,
          runBaseCasualtyRate,
          `${run._id}:${entry._id}:failed:${now}`,
          completed,
          Boolean(entry.conclaveId),
        );
        const lossResult = applyFabrialCasualtyProtection(entry.fabrialKind, rawLossResult);
        const reusable = await settleReusableFabrial(
          ctx,
          player._id,
          entry.fabrialKind,
          "lower_failure",
          `plateau-run:${run._id}:${entry._id}:fabrial-loss`,
          now,
        );
        const awardedXp = entry.conclaveId ? await releaseConclave(ctx, entry.conclaveId, conclaveXp) : undefined;
        await ctx.db.patch(entry._id, {
          conclaveXpAwarded: awardedXp,
          fabrialResolvedAt: entry.fabrialKind ? now : undefined,
          fabrialLost: entry.fabrialKind ? reusable.lost : undefined,
          fabrialPreventedCasualties: entry.fabrialKind ? (entry.fabrialPreventedCasualties ?? 0) + lossResult.prevented : undefined,
        });
        await ctx.db.patch(player._id, {
          units: addUnits(player.units, lossResult.survivors),
          lastActiveAt: now,
        });
        const speedRank = [...finalEntries]
          .sort((a, b) => b.speedScore - a.speedScore || a.joinOrder - b.joinOrder)
          .findIndex((candidate) => candidate._id === entry._id) + 1;
        const effectivePowerText = entry._id === fastest._id
          ? `${entry.effectivePower.toFixed(2)} effective Power (${entry.power.toFixed(2)} base plus the 10% fastest-army bonus)`
          : `${entry.effectivePower.toFixed(2)} Power`;
        const speedReport = `Final Speed ${entry.speedScore.toFixed(2)} (${entry.speed.toFixed(2)} base${entry.joinOrderSpeedBonus > 0 ? ` plus ${Math.round(entry.joinOrderSpeedBonus * 100)}% for joining #${entry.joinOrder}` : ""}), rank ${speedRank} of ${finalEntries.length}`;
        await ctx.db.insert("messages", {
          toPlayerId: player._id,
          kind: "system",
          subject: "Plateau Run Failed",
          body: `The hunt failed: combined Power ${combinedPower.toFixed(2)} did not reach the Chasmfiend's ${run.difficulty} Power. Your contribution: ${effectivePowerText}. Gemheart race: ${speedReport}. Reward: none. Casualties: ${casualtySummary(lossResult.casualties)}.${lossResult.prevented ? ` ${entry.fabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${lossResult.prevented} casualties.` : ""}${reusable.lost ? ` The retreat became chaotic. The ${entry.fabrialKind === "halfShard" ? "Half-Shard" : "Soulcaster"} was lost.` : ""}`,
          eventType: "plateau_run_resolved", destinationView: "plains", destinationTab: "plateau-runs", entityType: "plateau_run", entityId: String(run._id),
          createdAt: now,
        });
        await createNotification(ctx, {
          playerId: player._id, category: "plateau_runs", eventType: "plateau_run_resolved",
          title: "Plateau Run Failed", body: "The combined force was defeated. Open the report for casualty details.",
          destinationView: "plains", destinationTab: "plateau-runs", entityId: String(run._id),
          dedupeKey: `plateau-run:${run._id}:resolved:${player._id}`, createdAt: now,
        });
      }

      await ctx.db.patch(run._id, {
        status: "resolved",
        resolvedAt: now,
      });
  await insertGameEvent(ctx, {
        kind: "plateau_run",
        text: `The Plateau Run failed. Combined power ${combinedPower.toFixed(2)} did not beat ${run.difficulty}.`,
        createdAt: now,
      });

      return { resolved: true, won: false, combinedPower };
    }

    // Join order breaks an exact final-Speed tie deterministically because
    // finalEntries retains committedAt order.
    let winner = finalEntries[0];
    for (const entry of finalEntries) {
      if (entry.speedScore > winner.speedScore) winner = entry;
    }
    const nonWinnerPower = finalEntries
      .filter((entry) => entry._id !== winner._id)
      .reduce((sum, entry) => sum + entry.effectivePower, 0);

    for (const entry of finalEntries) {
      const player = await ctx.db.get(entry.playerId);
      if (!player) continue;
      const completed = await completedResearch(ctx, player._id);

      const rawLossResult = applySurvivalLosses(
        entry.units,
        runBaseCasualtyRate,
        `${run._id}:${entry._id}:success:${now}`,
        completed,
        Boolean(entry.conclaveId),
      );
      const lossResult = applyFabrialCasualtyProtection(entry.fabrialKind, rawLossResult);
      const isWinner = entry._id === winner._id;
      const availableSphereShare =
        !isWinner && nonWinnerPower > 0
          ? Math.floor(run.spherePool * (entry.effectivePower / nonWinnerPower))
          : finalEntries.length === 1
            ? run.spherePool
            : 0;
      const plunder = unitPlunder(entry.units, completed, Boolean(entry.conclaveId));
      const awardedXp = entry.conclaveId ? await releaseConclave(ctx, entry.conclaveId, conclaveXp) : undefined;
      const recovery = entry.fabrialKind === "soulcaster"
        ? soulcasterRecovery(availableSphereShare, plunder, true)
        : {
            normalRecovery: Math.min(availableSphereShare, plunder),
            bonus: 0,
            totalRecovery: Math.min(availableSphereShare, plunder),
          };
      const sphereShare = recovery.totalRecovery;
      const leftBehind = Math.max(0, availableSphereShare - sphereShare);
      const reusable = await settleReusableFabrial(
        ctx,
        player._id,
        entry.fabrialKind,
        "normal_success",
        `plateau-run:${run._id}:${entry._id}:fabrial-loss`,
        now,
      );
      await ctx.db.patch(entry._id, {
        conclaveXpAwarded: awardedXp,
        fabrialResolvedAt: entry.fabrialKind ? now : undefined,
        fabrialLost: entry.fabrialKind ? reusable.lost : undefined,
        fabrialPreventedCasualties: entry.fabrialKind ? (entry.fabrialPreventedCasualties ?? 0) + lossResult.prevented : undefined,
        fabrialSoulcasterBonus: entry.fabrialKind ? recovery.bonus : undefined,
      });

      await ctx.db.patch(player._id, {
        units: addUnits(player.units, lossResult.survivors),
        spheres: player.spheres + sphereShare,
        gemhearts: player.gemhearts + (isWinner ? run.gemheartReward : 0),
        lastActiveAt: now,
      });
      await applyHostility(ctx, {
        playerId: player._id,
        gain: WORLD_PRESSURE_RULES.hostility.gains.plateauRunVictory,
        playerInitiated: true,
        now,
      });
      const speedRank = [...finalEntries]
        .sort((a, b) => b.speedScore - a.speedScore || a.joinOrder - b.joinOrder)
        .findIndex((candidate) => candidate._id === entry._id) + 1;
      const effectivePowerText = isWinner
        ? `${entry.effectivePower.toFixed(2)} effective Power (${entry.power.toFixed(2)} base plus the 10% fastest-army bonus)`
        : `${entry.effectivePower.toFixed(2)} Power`;
      const speedReport = `Final Speed ${entry.speedScore.toFixed(2)} (${entry.speed.toFixed(2)} base${entry.joinOrderSpeedBonus > 0 ? ` plus ${Math.round(entry.joinOrderSpeedBonus * 100)}% for joining #${entry.joinOrder}` : ""}), rank ${speedRank} of ${finalEntries.length}`;
      const rewardReport = isWinner
        ? finalEntries.length === 1
          ? `${run.gemheartReward} Gemheart and ${sphereShare} of ${availableSphereShare} allocated Spheres (Plunder capacity ${plunder})`
          : `${run.gemheartReward} Gemheart; the other hunters divided the Sphere pool`
        : `${sphereShare} of ${availableSphereShare} allocated Spheres (Plunder capacity ${plunder})${leftBehind > 0 ? `; ${leftBehind} Spheres were left behind` : ""}`;
      await ctx.db.insert("messages", {
        toPlayerId: player._id,
        kind: "system",
        subject: isWinner ? "Gemheart Claimed" : "Plateau Run Reward",
        body: `The hunt succeeded: combined Power ${combinedPower.toFixed(2)} defeated the Chasmfiend's ${run.difficulty} Power. Your contribution: ${effectivePowerText}. Gemheart race: ${speedReport}. Reward: ${rewardReport}. Casualties: ${casualtySummary(lossResult.casualties)}.${lossResult.prevented ? ` ${entry.fabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${lossResult.prevented} casualties.` : ""}${recovery.bonus ? ` Your Soulcaster recovered an additional ${recovery.bonus} Spheres beyond the army's normal Plunder capacity.` : ""}`,
        eventType: "plateau_run_resolved", destinationView: "plains", destinationTab: "plateau-runs", entityType: "plateau_run", entityId: String(run._id),
        createdAt: now,
      });
      if (run.scoringSeasonId) {
        const meaningful = entry.effectivePower >= SEASON_SCORING_RULES.military.plateauRunMinimumPower && entry.effectivePower >= run.difficulty * SEASON_SCORING_RULES.military.plateauRunMinimumDifficultyShare;
        if (isWinner || meaningful) await awardSeasonPoints(ctx, {
          seasonId: run.scoringSeasonId, playerId: player._id, category: "military",
          sourceType: isWinner ? "plateau_run_winner" : "plateau_run_contribution",
          sourceKey: `plateau-run:${run._id}:${isWinner ? "winner" : "contributor"}:${player._id}`,
          basePoints: isWinner ? SEASON_SCORING_RULES.military.plateauRunWinner : SEASON_SCORING_RULES.military.plateauRunContributor,
          description: isWinner ? "Won a successful Plateau Run" : "Made a meaningful contribution to a successful Plateau Run",
          entityType: "plateau_run", entityId: String(run._id), now,
        });
      }
      await createNotification(ctx, {
        playerId: player._id, category: "plateau_runs", eventType: "plateau_run_resolved",
        title: isWinner ? "Gemheart Claimed" : "Plateau Run Reward",
        body: isWinner ? `Your warcamp claimed ${run.gemheartReward} Gemheart.` : `Your warcamp recovered ${sphereShare} spheres.`,
        destinationView: "plains", destinationTab: "plateau-runs", entityId: String(run._id),
        dedupeKey: `plateau-run:${run._id}:resolved:${player._id}`, createdAt: now,
      });
    }

    const winnerPlayer = await ctx.db.get(winner.playerId);
    await ctx.db.patch(run._id, {
      status: "resolved",
      winnerPlayerId: winner.playerId,
      resolvedAt: now,
    });
  await insertGameEvent(ctx, {
      kind: "gemheart",
      text: `${winnerPlayer?.name ?? "A warcamp"} claimed the Gemheart. Combined power ${combinedPower.toFixed(2)} beat ${run.difficulty}.`,
      createdAt: now,
    });

    return {
      resolved: true,
      won: true,
      combinedPower,
      winnerPlayerId: winner.playerId,
    };
  },
});
