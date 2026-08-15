import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { casualtySummary, effectivePower } from "./rules";
import { effectiveIntelLevel, watchtowerCounterIntelligence } from "./intelligenceRules";

type ReportSource =
  | "player_raid"
  | "neutral_expedition"
  | "watchtower"
  | "ardent";

export async function currentKingdomIntelLevel(
  ctx: MutationCtx,
  viewerPlayerId: Id<"players">,
  target: Doc<"players">,
  now: number,
) {
  const report = await ctx.db
    .query("intelligenceReports")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) =>
      q.eq("viewerPlayerId", viewerPlayerId).eq("targetPlayerId", target._id),
    )
    .unique();
  if (!report) return 0;
  return Math.max(
    0,
    effectiveIntelLevel(report.level, report.observedAt, now) -
      watchtowerCounterIntelligence(target.buildings.watchtower ?? 0),
  );
}

export function casualtyIntelSummary(
  casualties: Record<string, number>,
  level: number,
) {
  const total = Object.values(casualties).reduce((sum, count) => sum + Number(count || 0), 0);
  if (level <= 0) return "Enemy casualties could not be confirmed.";
  if (level === 1) {
    const label = total === 0 ? "no visible" : total <= 5 ? "light" : total <= 20 ? "moderate" : "heavy";
    return `Observers report ${label} enemy losses.`;
  }
  if (level === 2) {
    const radius = Math.max(2, Math.ceil(total * 0.25));
    return `Enemy losses are estimated at ${Math.max(0, total - radius)}–${total + radius} units.`;
  }
  return `Enemy casualties: ${casualtySummary(casualties)}.`;
}

export async function recordKingdomReport(
  ctx: MutationCtx,
  args: {
    viewerPlayerId: Id<"players">;
    target: Doc<"players">;
    source: ReportSource;
    level: number;
    observedAt: number;
  },
) {
  const existing = await ctx.db
    .query("intelligenceReports")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) =>
      q.eq("viewerPlayerId", args.viewerPlayerId).eq("targetPlayerId", args.target._id),
    )
    .unique();
  const report = {
    viewerPlayerId: args.viewerPlayerId,
    targetType: "kingdom" as const,
    targetPlayerId: args.target._id,
    source: args.source,
    level: Math.max(0, Math.min(5, Math.floor(args.level))),
    observedAt: args.observedAt,
    militaryPower: effectivePower(args.target.units),
    sphereStockpile: args.target.spheres,
  };
  if (existing) {
    await ctx.db.patch(existing._id, report);
    return existing._id;
  }
  return await ctx.db.insert("intelligenceReports", report);
}

export async function recordTerritoryReport(
  ctx: MutationCtx,
  args: {
    viewerPlayerId: Id<"players">;
    plateau: Doc<"plateaus">;
    source: ReportSource;
    level: number;
    observedAt: number;
  },
) {
  const existing = await ctx.db
    .query("intelligenceReports")
    .withIndex("by_viewerPlayerId_and_plateauId", (q) =>
      q.eq("viewerPlayerId", args.viewerPlayerId).eq("plateauId", args.plateau._id),
    )
    .unique();
  const research = await ctx.db.query("playerResearch").withIndex("by_playerId", (q) => q.eq("playerId", args.viewerPlayerId)).unique();
  const sprenLevel = Math.floor(research?.completedLevels.sprenStudies ?? 0);
  const seed = `${args.viewerPlayerId}:${args.plateau._id}:${args.observedAt}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  const discovered = sprenLevel >= 2 && (hash >>> 0) / 4294967296 < 0.25;
  const bonusFacts = [
    { kind: "resistance", text: `An unusual cluster of spren marks the resistance precisely: ${args.plateau.neutralDefenseRemaining} Power.` },
    { kind: "terrain", text: `Spren repeatedly gather around the ${args.plateau.highground ? "high approaches" : "lower approaches"}; the plateau ${args.plateau.large ? "is unusually large" : "is of ordinary size"}.` },
    { kind: "identity", text: `The pattern resolves around a ${args.plateau.type.replaceAll("_", " ")} plateau.` },
  ];
  const bonus = discovered ? bonusFacts[(hash >>> 8) % bonusFacts.length] : undefined;
  const report = {
    viewerPlayerId: args.viewerPlayerId,
    targetType: "territory" as const,
    plateauId: args.plateau._id,
    source: args.source,
    level: Math.max(0, Math.min(5, Math.floor(args.level))),
    observedAt: args.observedAt,
    resistance: args.plateau.neutralDefenseRemaining,
    plateauType: args.plateau.type,
    highground: args.plateau.highground,
    large: Boolean(args.plateau.large),
    ...(bonus ? { bonusFactKind: bonus.kind, bonusFactText: bonus.text, bonusObservedAt: args.observedAt } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, report);
    return existing._id;
  }
  return await ctx.db.insert("intelligenceReports", report);
}
