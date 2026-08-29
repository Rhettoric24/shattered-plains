import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { settlePlayerEconomy } from "./economyHelpers";
import { createNotification } from "./notificationHelpers";
import { activeHighstorm } from "./highstorms";
import { stormCounterIntelligence, stormInvestigationIntel } from "./highstormRules";
import { requireCurrentPlayer } from "./ownership";
import { plateauAttributeCountsForPlayer, plateauCountsForPlayer } from "./plateauHelpers";
import { ownedOperativesIncludingAway, ownedUnitsIncludingAway, provisionsStatus } from "./provisionHelpers";
import { ensureActiveSeason } from "./seasonLedger";
import { SEASON_CATEGORIES } from "./seasonScoringRules";
import { UNIT_RULES, normalizeUnits, roundResource } from "./rules";
import {
  ESPIONAGE_CATEGORIES,
  ESPIONAGE_RULES,
  OPERATIVE_TIERS,
  addOperatives,
  economyIntelDisclosureLevel,
  effectiveLedgerIntelLevel,
  emptyOperatives,
  estimateScore,
  networkValue,
  nextDecayAt,
  normalizeOperatives,
  operativeCount,
  qualitativeScore,
  resolveEspionageOutcome,
  secondaryCategory,
  seededIndex,
  legacyEconomyIntelAmount,
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

function safeRules(level: number) {
  return {
    categories: SEASON_CATEGORIES,
    missionDurationMs: ESPIONAGE_RULES.missionDurationMs,
    operatives: ESPIONAGE_RULES.operatives,
    sphereHeist: ESPIONAGE_RULES.sphereHeist,
    network: {
      ...ESPIONAGE_RULES.network,
      currentIntelCap: networkValue(ESPIONAGE_RULES.network.intelCaps, level),
      currentMissionIntelSpendCap: networkValue(ESPIONAGE_RULES.network.missionIntelSpendCaps, level),
    },
  };
}

function economyIntelAmount(resource: Doc<"kingdomIntelResources"> | null | undefined) {
  return Math.max(0, Math.min(
    ESPIONAGE_RULES.sphereHeist.economyIntelCap,
    Math.floor(resource?.economyAmount ?? 0),
  ));
}

function economyIntelAmountForWrite(resource: Doc<"kingdomIntelResources"> | null | undefined, legacyReport: Doc<"kingdomIntelligence"> | null | undefined) {
  return resource?.economyAmount === undefined
    ? legacyEconomyIntelAmount(legacyReport?.achievedLevel ?? 0)
    : economyIntelAmount(resource);
}

async function intelResource(ctx: MutationCtx, viewerPlayerId: Id<"players">, targetPlayerId: Id<"players">) {
  return await ctx.db.query("kingdomIntelResources")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewerPlayerId).eq("targetPlayerId", targetPlayerId))
    .unique();
}

async function applyIntelReward(ctx: MutationCtx, attacker: Doc<"players">, targetPlayerId: Id<"players">, category: EspionageCategory, reward: number, now: number) {
  const row = await intelResource(ctx, attacker._id, targetPlayerId);
  if (category === "economy") {
    const report = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) =>
        q.eq("viewerPlayerId", attacker._id).eq("targetPlayerId", targetPlayerId).eq("category", "economy"))
      .unique();
    const cap = ESPIONAGE_RULES.sphereHeist.economyIntelCap;
    const amount = Math.min(cap, economyIntelAmountForWrite(row, report) + reward);
    if (row) await ctx.db.patch(row._id, { economyAmount: amount, updatedAt: now });
    else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attacker._id, targetPlayerId, amount: 0, economyAmount: amount, updatedAt: now });
    return { amount, cap, resource: "economy" as const };
  }
  const cap = networkValue(ESPIONAGE_RULES.network.intelCaps, networkLevel(attacker));
  const amount = Math.min(cap, Math.max(0, (row?.amount ?? 0) + reward));
  if (row) await ctx.db.patch(row._id, { amount, updatedAt: now });
  else await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attacker._id, targetPlayerId, amount, updatedAt: now });
  return { amount, cap, resource: "general" as const };
}

