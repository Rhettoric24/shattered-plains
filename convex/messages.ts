import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import { createNotification } from "./notificationHelpers";
import { discloseStoredMessage } from "./messageIntel";
import { settlePlayerEconomy } from "./economyHelpers";

export const listInbox = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_to_player_created", (q) => q.eq("toPlayerId", player._id))
      .order("desc")
      .take(60);

    return {
      messages: await Promise.all(messages.map(async message => message.kind === "player" ? message : ({ ...message, body: await discloseStoredMessage(ctx, player, message) }))),
      unreadCount: messages.filter((message) => !message.readAt).length,
    };
  },
});

export const sendMessage = mutation({
  args: {
    toPlayerId: v.id("players"),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const from = await requireCurrentPlayer(ctx);
    const to = await ctx.db.get(args.toPlayerId);
    if (!to) {
      throw new Error("Recipient not found.");
    }

    const subject = args.subject.trim().slice(0, 80);
    const body = args.body.trim().slice(0, 1200);
    if (!subject || !body) {
      throw new Error("Messages need both a subject and body.");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      fromPlayerId: from._id,
      toPlayerId: to._id,
      kind: "player",
      subject,
      body,
      eventType: "player_message",
      destinationView: "spanreed",
      createdAt: now,
    });

    await createNotification(ctx, {
      playerId: to._id, category: "messages", eventType: "player_message",
      title: `Message from ${from.name}`, body: subject, destinationView: "spanreed",
      entityId: String(messageId), dedupeKey: `message:${messageId}`, createdAt: now,
    });

    await ctx.db.patch(from._id, { lastActiveAt: now });

    return { messageId };
  },
});

export const sendResources = mutation({
  args: {
    toPlayerId: v.id("players"),
    spheres: v.number(),
    gemhearts: v.number(),
  },
  handler: async (ctx, args) => {
    const from = await requireCompetitivePlayer(ctx);
    const to = await ctx.db.get(args.toPlayerId);
    if (!to || to.isAdminObserver) throw new Error("Recipient not found.");
    if (to._id === from._id) throw new Error("Choose another warcamp as the recipient.");

    for (const amount of [args.spheres, args.gemhearts]) {
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
        throw new Error("Transfers must use whole, non-negative amounts.");
      }
    }
    if (args.spheres === 0 && args.gemhearts === 0) {
      throw new Error("Choose at least one resource to send.");
    }

    // Settle both economies inside this mutation so the transfer is validated
    // against current balances and applied atomically with its audit record.
    const settledFrom = (await settlePlayerEconomy(ctx, from)).player;
    const settledTo = (await settlePlayerEconomy(ctx, to)).player;
    if (settledFrom.spheres < args.spheres) throw new Error("Not enough available Spheres.");
    if (settledFrom.gemhearts < args.gemhearts) throw new Error("Not enough available Gemhearts.");

    const now = Date.now();
    const resourceParts = [
      args.spheres ? `${args.spheres.toLocaleString()} Sphere${args.spheres === 1 ? "" : "s"}` : "",
      args.gemhearts ? `${args.gemhearts.toLocaleString()} Gemheart${args.gemhearts === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const resourceSummary = resourceParts.join(" and ");
    const transferId = await ctx.db.insert("resourceTransfers", {
      fromPlayerId: from._id,
      toPlayerId: to._id,
      spheres: args.spheres,
      gemhearts: args.gemhearts,
      createdAt: now,
    });

    await ctx.db.patch(from._id, {
      spheres: settledFrom.spheres - args.spheres,
      gemhearts: settledFrom.gemhearts - args.gemhearts,
      lastActiveAt: now,
    });
    await ctx.db.patch(to._id, {
      spheres: settledTo.spheres + args.spheres,
      gemhearts: settledTo.gemhearts + args.gemhearts,
    });

    await ctx.db.insert("messages", {
      toPlayerId: from._id,
      kind: "system",
      subject: `Resources sent to ${to.name}`,
      body: `Your Spanreed quartermasters delivered ${resourceSummary} to ${to.name}.`,
      eventType: "resource_transfer_sent",
      destinationView: "spanreed",
      entityType: "resource_transfer",
      entityId: String(transferId),
      createdAt: now,
    });
    const receiptId = await ctx.db.insert("messages", {
      fromPlayerId: from._id,
      toPlayerId: to._id,
      kind: "system",
      subject: `Resources received from ${from.name}`,
      body: `${from.name} sent your warcamp ${resourceSummary}.`,
      eventType: "resource_transfer_received",
      destinationView: "spanreed",
      entityType: "resource_transfer",
      entityId: String(transferId),
      createdAt: now,
    });
    await createNotification(ctx, {
      playerId: to._id,
      category: "messages",
      eventType: "resource_transfer_received",
      title: `Resources from ${from.name}`,
      body: resourceSummary,
      destinationView: "spanreed",
      entityId: String(receiptId),
      dedupeKey: `resource-transfer:${transferId}`,
      createdAt: now,
    });

    return {
      transferId,
      spheres: settledFrom.spheres - args.spheres,
      gemhearts: settledFrom.gemhearts - args.gemhearts,
    };
  },
});

export const markMessageRead = mutation({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.toPlayerId !== player._id) {
      throw new Error("Message not found.");
    }

    const now = Date.now();
    await ctx.db.patch(message._id, { readAt: now });
    return { readAt: now };
  },
});

export const markInboxRead = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const now = Date.now();
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_to_player", (q) => q.eq("toPlayerId", player._id))
      .collect();

    let updated = 0;
    for (const message of messages) {
      if (!message.readAt) {
        await ctx.db.patch(message._id, { readAt: now });
        updated += 1;
      }
    }

    return { updated, readAt: now };
  },
});
