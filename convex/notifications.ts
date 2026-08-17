import { v } from "convex/values";
import { env, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { requireCurrentPlayer } from "./ownership";
import { createNotification } from "./notificationHelpers";

const categoryArgs = {
  combat: v.boolean(), missions: v.boolean(), research: v.boolean(),
  plateauRuns: v.boolean(), messages: v.boolean(),
};

const allowedPushHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
];

function validatePushSubscription(args: { endpoint: string; p256dh: string; auth: string }) {
  let url: URL;
  try { url = new URL(args.endpoint); } catch { throw new Error("Invalid push endpoint."); }
  const hostAllowed = allowedPushHosts.includes(url.hostname) || url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || !hostAllowed || args.endpoint.length > 2048) throw new Error("Unsupported push service.");
  const keyPattern = /^[A-Za-z0-9_-]+$/;
  if (!keyPattern.test(args.p256dh) || !keyPattern.test(args.auth) || args.p256dh.length > 256 || args.auth.length > 128) throw new Error("Invalid push subscription keys.");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const notifications = await ctx.db.query("notifications")
      .withIndex("by_playerId_and_createdAt", (q) => q.eq("playerId", player._id))
      .order("desc").take(50);
    const state = await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).unique();
    const subscriptions = await ctx.db.query("pushSubscriptions").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).take(20);
    return {
      notifications,
      unreadCount: state?.unreadCount ?? 0,
      preferences: {
        combat: state?.combat ?? true, missions: state?.missions ?? true,
        research: state?.research ?? true, plateauRuns: state?.plateauRuns ?? true,
        messages: state?.messages ?? true,
      },
      devices: subscriptions.filter((entry) => !entry.disabledAt).map((entry) => ({
        id: entry._id, endpoint: entry.endpoint, deviceLabel: entry.deviceLabel,
        soundEnabled: entry.soundEnabled, lastSeenAt: entry.lastSeenAt,
      })),
      vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    };
  },
});

export const getPushConfiguration = query({
  args: {},
  handler: async () => ({
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    configured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  }),
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const item = await ctx.db.get(args.notificationId);
    if (!item || item.playerId !== player._id) throw new Error("Notification not found.");
    if (item.readAt) return { readAt: item.readAt };
    const now = Date.now();
    await ctx.db.patch(item._id, { readAt: now });
    const state = await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).unique();
    if (state) await ctx.db.patch(state._id, { unreadCount: Math.max(0, state.unreadCount - 1), updatedAt: now });
    return { readAt: now };
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    return await markReadBatch(ctx, player._id);
  },
});

async function markReadBatch(ctx: MutationCtx, playerId: Id<"players">) {
  const rows = await ctx.db.query("notifications").withIndex("by_playerId_and_readAt", (q) => q.eq("playerId", playerId).eq("readAt", undefined)).take(100);
  const now = Date.now();
  for (const row of rows) await ctx.db.patch(row._id, { readAt: now });
  const state = await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
  if (state) await ctx.db.patch(state._id, { unreadCount: Math.max(0, state.unreadCount - rows.length), updatedAt: now });
  if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.notifications.markAllReadBatch, { playerId });
  return { updated: rows.length, continuing: rows.length === 100 };
}

export const markAllReadBatch = internalMutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => await markReadBatch(ctx, args.playerId),
});

export const updatePreferences = mutation({
  args: categoryArgs,
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const now = Date.now();
    const state = await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).unique();
    if (state) await ctx.db.patch(state._id, { ...args, updatedAt: now });
    else await ctx.db.insert("notificationState", { playerId: player._id, unreadCount: 0, ...args, updatedAt: now });
    return args;
  },
});

export const registerDevice = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), deviceLabel: v.string(), soundEnabled: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    validatePushSubscription(args);
    const now = Date.now();
    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint)).unique();
    if (existing) {
      if (existing.playerId !== player._id) throw new Error("This device is registered to another account. Sign out there first.");
      await ctx.db.patch(existing._id, { playerId: player._id, p256dh: args.p256dh, auth: args.auth, deviceLabel: args.deviceLabel.slice(0, 80), soundEnabled: args.soundEnabled, disabledAt: undefined, lastSeenAt: now });
      return { subscriptionId: existing._id };
    }
    const devices = await ctx.db.query("pushSubscriptions").withIndex("by_playerId", (q) => q.eq("playerId", player._id)).take(11);
    if (devices.filter((device) => !device.disabledAt).length >= 10) throw new Error("This account already has the maximum of 10 notification devices.");
    const subscriptionId = await ctx.db.insert("pushSubscriptions", { playerId: player._id, endpoint: args.endpoint, p256dh: args.p256dh, auth: args.auth, deviceLabel: args.deviceLabel.slice(0, 80), soundEnabled: args.soundEnabled, createdAt: now, lastSeenAt: now });
    return { subscriptionId };
  },
});

export const removeDevice = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint)).unique();
    if (existing && existing.playerId === player._id) await ctx.db.delete(existing._id);
    return { removed: Boolean(existing && existing.playerId === player._id) };
  },
});

export const setDeviceSound = mutation({
  args: { endpoint: v.string(), soundEnabled: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint)).unique();
    if (!existing || existing.playerId !== player._id) throw new Error("Device not found.");
    await ctx.db.patch(existing._id, { soundEnabled: args.soundEnabled, lastSeenAt: Date.now() });
    return { updated: true };
  },
});

export const deliveryData = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;
    const subscriptions = await ctx.db.query("pushSubscriptions").withIndex("by_playerId", (q) => q.eq("playerId", notification.playerId)).take(20);
    return { notification, subscriptions: subscriptions.filter((entry) => !entry.disabledAt) };
  },
});

export const disableSubscription = internalMutation({
  args: { subscriptionId: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (subscription) await ctx.db.patch(subscription._id, { disabledAt: Date.now() });
    return null;
  },
});

export const cleanupOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("notifications").order("asc").take(100);
    let removed = 0;
    for (const row of rows) if (row.createdAt < cutoff && row.readAt) { await ctx.db.delete(row._id); removed += 1; }
    return { removed };
  },
});

export const notifyPlateauRunOpenBatch = internalMutation({
  args: {
    plateauRunId: v.id("plateauRuns"),
    body: v.string(),
    createdAt: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("players").paginate(args.paginationOpts);
    for (const player of page.page) {
      const notification = await createNotification(ctx, {
        playerId: player._id, category: "plateau_runs", eventType: "plateau_run_open",
        title: "Plateau Run Open", body: args.body, destinationView: "plains", destinationTab: "plateau-runs",
        entityId: String(args.plateauRunId), dedupeKey: `plateau-run:${args.plateauRunId}:open`, createdAt: args.createdAt,
      });
      if (notification.created) await ctx.db.insert("messages", {
        toPlayerId: player._id, kind: "system", subject: "Plateau Run Open", body: args.body,
        eventType: "plateau_run_open", destinationView: "plains", destinationTab: "plateau-runs",
        entityType: "plateau_run", entityId: String(args.plateauRunId), createdAt: args.createdAt,
      });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.notifications.notifyPlateauRunOpenBatch, {
      plateauRunId: args.plateauRunId, body: args.body, createdAt: args.createdAt,
      paginationOpts: { numItems: args.paginationOpts.numItems, cursor: page.continueCursor },
    });
    return { processed: page.page.length, done: page.isDone };
  },
});
