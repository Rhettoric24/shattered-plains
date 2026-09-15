import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import { unitCountsValidator } from "./armyRules";
import { emptyUnits, normalizeUnits } from "./rules";

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
      autoDefenseEnabled: settings?.autoDefenseEnabled ?? false,
      autoDefensePrimary: normalizeUnits(settings?.autoDefensePrimary ?? emptyUnits()),
      autoDefenseSecondary: normalizeUnits(settings?.autoDefenseSecondary ?? emptyUnits()),
      researchTeased: Boolean(
        player.researchTeasedAt ||
        ancientPlateau.some((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins") ||
        (player.buildings.ardentMonastery ?? 0) > 0,
      ),
    };
  },
});

export const update = mutation({
  args: {
    confirmConsequentialMissions: v.optional(v.boolean()),
    autoDefenseEnabled: v.optional(v.boolean()),
    autoDefensePrimary: v.optional(unitCountsValidator),
    autoDefenseSecondary: v.optional(unitCountsValidator),
  },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const existing = await ctx.db
      .query("playerSettings")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .unique();
    const now = Date.now();
    const updates = {
      ...(args.confirmConsequentialMissions !== undefined ? { confirmConsequentialMissions: args.confirmConsequentialMissions } : {}),
      ...(args.autoDefenseEnabled !== undefined ? { autoDefenseEnabled: args.autoDefenseEnabled } : {}),
      ...(args.autoDefensePrimary ? { autoDefensePrimary: normalizeUnits(args.autoDefensePrimary) } : {}),
      ...(args.autoDefenseSecondary ? { autoDefenseSecondary: normalizeUnits(args.autoDefenseSecondary) } : {}),
    };
    if (existing) await ctx.db.patch(existing._id, { ...updates, updatedAt: now });
    else await ctx.db.insert("playerSettings", {
      playerId: player._id,
      confirmConsequentialMissions: args.confirmConsequentialMissions ?? true,
      ...updates,
      updatedAt: now,
    });
    return {
      confirmConsequentialMissions: updates.confirmConsequentialMissions ?? existing?.confirmConsequentialMissions ?? true,
      autoDefenseEnabled: updates.autoDefenseEnabled ?? existing?.autoDefenseEnabled ?? false,
      autoDefensePrimary: normalizeUnits(updates.autoDefensePrimary ?? existing?.autoDefensePrimary ?? emptyUnits()),
      autoDefenseSecondary: normalizeUnits(updates.autoDefenseSecondary ?? existing?.autoDefenseSecondary ?? emptyUnits()),
    };
  },
});
