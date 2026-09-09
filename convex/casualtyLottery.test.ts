import { expect, test } from "vitest";
import { applySurvivalLosses, baseCasualtyRate, effectivePower, normalizeUnits, unitKeys } from "./rules";

// Preserve the pre-shuffle rounding contract independently of victim selection.
function legacyRoundingRoll(seed: string) {
  let hash = 2166136261;
  for (const character of `${seed}:rounding`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

test("victim selection preserves casualty counts, reproducibility, and troop conservation", () => {
  const units = normalizeUnits({ spearman: 20, shardbearer: 1, bridgeman: 3, chull: 2 });
  for (const rate of [0, 0.03, 0.25, 0.8, 1]) {
    for (let i = 0; i < 200; i++) {
      const seed = `count-contract:${i}`;
      const result = applySurvivalLosses(units, rate, seed);
      const expected = 26 * result.finalCasualtyRate;
      const count = Math.floor(expected) + Number(legacyRoundingRoll(seed) < expected % 1);
      expect(Object.values(result.casualties).reduce((a, b) => a + b, 0)).toBe(count);
      expect(applySurvivalLosses(units, rate, seed)).toEqual(result);
      for (const key of unitKeys()) {
        expect(result.survivors[key] + result.casualties[key]).toBe(units[key]);
        expect(result.survivors[key]).toBeGreaterThanOrEqual(0);
      }
    }
  }
  expect(applySurvivalLosses({}, 0.8, "empty").casualties).toEqual(normalizeUnits({}));
});

test.each([20, 100])("a lone Shardbearer has the same per-unit risk as %i supporting Spearmen", (spearman) => {
  const units = { spearman, shardbearer: 1 };
  const rate = baseCasualtyRate(effectivePower(units), 20);
  const samples = 20000;
  let shardLosses = 0;
  let spearLosses = 0;
  let expectedRate = 0;
  for (let i = 0; i < samples; i++) {
    const result = applySurvivalLosses(units, rate, `lottery:${i}:parshendi_spheres:${1788912345678 + i * 173}`);
    shardLosses += result.casualties.shardbearer;
    spearLosses += result.casualties.spearman;
    expectedRate = result.finalCasualtyRate;
  }
  expect(Math.abs(shardLosses / samples - expectedRate)).toBeLessThan(0.01);
  expect(Math.abs(shardLosses / samples - spearLosses / samples / spearman)).toBeLessThan(0.01);
});

test("all unit types participate equally in the lottery", () => {
  const units = { bridgeman: 1, spearman: 1, chull: 1, scout: 1, heavy: 1, shardbearer: 1 };
  const losses = normalizeUnits({});
  const samples = 20000;
  let expectedRate = 0;
  for (let i = 0; i < samples; i++) {
    const result = applySurvivalLosses(units, 0.5, `all-types:${i}`);
    expectedRate = result.finalCasualtyRate;
    for (const key of unitKeys()) losses[key] += result.casualties[key];
  }
  for (const key of unitKeys()) expect(Math.abs(losses[key] / samples - expectedRate)).toBeLessThan(0.02);
});
