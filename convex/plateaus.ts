import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
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
  COMBAT_RULES,
  effectivePower,
  emptyUnits,
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
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

function cleanUnits(units: UnitCounts) {
  const cleaned = emptyUnits();
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    cleaned[key] = Math.max(0, Math.floor(units[key] ?? 0));
  }
  return cleaned;
}

function travelMs(units: UnitCounts) {
  const baseMs = TIME_RULES.raidTravelGameDays * TIME_RULES.realMsPerGameDay;
  const divisor =
    1 + Math.max(0, unitSpeed(units)) * TIME_RULES.speedReductionPerPoint;
  return Math.max(60 * 1000, Math.round(baseMs / divisor));
}

function subtractUnits(available: UnitCounts, requested: UnitCounts) {
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (requested[key] > available[key]) {
      throw new Error(`Not enough ${UNIT_RULES[key].name}s available.`);
    }
  }

  const remaining = { ...available };
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    remaining[key] -= requested[key];
  }
  return remaining;
}

function addUnits(current: UnitCounts, returned: UnitCounts) {
  const next = { ...current };
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    next[key] += returned[key];
  }
  return next;
}

function applyLosses(units: UnitCounts, lossRate: number) {
  const survivors = { ...units };
  let losses = Math.ceil(totalUnits(survivors) * lossRate);

  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (losses <= 0) break;
    const lost = Math.min(survivors[key], losses);
    survivors[key] -= lost;
    losses -= lost;
  }

  return survivors;
}

function validateUnlockedUnits(buildings: { barracks: number }, units: UnitCounts) {
  for (const key of Object.keys(UNIT_RULES) as UnitKey[]) {
    if (units[key] > 0 && buildings.barracks < UNIT_RULES[key].barracksLevel) {
      throw new Error(
        `${UNIT_RULES[key].name} requires Barracks level ${UNIT_RULES[key].barracksLevel}.`,
      );
    }
  }
}

