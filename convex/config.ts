import { query } from "./_generated/server";
import {
  ARDENTIA_RULES,
  ARMY_RULES,
  BUILDING_RULES,
  COMBAT_RULES,
  ECONOMY_RULES,
  PLATEAU_RULES,
  PLATEAU_RUN_RULES,
  PLATEAU_RUN_SCHEDULE,
  MILITARY_RESISTANCE_BANDS,
  STARTING_RULES,
  TIME_RULES,
  RESEARCH_RULES,
  UNIT_RULES,
} from "./rules";
import { HOSTILITY_STATES, WORLD_PRESSURE_RULES } from "./worldPressureRules";

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
      baseSphereIncomePerGameDay: ECONOMY_RULES.baseSphereIncomePerGameDay,
      realMsPerGameDay: TIME_RULES.realMsPerGameDay,
      raidTravelGameDays: TIME_RULES.raidTravelGameDays,
      statDiminishingConstant: TIME_RULES.statDiminishingConstant,
      armyRules: ARMY_RULES,
      ardentiaRules: ARDENTIA_RULES,
      researchRules: RESEARCH_RULES,
      spheresPerAcrePerGameDay: ECONOMY_RULES.spheresPerAcrePerGameDay,
      plateauRules: PLATEAU_RULES,
      marketSpheresPerLevelPerGameDay:
        ECONOMY_RULES.marketSpheresPerLevelPerGameDay,
      parshendiSphereRaidMinDefense: COMBAT_RULES.parshendiSphereRaidMinDefense,
      parshendiSphereRaidMaxDefense: COMBAT_RULES.parshendiSphereRaidMaxDefense,
      parshendiSphereRaidMinReward: COMBAT_RULES.parshendiSphereRaidMinReward,
      parshendiSphereRaidMaxReward: COMBAT_RULES.parshendiSphereRaidMaxReward,
      units: UNIT_RULES,
      buildings: BUILDING_RULES,
      plateauRuns: PLATEAU_RUN_RULES,
      plateauRunSchedule: PLATEAU_RUN_SCHEDULE,
      militaryResistanceBands: MILITARY_RESISTANCE_BANDS,
      worldPressure: {
        rules: WORLD_PRESSURE_RULES,
        states: HOSTILITY_STATES,
      },
    };
  },
});
