import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  createBalancedHomePlateaus,
  createSeasonNeutralPlateaus,
} from "./plateauHelpers";
import {
  emptyBuildings,
  emptyUnits,
  STARTING_RULES,
  WORLD_KEY,
} from "./rules";

type AnyCtx = QueryCtx | MutationCtx;
type GameplayTable =
  | "plateauCommitments"
  | "plateauRuns"
  | "raids"
  | "sieges"
  | "plateaus"
  | "messages"
  | "gameEvents"
  | "gameState";

declare const process: {
  env: Record<string, string | undefined>;
};

function configuredAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function configuredDashboardAdminKey() {
  return process.env.ADMIN_DASHBOARD_KEY?.trim() ?? "";
}

async function currentAdminIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const tokenEmail = identity?.email?.toLowerCase() ?? null;
  const authUserId = await getAuthUserId(ctx);
  const authUser = authUserId ? await ctx.db.get(authUserId) : null;
  const userEmail = authUser?.email?.toLowerCase() ?? null;

  return {
    authUserId,
    email: userEmail ?? tokenEmail,
  };
}

export async function requireAdmin(ctx: AnyCtx) {
  const { email } = await currentAdminIdentity(ctx);
  const admins = configuredAdminEmails();

  if (!email || !admins.includes(email)) {
    throw new Error("Admin access required.");
  }

  return { email };
}

function requireDashboardAdminKey(adminKey: string) {
  const configuredKey = configuredDashboardAdminKey();
  if (!configuredKey) {
    throw new Error("Set ADMIN_DASHBOARD_KEY before using dashboard admin tools.");
  }
  if (adminKey !== configuredKey) {
    throw new Error("Invalid dashboard admin key.");
  }
}

async function deleteGameplayTable(ctx: MutationCtx, table: GameplayTable) {
  let deleted = 0;

  while (true) {
    const rows = await ctx.db.query(table).take(100);
    if (rows.length === 0) break;

    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }

  return deleted;
}

async function performWorldResetKeepAccounts(ctx: MutationCtx) {
  const now = Date.now();
  const players = await ctx.db.query("players").take(200);
  const deleted = {
    plateauCommitments: await deleteGameplayTable(ctx, "plateauCommitments"),
    plateauRuns: await deleteGameplayTable(ctx, "plateauRuns"),
    raids: await deleteGameplayTable(ctx, "raids"),
    sieges: await deleteGameplayTable(ctx, "sieges"),
    plateaus: await deleteGameplayTable(ctx, "plateaus"),
    messages: await deleteGameplayTable(ctx, "messages"),
    gameEvents: await deleteGameplayTable(ctx, "gameEvents"),
    gameState: await deleteGameplayTable(ctx, "gameState"),
  };

  const worldId = await ctx.db.insert("gameState", {
    key: WORLD_KEY,
    openAcres: players.length * STARTING_RULES.openAcresPerNewPlayer,
    createdAt: now,
    updatedAt: now,
  });

  for (const player of players) {
    await ctx.db.patch(player._id, {
      acres: STARTING_RULES.acres,
      spheres: STARTING_RULES.spheres,
      gemhearts: STARTING_RULES.gemhearts,
      units: emptyUnits(),
      buildings: emptyBuildings(),
      lastEconomyAt: now,
      lastActiveAt: now,
      createdAt: now,
    });

    await ctx.db.insert("messages", {
      toPlayerId: player._id,
      kind: "system",
      subject: "World reset",
      body:
        "The playtest world was reset. Your login and warcamp name were kept, and your kingdom has a fresh balanced Home Plateau package.",
      createdAt: now,
    });
  }

  const homeSeed = await createBalancedHomePlateaus(
    ctx,
    players.map((player) => player._id),
    now,
  );
  const neutralSeed = await createSeasonNeutralPlateaus(ctx, players.length, now);

  await ctx.db.insert("gameEvents", {
    text: `World reset. ${players.length} warcamps kept their accounts and received fresh starter kingdoms.`,
    createdAt: now,
  });

  return {
    reset: true,
    worldId,
    playersReset: players.length,
    homePlateausCreated: homeSeed.created,
    neutralPlateausCreated: neutralSeed.totalNeutral,
    gemheartPlateausCreated: neutralSeed.gemhearts,
    deleted,
  };
}

