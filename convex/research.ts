import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import { settlePlayerEconomy } from "./economyHelpers";
import { doctrineCostMultiplier, ECONOMIC_DOCTRINES, RESEARCH_RULES, type EconomicDoctrineKey, type ResearchProjectKey } from "./rules";
import { reconcileResearch, researchForPlayer, researchSpeed } from "./researchHelpers";
import { insertGameEvent } from "./eventHelpers";
import type { Doc, Id } from "./_generated/dataModel";

const projectKey = v.union(v.literal("bridgeEngineering"), v.literal("packHarnessDesign"), v.literal("painrialMedicine"), v.literal("soulcastArmor"), v.literal("siegeEngineering"), v.literal("gemCutting"), v.literal("soulcasting"), v.literal("marketEconomics"), v.literal("sprenStudies"), v.literal("religiousStudies"));
const doctrineKey = v.union(v.literal("taxItAll"), v.literal("militaryState"), v.literal("gemheartBaron"));

function projectProgressKey(project: ResearchProjectKey, level: number) {
  return `project:${project}:${level}`;
}

function doctrineProgressKey(doctrine: EconomicDoctrineKey) {
  return `doctrine:${doctrine}`;
}

async function parkActiveResearch(ctx: Parameters<typeof reconcileResearch>[0], playerId: Id<"players">, state: Doc<"playerResearch"> | null, now: number) {
  let current = state;
  if (current?.activeProject || current?.activeDoctrine) current = await reconcileResearch(ctx, playerId, now, { schedule: false });
  const savedProgress = { ...(current?.savedProgress ?? {}) };
  if (current?.activeProject && current.activeLevel) {
    const project = current.activeProject as ResearchProjectKey;
    savedProgress[projectProgressKey(project, current.activeLevel)] = {
      kind: "project" as const,
      project,
      level: current.activeLevel,
      accumulatedBaseMs: current.accumulatedBaseMs ?? 0,
      durationBaseMs: current.activeDurationBaseMs ?? RESEARCH_RULES.projects[project].durationsMs[current.activeLevel - 1],
    };
  } else if (current?.activeDoctrine) {
    const doctrine = current.activeDoctrine as EconomicDoctrineKey;
    savedProgress[doctrineProgressKey(doctrine)] = {
      kind: "doctrine" as const,
      doctrine,
      accumulatedBaseMs: current.accumulatedBaseMs ?? 0,
      durationBaseMs: current.activeDurationBaseMs ?? RESEARCH_RULES.doctrine.baseDurationMs,
    };
  }
  return { state: current, savedProgress };
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const state = await researchForPlayer(ctx, player._id);
    const speed = await researchSpeed(ctx, player);
    return { unlocked: (player.buildings.ardentMonastery ?? 0) > 0, completedLevels: state?.completedLevels ?? {}, economicDoctrine: state?.economicDoctrine ?? null, doctrineChangeCount: state?.doctrineChangeCount ?? 0, successfulDefensiveSieges: state?.successfulDefensiveSieges ?? 0, futurePathUnlocked: state?.futurePathUnlocked ?? false, savedProgress: state?.savedProgress ?? {}, active: state?.activeProject ? { kind: "project", project: state.activeProject, level: state.activeLevel, status: state.status, accumulatedBaseMs: state.accumulatedBaseMs ?? 0, durationBaseMs: state.activeDurationBaseMs, projectedCompletionAt: state.projectedCompletionAt } : state?.activeDoctrine ? { kind: "doctrine", doctrine: state.activeDoctrine, status: state.status, accumulatedBaseMs: state.accumulatedBaseMs ?? 0, durationBaseMs: state.activeDurationBaseMs, projectedCompletionAt: state.projectedCompletionAt } : null, speed, rules: RESEARCH_RULES, doctrines: ECONOMIC_DOCTRINES };
  },
});

