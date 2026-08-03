export const WORLD_KEY = "main";

export const TIME_RULES = {
  realMsPerGameDay: 60 * 60 * 1000,
  gameHoursPerDay: 24,
  raidTravelGameDays: 1,
  statDiminishingConstant: 100,
  minimumMissionMs: 60 * 1000,
} as const;

export const ARMY_RULES = {
  shardbearerSupportPowerPerUnit: 100,
  baseCasualtyFactor: 0.25,
  minimumBaseCasualtyRate: 0.03,
  maximumBaseCasualtyRate: 0.8,
  maximumFinalCasualtyRate: 0.95,
} as const;

export const ARDENTIA_RULES = {
  name: "Ardentia Scout Conclave",
  recruitmentCost: 2000,
  provisionsCost: 10,
  conclavesPerMonasteryLevel: 1,
  maxPerMission: 1,
  minimumSuccessChance: 0.25,
  maximumSuccessChance: 0.95,
  monasteryAncientPlateausRequired: 2,
  rankThresholds: [0, 500, 1000, 1500, 2000],
  nameMinLength: 2,
  nameMaxLength: 32,
  missionXpBands: [75, 100, 125, 150],
} as const;

export const RESEARCH_RULES = {
  speedCapPercent: 30,
  monasterySpeedPerLevelPercent: 1,
  ancientPlateausPerSpeedPercent: 2,
  durationsMs: [60 * 60 * 1000, 4 * 60 * 60 * 1000, 12 * 60 * 60 * 1000],
  sphereCosts: [1000, 3000, 7500],
  projects: {
    bridgeEngineering: { name: "Bridge Engineering", library: "Military", ancient: [0, 1, 2], gemhearts: [0, 0, 0], effects: [2, 4, 6], effect: "effective Speed" },
    packHarnessDesign: { name: "Pack Harness Design", library: "Military", ancient: [0, 1, 2], gemhearts: [0, 0, 0], effects: [10, 20, 30], effect: "% Chull Plunder" },
    painrialMedicine: { name: "Painrial Medicine", library: "Military", ancient: [0, 1, 2], gemhearts: [0, 1, 2], effects: [5, 10, 15], effect: "% casualty reduction" },
    soulcastArmor: { name: "Soulcast Armor", library: "Military", ancient: [0, 1, 2], gemhearts: [0, 1, 2], effects: [0.1, 0.2, 0.3], effect: "Power per Spearman" },
    siegeEngineering: { name: "Siege Engineering", library: "Military", ancient: [0, 1, 2], gemhearts: [0, 0, 1], effects: [8, 16, 24], effect: "% Emergency Defense cost reduction" },
    gemCutting: { name: "Gem Cutting", library: "Commerce", ancient: [1, 2, 3], gemhearts: [1, 2, 3], effects: [11.5, 11, 10], effect: "hour Gemheart interval" },
    soulcasting: { name: "Soulcasting", library: "Commerce", ancient: [0, 1, 2], gemhearts: [0, 1, 1], effects: [5, 10, 15], effect: "% building cost reduction" },
    marketEconomics: { name: "Market Economics", library: "Commerce", ancient: [0, 0, 1], gemhearts: [0, 0, 1], effects: [10, 20, 30], effect: "% Market income" },
  },
} as const;

export type ResearchProjectKey = keyof typeof RESEARCH_RULES.projects;

export function researchLevel(completed: Record<string, number> | undefined, project: ResearchProjectKey) {
  return Math.max(0, Math.min(3, Math.floor(completed?.[project] ?? 0)));
}

export function researchEffect(completed: Record<string, number> | undefined, project: ResearchProjectKey) {
  const level = researchLevel(completed, project);
  return level > 0 ? RESEARCH_RULES.projects[project].effects[level - 1] : 0;
}

export function conclaveRank(xp: number) {
  let rank = 1;
  for (let index = 0; index < ARDENTIA_RULES.rankThresholds.length; index += 1) {
    if (xp >= ARDENTIA_RULES.rankThresholds[index]) rank = index + 1;
  }
  return rank;
}

export const STARTING_RULES = {
  acres: 20,
  openAcresPerNewPlayer: 100,
  startingPlateaus: 2,
  starterPlateauProvisionsCapacity: 25,
  neutralPlateausPerNewPlayer: 3,
  spheres: 1200,
  gemhearts: 1,
} as const;

