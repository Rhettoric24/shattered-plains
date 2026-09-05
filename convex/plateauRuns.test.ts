/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  emptyBuildings,
  emptyUnits,
  plateauRunBaseDifficulty,
  plateauRunFinalSpeed,
  plateauRunJoinSpeedBonus,
  plateauRunPowerLabel,
  plateauRunRewardMultiplier,
  plateauRunSeasonMultiplier,
} from "./rules";

const modules = import.meta.glob("./**/*.ts");

async function addPlayer(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run((ctx) => ctx.db.insert("players", {
    name,
    normalizedName: name.toLowerCase(),
    acres: 20,
    spheres: 0,
    gemhearts: 0,
    units: emptyUnits(),
    buildings: emptyBuildings(),
    lastActiveAt: 1,
    createdAt: 1,
  }));
}

async function resolveTwoPlayerRun(args: {
  firstPower: number;
  firstSpeed: number;
  secondPower: number;
  secondSpeed: number;
}) {
  const t = convexTest(schema, modules);
  const firstPlayerId = await addPlayer(t, "First");
  const secondPlayerId = await addPlayer(t, "Second");
  const plateauRunId = await t.run(async (ctx) => {
    const runId = await ctx.db.insert("plateauRuns", {
      status: "open",
      opensAt: 1,
      closesAt: 2,
      resolvesAt: 2,
      difficulty: 1,
      spherePool: 0,
      gemheartReward: 1,
    });
    await ctx.db.insert("plateauCommitments", {
      plateauRunId: runId,
      playerId: firstPlayerId,
      units: emptyUnits(),
      power: args.firstPower,
      speed: args.firstSpeed,
      committedAt: 1,
    });
    await ctx.db.insert("plateauCommitments", {
      plateauRunId: runId,
      playerId: secondPlayerId,
      units: emptyUnits(),
      power: args.secondPower,
      speed: args.secondSpeed,
      committedAt: 2,
    });
    return runId;
  });

  await t.mutation(internal.plateauRuns.resolvePlateauRun, { plateauRunId });
  return await t.run(async (ctx) => ({
    run: await ctx.db.get(plateauRunId),
    first: await ctx.db.get(firstPlayerId),
    second: await ctx.db.get(secondPlayerId),
    pressures: await ctx.db.query("kingdomWorldPressure").collect(),
    messages: await ctx.db.query("messages").collect(),
  }));
}

