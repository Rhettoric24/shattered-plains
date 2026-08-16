/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createFreshSeason } from "./seasonLedger";
import {
  ESPIONAGE_RULES,
  effectiveLedgerIntelLevel,
  estimateScore,
  operativeProvisions,
  resolveEspionageOutcome,
  secondaryCategory,
  spyPower,
} from "./espionageRules";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0, espionageNetwork: 3 };
const emptyOps = { informant: 0, spy: 0, ghostblood: 0 };

async function addPlayer(t: ReturnType<typeof convexTest>, name: string, authUserId?: string, options?: { network?: number; operatives?: typeof emptyOps; defending?: typeof emptyOps; spheres?: number }) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    ...(authUserId ? { authUserId } : {}), name, normalizedName: name.toLowerCase(), acres: 20,
    spheres: options?.spheres ?? 100_000, gemhearts: 2, units,
    buildings: { ...buildings, espionageNetwork: options?.network ?? 3 },
    operatives: options?.operatives ?? emptyOps, defendingOperatives: options?.defending ?? emptyOps,
    lastActiveAt: 1, createdAt: 1,
  }));
}

async function addHomePlateaus(t: ReturnType<typeof convexTest>, playerId: any) {
  await t.run(async (ctx) => {
    for (const index of [1, 2]) await ctx.db.insert("plateaus", {
      name: `Home ${index}`, type: "sphere", status: "owned", ownerPlayerId: playerId, origin: "home",
      highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0, heldSince: 1, createdAt: 1, updatedAt: 1,
    });
  });
}

describe("espionage rules", () => {
  test("operative tiers trade Sphere efficiency for Provision efficiency", () => {
    expect(spyPower({ informant: 1, spy: 1, ghostblood: 1 })).toBe(10);
    expect(operativeProvisions({ informant: 1, spy: 1, ghostblood: 1 })).toBe(6);
    const rules = ESPIONAGE_RULES.operatives;
    expect(rules.informant.sphereCost / rules.informant.spyPower).toBeLessThan(rules.spy.sphereCost / rules.spy.spyPower);
    expect(rules.spy.sphereCost / rules.spy.spyPower).toBeLessThan(rules.ghostblood.sphereCost / rules.ghostblood.spyPower);
    expect(rules.informant.spyPower / rules.informant.provisionsCost).toBeLessThan(rules.spy.spyPower / rules.spy.provisionsCost);
    expect(rules.spy.spyPower / rules.spy.provisionsCost).toBeLessThan(rules.ghostblood.spyPower / rules.ghostblood.provisionsCost);
  });

  test("resolves deterministic threshold boundaries and zero defense", () => {
    expect(resolveEspionageOutcome(7.4, 10)).toBe("failure");
    expect(resolveEspionageOutcome(7.5, 10)).toBe("partial");
    expect(resolveEspionageOutcome(9.99, 10)).toBe("partial");
    expect(resolveEspionageOutcome(10, 10)).toBe("success");
    expect(resolveEspionageOutcome(14.99, 10)).toBe("success");
    expect(resolveEspionageOutcome(15, 10)).toBe("overwhelm");
    expect(resolveEspionageOutcome(1, 0)).toBe("overwhelm");
  });

  test("decay, estimates, and secondary categories are bounded", () => {
    const now = 1_000_000;
    expect(effectiveLedgerIntelLevel(2, now, now)).toBe(2);
    expect(effectiveLedgerIntelLevel(2, now, now + ESPIONAGE_RULES.decayStepMs)).toBe(1);
    expect(effectiveLedgerIntelLevel(2, now, now + ESPIONAGE_RULES.decayStepMs * 2)).toBe(0);
    const estimate = estimateScore(824);
    expect(estimate.min).toBeLessThanOrEqual(824);
    expect(estimate.max).toBeGreaterThanOrEqual(824);
    expect(secondaryCategory("military", "stable-seed")).not.toBe("military");
  });
});

