import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import {
  effectiveIntelLevel,
  intelligenceFreshness,
  INTELLIGENCE_DECAY_STEP_MS,
  presentIntelNumber,
  watchtowerCounterIntelligence,
  watchtowerTerritoryLevel,
} from "./intelligenceRules";

export const listDossiers = query({
  args: {},
  returns: v.object({
    kingdoms: v.array(v.any()),
    territories: v.array(v.any()),
    decayStepMs: v.number(),
    generatedAt: v.number(),
    watchtower: v.object({
      level: v.number(),
      territoryLevel: v.number(),
      counterIntelligence: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const now = Date.now();
    const watchtowerLevel = Math.min(3, viewer.buildings.watchtower ?? 0);
    const passiveTerritoryLevel = watchtowerTerritoryLevel(watchtowerLevel);
    const kingdomReports = await ctx.db
      .query("intelligenceReports")
      .withIndex("by_viewerPlayerId_and_targetType", (q) =>
        q.eq("viewerPlayerId", viewer._id).eq("targetType", "kingdom"),
      )
      .order("desc")
      .take(100);
    const territoryReports = await ctx.db
      .query("intelligenceReports")
      .withIndex("by_viewerPlayerId_and_targetType", (q) =>
        q.eq("viewerPlayerId", viewer._id).eq("targetType", "territory"),
      )
      .order("desc")
      .take(100);

    const kingdoms = await Promise.all(kingdomReports.map(async (report) => {
      const target = report.targetPlayerId ? await ctx.db.get(report.targetPlayerId) : null;
        const counterIntelligence = watchtowerCounterIntelligence(target?.buildings.watchtower ?? 0);
        const level = Math.max(
          0,
          effectiveIntelLevel(report.level, report.observedAt, now) - counterIntelligence,
        );
      return {
          targetName: target?.name ?? "Unknown warcamp",
        source: report.source,
        observedAt: report.observedAt,
        effectiveLevel: level,
          freshness: intelligenceFreshness(report.observedAt, now),
          militaryPower: presentIntelNumber(report.militaryPower, level),
      };
    }));
    const territories = await Promise.all(territoryReports.map(async (report) => {
      const plateau = report.plateauId ? await ctx.db.get(report.plateauId) : null;
        const level = Math.max(
          passiveTerritoryLevel,
          effectiveIntelLevel(report.level, report.observedAt, now),
        );
      return {
        plateauId: plateau?._id ?? report.plateauId ?? null,
        targetName: plateau?.name ?? "Unknown plateau",
        source: report.source,
        observedAt: report.observedAt,
        effectiveLevel: level,
          freshness: intelligenceFreshness(report.observedAt, now),
          resistance: presentIntelNumber(report.resistance, level),
        plateauType: report.plateauType ?? null,
        highground: report.highground ?? false,
        large: report.large ?? false,
      };
    }));

    if (watchtowerLevel > 0) {
      const knownPlateauIds = new Set(territoryReports.map((report) => String(report.plateauId)));
      const neutral = await ctx.db
        .query("plateaus")
        .withIndex("by_status", (q) => q.eq("status", "neutral"))
        .take(100);
      for (const plateau of neutral) {
        if (knownPlateauIds.has(String(plateau._id))) continue;
        territories.push({
          plateauId: plateau._id,
          targetName: plateau.name,
          source: "watchtower" as const,
          observedAt: now,
          effectiveLevel: passiveTerritoryLevel,
          freshness: "fresh" as const,
          resistance: presentIntelNumber(plateau.neutralDefenseRemaining, passiveTerritoryLevel),
          plateauType: plateau.type,
          highground: plateau.highground,
          large: plateau.large ?? false,
        });
      }
    }

    return {
      kingdoms,
      territories,
      decayStepMs: INTELLIGENCE_DECAY_STEP_MS,
      generatedAt: now,
      watchtower: {
        level: watchtowerLevel,
        territoryLevel: passiveTerritoryLevel,
        counterIntelligence: watchtowerCounterIntelligence(watchtowerLevel),
      },
    };
  },
});
