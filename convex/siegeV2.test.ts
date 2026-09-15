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
  test("allows both committed sides to dispatch reinforcements during Encirclement while battle remains locked", async () => {
    const { t, attackerUser, defenderUser, attackerId, defenderId, siegeId } = await setup();
    await t.run((ctx) => ctx.db.patch(siegeId, { encircleEndsAt: Date.now() + 60_000 }));

    await t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.reinforcePlayerSiege, {
      siegeId, units: { ...emptyUnits, bridgeman: 2 },
    });
    await t.withIdentity({ subject: String(defenderUser) }).mutation(api.plateaus.reinforcePlayerSiege, {
      siegeId, units: { ...emptyUnits, bridgeman: 3 },
    });

    const state = await t.run(async (ctx) => ({
      attacker: await ctx.db.get(attackerId),
      defender: await ctx.db.get(defenderId),
      reinforcements: await ctx.db.query("siegeReinforcements").withIndex("by_siegeId", (q) => q.eq("siegeId", siegeId)).collect(),
    }));
    expect(state.attacker?.units.bridgeman).toBe(18);
    expect(state.defender?.units.bridgeman).toBe(17);
    expect(state.reinforcements.map((entry) => entry.side).sort()).toEqual(["attacker", "defender"]);
    await expect(t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.beginSiegeBattle, { siegeId }))
      .rejects.toThrow("Battle cannot begin during Encirclement");
  });

  test("still requires an initial defensive commitment before defender reinforcements", async () => {
    const { t, defenderUser, siegeId } = await setup();
    await t.run((ctx) => ctx.db.patch(siegeId, {
      defenderUnits: undefined,
      defenderPower: undefined,
      defenderSpeed: undefined,
      defenderCommittedAt: undefined,
      encircleEndsAt: Date.now() + 60_000,
    }));
    await expect(t.withIdentity({ subject: String(defenderUser) }).mutation(api.plateaus.reinforcePlayerSiege, {
      siegeId, units: { ...emptyUnits, bridgeman: 1 },
    })).rejects.toThrow("Commit the initial defense before reinforcing");
  });

  test("automatic defense uses the complete primary order, then the complete fallback order", async () => {
    const { t, attackerUser, defenderId } = await setup();
    const primaryPlateauId = await t.run(async (ctx) => {
      await ctx.db.insert("playerSettings", {
        playerId: defenderId,
        confirmConsequentialMissions: true,
        autoDefenseEnabled: true,
        autoDefensePrimary: { ...emptyUnits, bridgeman: 12 },
        autoDefenseSecondary: { ...emptyUnits, bridgeman: 4 },
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("plateaus", {
        name: "Standing Order One", type: "sphere", status: "owned", ownerPlayerId: defenderId,
        highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0,
        heldSince: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    const attacker = t.withIdentity({ subject: String(attackerUser) });
    const primaryLaunch = await attacker.mutation(api.plateaus.launchPlayerSiege, {
      plateauId: primaryPlateauId, units: { ...emptyUnits, bridgeman: 1 },
    });
    expect(primaryLaunch.automaticDefensePreset).toBe("primary");
    expect(await t.run((ctx) => ctx.db.get(primaryLaunch.siegeId))).toMatchObject({
      defenderUnits: { ...emptyUnits, bridgeman: 12 },
      defenderPower: 6,
    });

    const fallbackPlateauId = await t.run(async (ctx) => {
      const settings = await ctx.db.query("playerSettings").withIndex("by_playerId", (q) => q.eq("playerId", defenderId)).unique();
      await ctx.db.patch(settings!._id, {
        autoDefensePrimary: { ...emptyUnits, bridgeman: 9 },
        autoDefenseSecondary: { ...emptyUnits, bridgeman: 4 },
      });
      return await ctx.db.insert("plateaus", {
        name: "Standing Order Two", type: "sphere", status: "owned", ownerPlayerId: defenderId,
        highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0,
        heldSince: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    const fallbackLaunch = await attacker.mutation(api.plateaus.launchPlayerSiege, {
      plateauId: fallbackPlateauId, units: { ...emptyUnits, bridgeman: 1 },
    });
    expect(fallbackLaunch.automaticDefensePreset).toBe("secondary");
    expect(await t.run((ctx) => ctx.db.get(fallbackLaunch.siegeId))).toMatchObject({
      defenderUnits: { ...emptyUnits, bridgeman: 4 },
      defenderPower: 2,
    });
    expect((await t.run((ctx) => ctx.db.get(defenderId)))?.units.bridgeman).toBe(4);
  });

  test("commits and returns a defender Half-Shard when the plateau is held", async () => {
    const { t, defenderUser, defenderId, siegeId } = await setup();
    const inventoryId = await t.run(async (ctx) => {
      await ctx.db.patch(siegeId, {
        defenderUnits: undefined,
        defenderPower: undefined,
        defenderSpeed: undefined,
        defenderCommittedAt: undefined,
        encircleEndsAt: Date.now() + 60_000,
      });
      return await ctx.db.insert("playerFabrials", {
        playerId: defenderId, kind: "halfShard", owned: 1, committed: 0,
        discoveredAt: 1, prototypeGrantedAt: 1, createdAt: 1, updatedAt: 1,
      });
    });
    const defender = t.withIdentity({ subject: String(defenderUser) });

    await defender.mutation(api.plateaus.commitSiegeDefenders, {
      siegeId, units: { ...emptyUnits, bridgeman: 10 }, fabrial: "halfShard",
    });
    expect(await t.run((ctx) => ctx.db.get(inventoryId))).toMatchObject({ owned: 1, committed: 1 });
    expect(await t.run((ctx) => ctx.db.get(siegeId))).toMatchObject({ defenderFabrialKind: "halfShard" });

    await t.mutation(internal.plateaus.resolveSiege, { siegeId });
    const result = await t.run(async (ctx) => ({
      inventory: await ctx.db.get(inventoryId),
      siege: await ctx.db.get(siegeId),
    }));
    expect(result.inventory).toMatchObject({ owned: 1, committed: 0 });
    expect(result.siege).toMatchObject({ defenderHeld: true, defenderFabrialLost: false });
  });

  test("uses persistent Ledger Military Intel, not Watchtower level, for PvP attacker Power", async () => {
    const { t, defenderUser, defenderId, attackerId } = await setup();
    await t.run(async (ctx) => {
      const defender = (await ctx.db.get(defenderId))!;
      await ctx.db.patch(defenderId, { buildings: { ...defender.buildings, watchtower: 3 } });
    });
    const defender = t.withIdentity({ subject: String(defenderUser) });

    const qualitativeBoard = await defender.query(api.plateaus.getSiegeBoard, {});
    const qualitativeSummary = await defender.query(api.plateaus.getMyPlateauState, {});
    expect(qualitativeBoard.sieges[0].attackerIntel).toEqual({ mode: "label", label: "Vulnerable" });
    expect(qualitativeSummary.sieges[0].attackerIntel).toEqual({ mode: "label", label: "Vulnerable" });

    const resourceId = await t.run((ctx) => ctx.db.insert("kingdomIntelResources", {
      viewerPlayerId: defenderId, targetPlayerId: attackerId, amount: 0, militaryAmount: 25, updatedAt: Date.now(),
    }));
    expect((await defender.query(api.plateaus.getSiegeBoard, {})).sieges[0].attackerIntel)
      .toEqual({ mode: "estimate", label: "Vulnerable", min: 3, max: 7 });

    await t.run((ctx) => ctx.db.patch(resourceId, { militaryAmount: 75 }));
    expect((await defender.query(api.plateaus.getSiegeBoard, {})).sieges[0].attackerIntel)
      .toEqual({ mode: "exact", label: "Vulnerable", value: 5 });
  });

  test("uses the defender's Ledger Military Intel in the incoming Spanreed report", async () => {
    const { t, attackerUser, defenderId, attackerId } = await setup();
    const plateauId = await t.run(async (ctx) => {
      await ctx.db.insert("kingdomIntelResources", {
        viewerPlayerId: defenderId, targetPlayerId: attackerId, amount: 0, militaryAmount: 25, updatedAt: Date.now(),
      });
      return await ctx.db.insert("plateaus", {
        name: "Second Plateau", type: "sphere", status: "owned", ownerPlayerId: defenderId,
        highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0,
        heldSince: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    await t.withIdentity({ subject: String(attackerUser) }).mutation(api.plateaus.launchPlayerSiege, {
      plateauId, units: { ...emptyUnits, bridgeman: 5 },
    });
    const report = await t.run(async (ctx) => (await ctx.db
      .query("messages")
      .withIndex("by_to_player_created", (q) => q.eq("toPlayerId", defenderId))
      .order("desc")
      .first()));
    expect(report?.body).toContain("Military Intel assessment:");
    expect(report?.body).toContain("0-5 Power");
    expect(report?.body).not.toContain("Watchtower assessment");
  });

  test("allows Emergency Defenses only during Encirclement", async () => {
    const { t, defenderUser, defenderId, siegeId } = await setup();
    await expect(t.withIdentity({ subject: String(defenderUser) }).mutation(api.plateaus.setEmergencyDefense, { siegeId, percent: 10 }))
      .rejects.toThrow("only be prepared during Encirclement");

    await t.run(async (ctx) => {
      await ctx.db.patch(siegeId, { encircleEndsAt: Date.now() + 60_000 });
    });
    const result = await t.withIdentity({ subject: String(defenderUser) }).mutation(api.plateaus.setEmergencyDefense, { siegeId, percent: 10 });
    expect(result).toMatchObject({ emergencyDefensePercent: 10 });
    const defender = await t.run((ctx) => ctx.db.get(defenderId));
    expect(defender?.spheres).toBeLessThan(10000);
  });

  test("Military Intel estimates use the speed-adjusted reinforcement arrival", async () => {
    const { t, attackerUser, attackerId, defenderId, siegeId } = await setup();
    const now = Date.now();
    const arriveAt = now + 31 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("siegeReinforcements", {
        siegeId,
        playerId: defenderId,
        side: "defender",
        units: { ...emptyUnits, bridgeman: 2 },
        power: 2,
        speed: 2,
        departAt: now,
        arriveAt,
        status: "traveling",
      });
    });

    const estimated = await t.withIdentity({ subject: String(attackerUser) }).query(api.plateaus.getSiegeBoard, {});
    expect(estimated.sieges[0].reinforcements[0]).toMatchObject({ arrivalWindowMinutes: 60 });
    expect(estimated.sieges[0].reinforcements[0]).not.toHaveProperty("arriveAt");

    await t.run(async (ctx) => {
      const intel = await ctx.db.query("kingdomIntelResources")
        .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", attackerId).eq("targetPlayerId", defenderId))
        .unique();
      await ctx.db.patch(intel!._id, { militaryAmount: 75 });
    });
    const exact = await t.withIdentity({ subject: String(attackerUser) }).query(api.plateaus.getSiegeBoard, {});
    expect(exact.sieges[0].reinforcements[0]).toMatchObject({ arriveAt });
  });

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
