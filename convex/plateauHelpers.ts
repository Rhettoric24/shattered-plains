import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  emptyPlateauCounts,
  identityPlateauType,
  homePlateauPackagesForPlayers,
  initialGemheartPlateauCount,
  PLATEAU_RULES,
  randomHomePlateauPackage,
  STARTING_RULES,
  type HomePlateauPackage,
  type PlateauCounts,
  type PlateauType,
} from "./rules";

type Ctx = QueryCtx | MutationCtx;

const PLATEAU_TYPES: PlateauType[] = [
  "sphere",
  "bridged",
  "gemheart",
  "ancient",
];

const TYPE_NAMES: Record<PlateauType, string> = {
  sphere: "Sphere Plateau",
  training: "Bridged Plateau",
  gemheart: "Gemheart Plateau",
  ancient_ruins: "Ancient Plateau",
  bridged: "Bridged Plateau",
  ancient: "Ancient Plateau",
};

function seededInt(seed: string, min: number, max: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

function neutralType(seed: string, allowGemheart: boolean) {
  const roll = seededInt(seed, 1, 100);
  if (allowGemheart && roll > 88) return "gemheart";
  if (roll <= 45) return "sphere";
  if (roll <= 72) return "bridged";
  return "ancient";
}

function neutralName(type: PlateauType, sequence: number) {
  return `${TYPE_NAMES[identityPlateauType(type)]} ${sequence}`;
}

export function plateauTypeName(type: PlateauType) {
  return TYPE_NAMES[identityPlateauType(type)];
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
    counts[identityPlateauType(plateau.type)] += 1;
  }
  return counts;
}

export async function plateauAttributeCountsForPlayer(
  ctx: Ctx,
  playerId: Id<"players">,
) {
  const plateaus = await ownedPlateaus(ctx, playerId);
  return {
    large: plateaus.filter((plateau) => Boolean(plateau.large)).length,
    highground: plateaus.filter((plateau) => Boolean(plateau.highground)).length,
  };
}

export async function createStarterPlateaus(
  ctx: MutationCtx,
  playerId: Id<"players">,
  now: number,
  packageTypes?: HomePlateauPackage,
) {
  const existing = await ownedPlateaus(ctx, playerId);
  if (existing.length > 0) return 0;
  const homePackage = packageTypes ?? randomHomePlateauPackage(`${playerId}:${now}`);

  for (let index = 0; index < homePackage.length; index += 1) {
    const type = identityPlateauType(homePackage[index]);
    await ctx.db.insert("plateaus", {
      name: `Home ${plateauTypeName(type)} ${index + 1}`,
      type,
      status: "owned",
      ownerPlayerId: playerId,
      origin: "home",
      highground: false,
      large: false,
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

export async function createBalancedHomePlateaus(
  ctx: MutationCtx,
  playerIds: Id<"players">[],
  now: number,
) {
  const packages = homePlateauPackagesForPlayers(playerIds.length, now);
  let created = 0;

  for (let index = 0; index < playerIds.length; index += 1) {
    created += await createStarterPlateaus(
      ctx,
      playerIds[index],
      now,
      packages[index],
    );
  }

  return {
    created,
    packages: packages.map((pkg) => pkg.map(identityPlateauType)),
  };
}

export async function createNeutralPlateaus(
  ctx: MutationCtx,
  count: number,
  now: number,
  options: { allowGemheart?: boolean } = {},
) {
  const existing = await neutralPlateaus(ctx);
  const start = existing.length + 1;
  const allowGemheart = options.allowGemheart ?? false;

  for (let index = 0; index < count; index += 1) {
    const sequence = start + index;
    const seed = `${now}:neutral:${sequence}`;
    const type = neutralType(seed, allowGemheart);
    const defense = seededInt(
      `${seed}:defense`,
      PLATEAU_RULES.neutralDefenseMin,
      PLATEAU_RULES.neutralDefenseMax,
    );
    const highground =
      seededInt(`${seed}:highground`, 1, 100) <=
      PLATEAU_RULES.neutralHighgroundChancePercent;
    const large =
      seededInt(`${seed}:large`, 1, 100) <=
      PLATEAU_RULES.neutralLargeChancePercent;

    await ctx.db.insert("plateaus", {
      name: neutralName(type, sequence),
      type,
      status: "neutral",
      origin: "neutral",
      highground,
      large,
      neutralDefenseInitial: defense,
      neutralDefenseRemaining: defense,
      createdAt: now,
      updatedAt: now,
    });
  }

  return count;
}

async function createSpecificNeutralPlateau(
  ctx: MutationCtx,
  type: PlateauType,
  sequence: number,
  now: number,
) {
  const seed = `${now}:neutral:${sequence}:${type}`;
  const defense = seededInt(
    `${seed}:defense`,
    PLATEAU_RULES.neutralDefenseMin,
    PLATEAU_RULES.neutralDefenseMax,
  );
  const highground =
    seededInt(`${seed}:highground`, 1, 100) <=
    PLATEAU_RULES.neutralHighgroundChancePercent;
  const large =
    seededInt(`${seed}:large`, 1, 100) <=
    PLATEAU_RULES.neutralLargeChancePercent;

  await ctx.db.insert("plateaus", {
    name: neutralName(type, sequence),
    type,
    status: "neutral",
    origin: "neutral",
    highground,
    large,
    neutralDefenseInitial: defense,
    neutralDefenseRemaining: defense,
    createdAt: now,
    updatedAt: now,
  });
}

export async function createSeasonNeutralPlateaus(
  ctx: MutationCtx,
  playerCount: number,
  now: number,
) {
  const totalNeutral = playerCount * STARTING_RULES.neutralPlateausPerNewPlayer;
  const gemhearts = Math.min(
    totalNeutral,
    initialGemheartPlateauCount(playerCount),
  );
  const existing = await neutralPlateaus(ctx);
  const start = existing.length + 1;

  for (let index = 0; index < gemhearts; index += 1) {
    await createSpecificNeutralPlateau(ctx, "gemheart", start + index, now);
  }

  const nonGemheartCreated = await createNeutralPlateaus(
    ctx,
    Math.max(0, totalNeutral - gemhearts),
    now,
    { allowGemheart: false },
  );

  return {
    totalNeutral,
    gemhearts,
    nonGemheartCreated,
  };
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
