import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin } from "./admin";
import { insertGameEvent } from "./eventHelpers";
import { requireCurrentPlayer } from "./ownership";
import {
  casualtyIntelSummary,
  currentKingdomIntelLevel,
  recordKingdomReport,
} from "./intelligenceHelpers";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { assignConclave, missionXpBudget, releaseConclave } from "./ardentiaHelpers";
import { completedResearch } from "./researchHelpers";
import { createNotification } from "./notificationHelpers";
import { awardSeasonPoints, ensureActiveSeason } from "./seasonLedger";
import { SEASON_SCORING_RULES } from "./seasonScoringRules";
import type { Id } from "./_generated/dataModel";
import { subtractAvailableUnits, unitCountsValidator, validateMissionUnits } from "./armyRules";
import {
  addUnits,
  ARMY_RULES,
  applySurvivalLosses,
  baseCasualtyRate,
  casualtySummary,
  COMBAT_RULES,
  effectivePower,
  effectiveSpeed,
  normalizeUnits,
  resistanceLabel,
  rewardLabel,
  totalUnits,
  travelMsForUnits,
  unitPlunder,
  WORLD_KEY,
  type UnitCounts,
} from "./rules";
import { applyHostility } from "./worldPressure";
import {
  hostilityScaledValue,
  seededFraction,
  seededInt,
  WORLD_PRESSURE_RULES,
} from "./worldPressureRules";

function cleanUnits(units: UnitCounts) {
  return normalizeUnits(units);
}