async function categoryScore(ctx: MutationCtx, seasonId: Id<"seasons">, playerId: Id<"players">, category: EspionageCategory) {
  const score = await ctx.db.query("seasonScores")
    .withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", seasonId).eq("playerId", playerId))
    .unique();
  return Math.max(0, Number(score?.categoryTotals?.[category] ?? 0));
}

async function observeCategory(ctx: MutationCtx, args: {
  viewerPlayerId: Id<"players">;
  targetPlayerId: Id<"players">;
  seasonId: Id<"seasons">;
  category: EspionageCategory;
  increment: number;
  cap: 1 | 2;
  missionId: Id<"espionageMissions">;
  now: number;
}) {
  const existing = await ctx.db.query("kingdomIntelligence")
    .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) =>
      q.eq("viewerPlayerId", args.viewerPlayerId).eq("targetPlayerId", args.targetPlayerId).eq("category", args.category))
    .unique();
  const current = existing ? effectiveLedgerIntelLevel(existing.achievedLevel, existing.observedAt, args.now) : 0;
  if (current > args.cap) return { updated: false, level: current };
  const achievedLevel = Math.min(args.cap, current + args.increment);
  if (achievedLevel <= 0) return { updated: false, level: current };
  const observedScore = await categoryScore(ctx, args.seasonId, args.targetPlayerId, args.category);
  const record = {
    viewerPlayerId: args.viewerPlayerId,
    targetPlayerId: args.targetPlayerId,
    category: args.category,
    achievedLevel,
    bestLevel: Math.max(existing?.bestLevel ?? 0, achievedLevel),
    observedScore,
    observedAt: args.now,
    source: `${SEASON_CATEGORIES[args.category].name} Investigation`,
    missionId: args.missionId,
  };
  if (existing) await ctx.db.patch(existing._id, record);
  else await ctx.db.insert("kingdomIntelligence", record);
  return { updated: true, level: achievedLevel };
}

