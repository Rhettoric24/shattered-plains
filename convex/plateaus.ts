import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./admin";
import { requireCurrentPlayer } from "./ownership";
import {
  createNeutralPlateaus,
  createStarterPlateaus,
  neutralPlateaus,
  ownedPlateaus,
  plateauCountsForPlayer,
  plateauTypeName,
  plateauTypes,
} from "./plateauHelpers";
import {
  applySurvivalLosses,
  casualtySummary,
  emergencyDefenseCost,
  effectivePower,
  emptyUnits,
  normalizeUnits,
  PLATEAU_RULES,
  STARTING_RULES,
  TIME_RULES,
  totalUnits,
  UNIT_RULES,
  unitSpeed,
  type UnitCounts,
  type UnitKey,
} from "./rules";

const unitCounts = v.object({
  bridgeman: v.number(),
  spearman: v.number(),
  chull: v.optional(v.number()),
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

function cleanUnits(units: UnitCounts) {
  return normalizeUnits(units);
}

function subtractUnits(available: UnitCounts, requested: UnitCounts) {
  const normalizedAvailable = normalizeUnits(available);
  const normalizedRequested = normalizeUnits(requested);
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (normalizedRequested[key] > normalizedAvailable[key]) {
      throw new Error(`Not enough ${UNIT_RULES[key].name}s available.`);
    }
  }

  const remaining = { ...normalizedAvailable };
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    remaining[key] -= normalizedRequested[key];
  }
  return remaining;
}

function addUnits(current: UnitCounts, returned: UnitCounts) {
  const next = normalizeUnits(current);
  const normalizedReturned = normalizeUnits(returned);
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    next[key] += normalizedReturned[key];
  }
  return next;
}

function applyLossRate(units: UnitCounts, lossRate: number, seed: string) {
  return applySurvivalLosses(
    normalizeUnits(units),
    Math.ceil(totalUnits(units) * lossRate),
    seed,
  );
}

function validateUnlockedUnits(buildings: { barracks: number }, units: UnitCounts) {
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (units[key] > 0 && !UNIT_RULES[key].active) {
      throw new Error(`${UNIT_RULES[key].name} is inactive for new actions.`);
    }
    if (units[key] > 0 && buildings.barracks < UNIT_RULES[key].barracksLevel) {
      throw new Error(
        `${UNIT_RULES[key].name} requires Barracks level ${UNIT_RULES[key].barracksLevel}.`,
      );
    }
  }
}

function committedDefensePower(
  defenderUnits: UnitCounts,
  plateau: any,
  emergencyDefensePercent: number,
) {
  const highgroundBonus = plateau.highground
    ? 1 + PLATEAU_RULES.highgroundDefenseBonus
    : 1;
  const emergencyBonus = 1 + emergencyDefensePercent / 100;
  return effectivePower(defenderUnits) * highgroundBonus * emergencyBonus;
}

function committedDefenseBasePower(defenderUnits: UnitCounts, plateau: any) {
  const highgroundBonus = plateau.highground
    ? 1 + PLATEAU_RULES.highgroundDefenseBonus
    : 1;
  return effectivePower(defenderUnits) * highgroundBonus;
}

function siegeTravelMs() {
  return TIME_RULES.raidTravelGameDays * TIME_RULES.realMsPerGameDay;
}

async function purchaseEmergencyDefense(
  ctx: MutationCtx,
  args: { siegeId: Id<"sieges">; percent: number },
) {
  const defender = await requireCurrentPlayer(ctx);
  const siege = await ctx.db.get(args.siegeId);
  if (!siege || siege.status !== "pending" || siege.targetType !== "player") {
    throw new Error("Choose an active player siege.");
  }
  if (siege.defenderId !== defender._id) {
    throw new Error("Only the defender can prepare emergency defenses.");
  }
  if (Date.now() >= siege.resolveAt) {
    throw new Error("This siege is already resolving.");
  }

  const currentPercent = Math.max(0, siege.emergencyDefensePercent ?? 0);
  const targetPercent = Math.max(
    0,
    Math.min(PLATEAU_RULES.emergencyDefenseMaxPercent, Math.floor(args.percent)),
  );
  if (targetPercent < currentPercent) {
    throw new Error("Emergency Defenses cannot be reduced once purchased.");
  }
  if (targetPercent === currentPercent) {
    return {
      emergencyDefensePercent: currentPercent,
      cost: 0,
    };
  }

  const cost =
    emergencyDefenseCost(targetPercent) - emergencyDefenseCost(currentPercent);
  if (defender.spheres < cost) {
    throw new Error(`Not enough spheres. Need ${cost}.`);
  }

  const now = Date.now();
  await ctx.db.patch(defender._id, {
    spheres: defender.spheres - cost,
    lastActiveAt: now,
  });
  await ctx.db.patch(siege._id, {
    emergencyDefensePercent: targetPercent,
    emergencyDefenseSpheresSpent:
      (siege.emergencyDefenseSpheresSpent ?? 0) + cost,
  });

  return {
    emergencyDefensePercent: targetPercent,
    cost,
  };
}

