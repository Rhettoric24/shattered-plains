/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createFreshSeason } from "./seasonLedger";
import {
  ESPIONAGE_RULES,
  economyIntelDisclosureLevel,
  effectiveLedgerIntelLevel,
  estimateScore,
  operativeProvisions,
  resolveEspionageOutcome,
  secondaryCategory,
  sphereHeistAvailableHaul,
  sphereHeistCasualties,
  sphereHeistPayout,
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

  test("Sphere Heist reuses outcome bands, bounds haul, and removes low tiers first", () => {
    expect(economyIntelDisclosureLevel(24)).toBe(0);
    expect(economyIntelDisclosureLevel(25)).toBe(1);
    expect(economyIntelDisclosureLevel(74)).toBe(1);
    expect(economyIntelDisclosureLevel(75)).toBe(2);
    expect(sphereHeistAvailableHaul(8_000)).toBe(1_000);
    expect(sphereHeistAvailableHaul(100_000)).toBe(5_000);
    expect(sphereHeistAvailableHaul(300_000)).toBe(10_000);
    expect(sphereHeistAvailableHaul(500)).toBe(500);
    expect(sphereHeistPayout(100_000, "success")).toBe(2_500);
    expect(sphereHeistPayout(100_000, "overwhelm")).toBe(5_000);
    expect(sphereHeistPayout(100_000, "failure")).toBe(0);
    const catastrophic = sphereHeistCasualties({ informant: 1, spy: 1, ghostblood: 8 }, "failure");
    expect(catastrophic.lost).toBe(2);
    expect(catastrophic.casualties).toEqual({ informant: 1, spy: 1, ghostblood: 0 });
    expect(sphereHeistCasualties({ informant: 10, spy: 0, ghostblood: 0 }, "partial").lost).toBe(1);
    expect(sphereHeistCasualties({ informant: 10, spy: 0, ghostblood: 0 }, "success").lost).toBe(0);
    expect(ESPIONAGE_RULES.sphereHeist.identityExposed).toEqual({ failure: true, partial: false, success: true, overwhelm: false });
  });
});

