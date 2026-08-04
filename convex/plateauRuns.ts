import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";
import { insertGameEvent } from "./eventHelpers";
import { requireCurrentPlayer } from "./ownership";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { assignConclave, missionXpBudget, releaseConclave } from "./ardentiaHelpers";
import { completedResearch } from "./researchHelpers";
import { createNotification } from "./notificationHelpers";
import {
  addUnits,
  applySurvivalLosses,
  baseCasualtyRate,
  casualtySummary,
  effectivePower,
  bridgedTravelReduction,
  normalizeUnits,
  missionRiskLabel,
  PLATEAU_RUN_RULES,
  PLATEAU_RUN_SCHEDULE,
  totalUnits,
  UNIT_RULES,
  unitPlunder,
  rewardLabel,
  unitSpeed,
  travelMsForUnits,
  type UnitCounts,
  type UnitKey,
} from "./rules";

const unitCounts = v.object({
  bridgeman: v.number(),
  spearman: v.number(),
  chull: v.optional(v.number()),
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

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

function subtractUnits(available: UnitCounts, requested: UnitCounts) {
  const normalizedAvailable = normalizeUnits(available);
  const normalizedRequested = normalizeUnits(requested);
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (normalizedRequested[key] > normalizedAvailable[key]) {
      throw new Error(`Not enough ${UNIT_RULES[key].name}s available.`);
    }
  }

  const remaining = { ...normalizedAvailable };
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    remaining[key] -= normalizedRequested[key];
  }
  return remaining;
}

function addUnits(current: UnitCounts, returned: UnitCounts) {
  const next = normalizeUnits(current);
  const normalizedReturned = normalizeUnits(returned);
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    next[key] += normalizedReturned[key];
  }
  return next;
}

function validateUnlockedUnits(buildings: { barracks: number }, units: UnitCounts) {
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (units[key] > 0 && !UNIT_RULES[key].active) {
      throw new Error(`${UNIT_RULES[key].name} is inactive for new actions.`);
    }
    if (units[key] > 0 && buildings.barracks < UNIT_RULES[key].barracksLevel) {
      throw new Error(
        `${UNIT_RULES[key].name} requires Barracks level ${UNIT_RULES[key].barracksLevel}.`,
      );
    }
  }
}

async function activePlayerCount(ctx: any, now: number) {
  const cutoff = now - PLATEAU_RUN_RULES.activePlayerWindowMs;
  const activePlayers = await ctx.db
    .query("players")
    .withIndex("by_last_active", (q: any) => q.gte("lastActiveAt", cutoff))
    .collect();
  return Math.max(1, activePlayers.length);
}

