import type { MutationCtx } from "./_generated/server";
import { pendingEconomy, roundResource } from "./rules";

export async function settlePlayerEconomy(ctx: MutationCtx, player: any) {
  const now = Date.now();
  const pending = pendingEconomy(player, now);
  const spheres = roundResource(player.spheres + pending.income);

  await ctx.db.patch(player._id, {
    spheres,
    lastEconomyAt: now,
  });

  return {
    player: {
      ...player,
      spheres,
      lastEconomyAt: now,
    },
    pending,
  };
}
