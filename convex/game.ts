import { mutation, query } from "./_generated/server";
import { getGameClock, WORLD_KEY } from "./rules";

export const getWorldStatus = query({
  args: {},
  handler: async (ctx) => {
    const world = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
      .unique();
    const players = await ctx.db.query("players").collect();
    const openRaids = await ctx.db
      .query("raids")
      .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
      .collect();
    const openPlateauRuns = await ctx.db
      .query("plateauRuns")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    return {
      world,
      clock: world ? getGameClock(world.createdAt, Date.now()) : null,
      playerCount: players.length,
      pendingRaidCount: openRaids.length,
      openPlateauRunCount: openPlateauRuns.length,
    };
  },
});

export const bootstrapWorld = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
      .unique();

    if (existing) {
      return { created: false, worldId: existing._id };
    }

    const worldId = await ctx.db.insert("gameState", {
      key: WORLD_KEY,
      openAcres: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("gameEvents", {
      text: "Convex world created.",
      createdAt: now,
    });

    return { created: true, worldId };
  },
});

export const listEvents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("gameEvents")
      .withIndex("by_created")
      .order("desc")
      .take(80);
  },
});

export const getClock = query({
  args: {},
  handler: async (ctx) => {
    const world = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
      .unique();

    if (!world) {
      return null;
    }

    return getGameClock(world.createdAt, Date.now());
  },
});
