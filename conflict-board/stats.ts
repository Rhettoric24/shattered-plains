import {
  effectivePower,
  effectiveSpeed,
  effectiveSurvivability,
  totalUnits,
  unitPlunder,
  type UnitCounts,
} from "../convex/rules";
import type { ResolverConfig } from "./types";

export function formationStats(
  units: UnitCounts,
  research: Record<string, number>,
  config: ResolverConfig,
) {
  // Bridge Engineering remains untouched in production. Only its tactical input
  // is excluded here; Conclave effects are deliberately not attached in this lab.
  const tacticalResearch = { ...research, bridgeEngineering: 0 };
  const power = effectivePower(units, research);
  const speed = effectiveSpeed(units, tacticalResearch);
  const travelSpeed = effectiveSpeed(units, research);
  const survive = effectiveSurvivability(units, research);
  const plunder = unitPlunder(units, research);
  const n = totalUnits(units);
  const c = config.specialization;
  const ratings = n
    ? [
        Math.max(0, speed) / (c.speedScale * n),
        Math.max(0, survive) / (c.surviveScale * n),
        Math.max(0, plunder) / (c.plunderScale * n),
      ]
    : [0, 0, 0];
  const highest = Math.max(...ratings);
  const sum = ratings.reduce((a, b) => a + b, 0);
  const unique = ratings.filter((v) => v === highest).length === 1;
  const specialization =
    unique && highest >= c.minimum && sum > 0 && highest / sum > c.dominance
      ? (["Speed", "Survive", "Plunder"] as const)[ratings.indexOf(highest)]
      : "None";
  return {
    power,
    speed,
    travelSpeed,
    survive,
    plunder,
    ratings,
    specialization,
  };
}