async function createBonusDiscovery(ctx: MutationCtx, mission: Doc<"espionageMissions">, target: Doc<"players">, now: number) {
  const candidates: Array<{ kind: string; text: string }> = [];
  if (mission.category === "military") {
    const units = normalizeUnits(target.units);
    const composition = Object.entries(units).filter(([, count]) => count > 0)
      .map(([key, count]) => `${count} ${UNIT_RULES[key as keyof typeof UNIT_RULES].name}${count === 1 ? "" : "s"}`).join(", ") || "no combat units at home";
    candidates.push({ kind: "unit_composition", text: `Observed home-force composition: ${composition}.` });
    const away = await ctx.db.query("raids").withIndex("by_attacker", (q) => q.eq("attackerId", target._id)).take(50);
    const sieges = await ctx.db.query("sieges").withIndex("by_attacker", (q) => q.eq("attackerId", target._id)).take(50);
    const awayCount = away.filter((row) => row.status === "pending").length + sieges.filter((row) => row.status === "pending").length;
    candidates.push({ kind: "forces_away", text: awayCount > 0 ? `${awayCount} military force${awayCount === 1 ? " is" : "s are"} currently away from the warcamp.` : "No military forces were observed away from the warcamp." });
  } else if (mission.category === "economy") {
    candidates.push({ kind: "sphere_store", text: `Observed Sphere store: ${Math.floor(target.spheres).toLocaleString()}.` });
    candidates.push({ kind: "gemheart_holdings", text: `Observed Gemheart holdings: ${Math.floor(target.gemhearts).toLocaleString()}.` });
  } else if (mission.category === "research") {
    const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", target._id)).unique();
    if (research?.activeProject) candidates.push({ kind: "active_research", text: `Active research: ${research.activeProject}, level ${research.activeLevel ?? 1}${research.projectedCompletionAt ? `, projected complete ${new Date(research.projectedCompletionAt).toISOString()}` : ""}.` });
    else if (research?.activeDoctrine) candidates.push({ kind: "active_doctrine", text: `Active doctrine study: ${research.activeDoctrine}.` });
    else candidates.push({ kind: "research_idle", text: "No active research project was observed." });
    const completedCount = Object.values(research?.completedLevels ?? {}).reduce((sum, level) => sum + Math.max(0, Number(level)), 0);
    candidates.push({ kind: "research_depth", text: `Observed completed research levels across all libraries: ${completedCount}.` });
  } else {
    const plateaus = await ctx.db.query("plateaus").withIndex("by_owner", (q) => q.eq("ownerPlayerId", target._id)).take(100);
    const valuable = plateaus.filter((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins" || plateau.type === "gemheart");
    candidates.push({ kind: "territory_roster", text: `Observed territory: ${plateaus.length} plateau${plateaus.length === 1 ? "" : "s"}${plateaus.length ? ` (${plateaus.map((plateau) => plateau.name).join(", ")})` : ""}.` });
    candidates.push({ kind: "valuable_territory", text: valuable.length ? `Valuable holdings: ${valuable.map((plateau) => `${plateau.name} (${plateau.type.replaceAll("_", " ")})`).join(", ")}.` : "No Ancient or Gemheart holdings were observed." });
  }
  const fact = candidates[seededIndex(`${mission._id}:bonus`, candidates.length)];
  return await ctx.db.insert("espionageBonusDiscoveries", {
    viewerPlayerId: mission.attackerId, targetPlayerId: mission.targetPlayerId, category: mission.category,
    missionId: mission._id, factKind: fact.kind, text: fact.text, observedAt: now,
  });
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
    const targets = await ctx.db.query("players").take(200);
    const names = new Map(targets.map((target) => [String(target._id), target.name]));
    let onMission = emptyOperatives();
    for (const mission of pending) onMission = addOperatives(onMission, mission.operatives);
    const resourcesByTarget = new Map(resources.map((row) => [String(row.targetPlayerId), row]));
    const cap = networkValue(ESPIONAGE_RULES.network.intelCaps, level);
    const now = Date.now();
    return {
      networkLevel: level,
      available: normalizeOperatives(player.operatives),
      defending: normalizeOperatives(player.defendingOperatives),
      onMission,
      counterIntelligence: spyPower(player.defendingOperatives),
      targets: targets.filter((target) => target._id !== player._id).map((target) => ({
        playerId: target._id, name: target.name,
        intel: resourcesByTarget.get(String(target._id))?.amount ?? 0, intelCap: cap,
        economyIntel: economyIntelAmount(resourcesByTarget.get(String(target._id))),
        economyIntelCap: ESPIONAGE_RULES.sphereHeist.economyIntelCap,
      })),
      missions: recent.map((mission) => ({
        missionId: mission._id, targetPlayerId: mission.targetPlayerId, targetName: names.get(String(mission.targetPlayerId)) ?? "Unknown kingdom",
        operation: mission.operation ?? "investigation", category: mission.category, operatives: mission.operatives, baseSpyPower: mission.baseSpyPower, intelSpent: mission.intelSpent,
        finalSpyPower: mission.finalSpyPower, departAt: mission.departAt, resolveAt: mission.resolveAt,
        resolvedAt: mission.resolvedAt ?? null, status: mission.status, outcome: mission.outcome ?? null,
        incidentalCategory: mission.incidentalCategory ?? null, bonusDiscoveryId: mission.bonusDiscoveryId ?? null,
        economyIntelSpent: mission.economyIntelSpent ?? 0, economyIntelRemaining: mission.economyIntelRemaining ?? null,
        spheresStolen: mission.spheresStolen ?? 0, casualties: normalizeOperatives(mission.casualties),
        identityExposed: mission.identityExposed ?? null,
      })),
      rules: safeRules(level),
    };
  },
});

