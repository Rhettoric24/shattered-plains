import { describe, expect, test } from "vitest";
import { intelligenceDisclosureState, normalizeRosterUnits, orderedActiveUnits, researchDisclosureState, shouldBlockMissionKey, shouldResetRouteScroll } from "./ui-overhaul-state.js";

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

  test("the first player-state normalization does not depend on an existing global roster", () => {
    expect(normalizeRosterUnits({ bridgeman: 4, chull: 7 }, ["bridgeman", "spearman", "chull"]))
      .toEqual({ bridgeman: 4, spearman: 0, chull: 7 });
  });

  test("mission composers block keyboard commit keys", () => {
    expect(shouldBlockMissionKey("Enter")).toBe(true);
    expect(shouldBlockMissionKey("Return")).toBe(true);
    expect(shouldBlockMissionKey(" ")).toBe(false);
  });

  test("tab changes reset scroll while targeted deep links retain focus behavior", () => {
    expect(shouldResetRouteScroll({ view: "warcamp", tab: "buildings" }, { view: "plains", tab: "raids" })).toBe(true);
    expect(shouldResetRouteScroll({ view: "plains", tab: "raids" }, { view: "plains", tab: "plateau-runs", focus: "run-1" })).toBe(false);
    expect(shouldResetRouteScroll({ view: "plains", tab: "raids" }, { view: "plains", tab: "raids" })).toBe(false);
  });

  test("Research progresses from hidden to teased to revealed", () => {
    expect(researchDisclosureState()).toBe("hidden");
    expect(researchDisclosureState({ teased: true })).toBe("teased");
    expect(researchDisclosureState({ monasteryLevel: 1, teased: true })).toBe("revealed");
  });

  test("Intelligence spaces unlock from their own buildings", () => {
    expect(intelligenceDisclosureState()).toEqual({ network: false, watchtower: false });
    expect(intelligenceDisclosureState({ networkLevel: 1 })).toEqual({ network: true, watchtower: false });
    expect(intelligenceDisclosureState({ watchtowerLevel: 1 })).toEqual({ network: false, watchtower: true });
  });
});
