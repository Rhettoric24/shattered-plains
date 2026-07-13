import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { requireCurrentPlayer } from "./ownership";
import { calculateArmyStats, pendingEconomy, UNIT_RULES } from "./rules";

const unitKey = v.union(
  v.literal("bridgeman"),
  v.literal("spearman"),
  v.literal("scout"),
  v.literal("heavy"),
  v.literal("shardbearer"),
);

export const getArmy = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const pending = pendingEconomy(player, Date.now());

    return {
      units: player.units,
      buildings: player.buildings,
      spheres: player.spheres,
      effectiveSpheres: player.spheres + pending.income,
      pendingIncome: pending.income,
      gemhearts: player.gemhearts,
      stats: calculateArmyStats(player.units),
      unitRules: UNIT_RULES,
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
    const barracksLevel = settledPlayer.buildings.barracks ?? 0;
    if (barracksLevel < rule.barracksLevel) {
      throw new Error(`${rule.name} requires Barracks level ${rule.barracksLevel}.`);
    }

    const sphereCost = rule.cost * count;
    const gemheartCost = (rule.gemheartCost ?? 0) * count;

    if (settledPlayer.spheres < sphereCost) {
      throw new Error(`Not enough spheres. Need ${sphereCost}.`);
    }

    if (settledPlayer.gemhearts < gemheartCost) {
      throw new Error(`Not enough gemhearts. Need ${gemheartCost}.`);
    }

    const units = {
      ...settledPlayer.units,
      [args.unit]: settledPlayer.units[args.unit] + count,
    };
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
    };
  },
});
