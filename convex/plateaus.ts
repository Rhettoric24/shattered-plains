import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./admin";
import { insertGameEvent } from "./eventHelpers";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import {
  casualtyIntelSummary,
  recordKingdomReport,
  recordTerritoryReport,
} from "./intelligenceHelpers";
import {
  ardentiaConclaveStatus,
  assignConclave,
  conclaveResultNarrative,
  missionXpBudget,
  releaseConclave,
  resolveConclaveInvestigation,
} from "./ardentiaHelpers";
import { completedResearch, reconcileResearch, recordSuccessfulDefensiveSiege } from "./researchHelpers";
import { createNotification } from "./notificationHelpers";
import { activeHighstorm } from "./highstorms";
import { stormCounterIntelligence, stormParshendiPower, HIGHSTORM_RULES } from "./highstormRules";
import { addOperatives, normalizeOperatives, resolveEspionageOutcome, sphereHeistCasualties, spyPower, subtractOperatives } from "./espionageRules";
import { activeSeason, observePlateauNeutralized, observePlateauOwnership, recordOpponentAttack, recordSiegeDefenseScore, recordSiegeVictoryScore } from "./seasonLedger";
import { subtractAvailableUnits, unitCountsValidator, validateMissionUnits } from "./armyRules";
import {
  effectiveIntelLevel,
  intelligenceFreshness,
  presentIntelNumber,
  territoryResistanceDisclosure,
  watchtowerCounterIntelligence,
  watchtowerTerritoryLevel,
} from "./intelligenceRules";
import {
  createNeutralPlateaus,
  createStarterPlateaus,
  neutralPlateaus,
  ownedPlateaus,
  plateauCountsForPlayer,
  plateauTypeName,
  plateauTypes,
} from "./plateauHelpers";
import {
  addUnits,
  applySurvivalLosses,
  baseCasualtyRate,
  casualtySummary,
  emergencyDefenseCost,
  effectivePower,
  effectiveSpeed,
  emptyUnits,
  identityPlateauType,
  normalizeUnits,
  PLATEAU_RULES,
  resistanceLabel,
  researchEffect,
  STARTING_RULES,
  TIME_RULES,
  totalUnits,
  unitSpeed,
  travelMsForUnits,
  missionMsForBase,
  type UnitCounts,
} from "./rules";
import {
  applyHostility,
  cancelRetaliationForMalformedSiege,
  completeRetaliation,
  reconcileRetaliationSchedule,
} from "./worldPressure";
import { plateauCaptureHostility, reclamationDefense } from "./worldPressureRules";
import { applyFabrialCasualtyProtection } from "./fabrialRules";
import { reserveFabrial, settleReusableFabrial } from "./fabrialHelpers";

function cleanUnits(units: UnitCounts) {
  return normalizeUnits(units);
}

function applyLossRate(units: UnitCounts, lossRate: number, seed: string, completed?: Record<string, number>, conclaveCombat = false) {
  return applySurvivalLosses(normalizeUnits(units), lossRate, seed, completed, conclaveCombat);
}

const SIEGE_V2 = {
  version: 2,
  encircleMs: 60 * 60 * 1000,
  maximumMs: 24 * 60 * 60 * 1000,
  attackerReinforcementBaseMs: 60 * 60 * 1000,
  defenderReinforcementBaseMs: 30 * 60 * 1000,
  attackerInvestigationMs: 60 * 60 * 1000,
  defenderInvestigationMs: 30 * 60 * 1000,
  investigationCost: 50,
  forcedDefenseMultiplier: 1.1,
} as const;

function militaryIntelAmount(resource: Doc<"kingdomIntelResources"> | null | undefined) {
  return Math.max(0, Math.min(100, Math.floor(resource?.militaryAmount ?? resource?.amount ?? 0)));
}

function persistentMilitaryDisclosureLevel(amount: number) {
  if (amount >= 75) return 3;
  if (amount >= 25) return 2;
  return 0;
}

function persistentMilitaryPower(power: number, resource: Doc<"kingdomIntelResources"> | null | undefined) {
  return presentIntelNumber(power, persistentMilitaryDisclosureLevel(militaryIntelAmount(resource)));
}

function militaryAssessmentText(power: number, resource: Doc<"kingdomIntelResources"> | null | undefined) {
  const assessment = persistentMilitaryPower(power, resource);
  if (!assessment) return "";
  if (assessment.mode === "label") return ` Military Intel assessment: ${assessment.label}.`;
  if (assessment.mode === "range" || assessment.mode === "estimate") {
    return ` Military Intel assessment: ${assessment.label} (${assessment.min}-${assessment.max} Power).`;
  }
  return ` Military Intel assessment: ${assessment.label} (${assessment.value} Power snapshot).`;
}

async function siegeIntelResource(ctx: MutationCtx, viewerPlayerId: Id<"players">, targetPlayerId: Id<"players">) {
  return await ctx.db.query("kingdomIntelResources")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", q => q.eq("viewerPlayerId", viewerPlayerId).eq("targetPlayerId", targetPlayerId))
    .unique();
}

async function cancelPendingSiegeInvestigations(ctx: MutationCtx, siegeId: Id<"sieges">, now: number) {
  const pending = (await ctx.db.query("siegeInvestigations").withIndex("by_siegeId", q => q.eq("siegeId", siegeId)).take(20))
    .filter(row => row.status === "pending");
  for (const investigation of pending) {
    const player = await ctx.db.get(investigation.investigatorId);
    if (player) {
      const resource = await siegeIntelResource(ctx, player._id, investigation.targetPlayerId);
      if (resource) await ctx.db.patch(resource._id, { militaryAmount: Math.min(100, militaryIntelAmount(resource) + investigation.militaryIntelSpent), updatedAt: now });
      else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: player._id, targetPlayerId: investigation.targetPlayerId, amount: 0, militaryAmount: investigation.militaryIntelSpent, updatedAt: now });
      await ctx.db.patch(player._id, { operatives: addOperatives(player.operatives, investigation.operatives), lastActiveAt: now });
    }
    await ctx.db.patch(investigation._id, { status: "cancelled", resolvedAt: now });
  }
}

async function validateConclaveAttachment(
  ctx: MutationCtx,
  attacker: {
    _id: Id<"players">;
    ardentiaConclaves?: number;
    buildings: { ardentMonastery?: number };
  },
  attached: boolean,
) {
  if (!attached) return false;
  const status = await ardentiaConclaveStatus(
    ctx,
    attacker._id,
    attacker.ardentiaConclaves ?? 0,
    attacker.buildings.ardentMonastery ?? 0,
  );
  if (status.ready < 1) {
    throw new Error("No Ardentia Scout Conclave is ready for this mission.");
  }
  return true;
}

function committedDefensePower(
  defenderUnits: UnitCounts,
  plateau: any,
  emergencyDefensePercent: number,
  completed?: Record<string, number>,
) {
  const highgroundBonus = plateau.highground
    ? 1 + PLATEAU_RULES.highgroundDefenseBonus
    : 1;
  const emergencyBonus = 1 + emergencyDefensePercent / 100;
  return effectivePower(defenderUnits, completed) * highgroundBonus * emergencyBonus;
}

function committedDefenseBasePower(defenderUnits: UnitCounts, plateau: any) {
  const highgroundBonus = plateau.highground
    ? 1 + PLATEAU_RULES.highgroundDefenseBonus
    : 1;
  return effectivePower(defenderUnits) * highgroundBonus;
}

function siegeTravelMs() {
  return TIME_RULES.raidTravelGameDays * TIME_RULES.realMsPerGameDay;
}

function gemheartProgressForPlateau(plateau: any, now: number, intervalMs: number) {
  const lastGemheartAt = plateau.lastGemheartAt ?? plateau.heldSince ?? plateau.updatedAt;
  return {
    lastGemheartAt,
    nextGemheartAt: lastGemheartAt + intervalMs,
    progressPercent: Math.max(0, Math.min(100, Math.floor(((now - lastGemheartAt) / intervalMs) * 100))),
  };
}

function decoratePlateauForOwner(plateau: any, now: number, gemheartIntervalMs: number) {
  const type = identityPlateauType(plateau.type);
  const gemheartProgress =
    type === "gemheart"
      ? gemheartProgressForPlateau(plateau, now, gemheartIntervalMs)
      : null;

  return {
    ...plateau,
    type,
    typeName: plateauTypeName(type),
    large: Boolean(plateau.large),
    gemheartProgress,
  };
}

