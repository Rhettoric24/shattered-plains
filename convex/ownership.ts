import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type AnyCtx = QueryCtx | MutationCtx;

export async function requireAuthUserId(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Sign in before taking this action.");
  }
  return userId;
}

export async function getCurrentPlayer(ctx: AnyCtx) {
  const authUserId = await requireAuthUserId(ctx);
  return await ctx.db
    .query("players")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
    .unique();
}

export async function requireCurrentPlayer(ctx: AnyCtx) {
  const player = await getCurrentPlayer(ctx);
  if (!player) {
    throw new Error("Create your warcamp before taking this action.");
  }
  return player;
}

export async function requirePlayerOwner(
  ctx: AnyCtx,
  playerId: Id<"players">,
) {
  const authUserId = await requireAuthUserId(ctx);
  const player = await ctx.db.get(playerId);

  if (!player) {
    throw new Error("Player not found.");
  }

  if (player.authUserId !== authUserId) {
    throw new Error("You can only control your own warcamp.");
  }

  return player;
}