describe("Plateau Run join order and winner selection", () => {
  test("ramps a four-player Chasmfiend from 750 to 2750 Power over fourteen days", () => {
    const startsAt = 1_000_000;
    const fullStrengthAt = startsAt + 14 * 24 * 60 * 60 * 1000;
    expect(plateauRunBaseDifficulty(4)).toBe(750);
    expect(plateauRunSeasonMultiplier(startsAt, startsAt)).toBe(1);
    expect(plateauRunSeasonMultiplier(startsAt, fullStrengthAt)).toBeCloseTo(11 / 3);
    expect(plateauRunBaseDifficulty(4) * plateauRunSeasonMultiplier(startsAt, fullStrengthAt)).toBeCloseTo(2750);
  });

  test("uses Chasmfiend maturity labels for Plateau Run Power", () => {
    expect([899, 900, 1400, 2000, 2500].map(plateauRunPowerLabel)).toEqual([
      "Young",
      "Mature",
      "Ancient",
      "Colossal",
      "Legendary",
    ]);
  });

  test("ramps a four-player Sphere pool from 18000 to 27000 before variance", () => {
    const startsAt = 1_000_000;
    const fullStrengthAt = startsAt + 14 * 24 * 60 * 60 * 1000;
    const fourPlayerPool = 6000 + 4 * 3000;
    expect(fourPlayerPool * plateauRunRewardMultiplier(startsAt, startsAt)).toBe(18000);
    expect(fourPlayerPool * plateauRunRewardMultiplier(startsAt, fullStrengthAt)).toBe(27000);
  });

  test("uses 10%, 7%, 5%, then 0% join-order Speed bonuses", () => {
    expect([0, 1, 2, 3].map((index) => plateauRunJoinSpeedBonus(index))).toEqual([0.1, 0.07, 0.05, 0]);
    expect([0, 1, 2, 3].map((index) => plateauRunFinalSpeed(100, index))).toEqual([110.00000000000001, 107, 105, 100]);
  });

  test("awards the Gemheart to a later joiner with the highest final Speed", async () => {
    const result = await resolveTwoPlayerRun({ firstPower: 100, firstSpeed: 100, secondPower: 20, secondSpeed: 120 });
    expect(result.run?.winnerPlayerId).toBe(result.second?._id);
    expect(result.first?.gemhearts).toBe(0);
    expect(result.second?.gemhearts).toBe(1);
  });

  test("awards the Gemheart to the first joiner when 10% makes its final Speed highest", async () => {
    const result = await resolveTwoPlayerRun({ firstPower: 20, firstSpeed: 120, secondPower: 100, secondSpeed: 120 });
    expect(result.run?.winnerPlayerId).toBe(result.first?._id);
    expect(result.first?.gemhearts).toBe(1);
    expect(result.second?.gemhearts).toBe(0);
  });

  test("raises Hostility for every participant and sends each warcamp a complete outcome report", async () => {
    const result = await resolveTwoPlayerRun({ firstPower: 20, firstSpeed: 120, secondPower: 100, secondSpeed: 120 });
    expect(result.pressures).toHaveLength(2);
    expect(result.pressures.map((row) => row.hostility).sort()).toEqual([6, 6]);
    expect(result.messages).toHaveLength(2);
    for (const message of result.messages) {
      expect(message.body).toContain("combined Power");
      expect(message.body).toContain("Your contribution:");
      expect(message.body).toContain("Gemheart race: Final Speed");
      expect(message.body).toContain("Reward:");
      expect(message.body).toContain("Casualties:");
    }
  });

  test("uses persistent Military Intel to disclose rival Plateau Run Power", async () => {
    const t = convexTest(schema, modules);
    const viewerId = await addPlayer(t, "Viewer");
    const rivalId = await addPlayer(t, "Rival");
    await t.run((ctx) => ctx.db.patch(viewerId, { authUserId: "plateau-viewer" }));
    await t.run(async (ctx) => {
      const plateauRunId = await ctx.db.insert("plateauRuns", {
        status: "open", opensAt: 1, closesAt: Date.now() + 60_000, resolvesAt: Date.now() + 60_000,
        difficulty: 1000, spherePool: 1000, gemheartReward: 1,
      });
      await ctx.db.insert("plateauCommitments", {
        plateauRunId, playerId: rivalId, units: emptyUnits(), power: 1000, speed: 20, committedAt: 1,
      });
    });
    const viewer = t.withIdentity({ subject: "plateau-viewer" });

    const qualitative = (await viewer.query(api.plateauRuns.getCurrent, {}))?.commitments[0];
    expect(qualitative?.powerIntel).toEqual({ mode: "label", label: "Impregnable" });
    expect(qualitative).not.toHaveProperty("power");
    expect(qualitative).not.toHaveProperty("units");

    const resourceId = await t.run((ctx) => ctx.db.insert("kingdomIntelResources", {
      viewerPlayerId: viewerId, targetPlayerId: rivalId, amount: 0, militaryAmount: 25, updatedAt: 1,
    }));
    expect((await viewer.query(api.plateauRuns.getCurrent, {}))?.commitments[0].powerIntel)
      .toEqual({ mode: "estimate", label: "Impregnable", min: 900, max: 1100 });

    await t.run((ctx) => ctx.db.patch(resourceId, { militaryAmount: 75 }));
    expect((await viewer.query(api.plateauRuns.getCurrent, {}))?.commitments[0].powerIntel)
      .toEqual({ mode: "exact", label: "Impregnable", value: 1000 });
  });

  test("reserves a reusable Fabrial for a Plateau Run and returns it on cancellation", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Fabrial Runner");
    await t.run((ctx) => ctx.db.patch(playerId, {
      authUserId: "fabrial-runner",
      units: { ...emptyUnits(), bridgeman: 5 },
    }));
    const { plateauRunId, inventoryId } = await t.run(async (ctx) => ({
      plateauRunId: await ctx.db.insert("plateauRuns", {
        status: "open", opensAt: Date.now() - 1_000, closesAt: Date.now() + 60_000,
        resolvesAt: Date.now() + 60_000, difficulty: 10, spherePool: 1_000, gemheartReward: 1,
      }),
      inventoryId: await ctx.db.insert("playerFabrials", {
        playerId, kind: "halfShard", owned: 1, committed: 0,
        discoveredAt: 1, prototypeGrantedAt: 1, createdAt: 1, updatedAt: 1,
      }),
    }));
    const runner = t.withIdentity({ subject: "fabrial-runner" });

    await runner.mutation(api.plateauRuns.joinPlateauRun, {
      plateauRunId, units: { ...emptyUnits(), bridgeman: 5 }, fabrial: "halfShard",
    });
    expect((await t.run((ctx) => ctx.db.get(inventoryId)))?.committed).toBe(1);

    await runner.mutation(api.plateauRuns.joinPlateauRun, {
      plateauRunId, units: { ...emptyUnits(), bridgeman: 5 }, fabrial: "halfShard",
    });
    expect((await t.run((ctx) => ctx.db.get(inventoryId)))?.committed).toBe(1);

    await runner.mutation(api.plateauRuns.cancelPlateauRunCommitment, { plateauRunId });
    const inventory = await t.run((ctx) => ctx.db.get(inventoryId));
    expect(inventory).toMatchObject({ owned: 1, committed: 0 });
  });

  test("applies Soulcaster recovery and returns it after a successful Plateau Run", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Soulcast Runner");
    const { plateauRunId, commitmentId, inventoryId } = await t.run(async (ctx) => {
      const plateauRunId = await ctx.db.insert("plateauRuns", {
        status: "open", opensAt: 1, closesAt: 2, resolvesAt: 2,
        difficulty: 1, spherePool: 1_000, gemheartReward: 1,
      });
      const commitmentId = await ctx.db.insert("plateauCommitments", {
        plateauRunId, playerId, units: { ...emptyUnits(), bridgeman: 10 },
        power: 10, speed: 10, fabrialKind: "soulcaster", committedAt: 1,
      });
      const inventoryId = await ctx.db.insert("playerFabrials", {
        playerId, kind: "soulcaster", owned: 1, committed: 1,
        discoveredAt: 1, prototypeGrantedAt: 1, createdAt: 1, updatedAt: 1,
      });
      return { plateauRunId, commitmentId, inventoryId };
    });

    await t.mutation(internal.plateauRuns.resolvePlateauRun, { plateauRunId });
    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      commitment: await ctx.db.get(commitmentId),
      inventory: await ctx.db.get(inventoryId),
      message: await ctx.db.query("messages").first(),
    }));
    expect(result.player?.spheres).toBe(505);
    expect(result.commitment?.fabrialSoulcasterBonus).toBe(495);
    expect(result.inventory).toMatchObject({ owned: 1, committed: 0 });
    expect(result.message?.body).toContain("Soulcaster recovered an additional 495 Spheres");
  });
});
