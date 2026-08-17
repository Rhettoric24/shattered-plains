/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };

async function addPlayer(t: ReturnType<typeof convexTest>, authUserId: string, monastery = 0) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    authUserId,
    name: "Settings Test",
    normalizedName: "settings test",
    acres: 10,
    spheres: 10_000,
    gemhearts: 3,
    units,
    buildings: { market: 0, watchtower: 0, ardentMonastery: monastery, barracks: 0, soulcastBunker: 0 },
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
  }));
}

describe("player settings and Research disclosure", () => {
  test("defaults mission confirmation on and persists an account choice", async () => {
    const t = convexTest(schema, modules);
    const subject = "settings-user";
    await addPlayer(t, subject);
    const player = t.withIdentity({ subject });
    expect(await player.query(api.settings.get, {})).toMatchObject({
      confirmConsequentialMissions: true,
      researchTeased: false,
    });
    await player.mutation(api.settings.update, { confirmConsequentialMissions: false });
    expect(await player.query(api.settings.get, {})).toMatchObject({ confirmConsequentialMissions: false });
  });

  test("reveals the Research clue from Ancient territory without changing mechanics", async () => {
    const t = convexTest(schema, modules);
    const subject = "ancient-owner";
    const playerId = await addPlayer(t, subject);
    await t.run(async (ctx) => {
      await ctx.db.insert("plateaus", {
        name: "Ancient Test Plateau",
        type: "ancient",
        ownerPlayerId: playerId,
        status: "owned",
        highground: false,
        neutralDefenseInitial: 0,
        neutralDefenseRemaining: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    expect((await t.withIdentity({ subject }).query(api.settings.get, {})).researchTeased).toBe(true);
  });
});
