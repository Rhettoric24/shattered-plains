import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { requireCurrentPlayer } from "./ownership";
import {
  plateauAttributeCountsForPlayer,
  plateauCountsForPlayer,
} from "./plateauHelpers";
import { ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import {
  BUILDING_RULES,
  calculateBuildingStats,
  getBuildingCost,
  pendingEconomy,
} from "./rules";

const buildingKey = v.union(
  v.literal("market"),
  v.literal("watchtower"),
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
    const effects = calculateBuildingStats(
      player.acres,
      player.buildings,
      plateauCounts,
    );
    const pending = pendingEconomy({ ...player, plateauCounts }, Date.now());

    return {
      spheres: player.spheres,
      effectiveSpheres: player.spheres + pending.income,
      pendingIncome: pending.income,
      buildings: decorateBuildings(player.buildings),
      effects: {
        baseKingdomIncomePerDay: effects.baseKingdomIncomePerDay,
        marketIncomePerDay: effects.marketIncomePerDay,
        plateauIncomePerDay: effects.acreIncomePerDay,
        passiveIncomeBeforeMultiplier: effects.passiveIncomeBeforeMultiplier,
        sphereBonusPercent: effects.sphereBonusPercent,
        sphereBonusIncomePerDay: effects.sphereBonusIncomePerDay,
        totalIncomePerDay: effects.totalIncomePerDay,
        watchtowerDefenseBonus: effects.watchtowerDefenseBonus,
        watchtowerDefensePercent: effects.watchtowerDefensePercent,
        barracksLevel: effects.barracksLevel,
        soulcastBunkerLevel: effects.soulcastBunkerLevel,
        soulcastBunkerCapacity: effects.soulcastBunkerCapacity,
        provisions: provisionsStatus(
          player.buildings,
          plateauCounts,
          ownedUnits,
          plateauAttributes.large,
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
    const cost = getBuildingCost(args.building, currentLevel);

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

    await ctx.db.insert("gameEvents", {
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