export const getMyPlateauState = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const now = Date.now();
    const mine = await ctx.db.query("plateaus").withIndex("by_owner", (q) => q.eq("ownerPlayerId", viewer._id)).take(100);
    const research = await completedResearch(ctx, viewer._id);
    const gemHours = Number(researchEffect(research, "gemCutting"));
    const baseHours = gemHours > 0 ? gemHours : PLATEAU_RULES.gemheartIntervalMs / 3600000;
    const gemheartInterval = (baseHours - (research.__doctrineGemheartBaron ? 1 : 0)) * 60 * 60 * 1000;
    const [attacking, defending] = await Promise.all([
      ctx.db.query("sieges").withIndex("by_attacker_and_status", (q) => q.eq("attackerId", viewer._id).eq("status", "pending")).take(100),
      ctx.db.query("sieges").withIndex("by_defender_and_status", (q) => q.eq("defenderId", viewer._id).eq("status", "pending")).take(100),
    ]);
    const sieges = [...new Map([...attacking, ...defending].map((siege) => [String(siege._id), siege])).values()];
    const siegePlateaus = (await Promise.all(
      [...new Set(sieges.map((siege) => String(siege.plateauId)))].map((id) => ctx.db.get(id as Id<"plateaus">)),
    )).filter((plateau) => plateau !== null);
    const siegePlateauNames = new Map(siegePlateaus.map((plateau) => [String(plateau._id), plateau.name]));
    const playerIds = new Set<Id<"players">>();
    for (const siege of sieges) {
      if (siege.attackerId) playerIds.add(siege.attackerId);
      if (siege.defenderId) playerIds.add(siege.defenderId);
    }
    const players = (await Promise.all([...playerIds].map((id) => ctx.db.get(id)))).filter((row) => row !== null);
    const names = new Map(players.map((player) => [String(player._id), player.name]));
    const intelResources = await ctx.db
      .query("kingdomIntelResources")
      .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewer._id))
      .take(200);
    const watchtowerLevel = Math.min(3, viewer.buildings.watchtower ?? 0);
    const passiveTerritoryLevel = watchtowerTerritoryLevel(watchtowerLevel);
    return {
      types: plateauTypes(),
      counts: mine.reduce((counts, plateau) => {
        counts[identityPlateauType(plateau.type)] += 1;
        return counts;
      }, { sphere: 0, bridged: 0, gemheart: 0, ancient: 0 }),
      mine: mine.map((plateau) => decoratePlateauForOwner(plateau, now, gemheartInterval)),
      sieges: sieges.map((siege) => {
        const isAttacker = siege.attackerId === viewer._id;
        const isDefender = siege.defenderId === viewer._id;
        const attackerIntel = siege.targetType === "player" && isDefender && siege.attackerId
          ? persistentMilitaryPower(
              siege.attackerPower,
              intelResources.find((resource) => resource.targetPlayerId === siege.attackerId),
            )
          : presentIntelNumber(siege.attackerPower, isAttacker ? 3 : isDefender ? passiveTerritoryLevel : 0);
        return {
          _id: siege._id,
          plateauId: siege.plateauId,
          plateauName: siegePlateauNames.get(String(siege.plateauId)) ?? "Unknown plateau",
          ...(siege.attackerId ? { attackerId: siege.attackerId } : {}),
          ...(siege.defenderId ? { defenderId: siege.defenderId } : {}),
          targetType: siege.targetType,
          attackerName: siege.targetType === "parshendi_retaliation" ? "Parshendi" : siege.attackerId ? names.get(String(siege.attackerId)) ?? "Unknown" : "Unknown",
          defenderName: siege.defenderId ? names.get(String(siege.defenderId)) ?? "Unknown" : "Parshendi",
          attackerIntel,
          ...(isAttacker ? { attackerUnits: siege.attackerUnits, attackerPower: siege.attackerPower, attackerSpeed: siege.attackerSpeed, ardentiaConclave: Boolean(siege.ardentiaConclave) } : {}),
          ...(isDefender ? { defenderUnits: siege.defenderUnits, defenderPower: siege.defenderPower, defenderSpeed: siege.defenderSpeed, defenderCommittedAt: siege.defenderCommittedAt ?? null, defenderFabrialKind: siege.defenderFabrialKind, fortifyPercent: siege.fortifyPercent, emergencyDefensePercent: siege.emergencyDefensePercent, emergencyDefenseSpheresSpent: siege.emergencyDefenseSpheresSpent } : {}),
          departAt: siege.departAt,
          resolveAt: siege.resolveAt,
          status: siege.status,
        };
      }),
      watchtower: { level: watchtowerLevel, territoryLevel: passiveTerritoryLevel },
    };
  },
});

async function purchaseEmergencyDefense(
  ctx: MutationCtx,
  args: { siegeId: Id<"sieges">; percent: number },
) {
  const defender = await requireCurrentPlayer(ctx);
  const siege = await ctx.db.get(args.siegeId);
  if (!siege || siege.status !== "pending" || (siege.targetType !== "player" && siege.targetType !== "parshendi_retaliation")) {
    throw new Error("Choose an active defensive siege.");
  }
  if (siege.defenderId !== defender._id) {
    throw new Error("Only the defender can prepare emergency defenses.");
  }
  if (Date.now() >= siege.resolveAt) {
    throw new Error("This siege is already resolving.");
  }
  if (siege.targetType !== "player" || siege.siegeVersion !== SIEGE_V2.version || !siege.encircleEndsAt || Date.now() >= siege.encircleEndsAt) {
    throw new Error("Emergency Defenses can only be prepared during Encirclement.");
  }

  const currentPercent = Math.max(0, siege.emergencyDefensePercent ?? 0);
  const targetPercent = Math.max(
    0,
    Math.min(PLATEAU_RULES.emergencyDefenseMaxPercent, Math.floor(args.percent)),
  );
  if (targetPercent < currentPercent) {
    throw new Error("Emergency Defenses cannot be reduced once purchased.");
  }
  if (targetPercent === currentPercent) {
    return {
      emergencyDefensePercent: currentPercent,
      cost: 0,
    };
  }

  const completed = await completedResearch(ctx, defender._id);
  const cost = emergencyDefenseCost(targetPercent, completed) - emergencyDefenseCost(currentPercent, completed);
  if (defender.spheres < cost) {
    throw new Error(`Not enough spheres. Need ${cost}.`);
  }

  const now = Date.now();
  await ctx.db.patch(defender._id, {
    spheres: defender.spheres - cost,
    lastActiveAt: now,
  });
  await ctx.db.patch(siege._id, {
    emergencyDefensePercent: targetPercent,
    emergencyDefenseSpheresSpent:
      (siege.emergencyDefenseSpheresSpent ?? 0) + cost,
  });

  return {
    emergencyDefensePercent: targetPercent,
    cost,
  };
}