export const listPlateaus = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);
    const mine = await ownedPlateaus(ctx, viewer._id);
    const neutral = await neutralPlateaus(ctx);
    const allOwned = await ctx.db
      .query("plateaus")
      .withIndex("by_status", (q) => q.eq("status", "owned"))
      .take(200);
    const players = await ctx.db.query("players").take(200);
    const playerNames = Object.fromEntries(
      players.map((player) => [player._id, player.name]),
    );
    const activeSieges = await ctx.db
      .query("sieges")
      .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
      .take(200);

    return {
      types: plateauTypes(),
      counts: await plateauCountsForPlayer(ctx, viewer._id),
      mine,
      neutral: neutral.filter((plateau) => !plateau.activeSiegeId),
      rivals: allOwned
        .filter((plateau) => plateau.ownerPlayerId !== viewer._id)
        .map((plateau) => ({
          ...plateau,
          ownerName: plateau.ownerPlayerId
            ? playerNames[plateau.ownerPlayerId] ?? "Unknown"
            : "Neutral",
        })),
      sieges: activeSieges.map((siege) => ({
        ...siege,
        attackerName: playerNames[siege.attackerId] ?? "Unknown",
        defenderName: siege.defenderId
          ? playerNames[siege.defenderId] ?? "Unknown"
          : "Parshendi",
      })),
    };
  },
});

export const launchNeutralSiege = mutation({
  args: {
    plateauId: v.id("plateaus"),
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    const plateau = await ctx.db.get(args.plateauId);
    if (!plateau || plateau.status !== "neutral") {
      throw new Error("Choose an available neutral plateau.");
    }
    if (plateau.activeSiegeId) {
      throw new Error("That plateau is already under siege.");
    }

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Send at least one unit.");
    validateUnlockedUnits(attacker.buildings, units);

    const now = Date.now();
    const resolveAt = now + siegeTravelMs();
    const remainingUnits = subtractUnits(attacker.units, units);
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      targetType: "neutral",
      attackerUnits: units,
      attackerPower: effectivePower(units),
      attackerSpeed: unitSpeed(units),
      fortifyPercent: 0,
      emergencyDefensePercent: 0,
      emergencyDefenseSpheresSpent: 0,
      departAt: now,
      resolveAt,
      status: "pending",
    });

    await ctx.db.patch(attacker._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(plateau._id, {
      activeSiegeId: siegeId,
      updatedAt: now,
    });
    await ctx.db.insert("gameEvents", {
      text: `${attacker.name} launched an expedition toward a neutral plateau.`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiege, {
      siegeId,
    });

    return { siegeId, resolveAt };
  },
});

export const launchPlayerSiege = mutation({
  args: {
    plateauId: v.id("plateaus"),
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    const plateau = await ctx.db.get(args.plateauId);
    if (!plateau || plateau.status !== "owned" || !plateau.ownerPlayerId) {
      throw new Error("Choose an owned enemy plateau.");
    }
    if (plateau.ownerPlayerId === attacker._id) {
      throw new Error("You cannot siege your own plateau.");
    }
    if (plateau.activeSiegeId) {
      throw new Error("That plateau is already under siege.");
    }

    const defender = await ctx.db.get(plateau.ownerPlayerId);
    if (!defender) throw new Error("Defender not found.");

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Send at least one unit.");
    validateUnlockedUnits(attacker.buildings, units);

    const now = Date.now();
    const resolveAt = now + siegeTravelMs();
    const remainingUnits = subtractUnits(attacker.units, units);
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      defenderId: defender._id,
      targetType: "player",
      attackerUnits: units,
      attackerPower: effectivePower(units),
      attackerSpeed: unitSpeed(units),
      defenderUnits: emptyUnits(),
      defenderPower: 0,
      defenderSpeed: 0,
      fortifyPercent: 0,
      emergencyDefensePercent: 0,
      emergencyDefenseSpheresSpent: 0,
      departAt: now,
      resolveAt,
      status: "pending",
    });

    await ctx.db.patch(attacker._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(plateau._id, {
      activeSiegeId: siegeId,
      updatedAt: now,
    });
    await ctx.db.insert("messages", {
      toPlayerId: defender._id,
      kind: "system",
      subject: "Plateau Siege",
      body: `${attacker.name} has started a siege against ${plateau.name}.`,
      createdAt: now,
    });
    await ctx.db.insert("gameEvents", {
      text: `${attacker.name} started a siege against ${defender.name}.`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiege, {
      siegeId,
    });

    return { siegeId, resolveAt };
  },
});