export const start = mutation({
  args: { project: projectKey },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    let state = await researchForPlayer(ctx, player._id);
    const key = args.project as ResearchProjectKey;
    const nextLevel = Math.max(0, state?.completedLevels[key] ?? 0) + 1;
    if (state?.activeProject === key && state.activeLevel === nextLevel) throw new Error("That research is already active.");
    if (nextLevel > RESEARCH_RULES.projects[key].effects.length) throw new Error("This project is fully researched.");
    const rule = RESEARCH_RULES.projects[key];
    const monastery = player.buildings.ardentMonastery ?? 0;
    const requiredMonastery = rule.monastery[nextLevel - 1];
    if (monastery < requiredMonastery) throw new Error(`Ardent Monastery level ${requiredMonastery} is required.`);
    const speed = await researchSpeed(ctx, player);
    const ancient = rule.ancient[nextLevel - 1];
    if (speed.researchAncientCount < ancient) throw new Error(`${ancient} Research AP required; you currently have ${speed.researchAncientCount}.`);
    const requiresGemheartPlateau = Boolean((rule as unknown as { requiresGemheartPlateau?: readonly boolean[] }).requiresGemheartPlateau?.[nextLevel - 1]);
    if (requiresGemheartPlateau && speed.gemheartPlateauCount < 1) throw new Error("Control a Gemheart Plateau before beginning this research.");
    const defensiveSieges = Number((rule as unknown as { defensiveSieges?: readonly number[] }).defensiveSieges?.[nextLevel - 1] ?? 0);
    if ((state?.successfulDefensiveSieges ?? 0) < defensiveSieges) throw new Error(`${defensiveSieges} successful defensive sieges are required.`);
    const completedWithDoctrine = { ...(state?.completedLevels ?? {}), ...(state?.economicDoctrine === "militaryState" ? { __doctrineMilitaryState: 1 } : {}) };
    const progressKey = projectProgressKey(key, nextLevel);
    const saved = state?.savedProgress?.[progressKey];
    const spheres = saved ? 0 : Math.round(rule.costs[nextLevel - 1] * doctrineCostMultiplier(completedWithDoctrine, "research"));
    const gemhearts = saved ? 0 : rule.gemhearts[nextLevel - 1];
    if (player.spheres < spheres) throw new Error(`Not enough spheres. Need ${spheres}.`);
    if (player.gemhearts < gemhearts) throw new Error(`Not enough Gemhearts. Need ${gemhearts}.`);
    const now = Date.now();
    const parked = await parkActiveResearch(ctx, player._id, state, now);
    state = parked.state;
    const savedProgress = parked.savedProgress;
    const resumed = savedProgress[progressKey];
    delete savedProgress[progressKey];
    const duration = resumed?.durationBaseMs ?? rule.durationsMs[nextLevel - 1];
    const accumulatedBaseMs = Math.min(duration, Math.max(0, resumed?.accumulatedBaseMs ?? 0));
    const projectedCompletionAt = now + (duration - accumulatedBaseMs) / (1 + speed.total / 100);
    if (!state) {
      const id = await ctx.db.insert("playerResearch", { playerId: player._id, completedLevels: {}, activeProject: key, activeLevel: nextLevel, status: "active", accumulatedBaseMs, activeDurationBaseMs: duration, lastAdvancedAt: now, projectedCompletionAt, savedProgress, createdAt: now, updatedAt: now });
      state = await ctx.db.get(id);
    } else {
      await ctx.db.patch(state._id, { activeProject: key, activeDoctrine: undefined, activeLevel: nextLevel, status: "active", accumulatedBaseMs, activeDurationBaseMs: duration, lastAdvancedAt: now, projectedCompletionAt, savedProgress, updatedAt: now });
    }
    await ctx.db.patch(player._id, { spheres: player.spheres - spheres, gemhearts: player.gemhearts - gemhearts, lastActiveAt: now });
    await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId: player._id, expectedCompletionAt: projectedCompletionAt });
    await insertGameEvent(ctx, { kind: "research", text: `${player.name} ${resumed ? "resumed" : "began"} ${rule.name} ${nextLevel}.`, createdAt: now });
    return { project: key, level: nextLevel, projectedCompletionAt, resumed: Boolean(resumed) };
  },
});

