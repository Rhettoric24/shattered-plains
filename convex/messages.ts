import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";

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
      messages,
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
      createdAt: now,
    });

    await ctx.db.patch(from._id, { lastActiveAt: now });

    return { messageId };
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
