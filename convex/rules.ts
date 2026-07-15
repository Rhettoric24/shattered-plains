export const WORLD_KEY = "main";

export const TIME_RULES = {
  realMsPerGameDay: 60 * 60 * 1000,
  gameHoursPerDay: 24,
  raidTravelGameDays: 1,
  speedReductionPerPoint: 0.01,
  maxTravelReductionPercent: 50,
} as const;

export const STARTING_RULES = {
  acres: 20,
  openAcresPerNewPlayer: 100,
  startingPlateaus: 2,
  neutralPlateausPerNewPlayer: 3,
  spheres: 1200,
  gemhearts: 1,
} as const;

export const ECONOMY_RULES = {
  spheresPerAcrePerGameDay: 6,
  marketSpheresPerLevelPerGameDay: 250,
} as const;

export const PLATEAU_RULES = {
  starterType: "sphere",
  starterHighground: true,
  sphereIncomePerGameDay: 150,
  trainingDiscountPerPlateau: 0.1,
  gemheartIntervalMs: 12 * 60 * 60 * 1000,
  highgroundDefenseBonus: 0.2,
  neutralDefenseMin: 35,
  neutralDefenseMax: 80,
  neutralHighgroundChancePercent: 12,
  siegeFortifySpheresPerPercent: 50,
  siegeFortifyMaxPercent: 100,
  attackerRetreatLossRate: 0.18,
  defenderRetreatLossRate: 0.12,
  siegeWinAttackerLossRate: 0.22,
  siegeLossAttackerLossRate: 0.55,
  siegeWinDefenderLossRate: 0.18,
  siegeLossDefenderLossRate: 0.08,
  neutralWinLossRate: 0.15,
  neutralLossLossRate: 0.45,
  diminishingReturns: [1, 0.75, 0.5, 0.25],
} as const;

export const COMBAT_RULES = {
  watchtowerDefensePerLevel: 0.05,
  openDefenseBase: 3,
  openDefensePerAcre: 0.9,
  parshendiSphereRaidMinDefense: 4,
  parshendiSphereRaidMaxDefense: 16,
  parshendiSphereRaidMinReward: 250,
  parshendiSphereRaidMaxReward: 650,
} as const;

export const PLATEAU_RUN_RULES = {
  everyGameDays: 3,
  joinRealMs: 15 * 60 * 1000,
  activePlayerWindowMs: 2 * 24 * 60 * 60 * 1000,
  difficultyPerActivePlayer: 75,
  difficultyRandomMin: 1,
  difficultyRandomMax: 20,
  minimumDifficulty: 25,
  sphereRewardPerActivePlayer: 500,
  sphereRewardRandomMin: 250,
  sphereRewardRandomMax: 900,
  gemheartReward: 1,
  fastestPowerBonus: 0.1,
  joinOrderSpeedBonuses: [0.1, 0.07, 0.05],
  failedRunLossRate: 0.55,
  successfulRunLossRate: 0.12,
} as const;

