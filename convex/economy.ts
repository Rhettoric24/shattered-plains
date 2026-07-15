import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";
import { settlePlayerEconomy } from "./economyHelpers";
import { requireCurrentPlayer } from "./ownership";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { incomePerGameDay, pendingEconomy, TIME_RULES, WORLD_KEY } from "./rules";

export const getEconomyStatus = query({
  args: {},
  handler: async (ctx) => {
    const world = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
      .unique();
    const players = await ctx.db.query("players").collect();
    const now = Date.now();
    const elapsedMs = world ? Math.max(0, now - world.updatedAt) : 0;
    const elapsedGameDays = elapsedMs / TIME_RULES.realMsPerGameDay;

    const rows = [];
    for (const player of players) {
      const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
      const pending = pendingEconomy({ ...player, plateauCounts }, now);
      rows.push({
        playerId: player._id,
        name: player.name,
        spheres: player.spheres,
        incomePerGameDay: incomePerGameDay({ ...player, plateauCounts }),
        lastEconomyAt: pending.lastEconomyAt,
        elapsedGameDays: pending.elapsedGameDays,
        pendingIncome: pending.income,
        effectiveSpheres: player.spheres + pending.income,
      });
    }

    return {
      world,
      elapsedGameDays,
      players: rows,
    };
  },
});

export const settlePlayer = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const settled = await settlePlayerEconomy(ctx, player);
    await ctx.db.patch(player._id, { lastActiveAt: Date.now() });

    return {
      spheres: settled.player.spheres,
      earned: settled.pending.income,
      elapsedGameDays: settled.pending.elapsedGameDays,
      incomePerGameDay: settled.pending.incomePerGameDay,
    };
  },
});

export const advanceEconomy = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const world = await ctx.db
      .query("gameState")
      .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
      .unique();
    if (!world) {
      throw new Error("Create the world before advancing economy.");
    }

    const now = Date.now();
    const players = await ctx.db.query("players").collect();
    let totalEarned = 0;
    let maxElapsedGameDays = 0;

    for (const player of players) {
      const settled = await settlePlayerEconomy(ctx, player);
      totalEarned += settled.pending.income;
      maxElapsedGameDays = Math.max(
        maxElapsedGameDays,
        settled.pending.elapsedGameDays,
      );
    }

    await ctx.db.patch(world._id, { updatedAt: now });
    await ctx.db.insert("gameEvents", {
      text: `Economy settled for ${players.length} warcamps.`,
      createdAt: now,
    });

    return {
      elapsedGameDays: maxElapsedGameDays,
      updatedPlayers: players.length,
      totalEarned,
    };
  },
});
