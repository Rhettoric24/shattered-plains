/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { applyFabrialCasualtyProtection, FABRIAL_RULES, reusableFabrialLost, soulcasterRecovery } from "./fabrialRules";
import { reserveFabrial, settleReusableFabrial } from "./fabrialHelpers";
import { emptyBuildings, emptyUnits, totalUnits, WORLD_KEY } from "./rules";
import { applyHighstormExposureLosses } from "./highstormRules";

const modules = import.meta.glob("./**/*.ts");

async function addPlayer(t: ReturnType<typeof convexTest>, levels: Record<string, number> = {}) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: `fabrials-${Math.random()}@example.com` }));
  const playerId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("players", {
      authUserId: String(userId), name: "Artifabrian", normalizedName: "artifabrian", acres: 0,
      spheres: 100_000, gemhearts: 10, units: emptyUnits(), buildings: { ...emptyBuildings(), ardentMonastery: 3 },
      lastEconomyAt: now, lastActiveAt: now, createdAt: now,
    });
    await ctx.db.insert("playerResearch", { playerId: id, completedLevels: levels, createdAt: now, updatedAt: now });
    return id;
  });
  return { playerId, player: t.withIdentity({ subject: String(userId) }) };
}

describe("Fabrial rules", () => {
  test("centralizes the three V0 fabrication recipes", () => {
    expect(FABRIAL_RULES.painrial).toMatchObject({ sphereCost: 10_000, gemheartCost: 0, batchSize: 3, reusable: false });
    expect(FABRIAL_RULES.soulcaster).toMatchObject({ sphereCost: 15_000, gemheartCost: 1, batchSize: 1, reusable: true });
    expect(FABRIAL_RULES.halfShard).toMatchObject({ sphereCost: 15_000, gemheartCost: 2, batchSize: 1, reusable: true });
  });
  test("applies post-calculation floor casualty protection", () => {
    const original = { survivors: { ...emptyUnits(), spearman: 93 }, casualties: { ...emptyUnits(), spearman: 7 } };
    const painrial = applyFabrialCasualtyProtection("painrial", original);
    const halfShard = applyFabrialCasualtyProtection("halfShard", original);
    expect(painrial.prevented).toBe(1);
    expect(painrial.casualties.spearman).toBe(6);
    expect(halfShard.prevented).toBe(3);
    expect(halfShard.survivors.spearman).toBe(96);
  });

  test("uses exact Soulcaster excess recovery without exceeding the pool", () => {
    expect(soulcasterRecovery(10_000, 4_000, true)).toEqual({ normalRecovery: 4_000, bonus: 3_000, totalRecovery: 7_000 });
    expect(soulcasterRecovery(10_000, 20_000, true)).toEqual({ normalRecovery: 10_000, bonus: 0, totalRecovery: 10_000 });
    expect(soulcasterRecovery(10_000, 4_000, false)).toEqual({ normalRecovery: 0, bonus: 0, totalRecovery: 0 });
  });

  test("maps success, lower failure, and catastrophic failure deterministically", () => {
    expect(reusableFabrialLost("clean_success", "same")).toBe(false);
    expect(reusableFabrialLost("normal_success", "same")).toBe(false);
    expect(reusableFabrialLost("catastrophic_failure", "same")).toBe(true);
    expect(reusableFabrialLost("lower_failure", "same")).toBe(reusableFabrialLost("lower_failure", "same"));
    const outcomes = Array.from({ length: 100 }, (_, index) => reusableFabrialLost("lower_failure", `seed:${index}`));
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });
});

