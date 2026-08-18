import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  ARDENTIA_RULES,
  addUnits,
  largeProvisionsBonus,
  normalizeUnits,
  provisionsCapacity,
  unitProvisionsUsed,
  type BuildingLevels,
  type PlateauCounts,
  type UnitCounts,
} from "./rules";
import { addOperatives, operativeProvisions, type OperativeCounts } from "./espionageRules";

type Ctx = QueryCtx | MutationCtx;

function plateauCountTotal(counts: PlateauCounts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export async function ownedUnitsIncludingAway(
  ctx: Ctx,
  playerId: Id<"players">,
  homeUnits: UnitCounts,
) {
  let units = normalizeUnits(homeUnits);

  const pendingRaids = await ctx.db
    .query("raids")
    .withIndex("by_attacker_and_status", (q) => q.eq("attackerId", playerId).eq("status", "pending"))
    .take(100);
  for (const raid of pendingRaids) {
    units = addUnits(units, raid.units);
  }

  const attackingSieges = await ctx.db
    .query("sieges")
    .withIndex("by_attacker_and_status", (q) => q.eq("attackerId", playerId).eq("status", "pending"))
    .take(100);
  for (const siege of attackingSieges) {
    units = addUnits(units, siege.attackerUnits);
  }

  const defendingSieges = await ctx.db
    .query("sieges")
    .withIndex("by_defender_and_status", (q) => q.eq("defenderId", playerId).eq("status", "pending"))
    .take(100);
  for (const siege of defendingSieges) {
    units = addUnits(units, siege.defenderUnits ?? {});
  }

  const openRuns = await ctx.db
    .query("plateauRuns")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .take(20);
  for (const run of openRuns) {
    const commitment = await ctx.db
      .query("plateauCommitments")
      .withIndex("by_run_player", (q) =>
        q.eq("plateauRunId", run._id).eq("playerId", playerId),
      )
      .unique();
    if (commitment) {
      units = addUnits(units, commitment.units);
    }
  }

  return units;
}

export async function ownedOperativesIncludingAway(
  ctx: Ctx,
  playerId: Id<"players">,
  available?: Partial<OperativeCounts>,
  defending?: Partial<OperativeCounts>,
) {
  let operatives = addOperatives(available, defending);
  const pendingMissions = await ctx.db
    .query("espionageMissions")
    .withIndex("by_attackerId_and_status_and_resolveAt", (q) =>
      q.eq("attackerId", playerId).eq("status", "pending"),
    )
    .take(100);
  for (const mission of pendingMissions) operatives = addOperatives(operatives, mission.operatives);
  return operatives;
}

export function provisionsStatus(
  buildings: Partial<BuildingLevels>,
  plateauCounts: PlateauCounts,
  ownedUnits: UnitCounts,
  largePlateauCount = 0,
  ardentiaConclaves = 0,
  ownedOperatives?: Partial<OperativeCounts>,
) {
  const used = unitProvisionsUsed(ownedUnits) +
    Math.max(0, Math.floor(ardentiaConclaves)) * ARDENTIA_RULES.provisionsCost +
    operativeProvisions(ownedOperatives);
  const capacity = provisionsCapacity(
    buildings,
    plateauCountTotal(plateauCounts),
    largePlateauCount,
  );

  return {
    used,
    capacity,
    remaining: Math.max(0, capacity - used),
    largeBonusPercent: Math.round(largeProvisionsBonus(largePlateauCount) * 100),
  };
}
