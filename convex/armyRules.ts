import { v } from "convex/values";
import { normalizeUnits, UNIT_RULES, unitKeys, type UnitCounts } from "./rules";

export const unitCountsValidator = v.object({
  bridgeman: v.number(),
  spearman: v.number(),
  chull: v.optional(v.number()),
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

export function subtractAvailableUnits(available: UnitCounts, requested: UnitCounts) {
  const remaining = normalizeUnits(available);
  const normalizedRequested = normalizeUnits(requested);
  for (const key of unitKeys()) {
    if (normalizedRequested[key] > remaining[key]) {
      throw new Error(`Not enough ${UNIT_RULES[key].name}s available.`);
    }
    remaining[key] -= normalizedRequested[key];
  }
  return remaining;
}

export function validateMissionUnits(buildings: { barracks: number }, units: UnitCounts) {
  for (const key of unitKeys()) {
    if (units[key] > 0 && !UNIT_RULES[key].active) {
      throw new Error(`${UNIT_RULES[key].name} is inactive for new actions.`);
    }
    if (units[key] > 0 && buildings.barracks < UNIT_RULES[key].barracksLevel) {
      throw new Error(`${UNIT_RULES[key].name} requires Barracks level ${UNIT_RULES[key].barracksLevel}.`);
    }
  }
}