export const getSiegeBoard = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const neutral = await neutralPlateaus(ctx);
    const allOwned = await ctx.db
      .query("plateaus")
      .withIndex("by_status", (q) => q.eq("status", "owned"))
      .take(200);
    const mine = allOwned.filter((plateau) => plateau.ownerPlayerId === viewer._id);
    const activeSieges = await ctx.db
      .query("sieges")
      .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
      .take(200);
    const [allReinforcements, allInvestigations, intelResources] = await Promise.all([
      ctx.db.query("siegeReinforcements").take(500),
      ctx.db.query("siegeInvestigations").take(500),
      ctx.db.query("kingdomIntelResources").withIndex("by_viewerPlayerId_and_targetPlayerId", q => q.eq("viewerPlayerId", viewer._id)).take(200),
    ]);
    const referencedPlayerIds = new Set<string>([String(viewer._id)]);
    for (const plateau of allOwned) if (plateau.ownerPlayerId) referencedPlayerIds.add(String(plateau.ownerPlayerId));
    for (const siege of activeSieges) {
      if (siege.attackerId) referencedPlayerIds.add(String(siege.attackerId));
      if (siege.defenderId) referencedPlayerIds.add(String(siege.defenderId));
    }
    const players = (await Promise.all([...referencedPlayerIds].map((id) => ctx.db.get(id as Id<"players">)))).filter((player) => player !== null);
    const playerNames = Object.fromEntries(
      players.map((player) => [player._id, player.name]),
    );
    const playersById = new Map(players.map((player) => [String(player._id), player]));
    const researchRows = (await Promise.all([...referencedPlayerIds].map((id) => ctx.db
      .query("playerResearch")
      .withIndex("by_playerId", (q) => q.eq("playerId", id as Id<"players">))
      .unique()))).filter((row) => row !== null);
    const researchByPlayer = new Map(researchRows.map((row) => [String(row.playerId), { ...row.completedLevels, ...(row.economicDoctrine === "gemheartBaron" ? { __doctrineGemheartBaron: 1 } : {}) }]));
    const gemheartIntervalForPlayer = (playerId: Id<"players"> | undefined) => {
      const completed = playerId ? researchByPlayer.get(String(playerId)) : undefined;
      const gemHours = Number(researchEffect(completed, "gemCutting"));
      const baseHours = gemHours > 0 ? gemHours : PLATEAU_RULES.gemheartIntervalMs / 3600000;
      return (baseHours - (completed?.__doctrineGemheartBaron ? 1 : 0)) * 60 * 60 * 1000;
    };
    const territoryReports = await ctx.db
      .query("intelligenceReports")
      .withIndex("by_viewerPlayerId_and_targetType", (q) =>
        q.eq("viewerPlayerId", viewer._id).eq("targetType", "territory"),
      )
      .take(100);
    const kingdomReports = await ctx.db
      .query("intelligenceReports")
      .withIndex("by_viewerPlayerId_and_targetType", (q) =>
        q.eq("viewerPlayerId", viewer._id).eq("targetType", "kingdom"),
      )
      .take(100);
    const reportsByPlateau = new Map(
      territoryReports
        .filter((report) => report.plateauId)
        .map((report) => [String(report.plateauId), report]),
    );
    const now = Date.now();
    const watchtowerLevel = Math.min(3, viewer.buildings.watchtower ?? 0);
    const passiveTerritoryLevel = watchtowerTerritoryLevel(watchtowerLevel);
    const kingdomLevel = (targetPlayerId: Id<"players"> | undefined) => {
      if (!targetPlayerId) return 0;
      const report = kingdomReports.find((entry) => entry.targetPlayerId === targetPlayerId);
      const target = playersById.get(String(targetPlayerId));
      if (!report || !target) return 0;
      return Math.max(
        0,
        effectiveIntelLevel(report.level, report.observedAt, now) -
          watchtowerCounterIntelligence(target.buildings.watchtower ?? 0),
      );
    };
    const visibleSieges = activeSieges.filter((siege) => {
      if (siege.attackerId === viewer._id || siege.defenderId === viewer._id) return true;
      if (!siege.attackerId) return false;
      return Math.max(kingdomLevel(siege.attackerId), kingdomLevel(siege.defenderId)) >= 4;
    });
    const plateauById = new Map([...neutral, ...allOwned].map((plateau) => [String(plateau._id), plateau]));
    const dossierTerritories = territoryReports.map((report) => {
      const plateau = report.plateauId ? plateauById.get(String(report.plateauId)) : undefined;
      const disclosure = territoryResistanceDisclosure({
        currentResistance: plateau?.neutralDefenseRemaining,
        report,
        passiveLevel: passiveTerritoryLevel,
        now,
      });
      const level = disclosure.level;
      return {
        plateauId: plateau?._id ?? report.plateauId ?? null,
        targetName: level >= 1 ? plateau?.name ?? "Unknown plateau" : "Unsurveyed Plateau",
        source: report.source,
        observedAt: report.observedAt,
        effectiveLevel: level,
        freshness: intelligenceFreshness(report.observedAt, now),
        resistance: disclosure.resistance,
        plateauType: level >= 1 ? report.plateauType ?? null : null,
        highground: level >= 1 ? report.highground ?? false : false,
        large: level >= 1 ? report.large ?? false : false,
        bonusFactText: report.bonusObservedAt && effectiveIntelLevel(1, report.bonusObservedAt, now) >= 1 ? report.bonusFactText ?? null : null,
      };
    });
    if (watchtowerLevel > 0) {
      const known = new Set(territoryReports.map((report) => String(report.plateauId)));
      for (const plateau of neutral) if (!known.has(String(plateau._id))) {
        const disclosure = territoryResistanceDisclosure({
          currentResistance: plateau.neutralDefenseRemaining,
          report: null,
          passiveLevel: passiveTerritoryLevel,
          now,
        });
        dossierTerritories.push({
          plateauId: plateau._id,
          targetName: plateau.name,
          source: "watchtower",
          observedAt: now,
          effectiveLevel: disclosure.level,
          freshness: "fresh",
          resistance: disclosure.resistance,
          plateauType: plateau.type,
          highground: plateau.highground,
          large: plateau.large ?? false,
          bonusFactText: null,
        });
      }
    }

    return {
      types: plateauTypes(),
      counts: mine.reduce((counts, plateau) => {
        counts[identityPlateauType(plateau.type)] += 1;
        return counts;
      }, { sphere: 0, bridged: 0, gemheart: 0, ancient: 0 }),
      mine: mine.map((plateau) => decoratePlateauForOwner(plateau, now, gemheartIntervalForPlayer(viewer._id))),
      neutral: neutral.filter((plateau) => !plateau.activeSiegeId).map((plateau) => {
        const report = reportsByPlateau.get(String(plateau._id));
        const disclosure = territoryResistanceDisclosure({
          currentResistance: plateau.neutralDefenseRemaining,
          report,
          passiveLevel: passiveTerritoryLevel,
          now,
        });
        const intelligenceLevel = disclosure.level;
        const identityKnown = intelligenceLevel >= 1;
        return {
          _id: plateau._id,
          name: identityKnown ? plateau.name : "Unsurveyed Plateau",
          status: plateau.status,
          intelligenceLevel,
          resistance: disclosure.resistance,
          ...(intelligenceLevel >= 2 ? {
            parshendiReclamationCount: plateau.parshendiReclamationCount ?? 0,
            baseNeutralDefense: plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial,
          } : {}),
          ...(identityKnown
            ? {
                type: identityPlateauType(plateau.type),
                highground: plateau.highground,
                large: plateau.large ?? false,
              }
            : {}),
        };
      }),
      rivals: allOwned
        .filter((plateau) => plateau.ownerPlayerId !== viewer._id)
        .map((plateau) => {
          const report = reportsByPlateau.get(String(plateau._id));
          const reportLevel = report
            ? effectiveIntelLevel(report.level, report.observedAt, now)
            : 0;
          const intelligenceLevel = Math.max(passiveTerritoryLevel, reportLevel);
          const ownerName = plateau.ownerPlayerId
            ? playerNames[plateau.ownerPlayerId] ?? "Unknown"
            : "Neutral";
          return {
            _id: plateau._id,
            name: intelligenceLevel >= 1 ? plateau.name : `${ownerName} holding`,
            status: plateau.status,
            ownerPlayerId: plateau.ownerPlayerId,
            ownerName,
            intelligenceLevel,
            ...(intelligenceLevel >= 2 ? {
              parshendiReclamationCount: plateau.parshendiReclamationCount ?? 0,
              baseNeutralDefense: plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial,
            } : {}),
            ...(intelligenceLevel >= 2 && identityPlateauType(plateau.type) === "gemheart"
              ? { gemheartProgress: gemheartProgressForPlateau(plateau, now, gemheartIntervalForPlayer(plateau.ownerPlayerId)) }
              : {}),
            ...(intelligenceLevel >= 1
              ? {
                  type: identityPlateauType(plateau.type),
                  highground: plateau.highground,
                  large: plateau.large ?? false,
                }
              : {}),
          };
        }),
      sieges: visibleSieges.map((siege) => {
        const isAttacker = siege.attackerId === viewer._id;
        const isDefender = siege.defenderId === viewer._id;
        const opponentId = isAttacker ? siege.defenderId : isDefender ? siege.attackerId : undefined;
        const militaryIntel = opponentId ? militaryIntelAmount(intelResources.find(row => row.targetPlayerId === opponentId)) : 0;
        const ownInvestigations = allInvestigations.filter(row => row.siegeId === siege._id && row.investigatorId === viewer._id);
        const reinforcements = allReinforcements.filter(row => row.siegeId === siege._id && row.status === "traveling");
        const visibleReinforcements: Array<{
          id: Id<"siegeReinforcements">;
          side: "attacker" | "defender";
          arriveAt?: number;
          arrivalWindowMinutes?: number;
          units?: Doc<"siegeReinforcements">["units"];
          power?: number;
        }> = reinforcements.filter(row => row.playerId === viewer._id).map(row => ({ id: row._id, side: row.side, arriveAt: row.arriveAt, units: row.units, power: row.power }));
        if (militaryIntel >= 25) {
          for (const row of reinforcements.filter(row => row.playerId !== viewer._id)) {
            visibleReinforcements.push(militaryIntel >= 75
              ? { id: row._id, side: row.side, arriveAt: row.arriveAt }
              : { id: row._id, side: row.side, arrivalWindowMinutes: Math.max(1, Math.ceil((row.arriveAt - now) / 3600000) * 60) });
          }
        }
        return {
          _id: siege._id,
          plateauId: siege.plateauId,
          plateauName: plateauById.get(String(siege.plateauId))?.name ?? "Unknown plateau",
          ...(siege.attackerId ? { attackerId: siege.attackerId } : {}),
          ...(siege.defenderId ? { defenderId: siege.defenderId } : {}),
          targetType: siege.targetType,
          attackerName: siege.targetType === "parshendi_retaliation" ? "Parshendi" : siege.attackerId ? playerNames[siege.attackerId] ?? "Unknown" : "Unknown",
          defenderName: siege.defenderId
            ? playerNames[siege.defenderId] ?? "Unknown"
            : "Parshendi",
          attackerIntel: isAttacker
            ? presentIntelNumber(siege.attackerPower, 3)
            : persistentMilitaryPower(
                siege.attackerPower,
                opponentId ? intelResources.find((row) => row.targetPlayerId === opponentId) : null,
              ),
          ...(isAttacker
            ? {
                attackerUnits: siege.attackerUnits,
                attackerPower: siege.attackerPower,
                attackerSpeed: siege.attackerSpeed,
                ardentiaConclave: Boolean(siege.ardentiaConclave),
              }
            : {}),
          ...(isDefender
            ? {
                defenderUnits: siege.defenderUnits,
                defenderPower: siege.defenderPower,
                defenderSpeed: siege.defenderSpeed,
                defenderCommittedAt: siege.defenderCommittedAt ?? null,
                defenderFabrialKind: siege.defenderFabrialKind,
                fortifyPercent: siege.fortifyPercent,
                emergencyDefensePercent: siege.emergencyDefensePercent,
                emergencyDefenseSpheresSpent: siege.emergencyDefenseSpheresSpent,
              }
            : {}),
          departAt: siege.departAt,
          siegeVersion: siege.siegeVersion ?? 1,
          encircleEndsAt: siege.encircleEndsAt ?? null,
          battleStartedAt: siege.battleStartedAt ?? null,
          role: isAttacker ? "attacker" : isDefender ? "defender" : "observer",
          militaryIntel,
          reinforcements: visibleReinforcements,
          investigations: ownInvestigations.map(row => ({ id: row._id, status: row.status, outcome: row.outcome ?? null, resolveAt: row.resolveAt, casualties: row.casualties ?? null, report: row.report ?? null })),
          resolveAt: siege.resolveAt,
          status: siege.status,
        };
      }),
      watchtower: {
        level: watchtowerLevel,
        territoryLevel: passiveTerritoryLevel,
      },
      intelligence: {
        territories: dossierTerritories,
        watchtower: {
          level: watchtowerLevel,
          territoryLevel: passiveTerritoryLevel,
          counterIntelligence: watchtowerCounterIntelligence(watchtowerLevel),
        },
      },
    };
  },
});

