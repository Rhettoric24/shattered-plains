/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 10, spearman: 5, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const operatives = { informant: 2, spy: 1, ghostblood: 0 };

async function representativePlayer(t: ReturnType<typeof convexTest>, subject: string) {
  const now = 1_000_000;
  return await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      authUserId: subject, name: "Accounting Test", normalizedName: "accounting test", acres: 20,
      spheres: 1200, gemhearts: 2, ardentiaConclaves: 1, units,
      buildings: { market: 1, watchtower: 1, ardentMonastery: 1, barracks: 2, soulcastBunker: 2, espionageNetwork: 1 },
      operatives, defendingOperatives: { informant: 1, spy: 0, ghostblood: 0 },
      lastEconomyAt: now, lastActiveAt: now, createdAt: now,
    });
    await ctx.db.insert("plateaus", { name: "Sphere Test", type: "sphere", status: "owned", ownerPlayerId: playerId, highground: false, large: true, neutralDefenseInitial: 0, neutralDefenseRemaining: 0, createdAt: now, updatedAt: now });
    await ctx.db.insert("playerResearch", { playerId, completedLevels: { marketEconomics: 1 }, createdAt: now, updatedAt: now });
    await ctx.db.insert("raids", { attackerId: playerId, targetType: "parshendi_spheres", units: { ...units, bridgeman: 2, spearman: 0 }, power: 2, speed: 1, departAt: now, arriveAt: now + 1000, status: "pending" });
    await ctx.db.insert("sieges", { plateauId: (await ctx.db.query("plateaus").withIndex("by_owner", (q) => q.eq("ownerPlayerId", playerId)).unique())!._id, attackerId: playerId, targetType: "neutral", attackerUnits: { ...units, bridgeman: 0, spearman: 2 }, attackerPower: 2, attackerSpeed: 1, fortifyPercent: 0, departAt: now, resolveAt: now + 1000, status: "pending" });
    const runId = await ctx.db.insert("plateauRuns", { difficulty: 10, spherePool: 100, gemheartReward: 1, opensAt: now, closesAt: now + 1000, resolvesAt: now + 1000, status: "open" });
    await ctx.db.insert("plateauCommitments", { plateauRunId: runId, playerId, units: { ...units, bridgeman: 0, spearman: 0, scout: 2 }, power: 2, speed: 2, committedAt: now });
    const targetId = await ctx.db.insert("players", { name: "Target", normalizedName: "target", acres: 20, spheres: 100, gemhearts: 0, units: { ...units, bridgeman: 0, spearman: 0 }, buildings: { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0 }, lastActiveAt: now, createdAt: now });
    const seasonId = await ctx.db.insert("seasons", { number: 1, name: "Test", status: "active", startsAt: now });
    await ctx.db.insert("espionageMissions", { attackerId: playerId, targetPlayerId: targetId, seasonId, category: "military", operatives: { informant: 1, spy: 0, ghostblood: 0 }, baseSpyPower: 1, intelSpent: 0, finalSpyPower: 1, departAt: now, resolveAt: now + 1000, status: "pending" });
    return playerId;
  });
}

describe("player summary and accounting boundaries", () => {
  test("preserves provisions, availability modifiers, and economy inputs", async () => {
    const t = convexTest(schema, modules);
    const subject = "accounting-user";
    await representativePlayer(t, subject);
    const player = t.withIdentity({ subject });
    const accounting = await player.query(api.players.getPlayerAccounting, {});
    expect(accounting).toMatchObject({
      completedResearch: { marketEconomics: 1 },
      plateauCounts: { sphere: 1, bridged: 0, gemheart: 0, ancient: 0 },
      plateauAttributes: { large: 1, highground: 0 },
      plateauBonuses: { sphereIncomeBonusPercent: 10, bridgedTravelReductionPercent: 0 },
    });
    expect(accounting!.provisions).toEqual({ used: 41, capacity: 217, remaining: 176, largeBonusPercent: 10 });
    expect(accounting!.economy.incomePerGameDay).toBe(accounting!.buildingStats.totalIncomePerDay);
    const summary = await player.query(api.players.getPlayerSummary, {});
    expect(summary!.player.units).toEqual(units);
    expect(summary!.player.operatives).toEqual(operatives);
  });

  test("keeps unrelated Plateau Runs out of player accounting", async () => {
    const t = convexTest(schema, modules);
    const subject = "unrelated-run-user";
    await representativePlayer(t, subject);
    const player = t.withIdentity({ subject });
    const before = await player.query(api.players.getPlayerAccounting, {});
    await t.run(async (ctx) => { await ctx.db.insert("plateauRuns", { difficulty: 20, spherePool: 100, gemheartReward: 1, opensAt: 2_000_000, closesAt: 2_001_000, resolvesAt: 2_001_000, status: "open" }); });
    expect(await player.query(api.players.getPlayerAccounting, {})).toEqual(before);
  });

  test("returns a compact summary whose output ignores last-active churn", async () => {
    const t = convexTest(schema, modules);
    const subject = "summary-user";
    const playerId = await representativePlayer(t, subject);
    const player = t.withIdentity({ subject });
    const before = await player.query(api.players.getPlayerSummary, {});
    await t.run(async (ctx) => { await ctx.db.patch(playerId, { lastActiveAt: 9_999_999 }); });
    expect(await player.query(api.players.getPlayerSummary, {})).toEqual(before);
    expect(Object.keys(before!.player).sort()).not.toContain("lastActiveAt");
  });
});
