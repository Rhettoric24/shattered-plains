/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };

async function addPlayer(t: ReturnType<typeof convexTest>, subject: string | undefined, name: string, watchtower = 0) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    ...(subject ? { authUserId: subject } : {}), name, normalizedName: name.toLowerCase(), acres: 20,
    spheres: 1000, gemhearts: 1, units,
    buildings: { market: 0, watchtower, ardentMonastery: 0, barracks: 0, soulcastBunker: 0 },
    lastEconomyAt: 1000, lastActiveAt: 1000, createdAt: 1000,
  }));
}

async function addPlateau(t: ReturnType<typeof convexTest>, name: string, status: "owned" | "neutral", ownerPlayerId?: Id<"players">, type: "sphere" | "gemheart" = "sphere") {
  return await t.run(async (ctx) => await ctx.db.insert("plateaus", {
    name, type, status, ...(ownerPlayerId ? { ownerPlayerId } : {}), highground: true, large: true,
    neutralDefenseInitial: 321, neutralDefenseRemaining: 287, heldSince: 1000, createdAt: 1000, updatedAt: 1000,
  }));
}

describe("scoped plateau queries", () => {
  test("owned summary returns authoritative inventory and Gemheart timing", async () => {
    const t = convexTest(schema, modules);
    const subject = "plateau-owner";
    const owner = await addPlayer(t, subject, "Owner");
    await addPlateau(t, "Owned Gemheart", "owned", owner, "gemheart");
    const player = t.withIdentity({ subject });
    const summary = await player.query(api.plateaus.getMyPlateauState, {});
    expect(summary.counts).toEqual({ sphere: 0, bridged: 0, gemheart: 1, ancient: 0 });
    expect(summary.mine).toHaveLength(1);
    expect(summary.mine[0]).toMatchObject({ name: "Owned Gemheart", type: "gemheart", typeName: "Gemheart Plateau", large: true });
    expect(summary.mine[0].gemheartProgress).toMatchObject({ lastGemheartAt: 1000 });
    expect(summary.mine[0].gemheartProgress!.nextGemheartAt).toBeGreaterThan(1000);
  });

  test("viewer summary includes only incoming and outgoing sieges", async () => {
    const t = convexTest(schema, modules);
    const subject = "siege-viewer";
    const viewer = await addPlayer(t, subject, "Viewer");
    const attacker = await addPlayer(t, undefined, "Attacker");
    const unrelated = await addPlayer(t, undefined, "Unrelated");
    const mine = await addPlateau(t, "Mine", "owned", viewer);
    const other = await addPlateau(t, "Other", "owned", unrelated);
    await t.run(async (ctx) => {
      await ctx.db.insert("sieges", { plateauId: mine, attackerId: attacker, defenderId: viewer, targetType: "player", attackerUnits: units, attackerPower: 999, attackerSpeed: 1, fortifyPercent: 0, departAt: 1000, resolveAt: 2000, status: "pending" });
      await ctx.db.insert("sieges", { plateauId: other, attackerId: attacker, defenderId: unrelated, targetType: "player", attackerUnits: units, attackerPower: 777, attackerSpeed: 1, fortifyPercent: 0, departAt: 1000, resolveAt: 2000, status: "pending" });
    });
    const summary = await t.withIdentity({ subject }).query(api.plateaus.getMyPlateauState, {});
    expect(summary.sieges).toHaveLength(1);
    expect(summary.sieges[0]).not.toHaveProperty("attackerPower");
    expect(summary.sieges[0]).not.toHaveProperty("attackerUnits");
  });

  test("low-intelligence siege board omits hidden plateau identity and exact resistance", async () => {
    const t = convexTest(schema, modules);
    const subject = "low-intel-viewer";
    await addPlayer(t, subject, "Viewer", 0);
    const rival = await addPlayer(t, undefined, "Rival");
    await addPlateau(t, "Secret Neutral", "neutral");
    await addPlateau(t, "Secret Rival", "owned", rival);
    const board = await t.withIdentity({ subject }).query(api.plateaus.getSiegeBoard, {});
    expect(board.neutral[0]).not.toHaveProperty("type");
    expect(board.neutral[0].resistance).not.toBe(287);
    expect(board.rivals[0]).not.toHaveProperty("type");
    expect(board.rivals[0].name).toBe("Rival holding");
  });
});
