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
  calculateArmyStats,
  normalizeUnits,
  pendingEconomy,
  trainingDiscount,
  UNIT_RULES,
} from "./rules";

const unitKey = v.union(
  v.literal("bridgeman"),
  v.literal("spearman"),
  v.literal("chull"),
  v.literal("scout"),
  v.literal("heavy"),
  v.literal("shardbearer"),
);

export const getArmy = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const plateauAttributes = await plateauAttributeCountsForPlayer(ctx, player._id);
    const pending = pendingEconomy({ ...player, plateauCounts }, Date.now());
    const ownedUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const provisions = provisionsStatus(
      player.buildings,
      plateauCounts,
      ownedUnits,
      plateauAttributes.large,
    );

    return {
      units: player.units,
      ownedUnits,
      buildings: player.buildings,
      spheres: player.spheres,
      effectiveSpheres: player.spheres + pending.income,
      pendingIncome: pending.income,
      gemhearts: player.gemhearts,
      stats: calculateArmyStats(player.units),
      unitRules: UNIT_RULES,
      plateauCounts,
      plateauAttributes,
      trainingDiscount: trainingDiscount(plateauCounts),
      provisions,
    };
  },
});

export const trainUnit = mutation({
  args: {
    unit: unitKey,
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const { player: settledPlayer } = await settlePlayerEconomy(ctx, player);
    const count = Math.floor(args.count);
    if (count < 1) {
      throw new Error("Train at least one unit.");
    }

    const rule = UNIT_RULES[args.unit];
    if (!rule.active) {
      throw new Error(`${rule.name} is a legacy unit and cannot be trained right now.`);
    }
    const barracksLevel = settledPlayer.buildings.barracks ?? 0;
    if (barracksLevel < rule.barracksLevel) {
      throw new Error(`${rule.name} requires Barracks level ${rule.barracksLevel}.`);
    }

    const plateauCounts = await plateauCountsForPlayer(ctx, settledPlayer._id);
    const plateauAttributes = await plateauAttributeCountsForPlayer(
      ctx,
      settledPlayer._id,
    );
    const discount = trainingDiscount(plateauCounts);
    const sphereCost = Math.ceil(rule.cost * count * (1 - discount));
    const gemheartCost = (rule.gemheartCost ?? 0) * count;

    if (settledPlayer.spheres < sphereCost) {
      throw new Error(`Not enough spheres. Need ${sphereCost}.`);
    }

    if (settledPlayer.gemhearts < gemheartCost) {
      throw new Error(`Not enough gemhearts. Need ${gemheartCost}.`);
    }

    const units = normalizeUnits(settledPlayer.units);
    const ownedUnits = await ownedUnitsIncludingAway(
      ctx,
      settledPlayer._id,
      settledPlayer.units,
    );
    const nextOwnedUnits = normalizeUnits(ownedUnits);
    nextOwnedUnits[args.unit] += count;
    const provisions = provisionsStatus(
      settledPlayer.buildings,
      plateauCounts,
      nextOwnedUnits,
      plateauAttributes.large,
    );
    if (provisions.used > provisions.capacity) {
      throw new Error(
        `Not enough Provisions. This would use ${provisions.used}/${provisions.capacity}. Construct or upgrade a Soulcast Bunker to support a larger army.`,
      );
    }

    units[args.unit] += count;
    const now = Date.now();

    await ctx.db.patch(settledPlayer._id, {
      units,
      spheres: settledPlayer.spheres - sphereCost,
      gemhearts: settledPlayer.gemhearts - gemheartCost,
      lastActiveAt: now,
    });

    await ctx.db.insert("gameEvents", {
      text: `${settledPlayer.name} trained ${count} ${rule.name}${count === 1 ? "" : "s"}.`,
      createdAt: now,
    });

    return {
      trained: count,
      unit: args.unit,
      sphereCost,
      gemheartCost,
      remainingSpheres: settledPlayer.spheres - sphereCost,
      remainingGemhearts: settledPlayer.gemhearts - gemheartCost,
      units,
      stats: calculateArmyStats(units),
      provisions,
    };
  },
});
