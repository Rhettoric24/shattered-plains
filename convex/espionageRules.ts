import type { SeasonCategory } from "./seasonScoringRules";

export const ESPIONAGE_CATEGORIES = ["military", "economy", "research", "territory"] as const;
export type EspionageCategory = (typeof ESPIONAGE_CATEGORIES)[number];

export const OPERATIVE_TIERS = ["informant", "spy", "ghostblood"] as const;
export type OperativeTier = (typeof OPERATIVE_TIERS)[number];
export type OperativeCounts = Record<OperativeTier, number>;

export const ESPIONAGE_RULES = {
  network: {
    name: "Ghostblood Network",
    levelCosts: [3000, 7500, 15000],
    constructionTimesMs: [0, 0, 0],
    intelCaps: [50, 100, 150],
    missionIntelSpendCaps: [5, 10, 15],
    maxLevel: 3,
  },
  operatives: {
    informant: { name: "Informant", networkLevel: 1, spyPower: 1, provisionsCost: 3, sphereCost: 150, trainingTimeMs: 0 },
    spy: { name: "Spy", networkLevel: 2, spyPower: 3, provisionsCost: 2, sphereCost: 750, trainingTimeMs: 0 },
    ghostblood: { name: "Ghostblood", networkLevel: 3, spyPower: 6, provisionsCost: 1, sphereCost: 3000, trainingTimeMs: 0 },
  },
  missionDurationMs: 2 * 60 * 60 * 1000,
  thresholdsPercent: { partial: 75, success: 100, overwhelm: 150 },
  intelRewards: { failure: 0, partial: 5, success: 10, overwhelm: 15 },
  sphereHeist: {
    economyIntelCap: 100,
    economyIntelCost: 50,
    disclosure: { estimateAt: 25, exactAt: 75 },
    treasuryPercent: 0.05,
    minimumHaul: 1000,
    maximumHaul: 10000,
    payoutMultipliers: { failure: 0, partial: 0, success: 0.5, overwhelm: 1 },
    casualtyRates: { failure: 0.2, partial: 0.1, success: 0, overwhelm: 0 },
    identityExposed: { failure: true, partial: false, success: true, overwhelm: false },
  },
  decayStepMs: 6 * 60 * 60 * 1000,
  estimate: { radiusPercent: 0.1, minimumRadius: 5, rounding: 5 },
  qualitativeBands: {
    military: [
      { max: 0, label: "Unblooded" }, { max: 9, label: "Tested" }, { max: 24, label: "Dangerous" },
      { max: 49, label: "Formidable" }, { max: null, label: "Dominant" },
    ],
    economy: [
      { max: 0, label: "Modest" }, { max: 9, label: "Developing" }, { max: 24, label: "Prosperous" },
      { max: 49, label: "Wealthy" }, { max: null, label: "Opulent" },
    ],
    research: [
      { max: 0, label: "Uninitiated" }, { max: 9, label: "Studious" }, { max: 24, label: "Learned" },
      { max: 49, label: "Advanced" }, { max: null, label: "Enlightened" },
    ],
    territory: [
      { max: 0, label: "Contained" }, { max: 9, label: "Expanding" }, { max: 24, label: "Established" },
      { max: 49, label: "Far-reaching" }, { max: null, label: "Dominant" },
    ],
  },
  bonusDiscovery: { failureChance: 0, partialChance: 0, successChance: 0, overwhelmChance: 1, quality: 1 },
} as const;

export type EspionageOutcome = keyof typeof ESPIONAGE_RULES.intelRewards;

export function emptyOperatives(): OperativeCounts {
  return { informant: 0, spy: 0, ghostblood: 0 };
}

export function normalizeOperatives(value?: Partial<OperativeCounts>): OperativeCounts {
  const normalized = emptyOperatives();
  for (const tier of OPERATIVE_TIERS) normalized[tier] = Math.max(0, Math.floor(value?.[tier] ?? 0));
  return normalized;
}

export function addOperatives(left?: Partial<OperativeCounts>, right?: Partial<OperativeCounts>) {
  const result = normalizeOperatives(left);
  const addition = normalizeOperatives(right);
  for (const tier of OPERATIVE_TIERS) result[tier] += addition[tier];
  return result;
}

export function subtractOperatives(available: Partial<OperativeCounts>, requested: Partial<OperativeCounts>) {
  const result = normalizeOperatives(available);
  const commitment = normalizeOperatives(requested);
  for (const tier of OPERATIVE_TIERS) {
    if (commitment[tier] > result[tier]) throw new Error(`Not enough ${ESPIONAGE_RULES.operatives[tier].name}s available.`);
    result[tier] -= commitment[tier];
  }
  return result;
}

export function operativeCount(value?: Partial<OperativeCounts>) {
  const counts = normalizeOperatives(value);
  return OPERATIVE_TIERS.reduce((sum, tier) => sum + counts[tier], 0);
}

export function spyPower(value?: Partial<OperativeCounts>) {
  const counts = normalizeOperatives(value);
  return OPERATIVE_TIERS.reduce((sum, tier) => sum + counts[tier] * ESPIONAGE_RULES.operatives[tier].spyPower, 0);
}

export function operativeProvisions(value?: Partial<OperativeCounts>) {
  const counts = normalizeOperatives(value);
  return OPERATIVE_TIERS.reduce((sum, tier) => sum + counts[tier] * ESPIONAGE_RULES.operatives[tier].provisionsCost, 0);
}

