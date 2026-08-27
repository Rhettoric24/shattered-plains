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
  const reportLevel = args.report
    ? effectiveIntelLevel(args.report.level, args.report.observedAt, args.now)
    : 0;
  const level = Math.max(args.passiveLevel, reportLevel);
  return {
    level,
    resistance: presentIntelNumber(args.report?.resistance ?? args.currentResistance, level),
  };
}

export function watchtowerTerritoryLevel(buildingLevel: number) {
  if (buildingLevel >= 2) return 2;
  if (buildingLevel >= 1) return 1;
  return 0;
}

export function watchtowerCounterIntelligence(buildingLevel: number) {
  return buildingLevel >= 3 ? 1 : 0;
}