async function createRaid(
  ctx: MutationCtx,
  args: {
    attackerId: Id<"players">;
    targetType: "open_acres" | "player" | "parshendi_spheres" | "deep_plains";
    targetPlayerId?: Id<"players">;
    units: UnitCounts;
    acres?: number;
    conclaveId?: Id<"ardentConclaves">;
  },
) {
  const attacker = await ctx.db.get(args.attackerId);
  if (!attacker) {
    throw new Error("Attacker not found.");
  }

  const units = cleanUnits(args.units);
  if (totalUnits(units) < 1) {
    throw new Error("Send at least one unit.");
  }
  validateMissionUnits(attacker.buildings, units);

  if (args.targetType === "player") {
    if (!args.targetPlayerId) throw new Error("Choose a target player.");
    if (args.targetPlayerId === attacker._id) throw new Error("You cannot raid yourself.");
    const defender = await ctx.db.get(args.targetPlayerId);
    if (!defender) throw new Error("Target player not found.");
  }

  const world = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
    .unique();
  if (!world) {
    throw new Error("Create the world before launching raids.");
  }

  const now = Date.now();
  const neutralAggression = args.targetType === "parshendi_spheres" || args.targetType === "deep_plains";
  const pressure = neutralAggression
    ? await applyHostility(ctx, { playerId: attacker._id, playerInitiated: true, now })
    : null;
  if (args.targetType === "deep_plains" && (pressure?.hostility ?? 0) < WORLD_PRESSURE_RULES.deepPlains.unlockMinimumHostility) {
    throw new Error("Deep Plains Raids require Vengeful or Relentless Hostility.");
  }
  const scoringSeason = await ensureActiveSeason(ctx, now);
  const departAt = now;
  const plateauCounts = await plateauCountsForPlayer(ctx, attacker._id);
  const completed = await completedResearch(ctx, attacker._id);
  const conclaveCombat = Boolean(args.conclaveId);
  const seedBase = `${attacker._id}:${now}:${totalUnits(units)}:${args.targetType}`;
  const arriveAt = args.targetType === "deep_plains"
    ? now + seededInt(
        `${seedBase}:duration`,
        WORLD_PRESSURE_RULES.deepPlains.durationMinutes[0],
        WORLD_PRESSURE_RULES.deepPlains.durationMinutes[1],
      ) * 60 * 1000
    : now + travelMsForUnits(units, plateauCounts, completed, conclaveCombat);
  const power = effectivePower(units, completed, conclaveCombat);
  const speed = effectiveSpeed(units, completed, conclaveCombat);
  const remainingUnits = subtractAvailableUnits(attacker.units, units);
  const acres =
    args.targetType === "parshendi_spheres"
      ? undefined
      : Math.max(1, Math.floor(args.acres ?? 1));

  const defensePower =
    args.targetType === "parshendi_spheres"
      ? hostilityScaledValue(seededInt(`${seedBase}:defense`, COMBAT_RULES.parshendiSphereRaidMinDefense, COMBAT_RULES.parshendiSphereRaidMaxDefense), pressure?.hostility ?? 0, WORLD_PRESSURE_RULES.neutralRaid.difficultyHostilityFactor)
      : args.targetType === "deep_plains"
        ? hostilityScaledValue(seededInt(`${seedBase}:defense`, WORLD_PRESSURE_RULES.deepPlains.defensePower[0], WORLD_PRESSURE_RULES.deepPlains.defensePower[1]), pressure?.hostility ?? 0, WORLD_PRESSURE_RULES.deepPlains.difficultyHostilityFactor)
      : undefined;
  const rewardSpheres =
    args.targetType === "parshendi_spheres"
      ? hostilityScaledValue(seededInt(`${seedBase}:reward`, COMBAT_RULES.parshendiSphereRaidMinReward, COMBAT_RULES.parshendiSphereRaidMaxReward), pressure?.hostility ?? 0, WORLD_PRESSURE_RULES.neutralRaid.rewardHostilityFactor)
      : args.targetType === "deep_plains"
        ? hostilityScaledValue(seededInt(`${seedBase}:reward`, WORLD_PRESSURE_RULES.deepPlains.sphereReward[0], WORLD_PRESSURE_RULES.deepPlains.sphereReward[1]), pressure?.hostility ?? 0, WORLD_PRESSURE_RULES.deepPlains.rewardHostilityFactor)
      : undefined;

  await ctx.db.patch(attacker._id, {
    units: remainingUnits,
    lastActiveAt: now,
  });

  const raidId = await ctx.db.insert("raids", {
    attackerId: attacker._id,
    targetType: args.targetType,
    ...(args.targetPlayerId ? { targetPlayerId: args.targetPlayerId } : {}),
    units,
    power,
    speed,
    ...(acres ? { acres } : {}),
    ...(defensePower ? { defensePower } : {}),
    ...(rewardSpheres ? { rewardSpheres } : {}),
    ...(pressure ? { hostilityAtLaunch: pressure.hostility } : {}),
    departAt,
    arriveAt,
    status: "pending",
    scoringSeasonId: scoringSeason._id,
  });
  if (args.conclaveId) {
    await assignConclave(ctx, attacker._id, args.conclaveId, "raid", String(raidId));
    await ctx.db.patch(raidId, { conclaveId: args.conclaveId, ardentiaConclave: true });
  }

  if (args.targetType === "player" && args.targetPlayerId) {
    await ctx.db.insert("messages", {
      toPlayerId: args.targetPlayerId,
      kind: "system",
      subject: "Incoming Raid",
      body: `${attacker.name} has launched a raid toward your warcamp.`,
      eventType: "incoming_raid", destinationView: "plains", destinationTab: "raids", entityType: "raid", entityId: String(raidId),
      createdAt: now,
    });
  }

  if (args.targetType === "player" && args.targetPlayerId) {
    await createNotification(ctx, {
      playerId: args.targetPlayerId, category: "combat", eventType: "incoming_raid",
      title: "Incoming Raid", body: `${attacker.name} has launched a raid toward your warcamp.`,
      destinationView: "plains", destinationTab: "raids", entityId: String(raidId), dedupeKey: `raid:${raidId}:incoming`, createdAt: now,
    });
  }

  await insertGameEvent(ctx, {
    kind: "raid",
    text: `${attacker.name} launched a raid.`,
    createdAt: now,
  });

  await ctx.scheduler.runAt(arriveAt, internal.raids.resolveRaid, { raidId });

  return {
    raidId,
    arriveAt,
    travelMinutes: Math.round((arriveAt - departAt) / 60000),
    power,
    speed,
  };
}

export const launchOpenAcreRaid = mutation({
  args: {
    acres: v.number(),
    units: unitCountsValidator,
    conclaveId: v.optional(v.id("ardentConclaves")),
  },
  handler: async (ctx, args) => {
    await requireCurrentPlayer(ctx);
    throw new Error("Open-acre raids are a legacy mission type and are no longer available.");
  },
});