export const ECONOMY_RULES = {
  spheresPerAcrePerGameDay: 6,
  baseSphereIncomePerGameDay: 250,
  marketSpheresPerLevelPerGameDay: 250,
} as const;

export const PLATEAU_RULES = {
  starterType: "sphere",
  starterHighground: true,
  starterLarge: false,
  homePlateauTypes: ["sphere", "bridged", "ancient"],
  homePlateauPackages: [
    ["sphere", "bridged"],
    ["sphere", "ancient"],
    ["bridged", "ancient"],
  ],
  sphereIncomeBonusPerPlateau: 0.1,
  sphereIncomeBonusMax: 0.3,
  bridgedTravelReductionPerPlateau: 0.1,
  bridgedTravelReductionMax: 0.3,
  largeProvisionsBonusPerPlateau: 0.1,
  largeProvisionsBonusMax: 0.3,
  neutralLargeChancePercent: 15,
  initialGemheartPlateauPlayerDivisor: 3,
  trainingDiscountPerPlateau: 0.1,
  gemheartIntervalMs: 12 * 60 * 60 * 1000,
  highgroundDefenseBonus: 0.2,
  neutralDefenseMin: 120,
  neutralDefenseMax: 220,
  neutralHighgroundChancePercent: 12,
  siegeFortifySpheresPerPercent: 50,
  siegeFortifyMaxPercent: 100,
  emergencyDefenseMaxPercent: 100,
  emergencyDefenseMaxCost: 12000,
  emergencyDefenseCostExponent: 2,
  attackerRetreatLossRate: 0.18,
  defenderRetreatLossRate: 0.12,
  diminishingReturns: [1, 0.75, 0.5, 0.25],
} as const;

export const COMBAT_RULES = {
  openDefenseBase: 0.6,
  openDefensePerAcre: 0.18,
  parshendiSphereRaidMinDefense: 20,
  parshendiSphereRaidMaxDefense: 50,
  parshendiSphereRaidMinReward: 250,
  parshendiSphereRaidMaxReward: 650,
} as const;

export function resistanceLabel(power: number) {
  if (power <= 50) return "Vulnerable";
  if (power <= 100) return "Guarded";
  if (power <= 150) return "Defended";
  if (power <= 220) return "Fortified";
  return "Impregnable";
}

export function missionRiskLabel(power: number) {
  if (power <= 20) return "Manageable";
  if (power <= 36) return "Dangerous";
  if (power <= 56) return "Brutal";
  return "Overwhelming";
}

export function rewardLabel(spheres: number) {
  if (spheres <= 1200) return "Small";
  if (spheres <= 2600) return "Rich";
  return "Massive";
}

export const PLATEAU_RUN_RULES = {
  everyGameDays: 3,
  joinRealMs: 30 * 60 * 1000,
  activePlayerWindowMs: 2 * 24 * 60 * 60 * 1000,
  difficultyPerActivePlayer: 15,
  difficultyRandomMin: 1,
  difficultyRandomMax: 4,
  minimumDifficulty: 5,
  sphereRewardPerActivePlayer: 500,
  sphereRewardRandomMin: 250,
  sphereRewardRandomMax: 900,
  gemheartReward: 1,
  fastestPowerBonus: 0.1,
  joinOrderSpeedBonuses: [0.1, 0.07, 0.05],
} as const;

export const PLATEAU_RUN_SCHEDULE = [
  { hour: 9, minute: 0, label: "9 AM" },
  { hour: 12, minute: 0, label: "Noon" },
  { hour: 20, minute: 0, label: "8 PM" },
] as const;

