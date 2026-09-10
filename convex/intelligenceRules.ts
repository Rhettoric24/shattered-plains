import { MILITARY_RESISTANCE_BANDS } from "./rules";

export const INTELLIGENCE_DECAY_STEP_MS = 6 * 60 * 60 * 1000;

export const RESISTANCE_BANDS = MILITARY_RESISTANCE_BANDS;

export function effectiveIntelLevel(level: number, observedAt: number, now: number) {
  const steps = Math.floor(Math.max(0, now - observedAt) / INTELLIGENCE_DECAY_STEP_MS);
  return Math.max(0, Math.min(5, Math.floor(level) - steps));
}

export function intelligenceFreshness(observedAt: number, now: number) {
  const age = Math.max(0, now - observedAt);
  if (age < INTELLIGENCE_DECAY_STEP_MS) return "fresh" as const;
  if (age < INTELLIGENCE_DECAY_STEP_MS * 3) return "aging" as const;
  return "stale" as const;
}

export function presentIntelNumber(value: number | undefined, level: number) {
  if (value === undefined) return null;
  const band = RESISTANCE_BANDS.find(
    (candidate) => value >= candidate.min && (candidate.max === null || value <= candidate.max),
  ) ?? RESISTANCE_BANDS[RESISTANCE_BANDS.length - 1];
  if (level <= 0) return { mode: "label" as const, label: band.label };
  if (level === 1) return { mode: "range" as const, label: band.label, min: band.min, max: band.max };
  if (level === 2) {
    const radius = Math.max(2, Math.ceil(Math.abs(value) * 0.1));
    return {
      mode: "estimate" as const,
      label: band.label,
      min: Math.max(0, Math.floor(value - radius)),
      max: Math.ceil(value + radius),
    };
  }
  return { mode: "exact" as const, label: band.label, value };
}

export function territoryResistanceDisclosure(args: {
  currentResistance: number | undefined;
  report: { level: number; observedAt: number; resistance?: number } | null | undefined;
  passiveLevel: number;
  now: number;
}) {
  const level = watchtowerTerritoryLevel(args.passiveLevel);
  return {
    level,
    resistance: presentIntelNumber(args.currentResistance, level),
  };
}

export function watchtowerTerritoryLevel(buildingLevel: number) {
  if (buildingLevel >= 3) return 3;
  if (buildingLevel >= 2) return 2;
  if (buildingLevel >= 1) return 1;
  return 0;
}

export function intelText(intel: { mode: string; label: string; value?: number; min?: number; max?: number | null } | null) {
  if (!intel) return "Unknown";
  if (intel.mode === "exact") return String(intel.value);
  if (intel.mode === "label") return intel.label;
  return intel.max === null ? `${intel.min}+` : `${intel.min}–${intel.max}`;
}

export function ledgerMilitaryLevel(amount: number) {
  return amount >= 75 ? 3 : amount >= 25 ? 2 : 0;
}

export function presentSpeedIntel(value: number, level: number) {
  const label = value <= 0 ? "burdened" : value <= 8 ? "slow" : value <= 18 ? "steady" : value <= 35 ? "fast" : "swift";
  return { ...presentIntelNumber(value, level)!, label };
}

export function neutralRewardIntel(value: number, level: number) {
  const min = Math.floor(Math.max(0, value) / 5000) * 5000;
  const label = value < 5000 ? "Small" : value < 15000 ? "Modest" : value < 30000 ? "Large" : "Vast";
  if (level <= 0) return { mode: "label" as const, label };
  if (level === 1) return { mode: "range" as const, label, min, max: min + 4999 };
  return { ...presentIntelNumber(value, level)!, label };
}

export function chasmfiendIntel(value: number, level: number) {
  const bands = [0, 900, 1400, 2000, 2500];
  const labels = ["Young", "Mature", "Ancient", "Colossal", "Legendary"];
  const index = bands.findLastIndex(min => value >= min);
  const label = labels[index];
  if (level <= 0) return { mode: "label" as const, label };
  if (level === 1) return { mode: "range" as const, label, min: bands[index], max: index === 4 ? null : bands[index + 1] - 1 };
  return { ...presentIntelNumber(value, level)!, label };
}

export function watchtowerCounterIntelligence(buildingLevel: number) {
  return buildingLevel >= 3 ? 1 : 0;
}
