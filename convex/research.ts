import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import { settlePlayerEconomy } from "./economyHelpers";
import { doctrineCostMultiplier, ECONOMIC_DOCTRINES, RESEARCH_RULES, type EconomicDoctrineKey, type ResearchProjectKey } from "./rules";
import { reconcileResearch, researchForPlayer, researchSpeed } from "./researchHelpers";
import { insertGameEvent } from "./eventHelpers";

const projectKey = v.union(v.literal("bridgeEngineering"), v.literal("packHarnessDesign"), v.literal("painrialMedicine"), v.literal("soulcastArmor"), v.literal("siegeEngineering"), v.literal("gemCutting"), v.literal("soulcasting"), v.literal("marketEconomics"), v.literal("sprenStudies"), v.literal("religiousStudies"));
const doctrineKey = v.union(v.literal("taxItAll"), v.literal("militaryState"), v.literal("gemheartBaron"));

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const state = await researchForPlayer(ctx, player._id);
    const speed = await researchSpeed(ctx, player);
    return { unlocked: (player.buildings.ardentMonastery ?? 0) > 0, completedLevels: state?.completedLevels ?? {}, economicDoctrine: state?.economicDoctrine ?? null, doctrineChangeCount: state?.doctrineChangeCount ?? 0, successfulDefensiveSieges: state?.successfulDefensiveSieges ?? 0, futurePathUnlocked: state?.futurePathUnlocked ?? false, active: state?.activeProject ? { kind: "project", project: state.activeProject, level: state.activeLevel, status: state.status, accumulatedBaseMs: state.accumulatedBaseMs ?? 0, projectedCompletionAt: state.projectedCompletionAt } : state?.activeDoctrine ? { kind: "doctrine", doctrine: state.activeDoctrine, status: state.status, accumulatedBaseMs: state.accumulatedBaseMs ?? 0, projectedCompletionAt: state.projectedCompletionAt } : null, speed, rules: RESEARCH_RULES, doctrines: ECONOMIC_DOCTRINES };
  },
});

export const start = mutation({
  args: { project: projectKey },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    let state = await researchForPlayer(ctx, player._id);
    if (state?.activeProject || state?.activeDoctrine) throw new Error("Only one research project may be active at a time.");
    const key = args.project as ResearchProjectKey;
    const nextLevel = Math.max(0, state?.completedLevels[key] ?? 0) + 1;
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
    const spheres = Math.round(rule.costs[nextLevel - 1] * doctrineCostMultiplier(completedWithDoctrine, "research"));
    const gemhearts = rule.gemhearts[nextLevel - 1];
    if (player.spheres < spheres) throw new Error(`Not enough spheres. Need ${spheres}.`);
    if (player.gemhearts < gemhearts) throw new Error(`Not enough Gemhearts. Need ${gemhearts}.`);
    const now = Date.now();
    const duration = rule.durationsMs[nextLevel - 1];
    const projectedCompletionAt = now + duration / (1 + speed.total / 100);
    if (!state) {
      const id = await ctx.db.insert("playerResearch", { playerId: player._id, completedLevels: {}, activeProject: key, activeLevel: nextLevel, status: "active", accumulatedBaseMs: 0, lastAdvancedAt: now, projectedCompletionAt, createdAt: now, updatedAt: now });
      state = await ctx.db.get(id);
    } else {
      await ctx.db.patch(state._id, { activeProject: key, activeLevel: nextLevel, status: "active", accumulatedBaseMs: 0, lastAdvancedAt: now, projectedCompletionAt, updatedAt: now });
    }
    await ctx.db.patch(player._id, { spheres: player.spheres - spheres, gemhearts: player.gemhearts - gemhearts, lastActiveAt: now });
    await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId: player._id });
    await insertGameEvent(ctx, { kind: "research", text: `${player.name} began ${rule.name} ${nextLevel}.`, createdAt: now });
    return { project: key, level: nextLevel, projectedCompletionAt };
  },
});

export const startDoctrine = mutation({
  args: { doctrine: doctrineKey },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    if ((player.buildings.ardentMonastery ?? 0) < 1) throw new Error("Construct an Ardent Monastery before choosing an Economic Doctrine.");
    let state = await researchForPlayer(ctx, player._id);
    if (state?.activeProject || state?.activeDoctrine) throw new Error("Only one research project may be active at a time.");
    if (state?.economicDoctrine === args.doctrine) throw new Error("That Economic Doctrine is already active.");
    const changes = state?.doctrineChangeCount ?? 0;
    const switchNumber = state?.economicDoctrine ? changes + 1 : 0;
    const spheres = RESEARCH_RULES.doctrine.baseSphereCost + switchNumber * RESEARCH_RULES.doctrine.switchSphereIncrease;
    if (player.spheres < spheres) throw new Error(`Not enough spheres. Need ${spheres}.`);
    const speed = await researchSpeed(ctx, player);
    const duration = RESEARCH_RULES.doctrine.baseDurationMs + switchNumber * RESEARCH_RULES.doctrine.switchDurationIncreaseMs;
    const now = Date.now();
    const projectedCompletionAt = now + duration / (1 + speed.total / 100);
    if (!state) {
      const id = await ctx.db.insert("playerResearch", { playerId: player._id, completedLevels: {}, activeDoctrine: args.doctrine, status: "active", accumulatedBaseMs: 0, lastAdvancedAt: now, projectedCompletionAt, doctrineChangeCount: 0, successfulDefensiveSieges: 0, createdAt: now, updatedAt: now });
      state = await ctx.db.get(id);
    } else {
      await ctx.db.patch(state._id, { activeDoctrine: args.doctrine, activeProject: undefined, activeLevel: undefined, status: "active", accumulatedBaseMs: 0, lastAdvancedAt: now, projectedCompletionAt, updatedAt: now });
    }
    await ctx.db.patch(player._id, { spheres: player.spheres - spheres, lastActiveAt: now });
    await ctx.scheduler.runAt(projectedCompletionAt, internal.research.completeActive, { playerId: player._id });
    await insertGameEvent(ctx, { kind: "research", text: `${player.name} began considering a new Economic Doctrine.`, createdAt: now });
    return { doctrine: args.doctrine as EconomicDoctrineKey, projectedCompletionAt };
  },
});

export const completeActive = internalMutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => await reconcileResearch(ctx, args.playerId),
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
