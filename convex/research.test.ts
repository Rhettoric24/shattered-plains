import { describe, expect, test } from "vitest";
import {
  ARDENTIA_RULES,
  RESEARCH_RULES,
  applySurvivalLosses,
  conclaveRank,
  effectivePower,
  effectiveSpeed,
  effectiveSurvivability,
  doctrineCostMultiplier,
  emergencyDefenseCost,
  incomeBreakdown,
  missionMsForBase,
  researchEffect,
  travelMsForUnits,
  unitPlunder,
} from "./rules";

const units = { bridgeman: 0, spearman: 100, chull: 10, scout: 0, heavy: 0, shardbearer: 0 };

describe("research configuration", () => {
  test("uses the agreed costs, durations, and monastery territory gate", () => {
    expect(RESEARCH_RULES.projects.bridgeEngineering.costs).toEqual([5000, 7000, 7000]);
    expect(RESEARCH_RULES.projects.sprenStudies.durationsMs).toEqual([3_600_000, 14_400_000, 43_200_000, 86_400_000]);
    expect(ARDENTIA_RULES.monasteryAncientPlateausRequired).toBe(2);
  });

  test("maps Conclave XP to five ranks", () => {
    expect([0, 499, 500, 1000, 1500, 2000].map(conclaveRank)).toEqual([1, 1, 2, 3, 4, 5]);
  });

  test("returns total project effects", () => {
    expect(researchEffect({ bridgeEngineering: 3 }, "bridgeEngineering")).toBe(30);
    expect(researchEffect({ gemCutting: 2 }, "gemCutting")).toBe(11);
  });
});

describe("permanent mechanic effects", () => {
  test("Soulcast Armor adds power per Spearman", () => {
    expect(effectivePower(units, { soulcastArmor: 3 }) - effectivePower(units)).toBeCloseTo(100);
  });

  test("Pack Harness affects only Chull plunder", () => {
    expect(unitPlunder(units, { packHarnessDesign: 3 }) - unitPlunder(units)).toBeCloseTo(500);
    expect(effectiveSpeed(units, { packHarnessDesign: 3 })).toBe(effectiveSpeed(units) - 20);
  });

  test("Bridge Engineering shortens ordinary travel", () => {
    expect(travelMsForUnits(units, undefined, { bridgeEngineering: 3 })).toBeLessThan(travelMsForUnits(units));
  });

  test("Bridge Engineering and plateau travel bonuses shorten custom mission clocks", () => {
    const baseMs = 7 * 60 * 60 * 1000;
    const baseline = missionMsForBase(baseMs, units);
    const improved = missionMsForBase(baseMs, units, { sphere: 0, bridged: 2, gemheart: 0, ancient: 0 }, { bridgeEngineering: 3 });
    expect(improved).toBeLessThan(baseline);
  });

  test("Painrials use per-Spearman Survival and Power", () => {
    const baseline = applySurvivalLosses(units, 0.5, "same-seed");
    const researched = applySurvivalLosses(units, 0.5, "same-seed", { painrialMedicine: 3 });
    expect(researched.finalCasualtyRate).toBeLessThan(baseline.finalCasualtyRate);
    expect(effectiveSurvivability(units, { painrialMedicine: 3 }) - effectiveSurvivability(units)).toBe(200);
    expect(effectivePower(units, { painrialMedicine: 3 }) - effectivePower(units)).toBe(50);
  });

  test("Siege Engineering discounts the existing cost curve", () => {
    expect(emergencyDefenseCost(100, { siegeEngineering: 3 })).toBe(9600);
  });

  test("Economic Doctrines are exclusive markers with scoped cost multipliers", () => {
    expect(doctrineCostMultiplier({ __doctrineMilitaryState: 1 }, "military")).toBe(0.85);
    expect(doctrineCostMultiplier({ __doctrineMilitaryState: 1 }, "building")).toBe(1.15);
    expect(doctrineCostMultiplier({ __doctrineTaxItAll: 1 }, "military")).toBe(1.1);
  });

  test("Religious Studies III adds bounded Conclave combat support", () => {
    const completed = { religiousStudies: 3 };
    expect(effectivePower(units, completed, true) - effectivePower(units, completed)).toBe(60);
    expect(unitPlunder(units, completed, true) - unitPlunder(units, completed)).toBe(25);
    expect(effectiveSpeed(units, completed, true) - effectiveSpeed(units, completed)).toBe(1);
  });

  test("Market Economics applies before the plateau multiplier", () => {
    const result = incomeBreakdown({ acres: 20, buildings: { market: 1 }, completedResearch: { marketEconomics: 3 }, plateauCounts: { sphere: 1, training: 0, gemheart: 0, ancient_ruins: 0, bridged: 0, ancient: 0 } });
    expect(result.marketIncomePerDay).toBe(325);
    expect(result.totalIncomePerDay).toBe(632.5);
  });

  test("Tax It All stacks additively with Market Economics", () => {
    const result = incomeBreakdown({ acres: 20, buildings: { market: 1 }, completedResearch: { marketEconomics: 3, __doctrineTaxItAll: 1 } });
    expect(result.marketIncomePerDay).toBe(350);
  });
});
