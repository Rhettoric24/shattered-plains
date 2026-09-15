/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0, espionageNetwork: 0 };

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const senderId = await ctx.db.insert("players", {
      authUserId: "transfer-sender", name: "Sender", normalizedName: "sender", acres: 10,
      spheres: 1_000, gemhearts: 5, units, buildings, lastEconomyAt: now, lastActiveAt: now, createdAt: now,
    });
    const recipientId = await ctx.db.insert("players", {
      authUserId: "transfer-recipient", name: "Recipient", normalizedName: "recipient", acres: 10,
      spheres: 200, gemhearts: 1, units, buildings, lastEconomyAt: now, lastActiveAt: now, createdAt: now,
    });
    return { senderId, recipientId };
  });
  return { t, ...ids, sender: t.withIdentity({ subject: "transfer-sender" }) };
}

describe("Spanreed resource transfers", () => {
  test("atomically transfers whole resources and records receipts for both warcamps", async () => {
    const { t, sender, senderId, recipientId } = await setup();
    const result = await sender.mutation(api.messages.sendResources, {
      toPlayerId: recipientId, spheres: 300, gemhearts: 2,
    });
    const state = await t.run(async (ctx) => ({
      sender: await ctx.db.get(senderId),
      recipient: await ctx.db.get(recipientId),
      transfer: await ctx.db.get(result.transferId),
      senderMessages: await ctx.db.query("messages").withIndex("by_to_player", (q) => q.eq("toPlayerId", senderId)).collect(),
      recipientMessages: await ctx.db.query("messages").withIndex("by_to_player", (q) => q.eq("toPlayerId", recipientId)).collect(),
      recipientNotifications: await ctx.db.query("notifications").withIndex("by_playerId_and_createdAt", (q) => q.eq("playerId", recipientId)).collect(),
    }));
    expect(state.sender?.spheres).toBeCloseTo(700, 1);
    expect(state.sender?.gemhearts).toBe(3);
    expect(state.recipient?.spheres).toBeCloseTo(500, 1);
    expect(state.recipient?.gemhearts).toBe(3);
    expect(state.transfer).toMatchObject({ fromPlayerId: senderId, toPlayerId: recipientId, spheres: 300, gemhearts: 2 });
    expect(state.senderMessages[0]).toMatchObject({ eventType: "resource_transfer_sent" });
    expect(state.recipientMessages[0]).toMatchObject({ eventType: "resource_transfer_received" });
    expect(state.recipientNotifications[0]).toMatchObject({ eventType: "resource_transfer_received" });
  });

  test("rejects self-transfers, fractional values, empty gifts, and insufficient balances without partial writes", async () => {
    const { t, sender, senderId, recipientId } = await setup();
    await expect(sender.mutation(api.messages.sendResources, { toPlayerId: senderId, spheres: 1, gemhearts: 0 }))
      .rejects.toThrow("Choose another warcamp");
    await expect(sender.mutation(api.messages.sendResources, { toPlayerId: recipientId, spheres: 1.5, gemhearts: 0 }))
      .rejects.toThrow("whole, non-negative");
    await expect(sender.mutation(api.messages.sendResources, { toPlayerId: recipientId, spheres: 0, gemhearts: 0 }))
      .rejects.toThrow("Choose at least one resource");
    await expect(sender.mutation(api.messages.sendResources, { toPlayerId: recipientId, spheres: 1_001, gemhearts: 0 }))
      .rejects.toThrow("Not enough available Spheres");

    const state = await t.run(async (ctx) => ({
      sender: await ctx.db.get(senderId),
      recipient: await ctx.db.get(recipientId),
      transfers: await ctx.db.query("resourceTransfers").collect(),
    }));
    expect(state.sender).toMatchObject({ spheres: 1_000, gemhearts: 5 });
    expect(state.recipient).toMatchObject({ spheres: 200, gemhearts: 1 });
    expect(state.transfers).toHaveLength(0);
  });
});
