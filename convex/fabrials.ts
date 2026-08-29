import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { FABRIAL_KEYS, FABRIAL_RULES } from "./fabrialRules";
import { evaluateFabrialDiscoveries, fabrialInventoryRow, publicInventory } from "./fabrialHelpers";
import { requireCurrentPlayer } from "./ownership";

const fabrialKey = v.union(v.literal("painrial"), v.literal("soulcaster"), v.literal("halfShard"));

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const rows = await ctx.db.query("playerFabrials").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).collect();
    const inventory = rows.map((row) => ({ ...publicInventory(row), ...FABRIAL_RULES[row.kind] }));
    return { hasDiscovery: inventory.length > 0, inventory };
  },
});

export const fabricate = mutation({
  args: { kind: fabrialKey },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const settled = await settlePlayerEconomy(ctx, player);
    const current = settled.player;
    const row = await fabrialInventoryRow(ctx, player._id, args.kind);
    if (!row) throw new Error("That Fabrial has not been discovered.");
    const rule = FABRIAL_RULES[args.kind];
    if (current.spheres < rule.sphereCost) throw new Error(`${rule.sphereCost.toLocaleString()} Spheres required.`);
    if (current.gemhearts < rule.gemheartCost) throw new Error(`${rule.gemheartCost} Gemheart${rule.gemheartCost === 1 ? "" : "s"} required.`);
    const now = Date.now();
    await ctx.db.patch(current._id, { spheres: current.spheres - rule.sphereCost, gemhearts: current.gemhearts - rule.gemheartCost, lastActiveAt: now });
    await ctx.db.patch(row._id, { owned: row.owned + rule.batchSize, updatedAt: now });
    return { kind: args.kind, fabricated: rule.batchSize, owned: row.owned + rule.batchSize };
  },
});

export const backfillDiscoveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").take(500);
    let updatedPlayers = 0;
    let prototypesGranted = 0;
    const discoveries: Record<string, number> = Object.fromEntries(FABRIAL_KEYS.map((key) => [key, 0]));
    for (const player of players) {
      const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).unique();
      if (!research) continue;
      const added = await evaluateFabrialDiscoveries(ctx, player._id, research.completedLevels);
      if (added.length > 0) updatedPlayers += 1;
      prototypesGranted += added.length;
      for (const kind of added) discoveries[kind] += 1;
    }
    return { checkedPlayers: players.length, updatedPlayers, prototypesGranted, discoveries };
  },
});
