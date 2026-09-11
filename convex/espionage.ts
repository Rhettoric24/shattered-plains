import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { settlePlayerEconomy } from "./economyHelpers";
import { createNotification } from "./notificationHelpers";
import { activeHighstorm } from "./highstorms";
import { stormCounterIntelligence, stormInvestigationIntel } from "./highstormRules";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import { plateauAttributeCountsForPlayer, plateauCountsForPlayer } from "./plateauHelpers";
import { ownedOperativesIncludingAway, ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import { ensureActiveSeason } from "./seasonLedger";
import { SEASON_CATEGORIES } from "./seasonScoringRules";
import {
  ECONOMIC_DOCTRINES,
  PLATEAU_RULES,
  RESEARCH_RULES,
  UNIT_RULES,
  identityPlateauType,
  normalizeUnits,
  researchEffect,
  roundResource,
  type UnitCounts,
} from "./rules";
import {
  ESPIONAGE_CATEGORIES,
  ESPIONAGE_RULES,
  OPERATIVE_TIERS,
  addOperatives,
  categoryIntelDisclosureLevel,
  emptyOperatives,
  estimateScore,
  normalizeOperatives,
  operativeCount,
  qualitativeScore,
  resolveEspionageOutcome,
  legacyReportIntelAmount,
  sphereHeistCasualties,
  sphereHeistPayout,
  spyPower,
  subtractOperatives,
  type EspionageCategory,
  type EspionageOutcome,
  type OperativeCounts,
} from "./espionageRules";

const operativeTierValidator = v.union(v.literal("informant"), v.literal("spy"), v.literal("ghostblood"));
const categoryValidator = v.union(v.literal("military"), v.literal("economy"), v.literal("research"), v.literal("territory"));
const operativeCountsValidator = v.object({ informant: v.number(), spy: v.number(), ghostblood: v.number() });

function networkLevel(player: Doc<"players">) {
  return Math.max(0, Math.min(ESPIONAGE_RULES.network.maxLevel, Math.floor(player.buildings.espionageNetwork ?? 0)));
}

function safeRules() {
  return {
    categories: SEASON_CATEGORIES,
    missionDurationMs: ESPIONAGE_RULES.missionDurationMs,
    operatives: ESPIONAGE_RULES.operatives,
    categoryIntel: ESPIONAGE_RULES.categoryIntel,
    sphereHeist: ESPIONAGE_RULES.sphereHeist,
    network: ESPIONAGE_RULES.network,
  };
}

function categoryIntelAmount(
  resource: Doc<"kingdomIntelResources"> | null | undefined,
  category: EspionageCategory,
  legacyReport?: Doc<"kingdomIntelligence"> | null,
  now = Date.now(),
) {
  const stored = category === "military"
    ? resource?.militaryAmount ?? resource?.amount
    : category === "economy"
      ? resource?.economyAmount
      : category === "research"
        ? resource?.researchAmount
        : resource?.territoryAmount;
  if (stored !== undefined) return Math.max(0, Math.min(ESPIONAGE_RULES.categoryIntel.cap, Math.floor(stored)));
  return legacyReport
    ? legacyReportIntelAmount(legacyReport.achievedLevel, legacyReport.observedAt, now)
    : 0;
}

async function intelResource(ctx: MutationCtx, viewerPlayerId: Id<"players">, targetPlayerId: Id<"players">) {
  return await ctx.db.query("kingdomIntelResources")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewerPlayerId).eq("targetPlayerId", targetPlayerId))
    .unique();
}

async function applyIntelReward(ctx: MutationCtx, attacker: Doc<"players">, targetPlayerId: Id<"players">, category: EspionageCategory, reward: number, now: number) {
  const row = await intelResource(ctx, attacker._id, targetPlayerId);
  const report = await ctx.db.query("kingdomIntelligence")
    .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) =>
      q.eq("viewerPlayerId", attacker._id).eq("targetPlayerId", targetPlayerId).eq("category", category))
    .unique();
  const cap = ESPIONAGE_RULES.categoryIntel.cap;
  const amount = Math.min(cap, categoryIntelAmount(row, category, report, now) + reward);
  const field = category === "military"
    ? { militaryAmount: amount, amount: 0 }
    : category === "economy"
      ? { economyAmount: amount }
      : category === "research"
        ? { researchAmount: amount }
        : { territoryAmount: amount };
  if (row) await ctx.db.patch(row._id, { ...field, updatedAt: now });
  else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attacker._id, targetPlayerId, amount: 0, ...field, updatedAt: now });
  return { amount, cap, resource: category };
}

const BONUS_FACT_PAIRS = {
  military: ["unit_composition", "deployed_compositions"],
  economy: ["sphere_store", "gemheart_holdings"],
  research: ["active_research", "research_depth"],
  territory: ["territory_counts", "valuable_plateau"],
} as const;

const LEGACY_FIRST_BONUS_KINDS = new Set(["active_doctrine", "research_idle", "territory_roster"]);
const LEGACY_SECOND_BONUS_KINDS = new Set(["forces_away", "valuable_territory"]);