export const UNIT_RULES = {
  bridgeman: {
    name: "Bridgeman",
    role: "Rapid deployment",
    identity: "Makes missions dramatically faster, but leaves the formation more exposed.",
    bestFor: "Fast raids, expeditions, and beating rivals to timed objectives.",
    active: true,
    provisionsCost: 0.5,
    power: 0.5,
    speed: 1,
    plunder: 1,
    survivability: -1,
    cost: 5,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  spearman: {
    name: "Spearman",
    role: "Reliable battle line",
    identity: "The dependable core of an army: steady Power and better casualty control.",
    bestFor: "Winning ordinary fights and protecting more specialized units.",
    active: true,
    provisionsCost: 1,
    power: 1,
    speed: 0,
    plunder: 0.5,
    survivability: 1,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  chull: {
    name: "Chull",
    role: "Heavy transport",
    identity: "Carries enormous loot and protects the column, but sharply slows every mission.",
    bestFor: "Sphere raids, Gemheart Runs, and any mission where cargo capacity matters.",
    active: true,
    provisionsCost: 5,
    power: 0,
    speed: -1,
    plunder: 30,
    survivability: 2,
    cost: 45,
    gemheartCost: 0,
    barracksLevel: 0,
    trainingTime: "Instant",
  },
  scout: {
    name: "Scout",
    role: "Legacy intelligence unit",
    identity: "A future specialist for information and reconnaissance.",
    bestFor: "Inactive until intelligence missions are introduced.",
    active: false,
    provisionsCost: 2,
    power: 0.25,
    speed: 2,
    plunder: 0,
    survivability: 0,
    cost: 18,
    gemheartCost: 0,
    barracksLevel: 2,
    trainingTime: "Instant",
  },
  heavy: {
    name: "Heavy Infantry",
    role: "Legacy defensive unit",
    identity: "A future durable assault and defensive specialist.",
    bestFor: "Inactive until deeper siege roles are introduced.",
    active: false,
    provisionsCost: 6,
    power: 2,
    speed: -1,
    plunder: 0,
    survivability: 3,
    cost: 35,
    gemheartCost: 0,
    barracksLevel: 3,
    trainingTime: "Instant",
  },
  shardbearer: {
    name: "Shardbearer",
    role: "Legendary breakthrough",
    identity: "Personally devastating and able to magnify a bounded amount of supporting troop Power.",
    bestFor: "Turning a compact assault force into a serious battlefield threat.",
    active: true,
    provisionsCost: 8,
    power: 20,
    speed: 0,
    plunder: 0,
    survivability: 5,
    cost: 0,
    gemheartCost: 1,
    barracksLevel: 0,
    trainingTime: "Instant",
    description:
      "Breakthrough: doubles up to 100 supporting troop Power per Shardbearer.",
  },
} as const;

export const BUILDING_RULES = {
  market: {
    name: "Warcamp Market",
    baseCost: 500,
    costMultiplier: 2,
    constructionTimeMs: 0,
    description: "+250 spheres per game day per level",
  },
  watchtower: {
    name: "Watchtower",
    baseCost: 1500,
    levelCosts: [1500, 3000, 7500],
    maxLevel: 3,
    constructionTimeMs: 0,
    description: "Reveals neutral territory, improves incoming warnings, and protects your warcamp's secrets.",
  },
  ardentMonastery: {
    name: "Ardent Monastery",
    baseCost: 5000,
    levelCosts: [5000, 10000, 15000],
    maxLevel: 3,
    constructionTimeMs: 0,
    description: "Supports one Ardentia Scout Conclave per level and unlocks active field investigations.",
  },
  barracks: {
    name: "Barracks",
    baseCost: 180,
    constructionTimeMs: 0,
    description: "Unlocks advanced unit types",
  },
  soulcastBunker: {
    name: "Soulcast Bunker",
    baseCost: 500,
    levelCosts: [500, 1000, 1750, 2750, 4000, 6000, 8500, 11500, 15000, 19000],
    provisionsByLevel: [75, 100, 125, 150, 175, 200, 250, 300, 350, 400],
    constructionTimeMs: 0,
    description: "Increases total Provisions capacity for larger armies",
  },
} as const;

export type UnitKey = keyof typeof UNIT_RULES;
export type BuildingKey = keyof typeof BUILDING_RULES;
export type PlateauType =
  | "sphere"
  | "training"
  | "gemheart"
  | "ancient_ruins"
  | "bridged"
  | "ancient";

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

export function addUnits(
  current: Partial<UnitCounts>,
  returned: Partial<UnitCounts>,
) {
  const next = normalizeUnits(current);
  const normalizedReturned = normalizeUnits(returned);
  for (const key of unitKeys()) {
    next[key] += normalizedReturned[key];
  }
  return next;
}

export function emptyBuildings(): BuildingLevels {
  return {
    market: 0,
    watchtower: 0,
    ardentMonastery: 0,
    barracks: 0,
    soulcastBunker: 0,
  };
}

export function getBuildingCost(building: BuildingKey, currentLevel: number) {
  const rule = BUILDING_RULES[building];
  if ("levelCosts" in rule) {
    const lastCost = rule.levelCosts[rule.levelCosts.length - 1];
    return rule.levelCosts[currentLevel] ?? lastCost;
  }
  if ("costMultiplier" in rule) {
    return Math.round(rule.baseCost * rule.costMultiplier ** currentLevel);
  }
  return rule.baseCost * (currentLevel + 1);
}

export function emptyPlateauCounts(): PlateauCounts {
  return {
    sphere: 0,
    training: 0,
    gemheart: 0,
    ancient_ruins: 0,
    bridged: 0,
    ancient: 0,
  };
}

export function identityPlateauType(type: PlateauType): PlateauType {
  if (type === "training") return "bridged";
  if (type === "ancient_ruins") return "ancient";
  return type;
}

export type HomePlateauPackage = readonly [PlateauType, PlateauType];

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
  return 0;
}

export function trainingDiscount(counts: PlateauCounts) {
  return 0;
}

export function totalUnits(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce((sum, key) => sum + normalized[key], 0);
}

export function unitProvisionsUsed(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].provisionsCost,
    0,
  );
}