export const UNIT_RULES = {
  bridgeman: {
    name: "Bridgeman",
    role: "Fast - Fragile",
    active: true,
    power: 1,
    speed: 10,
    plunder: 2,
    survival: 0.75,
    cost: 5,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  spearman: {
    name: "Spearman",
    role: "Powerful - Reliable",
    active: true,
    power: 5,
    speed: 4,
    plunder: 2,
    survival: 0.95,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  chull: {
    name: "Chull",
    role: "High Plunder - Very Slow",
    active: true,
    power: 0,
    speed: 1,
    plunder: 20,
    survival: 0.99,
    cost: 45,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  scout: {
    name: "Scout",
    role: "Legacy intelligence unit",
    active: false,
    power: 1.5,
    speed: 1,
    plunder: 1,
    survival: 0.9,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 2,
    trainingTime: "Instant",
  },
  heavy: {
    name: "Heavy Infantry",
    role: "Legacy defensive unit",
    active: false,
    power: 4,
    speed: -0.5,
    plunder: 1,
    survival: 0.96,
    cost: 35,
    gemheartCost: 0,
    barracksLevel: 3,
    trainingTime: "Instant",
  },
  shardbearer: {
    name: "Shardbearer",
    role: "Legendary Power - Extremely Rare",
    active: true,
    power: 20,
    speed: 3,
    plunder: 5,
    survival: 0.999,
    cost: 0,
    gemheartCost: 1,
    barracksLevel: 0,
    trainingTime: "Instant",
    description:
      "Doubles the power of raids it joins and home defenses while available.",
  },
} as const;

export const BUILDING_RULES = {
  market: {
    name: "Gemheart Market",
    baseCost: 150,
    description: "+250 spheres per game day per level",
  },
  watchtower: {
    name: "Watchtower",
    baseCost: 120,
    description: "+5% home power per level",
  },
  barracks: {
    name: "Barracks",
    baseCost: 180,
    description: "Unlocks advanced unit types",
  },
} as const;

export type UnitKey = keyof typeof UNIT_RULES;
export type BuildingKey = keyof typeof BUILDING_RULES;
export type PlateauType = "sphere" | "training" | "gemheart" | "ancient_ruins";

export type UnitCounts = Record<UnitKey, number>;
export type BuildingLevels = Record<BuildingKey, number>;
export type PlateauCounts = Record<PlateauType, number>;

export function emptyUnits(): UnitCounts {
  return {
    bridgeman: 0,
    spearman: 0,
    chull: 0,
    scout: 0,
    heavy: 0,
    shardbearer: 0,
  };
}

export function unitKeys() {
  return Object.keys(UNIT_RULES) as UnitKey[];
}

export function activeUnitKeys() {
  return unitKeys().filter((key) => UNIT_RULES[key].active);
}

export function normalizeUnits(units: Partial<UnitCounts>): UnitCounts {
  const normalized = emptyUnits();
  for (const key of unitKeys()) {
    normalized[key] = Math.max(0, Math.floor(units[key] ?? 0));
  }
  return normalized;
}

export function emptyBuildings(): BuildingLevels {
  return {
    market: 0,
    watchtower: 0,
    barracks: 0,
  };
}

export function getBuildingCost(building: BuildingKey, currentLevel: number) {
  return BUILDING_RULES[building].baseCost * (currentLevel + 1);
}

export function emptyPlateauCounts(): PlateauCounts {
  return {
    sphere: 0,
    training: 0,
    gemheart: 0,
    ancient_ruins: 0,
  };
}

export function diminishingMultiplier(index: number) {
  const values = PLATEAU_RULES.diminishingReturns;
  return values[Math.min(index, values.length - 1)];
}

export function diminishingTotal(count: number) {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += diminishingMultiplier(index);
  }
  return total;
}

export function plateauIncomePerGameDay(counts: PlateauCounts) {
  return (
    PLATEAU_RULES.sphereIncomePerGameDay *
    diminishingTotal(counts.sphere)
  );
}

export function trainingDiscount(counts: PlateauCounts) {
  return Math.min(
    0.75,
    PLATEAU_RULES.trainingDiscountPerPlateau *
      diminishingTotal(counts.training),
  );
}

export function totalUnits(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce((sum, key) => sum + normalized[key], 0);
}

export function unitSpeed(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  const total = totalUnits(normalized);
  if (total === 0) return 0;
  const weightedSpeed = unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].speed,
    0,
  );
  return weightedSpeed / total;
}

export function basePower(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].power,
    0,
  );
}

export function shardbearerMultiplier(units: Partial<UnitCounts>) {
  return normalizeUnits(units).shardbearer > 0 ? 2 : 1;
}

export function effectivePower(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return basePower(normalized) * shardbearerMultiplier(normalized);
}

export function unitPlunder(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].plunder,
    0,
  );
}

export function travelMsForUnits(units: Partial<UnitCounts>) {
  const baseMs = TIME_RULES.raidTravelGameDays * TIME_RULES.realMsPerGameDay;
  const speed = Math.max(0, unitSpeed(units));
  const effectiveSpeed = Math.min(speed, TIME_RULES.maxTravelReductionPercent);
  return Math.max(
    60 * 1000,
    Math.round(baseMs * (1 - effectiveSpeed / 100)),
  );
}

