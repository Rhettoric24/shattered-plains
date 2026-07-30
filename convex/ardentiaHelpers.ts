import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ARDENTIA_RULES } from "./rules";

type Ctx = QueryCtx | MutationCtx;

export async function ardentiaConclaveStatus(
  ctx: Ctx,
  playerId: Id<"players">,
  owned: number,
  monasteryLevel: number,
) {
  const raids = await ctx.db
    .query("raids")
    .withIndex("by_attacker", (q) => q.eq("attackerId", playerId))
    .order("desc")
    .take(100);
  const sieges = await ctx.db
    .query("sieges")
    .withIndex("by_attacker", (q) => q.eq("attackerId", playerId))
    .order("desc")
    .take(100);
  const away = raids.filter(
    (mission) => mission.status === "pending" && mission.ardentiaConclave,
  ).length + sieges.filter(
    (mission) => mission.status === "pending" && mission.ardentiaConclave,
  ).length;
  const capacity = Math.max(0, Math.floor(monasteryLevel)) *
    ARDENTIA_RULES.conclavesPerMonasteryLevel;
  const normalizedOwned = Math.max(0, Math.floor(owned));
  return {
    owned: normalizedOwned,
    away,
    ready: Math.max(0, normalizedOwned - away),
    capacity,
    provisionsEach: ARDENTIA_RULES.provisionsCost,
  };
}

function seededRoll(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function resolveConclaveInvestigation(
  attached: boolean,
  finalCasualtyRate: number,
  seed: string,
) {
  if (!attached) {
    return { attached: false, succeeded: false, successChance: 0 };
  }
  const successChance = Math.max(
    ARDENTIA_RULES.minimumSuccessChance,
    Math.min(ARDENTIA_RULES.maximumSuccessChance, 1 - finalCasualtyRate),
  );
  return {
    attached: true,
    succeeded: seededRoll(`${seed}:ardentia`) < successChance,
    successChance,
  };
}

export function conclaveResultNarrative(args: {
  succeeded: boolean;
  won: boolean;
  successChance: number;
}) {
  const chance = Math.round(args.successChance * 100);
  if (args.succeeded && args.won) {
    return ` The Ardentia Scout Conclave completed an orderly survey after the fighting (${chance}% success chance).`;
  }
  if (args.succeeded) {
    return ` Though the expedition was routed, surviving ardents escaped with valuable observations (${chance}% success chance).`;
  }
  return ` The Ardentia Scout Conclave was scattered during the fighting and could not assemble a reliable report (${chance}% success chance).`;
}
