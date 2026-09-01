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
    expect(summary.sieges[0].plateauName).toBe("Mine");
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

  test("the same plateau progressively reveals its identity, traits, and resistance without changing its name", async () => {
    const t = convexTest(schema, modules);
    const subject = "watchtower-territory-viewer";
    const viewerId = await addPlayer(t, subject, "Viewer", 0);
    const plateauId = await addPlateau(t, "The Broken Crown", "neutral");
    await t.run((ctx) => ctx.db.patch(plateauId, { origin: "neutral", baseNeutralDefense: 321, parshendiReclamationCount: 2 }));
    const player = t.withIdentity({ subject });

    const boards = [];
    for (const watchtower of [0, 1, 2, 3]) {
      await t.run(async (ctx) => {
        const viewer = (await ctx.db.get(viewerId))!;
        await ctx.db.patch(viewerId, { buildings: { ...viewer.buildings, watchtower } });
      });
      boards.push(await player.query(api.plateaus.getSiegeBoard, {}));
      expect((await t.run((ctx) => ctx.db.get(plateauId)))?.name).toBe("The Broken Crown");
    }

    expect(boards[0].neutral[0]).toMatchObject({ _id: plateauId, name: "Unsurveyed Plateau", resistance: { mode: "label", label: "Defended" } });
    expect(boards[0].neutral[0]).not.toHaveProperty("type");
    expect(boards[0].neutral[0]).not.toHaveProperty("highground");
    expect(boards[0].neutral[0]).not.toHaveProperty("large");

    expect(boards[1].neutral[0]).toMatchObject({
      _id: plateauId, name: "The Broken Crown", type: "sphere", highground: true, large: true,
      resistance: { mode: "range", label: "Defended", min: 241, max: 400 },
    });
    expect(boards[2].neutral[0]).toMatchObject({
      _id: plateauId, name: "The Broken Crown", type: "sphere", highground: true, large: true,
      resistance: { mode: "estimate", label: "Defended", min: 258, max: 316 },
      baseNeutralDefense: 321, parshendiReclamationCount: 2,
    });
    expect(boards[3].neutral[0]).toEqual(boards[2].neutral[0]);
  });

  test("territory dossiers do not leak a plateau name or traits before level one", async () => {
    const t = convexTest(schema, modules);
    const subject = "territory-dossier-viewer";
    const viewerId = await addPlayer(t, subject, "Viewer", 0);
    const plateauId = await addPlateau(t, "Windscar", "neutral");
    await t.run((ctx) => ctx.db.insert("intelligenceReports", {
      viewerPlayerId: viewerId,
      targetType: "territory",
      plateauId,
      source: "neutral_expedition",
      level: 0,
      observedAt: Date.now(),
      resistance: 287,
      plateauType: "sphere",
      highground: true,
      large: true,
    }));
    const player = t.withIdentity({ subject });
    const hidden = await player.query(api.intelligence.listDossiers, {});
    expect(hidden.territories[0]).toMatchObject({
      targetName: "Unsurveyed Plateau", plateauType: null, highground: false, large: false,
      resistance: { mode: "label", label: "Defended" },
    });

    await t.run(async (ctx) => {
      const viewer = (await ctx.db.get(viewerId))!;
      await ctx.db.patch(viewerId, { buildings: { ...viewer.buildings, watchtower: 1 } });
    });
    const revealed = await player.query(api.intelligence.listDossiers, {});
    expect(revealed.territories[0]).toMatchObject({
      targetName: "Windscar", plateauType: "sphere", highground: true, large: true,
      resistance: { mode: "range", label: "Defended", min: 241, max: 400 },
    });
  });

  test("territory dossiers stop listing a plateau after a rival captures it", async () => {
    const t = convexTest(schema, modules);
    const subject = "captured-territory-viewer";
    const viewerId = await addPlayer(t, subject, "Viewer", 1);
    const rivalId = await addPlayer(t, undefined, "Rival");
    const plateauId = await addPlateau(t, "Former Frontier", "neutral");
    await t.run((ctx) => ctx.db.insert("intelligenceReports", {
      viewerPlayerId: viewerId,
      targetType: "territory",
      plateauId,
      source: "neutral_expedition",
      level: 1,
      observedAt: Date.now(),
      resistance: 287,
      plateauType: "sphere",
      highground: true,
      large: true,
    }));
    const player = t.withIdentity({ subject });
    expect((await player.query(api.intelligence.listDossiers, {})).territories).toHaveLength(1);

    await t.run((ctx) => ctx.db.patch(plateauId, { status: "owned", ownerPlayerId: rivalId }));
    expect((await player.query(api.intelligence.listDossiers, {})).territories).toHaveLength(0);
  });

  test("Siege and Territory Intelligence share the same best valid resistance report", async () => {
    const t = convexTest(schema, modules);
    const subject = "shared-territory-disclosure";
    const viewerId = await addPlayer(t, subject, "Viewer", 0);
    const plateauId = await addPlateau(t, "Lasting Integrity", "neutral");
    await t.run((ctx) => ctx.db.insert("intelligenceReports", {
      viewerPlayerId: viewerId,
      targetType: "territory",
      plateauId,
      source: "neutral_expedition",
      level: 3,
      observedAt: Date.now(),
      resistance: 527,
      plateauType: "sphere",
      highground: true,
      large: true,
    }));

    const player = t.withIdentity({ subject });
    const [board, dossiers] = await Promise.all([
      player.query(api.plateaus.getSiegeBoard, {}),
      player.query(api.intelligence.listDossiers, {}),
    ]);
    expect(board.neutral.find((plateau) => plateau._id === plateauId)?.resistance).toEqual({ mode: "exact", label: "Fortified", value: 527 });
    expect(dossiers.territories.find((report) => report.plateauId === plateauId)?.resistance).toEqual({ mode: "exact", label: "Fortified", value: 527 });
  });
});
