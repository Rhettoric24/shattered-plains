import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";
import { requireCurrentPlayer } from "./ownership";

export const submit = mutation({
  args: {
    message: v.string(),
    routeView: v.string(),
    routeTab: v.optional(v.string()),
    buildIdentifier: v.string(),
    viewportWidth: v.number(),
    viewportHeight: v.number(),
  },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const message = args.message.trim();
    if (message.length < 3) throw new Error("Describe what you noticed in at least 3 characters.");
    if (message.length > 2000) throw new Error("Bug reports are limited to 2,000 characters.");
    const reportId = await ctx.db.insert("playtestFeedback", {
      playerId: player._id,
      playerName: player.name,
      message,
      routeView: args.routeView.trim().slice(0, 80) || "unknown",
      ...(args.routeTab?.trim() ? { routeTab: args.routeTab.trim().slice(0, 80) } : {}),
      buildIdentifier: args.buildIdentifier.trim().slice(0, 120) || "unknown",
      viewportWidth: Math.max(0, Math.floor(args.viewportWidth)),
      viewportHeight: Math.max(0, Math.floor(args.viewportHeight)),
      createdAt: Date.now(),
    });
    return { reportId };
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("playtestFeedback")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);
  },
});
