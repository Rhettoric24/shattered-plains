import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { insertGameEvent } from "./eventHelpers";
import { requireCurrentPlayer } from "./ownership";
import {
  plateauAttributeCountsForPlayer,
  plateauCountsForPlayer,
} from "./plateauHelpers";
import { ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import {
  BUILDING_RULES,
  ARDENTIA_RULES,
  calculateBuildingStats,
  doctrineCostMultiplier,
  getBuildingCost,
  pendingEconomy,
  researchEffect,
} from "./rules";
import { completedResearch } from "./researchHelpers";
import { awardSeasonPoints } from "./seasonLedger";
import { SEASON_SCORING_RULES } from "./seasonScoringRules";

const buildingKey = v.union(
  v.literal("market"),
  v.literal("watchtower"),
  v.literal("ardentMonastery"),
  v.literal("barracks"),
  v.literal("soulcastBunker"),
);

type BuildingKey = keyof typeof BUILDING_RULES;

function decorateBuildings(buildings: Record<BuildingKey, number>) {
  return Object.fromEntries(
    (Object.keys(BUILDING_RULES) as BuildingKey[]).map((key) => {
      const level = buildings[key] ?? 0;
      return [
        key,
        {
          ...BUILDING_RULES[key],
          level,
          nextCost: getBuildingCost(key, level),
        },
      ];
    }),
  );
}

export const getBuildings = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const plateauAttributes = await plateauAttributeCountsForPlayer(ctx, player._id);
    const ownedUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const completed = await completedResearch(ctx, player._id);
    const effects = calculateBuildingStats(
      player.acres,
      player.buildings,
      plateauCounts,
      completed,
    );
    const pending = pendingEconomy({ ...player, plateauCounts, completedResearch: completed }, Date.now());

    return {
      spheres: player.spheres,
      effectiveSpheres: player.spheres + pending.income,
      pendingIncome: pending.income,
      buildings: decorateBuildings(player.buildings),
      monasteryAncientPlateausRequired: ARDENTIA_RULES.monasteryAncientPlateausRequired,
      ancientPlateausOwned: plateauCounts.ancient,
      effects: {
        baseKingdomIncomePerDay: effects.baseKingdomIncomePerDay,
        marketIncomePerDay: effects.marketIncomePerDay,
        plateauIncomePerDay: effects.acreIncomePerDay,
        passiveIncomeBeforeMultiplier: effects.passiveIncomeBeforeMultiplier,
        sphereBonusPercent: effects.sphereBonusPercent,
        sphereBonusIncomePerDay: effects.sphereBonusIncomePerDay,
        totalIncomePerDay: effects.totalIncomePerDay,
        barracksLevel: effects.barracksLevel,
        soulcastBunkerLevel: effects.soulcastBunkerLevel,
        soulcastBunkerCapacity: effects.soulcastBunkerCapacity,
        provisions: provisionsStatus(
          player.buildings,
          plateauCounts,
          ownedUnits,
          plateauAttributes.large,
          player.ardentiaConclaves ?? 0,
        ),
      },
    };
  },
});

export const upgradeBuilding = mutation({
  args: {
    building: buildingKey,
  },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const { player: settledPlayer } = await settlePlayerEconomy(ctx, player);
    const rule = BUILDING_RULES[args.building];
    const currentLevel = settledPlayer.buildings[args.building] ?? 0;
    if ("maxLevel" in rule && currentLevel >= rule.maxLevel) {
      throw new Error(`${rule.name} has reached its maximum level.`);
    }
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    if (args.building === "ardentMonastery" && plateauCounts.ancient < ARDENTIA_RULES.monasteryAncientPlateausRequired) {
      throw new Error(`Own ${ARDENTIA_RULES.monasteryAncientPlateausRequired} Ancient Plateaus before constructing or upgrading the Ardent Monastery.`);
    }
    const completed = await completedResearch(ctx, player._id);
    const baseCost = getBuildingCost(args.building, currentLevel);
    const cost = Math.round(baseCost * (1 - Number(researchEffect(completed, "soulcasting")) / 100) * doctrineCostMultiplier(completed, "building"));

    if (settledPlayer.spheres < cost) {
      throw new Error(
        `Not enough spheres. ${rule.name} level ${currentLevel + 1} costs ${cost}.`,
      );
    }

    const now = Date.now();
    const buildings = {
      ...settledPlayer.buildings,
      [args.building]: currentLevel + 1,
    };

    await ctx.db.patch(settledPlayer._id, {
      buildings,
      spheres: settledPlayer.spheres - cost,
      lastActiveAt: now,
    });

    await awardSeasonPoints(ctx, {
      playerId: settledPlayer._id, category: "economy", sourceType: "building_upgrade",
      sourceKey: `building:${args.building}:level:${currentLevel + 1}`,
      basePoints: SEASON_SCORING_RULES.economy.buildingPoints[args.building],
      description: `${rule.name} upgraded to level ${currentLevel + 1}`, entityType: "building", entityId: args.building, now,
    });

    await insertGameEvent(ctx, {
      kind: "warcamp",
      text: `${settledPlayer.name} upgraded ${rule.name} to level ${currentLevel + 1}.`,
      createdAt: now,
    });

    return {
      building: args.building,
      level: currentLevel + 1,
      cost,
      remainingSpheres: settledPlayer.spheres - cost,
      buildings: decorateBuildings(buildings),
    };
  },
});
