/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const emptyUnits = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const emptyOperatives = { informant: 0, spy: 0, ghostblood: 0 };

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "roster@example.com" }));
  const playerId = await t.run((ctx) => ctx.db.insert("players", {
    authUserId: String(userId), name: "Roster", normalizedName: "roster", acres: 20,
    spheres: 12345, gemhearts: 2,
    units: { ...emptyUnits, spearman: 8, shardbearer: 1 },
    buildings: { market: 0, watchtower: 0, ardentMonastery: 2, barracks: 2, soulcastBunker: 2, espionageNetwork: 3 },
    operatives: { ...emptyOperatives, informant: 5 }, defendingOperatives: { ...emptyOperatives, informant: 2 },
    ardentiaConclaves: 2, lastActiveAt: 1, createdAt: 1,
  }));
  const readyId = await t.run((ctx) => ctx.db.insert("ardentConclaves", { ownerPlayerId: playerId, name: "Ready", normalizedName: "ready", xp: 0, createdAt: 1, updatedAt: 1 }));
  const awayId = await t.run((ctx) => ctx.db.insert("ardentConclaves", { ownerPlayerId: playerId, name: "Away", normalizedName: "away", xp: 0, missionKind: "raid", missionId: "raid-1", createdAt: 1, updatedAt: 1 }));
  return { t, playerId, readyId, awayId, player: t.withIdentity({ subject: String(userId) }) };
}

describe("safe roster disbanding", () => {
  test("disbands only available personnel, restores provision use, and never refunds resources", async () => {
    const { t, playerId, readyId, player } = await setup();
    const before = await player.query(api.players.getPlayerAccounting, {});
    await expect(player.mutation(api.army.disbandUnits, { unit: "spearman", count: 9 })).rejects.toThrow("Only 8");
    await expect(player.mutation(api.army.disbandUnits, { unit: "spearman", count: 1.5 })).rejects.toThrow("Disband between");
    await expect(player.mutation(api.army.disbandUnits, { unit: "shardbearer", count: 1 })).rejects.toThrow("cannot be disbanded");
    await player.mutation(api.army.disbandUnits, { unit: "spearman", count: 3 });
    await player.mutation(api.espionage.disbandOperatives, { tier: "informant", count: 4 });
    await expect(player.mutation(api.espionage.disbandOperatives, { tier: "informant", count: 2 })).rejects.toThrow("Only 1");
    await player.mutation(api.ardentia.disbandConclave, { conclaveId: readyId });
    const after = await player.query(api.players.getPlayerAccounting, {});
    const row = await t.run((ctx) => ctx.db.get(playerId));
    expect(row?.spheres).toBe(12345);
    expect(row?.gemhearts).toBe(2);
    expect(after!.provisions.used).toBeLessThan(before!.provisions.used);
    expect(row?.units.spearman).toBe(5);
    expect(row?.operatives?.informant).toBe(1);
    expect(row?.defendingOperatives?.informant).toBe(2);
    expect(row?.ardentiaConclaves).toBe(1);
  });

  test("rejects deployed Conclaves without disturbing their mission state", async () => {
    const { t, awayId, player } = await setup();
    await expect(player.mutation(api.ardentia.disbandConclave, { conclaveId: awayId })).rejects.toThrow("deployed");
    expect((await t.run((ctx) => ctx.db.get(awayId)))?.missionId).toBe("raid-1");
  });
});