export function soulcastBunkerCapacity(level: number) {
  const capacities = BUILDING_RULES.soulcastBunker.provisionsByLevel;
  let total = 0;
  for (let index = 0; index < Math.max(0, Math.floor(level)); index += 1) {
    total += capacities[index] ?? capacities[capacities.length - 1];
  }
  return total;
}

export function provisionsCapacity(
  buildings: Partial<BuildingLevels>,
  ownedPlateauCount: number,
  largePlateauCount = 0,
) {
  const starterCapacity =
    Math.min(ownedPlateauCount, STARTING_RULES.startingPlateaus) *
    STARTING_RULES.starterPlateauProvisionsCapacity;
  const bunkerCapacity = soulcastBunkerCapacity(buildings.soulcastBunker ?? 0);
  const largeBonus = Math.min(
    PLATEAU_RULES.largeProvisionsBonusMax,
    largePlateauCount * PLATEAU_RULES.largeProvisionsBonusPerPlateau,
  );
  return starterCapacity + Math.floor(bunkerCapacity * (1 + largeBonus));
}

export function sphereIncomeBonus(counts: PlateauCounts) {
  return Math.min(
    PLATEAU_RULES.sphereIncomeBonusMax,
    counts.sphere * PLATEAU_RULES.sphereIncomeBonusPerPlateau,
  );
}

function seededOrder(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function homePlateauPackagesForPlayers(
  playerCount: number,
  seed: string | number,
): HomePlateauPackage[] {
  const packages = PLATEAU_RULES.homePlateauPackages as readonly HomePlateauPackage[];
  const count = Math.max(0, Math.floor(playerCount));
  const baseCount = Math.floor(count / packages.length);
  const remainder = count % packages.length;
  const remainderOrder = packages
    .map((pkg, index) => ({
      pkg,
      index,
      order: seededOrder(`${seed}:home:remainder:${index}`),
    }))
    .sort((left, right) => left.order - right.order);
  const weightedPackages: HomePlateauPackage[] = [];

  for (const pkg of packages) {
    for (let index = 0; index < baseCount; index += 1) {
      weightedPackages.push(pkg);
    }
  }
  for (let index = 0; index < remainder; index += 1) {
    weightedPackages.push(remainderOrder[index].pkg);
  }

  return weightedPackages
    .map((pkg, index) => ({
      pkg,
      order: seededOrder(`${seed}:home:shuffle:${index}:${pkg.join("-")}`),
    }))
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.pkg);
}

export function randomHomePlateauPackage(seed: string | number) {
  const packages = PLATEAU_RULES.homePlateauPackages as readonly HomePlateauPackage[];
  return packages[seededOrder(`${seed}:home:random`) % packages.length];
}

export function bridgedTravelReduction(counts: PlateauCounts) {
  return Math.min(
    PLATEAU_RULES.bridgedTravelReductionMax,
    counts.bridged * PLATEAU_RULES.bridgedTravelReductionPerPlateau,
  );
}

