/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { emptyBuildings, emptyUnits } from "./rules";
import { createFreshSeason } from "./seasonLedger";
import { migrateWorldBrutalityPlateauDefenses } from "./plateauHelpers";
import { applyHostility, reconcileRetaliationSchedule, resetWorldPressureForSeason } from "./worldPressure";
import { seededFraction, WORLD_PRESSURE_RULES } from "./worldPressureRules";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T08:00:00.000Z"));
});

afterEach(() => vi.useRealTimers());

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
  test("the same raid disclosure narrows as Watchtower level improves without exposing or changing true defense", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "watchtower@example.com" }));
    const playerId = await addPlayer(t, "Watchtower Tester");
    const raidId = await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { authUserId: String(userId) });
      return await ctx.db.insert("raids", {
        attackerId: playerId,
        targetType: "parshendi_spheres",
        units: emptyUnits(),
        power: 1,
        speed: 1,
        defensePower: 163,
        rewardSpheres: 250,
        hostilityAtLaunch: 0,
        departAt: 1,
        arriveAt: Date.now() + 60_000,
        status: "pending",
      });
    });
    const player = t.withIdentity({ subject: String(userId) });
    const disclosures = [];
    for (const watchtower of [0, 1, 2, 3, 5]) {
      await t.run(async (ctx) => {
        const row = await ctx.db.get(playerId);
        if (row) await ctx.db.patch(playerId, { buildings: { ...row.buildings, watchtower } });
      });
      const visible = await player.query(api.raids.listVisibleRaids, {});
      expect(visible[0]).not.toHaveProperty("defensePower");
      expect(visible[0]).not.toHaveProperty("rewardSpheres");
      expect(visible[0].rewardIntel).toEqual({ minimum: 1200, maximum: 2400, label: "Rich" });
      disclosures.push(visible[0].defenseIntel);
      expect((await t.run((ctx) => ctx.db.get(raidId)))?.defensePower).toBe(163);
    }
    expect(disclosures).toEqual([
      { level: 0, mode: "range", min: 100, max: 200 },
      { level: 1, mode: "estimate", min: 128, max: 198 },
      { level: 2, mode: "estimate", min: 143, max: 183 },
      { level: 3, mode: "estimate", min: 153, max: 173 },
      { level: 5, mode: "exact", value: 163 },
    ]);
  });

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

  test("successful ordinary raid grants its snapshotted pool once and preserves Hostility behavior", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Sphere Raider");
    const seasonId = await t.run((ctx) => createFreshSeason(ctx, 1, now));
    const raidUnits = { ...emptyUnits(), spearman: 200, chull: 60 };
    const raidId = await t.run(async (ctx) => await ctx.db.insert("raids", {
      attackerId: playerId,
      targetType: "parshendi_spheres",
      units: raidUnits,
      power: 200,
      speed: -60,
      defensePower: 150,
      rewardSpheres: 1800,
      hostilityAtLaunch: 0,
      scoringSeasonId: seasonId,
      departAt: now,
      arriveAt: now,
      status: "pending",
    }));
    await t.mutation(internal.raids.resolveRaid, { raidId });
    await t.mutation(internal.raids.resolveRaid, { raidId });
    const result = await t.run(async (ctx) => ({
      raid: await ctx.db.get(raidId),
      player: await ctx.db.get(playerId),
      pressure: await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
      scoreEvents: await ctx.db.query("seasonScoreEvents").collect(),
    }));
    expect(result.raid).toMatchObject({ status: "resolved", spheresRecovered: 1800 });
    expect(result.player?.spheres).toBe(2800);
    expect(result.pressure).toMatchObject({ hostility: WORLD_PRESSURE_RULES.hostility.gains.neutralRaidVictory });
    expect(result.pressure?.lastPlayerAggressionAt).toBeUndefined();
    expect(result.scoreEvents).toHaveLength(1);
  });

  test("ordinary raid recovery remains capped by launch-army Plunder", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Light Column");
    const raidId = await t.run(async (ctx) => await ctx.db.insert("raids", {
      attackerId: playerId,
      targetType: "parshendi_spheres",
      units: { ...emptyUnits(), spearman: 100, chull: 1 },
      power: 100,
      speed: -1,
      defensePower: 100,
      rewardSpheres: 2400,
      hostilityAtLaunch: 0,
      departAt: now,
      arriveAt: now,
      status: "pending",
    }));
    await t.mutation(internal.raids.resolveRaid, { raidId });
    const result = await t.run(async (ctx) => ({ raid: await ctx.db.get(raidId), player: await ctx.db.get(playerId) }));
    expect(result.raid?.spheresRecovered).toBe(80);
    expect(result.player?.spheres).toBe(1080);
  });

  test("public raid reward estimates receive the authoritative corrected constants", async () => {
    const t = convexTest(schema, modules);
    const config = await t.query(api.config.getGameConfig, {});
    expect(config).toMatchObject({
      parshendiSphereRaidMinReward: 1200,
      parshendiSphereRaidMaxReward: 2400,
      worldPressure: { rules: { neutralRaid: { rewardHostilityFactor: 1 } } },
    });
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

  test("Deep Plains launch is gated at Vengeful and applies normal Speed to its six-to-eight-hour base", async () => {
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
    expect(result.travelMinutes).toBeGreaterThanOrEqual(396);
    expect(result.travelMinutes).toBeLessThanOrEqual(528);
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
      neutralDefenseInitial: 240,
      neutralDefenseRemaining: 240,
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

  test("neutral siege damage persists between failed attacks", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Campaigner");
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Campaign Plateau", type: "sphere", status: "neutral", origin: "neutral",
      highground: false, large: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 500,
      baseNeutralDefense: 500, parshendiReclamationCount: 0, createdAt: now, updatedAt: now,
    }));
    const siegeId = await t.run(async (ctx) => await ctx.db.insert("sieges", {
      plateauId, attackerId: playerId, targetType: "neutral",
      attackerUnits: emptyUnits(), attackerPower: 100, attackerSpeed: 1,
      fortifyPercent: 0, departAt: now, resolveAt: now, status: "pending",
    }));
    await t.mutation(internal.plateaus.resolveSiege, { siegeId });
    expect(await t.run(async (ctx) => (await ctx.db.get(plateauId))?.neutralDefenseRemaining)).toBe(400);
  });

  test("existing neutral plateaus migrate by class while preserving campaign progress", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const ids = await t.run(async (ctx) => ({
      normal: await ctx.db.insert("plateaus", {
        name: "Normal", type: "sphere", status: "neutral", origin: "neutral", highground: false, large: false,
        neutralDefenseInitial: 200, neutralDefenseRemaining: 100, baseNeutralDefense: 200,
        parshendiReclamationCount: 1, createdAt: now, updatedAt: now,
      }),
      large: await ctx.db.insert("plateaus", {
        name: "Large", type: "sphere", status: "neutral", origin: "neutral", highground: false, large: true,
        neutralDefenseInitial: 200, neutralDefenseRemaining: 200, baseNeutralDefense: 200,
        parshendiReclamationCount: 0, createdAt: now, updatedAt: now,
      }),
      gemheart: await ctx.db.insert("plateaus", {
        name: "Gemheart", type: "gemheart", status: "neutral", origin: "neutral", highground: false, large: true,
        neutralDefenseInitial: 200, neutralDefenseRemaining: 200, baseNeutralDefense: 200,
        parshendiReclamationCount: 0, createdAt: now, updatedAt: now,
      }),
    }));
    expect(await t.run((ctx) => migrateWorldBrutalityPlateauDefenses(ctx, now + 1))).toMatchObject({ migrated: 3 });
    const result = await t.run(async (ctx) => ({
      normal: await ctx.db.get(ids.normal), large: await ctx.db.get(ids.large), gemheart: await ctx.db.get(ids.gemheart),
    }));
    expect(result.normal).toMatchObject({ baseNeutralDefense: 500, neutralDefenseInitial: 600, neutralDefenseRemaining: 300, neutralDefenseBalanceVersion: 1 });
    expect(result.large).toMatchObject({ baseNeutralDefense: 650, neutralDefenseInitial: 650, neutralDefenseRemaining: 650 });
    expect(result.gemheart).toMatchObject({ baseNeutralDefense: 750, neutralDefenseInitial: 750, neutralDefenseRemaining: 750 });
  });

  test("raid intelligence narrows the stored defense without exposing the hidden value", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "scout@example.com" }));
    const playerId = await addPlayer(t, "Scout");
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { authUserId: String(userId) });
      await ctx.db.insert("raids", {
        attackerId: playerId, targetType: "parshendi_spheres", units: emptyUnits(), power: 100, speed: 1,
        defensePower: 163, rewardSpheres: 300, hostilityAtLaunch: 0,
        departAt: now, arriveAt: now + 1000, status: "pending",
      });
    });
    const asPlayer = t.withIdentity({ subject: String(userId) });
    const rumor = (await asPlayer.query(api.raids.listVisibleRaids, {}))[0] as any;
    expect(rumor.defensePower).toBeUndefined();
    expect(rumor.defenseIntel).toMatchObject({ mode: "range", min: 100, max: 200 });
    await t.run(async (ctx) => {
      const player = (await ctx.db.get(playerId))!;
      await ctx.db.patch(playerId, { buildings: { ...player.buildings, watchtower: 2 } });
    });
    const assessed = (await asPlayer.query(api.raids.listVisibleRaids, {}))[0] as any;
    expect(assessed.defenseIntel).toMatchObject({ mode: "estimate", min: 143, max: 183 });
    await t.run(async (ctx) => {
      const player = (await ctx.db.get(playerId))!;
      await ctx.db.patch(playerId, { buildings: { ...player.buildings, watchtower: 5 } });
    });
    const exact = (await asPlayer.query(api.raids.listVisibleRaids, {}))[0] as any;
    expect(exact.defenseIntel).toMatchObject({ mode: "exact", value: 163 });
  });

  test("formation clears stranded schedules when targets, players, or seasons disappear", async () => {
    for (const missing of ["target", "player", "season"] as const) {
      const t = convexTest(schema, modules);
      const now = Date.now();
      const playerId = await addPlayer(t, `Missing ${missing}`);
      if (missing !== "season") await t.run((ctx) => createFreshSeason(ctx, 1, now));
      if (missing !== "target") await t.run(async (ctx) => {
        await ctx.db.insert("plateaus", {
          name: "Eligible", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
          highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
          heldSince: now, createdAt: now, updatedAt: now,
        });
      });
      const token = `token-${missing}`;
      await t.run(async (ctx) => {
        await ctx.db.insert("kingdomWorldPressure", {
          playerId, hostility: 50, decayIntervalsApplied: 0,
          nextRetaliationAt: now + 1000, retaliationScheduleToken: token, updatedAt: now,
        });
        if (missing === "player") await ctx.db.delete(playerId);
      });
      await t.mutation(internal.worldPressure.beginRetaliationFormation, { playerId, scheduleToken: token });
      const row = await t.run(async (ctx) => await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique());
      expect(row?.retaliationScheduleToken).toBeUndefined();
      expect(row?.nextRetaliationAt).toBeUndefined();
    }
  });

  test("cancelled retaliation reschedules when territory becomes eligible without duplicates", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Recovery");
    const doomedPlateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Doomed", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
      heldSince: now, createdAt: now, updatedAt: now,
    }));
    const retaliationId = await t.run(async (ctx) => {
      await ctx.db.insert("kingdomWorldPressure", { playerId, hostility: 50, decayIntervalsApplied: 0, updatedAt: now });
      const id = await ctx.db.insert("parshendiRetaliations", {
        playerId, targetPlateauId: doomedPlateauId, phase: "forming", active: true,
        hostilityAtFormation: 50, militaryCapacity: 10, seasonDay: 1, power: 100,
        formationAt: now, launchAt: now, createdAt: now, updatedAt: now,
      });
      await ctx.db.delete(doomedPlateauId);
      return id;
    });
    await t.mutation(internal.worldPressure.launchRetaliation, { retaliationId });
    expect(await t.run(async (ctx) => (await ctx.db.get(retaliationId))?.active)).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.insert("plateaus", {
        name: "New Holding", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
        highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
        heldSince: now, createdAt: now, updatedAt: now,
      });
      await reconcileRetaliationSchedule(ctx, playerId, now + 1);
      await reconcileRetaliationSchedule(ctx, playerId, now + 2);
    });
    const state = await t.run(async (ctx) => ({
      row: await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
      active: await ctx.db.query("parshendiRetaliations").withIndex("by_playerId_and_active", (q) => q.eq("playerId", playerId).eq("active", true)).collect(),
    }));
    expect(state.row?.retaliationScheduleToken).toBeTruthy();
    expect(state.active).toHaveLength(0);
  });

  test("malformed retaliation resolution cannot strand the active record", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Malformed");
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Vanishing", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
      createdAt: now, updatedAt: now,
    }));
    const { retaliationId, siegeId } = await t.run(async (ctx) => {
      const retaliationId = await ctx.db.insert("parshendiRetaliations", {
        playerId, targetPlateauId: plateauId, phase: "launched", active: true,
        hostilityAtFormation: 50, militaryCapacity: 10, seasonDay: 1, power: 100,
        formationAt: now, launchAt: now, createdAt: now, updatedAt: now,
      });
      const siegeId = await ctx.db.insert("sieges", {
        plateauId, defenderId: playerId, targetType: "parshendi_retaliation",
        attackerUnits: emptyUnits(), attackerPower: 100, attackerSpeed: 0,
        fortifyPercent: 0, retaliationId, departAt: now, resolveAt: now, status: "pending",
      });
      await ctx.db.patch(retaliationId, { siegeId });
      await ctx.db.delete(plateauId);
      return { retaliationId, siegeId };
    });
    await t.mutation(internal.plateaus.resolveSiege, { siegeId });
    const result = await t.run(async (ctx) => ({ siege: await ctx.db.get(siegeId), retaliation: await ctx.db.get(retaliationId) }));
    expect(result.siege).toMatchObject({ status: "resolved" });
    expect(result.retaliation).toMatchObject({ active: false, phase: "cancelled", outcome: "cancelled" });
  });

  test("missing defender and siege linkage still reconcile the matching retaliation", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Missing Defender");
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Orphaned", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
      activeSiegeId: undefined, createdAt: now, updatedAt: now,
    }));
    const { retaliationId, siegeId } = await t.run(async (ctx) => {
      const retaliationId = await ctx.db.insert("parshendiRetaliations", {
        playerId, targetPlateauId: plateauId, phase: "launched", active: true,
        hostilityAtFormation: 50, militaryCapacity: 10, seasonDay: 1, power: 100,
        formationAt: now, launchAt: now, createdAt: now, updatedAt: now,
      });
      const siegeId = await ctx.db.insert("sieges", {
        plateauId, defenderId: playerId, targetType: "parshendi_retaliation",
        attackerUnits: emptyUnits(), attackerPower: 100, attackerSpeed: 0,
        fortifyPercent: 0, departAt: now, resolveAt: now, status: "pending",
      });
      await ctx.db.patch(plateauId, { activeSiegeId: siegeId });
      await ctx.db.patch(retaliationId, { siegeId });
      await ctx.db.delete(playerId);
      return { retaliationId, siegeId };
    });
    await t.mutation(internal.plateaus.resolveSiege, { siegeId });
    const result = await t.run(async (ctx) => ({ plateau: await ctx.db.get(plateauId), retaliation: await ctx.db.get(retaliationId) }));
    expect(result.plateau?.activeSiegeId).toBeUndefined();
    expect(result.retaliation).toMatchObject({ active: false, phase: "cancelled" });
  });

  test("malformed duplicate active rows do not create another retaliation or throw", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Duplicate");
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Held", type: "sphere", status: "owned", origin: "neutral", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 500, neutralDefenseRemaining: 0,
      createdAt: now, updatedAt: now,
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("kingdomWorldPressure", { playerId, hostility: 50, decayIntervalsApplied: 0, updatedAt: now });
      for (let index = 0; index < 2; index += 1) await ctx.db.insert("parshendiRetaliations", {
        playerId, targetPlateauId: plateauId, phase: "forming", active: true,
        hostilityAtFormation: 50, militaryCapacity: 10, seasonDay: 1, power: 100,
        formationAt: now + index, launchAt: now + 1000, createdAt: now + index, updatedAt: now,
      });
      await reconcileRetaliationSchedule(ctx, playerId, now);
    });
    const state = await t.run(async (ctx) => ({
      row: await ctx.db.query("kingdomWorldPressure").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique(),
      active: await ctx.db.query("parshendiRetaliations").withIndex("by_playerId_and_active", (q) => q.eq("playerId", playerId).eq("active", true)).collect(),
    }));
    expect(state.active).toHaveLength(2);
    expect(state.row?.retaliationScheduleToken).toBeUndefined();
  });
});