export const launchNeutralSiege = mutation({
  args: {
    plateauId: v.id("plateaus"),
    units: unitCountsValidator,
    ardentiaConclave: v.optional(v.boolean()),
    conclaveId: v.optional(v.id("ardentConclaves")),
    fabrial: v.optional(v.union(v.literal("painrial"), v.literal("halfShard"))),
  },
  handler: async (ctx, args) => {
    const attacker = await requireCompetitivePlayer(ctx);
    const plateau = await ctx.db.get(args.plateauId);
    if (!plateau || plateau.status !== "neutral") {
      throw new Error("Choose an available neutral plateau.");
    }
    if (plateau.activeSiegeId) {
      throw new Error("That plateau is already under siege.");
    }

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Send at least one unit.");
    validateMissionUnits(attacker.buildings, units);
    const ardentiaConclave = args.conclaveId ? true : await validateConclaveAttachment(
      ctx,
      attacker,
      Boolean(args.ardentiaConclave),
    );

    const now = Date.now();
    await reserveFabrial(ctx, attacker._id, args.fabrial, now);
    await applyHostility(ctx, { playerId: attacker._id, playerInitiated: true, now });
    const plateauCounts = await plateauCountsForPlayer(ctx, attacker._id);
    const completed = await completedResearch(ctx, attacker._id);
    const conclaveCombat = Boolean(args.conclaveId);
    const resolveAt = now + travelMsForUnits(units, plateauCounts, completed, conclaveCombat);
    const remainingUnits = subtractAvailableUnits(attacker.units, units);
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      targetType: "neutral",
      attackerUnits: units,
      attackerPower: effectivePower(units, completed, conclaveCombat),
      attackerSpeed: effectiveSpeed(units, completed, conclaveCombat),
      fortifyPercent: 0,
      emergencyDefensePercent: 0,
      emergencyDefenseSpheresSpent: 0,
      ardentiaConclave,
      ...(args.conclaveId ? { conclaveId: args.conclaveId } : {}),
      departAt: now,
      resolveAt,
      status: "pending",
      ...(args.fabrial ? { fabrialKind: args.fabrial } : {}),
    });

    await ctx.db.patch(attacker._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(plateau._id, {
      activeSiegeId: siegeId,
      updatedAt: now,
    });
    if (args.conclaveId) await assignConclave(ctx, attacker._id, args.conclaveId, "siege", String(siegeId));
  await insertGameEvent(ctx, {
      kind: "territory",
      text: `${attacker.name} launched an expedition toward a neutral plateau.`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiege, {
      siegeId,
    });
    await ctx.scheduler.runAfter(0, internal.highstorms.processActiveStorm, {});

    return { siegeId, resolveAt };
  },
});

export const launchPlayerSiege = mutation({
  args: {
    plateauId: v.id("plateaus"),
    units: unitCountsValidator,
    ardentiaConclave: v.optional(v.boolean()),
    conclaveId: v.optional(v.id("ardentConclaves")),
    fabrial: v.optional(v.union(v.literal("painrial"), v.literal("halfShard"))),
  },
  handler: async (ctx, args) => {
    const attacker = await requireCompetitivePlayer(ctx);
    const plateau = await ctx.db.get(args.plateauId);
    if (!plateau || plateau.status !== "owned" || !plateau.ownerPlayerId) {
      throw new Error("Choose an owned enemy plateau.");
    }
    if (plateau.ownerPlayerId === attacker._id) {
      throw new Error("You cannot siege your own plateau.");
    }
    if (plateau.activeSiegeId) {
      throw new Error("That plateau is already under siege.");
    }

    const defender = await ctx.db.get(plateau.ownerPlayerId);
    if (!defender) throw new Error("Defender not found.");

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Send at least one unit.");
    validateMissionUnits(attacker.buildings, units);
    const ardentiaConclave = args.conclaveId ? true : await validateConclaveAttachment(
      ctx,
      attacker,
      Boolean(args.ardentiaConclave),
    );

    const now = Date.now();
    await reserveFabrial(ctx, attacker._id, args.fabrial, now);
    const scoring = await recordOpponentAttack(ctx, attacker._id, defender._id, now);
    const completed = await completedResearch(ctx, attacker._id);
    const encircleEndsAt = now + SIEGE_V2.encircleMs;
    const resolveAt = now + SIEGE_V2.maximumMs;
    const remainingUnits = subtractAvailableUnits(attacker.units, units);
    const attackerPower = effectivePower(units, completed, Boolean(args.conclaveId));
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      defenderId: defender._id,
      targetType: "player",
      attackerUnits: units,
      attackerPower,
      attackerSpeed: effectiveSpeed(units, completed, Boolean(args.conclaveId)),
      defenderUnits: emptyUnits(),
      defenderPower: 0,
      defenderSpeed: 0,
      fortifyPercent: 0,
      emergencyDefensePercent: 0,
      emergencyDefenseSpheresSpent: 0,
      ardentiaConclave,
      ...(args.conclaveId ? { conclaveId: args.conclaveId } : {}),
      departAt: now,
      siegeVersion: SIEGE_V2.version,
      encircleEndsAt,
      resolveAt,
      status: "pending",
      scoringSeasonId: scoring.seasonId,
      opponentChainPosition: scoring.chainPosition,
      ...(args.fabrial ? { fabrialKind: args.fabrial } : {}),
    });

    await ctx.db.patch(attacker._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(plateau._id, {
      activeSiegeId: siegeId,
      updatedAt: now,
    });
    if (args.conclaveId) await assignConclave(ctx, attacker._id, args.conclaveId, "siege", String(siegeId));
    const defenderMilitaryIntel = await siegeIntelResource(ctx, defender._id, attacker._id);
    const assessmentText = militaryAssessmentText(attackerPower, defenderMilitaryIntel);
    await ctx.db.insert("messages", {
      toPlayerId: defender._id,
      kind: "system",
      subject: "Plateau Siege",
      body: `${attacker.name} has started a siege against ${plateau.name}.${assessmentText}`,
      eventType: "siege_incoming", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siegeId),
      createdAt: now,
    });
    await createNotification(ctx, {
      playerId: defender._id, category: "combat", eventType: "incoming_siege",
      title: "Plateau Under Siege", body: `${attacker.name} has started a siege against ${plateau.name}.`,
      destinationView: "plains", destinationTab: "sieges", entityId: String(siegeId), dedupeKey: `siege:${siegeId}:incoming`, createdAt: now,
    });
  await insertGameEvent(ctx, {
      kind: "siege",
      text: `${attacker.name} started a siege against ${defender.name}.`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiege, {
      siegeId,
    });
    await ctx.scheduler.runAfter(0, internal.highstorms.processActiveStorm, {});

    return { siegeId, encircleEndsAt, resolveAt };
  },
});