describe("espionage backend", () => {
  test("recruitment consumes Spheres and shared Provision", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "recruit@example.com" }));
    const playerId = await addPlayer(t, "Recruiter", String(userId), { network: 1, spheres: 10_000 });
    await addHomePlateaus(t, playerId);
    const result = await t.withIdentity({ subject: String(userId) }).mutation(api.espionage.recruitOperatives, { tier: "informant", count: 4 });
    expect(result.sphereCost).toBe(600);
    expect(result.available.informant).toBe(4);
    expect(result.provisions.used).toBe(12);
    const defense = await t.withIdentity({ subject: String(userId) }).mutation(api.espionage.setDefense, { operatives: { informant: 3, spy: 0, ghostblood: 0 } });
    expect(defense.available.informant).toBe(1);
    expect(defense.defending.informant).toBe(3);
    expect(defense.counterIntelligence).toBe(3);
    const rivalId = await addPlayer(t, "Recruit Rival");
    await t.run(async (ctx) => { await createFreshSeason(ctx, 1, 1); });
    await expect(t.withIdentity({ subject: String(userId) }).mutation(api.espionage.launchInvestigation, { targetPlayerId: rivalId, category: "military", operatives: { informant: 2, spy: 0, ghostblood: 0 }, intelSpend: 0 })).rejects.toThrow("Not enough Informants available");
    await expect(t.withIdentity({ subject: String(userId) }).mutation(api.espionage.recruitOperatives, { tier: "spy", count: 1 })).rejects.toThrow("Network level 2");
  });

  test("defenders cannot be sent and determine hidden mission outcomes", async () => {
    const t = convexTest(schema, modules);
    const attackerUser = await t.run(async (ctx) => await ctx.db.insert("users", { email: "attacker@example.com" }));
    const defenderUser = await t.run(async (ctx) => await ctx.db.insert("users", { email: "defender@example.com" }));
    const attackerId = await addPlayer(t, "Attacker", String(attackerUser), { operatives: { informant: 1, spy: 0, ghostblood: 1 } });
    const defenderId = await addPlayer(t, "Defender", String(defenderUser), { defending: { informant: 1, spy: 1, ghostblood: 1 } });
    const seasonId = await t.run(async (ctx) => {
      const id = await createFreshSeason(ctx, 1, 1);
      await ctx.db.insert("seasonScores", { seasonId: id, playerId: defenderId, total: 100, categoryTotals: { military: 40, economy: 30, research: 20, territory: 10 }, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: defenderId, amount: 10, updatedAt: 1 });
      return id;
    });
    expect(seasonId).toBeTruthy();
    const asAttacker = t.withIdentity({ subject: String(attackerUser) });
    const launched = await asAttacker.mutation(api.espionage.launchInvestigation, {
      targetPlayerId: defenderId, category: "military", operatives: { informant: 1, spy: 0, ghostblood: 1 }, intelSpend: 3,
    });
    const statusWhileAway = await asAttacker.query(api.espionage.getStatus, {});
    expect(statusWhileAway.available).toEqual(emptyOps);
    expect(statusWhileAway.onMission).toEqual({ informant: 1, spy: 0, ghostblood: 1 });
    expect(JSON.stringify(statusWhileAway)).not.toContain("defendingOperatives");
    const resolved = await t.mutation(internal.espionage.resolveInvestigation, { missionId: launched.missionId });
    expect(resolved.outcome).toBe("success");
    const after = await asAttacker.query(api.espionage.getStatus, {});
    expect(after.available).toEqual({ informant: 1, spy: 0, ghostblood: 1 });
    expect(after.targets[0].intel).toBe(17);
    const ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    const defender = ledger.rows.find((row) => row.playerId === defenderId)!;
    expect(defender.cells.military.currentLevel).toBe(2);
    expect(["economy", "research", "territory"].filter((category) => (defender.cells as any)[category].currentLevel === 1)).toHaveLength(1);
    expect(defender.total.mode).toBe("incomplete");
    const unchangedScore = await t.run(async (ctx) => await ctx.db.query("seasonScores").withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", seasonId).eq("playerId", defenderId)).unique());
    expect(unchangedScore).toMatchObject({ total: 100, categoryTotals: { military: 40, economy: 30, research: 20, territory: 10 } });
  });

  test("Partial leaves the intended category untouched; Overwhelm grants a real Bonus Discovery", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "outcomes@example.com" }));
    const attackerId = await addPlayer(t, "Investigator", String(userId), { operatives: { informant: 0, spy: 2, ghostblood: 1 } });
    const partialTarget = await addPlayer(t, "Guarded", undefined, { defending: { informant: 2, spy: 2, ghostblood: 0 } });
    const openTarget = await addPlayer(t, "Open", undefined, { defending: emptyOps });
    await t.run(async (ctx) => {
      const seasonId = await createFreshSeason(ctx, 1, 1);
      for (const playerId of [partialTarget, openTarget]) await ctx.db.insert("seasonScores", { seasonId, playerId, total: 40, categoryTotals: { military: 10, economy: 10, research: 10, territory: 10 }, updatedAt: 1 });
    });
    const asAttacker = t.withIdentity({ subject: String(userId) });
    const partial = await asAttacker.mutation(api.espionage.launchInvestigation, { targetPlayerId: partialTarget, category: "research", operatives: { informant: 0, spy: 2, ghostblood: 0 }, intelSpend: 0 });
    const partialResult = await t.mutation(internal.espionage.resolveInvestigation, { missionId: partial.missionId });
    expect(partialResult.outcome).toBe("partial");
    let ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    let row = ledger.rows.find((entry) => entry.playerId === partialTarget)!;
    expect(row.cells.research.currentLevel).toBe(0);
    expect(ESPIONAGE_RULES.intelRewards.partial).toBe(5);

    const overwhelm = await asAttacker.mutation(api.espionage.launchInvestigation, { targetPlayerId: openTarget, category: "economy", operatives: { informant: 0, spy: 0, ghostblood: 1 }, intelSpend: 0 });
    const overwhelmResult = await t.mutation(internal.espionage.resolveInvestigation, { missionId: overwhelm.missionId });
    expect(overwhelmResult.outcome).toBe("overwhelm");
    expect(overwhelmResult.bonusDiscoveryId).toBeTruthy();
    ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    row = ledger.rows.find((entry) => entry.playerId === openTarget)!;
    expect(row.cells.economy.currentLevel).toBe(2);
    expect(row.cells.economy.discoveries).toHaveLength(1);
  });

  test("Failure is anonymous, rival Intel caps independently, and best intelligence survives decay", async () => {
    const t = convexTest(schema, modules);
    const attackerUser = await t.run(async (ctx) => await ctx.db.insert("users", { email: "failure@example.com" }));
    const defenderUser = await t.run(async (ctx) => await ctx.db.insert("users", { email: "warning@example.com" }));
    const attackerId = await addPlayer(t, "Hidden Attacker", String(attackerUser), { network: 1, operatives: { informant: 2, spy: 0, ghostblood: 0 } });
    const defenderId = await addPlayer(t, "Alert Defender", String(defenderUser), { defending: { informant: 0, spy: 0, ghostblood: 1 } });
    const otherId = await addPlayer(t, "Other Rival");
    const observedAt = Date.now() - ESPIONAGE_RULES.decayStepMs - 1000;
    await t.run(async (ctx) => {
      const seasonId = await createFreshSeason(ctx, 1, 1);
      await ctx.db.insert("seasonScores", { seasonId, playerId: defenderId, total: 80, categoryTotals: { military: 20, economy: 20, research: 20, territory: 20 }, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: defenderId, amount: 48, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: otherId, amount: 7, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelligence", { viewerPlayerId: attackerId, targetPlayerId: defenderId, category: "military", achievedLevel: 2, bestLevel: 2, observedScore: 20, observedAt, source: "military_investigation" });
    });
    const asAttacker = t.withIdentity({ subject: String(attackerUser) });
    let ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    expect(ledger.rows.find((row) => row.playerId === defenderId)?.cells.military).toMatchObject({ currentLevel: 1, bestLevel: 2 });
    await t.run(async (ctx) => {
      for (const category of ["economy", "research", "territory"] as const) await ctx.db.insert("kingdomIntelligence", { viewerPlayerId: attackerId, targetPlayerId: defenderId, category, achievedLevel: 1, bestLevel: 1, observedScore: 20, observedAt: Date.now(), source: `${category} test` });
    });
    ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    const estimatedTotal = ledger.rows.find((row) => row.playerId === defenderId)?.total;
    expect(estimatedTotal?.mode).toBe("range");
    expect((estimatedTotal as any).min).toBeLessThanOrEqual(80);
    expect((estimatedTotal as any).max).toBeGreaterThanOrEqual(80);
    const failed = await asAttacker.mutation(api.espionage.launchInvestigation, { targetPlayerId: defenderId, category: "economy", operatives: { informant: 1, spy: 0, ghostblood: 0 }, intelSpend: 0 });
    const result = await t.mutation(internal.espionage.resolveInvestigation, { missionId: failed.missionId });
    expect(result.outcome).toBe("failure");
    const defenderMessages = await t.run(async (ctx) => await ctx.db.query("messages").withIndex("by_to_player", (q) => q.eq("toPlayerId", defenderId)).take(20));
    expect(defenderMessages.some((message) => message.subject === "Espionage Activity Detected")).toBe(true);
    expect(defenderMessages.map((message) => message.body).join(" ")).not.toContain("Hidden Attacker");

    const openTarget = await t.run(async (ctx) => {
      const targetId = await ctx.db.insert("players", { name: "Unprotected", normalizedName: "unprotected", acres: 20, spheres: 100, gemhearts: 0, units, buildings: { ...buildings, espionageNetwork: 0 }, operatives: emptyOps, defendingOperatives: emptyOps, lastActiveAt: 1, createdAt: 1 });
      const season = await ctx.db.query("seasons").withIndex("by_status", (q) => q.eq("status", "active")).unique();
      await ctx.db.insert("seasonScores", { seasonId: season!._id, playerId: targetId, total: 4, categoryTotals: { military: 1, economy: 1, research: 1, territory: 1 }, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 48, updatedAt: 1 });
      return targetId;
    });
    const overwhelmed = await asAttacker.mutation(api.espionage.launchInvestigation, { targetPlayerId: openTarget, category: "territory", operatives: { informant: 1, spy: 0, ghostblood: 0 }, intelSpend: 0 });
    await t.mutation(internal.espionage.resolveInvestigation, { missionId: overwhelmed.missionId });
    const status = await asAttacker.query(api.espionage.getStatus, {});
    expect(status.targets.find((target) => target.playerId === openTarget)?.intel).toBe(50);
    expect(status.targets.find((target) => target.playerId === otherId)?.intel).toBe(7);
  });
});