function targetDefensePower(defender: any, plateau: any, fortifyPercent: number) {
  const watchtowerBonus =
    1 + defender.buildings.watchtower * COMBAT_RULES.watchtowerDefensePerLevel;
  const highgroundBonus = plateau.highground
    ? 1 + PLATEAU_RULES.highgroundDefenseBonus
    : 1;
  const fortifyBonus = 1 + fortifyPercent / 100;
  return effectivePower(defender.units) * watchtowerBonus * highgroundBonus * fortifyBonus;
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
    const resolveAt = now + travelMs(units);
    const remainingUnits = subtractUnits(attacker.units, units);
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      targetType: "neutral",
      attackerUnits: units,
      attackerPower: effectivePower(units),
      attackerSpeed: unitSpeed(units),
      fortifyPercent: 0,
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
    const resolveAt = now + travelMs(units);
    const remainingUnits = subtractUnits(attacker.units, units);
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: plateau._id,
      attackerId: attacker._id,
      defenderId: defender._id,
      targetType: "player",
      attackerUnits: units,
      attackerPower: effectivePower(units),
      attackerSpeed: unitSpeed(units),
      fortifyPercent: 0,
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

export const fortifySiege = mutation({
  args: {
    siegeId: v.id("sieges"),
    percent: v.number(),
  },
  handler: async (ctx, args) => {
    const defender = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending" || siege.targetType !== "player") {
      throw new Error("Choose an active player siege.");
    }
    if (siege.defenderId !== defender._id) {
      throw new Error("Only the defender can fortify this siege.");
    }

    const requested = Math.max(1, Math.floor(args.percent));
    const availablePercent =
      PLATEAU_RULES.siegeFortifyMaxPercent - siege.fortifyPercent;
    const percent = Math.min(requested, availablePercent);
    if (percent < 1) throw new Error("This siege is already fully fortified.");

    const cost = percent * PLATEAU_RULES.siegeFortifySpheresPerPercent;
    if (defender.spheres < cost) {
      throw new Error(`Not enough spheres. Need ${cost}.`);
    }

    const now = Date.now();
    await ctx.db.patch(defender._id, {
      spheres: defender.spheres - cost,
      lastActiveAt: now,
    });
    await ctx.db.patch(siege._id, {
      fortifyPercent: siege.fortifyPercent + percent,
    });

    return {
      fortifyPercent: siege.fortifyPercent + percent,
      cost,
    };
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
    const player = await requireCurrentPlayer(ctx);
    const siege = await ctx.db.get(args.siegeId);
    if (!siege || siege.status !== "pending") {
      throw new Error("Choose an active siege.");
    }
    const plateau = await ctx.db.get(siege.plateauId);
    if (!plateau) throw new Error("Plateau not found.");

    const now = Date.now();
    const attacker = await ctx.db.get(siege.attackerId);
    if (!attacker) throw new Error("Attacker not found.");

    if (player._id === siege.attackerId) {
      const survivors = applyLosses(
        siege.attackerUnits,
        PLATEAU_RULES.attackerRetreatLossRate,
      );
      await ctx.db.patch(attacker._id, {
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
      await ctx.db.patch(siege._id, {
        status: "attacker_retreat",
        resolvedAt: now,
      });
      await ctx.db.patch(plateau._id, {
        activeSiegeId: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("gameEvents", {
        text: `${attacker.name} retreated from a plateau siege.`,
        createdAt: now,
      });
      return { retreated: true };
    }

    if (siege.defenderId && player._id === siege.defenderId) {
      const defender = await ctx.db.get(siege.defenderId);
      if (!defender) throw new Error("Defender not found.");
      const survivors = applyLosses(
        siege.attackerUnits,
        PLATEAU_RULES.siegeWinAttackerLossRate,
      );
      await ctx.db.patch(attacker._id, {
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
      await ctx.db.patch(defender._id, {
        units: applyLosses(defender.units, PLATEAU_RULES.defenderRetreatLossRate),
        lastActiveAt: now,
      });
      await ctx.db.patch(plateau._id, {
        ownerPlayerId: attacker._id,
        heldSince: now,
        lastGemheartAt: now,
        activeSiegeId: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(siege._id, {
        status: "defender_retreat",
        resolvedAt: now,
      });
      await ctx.db.insert("gameEvents", {
        text: `${defender.name} abandoned ${plateau.name} to ${attacker.name}.`,
        createdAt: now,
      });
      return { retreated: true };
    }

    throw new Error("Only the attacker or defender can retreat.");
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
      survivors = applyLosses(
        siege.attackerUnits,
        won ? PLATEAU_RULES.neutralWinLossRate : PLATEAU_RULES.neutralLossLossRate,
      );

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
        resultText = `${attacker.name} claimed ${plateauTypeName(plateau.type)}.`;
      } else {
        await ctx.db.patch(plateau._id, {
          neutralDefenseRemaining: Math.max(
            1,
            plateau.neutralDefenseRemaining - siege.attackerPower,
          ),
          activeSiegeId: undefined,
          updatedAt: now,
        });
        resultText = `${attacker.name} weakened the Parshendi defense on a neutral plateau.`;
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
        const defenderPower = targetDefensePower(
          defender,
          plateau,
          siege.fortifyPercent,
        );
        won = siege.attackerPower > defenderPower;
        survivors = applyLosses(
          siege.attackerUnits,
          won
            ? PLATEAU_RULES.siegeWinAttackerLossRate
            : PLATEAU_RULES.siegeLossAttackerLossRate,
        );

        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        await ctx.db.patch(defender._id, {
          units: applyLosses(
            defender.units,
            won
              ? PLATEAU_RULES.siegeWinDefenderLossRate
              : PLATEAU_RULES.siegeLossDefenderLossRate,
          ),
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
          resultText = `${attacker.name} captured ${plateau.name} from ${defender.name}.`;
        } else {
          await ctx.db.patch(plateau._id, {
            activeSiegeId: undefined,
            updatedAt: now,
          });
          resultText = `${defender.name} held ${plateau.name} against ${attacker.name}.`;
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
