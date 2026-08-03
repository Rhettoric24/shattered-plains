import type { MutationCtx } from "./_generated/server";
import { pendingEconomy, roundResource } from "./rules";
import {
  grantGemheartPlateauIncome,
  plateauCountsForPlayer,
} from "./plateauHelpers";
import { completedResearch } from "./researchHelpers";

export async function settlePlayerEconomy(ctx: MutationCtx, player: any) {
  const now = Date.now();
  const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
  const completed = await completedResearch(ctx, player._id);
  const pending = pendingEconomy({ ...player, plateauCounts, completedResearch: completed }, now);
  const spheres = roundResource(player.spheres + pending.income);
  const gemheartIncome = await grantGemheartPlateauIncome(ctx, player, now);

  await ctx.db.patch(player._id, {
    spheres,
    gemhearts: gemheartIncome.totalGemhearts,
    lastEconomyAt: now,
  });

  return {
    player: {
      ...player,
      spheres,
      gemhearts: gemheartIncome.totalGemhearts,
      lastEconomyAt: now,
    },
    pending,
    gemheartIncome: gemheartIncome.gemhearts,
  };
}