export const launchSphereRaid = mutation({
  args: {
    units: unitCountsValidator,
    conclaveId: v.optional(v.id("ardentConclaves")),
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    return await createRaid(ctx, {
      attackerId: attacker._id,
      targetType: "parshendi_spheres",
      units: args.units,
      conclaveId: args.conclaveId,
    });
  },
});

export const launchDeepPlainsRaid = mutation({
  args: {
    units: unitCountsValidator,
    conclaveId: v.optional(v.id("ardentConclaves")),
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    return await createRaid(ctx, {
      attackerId: attacker._id,
      targetType: "deep_plains",
      units: args.units,
      conclaveId: args.conclaveId,
    });
  },
});

export const launchPlayerRaid = mutation({
  args: {
    targetPlayerId: v.id("players"),
    acres: v.number(),
    units: unitCountsValidator,
    conclaveId: v.optional(v.id("ardentConclaves")),
  },
  handler: async (ctx, args) => {
    await requireCurrentPlayer(ctx);
    throw new Error("PvP raids are not available. Use plateau sieges to contest another kingdom.");
  },
});

export const listVisibleRaids = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);

    const pending = await ctx.db
      .query("raids")
      .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
      .collect();

    return pending.filter((raid) => {
      const watchtower = viewer.buildings.watchtower ?? 0;
      if (raid.attackerId === viewer._id) return true;
      if (
        (raid.targetType === "open_acres" ||
          raid.targetType === "parshendi_spheres") &&
        watchtower >= 1
      ) {
        return true;
      }
      if (raid.targetPlayerId === viewer._id && watchtower >= 3) return true;
      if (watchtower >= 5) return true;
      return false;
    });
  },
});

export const forceResolveRaid = mutation({
  args: {
    raidId: v.id("raids"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
      raidId: args.raidId,
    });
    return { scheduled: true };
  },
});

export const forceResolveAllRaids = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("raids")
      .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
      .take(100);

    for (const raid of pending) {
      await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
        raidId: raid._id,
      });
    }

    return { scheduled: pending.length };
  },
});

