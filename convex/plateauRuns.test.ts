/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { emptyBuildings, emptyUnits, plateauRunFinalSpeed, plateauRunJoinSpeedBonus } from "./rules";

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
  }));
}

describe("Plateau Run join order and winner selection", () => {
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
});