export const commitSiegeDefenders = mutation({
  args: {
    siegeId: v.id("sieges"),
    units: unitCountsValidator,
    fabrial: v.optional(v.union(v.literal("painrial"), v.literal("halfShard"))),
  },
  handler: async (ctx, args) => {
    const defender = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || (siege.targetType !== "player" && siege.targetType !== "parshendi_retaliation")) {
      throw new Error("Choose an active defensive siege.");
    }
    if (siege.defenderId !== defender._id) {
      throw new Error("Only the defender can commit to this siege.");
    }
    const now = Date.now();
    if (Date.now() >= siege.resolveAt) {
      throw new Error("This siege is already resolving.");
    }
    if (siege.siegeVersion === SIEGE_V2.version && siege.encircleEndsAt && now >= siege.encircleEndsAt) {
      throw new Error("The initial defense must be committed during Encirclement.");
    }
    if (siege.defenderCommittedAt) {
      throw new Error("Defenders are already committed to this siege.");
    }

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Commit at least one unit.");
    validateMissionUnits(defender.buildings, units);
    const remainingUnits = subtractAvailableUnits(defender.units, units);
    const completed = await completedResearch(ctx, defender._id);
    const defenderPower = effectivePower(units, completed);
    const defenderSpeed = effectiveSpeed(units, completed);
    await reserveFabrial(ctx, defender._id, args.fabrial, now);
    await ctx.db.patch(defender._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(siege._id, {
      defenderUnits: units,
      defenderPower,
      defenderSpeed,
      defenderCommittedAt: now,
      ...(args.fabrial ? { defenderFabrialKind: args.fabrial } : {}),
    });

    await ctx.scheduler.runAfter(0, internal.highstorms.processActiveStorm, {});
    return {
      committed: true,
      defenderPower,
      defenderSpeed,
    };
  },
});

export const reinforcePlayerSiege = mutation({
  args: { siegeId: v.id("sieges"), units: unitCountsValidator },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || siege.targetType !== "player" || siege.siegeVersion !== SIEGE_V2.version) throw new Error("Choose an active player siege.");
    const side = siege.attackerId === player._id ? "attacker" : siege.defenderId === player._id ? "defender" : null;
    if (!side) throw new Error("Only siege participants can reinforce.");
    const now = Date.now();
    if (!siege.encircleEndsAt || now < siege.encircleEndsAt) throw new Error("Reinforcements begin after Encirclement.");
    if (now >= siege.resolveAt || siege.battleStartedAt) throw new Error("The battle has already begun.");
    if (side === "defender" && !siege.defenderCommittedAt) throw new Error("Commit the initial defense before reinforcing.");
    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Send at least one reinforcement.");
    validateMissionUnits(player.buildings, units);
    const remaining = subtractAvailableUnits(player.units, units);
    const completed = await completedResearch(ctx, player._id);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const baseMs = side === "attacker" ? SIEGE_V2.attackerReinforcementBaseMs : SIEGE_V2.defenderReinforcementBaseMs;
    const arriveAt = now + missionMsForBase(baseMs, units, plateauCounts, completed);
    const reinforcementId = await ctx.db.insert("siegeReinforcements", {
      siegeId: siege._id, playerId: player._id, side, units,
      power: effectivePower(units, completed), speed: effectiveSpeed(units, completed),
      departAt: now, arriveAt, status: "traveling",
    });
    await ctx.db.patch(player._id, { units: remaining, lastActiveAt: now });
    await ctx.scheduler.runAt(arriveAt, internal.plateaus.arriveSiegeReinforcement, { reinforcementId });
    await ctx.scheduler.runAfter(0, internal.highstorms.processActiveStorm, {});
    return { reinforcementId, arriveAt, side };
  },
});

export const arriveSiegeReinforcement = internalMutation({
  args: { reinforcementId: v.id("siegeReinforcements") },
  handler: async (ctx, args) => {
    const reinforcement = await ctx.db.get(args.reinforcementId);
    if (!reinforcement || reinforcement.status !== "traveling") return { arrived: false };
    const siege = await ctx.db.get(reinforcement.siegeId);
    const player = await ctx.db.get(reinforcement.playerId);
    const now = Date.now();
    if (!siege || siege.status !== "pending" || siege.battleStartedAt || now >= siege.resolveAt) {
      if (player) await ctx.db.patch(player._id, { units: addUnits(player.units, reinforcement.units), lastActiveAt: now });
      await ctx.db.patch(reinforcement._id, { status: "returned" });
      return { arrived: false };
    }
    const completed = await completedResearch(ctx, reinforcement.playerId);
    if (reinforcement.side === "attacker") {
      const units = addUnits(siege.attackerUnits, reinforcement.units);
      await ctx.db.patch(siege._id, { attackerUnits: units, attackerPower: effectivePower(units, completed, Boolean(siege.conclaveId)), attackerSpeed: effectiveSpeed(units, completed, Boolean(siege.conclaveId)) });
    } else {
      const units = addUnits(siege.defenderUnits ?? emptyUnits(), reinforcement.units);
      await ctx.db.patch(siege._id, { defenderUnits: units, defenderPower: effectivePower(units, completed), defenderSpeed: effectiveSpeed(units, completed) });
    }
    await ctx.db.patch(reinforcement._id, { status: "arrived" });
    return { arrived: true };
  },
});

export const beginSiegeBattle = mutation({
  args: { siegeId: v.id("sieges") },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || siege.targetType !== "player" || siege.siegeVersion !== SIEGE_V2.version) throw new Error("Choose an active player siege.");
    const side = siege.attackerId === player._id ? "attacker" : siege.defenderId === player._id ? "defender" : null;
    if (!side) throw new Error("Only siege participants can begin battle.");
    const now = Date.now();
    if (!siege.encircleEndsAt || now < siege.encircleEndsAt) throw new Error("Battle cannot begin during Encirclement.");
    const dueInvestigation = (await ctx.db.query("siegeInvestigations").withIndex("by_siegeId", q => q.eq("siegeId", siege._id)).take(20))
      .find(row => row.status === "pending" && row.resolveAt <= now);
    if (dueInvestigation) throw new Error("Siege reports are being finalized. Try again in a moment.");
    await cancelPendingSiegeInvestigations(ctx, siege._id, now);
    await ctx.db.patch(siege._id, { battleStartedAt: now, battleStartedBy: side });
    await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, { siegeId: siege._id });
    return { started: true, side };
  },
});

export const launchSiegeInvestigation = mutation({
  args: { siegeId: v.id("sieges"), operatives: v.object({ informant: v.number(), spy: v.number(), ghostblood: v.number() }) },
  handler: async (ctx, args) => {
    const investigator = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || siege.targetType !== "player" || siege.siegeVersion !== SIEGE_V2.version || !siege.attackerId || !siege.defenderId) throw new Error("Choose an active player siege.");
    const side = siege.attackerId === investigator._id ? "attacker" : siege.defenderId === investigator._id ? "defender" : null;
    if (!side) throw new Error("Only siege participants can investigate.");
    const targetPlayerId = side === "attacker" ? siege.defenderId : siege.attackerId;
    const commitment = normalizeOperatives(args.operatives);
    if (Object.values(commitment).reduce((sum, count) => sum + count, 0) < 1) throw new Error("Commit at least one operative.");
    const remaining = subtractOperatives(investigator.operatives ?? {}, commitment);
    const existing = (await ctx.db.query("siegeInvestigations").withIndex("by_investigatorId_and_siegeId", q => q.eq("investigatorId", investigator._id).eq("siegeId", siege._id)).take(20)).find(row => row.status === "pending");
    if (existing) throw new Error("You already have a pending investigation in this siege.");
    const resource = await siegeIntelResource(ctx, investigator._id, targetPlayerId);
    if (militaryIntelAmount(resource) < SIEGE_V2.investigationCost) throw new Error("Siege Investigation requires 50 Military Intel against this rival.");
    const now = Date.now();
    const duration = side === "attacker" ? SIEGE_V2.attackerInvestigationMs : SIEGE_V2.defenderInvestigationMs;
    const resolveAt = Math.max(now + duration, siege.encircleEndsAt ?? now);
    await ctx.db.patch(investigator._id, { operatives: remaining, lastActiveAt: now });
    await ctx.db.patch(resource!._id, { militaryAmount: militaryIntelAmount(resource) - SIEGE_V2.investigationCost, updatedAt: now });
    const investigationId = await ctx.db.insert("siegeInvestigations", { siegeId: siege._id, investigatorId: investigator._id, targetPlayerId, side, operatives: commitment, spyPower: spyPower(commitment), militaryIntelSpent: SIEGE_V2.investigationCost, launchedAt: now, resolveAt, status: "pending" });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiegeInvestigation, { investigationId });
    return { investigationId, resolveAt, side };
  },
});

