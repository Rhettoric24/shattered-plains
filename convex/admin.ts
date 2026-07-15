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

type AnyCtx = QueryCtx | MutationCtx;

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
