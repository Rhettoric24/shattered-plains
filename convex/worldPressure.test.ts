/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { emptyBuildings, emptyUnits } from "./rules";
import { createFreshSeason } from "./seasonLedger";
import { applyHostility, resetWorldPressureForSeason } from "./worldPressure";
import { seededFraction, WORLD_PRESSURE_RULES } from "./worldPressureRules";

const modules = import.meta.glob("./**/*.ts");

async function addPlayer(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    name,
    normalizedName: name.toLowerCase(),
    acres: 20,
    spheres: 1000,
    gemhearts: 0,
    units: emptyUnits(),
    buildings: emptyBuildings(),
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
  }));
}

describe("World Pressure integration", () => {
  test("player aggression resets peace while retaliation gains do not", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Alethi");
    const anchor = 1_000_000;
    await t.run((ctx) => applyHostility(ctx, { playerId, gain: 100, playerInitiated: true, now: anchor }));
    const interval = WORLD_PRESSURE_RULES.hostility.peacefulIntervalMs;
    await t.run((ctx) => applyHostility(ctx, {
      playerId,
      gain: WORLD_PRESSURE_RULES.hostility.gains.retaliationVictory,
      playerInitiated: false,
      now: anchor + interval,
    }));
    const row = await t.run(async (ctx) => await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique());
    expect(row).toMatchObject({ hostility: 88, lastPlayerAggressionAt: anchor, decayIntervalsApplied: 1 });
  });

  test("a Deep Plains success uses snapshotted rewards, adds Hostility, and rolls Gemhearts once", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Deep Raider");
    const seasonId = await t.run((ctx) => createFreshSeason(ctx, 1, Date.now()));
    const missionUnits = { ...emptyUnits(), spearman: 1000, chull: 200 };
    const raidId = await t.run(async (ctx) => await ctx.db.insert("raids", {
      attackerId: playerId,
      targetType: "deep_plains",
      units: missionUnits,
      power: 1000,
      speed: -200,
      defensePower: 100,
      rewardSpheres: 4000,
      hostilityAtLaunch: 80,
      scoringSeasonId: seasonId,
      departAt: 1,
      arriveAt: 2,
      status: "pending",
    }));
    await t.mutation(internal.raids.resolveRaid, { raidId });
    await t.mutation(internal.raids.resolveRaid, { raidId });
    const result = await t.run(async (ctx) => ({
      raid: await ctx.db.get(raidId),
      player: await ctx.db.get(playerId),
      pressure: await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
    }));
    const expectedGemheart = seededFraction(`${raidId}:deep-plains:gemheart`) < 0.1;
    expect(result.raid).toMatchObject({ status: "resolved", spheresRecovered: 4000, gemheartFound: expectedGemheart });
    expect(result.player?.gemhearts).toBe(expectedGemheart ? 1 : 0);
    expect(result.pressure?.hostility).toBe(10);
  });

  test("Deep Plains launch is gated at Vengeful and snapshots a six-to-eight-hour mission", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "deep@example.com" }));
    const playerId = await addPlayer(t, "Deep Launcher");
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, {
        authUserId: String(userId),
        units: { ...emptyUnits(), spearman: 500, chull: 20 },
      });
      await ctx.db.insert("gameState", { key: "main", openAcres: 0, createdAt: now, updatedAt: now });
      await createFreshSeason(ctx, 1, now);
      await applyHostility(ctx, { playerId, gain: 68, playerInitiated: true, now });
    });
    const result = await t.withIdentity({ subject: String(userId) }).mutation(api.raids.launchDeepPlainsRaid, {
      units: { ...emptyUnits(), spearman: 100, chull: 10 },
    });
    const raid = await t.run(async (ctx) => await ctx.db.get(result.raidId));
    expect(result.travelMinutes).toBeGreaterThanOrEqual(360);
    expect(result.travelMinutes).toBeLessThanOrEqual(480);
    expect(raid?.targetType).toBe("deep_plains");
    expect(raid?.hostilityAtLaunch).toBe(68);
    expect(raid?.defensePower).toBeGreaterThanOrEqual(Math.round(220 * 1.85));
    expect(raid?.defensePower).toBeLessThanOrEqual(Math.round(320 * 1.85));
  });

  test("failed retaliation returns a plateau to neutral with linear seasonal fortification", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Plateau Holder");
    const seasonId = await t.run((ctx) => createFreshSeason(ctx, 1, now));
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Emerald Expanse",
      type: "gemheart",
      status: "owned",
      ownerPlayerId: playerId,
      highground: true,
      large: true,
      neutralDefenseInitial: 200,
      neutralDefenseRemaining: 0,
      baseNeutralDefense: 200,
      parshendiReclamationCount: 0,
      heldSince: now - 1000,
      lastGemheartAt: now - 1000,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    }));
    const retaliationId = await t.run(async (ctx) => await ctx.db.insert("parshendiRetaliations", {
      playerId,
      targetPlateauId: plateauId,
      phase: "launched",
      active: true,
      hostilityAtFormation: 70,
      militaryCapacity: 0,
      seasonDay: 1,
      power: 100,
      formationAt: now,
      launchAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    const siegeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("sieges", {
        plateauId,
        defenderId: playerId,
        targetType: "parshendi_retaliation",
        attackerUnits: emptyUnits(),
        attackerPower: 100,
        attackerSpeed: 0,
        defenderUnits: emptyUnits(),
        defenderPower: 0,
        defenderSpeed: 0,
        fortifyPercent: 0,
        retaliationId,
        departAt: now,
        resolveAt: now,
        status: "pending",
      });
      await ctx.db.patch(plateauId, { activeSiegeId: id });
      await ctx.db.patch(retaliationId, { siegeId: id });
      return id;
    });
    await t.mutation(internal.plateaus.resolveSiege, { siegeId });
    const plateau = await t.run(async (ctx) => await ctx.db.get(plateauId));
    expect(plateau).toMatchObject({
      type: "gemheart",
      highground: true,
      large: true,
      status: "neutral",
      parshendiReclamationCount: 1,
      reclamationSeasonId: seasonId,
      neutralDefenseInitial: 220,
      neutralDefenseRemaining: 220,
    });
    expect(plateau?.ownerPlayerId).toBeUndefined();
    expect(plateau?.heldSince).toBeUndefined();
    expect(plateau?.lastGemheartAt).toBeUndefined();
  });

  test("season reset clears Hostility and cancels forming retaliation", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Season Tester");
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Season Plateau", type: "sphere", status: "owned", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 150, neutralDefenseRemaining: 0,
      heldSince: now, createdAt: now, updatedAt: now,
    }));
    await t.run((ctx) => applyHostility(ctx, { playerId, gain: 85, playerInitiated: true, now }));
    const retaliationId = await t.run(async (ctx) => await ctx.db.insert("parshendiRetaliations", {
      playerId, targetPlateauId: plateauId, phase: "forming", active: true,
      hostilityAtFormation: 85, militaryCapacity: 10, seasonDay: 1, power: 31,
      formationAt: now, launchAt: now + 1000, createdAt: now, updatedAt: now,
    }));
    await t.run((ctx) => resetWorldPressureForSeason(ctx, now + 1));
    const result = await t.run(async (ctx) => ({
      pressure: await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
      retaliation: await ctx.db.get(retaliationId),
    }));
    expect(result.pressure).toMatchObject({ hostility: 0, decayIntervalsApplied: 0 });
    expect(result.pressure?.lastPlayerAggressionAt).toBeUndefined();
    expect(result.retaliation).toMatchObject({ phase: "cancelled", active: false, outcome: "cancelled" });
  });
});