export const resolveSiegeInvestigation = internalMutation({
  args: { investigationId: v.id("siegeInvestigations") },
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get(args.investigationId);
    if (!investigation || investigation.status !== "pending") return { resolved: false };
    const siege = await ctx.db.get(investigation.siegeId);
    const investigator = await ctx.db.get(investigation.investigatorId);
    const target = await ctx.db.get(investigation.targetPlayerId);
    const now = Date.now();
    if (!siege || siege.status !== "pending" || siege.battleStartedAt || !investigator || !target) {
      if (siege?.status === "pending" && investigator) await cancelPendingSiegeInvestigations(ctx, siege._id, now);
      return { resolved: false };
    }
    const stormActive = (await activeHighstorm(ctx, now)).active;
    const outcome = resolveEspionageOutcome(investigation.spyPower, stormCounterIntelligence(spyPower(target.defendingOperatives), stormActive));
    const rateMultiplier = stormActive ? HIGHSTORM_RULES.failureCasualtyMultiplier : 1;
    const losses = sphereHeistCasualties(investigation.operatives, outcome, rateMultiplier);
    const targetSide = investigation.side === "attacker" ? "defender" : "attacker";
    const currentUnits = targetSide === "attacker" ? normalizeUnits(siege.attackerUnits) : normalizeUnits(siege.defenderUnits ?? emptyUnits());
    const currentPower = targetSide === "attacker" ? siege.attackerPower : siege.defenderPower ?? 0;
    const incoming = (await ctx.db.query("siegeReinforcements").withIndex("by_siegeId", q => q.eq("siegeId", siege._id)).take(50))
      .filter(row => row.status === "traveling" && row.side === targetSide)
      .map(row => ({ arriveAt: row.arriveAt, power: row.power, units: row.units }));
    const report = outcome === "failure" ? null : outcome === "partial"
      ? { observedAt: now, power: presentIntelNumber(currentPower, 2), composition: "approximate", reinforcements: incoming.map(row => ({ arrivalWindowMinutes: Math.max(1, Math.ceil((row.arriveAt - now) / 3600000) * 60) })) }
      : outcome === "success"
        ? { observedAt: now, power: currentPower, units: currentUnits, reinforcements: incoming.map(row => ({ arriveAt: row.arriveAt, power: presentIntelNumber(row.power, 2) })) }
        : { observedAt: now, power: currentPower, units: currentUnits, reinforcements: incoming };
    await ctx.db.patch(investigator._id, { operatives: addOperatives(investigator.operatives, losses.survivors), lastActiveAt: now });
    await ctx.db.patch(investigation._id, { status: "resolved", outcome, casualties: losses.casualties, ...(report ? { report } : {}), resolvedAt: now });
    const summary = outcome === "failure" ? "The investigation failed to produce reliable battlefield information." : outcome === "partial" ? "A partial battlefield estimate is ready." : outcome === "success" ? "An exact snapshot of the present enemy force is ready." : "The enemy force and all inbound reinforcements were fully exposed.";
    await createNotification(ctx, { playerId: investigator._id, category: "missions", eventType: "siege_investigation_resolved", title: `Siege Investigation: ${outcome[0].toUpperCase()}${outcome.slice(1)}`, body: `${summary} Operative casualties: ${Object.values(losses.casualties).reduce((sum, count) => sum + count, 0)}.`, destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id), dedupeKey: `siege-investigation:${investigation._id}`, createdAt: now });
    if (outcome === "failure" || outcome === "success") await createNotification(ctx, { playerId: target._id, category: "missions", eventType: "siege_investigation_detected", title: "Siege Espionage Detected", body: outcome === "success" ? `${investigator.name}'s agents penetrated your siege lines.` : "Your counter-intelligence disrupted an investigation around the siege.", destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id), dedupeKey: `siege-investigation:${investigation._id}:target`, createdAt: now });
    return { resolved: true, outcome };
  },
});

export const setEmergencyDefense = mutation({
  args: {
    siegeId: v.id("sieges"),
    percent: v.number(),
  },
  handler: async (ctx, args) => {
    return await purchaseEmergencyDefense(ctx, args);
  },
});

export const fortifySiege = mutation({
  args: {
    siegeId: v.id("sieges"),
    percent: v.number(),
  },
  handler: async (ctx, args) => {
    // Cached clients may still call this legacy alias; it intentionally buys Emergency Defense.
    return await purchaseEmergencyDefense(ctx, args);
  },
});

export const forceResolveSiege = mutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
      siegeId: args.siegeId,
    });
    return { scheduled: true };
  },
});

export const forceResolveAllSieges = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("sieges")
      .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
      .take(100);

    for (const siege of pending) {
      await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
        siegeId: siege._id,
      });
    }

    return { scheduled: pending.length };
  },
});

export const retreatSiege = mutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending") {
      throw new Error("Choose an active siege.");
    }
    throw new Error("Withdrawals are disabled for active sieges.");
  },
});

export const backfillPlateaus = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const players = (await ctx.db.query("players").take(200)).filter((player) => !player.isAdminObserver);
    let starterCreated = 0;
    let migrated = 0;
    let defensesRetuned = 0;
    const existingPlateaus = await ctx.db.query("plateaus").take(300);
    for (const plateau of existingPlateaus) {
      const type = identityPlateauType(plateau.type);
      const updates: any = {};
      if (plateau.baseNeutralDefense === undefined) updates.baseNeutralDefense = plateau.neutralDefenseInitial;
      if (plateau.parshendiReclamationCount === undefined) updates.parshendiReclamationCount = 0;
      if (type !== plateau.type) updates.type = type;
      if (plateau.large === undefined) updates.large = false;
      if (
        plateau.status === "neutral" &&
        plateau.neutralDefenseInitial < PLATEAU_RULES.neutralDefenseMin
      ) {
        const legacyProgress = plateau.neutralDefenseInitial > 0
          ? plateau.neutralDefenseRemaining / plateau.neutralDefenseInitial
          : 1;
        const legacyPosition = Math.max(
          0,
          Math.min(1, (plateau.neutralDefenseInitial - 7) / (16 - 7)),
        );
        const nextInitial = Math.round(
          PLATEAU_RULES.neutralDefenseMin +
            legacyPosition *
              (PLATEAU_RULES.neutralDefenseMax - PLATEAU_RULES.neutralDefenseMin),
        );
        updates.neutralDefenseInitial = nextInitial;
        updates.neutralDefenseRemaining = Math.max(1, Math.round(nextInitial * legacyProgress));
        defensesRetuned += 1;
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(plateau._id, { ...updates, updatedAt: now });
        migrated += 1;
      }
    }
    for (const player of players) {
      starterCreated += await createStarterPlateaus(ctx, player._id, now);
    }
    const neutral = await neutralPlateaus(ctx);
    const targetNeutral = players.length * STARTING_RULES.neutralPlateausPerNewPlayer;
    const neutralCreated =
      neutral.length >= targetNeutral
        ? 0
        : await createNeutralPlateaus(ctx, targetNeutral - neutral.length, now);

  await insertGameEvent(ctx, {
      kind: "world",
      text: `Plateau backfill created ${starterCreated} starter plateaus and ${neutralCreated} neutral plateaus, and retuned ${defensesRetuned} neutral defenses.`,
      createdAt: now,
    });

    return { starterCreated, neutralCreated, migrated, defensesRetuned };
  },
});