describe("Fabrial discovery and inventory", () => {
  test("keeps hidden conditions server-side and grants prototypes exactly once", async () => {
    const t = convexTest(schema, modules);
    const { player } = await addPlayer(t, { painrialMedicine: 2, sprenStudies: 3, soulcastArmor: 2, siegeEngineering: 2 });
    const first = await t.mutation(internal.fabrials.backfillDiscoveries, {});
    const second = await t.mutation(internal.fabrials.backfillDiscoveries, {});
    expect(first).toMatchObject({ updatedPlayers: 1, prototypesGranted: 2 });
    expect(second).toMatchObject({ updatedPlayers: 0, prototypesGranted: 0 });
    const status = await player.query(api.fabrials.getStatus, {});
    expect(status.inventory.map((entry) => entry.kind).sort()).toEqual(["halfShard", "painrial"]);
    expect(status.inventory.every((entry) => entry.owned === 1)).toBe(true);
    expect(JSON.stringify(status)).not.toContain("painrialMedicine");
    expect(JSON.stringify(status)).not.toContain("sprenStudies");
  });

  test("discovers the Soulcaster only at its complete intersection", async () => {
    const t = convexTest(schema, modules);
    const { playerId } = await addPlayer(t, { soulcasting: 2, gemCutting: 2, sprenStudies: 1 });
    expect((await t.mutation(internal.fabrials.backfillDiscoveries, {})).prototypesGranted).toBe(0);
    await t.run(async (ctx) => {
      const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
      await ctx.db.patch(research!._id, { completedLevels: { ...research!.completedLevels, sprenStudies: 2 } });
    });
    expect((await t.mutation(internal.fabrials.backfillDiscoveries, {})).discoveries.soulcaster).toBe(1);
  });

  test("fabricates the configured batch and enforces reusable commitment", async () => {
    const t = convexTest(schema, modules);
    const { playerId, player } = await addPlayer(t, { painrialMedicine: 2, sprenStudies: 3, soulcastArmor: 2, siegeEngineering: 2 });
    await t.mutation(internal.fabrials.backfillDiscoveries, {});
    const beforeFabrication = await t.run((ctx) => ctx.db.get(playerId));
    await player.mutation(api.fabrials.fabricate, { kind: "painrial" });
    const afterFabrication = await t.run((ctx) => ctx.db.get(playerId));
    expect(beforeFabrication!.spheres - afterFabrication!.spheres).toBe(FABRIAL_RULES.painrial.sphereCost);
    expect(beforeFabrication!.gemhearts - afterFabrication!.gemhearts).toBe(0);
    let painrial = (await player.query(api.fabrials.getStatus, {})).inventory.find((entry) => entry.kind === "painrial")!;
    expect(painrial.owned).toBe(1 + FABRIAL_RULES.painrial.batchSize);
    await t.run((ctx) => reserveFabrial(ctx, playerId, "halfShard"));
    let halfShard = (await player.query(api.fabrials.getStatus, {})).inventory.find((entry) => entry.kind === "halfShard")!;
    expect(halfShard).toMatchObject({ owned: 1, committed: 1, available: 0 });
    await expect(t.run((ctx) => reserveFabrial(ctx, playerId, "halfShard"))).rejects.toThrow("currently available");
    await t.run((ctx) => settleReusableFabrial(ctx, playerId, "halfShard", "normal_success", "operation"));
    await t.run((ctx) => settleReusableFabrial(ctx, playerId, "halfShard", "normal_success", "operation"));
    halfShard = (await player.query(api.fabrials.getStatus, {})).inventory.find((entry) => entry.kind === "halfShard")!;
    expect(halfShard).toMatchObject({ owned: 1, committed: 0, available: 1 });
  });

  test("consumes a Painrial on launch and protects the same operation during a Highstorm", async () => {
    const t = convexTest(schema, modules);
    const { playerId, player } = await addPlayer(t, { painrialMedicine: 2, sprenStudies: 2 });
    const now = Date.now();
    await t.run(async (ctx) => {
      const row = await ctx.db.get(playerId);
      await ctx.db.patch(playerId, { units: { ...emptyUnits(), spearman: 1000 } });
      await ctx.db.insert("gameState", {
        key: WORLD_KEY, openAcres: 0, highstormOverrideStartAt: now - 1_000,
        highstormOverrideEndAt: now + 60_000, highstormOverrideId: "highstorm:fabrial-test",
        createdAt: now, updatedAt: now,
      });
      expect(row).not.toBeNull();
    });
    await t.mutation(internal.fabrials.backfillDiscoveries, {});
    const launched = await player.mutation(api.raids.launchSphereRaid, { units: { ...emptyUnits(), spearman: 1000 }, fabrial: "painrial" });
    expect((await player.query(api.fabrials.getStatus, {})).inventory.find((entry) => entry.kind === "painrial")).toMatchObject({ owned: 0, committed: 0, available: 0 });
    const beforeStorm = await t.run((ctx) => ctx.db.get(launched.raidId));
    const raw = applyHighstormExposureLosses(beforeStorm!.units, `${launched.raidId}:highstorm:fabrial-test:exposure`, { painrialMedicine: 2, sprenStudies: 2 });
    const rawCasualties = totalUnits(raw.casualties);
    await t.mutation(internal.highstorms.processActiveStorm, {});
    const afterStorm = await t.run((ctx) => ctx.db.get(launched.raidId));
    expect(afterStorm!.fabrialPreventedCasualties).toBe(Math.floor(rawCasualties * 0.25));
    expect(totalUnits(afterStorm!.units)).toBe(totalUnits(raw.survivors) + Math.floor(rawCasualties * 0.25));
  });
});
