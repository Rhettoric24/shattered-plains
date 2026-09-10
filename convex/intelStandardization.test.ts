/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { emptyBuildings, emptyUnits, plateauRunSeasonMultiplier, plateauRunRewardMultiplier } from "./rules";
import { discloseLegacyNeutralText } from "./messageIntel";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T15:00:00Z")); });
afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = convexTest(schema, modules);
  const playerId = await t.run(ctx => ctx.db.insert("players", {
    authUserId: "intel-viewer", name: "Viewer", normalizedName: "viewer", acres: 20,
    spheres: 10000, gemhearts: 0, units: emptyUnits(), buildings: emptyBuildings(),
    lastActiveAt: Date.now(), createdAt: Date.now(),
  }));
  return { t, playerId, viewer: t.withIdentity({ subject: "intel-viewer" }) };
}

test("Watchtower controls Chasmfiend and both raid types without raw numbers", async () => {
  const { t, playerId, viewer } = await fixture();
  await t.run(async ctx => {
    await ctx.db.insert("plateauRuns", { status: "open", opensAt: 1, closesAt: Date.now() + 60000,
      resolvesAt: Date.now() + 60000, difficulty: 1234, spherePool: 17654, gemheartReward: 1 });
    for (const targetType of ["parshendi_spheres", "deep_plains"] as const) {
      await ctx.db.insert("raids", { attackerId: playerId, targetType, units: emptyUnits(), power: 100,
        speed: 1, defensePower: 321, rewardSpheres: 4321, departAt: 1, arriveAt: Date.now() + 60000, status: "pending" });
    }
  });
  for (const [watchtower, mode] of ["label", "range", "estimate", "exact"].entries()) {
    await t.run(ctx => ctx.db.patch(playerId, { buildings: { ...emptyBuildings(), watchtower } }));
    const run = (await viewer.query(api.plateauRuns.getCurrent, {}))!.run;
    expect(run).not.toHaveProperty("difficulty");
    expect(run).not.toHaveProperty("spherePool");
    expect(run.difficultyIntel.mode).toBe(mode);
    expect(run.rewardIntel.mode).toBe(mode);
    const raids = await viewer.query(api.raids.listVisibleRaids, {});
    for (const raid of raids) {
      expect(raid).not.toHaveProperty("defensePower");
      expect(raid).not.toHaveProperty("rewardSpheres");
      expect(raid.defenseIntel?.mode).toBe(mode);
      expect(raid.rewardIntel?.mode).toBe(mode);
    }
  }
});

test("retaliation launch Spanreed and both siege queries agree at every Watchtower level", async () => {
  for (const watchtower of [0, 1, 2, 3]) {
    const { t, playerId, viewer } = await fixture();
    const retaliationId = await t.run(async ctx => {
      await ctx.db.patch(playerId, { buildings: { ...emptyBuildings(), watchtower } });
      const plateauId = await ctx.db.insert("plateaus", { name: "Home", type: "sphere", status: "owned", ownerPlayerId: playerId,
        origin: "neutral", highground: false, neutralDefenseInitial: 100, neutralDefenseRemaining: 0,
        createdAt: 1, updatedAt: 1 });
      return ctx.db.insert("parshendiRetaliations", { playerId, targetPlateauId: plateauId, phase: "forming", active: true,
        hostilityAtFormation: 70, militaryCapacity: 100, seasonDay: 1, power: 321, formationAt: 1, launchAt: Date.now(), createdAt: 1, updatedAt: 1 });
    });
    await t.mutation(internal.worldPressure.launchRetaliation, { retaliationId });
    const expected = ["Defended", "241–400", "288–354", "321"][watchtower];
    const inbox = await viewer.query(api.messages.listInbox, {});
    expect(inbox.messages[0].body).toContain(`Power: ${expected}.`);
    const home = await viewer.query(api.plateaus.getMyPlateauState, {});
    const board = await viewer.query(api.plateaus.getSiegeBoard, {});
    expect(home.sieges[0].attackerIntel).toEqual(board.sieges[0].attackerIntel);
    expect(board.sieges[0].attackerIntel?.mode).toBe(["label", "range", "estimate", "exact"][watchtower]);
  }
});

