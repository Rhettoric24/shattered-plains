import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ARDENTIA_RULES, conclaveRank } from "./rules";
import { reconcileResearch, researchForPlayer } from "./researchHelpers";

type Ctx = QueryCtx | MutationCtx;

export async function ardentiaConclaveStatus(
  ctx: Ctx,
  playerId: Id<"players">,
  owned: number,
  monasteryLevel: number,
) {
  const conclaves = await ctx.db.query("ardentConclaves").withIndex("by_ownerPlayerId", (q) => q.eq("ownerPlayerId", playerId)).take(10);
  if (conclaves.length > 0) {
    const capacity = Math.max(0, Math.floor(monasteryLevel)) * ARDENTIA_RULES.conclavesPerMonasteryLevel;
    return { owned: conclaves.length, away: conclaves.filter((entry) => entry.missionId).length, ready: conclaves.filter((entry) => !entry.missionId).length, capacity, provisionsEach: ARDENTIA_RULES.provisionsCost, conclaves: conclaves.map((entry) => ({ ...entry, rank: conclaveRank(entry.xp) })) };
  }
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
    conclaves: [],
  };
}

export async function assignConclave(ctx: MutationCtx, playerId: Id<"players">, conclaveId: Id<"ardentConclaves"> | undefined, missionKind: "raid" | "siege" | "plateau_run", missionId: string) {
  if (!conclaveId) return undefined;
  const conclave = await ctx.db.get(conclaveId);
  if (!conclave || conclave.ownerPlayerId !== playerId) throw new Error("Choose one of your Scout Conclaves.");
  if (conclave.missionId) throw new Error(`${conclave.name} is already away on a mission.`);
  const now = Date.now();
  const state = await researchForPlayer(ctx, playerId);
  const combatResearch = Math.floor(state?.completedLevels.religiousStudies ?? 0) >= 3;
  if (combatResearch) await reconcileResearch(ctx, playerId, now);
  await ctx.db.patch(conclave._id, { missionKind, missionId, updatedAt: now });
  if (combatResearch) await reconcileResearch(ctx, playerId, now);
  return conclave._id;
}

export async function releaseConclave(ctx: MutationCtx, conclaveId: Id<"ardentConclaves"> | undefined, xp = 0) {
  if (!conclaveId) return 0;
  const conclave = await ctx.db.get(conclaveId);
  if (!conclave) return 0;
  const now = Date.now();
  const state = await researchForPlayer(ctx, conclave.ownerPlayerId);
  const religiousLevel = Math.floor(state?.completedLevels.religiousStudies ?? 0);
  const awardedXp = xp * (religiousLevel >= 1 ? 2 : 1);
  if (xp > 0 || religiousLevel >= 3) await reconcileResearch(ctx, conclave.ownerPlayerId, now);
  await ctx.db.patch(conclave._id, { xp: conclave.xp + awardedXp, missionKind: undefined, missionId: undefined, updatedAt: now });
  if (xp > 0 || religiousLevel >= 3) await reconcileResearch(ctx, conclave.ownerPlayerId, now);
  return awardedXp;
}

export function missionXpBudget(difficulty: number) {
  const bands = ARDENTIA_RULES.missionXpBands;
  if (difficulty <= 50) return bands[0];
  if (difficulty <= 100) return bands[1];
  if (difficulty <= 200) return bands[2];
  return bands[3];
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
