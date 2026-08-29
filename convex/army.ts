import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { insertGameEvent } from "./eventHelpers";
import { requireCurrentPlayer } from "./ownership";
import {
  plateauAttributeCountsForPlayer,
  plateauCountsForPlayer,
} from "./plateauHelpers";
import { ownedOperativesIncludingAway, ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import {
  calculateArmyStats,
  doctrineCostMultiplier,
  doctrineFromResearch,
  normalizeUnits,
  pendingEconomy,
  trainingDiscount,
  UNIT_RULES,
} from "./rules";
import { completedResearch } from "./researchHelpers";

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
    const completed = await completedResearch(ctx, player._id);
    const plateauAttributes = await plateauAttributeCountsForPlayer(ctx, player._id);
    const pending = pendingEconomy({ ...player, plateauCounts }, Date.now());
    const ownedUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const ownedOperatives = await ownedOperativesIncludingAway(ctx, player._id, player.operatives, player.defendingOperatives);
    const provisions = provisionsStatus(
      player.buildings,
      plateauCounts,
      ownedUnits,
      plateauAttributes.large,
      player.ardentiaConclaves ?? 0,
      ownedOperatives,
    );

    return {
      units: player.units,
      ownedUnits,
      buildings: player.buildings,
      spheres: player.spheres,
      effectiveSpheres: player.spheres + pending.income,
      pendingIncome: pending.income,
      gemhearts: player.gemhearts,
      stats: calculateArmyStats(player.units, completed),
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
    const completed = await completedResearch(ctx, settledPlayer._id);
    const plateauAttributes = await plateauAttributeCountsForPlayer(
      ctx,
      settledPlayer._id,
    );
    const discount = trainingDiscount(plateauCounts);
    const sphereCost = Math.ceil(rule.cost * count * (1 - discount) * doctrineCostMultiplier(completed, "military"));
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
    const ownedOperatives = await ownedOperativesIncludingAway(ctx, settledPlayer._id, settledPlayer.operatives, settledPlayer.defendingOperatives);
    if (args.unit === "chull" && doctrineFromResearch(completed) === "gemheartBaron" && nextOwnedUnits.chull > 10) throw new Error("Gemheart Baron doctrine limits the kingdom to 10 owned Chulls.");
    const provisions = provisionsStatus(
      settledPlayer.buildings,
      plateauCounts,
      nextOwnedUnits,
      plateauAttributes.large,
      settledPlayer.ardentiaConclaves ?? 0,
      ownedOperatives,
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

    const trainedUnitName = count === 1
      ? rule.name
      : rule.name === "Bridgeman"
        ? "Bridgemen"
        : rule.name === "Spearman"
          ? "Spearmen"
          : `${rule.name}s`;

    await insertGameEvent(ctx, {
      kind: "warcamp",
      text: `${settledPlayer.name} trained ${count} ${trainedUnitName}.`,
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
      stats: calculateArmyStats(units, completed),
      provisions,
    };
  },
});

export const disbandUnits = mutation({
  args: { unit: unitKey, count: v.number() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const count = args.count;
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Disband between 1 and 1,000 available units.");
    if (args.unit === "shardbearer") throw new Error("Shardbearers cannot be disbanded.");
    const units = normalizeUnits(player.units);
    if (count > units[args.unit]) throw new Error(`Only ${units[args.unit]} ${UNIT_RULES[args.unit].name} are available to disband.`);
    units[args.unit] -= count;
    await ctx.db.patch(player._id, { units, lastActiveAt: Date.now() });
    return { disbanded: count, unit: args.unit, units, refundedSpheres: 0, refundedGemhearts: 0 };
  },
});