export const resolveRaid = internalMutation({
  args: {
    raidId: v.id("raids"),
  },
  handler: async (ctx, args) => {
    const raid = await ctx.db.get(args.raidId);
    if (!raid || raid.status === "resolved") {
      return { resolved: false };
    }

    const attacker = await ctx.db.get(raid.attackerId);
    if (!attacker) {
      await ctx.db.patch(raid._id, {
        status: "resolved",
        resolvedAt: Date.now(),
      });
      return { resolved: false };
    }

    const now = Date.now();
    const completed = await completedResearch(ctx, attacker._id);
    let won = false;
    let resultText = "";
    let survivors = raid.units;
    let spheresRecovered = 0;

    if (raid.targetType === "open_acres") {
      const world = await ctx.db
        .query("gameState")
        .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
        .unique();
      const acres = Math.min(raid.acres ?? 1, world?.openAcres ?? 0);
      const defense =
        COMBAT_RULES.openDefenseBase + acres * COMBAT_RULES.openDefensePerAcre;
      won = raid.power >= defense && acres > 0;
      const lossResult = applySurvivalLosses(
        normalizeUnits(raid.units),
        baseCasualtyRate(raid.power, defense),
        `${raid._id}:open:${now}`,
        completed,
        Boolean(raid.conclaveId),
      );
      survivors = lossResult.survivors;

      if (won && world) {
        await ctx.db.patch(world._id, { openAcres: world.openAcres - acres });
        await ctx.db.patch(attacker._id, {
          acres: attacker.acres + acres,
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        resultText = `${attacker.name} won ${acres} open acres.`;
      } else {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        resultText = `${attacker.name} failed an open-acre raid.`;
      }
    }

    if (raid.targetType === "parshendi_spheres" || raid.targetType === "deep_plains") {
      const defense =
        raid.defensePower ?? COMBAT_RULES.parshendiSphereRaidMaxDefense;
      const reward =
        raid.rewardSpheres ?? COMBAT_RULES.parshendiSphereRaidMinReward;
      won = raid.power >= defense;
      const lossResult = applySurvivalLosses(
        normalizeUnits(raid.units),
        Math.min(ARMY_RULES.maximumFinalCasualtyRate, baseCasualtyRate(raid.power, defense) + (raid.targetType === "deep_plains" ? WORLD_PRESSURE_RULES.deepPlains.casualtyRateBonus : 0)),
        `${raid._id}:${raid.targetType}:${now}`,
        completed,
        Boolean(raid.conclaveId),
      );
      survivors = lossResult.survivors;
      const plunder = unitPlunder(normalizeUnits(raid.units), completed, Boolean(raid.conclaveId));
      const recovered = won ? Math.min(reward, plunder) : 0;
      spheresRecovered = recovered;
      const gemheartFound = raid.targetType === "deep_plains" && won &&
        seededFraction(`${raid._id}:deep-plains:gemheart`) < WORLD_PRESSURE_RULES.deepPlains.gemheartChance;
      const leftBehind = won ? Math.max(0, reward - recovered) : 0;

      await ctx.db.patch(attacker._id, {
        spheres: attacker.spheres + recovered,
        gemhearts: attacker.gemhearts + (gemheartFound ? 1 : 0),
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
      resultText = won
        ? `${attacker.name} overcame ${resistanceLabel(defense).toLowerCase()} resistance and recovered ${recovered} spheres from a ${rewardLabel(reward).toLowerCase()} cache.${leftBehind > 0 ? " Some spheres were left behind because the army lacked Plunder." : ""}${gemheartFound ? " The army returned with 1 Gemheart." : ""} Casualties: ${casualtySummary(lossResult.casualties)}.`
        : `${attacker.name} failed against ${resistanceLabel(defense).toLowerCase()} resistance during ${raid.targetType === "deep_plains" ? "a Deep Plains Raid" : "a sphere raid"}. Casualties: ${casualtySummary(lossResult.casualties)}.`;
      if (won) {
        await applyHostility(ctx, {
          playerId: attacker._id,
          gain: raid.targetType === "deep_plains"
            ? WORLD_PRESSURE_RULES.hostility.gains.deepPlainsVictory
            : WORLD_PRESSURE_RULES.hostility.gains.neutralRaidVictory,
          playerInitiated: false,
          now,
        });
      }
      if (gemheartFound) {
        await createNotification(ctx, {
          playerId: attacker._id, category: "missions", eventType: "deep_plains_gemheart",
          title: "Gemheart Found", body: "Your Deep Plains force returned with a Gemheart.",
          destinationView: "plains", destinationTab: "raids", entityId: String(raid._id), dedupeKey: `raid:${raid._id}:gemheart`, createdAt: now,
        });
      }
      await ctx.db.patch(raid._id, { gemheartFound });
    }

    if (raid.targetType === "player") {
      const defender = raid.targetPlayerId
        ? await ctx.db.get(raid.targetPlayerId)
        : null;
      if (!defender) {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, raid.units),
          lastActiveAt: now,
        });
        resultText = `${attacker.name}'s raid found no target.`;
      } else {
        const defenderCompleted = await completedResearch(ctx, defender._id);
        const homePower = effectivePower(defender.units, defenderCompleted);
        const acres = Math.min(raid.acres ?? 1, Math.max(0, defender.acres - 1));
        won = raid.power > homePower && acres > 0;
        const attackerLossResult = applySurvivalLosses(
          normalizeUnits(raid.units),
          baseCasualtyRate(raid.power, homePower),
          `${raid._id}:player:attacker:${now}`,
          completed,
          Boolean(raid.conclaveId),
        );
        survivors = attackerLossResult.survivors;
        const defenderLossResult = applySurvivalLosses(
          normalizeUnits(defender.units),
          baseCasualtyRate(homePower, raid.power),
          `${raid._id}:player:defender:${now}`,
          defenderCompleted,
        );

        await ctx.db.patch(attacker._id, {
          acres: attacker.acres + (won ? acres : 0),
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        await ctx.db.patch(defender._id, {
          acres: defender.acres - (won ? acres : 0),
          units: defenderLossResult.survivors,
          lastActiveAt: now,
        });

        const attackerReportLevel = won ? 2 : 1;
        await recordKingdomReport(ctx, {
          viewerPlayerId: attacker._id,
          target: defender,
          source: "player_raid",
          level: attackerReportLevel,
          observedAt: now,
        });
        const defenderIntelLevel = await currentKingdomIntelLevel(
          ctx,
          defender._id,
          attacker,
          now,
        );

        await ctx.db.insert("messages", {
          toPlayerId: defender._id,
          kind: "system",
          subject: won ? "Raid Lost" : "Defense Held",
          body: `${won ? `${attacker.name} seized ${acres} acres from your warcamp.` : `Your warcamp held against ${attacker.name}.`} Your casualties: ${casualtySummary(defenderLossResult.casualties)}. ${casualtyIntelSummary(attackerLossResult.casualties, defenderIntelLevel)} Intelligence reflects what your warcamp could confirm.`,
          eventType: "raid_resolved_defender", destinationView: "plains", destinationTab: "raids", entityType: "raid", entityId: String(raid._id),
          createdAt: now,
        });
        await createNotification(ctx, {
          playerId: defender._id, category: "combat", eventType: "raid_resolved_defender",
          title: won ? "Raid Lost" : "Defense Held",
          body: won ? `${attacker.name} seized ${acres} acres.` : `Your warcamp held against ${attacker.name}.`,
          destinationView: "plains", destinationTab: "raids", entityId: String(raid._id), dedupeKey: `raid:${raid._id}:resolved:defender`, createdAt: now,
        });
        resultText = won
          ? `${attacker.name} seized ${acres} acres from ${defender.name}. Your casualties: ${casualtySummary(attackerLossResult.casualties)}. ${casualtyIntelSummary(defenderLossResult.casualties, attackerReportLevel)} A new assessment is available in Intelligence.`
          : `${defender.name} held against ${attacker.name}. Your casualties: ${casualtySummary(attackerLossResult.casualties)}. ${casualtyIntelSummary(defenderLossResult.casualties, attackerReportLevel)} A new assessment is available in Intelligence.`;
      }
    }

    const baseConclaveXp = won ? missionXpBudget(raid.defensePower ?? raid.power) : Math.ceil(missionXpBudget(raid.defensePower ?? raid.power) / 2);
    const awardedConclaveXp = raid.conclaveId ? await releaseConclave(ctx, raid.conclaveId, baseConclaveXp) : undefined;
    if ((raid.targetType === "parshendi_spheres" || raid.targetType === "deep_plains") && won && spheresRecovered > 0 && raid.scoringSeasonId) {
      await awardSeasonPoints(ctx, {
        seasonId: raid.scoringSeasonId,
        playerId: attacker._id,
        category: "military",
        sourceType: "parshendi_raid_victory",
        sourceKey: `raid:${raid._id}:victory`,
        basePoints: SEASON_SCORING_RULES.military.parshendiRaidVictory,
        description: `Recovered ${spheresRecovered} Spheres from a successful Parshendi raid`,
        entityType: "raid",
        entityId: String(raid._id),
        now,
      });
    }
    await ctx.db.patch(raid._id, {
      status: "resolved",
      resolvedAt: now,
      conclaveXpAwarded: awardedConclaveXp,
      spheresRecovered,
    });
    await ctx.db.insert("messages", {
      toPlayerId: attacker._id,
      kind: "system",
      subject: won ? "Raid Won" : "Raid Resolved",
      body: resultText,
      eventType: "raid_resolved_attacker", destinationView: "plains", destinationTab: "raids", entityType: "raid", entityId: String(raid._id),
      createdAt: now,
    });
    await createNotification(ctx, {
      playerId: attacker._id, category: raid.targetType === "player" ? "combat" : "missions",
      eventType: raid.targetType === "player" ? "raid_resolved_attacker" : "mission_resolved",
      title: won ? "Raid Won" : "Raid Resolved", body: resultText, destinationView: "plains", destinationTab: "raids",
      entityId: String(raid._id), dedupeKey: `raid:${raid._id}:resolved:attacker`, createdAt: now,
    });
    await insertGameEvent(ctx, {
      kind: "raid",
      text: raid.targetType === "player"
        ? `${attacker.name}'s raid ${won ? "succeeded" : "was repelled"}.`
        : resultText,
      createdAt: now,
    });

    return { resolved: true, won, resultText };
  },
});
