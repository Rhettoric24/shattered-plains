/** Analysis-only adapters. Nothing in production or the Lab imports this module. */
import {
  ARMY_RULES,
  TIME_RULES,
  applySurvivalLosses,
  baseCasualtyRate,
  casualtyRateAfterSurvivability,
  effectivePower,
  effectiveSurvivability,
  normalizeUnits,
  totalUnits,
  unitKeys,
  unitPlunder,
  type UnitCounts,
} from "../convex/rules";

export type Army = {
  name: string;
  units: UnitCounts;
  research: Record<string, number>;
};
export type Scenario = {
  id: string;
  category: string;
  note: string;
  armies: Army[];
  /** Analysis-only controlled opposition; no opposing army or winner is inferred. */
  hostilePowers?: number[];
};
export type Model = {
  family?: string;
  id: string;
  label: string;
  floor: number;
  survival: "total" | "density";
  selection: "equal" | "weighted";
  densityScale: number;
  weightStrength: number;
  surviveCap?: number;
};
const common = {
  floor: ARMY_RULES.minimumBaseCasualtyRate,
  survival: "total" as const,
  selection: "equal" as const,
  densityScale: 100,
  weightStrength: Math.log(2),
};
export const models: Model[] = [
  { ...common, id: "current", label: "CURRENT / BASELINE" },
  { ...common, id: "floor1", label: "EXPERIMENTAL / 1% floor", floor: 0.01 },
  { ...common, id: "floor0", label: "EXPERIMENTAL / 0% floor", floor: 0 },
  {
    ...common,
    id: "weighted",
    label: "EXPERIMENTAL / weighted selection",
    selection: "weighted",
  },
  {
    ...common,
    id: "normalized",
    label: "EXPERIMENTAL / normalized Survival — NOT BALANCED",
    survival: "density",
  },
  {
    ...common,
    id: "normalized-weighted",
    label: "EXPERIMENTAL / normalized + weighted — NOT BALANCED",
    survival: "density",
    selection: "weighted",
  },
];

export function validateModel(model: Model) {
  if (
    !Number.isFinite(model.floor) ||
    model.floor < 0 ||
    model.floor > ARMY_RULES.maximumBaseCasualtyRate
  )
    throw Error(
      "Floor must be between 0 and the current maximum base casualty rate.",
    );
  if (
    !Number.isFinite(model.densityScale) ||
    model.densityScale <= 0 ||
    !Number.isFinite(model.weightStrength) ||
    model.weightStrength < 0
  )
    throw Error(
      "Density scale must be positive; weight strength must be nonnegative.",
    );
  if (
    model.surviveCap !== undefined &&
    (!Number.isFinite(model.surviveCap) || model.surviveCap < 0)
  )
    throw Error("Survivability cap must be nonnegative.");
  if (
    model.id === "current" &&
    (model.floor !== ARMY_RULES.minimumBaseCasualtyRate ||
      model.survival !== "total" ||
      model.selection !== "equal" ||
      model.surviveCap !== undefined)
  )
    throw Error(
      "CURRENT is locked to production baseline settings. Use an experimental variant.",
    );
}

export function baseRate(own: number, hostile: number, floor: number) {
  // Baseline calls the real helper directly. Experiments change only the floor.
  if (floor === ARMY_RULES.minimumBaseCasualtyRate)
    return baseCasualtyRate(own, hostile);
  if (hostile <= 0) return 0;
  if (own <= 0) return ARMY_RULES.maximumBaseCasualtyRate;
  return Math.max(
    floor,
    Math.min(
      ARMY_RULES.maximumBaseCasualtyRate,
      (ARMY_RULES.baseCasualtyFactor * hostile) / own,
    ),
  );
}

export function armyMetrics(army: Army, hostilePower: number, model: Model) {
  const n = totalUnits(army.units),
    power = effectivePower(army.units, army.research),
    survival = effectiveSurvivability(army.units, army.research);
  let appliedSurvival =
    model.survival === "density"
      ? n
        ? (model.densityScale * survival) / n
        : 0
      : survival;
  if (model.surviveCap !== undefined)
    appliedSurvival = Math.min(appliedSurvival, model.surviveCap);
  const base = baseRate(power, hostilePower, model.floor);
  const final = casualtyRateAfterSurvivability(base, appliedSurvival);
  return {
    power,
    hostilePower,
    survival,
    appliedSurvival,
    n,
    plunder: unitPlunder(army.units, army.research),
    base,
    final,
    expected: n * final,
  };
}

/** Separate deterministic stream for the selection experiment, never for baseline. */
function random(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), h | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}
export function casualtyWeight(
  army: Army,
  key: keyof UnitCounts,
  strength: number,
) {
  // Singleton effective Survival includes per-Spearman Field Surgery. It does not
  // misapply the whole army's Survival or a unit-role category to the individual.
  const individual = effectiveSurvivability({ [key]: 1 }, army.research, false);
  return Math.exp(Math.max(-20, Math.min(20, -strength * individual)));
}
export function weightedLosses(
  army: Army,
  count: number,
  seed: string,
  strength: number,
) {
  const roll = random(seed + ":weighted"),
    pool: { key: keyof UnitCounts; priority: number; index: number }[] = [];
  for (const key of unitKeys()) {
    const weight = casualtyWeight(army, key, strength);
    for (let i = 0; i < army.units[key]; i++)
      pool.push({
        key,
        priority: -Math.log(roll()) / weight,
        index: pool.length,
      });
  }
  // Exponential race = seeded weighted sampling without replacement. Every
  // individual has positive weight; lower Survival raises risk, not death priority.
  pool.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const survivors = { ...army.units },
    casualties = normalizeUnits({});
  for (const entry of pool.slice(0, count)) {
    survivors[entry.key]--;
    casualties[entry.key]++;
  }
  return { survivors, casualties };
}
export function simulateArmy(
  army: Army,
  hostilePower: number,
  model: Model,
  seed: string,
) {
  validateModel(model);
  const metrics = armyMetrics(army, hostilePower, model);
  let result;
  if (model.survival === "total") {
    result = applySurvivalLosses(
      army.units,
      metrics.base,
      seed,
      army.research,
      false,
      model.surviveCap,
    );
  } else {
    // Reuse production rounding and individual shuffle, without copying either.
    // A cap of zero neutralizes positive Survival. Compensate its remaining
    // negative multiplier in the input rate so the real function applies the
    // experimental final rate. Exposed metrics retain the actual battle base rate.
    const negativeMultiplier =
      1 +
      Math.abs(Math.min(0, metrics.survival)) /
        TIME_RULES.statDiminishingConstant;
    result = applySurvivalLosses(
      army.units,
      metrics.final / negativeMultiplier,
      seed,
      army.research,
      false,
      0,
    );
    result = { ...result, baseCasualtyRate: metrics.base };
  }
  if (model.selection === "weighted")
    result = {
      ...result,
      ...weightedLosses(
        army,
        totalUnits(result.casualties),
        seed,
        model.weightStrength,
      ),
    };
  return result;
}
