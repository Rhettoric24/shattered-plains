import { describe, expect, test } from "vitest";
import { orderedActiveUnits, researchDisclosureState, shouldBlockMissionKey } from "./ui-overhaul-state.js";

describe("UI overhaul state helpers", () => {
  test("the first authoritative roster render includes Chulls in stable order", () => {
    const units = {
      shardbearer: { active: true },
      spearman: { active: true },
      chull: { active: true },
      scout: { active: false },
      bridgeman: { active: true },
    };
    expect(orderedActiveUnits(units).map(([key]) => key)).toEqual(["bridgeman", "spearman", "chull", "shardbearer"]);
  });

  test("mission composers block keyboard commit keys", () => {
    expect(shouldBlockMissionKey("Enter")).toBe(true);
    expect(shouldBlockMissionKey("Return")).toBe(true);
    expect(shouldBlockMissionKey(" ")).toBe(false);
  });

  test("Research progresses from hidden to teased to revealed", () => {
    expect(researchDisclosureState()).toBe("hidden");
    expect(researchDisclosureState({ teased: true })).toBe("teased");
    expect(researchDisclosureState({ monasteryLevel: 1, teased: true })).toBe("revealed");
  });
});