export function largeProvisionsBonus(largePlateauCount: number) {
  return Math.min(
    PLATEAU_RULES.largeProvisionsBonusMax,
    largePlateauCount * PLATEAU_RULES.largeProvisionsBonusPerPlateau,
  );
}

export function initialGemheartPlateauCount(playerCount: number) {
  return Math.max(
    1,
    Math.floor(playerCount / PLATEAU_RULES.initialGemheartPlateauPlayerDivisor),
  );
}

export function unitSpeed(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].speed,
    0,
  );
}

export function unitSurvivability(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].survivability,
    0,
  );
}

export function basePower(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].power,
    0,
  );
}

export function shardbearerBreakthroughBonus(units: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units);
  const supportingPower = unitKeys()
    .filter((key) => key !== "shardbearer")
    .reduce((sum, key) => sum + normalized[key] * UNIT_RULES[key].power, 0);
  return Math.min(
    supportingPower,
    normalized.shardbearer * ARMY_RULES.shardbearerSupportPowerPerUnit,
  );
}

export function effectivePower(units: Partial<UnitCounts>, completed?: Record<string, number>) {
  const normalized = normalizeUnits(units);
  return basePower(normalized) + normalized.spearman * Number(researchEffect(completed, "soulcastArmor")) + shardbearerBreakthroughBonus(normalized);
}

export function unitPlunder(units: Partial<UnitCounts>, completed?: Record<string, number>) {
  const normalized = normalizeUnits(units);
  return unitKeys().reduce(
    (sum, key) => sum + normalized[key] * UNIT_RULES[key].plunder * (key === "chull" ? 1 + Number(researchEffect(completed, "packHarnessDesign")) / 100 : 1),
    0,
  );
}

export function emergencyDefenseCost(percent: number, completed?: Record<string, number>) {
  const cappedPercent = Math.max(
    0,
    Math.min(PLATEAU_RULES.emergencyDefenseMaxPercent, Math.floor(percent)),
  );
  return Math.round((
    PLATEAU_RULES.emergencyDefenseMaxCost *
      (cappedPercent / PLATEAU_RULES.emergencyDefenseMaxPercent) **
        PLATEAU_RULES.emergencyDefenseCostExponent
  ) * (1 - Number(researchEffect(completed, "siegeEngineering")) / 100));
}