test("only a victory advances the season counter, exactly once", async () => {
  const { t, playerId } = await fixture();
  const seasonId = await t.run(ctx => ctx.db.insert("seasons", { number: 1, name: "Test", status: "active", startsAt: 1 }));
  for (const outcome of ["empty", "failed", "won"] as const) {
    const runId = await t.run(async ctx => {
      const id = await ctx.db.insert("plateauRuns", { status: "open", opensAt: 1, closesAt: 2, resolvesAt: 2,
        difficulty: 100, spherePool: 0, gemheartReward: 1, scoringSeasonId: seasonId });
      if (outcome !== "empty") await ctx.db.insert("plateauCommitments", { plateauRunId: id, playerId,
        units: emptyUnits(), power: outcome === "won" ? 1000 : 1, speed: 1, committedAt: 1 });
      return id;
    });
    await t.mutation(internal.plateauRuns.resolvePlateauRun, { plateauRunId: runId });
    await t.mutation(internal.plateauRuns.resolvePlateauRun, { plateauRunId: runId });
    expect((await t.run(ctx => ctx.db.get(seasonId)))?.chasmfiendsDefeated ?? 0).toBe(outcome === "won" ? 1 : 0);
  }
  expect(plateauRunSeasonMultiplier(0)).toBe(1);
  expect(plateauRunSeasonMultiplier(1)).toBeGreaterThan(1);
  expect(plateauRunSeasonMultiplier(42)).toBe(plateauRunSeasonMultiplier(100));
  expect(plateauRunRewardMultiplier(42)).toBe(1.5);
});

test("legacy messages no longer expose exact neutral Power at low Watchtower", () => {
  expect(discloseLegacyNeutralText("A 321-Power Parshendi force", 0)).not.toContain("321");
  expect(discloseLegacyNeutralText("raising neutral defense to 321 Power", 1)).toContain("241–400");
  expect(discloseLegacyNeutralText("combined Power 1500.00 defeated the Chasmfiend's 1234 Power", 0)).toBe("Chasmfiend Power Mature");
});

test("Watchtower III never reveals rival forces without Military Ledger Intel", async () => {
  const { t, playerId, viewer } = await fixture();
  const rivalId = await t.run(async ctx => {
    await ctx.db.patch(playerId, { buildings: { ...emptyBuildings(), watchtower: 3 } });
    const id = await ctx.db.insert("players", { name: "Rival", normalizedName: "rival", acres: 20, spheres: 0,
      gemhearts: 0, units: emptyUnits(), buildings: emptyBuildings(), lastActiveAt: 1, createdAt: 1 });
    const plateauRunId = await ctx.db.insert("plateauRuns", { status: "open", opensAt: 1, closesAt: Date.now() + 60000,
      resolvesAt: Date.now() + 60000, difficulty: 1234, spherePool: 17654, gemheartReward: 1 });
    await ctx.db.insert("plateauCommitments", { plateauRunId, playerId: id, units: emptyUnits(), power: 321, speed: 20, committedAt: 1 });
    await ctx.db.insert("raids", { attackerId: id, targetPlayerId: playerId, targetType: "player", units: emptyUnits(),
      power: 321, speed: 20, departAt: 1, arriveAt: Date.now() + 60000, status: "pending" });
    return id;
  });
  const resourceId = await t.run(ctx => ctx.db.insert("kingdomIntelResources", {
    viewerPlayerId: playerId, targetPlayerId: rivalId, amount: 0, militaryAmount: 0, updatedAt: 1,
  }));
  for (const [amount, mode] of [[0, "label"], [25, "estimate"], [75, "exact"]] as const) {
    await t.run(ctx => ctx.db.patch(resourceId, { militaryAmount: amount }));
    const raid = (await viewer.query(api.raids.listVisibleRaids, {}))[0];
    const commitment = (await viewer.query(api.plateauRuns.getCurrent, {}))!.commitments[0];
    for (const force of [raid, commitment]) {
      expect(force).not.toHaveProperty("units");
      expect(force).not.toHaveProperty("power");
      expect(force).not.toHaveProperty("speed");
      expect(force.powerIntel?.mode).toBe(mode);
      expect(force.speedIntel?.mode).toBe(mode);
    }
  }
});
