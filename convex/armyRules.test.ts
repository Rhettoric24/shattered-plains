import { describe, expect, test } from "vitest";
import { emptyUnits } from "./rules";
import { subtractAvailableUnits, validateMissionUnits } from "./armyRules";

describe("mission army rules", () => {
  test("subtracts a normalized mission commitment", () => {
    expect(subtractAvailableUnits(
      { ...emptyUnits(), bridgeman: 10, spearman: 4, chull: 2 },
      { ...emptyUnits(), bridgeman: 3, spearman: 1, chull: 2 },
    )).toEqual({ ...emptyUnits(), bridgeman: 7, spearman: 3 });
  });

  test("rejects commitments larger than the available army", () => {
    expect(() => subtractAvailableUnits(
      { ...emptyUnits(), spearman: 2 },
      { ...emptyUnits(), spearman: 3 },
    )).toThrow("Not enough Spearmans available.");
  });

  test("preserves inactive-unit requirements", () => {
    expect(() => validateMissionUnits(
      { barracks: 5 },
      { ...emptyUnits(), scout: 1 },
    )).toThrow("Scout is inactive for new actions.");
  });
});