async function createPlateauRun(
  ctx: any,
  now: number,
  options: { scheduleKey?: string; source: "admin" | "schedule" },
) {
  const existing = await ctx.db
    .query("plateauRuns")
    .withIndex("by_status", (q: any) => q.eq("status", "open"))
    .first();
  if (existing) {
    return { created: false, plateauRunId: existing._id };
  }

  if (options.scheduleKey) {
    const alreadyStarted = await ctx.db
      .query("plateauRuns")
      .withIndex("by_schedule_key", (q: any) =>
        q.eq("scheduleKey", options.scheduleKey),
      )
      .unique();
    if (alreadyStarted) {
      return { created: false, plateauRunId: alreadyStarted._id };
    }
  }

  const activeCount = await activePlayerCount(ctx, now);
  const randomShiftMagnitude = seededInt(
    `${now}:plateau:difficulty:magnitude`,
    PLATEAU_RUN_RULES.difficultyRandomMin,
    PLATEAU_RUN_RULES.difficultyRandomMax,
  );
  const randomShiftSign =
    seededInt(`${now}:plateau:difficulty:sign`, 0, 1) === 0 ? -1 : 1;
  const difficulty = Math.max(
    PLATEAU_RUN_RULES.minimumDifficulty,
    activeCount * PLATEAU_RUN_RULES.difficultyPerActivePlayer +
      randomShiftMagnitude * randomShiftSign,
  );
  const spherePool =
    activeCount * PLATEAU_RUN_RULES.sphereRewardPerActivePlayer +
    seededInt(
      `${now}:plateau:spheres`,
      PLATEAU_RUN_RULES.sphereRewardRandomMin,
      PLATEAU_RUN_RULES.sphereRewardRandomMax,
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
    ...(options.scheduleKey ? { scheduleKey: options.scheduleKey } : {}),
  });

  await ctx.scheduler.runAfter(0, internal.notifications.notifyPlateauRunOpenBatch, {
    plateauRunId,
    body: `A Plateau Run has opened. The mission appears ${missionRiskLabel(difficulty).toLowerCase()}, with a ${rewardLabel(spherePool).toLowerCase()} sphere pool.`,
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

    return {
      run,
      commitments: commitments
        .sort((a, b) => a.committedAt - b.committedAt)
        .map((commitment, index) => {
        const player = players.find((entry) => entry._id === commitment.playerId);
        const joinOrderSpeedBonus =
          PLATEAU_RUN_RULES.joinOrderSpeedBonuses[index] ?? 0;
        return {
          ...commitment,
          joinOrder: index + 1,
          joinOrderSpeedBonus,
          speedScore: commitment.speed * (1 + joinOrderSpeedBonus),
          playerName: player?.name ?? "Unknown",
        };
      }),
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
    units: unitCounts,
    conclaveId: v.optional(v.id("ardentConclaves")),
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

    const player = await requireCurrentPlayer(ctx);

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
    validateUnlockedUnits(player.buildings, units);

    const availableUnits = existingCommitment
      ? addUnits(player.units, existingCommitment.units)
      : player.units;
    const remainingUnits = subtractUnits(availableUnits, units);
    const completed = await completedResearch(ctx, player._id);
    const power = effectivePower(units, completed);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const bridgedReduction = bridgedTravelReduction(plateauCounts);
    const speed = unitSpeed(units) + Number(completed.bridgeEngineering ?? 0) * 2 + bridgedReduction * 100;
    const travelMinutes = Math.max(
      1,
      Math.round(travelMsForUnits(units, plateauCounts, completed) / 60000),
    );

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
      ...(args.conclaveId ? { conclaveId: args.conclaveId } : {}),
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
      await ctx.db.patch(existingCommitment._id, commitment);
    }
    if (args.conclaveId && existingCommitment?.conclaveId !== args.conclaveId) await assignConclave(ctx, player._id, args.conclaveId, "plateau_run", String(commitmentId));

  await insertGameEvent(ctx, {
      kind: "plateau_run",
      text: `${player.name} ${existingCommitment ? "updated" : "committed"} forces for the Plateau Run.`,
      createdAt: now,
    });

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
    const player = await requireCurrentPlayer(ctx);
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
      const joinOrderSpeedBonus =
        PLATEAU_RUN_RULES.joinOrderSpeedBonuses[index] ?? 0;
      return {
        ...commitment,
        joinOrder: index + 1,
        joinOrderSpeedBonus,
        speedScore: commitment.speed * (1 + joinOrderSpeedBonus),
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
        const lossResult = applySurvivalLosses(
          entry.units,
          runBaseCasualtyRate,
          `${run._id}:${entry._id}:failed:${now}`,
          completed,
        );
        await releaseConclave(ctx, entry.conclaveId, conclaveXp);
        await ctx.db.patch(entry._id, { conclaveXpAwarded: entry.conclaveId ? conclaveXp : undefined });
        await ctx.db.patch(player._id, {
          units: addUnits(player.units, lossResult.survivors),
          lastActiveAt: now,
        });
        await ctx.db.insert("messages", {
          toPlayerId: player._id,
          kind: "system",
          subject: "Plateau Run Failed",
          body: `The combined force failed against ${missionRiskLabel(run.difficulty).toLowerCase()} opposition. Casualties: ${casualtySummary(lossResult.casualties)}.`,
          createdAt: now,
        });
        await createNotification(ctx, {
          playerId: player._id, category: "plateau_runs", eventType: "plateau_run_resolved",
          title: "Plateau Run Failed", body: "The combined force was defeated. Open the report for casualty details.",
          destinationView: "plateau", entityId: String(run._id),
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

    let winner = finalEntries[0];
    for (const entry of finalEntries) {
      if (entry.effectivePower > winner.effectivePower) winner = entry;
    }
    const nonWinnerPower = finalEntries
      .filter((entry) => entry._id !== winner._id)
      .reduce((sum, entry) => sum + entry.effectivePower, 0);

    for (const entry of finalEntries) {
      const player = await ctx.db.get(entry.playerId);
      if (!player) continue;
      const completed = await completedResearch(ctx, player._id);

      const lossResult = applySurvivalLosses(
        entry.units,
        runBaseCasualtyRate,
        `${run._id}:${entry._id}:success:${now}`,
        completed,
      );
      const isWinner = entry._id === winner._id;
      const availableSphereShare =
        !isWinner && nonWinnerPower > 0
          ? Math.floor(run.spherePool * (entry.effectivePower / nonWinnerPower))
          : finalEntries.length === 1
            ? run.spherePool
            : 0;
      const plunder = unitPlunder(entry.units, completed);
      await releaseConclave(ctx, entry.conclaveId, conclaveXp);
      await ctx.db.patch(entry._id, { conclaveXpAwarded: entry.conclaveId ? conclaveXp : undefined });
      const sphereShare = Math.min(availableSphereShare, plunder);
      const leftBehind = Math.max(0, availableSphereShare - sphereShare);

      await ctx.db.patch(player._id, {
        units: addUnits(player.units, lossResult.survivors),
        spheres: player.spheres + sphereShare,
        gemhearts: player.gemhearts + (isWinner ? run.gemheartReward : 0),
        lastActiveAt: now,
      });
      await ctx.db.insert("messages", {
        toPlayerId: player._id,
        kind: "system",
        subject: isWinner ? "Gemheart Claimed" : "Plateau Run Reward",
        body: isWinner
          ? `Your warcamp claimed ${run.gemheartReward} Gemheart from the Plateau Run. Casualties: ${casualtySummary(lossResult.casualties)}.`
          : `Your warcamp recovered ${sphereShare} spheres from the Plateau Run.${leftBehind > 0 ? " Some spheres were left behind because the army lacked Plunder." : ""} Casualties: ${casualtySummary(lossResult.casualties)}.`,
        createdAt: now,
      });
      await createNotification(ctx, {
        playerId: player._id, category: "plateau_runs", eventType: "plateau_run_resolved",
        title: isWinner ? "Gemheart Claimed" : "Plateau Run Reward",
        body: isWinner ? `Your warcamp claimed ${run.gemheartReward} Gemheart.` : `Your warcamp recovered ${sphereShare} spheres.`,
        destinationView: "plateau", entityId: String(run._id),
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
