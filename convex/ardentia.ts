import { mutation, query } from "./_generated/server";
import { settlePlayerEconomy } from "./economyHelpers";
import { insertGameEvent } from "./eventHelpers";
import { requireCurrentPlayer } from "./ownership";
import { plateauAttributeCountsForPlayer, plateauCountsForPlayer } from "./plateauHelpers";
import { ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import { ARDENTIA_RULES } from "./rules";
import { ardentiaConclaveStatus } from "./ardentiaHelpers";

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    return await ardentiaConclaveStatus(
      ctx,
      player._id,
      player.ardentiaConclaves ?? 0,
      player.buildings.ardentMonastery ?? 0,
    );
  },
});

export const recruitConclave = mutation({
  args: {},
  handler: async (ctx) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    const monasteryLevel = player.buildings.ardentMonastery ?? 0;
    if (monasteryLevel < 1) {
      throw new Error("Construct an Ardent Monastery before forming a Scout Conclave.");
    }
    const status = await ardentiaConclaveStatus(
      ctx,
      player._id,
      player.ardentiaConclaves ?? 0,
      monasteryLevel,
    );
    if (status.owned >= status.capacity) {
      throw new Error(`Ardent Monastery level ${monasteryLevel} supports ${status.capacity} Scout Conclave${status.capacity === 1 ? "" : "s"}.`);
    }
    if (player.spheres < ARDENTIA_RULES.recruitmentCost) {
      throw new Error(`Not enough spheres. A Scout Conclave costs ${ARDENTIA_RULES.recruitmentCost}.`);
    }
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const attributes = await plateauAttributeCountsForPlayer(ctx, player._id);
    const ownedUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const nextOwned = status.owned + 1;
    const provisions = provisionsStatus(
      player.buildings,
      plateauCounts,
      ownedUnits,
      attributes.large,
      nextOwned,
    );
    if (provisions.used > provisions.capacity) {
      throw new Error(`Not enough Provisions. Forming this Conclave would use ${provisions.used}/${provisions.capacity}.`);
    }
    const now = Date.now();
    await ctx.db.patch(player._id, {
      ardentiaConclaves: nextOwned,
      spheres: player.spheres - ARDENTIA_RULES.recruitmentCost,
      lastActiveAt: now,
    });
    await insertGameEvent(ctx, {
      kind: "warcamp",
      text: `${player.name} formed an Ardentia Scout Conclave.`,
      createdAt: now,
    });
    return { recruited: true, owned: nextOwned, provisions };
  },
});
