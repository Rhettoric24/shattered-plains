import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getCurrentPlayer, requireAuthUserId } from "./ownership";
import {
  createNeutralPlateaus,
  createSeasonNeutralPlateaus,
  createStarterPlateaus,
  neutralPlateaus,
  ownedPlateaus,
  plateauAttributeCountsForPlayer,
  plateauCountsForPlayer,
} from "./plateauHelpers";
import { ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import {
  calculateArmyStats,
  calculateBuildingStats,
  bridgedTravelReduction,
  emptyBuildings,
  emptyUnits,
  sphereIncomeBonus,
  pendingEconomy,
  STARTING_RULES,
  WORLD_KEY,
} from "./rules";

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

async function getMainWorld(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
    .unique();
}

async function createPlayerForAuth(
  ctx: MutationCtx,
  args: { name: string; authUserId?: string },
) {
  const now = Date.now();
  const displayName = args.name.trim();
  const normalizedName = normalizeName(displayName);

  if (displayName.length < 2) {
    throw new Error("Choose a warcamp name with at least 2 characters.");
  }

  const existingName = await ctx.db
    .query("players")
    .withIndex("by_normalized_name", (q) =>
      q.eq("normalizedName", normalizedName),
    )
    .unique();

  if (args.authUserId) {
    const existingAuthPlayer = await ctx.db
      .query("players")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
      .unique();

    if (existingAuthPlayer) {
      return { playerId: existingAuthPlayer._id };
    }

    if (existingName?.authUserId === args.authUserId) {
      return { playerId: existingName._id };
    }

  }

  if (existingName) {
    throw new Error("That warcamp name is already taken.");
  }

  let world = await getMainWorld(ctx);
  if (!world) {
    const worldId = await ctx.db.insert("gameState", {
      key: WORLD_KEY,
      openAcres: 0,
      createdAt: now,
      updatedAt: now,
    });
    world = await ctx.db.get(worldId);
  }

  if (!world) {
    throw new Error("Could not create the shared world.");
  }

  const newPlayer = {
    name: displayName,
    normalizedName,
    acres: STARTING_RULES.acres,
    spheres: STARTING_RULES.spheres,
    gemhearts: STARTING_RULES.gemhearts,
    units: emptyUnits(),
    buildings: emptyBuildings(),
    lastEconomyAt: now,
    lastActiveAt: now,
    createdAt: now,
    ...(args.authUserId ? { authUserId: args.authUserId } : {}),
  };

  const playerId = await ctx.db.insert("players", newPlayer);
  await createStarterPlateaus(ctx, playerId, now);
  const existingNeutralPlateaus = await neutralPlateaus(ctx);
  if (existingNeutralPlateaus.length === 0) {
    await createSeasonNeutralPlateaus(ctx, 1, now);
  } else {
    await createNeutralPlateaus(
      ctx,
      STARTING_RULES.neutralPlateausPerNewPlayer,
      now,
    );
  }

  await ctx.db.patch(world._id, {
    openAcres: world.openAcres + STARTING_RULES.openAcresPerNewPlayer,
    updatedAt: now,
  });

  await ctx.db.insert("messages", {
    toPlayerId: playerId,
    kind: "system",
    subject: "Welcome to the Shattered Plains",
    body:
      "Your warcamp has been founded with a balanced Home Plateau package, 1,200 spheres, and 1 Gemheart.",
    createdAt: now,
  });

  await ctx.db.insert("gameEvents", {
    text: `${displayName} founded a warcamp.`,
    createdAt: now,
  });

  return { playerId };
}

export const isNameAvailable = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedName = normalizeName(args.name);
    if (normalizedName.length < 2) {
      return { available: false, reason: "Name is too short." };
    }

    const existing = await ctx.db
      .query("players")
      .withIndex("by_normalized_name", (q) =>
        q.eq("normalizedName", normalizedName),
      )
      .unique();

    return {
      available: !existing,
      reason: existing ? "Name is already taken." : null,
    };
  },
});

export const createPlayer = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const authUserId = await requireAuthUserId(ctx);
    return await createPlayerForAuth(ctx, { name: args.name, authUserId });
  },
});

export const getPlayer = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentPlayer(ctx);
  },
});

export const getPlayerByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("players")
      .withIndex("by_normalized_name", (q) =>
        q.eq("normalizedName", normalizeName(args.name)),
      )
      .unique();
  },
});

async function buildDashboard(ctx: QueryCtx, player: any) {
  const world = await getMainWorld(ctx);
  const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
  const plateauAttributes = await plateauAttributeCountsForPlayer(ctx, player._id);
  const owned = await ownedPlateaus(ctx, player._id);
  const neutral = await neutralPlateaus(ctx);
  const incomingRaids = await ctx.db
    .query("raids")
    .withIndex("by_target_player", (q) => q.eq("targetPlayerId", player._id))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect();
  const outgoingRaids = await ctx.db
    .query("raids")
    .withIndex("by_attacker", (q) => q.eq("attackerId", player._id))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect();
  const unreadMessages = await ctx.db
    .query("messages")
    .withIndex("by_to_player", (q) => q.eq("toPlayerId", player._id))
    .collect();

  const pending = pendingEconomy({ ...player, plateauCounts }, Date.now());
  const ownedUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);

  return {
    player,
    effectiveSpheres: player.spheres + pending.income,
    pendingIncome: pending.income,
    world,
    plateauCounts,
    ownedPlateauCount: owned.length,
    neutralPlateauCount: neutral.filter((plateau) => !plateau.activeSiegeId)
      .length,
    armyStats: calculateArmyStats(player.units),
    provisions: provisionsStatus(
      player.buildings,
      plateauCounts,
      ownedUnits,
      plateauAttributes.large,
    ),
    plateauAttributes,
    plateauBonuses: {
      sphereIncomeBonusPercent: Math.round(sphereIncomeBonus(plateauCounts) * 100),
      bridgedTravelReductionPercent: Math.round(
        bridgedTravelReduction(plateauCounts) * 100,
      ),
    },
    buildingStats: calculateBuildingStats(
      player.acres,
      player.buildings,
      plateauCounts,
    ),
    incomingRaidCount: incomingRaids.length,
    outgoingRaidCount: outgoingRaids.length,
    unreadMessageCount: unreadMessages.filter((message) => !message.readAt)
      .length,
  };
}

export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const player = await getCurrentPlayer(ctx);
    if (!player) {
      return null;
    }
    return await buildDashboard(ctx, player);
  },
});

export const listPlayers = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    return players
      .map((player) => ({
        _id: player._id,
        name: player.name,
        acres: player.acres,
        lastActiveAt: player.lastActiveAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
