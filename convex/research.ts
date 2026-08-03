import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import { settlePlayerEconomy } from "./economyHelpers";
import { RESEARCH_RULES, type ResearchProjectKey } from "./rules";
import { reconcileResearch, researchForPlayer, researchSpeed } from "./researchHelpers";
import { insertGameEvent } from "./eventHelpers";

const projectKey = v.union(v.literal("bridgeEngineering"), v.literal("packHarnessDesign"), v.literal("painrialMedicine"), v.literal("soulcastArmor"), v.literal("siegeEngineering"), v.literal("gemCutting"), v.literal("soulcasting"), v.literal("marketEconomics"));

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const state = await researchForPlayer(ctx, player._id);
    const speed = await researchSpeed(ctx, player);
    return { unlocked: (player.buildings.ardentMonastery ?? 0) > 0, completedLevels: state?.completedLevels ?? {}, active: state?.activeProject ? { project: state.activeProject, level: state.activeLevel, status: state.status, accumulatedBaseMs: state.accumulatedBaseMs ?? 0, projectedCompletionAt: state.projectedCompletionAt } : null, speed, rules: RESEARCH_RULES };
  },
});

export const start = mutation({
  args: { project: projectKey },
  handler: async (ctx, args) => {
    const current = await requireCurrentPlayer(ctx);
    const { player } = await settlePlayerEconomy(ctx, current);
    let state = await researchForPlayer(ctx, player._id);
    if (state?.activeProject) throw new Error("Only one research project may be active at a time.");
    const key = args.project as ResearchProjectKey;
    const nextLevel = Math.max(0, state?.completedLevels[key] ?? 0) + 1;
    if (nextLevel > 3) throw new Error("This project is fully researched.");
    const rule = RESEARCH_RULES.projects[key];
    const monastery = player.buildings.ardentMonastery ?? 0;
    if (monastery < nextLevel) throw new Error(`Ardent Monastery level ${nextLevel} is required.`);
    const speed = await researchSpeed(ctx, player);
    const ancient = rule.ancient[nextLevel - 1];
    if (speed.ancientCount < ancient) throw new Error(`${ancient} Ancient Plateau${ancient === 1 ? " is" : "s are"} required.`);
    const spheres = RESEARCH_RULES.sphereCosts[nextLevel - 1];
    const gemhearts = rule.gemhearts[nextLevel - 1];
    if (player.spheres < spheres) throw new Error(`Not enough spheres. Need ${spheres}.`);
    if (player.gemhearts < gemhearts) throw new Error(`Not enough Gemhearts. Need ${gemhearts}.`);
    const now = Date.now();
    const duration = RESEARCH_RULES.durationsMs[nextLevel - 1];
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

export const completeActive = internalMutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => await reconcileResearch(ctx, args.playerId),
});
