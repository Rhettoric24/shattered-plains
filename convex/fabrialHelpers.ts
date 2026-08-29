import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { createNotification } from "./notificationHelpers";
import { FABRIAL_RULES, reusableFabrialLost, type FabrialKey, type ReusableOutcome } from "./fabrialRules";

type ReadCtx = QueryCtx | MutationCtx;

const DISCOVERY_REQUIREMENTS: Record<FabrialKey, (levels: Record<string, number>) => boolean> = {
  painrial: (levels) => (levels.painrialMedicine ?? 0) >= 2 && (levels.sprenStudies ?? 0) >= 2,
  soulcaster: (levels) => (levels.soulcasting ?? 0) >= 2 && (levels.gemCutting ?? 0) >= 2 && (levels.sprenStudies ?? 0) >= 2,
  halfShard: (levels) => (levels.soulcastArmor ?? 0) >= 2 && (levels.siegeEngineering ?? 0) >= 2 && (levels.sprenStudies ?? 0) >= 3,
};

export async function fabrialInventoryRow(ctx: ReadCtx, playerId: Id<"players">, kind: FabrialKey) {
  return await ctx.db.query("playerFabrials")
    .withIndex("by_playerId_and_kind", (q) => q.eq("playerId", playerId).eq("kind", kind))
    .unique();
}

export async function evaluateFabrialDiscoveries(
  ctx: MutationCtx,
  playerId: Id<"players">,
  completedLevels: Record<string, number>,
  now = Date.now(),
) {
  const discovered: FabrialKey[] = [];
  for (const kind of Object.keys(DISCOVERY_REQUIREMENTS) as FabrialKey[]) {
    if (!DISCOVERY_REQUIREMENTS[kind](completedLevels)) continue;
    const existing = await fabrialInventoryRow(ctx, playerId, kind);
    if (existing) continue;
    const rule = FABRIAL_RULES[kind];
    const id = await ctx.db.insert("playerFabrials", {
      playerId, kind, owned: 1, committed: 0,
      discoveredAt: now, prototypeGrantedAt: now, createdAt: now, updatedAt: now,
    });
    const body = `Breakthrough: Your scholars have discovered the principles behind ${rule.name}s. One prototype has been placed in your Fabrial inventory.`;
    await ctx.db.insert("messages", {
      toPlayerId: playerId, kind: "system", subject: `Breakthrough: ${rule.name}`,
      body, eventType: "fabrial_discovered", destinationView: "research", destinationTab: "fabrials",
      entityType: "fabrial", entityId: String(id), createdAt: now,
    });
    await createNotification(ctx, {
      playerId, category: "research", eventType: "fabrial_discovered", title: `Breakthrough: ${rule.name}`,
      body, destinationView: "research", destinationTab: "fabrials", entityId: String(id),
      dedupeKey: `fabrial:${playerId}:${kind}:discovered`, createdAt: now,
    });
    discovered.push(kind);
  }
  return discovered;
}

export async function reserveFabrial(ctx: MutationCtx, playerId: Id<"players">, kind: FabrialKey | undefined, now = Date.now()) {
  if (!kind) return;
  const row = await fabrialInventoryRow(ctx, playerId, kind);
  if (!row) throw new Error("That Fabrial has not been discovered.");
  if (row.owned - row.committed < 1) throw new Error(`No ${FABRIAL_RULES[kind].name} is currently available.`);
  if (FABRIAL_RULES[kind].reusable) {
    await ctx.db.patch(row._id, { committed: row.committed + 1, updatedAt: now });
  } else {
    await ctx.db.patch(row._id, { owned: row.owned - 1, updatedAt: now });
  }
}

export async function settleReusableFabrial(
  ctx: MutationCtx,
  playerId: Id<"players">,
  kind: FabrialKey | undefined,
  outcome: ReusableOutcome,
  seed: string,
  now = Date.now(),
) {
  if (!kind || !FABRIAL_RULES[kind].reusable) return { lost: false };
  const row = await fabrialInventoryRow(ctx, playerId, kind);
  if (!row || row.committed < 1) return { lost: false };
  const lost = reusableFabrialLost(outcome, seed);
  await ctx.db.patch(row._id, {
    committed: Math.max(0, row.committed - 1),
    owned: Math.max(0, row.owned - (lost ? 1 : 0)),
    updatedAt: now,
  });
  return { lost };
}

export function publicInventory(row: Doc<"playerFabrials">) {
  return { kind: row.kind, owned: row.owned, committed: row.committed, available: Math.max(0, row.owned - row.committed), discoveredAt: row.discoveredAt };
}
