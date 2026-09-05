/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { awardSeasonPoints } from "./seasonLedger";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllEnvs());

async function addAuthUser(t: ReturnType<typeof convexTest>, email: string) {
  return await t.run((ctx) => ctx.db.insert("users", { email }));
}

describe("administrative observer isolation", () => {
  test("admin signup creates no plateaus or population-scaled world capacity", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    const t = convexTest(schema, modules);
    const adminUserId = await addAuthUser(t, "admin@example.com");

    await t.withIdentity({ subject: String(adminUserId) }).mutation(api.players.createPlayer, {
      name: "Production Observer",
    });

    const state = await t.run(async (ctx) => ({
      player: await ctx.db.query("players").withIndex("by_auth_user", (q) => q.eq("authUserId", String(adminUserId))).unique(),
      plateaus: await ctx.db.query("plateaus").take(20),
      world: await ctx.db.query("gameState").withIndex("by_key", (q) => q.eq("key", "main")).unique(),
    }));
    expect(state.player?.isAdminObserver).toBe(true);
    expect(state.plateaus).toHaveLength(0);
    expect(state.world?.openAcres).toBe(0);
    expect(await t.withIdentity({ subject: String(adminUserId) }).query(api.players.listPlayers, {})).toEqual([]);
    await expect(t.withIdentity({ subject: String(adminUserId) }).mutation(api.raids.launchSphereRaid, {
      units: { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 },
    })).rejects.toThrow("Administrative observers cannot launch gameplay operations");
  });

  test("observer cannot receive season points or appear as a rival", async () => {
    const t = convexTest(schema, modules);
    const observerId = await t.run(async (ctx) => ctx.db.insert("players", {
      name: "Observer", normalizedName: "observer", isAdminObserver: true, acres: 20,
      spheres: 1200, gemhearts: 1, units: { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 },
      buildings: { market: 0, watchtower: 0, barracks: 0 }, lastActiveAt: Date.now(), createdAt: Date.now(),
    }));
    const playerId = await t.run(async (ctx) => ctx.db.insert("players", {
      authUserId: "player", name: "Player", normalizedName: "player", acres: 20,
      spheres: 1200, gemhearts: 1, units: { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 },
      buildings: { market: 0, watchtower: 0, barracks: 0, espionageNetwork: 1 }, operatives: { informant: 0, spy: 0, ghostblood: 0 },
      lastActiveAt: Date.now(), createdAt: Date.now(),
    }));
    const seasonId = await t.run((ctx) => ctx.db.insert("seasons", { number: 1, name: "Season 1", status: "active", startsAt: Date.now() }));

    const award = await t.run((ctx) => awardSeasonPoints(ctx, {
      seasonId, playerId: observerId, category: "research", sourceType: "test",
      sourceKey: "observer-test", basePoints: 10, description: "Observer test",
    }));
    const score = await t.run((ctx) => ctx.db.query("seasonScores").withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", seasonId).eq("playerId", observerId)).unique());
    const status = await t.withIdentity({ subject: "player" }).query(api.espionage.getStatus, {});

    expect(award.awarded).toBe(false);
    expect(score).toBeNull();
    expect(status.targets.map((target) => target.playerId)).not.toContain(observerId);
    expect(status.targets.map((target) => target.playerId)).not.toContain(playerId);
  });
});