async function pendingOperations(ctx: AnyCtx) {
  const players = await ctx.db.query("players").take(200);
  const playerNames = Object.fromEntries(
    players.map((player) => [player._id, player.name]),
  );
  const plateaus = await ctx.db.query("plateaus").take(200);
  const plateauNames = Object.fromEntries(
    plateaus.map((plateau) => [plateau._id, plateau.name]),
  );
  const raids = await ctx.db
    .query("raids")
    .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
    .take(100);
  const sieges = await ctx.db
    .query("sieges")
    .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
    .take(100);
  const plateauRuns = await ctx.db
    .query("plateauRuns")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .take(25);

  return {
    raids: raids.map((raid) => ({
      id: raid._id,
      attackerName: playerNames[raid.attackerId] ?? "Unknown",
      targetType: raid.targetType,
      targetPlayerName: raid.targetPlayerId
        ? playerNames[raid.targetPlayerId] ?? "Unknown"
        : null,
      power: raid.power,
      speed: raid.speed,
      arrivesAt: raid.arriveAt,
    })),
    sieges: sieges.map((siege) => ({
      id: siege._id,
      plateauId: siege.plateauId,
      plateauName: plateauNames[siege.plateauId] ?? "Unknown plateau",
      attackerName: playerNames[siege.attackerId] ?? "Unknown",
      defenderName: siege.defenderId
        ? playerNames[siege.defenderId] ?? "Parshendi"
        : "Parshendi",
      targetType: siege.targetType,
      attackerPower: siege.attackerPower,
      attackerSpeed: siege.attackerSpeed,
      fortifyPercent: siege.fortifyPercent,
      resolvesAt: siege.resolveAt,
    })),
    plateauRuns: plateauRuns.map((run) => ({
      id: run._id,
      difficulty: run.difficulty,
      spherePool: run.spherePool,
      gemheartReward: run.gemheartReward,
      opensAt: run.opensAt,
      closesAt: run.closesAt,
    })),
  };
}

async function scheduleAllPendingOperations(ctx: MutationCtx) {
  const raids = await ctx.db
    .query("raids")
    .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
    .take(100);
  const sieges = await ctx.db
    .query("sieges")
    .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
    .take(100);
  const plateauRuns = await ctx.db
    .query("plateauRuns")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .take(25);

  for (const raid of raids) {
    await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
      raidId: raid._id,
    });
  }
  for (const siege of sieges) {
    await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
      siegeId: siege._id,
    });
  }
  for (const plateauRun of plateauRuns) {
    await ctx.scheduler.runAfter(0, internal.plateauRuns.resolvePlateauRun, {
      plateauRunId: plateauRun._id,
    });
  }

  return {
    raids: raids.length,
    sieges: sieges.length,
    plateauRuns: plateauRuns.length,
    scheduled: raids.length + sieges.length + plateauRuns.length,
  };
}

async function scheduleOperation(
  ctx: MutationCtx,
  target:
    | { kind: "raid"; raidId: Id<"raids"> }
    | { kind: "siege"; siegeId: Id<"sieges"> }
    | { kind: "plateau_run"; plateauRunId: Id<"plateauRuns"> },
) {
  if (target.kind === "raid") {
    await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
      raidId: target.raidId,
    });
  }

  if (target.kind === "siege") {
    await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
      siegeId: target.siegeId,
    });
  }

  if (target.kind === "plateau_run") {
    await ctx.scheduler.runAfter(0, internal.plateauRuns.resolvePlateauRun, {
      plateauRunId: target.plateauRunId,
    });
  }

  return { scheduled: true, kind: target.kind };
}

export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const { authUserId, email } = await currentAdminIdentity(ctx);
    return {
      email,
      signedIn: Boolean(authUserId),
      isAdmin: Boolean(email && configuredAdminEmails().includes(email)),
    };
  },
});

export const listPendingOperations = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await pendingOperations(ctx);
  },
});

export const listPendingOperationsFromDashboard = query({
  args: {
    adminKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireDashboardAdminKey(args.adminKey);
    return await pendingOperations(ctx);
  },
});

export const forceResolveOperation = mutation({
  args: {
    target: v.union(
      v.object({
        kind: v.literal("raid"),
        raidId: v.id("raids"),
      }),
      v.object({
        kind: v.literal("siege"),
        siegeId: v.id("sieges"),
      }),
      v.object({
        kind: v.literal("plateau_run"),
        plateauRunId: v.id("plateauRuns"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await scheduleOperation(ctx, args.target);
  },
});

export const forceResolveOperationFromDashboard = mutation({
  args: {
    adminKey: v.string(),
    target: v.union(
      v.object({
        kind: v.literal("raid"),
        raidId: v.id("raids"),
      }),
      v.object({
        kind: v.literal("siege"),
        siegeId: v.id("sieges"),
      }),
      v.object({
        kind: v.literal("plateau_run"),
        plateauRunId: v.id("plateauRuns"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireDashboardAdminKey(args.adminKey);
    return await scheduleOperation(ctx, args.target);
  },
});

export const forceResolveAllOperations = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await scheduleAllPendingOperations(ctx);
  },
});

export const forceResolveAllOperationsFromDashboard = mutation({
  args: {
    adminKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireDashboardAdminKey(args.adminKey);
    return await scheduleAllPendingOperations(ctx);
  },
});

export const resetWorldKeepAccounts = mutation({
  args: {
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.confirm !== "RESET WORLD") {
      throw new Error('Type "RESET WORLD" to confirm this reset.');
    }

    return await performWorldResetKeepAccounts(ctx);
  },
});
