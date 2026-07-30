import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { effectivePower } from "./rules";

type ReportSource =
  | "player_raid"
  | "neutral_expedition"
  | "watchtower"
  | "ardent";

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
  };
  if (existing) {
    await ctx.db.patch(existing._id, report);
    return existing._id;
  }
  return await ctx.db.insert("intelligenceReports", report);
}