describe("espionage backend", () => {
  test("legacy kingdoms receive a season and visible locked espionage defaults without a reset", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "legacy@example.com" }));
    const playerId = await t.run(async (ctx) => await ctx.db.insert("players", {
      authUserId: String(userId), name: "Legacy Warcamp", normalizedName: "legacy warcamp", acres: 20,
      spheres: 10_000, gemhearts: 2, units,
      buildings: { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0 },
      lastActiveAt: 1, createdAt: 1,
    }));

    await t.mutation(api.game.bootstrapWorld, {});
    const asLegacyPlayer = t.withIdentity({ subject: String(userId) });
    const status = await asLegacyPlayer.query(api.espionage.getStatus, {});
    expect(status.networkLevel).toBe(0);
    expect(Object.keys(status.rules.operatives).sort()).toEqual(["ghostblood", "informant", "spy"]);
    expect(status.available).toEqual(emptyOps);

    const ledger = await asLegacyPlayer.query(api.espionage.getKingdomLedger, {});
    expect(ledger.locked).toBe(true);
    expect(ledger.rows).toEqual([]);
  });

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
    const ownRow = ledger.rows.find((row) => row.playerId === attackerId)!;
    const defender = ledger.rows.find((row) => row.playerId === defenderId)!;
    expect(ownRow.cells.military.presentation).toMatchObject({ mode: "exact", display: "0", label: "Unblooded" });
    expect(defender.cells.military.currentLevel).toBe(2);
    expect(defender.cells.military.presentation).not.toHaveProperty("label");
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
    expect(row.cells.economy.currentLevel).toBe(0);
    expect(row.cells.economy.economyIntel).toBe(15);
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

  test("Sphere Heist requires and authoritatively spends Economy Intel, lowering disclosure", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "heist-gate@example.com" }));
    const attackerId = await addPlayer(t, "Heist Gate", String(userId), { operatives: { informant: 3, spy: 0, ghostblood: 0 } });
    const targetId = await addPlayer(t, "Ledger Target");
    const deletedTargetId = await addPlayer(t, "Stale Target");
    await t.run(async (ctx) => {
      const seasonId = await createFreshSeason(ctx, 1, 1);
      await ctx.db.insert("seasonScores", { seasonId, playerId: targetId, total: 40, categoryTotals: { military: 0, economy: 40, research: 0, territory: 0 }, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelligence", { viewerPlayerId: attackerId, targetPlayerId: targetId, category: "economy", achievedLevel: 2, bestLevel: 2, observedScore: 40, observedAt: Date.now(), source: "Economy Investigation" });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 7, economyAmount: 100, updatedAt: 1 });
      await ctx.db.delete(deletedTargetId);
    });
    const asAttacker = t.withIdentity({ subject: String(userId) });
    let ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    expect(ledger.rows.find((row) => row.playerId === targetId)?.cells.economy).toMatchObject({ currentLevel: 2, economyIntel: 100, presentation: { mode: "exact", display: "40" } });
    const first = await asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } });
    expect(first).toMatchObject({ economyIntelSpent: 50, economyIntelRemaining: 50 });
    let status = await asAttacker.query(api.espionage.getStatus, {});
    expect(status.targets.find((target) => target.playerId === targetId)?.economyIntel).toBe(50);
    expect(status.targets.find((target) => target.playerId === targetId)).not.toHaveProperty("spheres");
    ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    expect(ledger.rows.find((row) => row.playerId === targetId)?.cells.economy).toMatchObject({ currentLevel: 1, bestLevel: 2, economyIntel: 50, presentation: { mode: "range" } });
    expect(ledger.rows.find((row) => row.playerId === targetId)?.cells.economy.presentation.mode).not.toBe("exact");
    const second = await asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } });
    expect(second).toMatchObject({ economyIntelSpent: 50, economyIntelRemaining: 0 });
    status = await asAttacker.query(api.espionage.getStatus, {});
    expect(status.targets.find((target) => target.playerId === targetId)?.economyIntel).toBe(0);
    ledger = await asAttacker.query(api.espionage.getKingdomLedger, {});
    expect(ledger.rows.find((row) => row.playerId === targetId)?.cells.economy).toMatchObject({ currentLevel: 0, bestLevel: 2, economyIntel: 0, presentation: { mode: "qualitative" } });
    await expect(asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } })).rejects.toThrow("requires 50 Economy Intel");
    await expect(asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: attackerId, operatives: { informant: 1, spy: 0, ghostblood: 0 } })).rejects.toThrow("Choose a rival kingdom");
    await expect(asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: deletedTargetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } })).rejects.toThrow("Target kingdom not found");

  });

  test("legacy Economy reports provide a safe one-time authoritative Economy Intel fallback", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "legacy-economy@example.com" }));
    const attackerId = await addPlayer(t, "Legacy Economy", String(userId), { operatives: { informant: 1, spy: 0, ghostblood: 0 } });
    const targetId = await addPlayer(t, "Legacy Target");
    await t.run(async (ctx) => {
      await createFreshSeason(ctx, 1, 1);
      await ctx.db.insert("kingdomIntelligence", { viewerPlayerId: attackerId, targetPlayerId: targetId, category: "economy", achievedLevel: 1, bestLevel: 1, observedScore: 10, observedAt: Date.now(), source: "Legacy Economy Investigation" });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 12, updatedAt: 1 });
    });
    const asAttacker = t.withIdentity({ subject: String(userId) });
    expect((await asAttacker.query(api.espionage.getStatus, {})).targets.find((target) => target.playerId === targetId)?.economyIntel).toBe(50);
    await asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } });
    const resource = await t.run(async (ctx) => await ctx.db.query("kingdomIntelResources").withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", attackerId).eq("targetPlayerId", targetId)).unique());
    expect(resource).toMatchObject({ amount: 12, economyAmount: 0 });
  });

  test("Economy investigations cap Economy Intel at 100 without changing other rival Intel", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "economy-cap@example.com" }));
    const attackerId = await addPlayer(t, "Economy Cap", String(userId), { operatives: { informant: 0, spy: 0, ghostblood: 1 } });
    const targetId = await addPlayer(t, "Open Treasury", undefined, { defending: emptyOps });
    await t.run(async (ctx) => {
      const seasonId = await createFreshSeason(ctx, 1, 1);
      await ctx.db.insert("seasonScores", { seasonId, playerId: targetId, total: 10, categoryTotals: { military: 0, economy: 10, research: 0, territory: 0 }, updatedAt: 1 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 13, economyAmount: 95, updatedAt: 1 });
    });
    const asAttacker = t.withIdentity({ subject: String(userId) });
    const mission = await asAttacker.mutation(api.espionage.launchInvestigation, { targetPlayerId: targetId, category: "economy", operatives: { informant: 0, spy: 0, ghostblood: 1 }, intelSpend: 0 });
    await t.mutation(internal.espionage.resolveInvestigation, { missionId: mission.missionId });
    const targetStatus = (await asAttacker.query(api.espionage.getStatus, {})).targets.find((target) => target.playerId === targetId);
    expect(targetStatus).toMatchObject({ intel: 13, economyIntel: 100, economyIntelCap: 100 });
  });

  test("all four existing outcome bands map to Heist payout, casualties, exposure, and persistent reports", async () => {
    const cases = [
      { outcome: "failure", commitment: { informant: 1, spy: 0, ghostblood: 0 }, defending: { informant: 0, spy: 0, ghostblood: 1 }, stolen: 0, lost: 1, exposed: true },
      { outcome: "partial", commitment: { informant: 5, spy: 0, ghostblood: 0 }, defending: { informant: 0, spy: 0, ghostblood: 1 }, stolen: 0, lost: 1, exposed: false },
      { outcome: "success", commitment: { informant: 0, spy: 0, ghostblood: 1 }, defending: { informant: 0, spy: 0, ghostblood: 1 }, stolen: 2_500, lost: 0, exposed: true },
      { outcome: "overwhelm", commitment: { informant: 0, spy: 3, ghostblood: 0 }, defending: { informant: 0, spy: 0, ghostblood: 1 }, stolen: 5_000, lost: 0, exposed: false },
    ] as const;
    for (const entry of cases) {
      const t = convexTest(schema, modules);
      const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: `${entry.outcome}@example.com` }));
      const attackerId = await addPlayer(t, `Attacker ${entry.outcome}`, String(userId), { operatives: entry.commitment, spheres: 10_000 });
      const targetId = await addPlayer(t, `Victim ${entry.outcome}`, undefined, { defending: entry.defending, spheres: 100_000 });
      await t.run(async (ctx) => {
        await createFreshSeason(ctx, 1, 1);
        await ctx.db.patch(attackerId, { lastEconomyAt: Date.now() + 1_000_000_000 });
        await ctx.db.patch(targetId, { lastEconomyAt: Date.now() + 1_000_000_000 });
        await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 4, economyAmount: 50, updatedAt: 1 });
      });
      const asAttacker = t.withIdentity({ subject: String(userId) });
      const launched = await asAttacker.mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: entry.commitment });
      expect((await asAttacker.query(api.espionage.getStatus, {})).targets.find((target) => target.playerId === targetId)?.economyIntel).toBe(0);
      const result = await t.mutation(internal.espionage.resolveInvestigation, { missionId: launched.missionId });
      expect(result).toMatchObject({ outcome: entry.outcome, spheresStolen: entry.stolen, operativesLost: entry.lost, identityExposed: entry.exposed });
      const state = await t.run(async (ctx) => ({
        attacker: await ctx.db.get(attackerId), target: await ctx.db.get(targetId),
        victimNotifications: await ctx.db.query("notifications").withIndex("by_playerId_and_createdAt", (q) => q.eq("playerId", targetId)).take(10),
        attackerMessages: await ctx.db.query("messages").withIndex("by_to_player", (q) => q.eq("toPlayerId", attackerId)).take(10),
      }));
      expect(state.target?.spheres).toBe(100_000 - entry.stolen);
      expect(state.attacker?.spheres).toBe(10_000 + entry.stolen);
      expect(Object.values(state.attacker?.operatives ?? {}).reduce((sum, count) => sum + count, 0)).toBe(Object.values(entry.commitment).reduce((sum, count) => sum + count, 0) - entry.lost);
      const victimBody = state.victimNotifications.map((notification) => notification.body).join(" ");
      expect(victimBody.includes(`Attacker ${entry.outcome}`)).toBe(entry.exposed);
      expect(state.attackerMessages.map((message) => message.body).join(" ")).toContain(`Spheres stolen: ${entry.stolen.toLocaleString()}`);
      expect(state.attackerMessages.map((message) => message.body).join(" ")).toContain(`Operatives lost: ${entry.lost}`);
    }
  });

  test("Heist resolution uses the current treasury and duplicate resolution cannot transfer twice", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "heist-race@example.com" }));
    const attackerId = await addPlayer(t, "Race Attacker", String(userId), { operatives: { informant: 1, spy: 0, ghostblood: 0 }, spheres: 2_000 });
    const targetId = await addPlayer(t, "Race Victim", undefined, { defending: emptyOps, spheres: 300_000 });
    await t.run(async (ctx) => {
      await createFreshSeason(ctx, 1, 1);
      await ctx.db.patch(attackerId, { lastEconomyAt: Date.now() + 1_000_000_000 });
      await ctx.db.patch(targetId, { lastEconomyAt: Date.now() + 1_000_000_000 });
      await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: targetId, amount: 0, economyAmount: 50, updatedAt: 1 });
    });
    const launched = await t.withIdentity({ subject: String(userId) }).mutation(api.espionage.launchSphereHeist, { targetPlayerId: targetId, operatives: { informant: 1, spy: 0, ghostblood: 0 } });
    await t.run(async (ctx) => await ctx.db.patch(targetId, { spheres: 12_000 }));
    const first = await t.mutation(internal.espionage.resolveInvestigation, { missionId: launched.missionId });
    expect(first).toMatchObject({ outcome: "overwhelm", spheresStolen: 1_000 });
    const afterFirst = await t.run(async (ctx) => ({ attacker: await ctx.db.get(attackerId), target: await ctx.db.get(targetId) }));
    expect(afterFirst.attacker?.spheres).toBe(3_000);
    expect(afterFirst.target?.spheres).toBe(11_000);
    const duplicate = await t.mutation(internal.espionage.resolveInvestigation, { missionId: launched.missionId });
    expect(duplicate).toEqual({ resolved: false });
    const afterDuplicate = await t.run(async (ctx) => ({ attacker: await ctx.db.get(attackerId), target: await ctx.db.get(targetId) }));
    expect(afterDuplicate).toEqual(afterFirst);
  });
});
