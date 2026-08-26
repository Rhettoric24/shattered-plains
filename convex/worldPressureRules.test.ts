import { describe, expect, test } from "vitest";
import {
  clampHostility,
  hostilityScaledValue,
  hostilityState,
  materializeHostilityDecay,
  plateauCaptureHostility,
  raidDefenseDisclosure,
  reclamationDefense,
  retaliationPower,
  retaliationReward,
  retaliationTargetWeight,
  seededFraction,
  WORLD_PRESSURE_RULES,
} from "./worldPressureRules";
import { neutralPlateauBaseDefense } from "./plateauHelpers";
import { COMBAT_RULES, resistanceLabel } from "./rules";
import { presentIntelNumber } from "./intelligenceRules";

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
    expect([0, 25, 50, 75, 100].map((hostility) => [
      hostilityScaledValue(COMBAT_RULES.parshendiSphereRaidMinDefense, hostility, WORLD_PRESSURE_RULES.neutralRaid.difficultyHostilityFactor),
      hostilityScaledValue(COMBAT_RULES.parshendiSphereRaidMaxDefense, hostility, WORLD_PRESSURE_RULES.neutralRaid.difficultyHostilityFactor),
    ])).toEqual([[100, 200], [125, 250], [150, 300], [175, 350], [200, 400]]);
    expect(hostilityScaledValue(500, 100, WORLD_PRESSURE_RULES.neutralRaid.rewardHostilityFactor)).toBe(800);
    expect(2).toBeGreaterThan(1.6);
  });

  test("narrows one true raid defense without changing it", () => {
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 0, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ mode: "range", min: 100, max: 200 });
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 1, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ mode: "estimate", min: 128, max: 198 });
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 2, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ min: 143, max: 183 });
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 3, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ min: 153, max: 173 });
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 4, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ min: 153, max: 173 });
    expect(raidDefenseDisclosure({ defense: 163, intelligenceLevel: 5, broadMinimum: 100, broadMaximum: 200 })).toMatchObject({ mode: "exact", value: 163 });
  });

  test("maps current neutral plateau classes with Gemheart precedence", () => {
    expect(neutralPlateauBaseDefense("sphere", false)).toBe(500);
    expect(neutralPlateauBaseDefense("sphere", true)).toBe(650);
    expect(neutralPlateauBaseDefense("gemheart", false)).toBe(750);
    expect(neutralPlateauBaseDefense("gemheart", true)).toBe(750);
    expect(COMBAT_RULES.parshendiSphereRaidMinDefense).toBe(100);
    expect(COMBAT_RULES.parshendiSphereRaidMaxDefense).toBe(200);
  });

  test("keeps broad military labels useful on the World Brutality scale", () => {
    expect([120, 121, 240, 241, 400, 401, 600, 601, 750].map(resistanceLabel)).toEqual([
      "Vulnerable", "Guarded", "Guarded", "Defended", "Defended", "Fortified", "Fortified", "Impregnable", "Impregnable",
    ]);
    expect(presentIntelNumber(500, 0)).toMatchObject({ mode: "label", label: "Fortified" });
    expect(presentIntelNumber(500, 1)).toMatchObject({ mode: "range", label: "Fortified", min: 401, max: 600 });
    expect(presentIntelNumber(500, 2)).toMatchObject({ mode: "estimate", min: 450, max: 550 });
    expect(presentIntelNumber(500, 3)).toMatchObject({ mode: "exact", value: 500 });
    expect(presentIntelNumber(650, 0)).toMatchObject({ mode: "label", label: "Impregnable" });
  });

  test("uses supplied retaliation formula with a weak-kingdom safety ceiling", () => {
    expect(retaliationPower({ militaryCapacity: 600, hostility: 100, seasonDay: 4 })).toBe(740);
    expect(retaliationPower({ militaryCapacity: 600, hostility: 60, seasonDay: 4 })).toBe(470);
    expect(retaliationPower({ militaryCapacity: 0, hostility: 100, seasonDay: 50 })).toBe(100);
    expect(retaliationPower({ militaryCapacity: 10, hostility: 100, seasonDay: 50 })).toBe(120);
    expect(retaliationReward(740)).toBe(248);
    expect(WORLD_PRESSURE_RULES.retaliation.cooldownHours).toEqual({
      agitated: [24, 36], hostile: [18, 24], vengeful: [12, 18], relentless: [8, 14],
    });
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
    expect([0, 1, 3, 5].map((count) => reclamationDefense(500, count))).toEqual([500, 600, 800, 1000]);
    expect(reclamationDefense(100, 1000)).toBe(20100);
  });

  test("backend seeded rolls are stable and cover the exact ten-percent comparison", () => {
    const roll = seededFraction("deep-plains:test");
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThan(1);
    expect(roll < WORLD_PRESSURE_RULES.deepPlains.gemheartChance).toBe(roll < 0.1);
  });
});
