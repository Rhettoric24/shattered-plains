import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  emptyPlateauCounts,
  PLATEAU_RULES,
  STARTING_RULES,
  type PlateauCounts,
  type PlateauType,
} from "./rules";

type Ctx = QueryCtx | MutationCtx;

const PLATEAU_TYPES: PlateauType[] = [
  "sphere",
  "training",
  "gemheart",
  "ancient_ruins",
];

const TYPE_NAMES: Record<PlateauType, string> = {
  sphere: "Sphere Plateau",
  training: "Training Plateau",
  gemheart: "Gemheart Plateau",
  ancient_ruins: "Ancient Ruins",
};

function seededInt(seed: string, min: number, max: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

function neutralType(seed: string) {
  const roll = seededInt(seed, 1, 100);
  if (roll <= 45) return "sphere";
  if (roll <= 70) return "training";
  if (roll <= 88) return "ancient_ruins";
  return "gemheart";
}

function neutralName(type: PlateauType, sequence: number) {
  return `${TYPE_NAMES[type]} ${sequence}`;
}

export function plateauTypeName(type: PlateauType) {
  return TYPE_NAMES[type];
}

export async function ownedPlateaus(ctx: Ctx, playerId: Id<"players">) {
  return await ctx.db
    .query("plateaus")
    .withIndex("by_owner", (q) => q.eq("ownerPlayerId", playerId))
    .take(100);
}

export async function neutralPlateaus(ctx: Ctx) {
  return await ctx.db
    .query("plateaus")
    .withIndex("by_status", (q) => q.eq("status", "neutral"))
    .take(200);
}

export async function plateauCountsForPlayer(
  ctx: Ctx,
  playerId: Id<"players">,
): Promise<PlateauCounts> {
  const counts = emptyPlateauCounts();
  const plateaus = await ownedPlateaus(ctx, playerId);
  for (const plateau of plateaus) {
    counts[plateau.type] += 1;
  }
  return counts;
}

export async function createStarterPlateaus(
  ctx: MutationCtx,
  playerId: Id<"players">,
  now: number,
) {
  const existing = await ownedPlateaus(ctx, playerId);
  if (existing.length > 0) return 0;

  for (let index = 0; index < STARTING_RULES.startingPlateaus; index += 1) {
    await ctx.db.insert("plateaus", {
      name: `Founding Sphere Plateau ${index + 1}`,
      type: "sphere",
      status: "owned",
      ownerPlayerId: playerId,
      highground: PLATEAU_RULES.starterHighground,
      neutralDefenseInitial: 0,
      neutralDefenseRemaining: 0,
      heldSince: now,
      lastGemheartAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return STARTING_RULES.startingPlateaus;
}

export async function createNeutralPlateaus(
  ctx: MutationCtx,
  count: number,
  now: number,
) {
  const existing = await neutralPlateaus(ctx);
  const start = existing.length + 1;

  for (let index = 0; index < count; index += 1) {
    const sequence = start + index;
    const seed = `${now}:neutral:${sequence}`;
    const type = neutralType(seed);
    const defense = seededInt(
      `${seed}:defense`,
      PLATEAU_RULES.neutralDefenseMin,
      PLATEAU_RULES.neutralDefenseMax,
    );
    const highground =
      seededInt(`${seed}:highground`, 1, 100) <=
      PLATEAU_RULES.neutralHighgroundChancePercent;

    await ctx.db.insert("plateaus", {
      name: neutralName(type, sequence),
      type,
      status: "neutral",
      highground,
      neutralDefenseInitial: defense,
      neutralDefenseRemaining: defense,
      createdAt: now,
      updatedAt: now,
    });
  }

  return count;
}

export async function grantGemheartPlateauIncome(
  ctx: MutationCtx,
  player: {
    _id: Id<"players">;
    gemhearts: number;
  },
  now: number,
) {
  const plateaus = await ownedPlateaus(ctx, player._id);
  let gemhearts = 0;

  for (const plateau of plateaus) {
    if (plateau.type !== "gemheart") continue;
    const last = plateau.lastGemheartAt ?? plateau.heldSince ?? plateau.updatedAt;
    const earned = Math.floor((now - last) / PLATEAU_RULES.gemheartIntervalMs);
    if (earned < 1) continue;
    gemhearts += earned;
    await ctx.db.patch(plateau._id, {
      lastGemheartAt: last + earned * PLATEAU_RULES.gemheartIntervalMs,
      updatedAt: now,
    });
  }

  return {
    gemhearts,
    totalGemhearts: player.gemhearts + gemhearts,
  };
}

export function plateauTypes() {
  return PLATEAU_TYPES.map((type) => ({
    key: type,
    name: TYPE_NAMES[type],
  }));
}
