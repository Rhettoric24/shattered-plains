export const WORLD_KEY = "main";

export const TIME_RULES = {
  realMsPerGameDay: 60 * 60 * 1000,
  gameHoursPerDay: 24,
  raidTravelGameDays: 1,
  speedReductionPerPoint: 0.01,
} as const;

export const STARTING_RULES = {
  acres: 20,
  openAcresPerNewPlayer: 100,
  spheres: 1200,
  gemhearts: 1,
} as const;

export const ECONOMY_RULES = {
  spheresPerAcrePerGameDay: 6,
  marketSpheresPerLevelPerGameDay: 250,
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
    power: 0.25,
    speed: 1,
    cost: 5,
    gemheartCost: 0,
    barracksLevel: 0,
  },
  spearman: {
    name: "Spearman",
    power: 2,
    speed: 0,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 0,
  },
  scout: {
    name: "Scout",
    power: 1.5,
    speed: 1,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 2,
  },
  heavy: {
    name: "Heavy Infantry",
    power: 4,
    speed: -0.5,
    cost: 35,
    gemheartCost: 0,
    barracksLevel: 3,
  },
  shardbearer: {
    name: "Shardbearer",
    power: 8,
    speed: 0,
    cost: 0,
    gemheartCost: 1,
    barracksLevel: 0,
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

export type UnitCounts = Record<UnitKey, number>;
export type BuildingLevels = Record<BuildingKey, number>;

export function emptyUnits(): UnitCounts {
  return {
    bridgeman: 0,
    spearman: 0,
    scout: 0,
    heavy: 0,
    shardbearer: 0,
  };
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

export function totalUnits(units: UnitCounts) {
  return Object.values(units).reduce((sum, count) => sum + count, 0);
}

export function unitSpeed(units: UnitCounts) {
  return (Object.keys(UNIT_RULES) as UnitKey[]).reduce(
    (sum, key) => sum + units[key] * UNIT_RULES[key].speed,
    0,
  );
}

export function effectivePower(units: UnitCounts) {
  const basePower = (Object.keys(UNIT_RULES) as UnitKey[]).reduce(
    (sum, key) => sum + units[key] * UNIT_RULES[key].power,
    0,
  );
  return units.shardbearer > 0 ? basePower * 2 : basePower;
}

export function calculateArmyStats(units: UnitCounts) {
  const basePower = (Object.keys(UNIT_RULES) as UnitKey[]).reduce(
    (sum, key) => sum + units[key] * UNIT_RULES[key].power,
    0,
  );
  const speed = unitSpeed(units);
  const shardbearerMultiplier = units.shardbearer > 0 ? 2 : 1;

  return {
    totalUnits: totalUnits(units),
    basePower,
    speed,
    power: basePower * shardbearerMultiplier,
    shardbearerMultiplier,
  };
}

export function incomePerGameDay(player: {
  acres: number;
  buildings: { market: number };
}) {
  return (
    player.acres * ECONOMY_RULES.spheresPerAcrePerGameDay +
    player.buildings.market * ECONOMY_RULES.marketSpheresPerLevelPerGameDay
  );
}

export function roundResource(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function pendingEconomy(player: {
  acres: number;
  buildings: { market: number };
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
) {
  const acreIncomePerDay = acres * ECONOMY_RULES.spheresPerAcrePerGameDay;
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
