/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const emptyUnits = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 1, soulcastBunker: 0, espionageNetwork: 3 };
const emptyOps = { informant: 0, spy: 0, ghostblood: 0 };

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const attackerUser = await ctx.db.insert("users", { email: "siege-attacker@example.com" });
    const defenderUser = await ctx.db.insert("users", { email: "siege-defender@example.com" });
    const attackerId = await ctx.db.insert("players", { authUserId: String(attackerUser), name: "Attacker", normalizedName: "attacker", acres: 20, spheres: 10000, gemhearts: 0, units: { ...emptyUnits, bridgeman: 20 }, buildings, operatives: { ...emptyOps, ghostblood: 1 }, defendingOperatives: emptyOps, lastActiveAt: now, createdAt: now });
    const defenderId = await ctx.db.insert("players", { authUserId: String(defenderUser), name: "Defender", normalizedName: "defender", acres: 20, spheres: 10000, gemhearts: 0, units: { ...emptyUnits, bridgeman: 20 }, buildings, operatives: emptyOps, defendingOperatives: emptyOps, lastActiveAt: now, createdAt: now });
    const plateauId = await ctx.db.insert("plateaus", { name: "Test Plateau", type: "sphere", status: "owned", ownerPlayerId: defenderId, highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0, heldSince: now, createdAt: now, updatedAt: now });
    const siegeId = await ctx.db.insert("sieges", { plateauId, attackerId, defenderId, targetType: "player", attackerUnits: { ...emptyUnits, bridgeman: 5 }, attackerPower: 5, attackerSpeed: 5, defenderUnits: { ...emptyUnits, bridgeman: 4 }, defenderPower: 4, defenderSpeed: 4, defenderCommittedAt: now - 1, fortifyPercent: 0, siegeVersion: 2, encircleEndsAt: now - 1, departAt: now - 3_600_001, resolveAt: now + 86_400_000, status: "pending" });
    await ctx.db.patch(plateauId, { activeSiegeId: siegeId });
    await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attackerId, targetPlayerId: defenderId, amount: 50, militaryAmount: 50, updatedAt: now });
    return { attackerUser, defenderUser, attackerId, defenderId, siegeId };
  });
  return { t, ...ids };
}

describe("PvP Siege V2", () => {
  test("a siege investigation spends Military Intel and overwhelm reveals the present force", async () => {
    const { t, attackerUser, attackerId, defenderId, siegeId } = await setup();
    const launched = await t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.launchSiegeInvestigation, { siegeId, operatives: { ...emptyOps, ghostblood: 1 } });
    const spent = await t.run(ctx => ctx.db.query("kingdomIntelResources").withIndex("by_viewerPlayerId_and_targetPlayerId", q => q.eq("viewerPlayerId", attackerId).eq("targetPlayerId", defenderId)).unique());
    expect(spent?.militaryAmount).toBe(0);
    const resolved = await t.mutation(internal.plateaus.resolveSiegeInvestigation, { investigationId: launched.investigationId });
    expect(resolved).toMatchObject({ resolved: true, outcome: "overwhelm" });
    const investigation = await t.run(ctx => ctx.db.get(launched.investigationId));
    expect(investigation?.report).toMatchObject({ power: 4, units: { bridgeman: 4 } });
  });

  test("starting battle refunds pending investigation Intel and returns its operatives", async () => {
    const { t, attackerUser, attackerId, defenderId, siegeId } = await setup();
    await t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.launchSiegeInvestigation, { siegeId, operatives: { ...emptyOps, ghostblood: 1 } });
    await t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.beginSiegeBattle, { siegeId });
    const state = await t.run(async ctx => ({
      player: await ctx.db.get(attackerId),
      resource: await ctx.db.query("kingdomIntelResources").withIndex("by_viewerPlayerId_and_targetPlayerId", q => q.eq("viewerPlayerId", attackerId).eq("targetPlayerId", defenderId)).unique(),
      investigations: await ctx.db.query("siegeInvestigations").withIndex("by_siegeId", q => q.eq("siegeId", siegeId)).take(10),
    }));
    expect(state.resource?.militaryAmount).toBe(50);
    expect(state.player?.operatives?.ghostblood).toBe(1);
    expect(state.investigations[0].status).toBe("cancelled");
  });
});