export const resolveSiege = internalMutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending") return { resolved: false };

    const plateau = await ctx.db.get(siege.plateauId);
    const attacker = siege.attackerId ? await ctx.db.get(siege.attackerId) : null;
    if (!plateau || (!attacker && siege.targetType !== "parshendi_retaliation")) {
      const now = Date.now();
      if (siege.targetType === "parshendi_retaliation") {
        await cancelRetaliationForMalformedSiege(ctx, {
          siegeId: siege._id,
          retaliationId: siege.retaliationId,
          defenderId: siege.defenderId,
          now,
        });
      }
      if (siege) {
        await ctx.db.patch(siege._id, {
          status: "resolved",
          resolvedAt: now,
        });
      }
      return { resolved: false };
    }

    const now = Date.now();
    const forcedAssault = siege.targetType === "player" && siege.siegeVersion === SIEGE_V2.version && !siege.battleStartedAt && now >= siege.resolveAt;
    if (siege.targetType === "player" && siege.siegeVersion === SIEGE_V2.version) {
      await cancelPendingSiegeInvestigations(ctx, siege._id, now);
      if (forcedAssault) await ctx.db.patch(siege._id, { battleStartedAt: now, battleStartedBy: "deadline" });
      const traveling = (await ctx.db.query("siegeReinforcements").withIndex("by_siegeId", q => q.eq("siegeId", siege._id)).take(100)).filter(row => row.status === "traveling");
      for (const reinforcement of traveling) {
        const owner = await ctx.db.get(reinforcement.playerId);
        if (owner) await ctx.db.patch(owner._id, { units: addUnits(owner.units, reinforcement.units), lastActiveAt: now });
        await ctx.db.patch(reinforcement._id, { status: "returned" });
      }
    }
    const attackerCompleted = attacker ? await completedResearch(ctx, attacker._id) : undefined;
    let won = false;
    let resultText = "";
    let survivors = siege.attackerUnits;
    let awardedConclaveXp: number | undefined;
    let fabrialPreventedCasualties = siege.fabrialPreventedCasualties ?? 0;

    if (siege.targetType === "parshendi_retaliation") {
      const defender = siege.defenderId ? await ctx.db.get(siege.defenderId) : null;
      if (!defender || !siege.retaliationId) {
        await ctx.db.patch(siege._id, { status: "resolved", resolvedAt: now });
        await ctx.db.patch(plateau._id, { activeSiegeId: undefined, updatedAt: now });
        await cancelRetaliationForMalformedSiege(ctx, {
          siegeId: siege._id,
          retaliationId: siege.retaliationId,
          defenderId: siege.defenderId,
          now,
        });
        return { resolved: false };
      }
      const defenderUnits = normalizeUnits(siege.defenderUnits ?? emptyUnits());
      const defenderCompleted = await completedResearch(ctx, defender._id);
      const defenderPower = committedDefensePower(
        defenderUnits,
        plateau,
        siege.emergencyDefensePercent ?? 0,
        defenderCompleted,
      );
      const stormActive = (await activeHighstorm(ctx, now)).active;
      const parshendiPower = stormParshendiPower(siege.attackerPower, stormActive);
      const parshendiWon = parshendiPower > defenderPower;
      const rawDefenderLossResult = applyLossRate(
        defenderUnits,
        baseCasualtyRate(defenderPower, parshendiPower),
        `${siege._id}:retaliation:defender:${now}`,
        defenderCompleted,
      );
      const defenderLossResult = applyFabrialCasualtyProtection(siege.defenderFabrialKind, rawDefenderLossResult);
      await ctx.db.patch(defender._id, {
        units: addUnits(defender.units, defenderLossResult.survivors),
        lastActiveAt: now,
      });

      let subject: string;
      if (!parshendiWon) {
        const reward = await completeRetaliation(ctx, { retaliationId: siege.retaliationId, defended: true, now });
        await ctx.db.patch(plateau._id, { activeSiegeId: undefined, updatedAt: now });
        await recordSuccessfulDefensiveSiege(ctx, defender._id, now);
        subject = "Parshendi Retaliation Defeated";
        resultText = `${defender.name} held ${plateau.name} against the Parshendi. Reward: ${reward?.spheres ?? 0} Spheres. Casualties: ${casualtySummary(defenderLossResult.casualties)}.`;
      } else {
        const season = await activeSeason(ctx);
        const previousCount = season && plateau.reclamationSeasonId === season._id
          ? Math.max(0, plateau.parshendiReclamationCount ?? 0)
          : 0;
        const reclamationCount = previousCount + 1;
        const baseNeutralDefense = plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial;
        const nextDefense = reclamationDefense(baseNeutralDefense, reclamationCount);
        await ctx.db.patch(plateau._id, {
          status: "neutral",
          ownerPlayerId: undefined,
          baseNeutralDefense,
          parshendiReclamationCount: reclamationCount,
          ...(season ? { reclamationSeasonId: season._id } : {}),
          neutralDefenseInitial: nextDefense,
          neutralDefenseRemaining: nextDefense,
          heldSince: undefined,
          lastGemheartAt: undefined,
          activeSiegeId: undefined,
          updatedAt: now,
        });
        await reconcileResearch(ctx, defender._id, now);
        await observePlateauNeutralized(ctx, { plateauId: plateau._id, previousOwnerId: defender._id, now });
        await completeRetaliation(ctx, { retaliationId: siege.retaliationId, defended: false, now });
        subject = "Plateau Reclaimed";
        resultText = `The Parshendi reclaimed ${plateau.name}. Its reclamation count is now ${reclamationCount}, raising neutral defense to ${nextDefense} Power. Casualties: ${casualtySummary(defenderLossResult.casualties)}.`;
      }

      const defenderPrevented = (siege.defenderFabrialPreventedCasualties ?? 0) + defenderLossResult.prevented;
      const defenderReusable = await settleReusableFabrial(
        ctx,
        defender._id,
        siege.defenderFabrialKind,
        parshendiWon ? "lower_failure" : "normal_success",
        `siege:${siege._id}:defender-fabrial-loss`,
        now,
      );
      if (defenderLossResult.prevented > 0) resultText += ` ${siege.defenderFabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${defenderLossResult.prevented} casualties.`;
      if (defenderReusable.lost) resultText += " The retreat became chaotic. The Half-Shard was lost.";
      await ctx.db.patch(siege._id, {
        status: "resolved",
        resolvedAt: now,
        defenderHeld: !parshendiWon,
        defenderFabrialResolvedAt: siege.defenderFabrialKind ? now : undefined,
        defenderFabrialLost: siege.defenderFabrialKind ? defenderReusable.lost : undefined,
        defenderFabrialPreventedCasualties: siege.defenderFabrialKind ? defenderPrevented : undefined,
      });
      await ctx.db.insert("messages", {
        toPlayerId: defender._id,
        kind: "system",
        subject,
        body: resultText,
        eventType: "parshendi_retaliation_resolved", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siege._id),
        createdAt: now,
      });
      await createNotification(ctx, {
        playerId: defender._id,
        category: "combat",
        eventType: parshendiWon ? "parshendi_plateau_reclaimed" : "parshendi_retaliation_defended",
        title: subject,
        body: resultText,
        destinationView: "plains", destinationTab: "sieges",
        entityId: String(siege._id),
        dedupeKey: `retaliation:${siege.retaliationId}:resolved`,
        createdAt: now,
      });
      await insertGameEvent(ctx, {
        kind: "siege",
        text: parshendiWon
          ? `The Parshendi reclaimed ${plateau.name} from ${defender.name}.`
          : `${defender.name} repelled a Parshendi retaliation at ${plateau.name}.`,
        createdAt: now,
      });
      return { resolved: true, won: !parshendiWon, resultText };
    }

    if (siege.targetType === "neutral") {
      if (!attacker) return { resolved: false };
      const stormActive = (await activeHighstorm(ctx, now)).active;
      const neutralDefense = stormParshendiPower(plateau.neutralDefenseRemaining, stormActive);
      won = siege.attackerPower >= neutralDefense;
      const rawLossResult = applyLossRate(
        siege.attackerUnits,
        baseCasualtyRate(siege.attackerPower, neutralDefense),
        `${siege._id}:neutral:${now}`,
        attackerCompleted,
        Boolean(siege.conclaveId),
      );
      const lossResult = applyFabrialCasualtyProtection(siege.fabrialKind, rawLossResult);
      fabrialPreventedCasualties += lossResult.prevented;
      survivors = lossResult.survivors;
      const investigation = resolveConclaveInvestigation(
        Boolean(siege.ardentiaConclave),
        lossResult.finalCasualtyRate,
        `${siege._id}:neutral:${now}`,
      );
      const conclaveXp = siege.conclaveId ? (investigation.succeeded ? missionXpBudget(plateau.neutralDefenseInitial) : Math.ceil(missionXpBudget(plateau.neutralDefenseInitial) / 2)) : 0;
      awardedConclaveXp = siege.conclaveId ? await releaseConclave(ctx, siege.conclaveId, conclaveXp) : undefined;
      await recordTerritoryReport(ctx, {
        viewerPlayerId: attacker._id,
        plateau,
        source: investigation.succeeded ? "ardent" : "neutral_expedition",
        level: 2 + (investigation.succeeded ? 1 : 0),
        observedAt: now,
      });
      const investigationText = investigation.attached
        ? conclaveResultNarrative({
            succeeded: investigation.succeeded,
            won,
            successChance: investigation.successChance,
          })
        : "";

      if (won) {
        await ctx.db.patch(plateau._id, {
          status: "owned",
          ownerPlayerId: attacker._id,
          neutralDefenseRemaining: 0,
          heldSince: now,
          lastGemheartAt: now,
          activeSiegeId: undefined,
          updatedAt: now,
        });
        await reconcileResearch(ctx, attacker._id, now);
        await observePlateauOwnership(ctx, { plateauId: plateau._id, newOwnerId: attacker._id, heldSince: now, now });
        await applyHostility(ctx, {
          playerId: attacker._id,
          gain: plateauCaptureHostility({ type: identityPlateauType(plateau.type), large: plateau.large }),
          playerInitiated: false,
          now,
        });
        resultText = `${attacker.name} claimed ${plateau.name} (${plateauTypeName(plateau.type)}) against ${resistanceLabel(plateau.neutralDefenseRemaining).toLowerCase()} resistance. Casualties: ${casualtySummary(lossResult.casualties)}.${investigationText} The expedition assessment is available in Intelligence.`;
      } else {
        await ctx.db.patch(plateau._id, {
          neutralDefenseRemaining: Math.max(
            1,
            plateau.neutralDefenseRemaining - siege.attackerPower,
          ),
          activeSiegeId: undefined,
          updatedAt: now,
        });
        resultText = `${attacker.name} weakened ${resistanceLabel(plateau.neutralDefenseRemaining).toLowerCase()} Parshendi resistance on ${plateau.name}. Casualties: ${casualtySummary(lossResult.casualties)}.${investigationText} The expedition assessment is available in Intelligence.`;
      }

      await ctx.db.patch(attacker._id, {
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
    }

    if (siege.targetType === "player") {
      if (!attacker) return { resolved: false };
      const defender = siege.defenderId ? await ctx.db.get(siege.defenderId) : null;
      if (!defender) {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, siege.attackerUnits),
          lastActiveAt: now,
        });
        resultText = `${attacker.name}'s siege found no defender.`;
      } else {
        const defenderUnits = normalizeUnits(siege.defenderUnits ?? emptyUnits());
        const defenderCompleted = await completedResearch(ctx, defender._id);
        const emergencyDefensePercent = siege.emergencyDefensePercent ?? 0;
        const baseDefenderPower = committedDefensePower(
          defenderUnits,
          plateau,
          emergencyDefensePercent,
          defenderCompleted,
        );
        const defenderPower = forcedAssault ? baseDefenderPower * SIEGE_V2.forcedDefenseMultiplier : baseDefenderPower;
        won = siege.attackerPower > defenderPower;
        const rawAttackerLossResult = applyLossRate(
          siege.attackerUnits,
          baseCasualtyRate(siege.attackerPower, defenderPower),
          `${siege._id}:player:attacker:${now}`,
          attackerCompleted,
          Boolean(siege.conclaveId),
        );
        const attackerLossResult = applyFabrialCasualtyProtection(siege.fabrialKind, rawAttackerLossResult);
        fabrialPreventedCasualties += attackerLossResult.prevented;
        survivors = attackerLossResult.survivors;
        const investigation = resolveConclaveInvestigation(
          Boolean(siege.ardentiaConclave),
          attackerLossResult.finalCasualtyRate,
          `${siege._id}:player:${now}`,
        );
        const conclaveXp = siege.conclaveId ? (investigation.succeeded ? missionXpBudget(defenderPower) : Math.ceil(missionXpBudget(defenderPower) / 2)) : 0;
        awardedConclaveXp = siege.conclaveId ? await releaseConclave(ctx, siege.conclaveId, conclaveXp) : undefined;
        const attackerReportLevel = (won ? 2 : 1) + (investigation.succeeded ? 1 : 0);
        await recordKingdomReport(ctx, {
          viewerPlayerId: attacker._id,
          target: defender,
          source: investigation.succeeded ? "ardent" : "player_raid",
          level: attackerReportLevel,
          observedAt: now,
        });
        await recordTerritoryReport(ctx, {
          viewerPlayerId: attacker._id,
          plateau,
          source: investigation.succeeded ? "ardent" : "player_raid",
          level: attackerReportLevel,
          observedAt: now,
        });
        const investigationText = investigation.attached
          ? conclaveResultNarrative({
              succeeded: investigation.succeeded,
              won,
              successChance: investigation.successChance,
            })
          : "";
        const rawDefenderLossResult = applyLossRate(
          defenderUnits,
          baseCasualtyRate(defenderPower, siege.attackerPower),
          `${siege._id}:player:defender:${now}`,
          defenderCompleted,
        );
        const defenderLossResult = applyFabrialCasualtyProtection(siege.defenderFabrialKind, rawDefenderLossResult);
        const defenderPrevented = (siege.defenderFabrialPreventedCasualties ?? 0) + defenderLossResult.prevented;
        const defenderReusable = await settleReusableFabrial(
          ctx,
          defender._id,
          siege.defenderFabrialKind,
          won ? "lower_failure" : "normal_success",
          `siege:${siege._id}:defender-fabrial-loss`,
          now,
        );
        const [attackerMilitaryIntel, defenderMilitaryIntel] = await Promise.all([
          siegeIntelResource(ctx, attacker._id, defender._id),
          siegeIntelResource(ctx, defender._id, attacker._id),
        ]);
        const attackerCasualtyIntelLevel = persistentMilitaryDisclosureLevel(militaryIntelAmount(attackerMilitaryIntel));
        const defenderCasualtyIntelLevel = persistentMilitaryDisclosureLevel(militaryIntelAmount(defenderMilitaryIntel));

        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        await ctx.db.patch(defender._id, {
          units: addUnits(defender.units, defenderLossResult.survivors),
          lastActiveAt: now,
        });

        let outcomeText = "";
        if (won) {
          await ctx.db.patch(plateau._id, {
            ownerPlayerId: attacker._id,
            heldSince: now,
            lastGemheartAt: now,
            activeSiegeId: undefined,
            updatedAt: now,
          });
          await reconcileResearch(ctx, attacker._id, now);
          await reconcileResearch(ctx, defender._id, now);
          await observePlateauOwnership(ctx, { plateauId: plateau._id, previousOwnerId: defender._id, newOwnerId: attacker._id, heldSince: now, now });
          await reconcileRetaliationSchedule(ctx, attacker._id, now);
          await reconcileRetaliationSchedule(ctx, defender._id, now);
          outcomeText = `${attacker.name} captured ${plateau.name} from ${defender.name}.`;
          if (siege.scoringSeasonId && siege.opponentChainPosition) await recordSiegeVictoryScore(ctx, {
            siegeId: siege._id, seasonId: siege.scoringSeasonId, attackerId: attacker._id, defenderId: defender._id,
            attackerName: attacker.name, defenderName: defender.name, plateauName: plateau.name,
            chainPosition: siege.opponentChainPosition, now,
          });
        } else {
          await ctx.db.patch(plateau._id, {
            activeSiegeId: undefined,
            updatedAt: now,
          });
          outcomeText = `${defender.name} held ${plateau.name} against ${attacker.name}.`;
          await recordSuccessfulDefensiveSiege(ctx, defender._id, now);
          await reconcileRetaliationSchedule(ctx, defender._id, now);
          if (siege.scoringSeasonId) await recordSiegeDefenseScore(ctx, {
            siegeId: siege._id, seasonId: siege.scoringSeasonId, defenderId: defender._id, attackerId: attacker._id,
            attackerName: attacker.name, plateauName: plateau.name, now,
          });
        }
        const attackerResultText = `${outcomeText} Your casualties: ${casualtySummary(attackerLossResult.casualties)}. ${casualtyIntelSummary(defenderLossResult.casualties, attackerCasualtyIntelLevel)}${investigationText} Military disclosure follows your persistent Ledger Intel against ${defender.name}.`;
        const defenderFabrialText = `${defenderLossResult.prevented ? ` ${siege.defenderFabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${defenderLossResult.prevented} casualties.` : ""}${defenderReusable.lost ? " The retreat became chaotic. The Half-Shard was lost." : ""}`;
        const defenderResultText = `${outcomeText} Your casualties: ${casualtySummary(defenderLossResult.casualties)}.${defenderFabrialText} ${casualtyIntelSummary(attackerLossResult.casualties, defenderCasualtyIntelLevel)} Military disclosure follows your persistent Ledger Intel against ${attacker.name}.`;
        resultText = attackerResultText;

        await ctx.db.patch(siege._id, {
          defenderFabrialResolvedAt: siege.defenderFabrialKind ? now : undefined,
          defenderFabrialLost: siege.defenderFabrialKind ? defenderReusable.lost : undefined,
          defenderFabrialPreventedCasualties: siege.defenderFabrialKind ? defenderPrevented : undefined,
        });

        await ctx.db.insert("messages", {
          toPlayerId: defender._id,
          kind: "system",
          subject: won ? "Plateau Lost" : "Siege Held",
          body: defenderResultText,
          eventType: "siege_resolved_defender", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siege._id),
          createdAt: now,
        });
        await createNotification(ctx, {
          playerId: defender._id, category: "combat", eventType: "siege_resolved_defender",
          title: won ? "Plateau Lost" : "Siege Held", body: outcomeText,
          destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id), dedupeKey: `siege:${siege._id}:resolved:defender`, createdAt: now,
        });
      }
    }

    if (!attacker) return { resolved: false };
    if (fabrialPreventedCasualties > 0) resultText += ` ${siege.fabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${fabrialPreventedCasualties} casualties.`;
    const reusable = await settleReusableFabrial(ctx, attacker._id, siege.fabrialKind, won ? "normal_success" : "lower_failure", `siege:${siege._id}:fabrial-loss`, now);
    if (reusable.lost) resultText += " The retreat became chaotic. The Half-Shard was lost.";
    await ctx.db.patch(siege._id, {
      status: "resolved",
      resolvedAt: now,
      conclaveXpAwarded: awardedConclaveXp,
      ...(siege.targetType === "player" ? { defenderHeld: !won } : {}),
      fabrialResolvedAt: siege.fabrialKind ? now : undefined,
      fabrialLost: siege.fabrialKind ? reusable.lost : undefined,
      fabrialPreventedCasualties: siege.fabrialKind ? fabrialPreventedCasualties : undefined,
    });
    await ctx.db.insert("messages", {
      toPlayerId: attacker._id,
      kind: "system",
      subject: won ? "Siege Won" : "Siege Resolved",
      body: resultText,
      eventType: "siege_resolved_attacker", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siege._id),
      createdAt: now,
    });
    await createNotification(ctx, {
      playerId: attacker._id, category: siege.targetType === "player" ? "combat" : "missions",
      eventType: siege.targetType === "player" ? "siege_resolved_attacker" : "expedition_resolved",
      title: won ? (siege.targetType === "player" ? "Siege Won" : "Expedition Succeeded") : (siege.targetType === "player" ? "Siege Resolved" : "Expedition Resolved"),
      body: resultText, destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id),
      dedupeKey: `siege:${siege._id}:resolved:attacker`, createdAt: now,
    });
    await insertGameEvent(ctx, {
      kind: siege.targetType === "player" ? "siege" : "territory",
      text: siege.targetType === "player"
        ? `${attacker.name}'s siege of ${plateau.name} ${won ? "succeeded" : "was repelled"}.`
        : resultText,
      createdAt: now,
    });

    return { resolved: true, won, resultText };
  },
});
