import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const settings = await ctx.db
      .query("playerSettings")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .unique();
    const ancientPlateau = await ctx.db
      .query("plateaus")
      .withIndex("by_owner", (q) => q.eq("ownerPlayerId", player._id))
      .take(100);
    return {
      confirmConsequentialMissions: settings?.confirmConsequentialMissions ?? true,
      researchTeased: Boolean(
        player.researchTeasedAt ||
        ancientPlateau.some((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins") ||
        (player.buildings.ardentMonastery ?? 0) > 0,
      ),
    };
  },
});

export const update = mutation({
  args: { confirmConsequentialMissions: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const existing = await ctx.db
      .query("playerSettings")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    else await ctx.db.insert("playerSettings", { playerId: player._id, ...args, updatedAt: now });
    return args;
  },
});
