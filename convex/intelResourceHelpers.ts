import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { ESPIONAGE_RULES, legacyReportIntelAmount, type EspionageCategory } from "./espionageRules";

export function categoryIntelAmount(
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

export async function intelResource(ctx: MutationCtx | QueryCtx, viewerPlayerId: Id<"players">, targetPlayerId: Id<"players">) {
  return await ctx.db.query("kingdomIntelResources")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) => q.eq("viewerPlayerId", viewerPlayerId).eq("targetPlayerId", targetPlayerId))
    .unique();
}