export function travelMsForUnits(
  units: Partial<UnitCounts>,
  plateauCounts: PlateauCounts = emptyPlateauCounts(),
  completed?: Record<string, number>,
) {
  const baseMs = TIME_RULES.raidTravelGameDays * TIME_RULES.realMsPerGameDay;
  const speed = unitSpeed(units) + Number(researchEffect(completed, "bridgeEngineering"));
  const constant = TIME_RULES.statDiminishingConstant;
  const travelMultiplier =
    speed >= 0 ? constant / (constant + speed) : 1 + Math.abs(speed) / constant;
  const bridgedMultiplier = 1 - bridgedTravelReduction(plateauCounts);
  return Math.max(
    TIME_RULES.minimumMissionMs,
    Math.round(baseMs * travelMultiplier * bridgedMultiplier),
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
  baseCasualtyRate: number,
  seed: string,
  completed?: Record<string, number>,
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

  const finalCasualtyRate = casualtyRateAfterSurvivability(
    baseCasualtyRate,
    unitSurvivability(normalized),
  ) * (1 - Number(researchEffect(completed, "painrialMedicine")) / 100);
  const expectedCasualties = unitPool.length * finalCasualtyRate;
  const wholeCasualties = Math.floor(expectedCasualties);
  const fractionalCasualty =
    seededUnitRoll(`${seed}:rounding`) < expectedCasualties - wholeCasualties ? 1 : 0;
  const casualtyCount = Math.min(unitPool.length, wholeCasualties + fractionalCasualty);

  const lost = unitPool
    .map((key, index) => ({
      key,
      order: seededUnitRoll(`${seed}:casualty:${key}:${index}`),
      index,
    }))
    .sort((left, right) => left.order - right.order)
    .slice(0, casualtyCount);

  for (const entry of lost) {
    survivors[entry.key] -= 1;
    casualties[entry.key] += 1;
  }

  return {
    survivors,
    casualties,
    baseCasualtyRate,
    finalCasualtyRate,
  };
}

export function baseCasualtyRate(ownPower: number, opposingPower: number) {
  if (opposingPower <= 0) return 0;
  if (ownPower <= 0) return ARMY_RULES.maximumBaseCasualtyRate;
  return Math.max(
    ARMY_RULES.minimumBaseCasualtyRate,
    Math.min(
      ARMY_RULES.maximumBaseCasualtyRate,
      ARMY_RULES.baseCasualtyFactor * (opposingPower / ownPower),
    ),
  );
}

export function casualtyRateAfterSurvivability(
  baseRate: number,
  survivability: number,
) {
  const constant = TIME_RULES.statDiminishingConstant;
  const multiplier =
    survivability >= 0
      ? constant / (constant + survivability)
      : 1 + Math.abs(survivability) / constant;
  return Math.min(
    ARMY_RULES.maximumFinalCasualtyRate,
    Math.max(0, baseRate * multiplier),
  );
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
  if (totalUnits(normalized) < 1) return { label: "None", details: "No units selected." };
  const survivability = unitSurvivability(normalized);
  const label =
    survivability >= 100
      ? "Exceptional preservation"
      : survivability >= 40
        ? "Durable formation"
        : survivability >= 0
          ? "Steady formation"
          : survivability >= -40
            ? "Exposed formation"
            : "Fragile formation";
  return {
    label,
    details: `Army Survivability ${survivability >= 0 ? "+" : ""}${survivability}.`,
  };
}

export function calculateArmyStats(units: Partial<UnitCounts>, completed?: Record<string, number>) {
  const normalized = normalizeUnits(units);
  const base = basePower(normalized);
  const speed = unitSpeed(normalized);
  const survivability = unitSurvivability(normalized);
  const breakthroughPower = shardbearerBreakthroughBonus(normalized);
  const survival = survivalProfile(normalized);

  return {
    totalUnits: totalUnits(normalized),
    basePower: base,
    speed,
    power: effectivePower(normalized, completed),
    plunder: unitPlunder(normalized, completed),
    survivability,
    survivalLabel: survival.label,
    survivalDetails: survival.details,
    shardbearerBreakthroughPower: breakthroughPower,
  };
}

export function incomePerGameDay(player: {
  acres: number;
  buildings: { market: number };
  plateauCounts?: PlateauCounts;
  completedResearch?: Record<string, number>;
}) {
  return incomeBreakdown(player).totalIncomePerDay;
}

export function incomeBreakdown(player: {
  acres: number;
  buildings: { market: number };
  plateauCounts?: PlateauCounts;
  completedResearch?: Record<string, number>;
}) {
  const counts = player.plateauCounts ?? emptyPlateauCounts();
  const baseKingdomIncomePerDay = ECONOMY_RULES.baseSphereIncomePerGameDay;
  const marketIncomePerDay = player.buildings.market *
    ECONOMY_RULES.marketSpheresPerLevelPerGameDay *
    (1 + Number(researchEffect(player.completedResearch, "marketEconomics")) / 100);
  const passiveIncomeBeforeMultiplier =
    baseKingdomIncomePerDay + marketIncomePerDay;
  const sphereBonus = sphereIncomeBonus(counts);
  const sphereBonusIncomePerDay = passiveIncomeBeforeMultiplier * sphereBonus;

  return {
    baseKingdomIncomePerDay,
    marketIncomePerDay,
    otherPassiveIncomePerDay: 0,
    passiveIncomeBeforeMultiplier,
    sphereBonusPercent: Math.round(sphereBonus * 100),
    sphereBonusIncomePerDay,
    totalIncomePerDay: passiveIncomeBeforeMultiplier + sphereBonusIncomePerDay,
  };
}

export function roundResource(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function pendingEconomy(player: {
  acres: number;
  buildings: { market: number };
  plateauCounts?: PlateauCounts;
  completedResearch?: Record<string, number>;
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
  completedResearch?: Record<string, number>,
) {
  const acreIncomePerDay = plateauIncomePerGameDay(plateauCounts);
  const income = incomeBreakdown({
    acres,
    buildings,
    plateauCounts,
    completedResearch,
  });
  const soulcastBunkerLevel = buildings.soulcastBunker ?? 0;

  return {
    acreIncomePerDay,
    ...income,
    barracksLevel: buildings.barracks,
    soulcastBunkerLevel,
    soulcastBunkerCapacity: soulcastBunkerCapacity(soulcastBunkerLevel),
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