export const startDoctrine = mutation({
  args: { doctrine: doctrineKey },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    if ((player.buildings.ardentMonastery ?? 0) < 1) throw new Error("Construct an Ardent Monastery before choosing an Economic Doctrine.");
    let state = await researchForPlayer(ctx, player._id);
    if (state?.economicDoctrine === args.doctrine) throw new Error("That Economic Doctrine is already active.");
    if (state?.activeDoctrine === args.doctrine) throw new Error("That doctrine is already being considered.");
    const changes = state?.doctrineChangeCount ?? 0;
    const switchNumber = state?.economicDoctrine ? changes + 1 : 0;
    const progressKey = doctrineProgressKey(args.doctrine as EconomicDoctrineKey);
    const saved = state?.savedProgress?.[progressKey];
    const spheres = saved ? 0 : RESEARCH_RULES.doctrine.baseSphereCost + switchNumber * RESEARCH_RULES.doctrine.switchSphereIncrease;
    if (player.spheres < spheres) throw new Error(`Not enough spheres. Need ${spheres}.`);
    const speed = await researchSpeed(ctx, player);
    const now = Date.now();
    const parked = await parkActiveResearch(ctx, player._id, state, now);
    state = parked.state;
    const savedProgress = parked.savedProgress;
    const resumed = savedProgress[progressKey];
    delete savedProgress[progressKey];
    const duration = resumed?.durationBaseMs ?? RESEARCH_RULES.doctrine.baseDurationMs + switchNumber * RESEARCH_RULES.doctrine.switchDurationIncreaseMs;
    const accumulatedBaseMs = Math.min(duration, Math.max(0, resumed?.accumulatedBaseMs ?? 0));
    const projectedCompletionAt = now + (duration - accumulatedBaseMs) / (1 + speed.total / 100);
    if (!state) {
      const id = await ctx.db.insert("playerResearch", { playerId: player._id, completedLevels: {}, activeDoctrine: args.doctrine, status: "active", accumulatedBaseMs, activeDurationBaseMs: duration, lastAdvancedAt: now, projectedCompletionAt, savedProgress, doctrineChangeCount: 0, successfulDefensiveSieges: 0, createdAt: now, updatedAt: now });
      state = await ctx.db.get(id);
    } else {
      await ctx.db.patch(state._id, { activeDoctrine: args.doctrine, activeProject: undefined, activeLevel: undefined, status: "active", accumulatedBaseMs, activeDurationBaseMs: duration, lastAdvancedAt: now, projectedCompletionAt, savedProgress, updatedAt: now });
    }
    await ctx.db.patch(player._id, { spheres: player.spheres - spheres, lastActiveAt: now });
    await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId: player._id, expectedCompletionAt: projectedCompletionAt });
    await insertGameEvent(ctx, { kind: "research", text: `${player.name} ${resumed ? "resumed" : "began considering"} a new Economic Doctrine.`, createdAt: now });
    return { doctrine: args.doctrine as EconomicDoctrineKey, projectedCompletionAt, resumed: Boolean(resumed) };
  },
});

export const completeActive = internalMutation({
  args: { playerId: v.id("players"), expectedCompletionAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (args.expectedCompletionAt !== undefined) {
      const state = await researchForPlayer(ctx, args.playerId);
      if (state?.projectedCompletionAt !== args.expectedCompletionAt) return state;
    }
    return await reconcileResearch(ctx, args.playerId);
  },
});

export const migrateResearchState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("playerResearch").take(200);
    const now = Date.now();
    for (const row of rows) {
      await ctx.db.patch(row._id, { doctrineChangeCount: row.doctrineChangeCount ?? 0, successfulDefensiveSieges: row.successfulDefensiveSieges ?? 0, futurePathUnlocked: row.futurePathUnlocked ?? false, updatedAt: now });
      if (row.activeProject || row.activeDoctrine) await reconcileResearch(ctx, row.playerId, now);
    }
    return { migrated: rows.length };
  },
});
