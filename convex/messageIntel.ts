import { chasmfiendIntel, intelText, presentIntelNumber, watchtowerTerritoryLevel, ledgerMilitaryLevel } from "./intelligenceRules";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Older reports stored unrestricted enemy numbers in prose. Apply the same
// disclosure policy when reading them without rewriting the historical record.
export function discloseLegacyNeutralText(body: string, watchtower: number) {
  const level = watchtowerTerritoryLevel(watchtower);
  return body
    .replace(/A (\d+(?:\.\d+)?)-Power Parshendi force/g, (_, power) =>
      `A Parshendi force (Power: ${intelText(presentIntelNumber(Number(power), level))})`)
    .replace(/raising neutral defense to (\d+(?:\.\d+)?) Power/g, (_, power) =>
      `raising neutral defense to ${intelText(presentIntelNumber(Number(power), level))} Power`)
    .replace(/combined Power [\d.]+ (?:did not reach|defeated) the Chasmfiend's ([\d.]+) Power/g, (_, power) =>
      `Chasmfiend Power ${intelText(chasmfiendIntel(Number(power), level))}`);
}

export async function discloseStoredMessage(ctx: QueryCtx, player: Doc<"players">, message: {
  body: string; eventType?: string; entityType?: string; entityId?: string;
}) {
  let body = discloseLegacyNeutralText(message.body, player.buildings.watchtower ?? 0);
  if (!/Enemy casualties:|Enemy losses are estimated|Military Intel assessment:/.test(body)) return body;
  const siegeId = message.entityId && ctx.db.normalizeId("sieges", message.entityId);
  const raidId = message.entityId && ctx.db.normalizeId("raids", message.entityId);
  const siege = siegeId ? await ctx.db.get(siegeId) : null;
  const raid = !siege && raidId ? await ctx.db.get(raidId) : null;
  const targetId = siege ? (siege.attackerId === player._id ? siege.defenderId : siege.attackerId)
    : raid ? (raid.attackerId === player._id ? raid.targetPlayerId : raid.attackerId) : undefined;
  const resource = targetId ? await ctx.db.query("kingdomIntelResources")
    .withIndex("by_viewerPlayerId_and_targetPlayerId", q => q.eq("viewerPlayerId", player._id).eq("targetPlayerId", targetId)).unique() : null;
  const level = ledgerMilitaryLevel(resource?.militaryAmount ?? resource?.amount ?? 0);
  if (level >= 3) return body;
  body = body.replace(/Military Intel assessment: ([^.]+)\./g, (_, assessment: string) => {
    const exact = assessment.match(/\(([\d.]+) Power snapshot\)/);
    if (exact) return `Military Intel assessment: ${intelText(presentIntelNumber(Number(exact[1]), level))}.`;
    return level === 0 ? `Military Intel assessment: ${assessment.split(" (")[0]}.` : `Military Intel assessment: ${assessment}.`;
  });
  body = body.replace(/Enemy casualties: ([^.]+)\./g, (_, casualties: string) => {
    const total = (casualties.match(/\d+/g) ?? []).reduce((sum, count) => sum + Number(count), 0);
    if (level === 0) return `Enemy losses: ${total === 0 ? "none confirmed" : total <= 5 ? "light" : total <= 20 ? "moderate" : "heavy"}.`;
    const radius = Math.max(2, Math.ceil(total * 0.25));
    return `Enemy losses are estimated at ${Math.max(0, total - radius)}–${total + radius} units.`;
  });
  if (level === 0) body = body.replace(/Enemy losses are estimated at [^.]+\./g, "Enemy losses: unconfirmed.");
  return body;
}