export const commitSiegeDefenders = mutation({
  args: {
    siegeId: v.id("sieges"),
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const defender = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || siege.targetType !== "player") {
      throw new Error("Choose an active player siege.");
    }
    if (siege.defenderId !== defender._id) {
      throw new Error("Only the defender can commit to this siege.");
    }
    if (Date.now() >= siege.resolveAt) {
      throw new Error("This siege is already resolving.");
    }
    if (siege.defenderCommittedAt) {
      throw new Error("Defenders are already committed to this siege.");
    }

    const units = cleanUnits(args.units);
    if (totalUnits(units) < 1) throw new Error("Commit at least one unit.");
    validateUnlockedUnits(defender.buildings, units);
    const remainingUnits = subtractUnits(defender.units, units);
    const now = Date.now();

    await ctx.db.patch(defender._id, {
      units: remainingUnits,
      lastActiveAt: now,
    });
    await ctx.db.patch(siege._id, {
      defenderUnits: units,
      defenderPower: effectivePower(units),
      defenderSpeed: unitSpeed(units),
      defenderCommittedAt: now,
    });

    return {
      committed: true,
      defenderPower: effectivePower(units),
      defenderSpeed: unitSpeed(units),
    };
  },
});

export const setEmergencyDefense = mutation({
  args: {
    siegeId: v.id("sieges"),
    percent: v.number(),
  },
  handler: async (ctx, args) => {
    return await purchaseEmergencyDefense(ctx, args);
  },
});

export const fortifySiege = mutation({
  args: {
    siegeId: v.id("sieges"),
    percent: v.number(),
  },
  handler: async (ctx, args) => {
    return await purchaseEmergencyDefense(ctx, args);
  },
});

export const forceResolveSiege = mutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
      siegeId: args.siegeId,
    });
    return { scheduled: true };
  },
});

export const forceResolveAllSieges = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("sieges")
      .withIndex("by_status_resolve", (q) => q.eq("status", "pending"))
      .take(100);

    for (const siege of pending) {
      await ctx.scheduler.runAfter(0, internal.plateaus.resolveSiege, {
        siegeId: siege._id,
      });
    }

    return { scheduled: pending.length };
  },
});

export const retreatSiege = mutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending") {
      throw new Error("Choose an active siege.");
    }
    throw new Error("Withdrawals are disabled for active sieges.");
  },
});

export const backfillPlateaus = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const players = await ctx.db.query("players").take(200);
    let starterCreated = 0;
    for (const player of players) {
      starterCreated += await createStarterPlateaus(ctx, player._id, now);
    }
    const neutral = await neutralPlateaus(ctx);
    const targetNeutral = players.length * STARTING_RULES.neutralPlateausPerNewPlayer;
    const neutralCreated =
      neutral.length >= targetNeutral
        ? 0
        : await createNeutralPlateaus(ctx, targetNeutral - neutral.length, now);

    await ctx.db.insert("gameEvents", {
      text: `Plateau backfill created ${starterCreated} starter plateaus and ${neutralCreated} neutral plateaus.`,
      createdAt: now,
    });

    return { starterCreated, neutralCreated };
  },
});