function nextBonusFactKind(category: EspionageCategory, previousKind?: string) {
  const [first, second] = BONUS_FACT_PAIRS[category];
  if (previousKind === first || LEGACY_FIRST_BONUS_KINDS.has(previousKind ?? "")) return second;
  if (previousKind === second || LEGACY_SECOND_BONUS_KINDS.has(previousKind ?? "")) return first;
  return first;
}

function unitComposition(units?: Partial<UnitCounts>) {
  const normalized = normalizeUnits(units ?? {});
  return Object.entries(normalized)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count.toLocaleString()} ${UNIT_RULES[key as keyof typeof UNIT_RULES].name}`)
    .join(", ") || "no combat units";
}

function plateauTypeLabel(type: string) {
  const normalized = identityPlateauType(type as Parameters<typeof identityPlateauType>[0]);
  return normalized === "sphere" ? "Sphere Plateau"
    : normalized === "bridged" ? "Bridged Plateau"
      : normalized === "gemheart" ? "Gemheart Plateau"
        : "Ancient Plateau";
}

function seededIndex(seed: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return size > 0 ? (hash >>> 0) % size : 0;
}

async function createBonusDiscovery(
  ctx: MutationCtx,
  mission: Doc<"espionageMissions">,
  target: Doc<"players">,
  now: number,
) {
  const previous = await ctx.db.query("espionageBonusDiscoveries")
    .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category_and_observedAt", (q) =>
      q.eq("viewerPlayerId", mission.attackerId).eq("targetPlayerId", mission.targetPlayerId).eq("category", mission.category))
    .order("desc")
    .first();
  const factKind = nextBonusFactKind(mission.category, previous?.factKind);
  let text: string;

  if (factKind === "unit_composition") {
    text = `Exact home-force composition: ${unitComposition(target.units)}.`;
  } else if (factKind === "deployed_compositions") {
    const [raids, attackingSieges, defendingSieges, openRun] = await Promise.all([
      ctx.db.query("raids").withIndex("by_attacker_and_status", (q) => q.eq("attackerId", target._id).eq("status", "pending")).take(100),
      ctx.db.query("sieges").withIndex("by_attacker_and_status", (q) => q.eq("attackerId", target._id).eq("status", "pending")).take(100),
      ctx.db.query("sieges").withIndex("by_defender_and_status", (q) => q.eq("defenderId", target._id).eq("status", "pending")).take(100),
      ctx.db.query("plateauRuns").withIndex("by_status", (q) => q.eq("status", "open")).unique(),
    ]);
    const deployments = [
      ...raids.map((raid, index) => `Raid ${index + 1}: ${unitComposition(raid.units)}`),
      ...attackingSieges.map((siege, index) => `Attacking siege ${index + 1}: ${unitComposition(siege.attackerUnits)}`),
      ...defendingSieges.map((siege, index) => `Defending siege ${index + 1}: ${unitComposition(siege.defenderUnits ?? {})}`),
    ];
    if (openRun) {
      const commitment = await ctx.db.query("plateauCommitments")
        .withIndex("by_run_player", (q) => q.eq("plateauRunId", openRun._id).eq("playerId", target._id))
        .unique();
      if (commitment) deployments.push(`Plateau Run: ${unitComposition(commitment.units)}`);
    }
    text = deployments.length > 0
      ? `Exact deployed-force compositions: ${deployments.join("; ")}.`
      : "Exact deployed-force compositions: no military forces were away from the warcamp.";
  } else if (factKind === "sphere_store") {
    const settledTarget = (await settlePlayerEconomy(ctx, target)).player;
    text = `Exact Sphere treasury: ${Math.floor(settledTarget.spheres).toLocaleString()} Spheres.`;
  } else if (factKind === "gemheart_holdings") {
    const settledTarget = (await settlePlayerEconomy(ctx, target)).player;
    text = `Exact Gemheart holdings: ${Math.floor(settledTarget.gemhearts).toLocaleString()} Gemhearts.`;
  } else if (factKind === "active_research") {
    const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", target._id)).unique();
    if (research?.activeProject) {
      const rule = RESEARCH_RULES.projects[research.activeProject as keyof typeof RESEARCH_RULES.projects];
      text = `Current research: ${rule?.name ?? research.activeProject} ${research.activeLevel ?? 1}; status ${research.status ?? "active"}${research.projectedCompletionAt ? `; projected completion ${new Date(research.projectedCompletionAt).toISOString()}` : ""}.`;
    } else if (research?.activeDoctrine) {
      const doctrine = ECONOMIC_DOCTRINES[research.activeDoctrine];
      text = `Current doctrine study: ${doctrine.name}; status ${research.status ?? "active"}${research.projectedCompletionAt ? `; projected completion ${new Date(research.projectedCompletionAt).toISOString()}` : ""}.`;
    } else if (research?.economicDoctrine) {
      text = `No active study. Established Economic Doctrine: ${ECONOMIC_DOCTRINES[research.economicDoctrine].name}.`;
    } else {
      text = "No active research project or Economic Doctrine was observed.";
    }
  } else if (factKind === "research_depth") {
    const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", target._id)).unique();
    const depth = { military: 0, economic: 0, ancient: 0 };
    for (const [project, level] of Object.entries(research?.completedLevels ?? {})) {
      const rule = RESEARCH_RULES.projects[project as keyof typeof RESEARCH_RULES.projects];
      if (rule) depth[rule.library] += Math.max(0, Math.floor(Number(level)));
    }
    const total = depth.military + depth.economic + depth.ancient;
    text = `Completed research depth: Military Studies ${depth.military}; Economic Studies ${depth.economic}; Ancient Lore ${depth.ancient}; ${total} completed levels total.`;
  } else {
    const plateaus = await ctx.db.query("plateaus").withIndex("by_owner", (q) => q.eq("ownerPlayerId", target._id)).take(200);
    if (factKind === "territory_counts") {
      const counts = { sphere: 0, bridged: 0, ancient: 0, gemheart: 0 };
      for (const plateau of plateaus) {
        const type = identityPlateauType(plateau.type);
        if (type === "sphere" || type === "bridged" || type === "ancient" || type === "gemheart") counts[type] += 1;
      }
      text = `Exact plateau counts: Sphere ${counts.sphere}; Bridged ${counts.bridged}; Ancient ${counts.ancient}; Gemheart ${counts.gemheart}; ${plateaus.length} total. Plateau names and traits remain undisclosed.`;
    } else {
      const valuable = plateaus.filter((plateau) => {
        const type = identityPlateauType(plateau.type);
        return type === "ancient" || type === "gemheart";
      }).sort((left, right) => left.name.localeCompare(right.name));
      if (valuable.length === 0) {
        text = "No Ancient or Gemheart plateau was observed among the target's holdings.";
      } else {
        const plateau = valuable[seededIndex(`${mission._id}:valuable-plateau`, valuable.length)];
        const traits = [plateau.highground ? "Highground" : "", plateau.large ? "Large" : ""].filter(Boolean).join(", ") || "none";
        const details = [
          `name ${plateau.name}`,
          `type ${plateauTypeLabel(plateau.type)}`,
          `traits ${traits}`,
          `origin ${plateau.origin ?? "unknown"}`,
          `held since ${plateau.heldSince ? new Date(plateau.heldSince).toISOString() : "unknown"}`,
          `Parshendi reclamations ${Math.max(0, plateau.parshendiReclamationCount ?? 0)}`,
          `siege status ${plateau.activeSiegeId ? "under siege" : "secure"}`,
        ];
        if (identityPlateauType(plateau.type) === "gemheart") {
          const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", target._id)).unique();
          const completed = { ...(research?.completedLevels ?? {}), ...(research?.economicDoctrine === "gemheartBaron" ? { __doctrineGemheartBaron: 1 } : {}) };
          const researchedHours = Number(researchEffect(completed, "gemCutting"));
          const baseHours = researchedHours > 0 ? researchedHours : PLATEAU_RULES.gemheartIntervalMs / 3_600_000;
          const intervalMs = (baseHours - (research?.economicDoctrine === "gemheartBaron" ? 1 : 0)) * 3_600_000;
          const lastYieldAt = plateau.lastGemheartAt ?? plateau.heldSince ?? plateau.updatedAt;
          details.push(`last Gemheart cycle ${new Date(lastYieldAt).toISOString()}`);
          details.push(`next expected Gemheart ${new Date(lastYieldAt + intervalMs).toISOString()}`);
        }
        text = `Fully observed valuable plateau: ${details.join("; ")}.`;
      }
    }
  }

  const discoveryId = await ctx.db.insert("espionageBonusDiscoveries", {
    viewerPlayerId: mission.attackerId,
    targetPlayerId: mission.targetPlayerId,
    category: mission.category,
    missionId: mission._id,
    factKind,
    text,
    observedAt: now,
  });
  return { discoveryId, factKind, text };
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const level = networkLevel(player);
    const pending = await ctx.db.query("espionageMissions")
      .withIndex("by_attackerId_and_status_and_resolveAt", (q) => q.eq("attackerId", player._id).eq("status", "pending"))
      .take(100);
    const recent = await ctx.db.query("espionageMissions")
      .withIndex("by_attackerId_and_departAt", (q) => q.eq("attackerId", player._id)).order("desc").take(20);
    const resources = await ctx.db.query("kingdomIntelResources")
      .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", player._id)).take(200);
    const reports = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) => q.eq("viewerPlayerId", player._id)).take(1000);
    const targets = await ctx.db.query("players").take(200);
    const names = new Map(targets.map((target) => [String(target._id), target.name]));
    let onMission = emptyOperatives();
    for (const mission of pending) onMission = addOperatives(onMission, mission.operatives);
    const resourcesByTarget = new Map(resources.map((row) => [String(row.targetPlayerId), row]));
    const reportsByTargetAndCategory = new Map(reports.map((report) => [`${report.targetPlayerId}:${report.category}`, report]));
    const now = Date.now();
    return {
      networkLevel: level,
      available: normalizeOperatives(player.operatives),
      defending: normalizeOperatives(player.defendingOperatives),
      onMission,
      counterIntelligence: spyPower(player.defendingOperatives),
      targets: targets.filter((target) => target._id !== player._id && !target.isAdminObserver).map((target) => {
        const resource = resourcesByTarget.get(String(target._id));
        const amount = (category: EspionageCategory) => categoryIntelAmount(
          resource,
          category,
          reportsByTargetAndCategory.get(`${target._id}:${category}`),
          now,
        );
        return {
          playerId: target._id,
          name: target.name,
          militaryIntel: amount("military"),
          economyIntel: amount("economy"),
          researchIntel: amount("research"),
          territoryIntel: amount("territory"),
          militaryIntelCap: ESPIONAGE_RULES.categoryIntel.cap,
          economyIntelCap: ESPIONAGE_RULES.categoryIntel.cap,
          researchIntelCap: ESPIONAGE_RULES.categoryIntel.cap,
          territoryIntelCap: ESPIONAGE_RULES.categoryIntel.cap,
        };
      }),
      missions: recent.map((mission) => ({
        missionId: mission._id, targetPlayerId: mission.targetPlayerId, targetName: names.get(String(mission.targetPlayerId)) ?? "Unknown kingdom",
        operation: mission.operation ?? "investigation", category: mission.category, operatives: mission.operatives, baseSpyPower: mission.baseSpyPower,
        finalSpyPower: mission.finalSpyPower, departAt: mission.departAt, resolveAt: mission.resolveAt,
        resolvedAt: mission.resolvedAt ?? null, status: mission.status, outcome: mission.outcome ?? null,
        economyIntelSpent: mission.economyIntelSpent ?? 0, economyIntelRemaining: mission.economyIntelRemaining ?? null,
        spheresStolen: mission.spheresStolen ?? 0, casualties: normalizeOperatives(mission.casualties),
        identityExposed: mission.identityExposed ?? null, bonusDiscoveryId: mission.bonusDiscoveryId ?? null,
      })),
      rules: safeRules(),
    };
  },
});

export const getKingdomLedger = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const now = Date.now();
    if (networkLevel(viewer) < 1) {
      return { locked: true, season: null, generatedAt: now, rows: [] };
    }
    const season = await ctx.db.query("seasons").withIndex("by_status", (q) => q.eq("status", "active")).unique();
    const players = await ctx.db.query("players").take(200);
    const reports = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) => q.eq("viewerPlayerId", viewer._id)).take(1000);
    const resources = await ctx.db.query("kingdomIntelResources")
      .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewer._id)).take(200);
    const scores = season ? await ctx.db.query("seasonScores")
      .withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", season._id)).take(200) : [];
    const reportMap = new Map(reports.map((report) => [`${report.targetPlayerId}:${report.category}`, report]));
    const resourceMap = new Map(resources.map((resource) => [String(resource.targetPlayerId), resource]));
    const scoreMap = new Map(scores.map((score) => [String(score.playerId), score]));
    const rows = players.filter((target) => !target.isAdminObserver).map((target) => {
      const own = target._id === viewer._id;
      const score = scoreMap.get(String(target._id));
      const actual = Object.fromEntries(ESPIONAGE_CATEGORIES.map((category) => [category, Math.max(0, Number(score?.categoryTotals?.[category] ?? 0))])) as Record<EspionageCategory, number>;
      const cells = Object.fromEntries(ESPIONAGE_CATEGORIES.map((category) => {
        const report = reportMap.get(`${target._id}:${category}`);
        const resource = resourceMap.get(String(target._id));
        const intelAmount = own ? ESPIONAGE_RULES.categoryIntel.cap : categoryIntelAmount(resource, category, report, now);
        const currentLevel = own ? 2 : categoryIntelDisclosureLevel(intelAmount);
        const observed = actual[category];
        const broadLabel = qualitativeScore(category, actual[category]);
        const presentation = currentLevel === 2
          ? { mode: "exact" as const, value: observed, display: observed.toLocaleString(), ...(own ? { label: broadLabel } : {}) }
          : currentLevel === 1
            ? { mode: "range" as const, ...estimateScore(observed), display: `${estimateScore(observed).min.toLocaleString()}–${estimateScore(observed).max.toLocaleString()}` }
            : { mode: "qualitative" as const, label: broadLabel, display: broadLabel };
        return [category, {
          category, categoryName: SEASON_CATEGORIES[category].name, currentLevel,
          presentation,
          source: own ? "Your Season Ledger" : `Persistent ${SEASON_CATEGORIES[category].name} Intel`,
          intelAmount,
          intelCap: ESPIONAGE_RULES.categoryIntel.cap,
        }];
      })) as Record<EspionageCategory, any>;
      const levels = ESPIONAGE_CATEGORIES.map((category) => cells[category].currentLevel);
      const minimumLevel = Math.min(...levels);
      let total;
      if (own) total = { currentLevel: 2, mode: "exact", display: Math.max(0, Number(score?.total ?? 0)).toLocaleString(), value: Math.max(0, Number(score?.total ?? 0)) };
      else if (minimumLevel === 0) total = { currentLevel: 0, mode: "incomplete", display: "Incomplete" };
      else if (minimumLevel === 2) {
        const value = ESPIONAGE_CATEGORIES.reduce((sum, category) => sum + cells[category].presentation.value, 0);
        total = { currentLevel: 2, mode: "exact", display: value.toLocaleString(), value };
      } else {
        const range = ESPIONAGE_CATEGORIES.reduce((sum, category) => {
          const value = cells[category].presentation;
          return { min: sum.min + (value.mode === "exact" ? value.value : value.min), max: sum.max + (value.mode === "exact" ? value.value : value.max) };
        }, { min: 0, max: 0 });
        total = { currentLevel: 1, mode: "range", display: `${range.min.toLocaleString()}–${range.max.toLocaleString()}`, ...range };
      }
      return { playerId: target._id, kingdomName: target.name, own, cells, total };
    }).sort((left, right) => left.own ? -1 : right.own ? 1 : left.kingdomName.localeCompare(right.kingdomName));
    return { season: season ? { id: season._id, name: season.name } : null, generatedAt: now, rows };
  },
});

export const listBonusDiscoveries = query({
  args: {
    targetPlayerId: v.id("players"),
    category: categoryValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireCurrentPlayer(ctx);
    if (networkLevel(viewer) < 1) throw new Error("Construct a Ghostblood Network to review Bonus Discoveries.");
    const discoveries = await ctx.db.query("espionageBonusDiscoveries")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category_and_observedAt", (q) =>
        q.eq("viewerPlayerId", viewer._id).eq("targetPlayerId", args.targetPlayerId).eq("category", args.category))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...discoveries,
      page: discoveries.page.map((entry) => ({
        id: entry._id,
        kind: entry.factKind,
        text: entry.text,
        observedAt: entry.observedAt,
      })),
    };
  },
});

export const materializeLegacyCategoryIntelAmounts = internalMutation({
  args: {
    reportCursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const reports = await ctx.db.query("kingdomIntelligence").paginate({ cursor: args.reportCursor, numItems: 50 });
    let migrated = 0;
    const now = Date.now();

    for (const report of reports.page) {
      const resource = await intelResource(ctx, report.viewerPlayerId, report.targetPlayerId);
      const existing = report.category === "military"
        ? resource?.militaryAmount
        : report.category === "economy"
          ? resource?.economyAmount
          : report.category === "research"
            ? resource?.researchAmount
            : resource?.territoryAmount;
      if (existing !== undefined) continue;
      const amount = legacyReportIntelAmount(report.achievedLevel, report.observedAt, now);
      const field = report.category === "military"
        ? { militaryAmount: amount }
        : report.category === "economy"
          ? { economyAmount: amount }
          : report.category === "research"
            ? { researchAmount: amount }
            : { territoryAmount: amount };
      if (resource) await ctx.db.patch(resource._id, { ...field, updatedAt: now });
      else await ctx.db.insert("kingdomIntelResources", {
        viewerPlayerId: report.viewerPlayerId,
        targetPlayerId: report.targetPlayerId,
        amount: 0,
        ...field,
        updatedAt: now,
      });
      migrated += 1;
    }

    return {
      migrated,
      reportCursor: reports.continueCursor,
      reportsDone: reports.isDone,
    };
  },
});

export const recruitOperatives = mutation({
  args: { tier: operativeTierValidator, count: v.number() },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    const count = Math.floor(args.count);
    if (count < 1 || count > 1000) throw new Error("Recruit between 1 and 1,000 operatives.");
    const rule = ESPIONAGE_RULES.operatives[args.tier];
    if (networkLevel(player) < rule.networkLevel) throw new Error(`${rule.name} requires Ghostblood Network level ${rule.networkLevel}.`);
    const sphereCost = rule.sphereCost * count;
    if (player.spheres < sphereCost) throw new Error(`Not enough spheres. Need ${sphereCost}.`);
    const plateauCounts = await plateauCountsForPlayer(ctx, player._id);
    const attributes = await plateauAttributeCountsForPlayer(ctx, player._id);
    const units = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const owned = await ownedOperativesIncludingAway(ctx, player._id, player.operatives, player.defendingOperatives);
    const nextOwned = addOperatives(owned, { ...emptyOperatives(), [args.tier]: count });
    const provisions = provisionsStatus(player.buildings, plateauCounts, units, attributes.large, player.ardentiaConclaves ?? 0, nextOwned);
    if (provisions.used > provisions.capacity) throw new Error(`Not enough Provisions. Recruiting these operatives would use ${provisions.used}/${provisions.capacity}.`);
    const available = normalizeOperatives(player.operatives);
    available[args.tier] += count;
    await ctx.db.patch(player._id, { operatives: available, spheres: player.spheres - sphereCost, lastActiveAt: Date.now() });
    return { recruited: count, tier: args.tier, sphereCost, available, provisions };
  },
});

export const disbandOperatives = mutation({
  args: { tier: operativeTierValidator, count: v.number() },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const count = args.count;
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Disband between 1 and 1,000 available operatives.");
    const available = normalizeOperatives(player.operatives);
    if (count > available[args.tier]) throw new Error(`Only ${available[args.tier]} ${ESPIONAGE_RULES.operatives[args.tier].name} are available to disband.`);
    available[args.tier] -= count;
    await ctx.db.patch(player._id, { operatives: available, lastActiveAt: Date.now() });
    return { disbanded: count, tier: args.tier, available, refundedSpheres: 0 };
  },
});

export const setDefense = mutation({
  args: { operatives: operativeCountsValidator },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const pool = addOperatives(player.operatives, player.defendingOperatives);
    const defending = normalizeOperatives(args.operatives);
    for (const tier of OPERATIVE_TIERS) if (!Number.isInteger(args.operatives[tier]) || args.operatives[tier] < 0 || defending[tier] > pool[tier]) throw new Error(`Invalid defending ${ESPIONAGE_RULES.operatives[tier].name} count.`);
    const available = subtractOperatives(pool, defending);
    await ctx.db.patch(player._id, { operatives: available, defendingOperatives: defending, lastActiveAt: Date.now() });
    return { available, defending, counterIntelligence: spyPower(defending) };
  },
});

function validateOffensiveCommitment(attacker: Doc<"players">, level: number, requested: OperativeCounts) {
  const commitment = normalizeOperatives(requested);
  if (operativeCount(commitment) < 1) throw new Error("Commit at least one operative.");
  for (const tier of OPERATIVE_TIERS) {
    if (!Number.isInteger(requested[tier]) || requested[tier] < 0) throw new Error("Operative counts must be non-negative whole numbers.");
    if (commitment[tier] > 0 && level < ESPIONAGE_RULES.operatives[tier].networkLevel) throw new Error(`${ESPIONAGE_RULES.operatives[tier].name} requires Network level ${ESPIONAGE_RULES.operatives[tier].networkLevel}.`);
  }
  return { commitment, remaining: subtractOperatives(attacker.operatives ?? emptyOperatives(), commitment) };
}

export const launchInvestigation = mutation({
  args: { targetPlayerId: v.id("players"), category: categoryValidator, operatives: operativeCountsValidator, intelSpend: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const attacker = await requireCompetitivePlayer(ctx);
    const level = networkLevel(attacker);
    if (level < 1) throw new Error("Construct a Ghostblood Network before launching investigations.");
    if (args.targetPlayerId === attacker._id) throw new Error("Choose a rival kingdom.");
    const target = await ctx.db.get(args.targetPlayerId);
    if (!target) throw new Error("Target kingdom not found.");
    if (target.isAdminObserver) throw new Error("Administrative observers cannot be targeted.");
    const { commitment, remaining } = validateOffensiveCommitment(attacker, level, args.operatives);
    const now = Date.now();
    const season = await ensureActiveSeason(ctx, now);
    const baseSpyPower = spyPower(commitment);
    const finalSpyPower = baseSpyPower;
    const resolveAt = now + ESPIONAGE_RULES.missionDurationMs;
    await ctx.db.patch(attacker._id, { operatives: remaining, lastActiveAt: now });
    const missionId = await ctx.db.insert("espionageMissions", {
      attackerId: attacker._id, targetPlayerId: target._id, seasonId: season._id, operation: "investigation", category: args.category,
      operatives: commitment, baseSpyPower, intelSpent: 0, finalSpyPower, departAt: now, resolveAt, status: "pending",
    });
    await ctx.scheduler.runAt(resolveAt, internal.espionage.resolveInvestigation, { missionId });
    return { missionId, resolveAt, baseSpyPower, intelSpent: 0, finalSpyPower };
  },
});

export const launchSphereHeist = mutation({
  args: { targetPlayerId: v.id("players"), operatives: operativeCountsValidator },
  handler: async (ctx, args) => {
    const attacker = await requireCompetitivePlayer(ctx);
    const level = networkLevel(attacker);
    if (level < 1) throw new Error("Construct a Ghostblood Network before launching a Sphere Heist.");
    if (args.targetPlayerId === attacker._id) throw new Error("Choose a rival kingdom.");
    const target = await ctx.db.get(args.targetPlayerId);
    if (!target) throw new Error("Target kingdom not found.");
    if (target.isAdminObserver) throw new Error("Administrative observers cannot be targeted.");
    const { commitment, remaining } = validateOffensiveCommitment(attacker, level, args.operatives);
    const now = Date.now();
    const resource = await intelResource(ctx, attacker._id, target._id);
    const economyReport = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) =>
        q.eq("viewerPlayerId", attacker._id).eq("targetPlayerId", target._id).eq("category", "economy"))
      .unique();
    const economyIntel = categoryIntelAmount(resource, "economy", economyReport, now);
    const cost = ESPIONAGE_RULES.sphereHeist.economyIntelCost;
    if (economyIntel < cost) throw new Error(`Sphere Heist requires ${cost} Economy Intel against this rival.`);
    const economyIntelRemaining = economyIntel - cost;
    const season = await ensureActiveSeason(ctx, now);
    const baseSpyPower = spyPower(commitment);
    const resolveAt = now + ESPIONAGE_RULES.missionDurationMs;
    await ctx.db.patch(attacker._id, { operatives: remaining, lastActiveAt: now });
    if (resource) await ctx.db.patch(resource._id, { economyAmount: economyIntelRemaining, updatedAt: now });
    else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attacker._id, targetPlayerId: target._id, amount: 0, economyAmount: economyIntelRemaining, updatedAt: now });
    const missionId = await ctx.db.insert("espionageMissions", {
      attackerId: attacker._id, targetPlayerId: target._id, seasonId: season._id,
      operation: "sphere_heist", category: "economy", operatives: commitment,
      baseSpyPower, intelSpent: 0, economyIntelSpent: cost, economyIntelRemaining,
      finalSpyPower: baseSpyPower, departAt: now, resolveAt, status: "pending",
    });
    await ctx.scheduler.runAt(resolveAt, internal.espionage.resolveInvestigation, { missionId });
    return { missionId, resolveAt, baseSpyPower, finalSpyPower: baseSpyPower, economyIntelSpent: cost, economyIntelRemaining };
  },
});

async function resolveSphereHeist(ctx: MutationCtx, mission: Doc<"espionageMissions">, attacker: Doc<"players">, target: Doc<"players">, now: number) {
  const stormActive = (await activeHighstorm(ctx, now)).active;
  const outcome = resolveEspionageOutcome(mission.finalSpyPower, stormCounterIntelligence(spyPower(target.defendingOperatives), stormActive));
  const identityExposed = ESPIONAGE_RULES.sphereHeist.identityExposed[outcome];
  const { casualties, survivors, lost } = sphereHeistCasualties(mission.operatives, outcome, stormActive ? 2 : 1);
  const settledTarget = (await settlePlayerEconomy(ctx, target)).player;
  const settledAttacker = (await settlePlayerEconomy(ctx, attacker)).player;
  const spheresStolen = sphereHeistPayout(settledTarget.spheres, outcome);
  const targetSpheres = roundResource(Math.max(0, settledTarget.spheres - spheresStolen));
  const attackerSpheres = roundResource(settledAttacker.spheres + spheresStolen);
  await ctx.db.patch(target._id, { spheres: targetSpheres });
  await ctx.db.patch(attacker._id, {
    spheres: attackerSpheres,
    operatives: addOperatives(settledAttacker.operatives, survivors),
    lastActiveAt: now,
  });
  await ctx.db.patch(mission._id, {
    status: "resolved", outcome, resolvedAt: now, spheresStolen, casualties, identityExposed,
  });

  const outcomeName = outcome === "failure" ? "Catastrophic Failure" : outcome === "partial" ? "Failure" : outcome === "success" ? "Success" : "Overwhelming Success";
  const casualtyDetail = OPERATIVE_TIERS.filter((tier) => casualties[tier] > 0)
    .map((tier) => `${casualties[tier]} ${ESPIONAGE_RULES.operatives[tier].name}${casualties[tier] === 1 ? "" : "s"}`).join(", ") || "none";
  const attackerBody = `${outcomeName} against ${target.name}.${stormActive ? " Storm Cover: effective Counter-Intelligence reduced by 50%; existing failure casualty rate doubled." : ""} Spheres stolen: ${spheresStolen.toLocaleString()}. Operatives lost: ${lost} (${casualtyDetail}). Identity ${identityExposed ? "exposed" : "remained hidden"}. Economy Intel remaining: ${mission.economyIntelRemaining ?? 0}/${ESPIONAGE_RULES.sphereHeist.economyIntelCap}.`;
  await ctx.db.insert("messages", {
    toPlayerId: attacker._id, kind: "system", subject: `Sphere Heist: ${outcomeName}`, body: attackerBody,
    eventType: "sphere_heist_resolved", destinationView: "intelligence", destinationTab: "operations",
    entityType: "espionage_mission", entityId: String(mission._id), kingdomId: target._id,
    intelligenceCategory: "economy", createdAt: now,
  });
  await createNotification(ctx, {
    playerId: attacker._id, category: "missions", eventType: "sphere_heist_resolved", title: `Sphere Heist: ${outcomeName}`,
    body: attackerBody, destinationView: "intelligence", destinationTab: "operations", entityId: String(mission._id),
    kingdomId: target._id, intelligenceCategory: "economy", dedupeKey: `sphere-heist:${mission._id}:attacker`, createdAt: now,
  });

  const victimTitle = outcome === "failure" ? "Treasury Heist Exposed" : outcome === "partial" ? "Treasury Heist Disrupted" : "Spheres Stolen";
  const victimBody = outcome === "failure"
    ? `${attacker.name} agents attempted to rob your treasury. Your counter-intelligence exposed the operation; no Spheres were stolen.`
    : outcome === "partial"
      ? "Your counter-intelligence disrupted an attempted treasury heist. No Spheres were stolen, and the sponsor remains unknown."
      : outcome === "success"
        ? `${attacker.name} agents stole ${spheresStolen.toLocaleString()} Spheres from your treasury.`
        : `${spheresStolen.toLocaleString()} Spheres were stolen from your treasury. The culprit remains unknown.`;
  await ctx.db.insert("messages", {
    toPlayerId: target._id, kind: "system", subject: victimTitle, body: victimBody,
    eventType: "sphere_heist_targeted", destinationView: "intelligence", destinationTab: "operations",
    entityType: "espionage_mission", entityId: String(mission._id),
    ...(identityExposed ? { kingdomId: attacker._id } : {}), createdAt: now,
  });
  await createNotification(ctx, {
    playerId: target._id, category: "missions", eventType: "sphere_heist_targeted", title: victimTitle, body: victimBody,
    destinationView: "intelligence", destinationTab: "operations", entityId: String(mission._id),
    ...(identityExposed ? { kingdomId: attacker._id } : {}), dedupeKey: `sphere-heist:${mission._id}:defender`, createdAt: now,
  });
  return { resolved: true, outcome, spheresStolen, casualties, operativesLost: lost, identityExposed };
}

export const resolveInvestigation = internalMutation({
  args: { missionId: v.id("espionageMissions") },
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.status === "resolved") return { resolved: false };
    const attacker = await ctx.db.get(mission.attackerId);
    const target = await ctx.db.get(mission.targetPlayerId);
    const now = Date.now();
    if (!attacker || !target) {
      if (attacker) await ctx.db.patch(attacker._id, { operatives: addOperatives(attacker.operatives, mission.operatives), lastActiveAt: now });
      await ctx.db.patch(mission._id, { status: "resolved", outcome: "failure", resolvedAt: now });
      return { resolved: true, outcome: "failure" as const };
    }
    if (mission.operation === "sphere_heist") return await resolveSphereHeist(ctx, mission, attacker, target, now);
    const stormActive = (await activeHighstorm(ctx, now)).active;
    const outcome = resolveEspionageOutcome(mission.finalSpyPower, stormCounterIntelligence(spyPower(target.defendingOperatives), stormActive));
    const reward = stormInvestigationIntel(ESPIONAGE_RULES.intelRewards[outcome], outcome === "success" || outcome === "overwhelm", stormActive);
    const intel = await applyIntelReward(ctx, attacker, target._id, mission.category, reward, now);
    const bonusDiscovery = outcome === "overwhelm"
      ? await createBonusDiscovery(ctx, mission, target, now)
      : null;
    await ctx.db.patch(attacker._id, { operatives: addOperatives(attacker.operatives, mission.operatives), lastActiveAt: now });
    await ctx.db.patch(mission._id, {
      status: "resolved",
      outcome,
      resolvedAt: now,
      ...(bonusDiscovery ? { bonusDiscoveryId: bonusDiscovery.discoveryId } : {}),
    });
    const categoryName = SEASON_CATEGORIES[mission.category].name;
    const resultText = outcome === "failure"
      ? `The ${categoryName} investigation failed to produce reliable information. Your operatives returned safely.`
      : outcome === "overwhelm"
        ? `The ${categoryName} investigation overwhelmed ${target.name}'s defenses, gained ${reward} ${categoryName} Intel, and added a Bonus Discovery to the Ledger.`
        : `The ${categoryName} investigation gained ${reward} ${categoryName} Intel against ${target.name}.`;
    await ctx.db.insert("messages", { toPlayerId: attacker._id, kind: "system", subject: `${categoryName} Investigation: ${outcome[0].toUpperCase()}${outcome.slice(1)}`, body: `${resultText}${stormActive ? ` Storm Cover: effective Counter-Intelligence reduced by 50%.${outcome === "success" || outcome === "overwhelm" ? " Investigation Intel +50%." : ""}` : ""} ${categoryName} Intel: ${intel.amount}/${intel.cap}.`, eventType: "espionage_resolved", destinationView: "intelligence", destinationTab: "ledger", entityType: "espionage_mission", entityId: String(mission._id), kingdomId: target._id, intelligenceCategory: mission.category, createdAt: now });
    await createNotification(ctx, { playerId: attacker._id, category: "missions", eventType: "espionage_resolved", title: "Investigation Complete", body: resultText, destinationView: "intelligence", destinationTab: "ledger", entityId: String(mission._id), kingdomId: target._id, intelligenceCategory: mission.category, dedupeKey: `espionage:${mission._id}:attacker`, createdAt: now });
    if (outcome === "failure" || outcome === "partial") {
      const clear = outcome === "failure";
      const subject = clear ? "Espionage Activity Detected" : "Suspicious Activity Detected";
      const body = clear ? "Your defending operatives detected and disrupted an espionage investigation against your kingdom. The source could not be identified." : "Your operatives noticed suspicious activity around the kingdom, but could not identify its source or purpose.";
      await ctx.db.insert("messages", { toPlayerId: target._id, kind: "system", subject, body, eventType: clear ? "espionage_detected" : "espionage_suspected", destinationView: "intelligence", destinationTab: "operations", entityType: "espionage_mission", entityId: String(mission._id), createdAt: now });
      await createNotification(ctx, { playerId: target._id, category: "missions", eventType: clear ? "espionage_detected" : "espionage_suspected", title: subject, body, destinationView: "intelligence", destinationTab: "operations", entityId: String(mission._id), dedupeKey: `espionage:${mission._id}:defender`, createdAt: now });
    }
    return {
      resolved: true,
      outcome,
      reward,
      ...(bonusDiscovery ? { bonusDiscoveryId: bonusDiscovery.discoveryId, bonusFactKind: bonusDiscovery.factKind } : {}),
    };
  },
});
