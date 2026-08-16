export const WORLD_PRESSURE_RULES = {
  hostility: {
    min: 0,
    max: 100,
    peacefulIntervalMs: 12 * 60 * 60 * 1000,
    peacefulDecay: 17,
    gains: {
      neutralPlateau: 2,
      largePlateau: 4,
      bridgedPlateau: 4,
      gemheartPlateau: 6,
      neutralRaidVictory: 8,
      plateauRunVictory: 6,
      retaliationVictory: 5,
      deepPlainsVictory: 10,
    },
  },
  retaliation: {
    cooldownHours: {
      agitated: [24, 36],
      hostile: [18, 24],
      vengeful: [12, 18],
      relentless: [8, 14],
    },
    warningLeadHours: [3, 5],
    siegeDurationMs: 60 * 60 * 1000,
    retryDelayMs: 60 * 60 * 1000,
    hostilityMultipliers: {
      quiet: 0,
      watchful: 0,
      agitated: 0.45,
      hostile: 0.65,
      vengeful: 0.85,
      relentless: 1.1,
    },
    seasonPressurePerDay: 20,
    minimumPower: 20,
    weakKingdomPowerRatioCap: 2,
    weakKingdomPowerFlatCap: 100,
    targetWeights: {
      base: 1,
      recentCapture: 6,
      recentCaptureDurationMs: 36 * 60 * 60 * 1000,
      gemheart: 5,
      large: 2,
      bridged: 2,
      perReclamation: 0.25,
      reclamationMaximum: 2,
    },
    rewards: {
      sphereBase: 100,
      spheresPerEnemyPower: 0.2,
      militarySeasonPoints: 3,
    },
  },
  reclamation: {
    defensePerReclamation: 0.1,
  },
  neutralRaid: {
    difficultyHostilityFactor: 1,
    rewardHostilityFactor: 0.6,
  },
  deepPlains: {
    unlockMinimumHostility: 68,
    durationMinutes: [360, 480],
    defensePower: [220, 320],
    difficultyHostilityFactor: 1.25,
    sphereReward: [3000, 5000],
    rewardHostilityFactor: 0.4,
    casualtyRateBonus: 0.1,
    gemheartChance: 0.1,
  },
} as const;

export type HostilityState =
  | "quiet"
  | "watchful"
  | "agitated"
  | "hostile"
  | "vengeful"
  | "relentless";

export const HOSTILITY_STATES = [
  { key: "quiet", label: "Quiet", min: 0, max: 16 },
  { key: "watchful", label: "Watchful", min: 17, max: 33 },
  { key: "agitated", label: "Agitated", min: 34, max: 50 },
  { key: "hostile", label: "Hostile", min: 51, max: 67 },
  { key: "vengeful", label: "Vengeful", min: 68, max: 84 },
  { key: "relentless", label: "Relentless", min: 85, max: 100 },
] as const;

export function clampHostility(value: number) {
  return Math.max(
    WORLD_PRESSURE_RULES.hostility.min,
    Math.min(WORLD_PRESSURE_RULES.hostility.max, Math.round(value)),
  );
}

export function hostilityState(value: number) {
  const hostility = clampHostility(value);
  return HOSTILITY_STATES.find((state) => hostility <= state.max) ?? HOSTILITY_STATES[HOSTILITY_STATES.length - 1];
}

export function hostilityProgress(value: number) {
  const hostility = clampHostility(value);
  const state = hostilityState(hostility);
  const next = HOSTILITY_STATES.find((candidate) => candidate.min > state.min);
  const denominator = next ? next.min - state.min : state.max - state.min;
  const progress = next
    ? (hostility - state.min) / denominator
    : (hostility - state.min) / Math.max(1, denominator);
  return {
    state,
    nextState: next ?? null,
    progressPercent: Math.max(0, Math.min(100, Math.round(progress * 100))),
  };
}

export function isRetaliationEligible(value: number) {
  return clampHostility(value) >= 34;
}

