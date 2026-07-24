import type { MutationCtx } from "./_generated/server";
import { getGameClock, WORLD_KEY } from "./rules";

export async function insertGameEvent(
  ctx: MutationCtx,
  event: { text: string; kind?: string; createdAt: number },
) {
  const world = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
    .unique();

  return await ctx.db.insert("gameEvents", {
    ...event,
    gameDate: world ? getGameClock(world.createdAt, event.createdAt).label : undefined,
  });
}
