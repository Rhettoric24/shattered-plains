import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

export type NotificationCategory = "combat" | "missions" | "research" | "plateau_runs" | "messages";

const preferenceField = {
  combat: "combat",
  missions: "missions",
  research: "research",
  plateau_runs: "plateauRuns",
  messages: "messages",
} as const;

export async function notificationStateForPlayer(ctx: MutationCtx, playerId: Id<"players">) {
  return await ctx.db.query("notificationState").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
}

export async function createNotification(ctx: MutationCtx, args: {
  playerId: Id<"players">;
  category: NotificationCategory;
  eventType: string;
  title: string;
  body: string;
  destinationView: string;
  entityId?: string;
  dedupeKey: string;
  createdAt?: number;
}) {
  const duplicate = await ctx.db.query("notifications")
    .withIndex("by_playerId_and_dedupeKey", (q) => q.eq("playerId", args.playerId).eq("dedupeKey", args.dedupeKey))
    .unique();
  if (duplicate) return { notificationId: duplicate._id, created: false };

  const now = args.createdAt ?? Date.now();
  let state = await notificationStateForPlayer(ctx, args.playerId);
  if (!state) {
    const stateId = await ctx.db.insert("notificationState", {
      playerId: args.playerId, unreadCount: 0, combat: true, missions: true,
      research: true, plateauRuns: true, messages: true, updatedAt: now,
    });
    state = await ctx.db.get(stateId);
  }
  if (!state) throw new Error("Could not initialize notification state.");

  const notificationId = await ctx.db.insert("notifications", {
    playerId: args.playerId, category: args.category, eventType: args.eventType,
    title: args.title, body: args.body, destinationView: args.destinationView,
    ...(args.entityId ? { entityId: args.entityId } : {}),
    dedupeKey: args.dedupeKey, createdAt: now,
  });
  await ctx.db.patch(state._id, { unreadCount: state.unreadCount + 1, updatedAt: now });

  if (state[preferenceField[args.category]]) {
    await ctx.scheduler.runAfter(0, internal.notificationPush.deliver, { notificationId });
  }
  return { notificationId, created: true };
}
