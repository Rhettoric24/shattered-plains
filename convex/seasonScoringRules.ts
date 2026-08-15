export const SEASON_CATEGORIES = {
  military: { name: "Military", description: "Victories, defenses, and meaningful shared-world operations." },
  research: { name: "Research", description: "Completed scholarship, Conclave growth, and Ancient stewardship." },
  economy: { name: "Economy", description: "Investment in Markets and kingdom infrastructure." },
  territory: { name: "Territory", description: "Expansion and uninterrupted control of the Plains." },
} as const;

export type SeasonCategory = keyof typeof SEASON_CATEGORIES;

export const SEASON_SCORING_RULES = {
  military: {
    parshendiRaidVictory: 5,
    pvpSiegeVictory: 12,
    pvpSiegeDefense: 10,
    plateauRunWinner: 10,
    plateauRunContributor: 4,
    plateauRunMinimumPower: 10,
    plateauRunMinimumDifficultyShare: 0.05,
  },
  research: {
    levelPoints: [1, 3, 6, 10],
    conclaveRankPoints: [0, 1, 2, 3, 5],
    ancientHoldIntervalMs: 12 * 60 * 60 * 1000,
    ancientHoldPoints: 3,
  },
  economy: {
    buildingPoints: { market: 2, watchtower: 1, ardentMonastery: 1, barracks: 1, soulcastBunker: 1 },
  },
  territory: {
    milestones: [{ count: 2, points: 2 }, { count: 5, points: 8 }],
    holdIntervalMs: 12 * 60 * 60 * 1000,
    holdPoints: 1,
    valuableTypeBonus: { ancient: 1, ancient_ruins: 1, gemheart: 1 },
  },
  opponentChains: {
    resetAfterMs: 24 * 60 * 60 * 1000,
    multipliers: [1, 0.85, 0.7, 0.5],
  },
  achievements: {
    firstBlood: { name: "First Blood", icon: "⚔", category: "military", points: 5, flavor: "The first rival plateau fell before your banners.", requirement: "Win your first offensive PvP siege of the season." },
    holdTheLine: { name: "Hold the Line", icon: "◆", category: "military", points: 5, flavor: "The line bent, but it did not break.", requirement: "Successfully defend a plateau from a PvP siege." },
    reclamation: { name: "Reclamation", icon: "↺", category: "territory", points: 6, flavor: "What was taken has been restored.", requirement: "Retake a plateau you lost to another kingdom this season." },
    ancientCustodian: { name: "Ancient Custodian", icon: "✦", category: "territory", points: 8, flavor: "Your watch endured beside the old stones.", requirement: "Hold one Ancient Plateau continuously for 24 hours." },
    variedOpposition: { name: "Varied Opposition", icon: "◇", category: "military", points: 8, flavor: "Your banners have met many rivals upon the Plains.", requirement: "Earn qualifying PvP victories against 3 different kingdoms." },
  },
  ancientCustodianMs: 24 * 60 * 60 * 1000,
  variedOppositionCount: 3,
} as const;

export function chainMultiplier(position: number) {
  const values = SEASON_SCORING_RULES.opponentChains.multipliers;
  return values[Math.min(Math.max(1, Math.floor(position)) - 1, values.length - 1)];
}

export function publicSeasonScoringRules() {
  return { categories: SEASON_CATEGORIES, ...SEASON_SCORING_RULES };
}