export const getKingdomLedger = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const now = Date.now();
    if (networkLevel(viewer) < 1) {
      return { locked: true, season: null, generatedAt: now, decayStepMs: ESPIONAGE_RULES.decayStepMs, rows: [] };
    }
    const season = await ctx.db.query("seasons").withIndex("by_status", (q) => q.eq("status", "active")).unique();
    const players = await ctx.db.query("players").take(200);
    const reports = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) => q.eq("viewerPlayerId", viewer._id)).take(1000);
    const resources = await ctx.db.query("kingdomIntelResources")
      .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewer._id)).take(200);
    const discoveries = await ctx.db.query("espionageBonusDiscoveries")
      .withIndex("by_viewerPlayerId_and_observedAt", (q) => q.eq("viewerPlayerId", viewer._id)).order("desc").take(200);
    const scores = season ? await ctx.db.query("seasonScores")
      .withIndex("by_seasonId_and_playerId", (q) => q.eq("seasonId", season._id)).take(200) : [];
    const reportMap = new Map(reports.map((report) => [`${report.targetPlayerId}:${report.category}`, report]));
    const resourceMap = new Map(resources.map((resource) => [String(resource.targetPlayerId), resource]));
    const scoreMap = new Map(scores.map((score) => [String(score.playerId), score]));
    const discoveryMap = new Map<string, typeof discoveries>();
    for (const discovery of discoveries) {
      const key = `${discovery.targetPlayerId}:${discovery.category}`;
      const rows = discoveryMap.get(key) ?? [];
      if (rows.length < 10) rows.push(discovery);
      discoveryMap.set(key, rows);
    }
    const rows = players.map((target) => {
      const own = target._id === viewer._id;
      const score = scoreMap.get(String(target._id));
      const actual = Object.fromEntries(ESPIONAGE_CATEGORIES.map((category) => [category, Math.max(0, Number(score?.categoryTotals?.[category] ?? 0))])) as Record<EspionageCategory, number>;
      const cells = Object.fromEntries(ESPIONAGE_CATEGORIES.map((category) => {
        const report = reportMap.get(`${target._id}:${category}`);
        const reportLevel = report ? effectiveLedgerIntelLevel(report.achievedLevel, report.observedAt, now) : 0;
        const resource = resourceMap.get(String(target._id));
        const targetEconomyIntel = economyIntelAmount(resource);
        const currentLevel = own
          ? 2
          : category === "economy"
            ? economyIntelDisclosureLevel(targetEconomyIntel)
            : reportLevel;
        const observed = own ? actual[category] : report?.observedScore ?? actual[category];
        const broadLabel = qualitativeScore(category, actual[category]);
        const presentation = currentLevel === 2
          ? { mode: "exact" as const, value: observed, display: observed.toLocaleString(), ...(own ? { label: broadLabel } : {}) }
          : currentLevel === 1
            ? { mode: "range" as const, ...estimateScore(observed), display: `${estimateScore(observed).min.toLocaleString()}–${estimateScore(observed).max.toLocaleString()}` }
            : { mode: "qualitative" as const, label: broadLabel, display: broadLabel };
        return [category, {
          category, categoryName: SEASON_CATEGORIES[category].name, currentLevel,
          bestLevel: own ? 2 : category === "economy" ? Math.max(report?.bestLevel ?? 0, currentLevel) : report?.bestLevel ?? 0,
          presentation, observedAt: own ? now : category === "economy" ? report?.observedAt ?? resource?.updatedAt ?? null : report?.observedAt ?? null,
          nextDecayAt: own || !report || category === "economy" ? null : nextDecayAt(report.achievedLevel, report.observedAt, now),
          source: own ? "Your Season Ledger" : category === "economy" ? report?.source ?? "Persistent Economy Intel" : report?.source ?? "General reputation",
          ...(category === "economy" && !own ? { economyIntel: targetEconomyIntel, economyIntelCap: ESPIONAGE_RULES.sphereHeist.economyIntelCap } : {}),
          discoveries: (discoveryMap.get(`${target._id}:${category}`) ?? []).map((entry) => ({ id: entry._id, kind: entry.factKind, text: entry.text, observedAt: entry.observedAt })),
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
    return { season: season ? { id: season._id, name: season.name } : null, generatedAt: now, decayStepMs: ESPIONAGE_RULES.decayStepMs, rows };
  },
});

export const materializeLegacyEconomyIntelAmounts = internalMutation({
  args: {
    reportCursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const reports = await ctx.db.query("kingdomIntelligence").paginate({ cursor: args.reportCursor, numItems: 50 });
    let migrated = 0;

    for (const report of reports.page) {
      if (report.category !== "economy") continue;
      const resource = await intelResource(ctx, report.viewerPlayerId, report.targetPlayerId);
      if (resource?.economyAmount !== undefined) continue;
      const economyAmount = legacyEconomyIntelAmount(report.achievedLevel);
      if (resource) await ctx.db.patch(resource._id, { economyAmount, updatedAt: Date.now() });
      else await ctx.db.insert("kingdomIntelResources", {
        viewerPlayerId: report.viewerPlayerId,
        targetPlayerId: report.targetPlayerId,
        amount: 0,
        economyAmount,
        updatedAt: Date.now(),
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
  args: { targetPlayerId: v.id("players"), category: categoryValidator, operatives: operativeCountsValidator, intelSpend: v.number() },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    const level = networkLevel(attacker);
    if (level < 1) throw new Error("Construct a Ghostblood Network before launching investigations.");
    if (args.targetPlayerId === attacker._id) throw new Error("Choose a rival kingdom.");
    const target = await ctx.db.get(args.targetPlayerId);
    if (!target) throw new Error("Target kingdom not found.");
    const { commitment, remaining } = validateOffensiveCommitment(attacker, level, args.operatives);
    const intelSpend = Math.floor(args.intelSpend);
    const spendCap = networkValue(ESPIONAGE_RULES.network.missionIntelSpendCaps, level);
    if (intelSpend < 0 || intelSpend > spendCap || intelSpend !== args.intelSpend) throw new Error(`Spend between 0 and ${spendCap} Intel.`);
    const resource = await intelResource(ctx, attacker._id, target._id);
    if (intelSpend > (resource?.amount ?? 0)) throw new Error("Not enough Intel against this rival.");
    const now = Date.now();
    const season = await ensureActiveSeason(ctx, now);
    const baseSpyPower = spyPower(commitment);
    const finalSpyPower = baseSpyPower + intelSpend;
    const resolveAt = now + ESPIONAGE_RULES.missionDurationMs;
    await ctx.db.patch(attacker._id, { operatives: remaining, lastActiveAt: now });
    if (resource) await ctx.db.patch(resource._id, { amount: resource.amount - intelSpend, updatedAt: now });
    else if (intelSpend === 0) await ctx.db.insert("kingdomIntelResources", { viewerPlayerId: attacker._id, targetPlayerId: target._id, amount: 0, updatedAt: now });
    const missionId = await ctx.db.insert("espionageMissions", {
      attackerId: attacker._id, targetPlayerId: target._id, seasonId: season._id, operation: "investigation", category: args.category,
      operatives: commitment, baseSpyPower, intelSpent: intelSpend, finalSpyPower, departAt: now, resolveAt, status: "pending",
    });
    await ctx.scheduler.runAt(resolveAt, internal.espionage.resolveInvestigation, { missionId });
    return { missionId, resolveAt, baseSpyPower, intelSpent: intelSpend, finalSpyPower };
  },
});

export const launchSphereHeist = mutation({
  args: { targetPlayerId: v.id("players"), operatives: operativeCountsValidator },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    const level = networkLevel(attacker);
    if (level < 1) throw new Error("Construct a Ghostblood Network before launching a Sphere Heist.");
    if (args.targetPlayerId === attacker._id) throw new Error("Choose a rival kingdom.");
    const target = await ctx.db.get(args.targetPlayerId);
    if (!target) throw new Error("Target kingdom not found.");
    const { commitment, remaining } = validateOffensiveCommitment(attacker, level, args.operatives);
    const now = Date.now();
    const resource = await intelResource(ctx, attacker._id, target._id);
    const economyReport = await ctx.db.query("kingdomIntelligence")
      .withIndex("by_viewerPlayerId_and_targetPlayerId_and_category", (q) =>
        q.eq("viewerPlayerId", attacker._id).eq("targetPlayerId", target._id).eq("category", "economy"))
      .unique();
    const economyIntel = economyIntelAmountForWrite(resource, economyReport);
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
    let incidentalCategory: EspionageCategory | undefined;
    if (outcome === "partial" || outcome === "success" || outcome === "overwhelm") {
      incidentalCategory = secondaryCategory(mission.category, `${mission._id}:secondary`);
      await observeCategory(ctx, { viewerPlayerId: attacker._id, targetPlayerId: target._id, seasonId: mission.seasonId, category: incidentalCategory, increment: 1, cap: 1, missionId: mission._id, now });
    }
    if (outcome === "success" || outcome === "overwhelm") {
      await observeCategory(ctx, { viewerPlayerId: attacker._id, targetPlayerId: target._id, seasonId: mission.seasonId, category: mission.category, increment: 2, cap: 2, missionId: mission._id, now });
    }
    let bonusDiscoveryId: Id<"espionageBonusDiscoveries"> | undefined;
    if (outcome === "overwhelm") bonusDiscoveryId = await createBonusDiscovery(ctx, mission, target, now);
    await ctx.db.patch(attacker._id, { operatives: addOperatives(attacker.operatives, mission.operatives), lastActiveAt: now });
    await ctx.db.patch(mission._id, {
      status: "resolved", outcome, resolvedAt: now,
      ...(incidentalCategory ? { incidentalCategory } : {}), ...(bonusDiscoveryId ? { bonusDiscoveryId } : {}),
    });
    const categoryName = SEASON_CATEGORIES[mission.category].name;
    const resultText = outcome === "failure"
      ? `The ${categoryName} investigation failed to produce reliable information. Your operatives returned safely.`
      : outcome === "partial"
        ? `The ${categoryName} investigation was disrupted, but incidental ${SEASON_CATEGORIES[incidentalCategory!].name} intelligence was recovered.`
        : outcome === "success"
          ? `The ${categoryName} investigation succeeded and also uncovered incidental ${SEASON_CATEGORIES[incidentalCategory!].name} intelligence.`
          : `The ${categoryName} investigation overwhelmed the target's defenses and produced a Bonus Discovery.`;
    const intelName = intel.resource === "economy" ? "Economy Intel" : "Intel";
    await ctx.db.insert("messages", { toPlayerId: attacker._id, kind: "system", subject: `${categoryName} Investigation: ${outcome[0].toUpperCase()}${outcome.slice(1)}`, body: `${resultText}${stormActive ? ` Storm Cover: effective Counter-Intelligence reduced by 50%.${outcome === "success" || outcome === "overwhelm" ? " Investigation Intel +50%." : ""}` : ""} ${intelName} gained: ${reward}; stored against ${target.name}: ${intel.amount}/${intel.cap}.`, eventType: "espionage_resolved", destinationView: "intelligence", destinationTab: "ledger", entityType: "espionage_mission", entityId: String(mission._id), kingdomId: target._id, intelligenceCategory: mission.category, createdAt: now });
    await createNotification(ctx, { playerId: attacker._id, category: "missions", eventType: "espionage_resolved", title: "Investigation Complete", body: resultText, destinationView: "intelligence", destinationTab: "ledger", entityId: String(mission._id), kingdomId: target._id, intelligenceCategory: mission.category, dedupeKey: `espionage:${mission._id}:attacker`, createdAt: now });
    if (outcome === "failure" || outcome === "partial") {
      const clear = outcome === "failure";
      const subject = clear ? "Espionage Activity Detected" : "Suspicious Activity Detected";
      const body = clear ? "Your defending operatives detected and disrupted an espionage investigation against your kingdom. The source could not be identified." : "Your operatives noticed suspicious activity around the kingdom, but could not identify its source or purpose.";
      await ctx.db.insert("messages", { toPlayerId: target._id, kind: "system", subject, body, eventType: clear ? "espionage_detected" : "espionage_suspected", destinationView: "intelligence", destinationTab: "operations", entityType: "espionage_mission", entityId: String(mission._id), createdAt: now });
      await createNotification(ctx, { playerId: target._id, category: "missions", eventType: clear ? "espionage_detected" : "espionage_suspected", title: subject, body, destinationView: "intelligence", destinationTab: "operations", entityId: String(mission._id), dedupeKey: `espionage:${mission._id}:defender`, createdAt: now });
    }
    return { resolved: true, outcome, reward, incidentalCategory: incidentalCategory ?? null, bonusDiscoveryId: bonusDiscoveryId ?? null };
  },
});
