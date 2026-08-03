import { describe, expect, test } from "vitest";
import {
  ARDENTIA_RULES,
  RESEARCH_RULES,
  applySurvivalLosses,
  conclaveRank,
  effectivePower,
  emergencyDefenseCost,
  incomeBreakdown,
  researchEffect,
  travelMsForUnits,
  unitPlunder,
} from "./rules";

const units = { bridgeman: 0, spearman: 100, chull: 10, scout: 0, heavy: 0, shardbearer: 0 };

describe("research configuration", () => {
  test("uses the agreed costs, durations, and monastery territory gate", () => {
    expect(RESEARCH_RULES.sphereCosts).toEqual([1000, 3000, 7500]);
    expect(RESEARCH_RULES.durationsMs).toEqual([3_600_000, 14_400_000, 43_200_000]);
    expect(ARDENTIA_RULES.monasteryAncientPlateausRequired).toBe(2);
  });

  test("maps Conclave XP to five ranks", () => {
    expect([0, 499, 500, 1000, 1500, 2000].map(conclaveRank)).toEqual([1, 1, 2, 3, 4, 5]);
  });

  test("returns cumulative project effects", () => {
    expect(researchEffect({ bridgeEngineering: 3 }, "bridgeEngineering")).toBe(6);
    expect(researchEffect({ gemCutting: 2 }, "gemCutting")).toBe(11);
  });
});

describe("permanent mechanic effects", () => {
  test("Soulcast Armor adds power per Spearman", () => {
    expect(effectivePower(units, { soulcastArmor: 3 }) - effectivePower(units)).toBeCloseTo(30);
  });

  test("Pack Harness affects only Chull plunder", () => {
    expect(unitPlunder(units, { packHarnessDesign: 3 }) - unitPlunder(units)).toBeCloseTo(90);
  });

  test("Bridge Engineering shortens ordinary travel", () => {
    expect(travelMsForUnits(units, undefined, { bridgeEngineering: 3 })).toBeLessThan(travelMsForUnits(units));
  });

  test("Painrial Medicine reduces the final casualty rate", () => {
    const baseline = applySurvivalLosses(units, 0.5, "same-seed");
    const researched = applySurvivalLosses(units, 0.5, "same-seed", { painrialMedicine: 3 });
    expect(researched.finalCasualtyRate).toBeCloseTo(baseline.finalCasualtyRate * 0.85);
  });

  test("Siege Engineering discounts the existing cost curve", () => {
    expect(emergencyDefenseCost(100, { siegeEngineering: 3 })).toBe(9120);
  });

  test("Market Economics applies before the plateau multiplier", () => {
    const result = incomeBreakdown({ acres: 20, buildings: { market: 1 }, completedResearch: { marketEconomics: 3 }, plateauCounts: { sphere: 1, training: 0, gemheart: 0, ancient_ruins: 0, bridged: 0, ancient: 0 } });
    expect(result.marketIncomePerDay).toBe(325);
    expect(result.totalIncomePerDay).toBe(632.5);
  });
});