export const resolveSiege = internalMutation({
  args: {
    siegeId: v.id("sieges"),
  },
  handler: async (ctx, args) => {
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending") return { resolved: false };

    const plateau = await ctx.db.get(siege.plateauId);
    const attacker = await ctx.db.get(siege.attackerId);
    if (!plateau || !attacker) {
      if (siege) {
        await ctx.db.patch(siege._id, {
          status: "resolved",
          resolvedAt: Date.now(),
        });
      }
      return { resolved: false };
    }

    const now = Date.now();
    let won = false;
    let resultText = "";
    let survivors = siege.attackerUnits;

    if (siege.targetType === "neutral") {
      won = siege.attackerPower >= plateau.neutralDefenseRemaining;
      const lossResult = applyLossRate(
        siege.attackerUnits,
        won ? PLATEAU_RULES.neutralWinLossRate : PLATEAU_RULES.neutralLossLossRate,
        `${siege._id}:neutral:${now}`,
      );
      survivors = lossResult.survivors;

      if (won) {
        await ctx.db.patch(plateau._id, {
          status: "owned",
          ownerPlayerId: attacker._id,
          neutralDefenseRemaining: 0,
          heldSince: now,
          lastGemheartAt: now,
          activeSiegeId: undefined,
          updatedAt: now,
        });
        resultText = `${attacker.name} claimed ${plateauTypeName(plateau.type)}. Attack Power ${siege.attackerPower}, Defense Power ${plateau.neutralDefenseRemaining}. Casualties: ${casualtySummary(lossResult.casualties)}.`;
      } else {
        await ctx.db.patch(plateau._id, {
          neutralDefenseRemaining: Math.max(
            1,
            plateau.neutralDefenseRemaining - siege.attackerPower,
          ),
          activeSiegeId: undefined,
          updatedAt: now,
        });
        resultText = `${attacker.name} weakened the Parshendi defense on a neutral plateau. Attack Power ${siege.attackerPower}, Defense Power ${plateau.neutralDefenseRemaining}. Casualties: ${casualtySummary(lossResult.casualties)}.`;
      }

      await ctx.db.patch(attacker._id, {
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
    }

    if (siege.targetType === "player") {
      const defender = siege.defenderId ? await ctx.db.get(siege.defenderId) : null;
      if (!defender) {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, siege.attackerUnits),
          lastActiveAt: now,
        });
        resultText = `${attacker.name}'s siege found no defender.`;
      } else {
        const defenderUnits = normalizeUnits(siege.defenderUnits ?? emptyUnits());
        const emergencyDefensePercent = siege.emergencyDefensePercent ?? 0;
        const defenderBasePower = committedDefenseBasePower(
          defenderUnits,
          plateau,
        );
        const defenderPower = committedDefensePower(
          defenderUnits,
          plateau,
          emergencyDefensePercent,
        );
        won = siege.attackerPower > defenderPower;
        const attackerLossResult = applyLossRate(
          siege.attackerUnits,
          won
            ? PLATEAU_RULES.siegeWinAttackerLossRate
            : PLATEAU_RULES.siegeLossAttackerLossRate,
          `${siege._id}:player:attacker:${now}`,
        );
        survivors = attackerLossResult.survivors;
        const defenderLossResult = applyLossRate(
          defenderUnits,
          won
            ? PLATEAU_RULES.siegeWinDefenderLossRate
            : PLATEAU_RULES.siegeLossDefenderLossRate,
          `${siege._id}:player:defender:${now}`,
        );

        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        await ctx.db.patch(defender._id, {
          units: addUnits(defender.units, defenderLossResult.survivors),
          lastActiveAt: now,
        });

        if (won) {
          await ctx.db.patch(plateau._id, {
            ownerPlayerId: attacker._id,
            heldSince: now,
            lastGemheartAt: now,
            activeSiegeId: undefined,
            updatedAt: now,
          });
          resultText = `${attacker.name} captured ${plateau.name} from ${defender.name}. Attack Power ${siege.attackerPower}, Committed Defense Power ${defenderBasePower}, Emergency Defenses +${emergencyDefensePercent}%, Final Defense ${defenderPower}. Attacker casualties: ${casualtySummary(attackerLossResult.casualties)}. Defender casualties: ${casualtySummary(defenderLossResult.casualties)}.`;
        } else {
          await ctx.db.patch(plateau._id, {
            activeSiegeId: undefined,
            updatedAt: now,
          });
          resultText = `${defender.name} held ${plateau.name} against ${attacker.name}. Attack Power ${siege.attackerPower}, Committed Defense Power ${defenderBasePower}, Emergency Defenses +${emergencyDefensePercent}%, Final Defense ${defenderPower}. Attacker casualties: ${casualtySummary(attackerLossResult.casualties)}. Defender casualties: ${casualtySummary(defenderLossResult.casualties)}.`;
        }

        await ctx.db.insert("messages", {
          toPlayerId: defender._id,
          kind: "system",
          subject: won ? "Plateau Lost" : "Siege Held",
          body: resultText,
          createdAt: now,
        });
      }
    }

    await ctx.db.patch(siege._id, {
      status: "resolved",
      resolvedAt: now,
    });
    await ctx.db.insert("messages", {
      toPlayerId: attacker._id,
      kind: "system",
      subject: won ? "Siege Won" : "Siege Resolved",
      body: resultText,
      createdAt: now,
    });
    await ctx.db.insert("gameEvents", {
      text: resultText,
      createdAt: now,
    });

    return { resolved: true, won, resultText };
  },
});
