/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { api } from "./_generated/api";
import schema from "./schema";
import { createNotification } from "./notificationHelpers";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 1, barracks: 0, soulcastBunker: 0 };

async function addPlayer(t: ReturnType<typeof convexTest>, name: string, authUserId?: string) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    ...(authUserId ? { authUserId } : {}), name, normalizedName: name.toLowerCase(), acres: 10,
    spheres: 10_000, gemhearts: 3, units, buildings, lastActiveAt: Date.now(), createdAt: Date.now(),
  }));
}

describe("notifications", () => {
  test("deduplicates notification writes and maintains unread state", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Kholin");
    const first = await t.run((ctx) => createNotification(ctx, {
      playerId, category: "combat", eventType: "incoming_raid", title: "Incoming Raid",
      body: "A rival approaches.", destinationView: "raids", dedupeKey: "raid:one:incoming",
    }));
    const duplicate = await t.run((ctx) => createNotification(ctx, {
      playerId, category: "combat", eventType: "incoming_raid", title: "Incoming Raid",
      body: "A rival approaches.", destinationView: "raids", dedupeKey: "raid:one:incoming",
    }));
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    const result = await t.run(async (ctx) => ({
      rows: await ctx.db.query("notifications").collect(),
      state: await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
    }));
    expect(result.rows).toHaveLength(1);
    expect(result.state?.unreadCount).toBe(1);
  });

  test("exposes every active device to the delivery action", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Azish");
    const notification = await t.run((ctx) => createNotification(ctx, {
      playerId, category: "missions", eventType: "mission_resolved", title: "Mission Complete",
      body: "The army returned.", destinationView: "raids", dedupeKey: "mission:one",
    }));
    await t.run(async (ctx) => {
      for (const index of [1, 2]) await ctx.db.insert("pushSubscriptions", {
        playerId, endpoint: `https://push.example/${index}`, p256dh: `key-${index}`, auth: `auth-${index}`,
        deviceLabel: `Device ${index}`, soundEnabled: index === 1, createdAt: index, lastSeenAt: index,
      });
    });
    const delivery = await t.query(internal.notifications.deliveryData, { notificationId: notification.notificationId });
    expect(delivery?.subscriptions).toHaveLength(2);
    expect(delivery?.subscriptions.map((entry) => entry.soundEnabled)).toEqual([true, false]);
  });

  test("fans a Plateau Run opening out across pagination batches", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const playerIds = [];
    for (let index = 0; index < 85; index += 1) playerIds.push(await addPlayer(t, `Warcamp ${index}`));
    const plateauRunId = await t.run(async (ctx) => await ctx.db.insert("plateauRuns", {
      status: "open", opensAt: 1, closesAt: 2, resolvesAt: 2, difficulty: 20,
      spherePool: 1000, gemheartReward: 1,
    }));
    await t.mutation(internal.notifications.notifyPlateauRunOpenBatch, {
      plateauRunId, body: "A Plateau Run has opened.", createdAt: 1,
      paginationOpts: { numItems: 40, cursor: null },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(playerIds.length);
    expect(new Set(rows.map((row) => row.playerId)).size).toBe(playerIds.length);
    vi.useRealTimers();
  });

  test("research completion emits once even when stale callbacks repeat", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Thaylen");
    await t.run(async (ctx) => await ctx.db.insert("playerResearch", {
      playerId, completedLevels: {}, activeProject: "bridgeEngineering", activeLevel: 1,
      status: "active", accumulatedBaseMs: 3_600_000, lastAdvancedAt: Date.now(),
      projectedCompletionAt: Date.now(), createdAt: 1, updatedAt: 1,
    }));
    await t.mutation(internal.research.completeActive, { playerId });
    await t.mutation(internal.research.completeActive, { playerId });
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("research_completed");
  });

  test("authenticated preferences and read operations keep counters correct", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "player@example.com" }));
    const playerId = await addPlayer(t, "Alethi", String(userId));
    const created = await t.run((ctx) => createNotification(ctx, {
      playerId, category: "messages", eventType: "player_message", title: "New Message",
      body: "A spanreed note arrived.", destinationView: "inbox", dedupeKey: "message:read-test",
    }));
    const asPlayer = t.withIdentity({ subject: String(userId) });
    await asPlayer.mutation(api.notifications.updatePreferences, {
      combat: true, missions: false, research: true, plateauRuns: true, messages: true,
    });
    await asPlayer.mutation(api.notifications.markRead, { notificationId: created.notificationId });
    const listed = await asPlayer.query(api.notifications.list, {});
    expect(listed.unreadCount).toBe(0);
    expect(listed.preferences.missions).toBe(false);
    expect(listed.notifications[0].readAt).toBeTypeOf("number");
  });

  test("research pause and resume transitions each emit once", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Veden");
    await t.run(async (ctx) => await ctx.db.insert("playerResearch", {
      playerId, completedLevels: {}, activeProject: "gemCutting", activeLevel: 1,
      status: "active", accumulatedBaseMs: 0, lastAdvancedAt: Date.now(),
      projectedCompletionAt: Date.now() + 3_600_000, createdAt: 1, updatedAt: 1,
    }));
    await t.mutation(internal.research.completeActive, { playerId });
    await t.mutation(internal.research.completeActive, { playerId });
    await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Ancient Crown", type: "ancient", status: "owned", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 10, neutralDefenseRemaining: 0,
      heldSince: Date.now(), createdAt: 1, updatedAt: 1,
    }));
    await t.mutation(internal.research.completeActive, { playerId });
    await t.mutation(internal.research.completeActive, { playerId });
    const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(rows.map((row) => row.eventType)).toEqual(["research_paused", "research_resumed"]);
  });

  test("device registration rejects arbitrary delivery hosts", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "push@example.com" }));
    await addPlayer(t, "Push Tester", String(userId));
    const asPlayer = t.withIdentity({ subject: String(userId) });
    await expect(asPlayer.mutation(api.notifications.registerDevice, {
      endpoint: "https://example.com/arbitrary-callback", p256dh: "valid_key", auth: "valid_auth",
      deviceLabel: "Test", soundEnabled: true,
    })).rejects.toThrow("Unsupported push service");
    const registered = await asPlayer.mutation(api.notifications.registerDevice, {
      endpoint: "https://fcm.googleapis.com/fcm/send/example", p256dh: "valid_key", auth: "valid_auth",
      deviceLabel: "Test", soundEnabled: true,
    });
    expect(registered.subscriptionId).toBeTruthy();
  });
});
