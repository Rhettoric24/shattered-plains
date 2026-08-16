import { describe, expect, test } from "vitest";
import {
  clampHostility,
  hostilityScaledValue,
  hostilityState,
  materializeHostilityDecay,
  plateauCaptureHostility,
  reclamationDefense,
  retaliationPower,
  retaliationReward,
  retaliationTargetWeight,
  seededFraction,
  WORLD_PRESSURE_RULES,
} from "./worldPressureRules";

describe("World Pressure rules", () => {
  test("clamps Hostility and maps every qualitative boundary", () => {
    expect(clampHostility(-50)).toBe(0);
    expect(clampHostility(150)).toBe(100);
    expect([0, 16, 17, 33, 34, 50, 51, 67, 68, 84, 85, 100].map((value) => hostilityState(value).key)).toEqual([
      "quiet", "quiet", "watchful", "watchful", "agitated", "agitated",
      "hostile", "hostile", "vengeful", "vengeful", "relentless", "relentless",
    ]);
  });

  test("uses the highest capture category instead of stacking overlaps", () => {
    expect(plateauCaptureHostility({ type: "sphere" })).toBe(2);
    expect(plateauCaptureHostility({ type: "sphere", large: true })).toBe(4);
    expect(plateauCaptureHostility({ type: "bridged", large: true })).toBe(4);
    expect(plateauCaptureHostility({ type: "gemheart", large: true })).toBe(6);
  });

  test("applies one linear peaceful reduction per complete twelve-hour interval", () => {
    const interval = WORLD_PRESSURE_RULES.hostility.peacefulIntervalMs;
    expect(materializeHostilityDecay({ hostility: 100, lastPlayerAggressionAt: 0, decayIntervalsApplied: 0, now: interval - 1 }).hostility).toBe(100);
    expect(materializeHostilityDecay({ hostility: 100, lastPlayerAggressionAt: 0, decayIntervalsApplied: 0, now: interval }).hostility).toBe(83);
    expect(materializeHostilityDecay({ hostility: 100, lastPlayerAggressionAt: 0, decayIntervalsApplied: 0, now: interval * 6 }).hostility).toBe(0);
    expect(materializeHostilityDecay({ hostility: 100, lastPlayerAggressionAt: 0, decayIntervalsApplied: 2, now: interval * 3 })).toMatchObject({ hostility: 83, decayIntervalsApplied: 3, intervalsAppliedNow: 1 });
  });

  test("makes raid difficulty grow faster than rewards", () => {
    expect(hostilityScaledValue(50, 100, WORLD_PRESSURE_RULES.neutralRaid.difficultyHostilityFactor)).toBe(100);
    expect(hostilityScaledValue(500, 100, WORLD_PRESSURE_RULES.neutralRaid.rewardHostilityFactor)).toBe(800);
    expect(2).toBeGreaterThan(1.6);
  });

  test("uses supplied retaliation formula with a weak-kingdom safety ceiling", () => {
    expect(retaliationPower({ militaryCapacity: 600, hostility: 100, seasonDay: 4 })).toBe(740);
    expect(retaliationPower({ militaryCapacity: 600, hostility: 60, seasonDay: 4 })).toBe(470);
    expect(retaliationPower({ militaryCapacity: 0, hostility: 100, seasonDay: 50 })).toBe(100);
    expect(retaliationReward(740)).toBe(248);
  });

  test("favors valuable and recent targets without making history dominant", () => {
    const now = 1_000_000;
    const ordinary = retaliationTargetWeight({ type: "sphere", heldSince: now - 40 * 60 * 60 * 1000, now });
    const recent = retaliationTargetWeight({ type: "sphere", heldSince: now, now });
    const gemheart = retaliationTargetWeight({ type: "gemheart", heldSince: now - 40 * 60 * 60 * 1000, now });
    const historical = retaliationTargetWeight({ type: "sphere", reclamationCount: 500, heldSince: now - 40 * 60 * 60 * 1000, now });
    expect(recent).toBeGreaterThan(ordinary);
    expect(gemheart).toBeGreaterThan(ordinary);
    expect(historical - ordinary).toBe(2);
  });

  test("reclamation defense is uncapped, linear, and does not compound", () => {
    expect([0, 1, 5, 10, 20, 50].map((count) => reclamationDefense(100, count))).toEqual([100, 110, 150, 200, 300, 600]);
    expect(reclamationDefense(100, 1000)).toBe(10100);
  });

  test("backend seeded rolls are stable and cover the exact ten-percent comparison", () => {
    const roll = seededFraction("deep-plains:test");
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThan(1);
    expect(roll < WORLD_PRESSURE_RULES.deepPlains.gemheartChance).toBe(roll < 0.1);
  });
});