export function networkValue(values: readonly number[], level: number) {
  if (level <= 0) return 0;
  return values[Math.min(values.length, Math.floor(level)) - 1] ?? 0;
}

export function resolveEspionageOutcome(finalPower: number, counterIntelligence: number): EspionageOutcome {
  const power = Math.max(0, finalPower);
  const defense = Math.max(0, counterIntelligence);
  if (defense === 0) return "overwhelm";
  const scaledPower = power * 100;
  if (scaledPower < defense * ESPIONAGE_RULES.thresholdsPercent.partial) return "failure";
  if (scaledPower < defense * ESPIONAGE_RULES.thresholdsPercent.success) return "partial";
  if (scaledPower < defense * ESPIONAGE_RULES.thresholdsPercent.overwhelm) return "success";
  return "overwhelm";
}

export function economyIntelDisclosureLevel(amount: number) {
  const value = Math.max(0, Math.min(ESPIONAGE_RULES.sphereHeist.economyIntelCap, Math.floor(amount)));
  if (value >= ESPIONAGE_RULES.sphereHeist.disclosure.exactAt) return 2;
  if (value >= ESPIONAGE_RULES.sphereHeist.disclosure.estimateAt) return 1;
  return 0;
}

export function legacyEconomyIntelAmount(level: number) {
  const normalized = Math.max(0, Math.min(2, Math.floor(level)));
  if (normalized === 2) return ESPIONAGE_RULES.sphereHeist.economyIntelCap;
  if (normalized === 1) return ESPIONAGE_RULES.sphereHeist.economyIntelCost;
  return 0;
}

export function sphereHeistAvailableHaul(targetSpheres: number) {
  const treasury = Math.max(0, targetSpheres);
  const raw = treasury * ESPIONAGE_RULES.sphereHeist.treasuryPercent;
  const clamped = Math.max(ESPIONAGE_RULES.sphereHeist.minimumHaul, Math.min(ESPIONAGE_RULES.sphereHeist.maximumHaul, raw));
  return Math.round(Math.min(treasury, clamped) * 1000) / 1000;
}

export function sphereHeistPayout(targetSpheres: number, outcome: EspionageOutcome) {
  const payout = sphereHeistAvailableHaul(targetSpheres) * ESPIONAGE_RULES.sphereHeist.payoutMultipliers[outcome];
  return Math.round(Math.min(Math.max(0, targetSpheres), payout) * 1000) / 1000;
}

export function sphereHeistCasualties(committed: Partial<OperativeCounts>, outcome: EspionageOutcome, rateMultiplier = 1) {
  const commitment = normalizeOperatives(committed);
  const total = operativeCount(commitment);
  const rate = Math.min(1, ESPIONAGE_RULES.sphereHeist.casualtyRates[outcome] * rateMultiplier);
  let remainingLosses = rate > 0 && total > 0 ? Math.min(total, Math.max(1, Math.ceil(total * rate))) : 0;
  const casualties = emptyOperatives();
  const survivors = normalizeOperatives(commitment);
  for (const tier of OPERATIVE_TIERS) {
    const lost = Math.min(survivors[tier], remainingLosses);
    casualties[tier] = lost;
    survivors[tier] -= lost;
    remainingLosses -= lost;
  }
  return { casualties, survivors, lost: operativeCount(casualties) };
}

export function effectiveLedgerIntelLevel(level: number, observedAt: number, now: number) {
  const steps = Math.floor(Math.max(0, now - observedAt) / ESPIONAGE_RULES.decayStepMs);
  return Math.max(0, Math.min(2, Math.floor(level) - steps));
}

export function nextDecayAt(level: number, observedAt: number, now: number) {
  const current = effectiveLedgerIntelLevel(level, observedAt, now);
  if (current <= 0) return null;
  const elapsedSteps = Math.floor(Math.max(0, now - observedAt) / ESPIONAGE_RULES.decayStepMs);
  return observedAt + (elapsedSteps + 1) * ESPIONAGE_RULES.decayStepMs;
}

export function qualitativeScore(category: EspionageCategory, score: number) {
  const bands = ESPIONAGE_RULES.qualitativeBands[category];
  return bands.find((band) => band.max === null || score <= band.max)?.label ?? bands[bands.length - 1].label;
}

export function estimateScore(score: number) {
  const rule = ESPIONAGE_RULES.estimate;
  const radius = Math.max(rule.minimumRadius, Math.ceil(Math.abs(score) * rule.radiusPercent));
  return {
    min: Math.max(0, Math.floor((score - radius) / rule.rounding) * rule.rounding),
    max: Math.ceil((score + radius) / rule.rounding) * rule.rounding,
  };
}

export function seededIndex(seed: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return size <= 0 ? 0 : (hash >>> 0) % size;
}

export function secondaryCategory(targeted: EspionageCategory, seed: string): EspionageCategory {
  const choices = ESPIONAGE_CATEGORIES.filter((category) => category !== targeted);
  return choices[seededIndex(seed, choices.length)];
}

export function isEspionageCategory(value: string): value is EspionageCategory {
  return (ESPIONAGE_CATEGORIES as readonly string[]).includes(value);
}

export function seasonCategoryTotals(value?: Record<string, number>) {
  return Object.fromEntries(ESPIONAGE_CATEGORIES.map((category) => [category, Math.max(0, Number(value?.[category] ?? 0))])) as Record<SeasonCategory, number>;
}
