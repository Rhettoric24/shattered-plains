import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
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
    const sequence = status.owned + 1;
    const name = (args.name ?? `Scout Conclave ${["I", "II", "III"][sequence - 1] ?? sequence}`).trim();
    if (name.length < ARDENTIA_RULES.nameMinLength || name.length > ARDENTIA_RULES.nameMaxLength) throw new Error(`Conclave names must be ${ARDENTIA_RULES.nameMinLength}–${ARDENTIA_RULES.nameMaxLength} characters.`);
    const normalizedName = name.toLowerCase();
    const duplicate = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId_and_normalizedName", (q) => q.eq("ownerPlayerId", player._id).eq("normalizedName", normalizedName)).unique();
    if (duplicate) throw new Error("You already have a Conclave with that name.");
    const conclaveId = await ctx.db.insert("ardentConclaves", { ownerPlayerId: player._id, name, normalizedName, xp: 0, createdAt: now, updatedAt: now });
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
    return { recruited: true, owned: nextOwned, conclaveId, provisions };
  },
});

export const renameConclave = mutation({
  args: { conclaveId: v.id("ardentConclaves"), name: v.string() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const conclave = await ctx.db.get(args.conclaveId);
    if (!conclave || conclave.ownerPlayerId !== player._id) throw new Error("Conclave not found.");
    const name = args.name.trim();
    if (name.length < ARDENTIA_RULES.nameMinLength || name.length > ARDENTIA_RULES.nameMaxLength) throw new Error(`Conclave names must be ${ARDENTIA_RULES.nameMinLength}–${ARDENTIA_RULES.nameMaxLength} characters.`);
    const normalizedName = name.toLowerCase();
    const duplicate = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId_and_normalizedName", (q) => q.eq("ownerPlayerId", player._id).eq("normalizedName", normalizedName)).unique();
    if (duplicate && duplicate._id !== conclave._id) throw new Error("You already have a Conclave with that name.");
    await ctx.db.patch(conclave._id, { name, normalizedName, updatedAt: Date.now() });
    return { renamed: true, name };
  },
});

export const backfillIndividualConclaves = internalMutation({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").take(200);
    let created = 0;
    for (const player of players) {
      const existing = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId", (q) => q.eq("ownerPlayerId", player._id)).take(10);
      const wanted = Math.max(0, Math.min(3, Math.floor(player.ardentiaConclaves ?? 0)));
      for (let index = existing.length; index < wanted; index += 1) {
        const name = `Scout Conclave ${["I", "II", "III"][index]}`;
        const now = Date.now();
        await ctx.db.insert("ardentConclaves", { ownerPlayerId: player._id, name, normalizedName: name.toLowerCase(), xp: 0, createdAt: now, updatedAt: now });
        created += 1;
      }
    }
    return { created };
  },
});