export function plateauCaptureHostility(args: { type: string; large?: boolean }) {
  const gains = WORLD_PRESSURE_RULES.hostility.gains;
  if (args.type === "gemheart") return gains.gemheartPlateau;
  if (args.type === "bridged" || args.type === "training") return gains.bridgedPlateau;
  if (args.large) return gains.largePlateau;
  return gains.neutralPlateau;
}

export function materializeHostilityDecay(args: {
  hostility: number;
  lastPlayerAggressionAt?: number;
  decayIntervalsApplied?: number;
  now: number;
}) {
  const hostility = clampHostility(args.hostility);
  if (args.lastPlayerAggressionAt === undefined) {
    return { hostility, decayIntervalsApplied: 0, intervalsAppliedNow: 0 };
  }
  const eligibleIntervals = Math.max(
    0,
    Math.floor((args.now - args.lastPlayerAggressionAt) / WORLD_PRESSURE_RULES.hostility.peacefulIntervalMs),
  );
  const previousIntervals = Math.max(0, Math.floor(args.decayIntervalsApplied ?? 0));
  const intervalsAppliedNow = Math.max(0, eligibleIntervals - previousIntervals);
  return {
    hostility: clampHostility(hostility - intervalsAppliedNow * WORLD_PRESSURE_RULES.hostility.peacefulDecay),
    decayIntervalsApplied: Math.max(previousIntervals, eligibleIntervals),
    intervalsAppliedNow,
  };
}

export function hostilityScaledValue(base: number, hostility: number, factor: number) {
  return Math.round(base * (1 + (clampHostility(hostility) / 100) * factor));
}

export function reclamationDefense(baseDefense: number, reclamationCount: number) {
  return Math.round(
    Math.max(0, baseDefense) *
      (1 + Math.max(0, Math.floor(reclamationCount)) * WORLD_PRESSURE_RULES.reclamation.defensePerReclamation),
  );
}

export function retaliationTargetWeight(args: {
  type: string;
  large?: boolean;
  heldSince?: number;
  reclamationCount?: number;
  now: number;
}) {
  const weights = WORLD_PRESSURE_RULES.retaliation.targetWeights;
  const age = args.heldSince === undefined ? weights.recentCaptureDurationMs : Math.max(0, args.now - args.heldSince);
  const recent = age < weights.recentCaptureDurationMs
    ? weights.recentCapture * (1 - age / weights.recentCaptureDurationMs)
    : 0;
  return weights.base + recent +
    (args.type === "gemheart" ? weights.gemheart : 0) +
    (args.large ? weights.large : 0) +
    (args.type === "bridged" || args.type === "training" ? weights.bridged : 0) +
    Math.min(weights.reclamationMaximum, Math.max(0, Math.floor(args.reclamationCount ?? 0)) * weights.perReclamation);
}

export function retaliationPower(args: {
  militaryCapacity: number;
  hostility: number;
  seasonDay: number;
}) {
  const state = hostilityState(args.hostility).key;
  const capacity = Math.max(0, args.militaryCapacity);
  const raw = capacity * WORLD_PRESSURE_RULES.retaliation.hostilityMultipliers[state] +
    WORLD_PRESSURE_RULES.retaliation.seasonPressurePerDay * Math.max(1, Math.floor(args.seasonDay));
  const safetyCap = capacity * WORLD_PRESSURE_RULES.retaliation.weakKingdomPowerRatioCap +
    WORLD_PRESSURE_RULES.retaliation.weakKingdomPowerFlatCap;
  return Math.round(Math.max(WORLD_PRESSURE_RULES.retaliation.minimumPower, Math.min(raw, safetyCap)));
}

export function retaliationReward(power: number) {
  return Math.round(
    WORLD_PRESSURE_RULES.retaliation.rewards.sphereBase +
      Math.max(0, power) * WORLD_PRESSURE_RULES.retaliation.rewards.spheresPerEnemyPower,
  );
}

export function seededFraction(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function seededInt(seed: string, min: number, max: number) {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  return lower + Math.floor(seededFraction(seed) * (upper - lower + 1));
}
