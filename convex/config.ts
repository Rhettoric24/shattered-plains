import { query } from "./_generated/server";
import {
  BUILDING_RULES,
  COMBAT_RULES,
  ECONOMY_RULES,
  PLATEAU_RULES,
  PLATEAU_RUN_RULES,
  STARTING_RULES,
  TIME_RULES,
  UNIT_RULES,
} from "./rules";

export const getGameConfig = query({
  args: {},
  handler: async () => {
    return {
      startingAcres: STARTING_RULES.acres,
      openAcresPerNewPlayer: STARTING_RULES.openAcresPerNewPlayer,
      startingPlateaus: STARTING_RULES.startingPlateaus,
      neutralPlateausPerNewPlayer: STARTING_RULES.neutralPlateausPerNewPlayer,
      startingSpheres: STARTING_RULES.spheres,
      startingGemhearts: STARTING_RULES.gemhearts,
      realMsPerGameDay: TIME_RULES.realMsPerGameDay,
      raidTravelGameDays: TIME_RULES.raidTravelGameDays,
      speedReductionPerPoint: TIME_RULES.speedReductionPerPoint,
      speedQuantityFactor: TIME_RULES.speedQuantityFactor,
      speedNeutralPoint: TIME_RULES.speedNeutralPoint,
      maxTravelReductionPercent: TIME_RULES.maxTravelReductionPercent,
      maxTravelPenaltyPercent: TIME_RULES.maxTravelPenaltyPercent,
      spheresPerAcrePerGameDay: ECONOMY_RULES.spheresPerAcrePerGameDay,
      plateauRules: PLATEAU_RULES,
      marketSpheresPerLevelPerGameDay:
        ECONOMY_RULES.marketSpheresPerLevelPerGameDay,
      watchtowerDefensePerLevel: COMBAT_RULES.watchtowerDefensePerLevel,
      units: UNIT_RULES,
      buildings: BUILDING_RULES,
      plateauRuns: PLATEAU_RUN_RULES,
    };
  },
});