function seededUnitRoll(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function applySurvivalLosses(
  units: Partial<UnitCounts>,
  exposedCount: number,
  seed: string,
) {
  const normalized = normalizeUnits(units);
  const survivors = { ...normalized };
  const casualties = emptyUnits();
  const unitPool: UnitKey[] = [];

  for (const key of unitKeys()) {
    for (let index = 0; index < normalized[key]; index += 1) {
      unitPool.push(key);
    }
  }

  const exposed = unitPool
    .map((key, index) => ({
      key,
      order: seededUnitRoll(`${seed}:exposed:${key}:${index}`),
      index,
    }))
    .sort((left, right) => left.order - right.order)
    .slice(0, Math.min(Math.max(0, exposedCount), unitPool.length));

  for (const entry of exposed) {
    const roll = seededUnitRoll(`${seed}:survival:${entry.key}:${entry.index}`);
    if (roll > UNIT_RULES[entry.key].survival) {
      survivors[entry.key] -= 1;
      casualties[entry.key] += 1;
    }
  }

  return {
    survivors,
    casualties,
    exposed: exposed.length,
  };
}

export function casualtySummary(casualties: Partial<UnitCounts>) {
  const normalized = normalizeUnits(casualties);
  const parts = unitKeys()
    .filter((key) => normalized[key] > 0)
    .map((key) => `${normalized[key]} ${UNIT_RULES[key].name}`);
  return parts.length ? parts.join(", ") : "none";
}

export function survivalProfile(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  const included = unitKeys().filter((key) => normalized[key] > 0);
  if (!included.length) return { label: "None", details: "No units selected." };
  const lowest = Math.min(...included.map((key) => UNIT_RULES[key].survival));
  const label =
    lowest >= 0.995
      ? "Exceptional"
      : lowest >= 0.97
        ? "Durable"
        : lowest >= 0.93
          ? "Steady"
          : lowest >= 0.8
            ? "Risky"
            : "Fragile";
  const details = included
    .map(
      (key) =>
        `${UNIT_RULES[key].name}: ${Math.round(UNIT_RULES[key].survival * 1000) / 10}%`,
    )
    .join(", ");
  return { label, details };
}

export function calculateArmyStats(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  const base = basePower(normalized);
  const speed = unitSpeed(normalized);
  const multiplier = shardbearerMultiplier(normalized);
  const survival = survivalProfile(normalized);

  return {
    totalUnits: totalUnits(normalized),
    basePower: base,
    speed,
    power: base * multiplier,
    plunder: unitPlunder(normalized),
    survivalLabel: survival.label,
    survivalDetails: survival.details,
    shardbearerMultiplier: multiplier,
  };
}

export function incomePerGameDay(player: {
  acres: number;
  buildings: { market: number };
  plateauCounts?: PlateauCounts;
}) {
  return (
    plateauIncomePerGameDay(player.plateauCounts ?? emptyPlateauCounts()) +
    player.buildings.market * ECONOMY_RULES.marketSpheresPerLevelPerGameDay
  );
}

export function roundResource(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function pendingEconomy(player: {
  acres: number;
  buildings: { market: number };
  plateauCounts?: PlateauCounts;
  lastEconomyAt?: number;
  createdAt: number;
}, now: number) {
  const lastEconomyAt = player.lastEconomyAt ?? player.createdAt;
  const elapsedMs = Math.max(0, now - lastEconomyAt);
  const elapsedGameDays = elapsedMs / TIME_RULES.realMsPerGameDay;
  const income = incomePerGameDay(player) * elapsedGameDays;

  return {
    lastEconomyAt,
    elapsedMs,
    elapsedGameDays,
    income: roundResource(income),
    incomePerGameDay: incomePerGameDay(player),
  };
}

export function calculateBuildingStats(
  acres: number,
  buildings: BuildingLevels,
  plateauCounts: PlateauCounts = emptyPlateauCounts(),
) {
  const acreIncomePerDay = plateauIncomePerGameDay(plateauCounts);
  const marketIncomePerDay =
    buildings.market * ECONOMY_RULES.marketSpheresPerLevelPerGameDay;
  const watchtowerDefenseBonus =
    buildings.watchtower * COMBAT_RULES.watchtowerDefensePerLevel;

  return {
    acreIncomePerDay,
    marketIncomePerDay,
    totalIncomePerDay: acreIncomePerDay + marketIncomePerDay,
    watchtowerDefenseBonus,
    watchtowerDefensePercent: Math.round(watchtowerDefenseBonus * 100),
    barracksLevel: buildings.barracks,
  };
}

export function getGameClock(createdAt: number, now: number) {
  const elapsedMs = Math.max(0, now - createdAt);
  const elapsedGameDays = elapsedMs / TIME_RULES.realMsPerGameDay;
  const day = Math.floor(elapsedGameDays) + 1;
  const hour = Math.floor(
    (elapsedGameDays % 1) * TIME_RULES.gameHoursPerDay,
  );
  const gameWeek = Math.floor((day - 1) / 7) + 1;
  const dayOfWeek = ((day - 1) % 7) + 1;
  const gameMonth = Math.floor((day - 1) / 28) + 1;
  const dayOfMonth = ((day - 1) % 28) + 1;

  return {
    day,
    hour,
    gameWeek,
    dayOfWeek,
    gameMonth,
    dayOfMonth,
    label: `Day ${day}, hour ${hour}`,
    elapsedGameDays,
  };
}
