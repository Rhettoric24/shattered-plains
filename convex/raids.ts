import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";
import { requireCurrentPlayer } from "./ownership";
import {
  applySurvivalLosses,
  casualtySummary,
  COMBAT_RULES,
  effectivePower,
  normalizeUnits,
  totalUnits,
  travelMsForUnits,
  UNIT_RULES,
  unitPlunder,
  unitSpeed,
  WORLD_KEY,
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

function seededInt(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return min + (hash % (max - min + 1));
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

async function createRaid(
  ctx: any,
  args: {
    attackerId: any;
    targetType: "open_acres" | "player" | "parshendi_spheres";
    targetPlayerId?: any;
    units: UnitCounts;
    acres?: number;
  },
) {
  const attacker = await ctx.db.get(args.attackerId);
  if (!attacker) {
    throw new Error("Attacker not found.");
  }

  const units = cleanUnits(args.units);
  if (totalUnits(units) < 1) {
    throw new Error("Send at least one unit.");
  }
  validateUnlockedUnits(attacker.buildings, units);

  if (args.targetType === "player") {
    if (!args.targetPlayerId) throw new Error("Choose a target player.");
    if (args.targetPlayerId === attacker._id) throw new Error("You cannot raid yourself.");
    const defender = await ctx.db.get(args.targetPlayerId);
    if (!defender) throw new Error("Target player not found.");
  }

  const world = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q: any) => q.eq("key", WORLD_KEY))
    .unique();
  if (!world) {
    throw new Error("Create the world before launching raids.");
  }

  const now = Date.now();
  const departAt = now;
  const arriveAt = now + travelMsForUnits(units);
  const power = effectivePower(units);
  const speed = unitSpeed(units);
  const remainingUnits = subtractUnits(attacker.units, units);
  const acres =
    args.targetType === "parshendi_spheres"
      ? undefined
      : Math.max(1, Math.floor(args.acres ?? 1));

  const seedBase = `${attacker._id}:${now}:${totalUnits(units)}:${args.targetType}`;
  const defensePower =
    args.targetType === "parshendi_spheres"
      ? seededInt(
          `${seedBase}:defense`,
          COMBAT_RULES.parshendiSphereRaidMinDefense,
          COMBAT_RULES.parshendiSphereRaidMaxDefense,
        )
      : undefined;
  const rewardSpheres =
    args.targetType === "parshendi_spheres"
      ? seededInt(
          `${seedBase}:reward`,
          COMBAT_RULES.parshendiSphereRaidMinReward,
          COMBAT_RULES.parshendiSphereRaidMaxReward,
        )
      : undefined;

  await ctx.db.patch(attacker._id, {
    units: remainingUnits,
    lastActiveAt: now,
  });

  const raidId = await ctx.db.insert("raids", {
    attackerId: attacker._id,
    targetType: args.targetType,
    ...(args.targetPlayerId ? { targetPlayerId: args.targetPlayerId } : {}),
    units,
    power,
    speed,
    ...(acres ? { acres } : {}),
    ...(defensePower ? { defensePower } : {}),
    ...(rewardSpheres ? { rewardSpheres } : {}),
    departAt,
    arriveAt,
    status: "pending",
  });

  if (args.targetType === "player" && args.targetPlayerId) {
    await ctx.db.insert("messages", {
      toPlayerId: args.targetPlayerId,
      kind: "system",
      subject: "Incoming Raid",
      body: `${attacker.name} has launched a raid toward your warcamp.`,
      createdAt: now,
    });
  }

  await ctx.db.insert("gameEvents", {
    text: `${attacker.name} launched a raid.`,
    createdAt: now,
  });

  await ctx.scheduler.runAt(arriveAt, internal.raids.resolveRaid, { raidId });

  return {
    raidId,
    arriveAt,
    travelMinutes: Math.round((arriveAt - departAt) / 60000),
    power,
    speed,
  };
}

export const launchOpenAcreRaid = mutation({
  args: {
    acres: v.number(),
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    return await createRaid(ctx, {
      attackerId: attacker._id,
      targetType: "open_acres",
      acres: args.acres,
      units: args.units,
    });
  },
});

export const launchSphereRaid = mutation({
  args: {
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    return await createRaid(ctx, {
      attackerId: attacker._id,
      targetType: "parshendi_spheres",
      units: args.units,
    });
  },
});

export const launchPlayerRaid = mutation({
  args: {
    targetPlayerId: v.id("players"),
    acres: v.number(),
    units: unitCounts,
  },
  handler: async (ctx, args) => {
    const attacker = await requireCurrentPlayer(ctx);
    return await createRaid(ctx, {
      attackerId: attacker._id,
      targetType: "player",
      targetPlayerId: args.targetPlayerId,
      acres: args.acres,
      units: args.units,
    });
  },
});

export const listVisibleRaids = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCurrentPlayer(ctx);

    const pending = await ctx.db
      .query("raids")
      .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
      .collect();

    return pending.filter((raid) => {
      const watchtower = viewer.buildings.watchtower ?? 0;
      if (raid.attackerId === viewer._id) return true;
      if (
        (raid.targetType === "open_acres" ||
          raid.targetType === "parshendi_spheres") &&
        watchtower >= 1
      ) {
        return true;
      }
      if (raid.targetPlayerId === viewer._id && watchtower >= 3) return true;
      if (watchtower >= 5) return true;
      return false;
    });
  },
});

export const forceResolveRaid = mutation({
  args: {
    raidId: v.id("raids"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
      raidId: args.raidId,
    });
    return { scheduled: true };
  },
});

export const forceResolveAllRaids = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("raids")
      .withIndex("by_status_arrival", (q) => q.eq("status", "pending"))
      .take(100);

    for (const raid of pending) {
      await ctx.scheduler.runAfter(0, internal.raids.resolveRaid, {
        raidId: raid._id,
      });
    }

    return { scheduled: pending.length };
  },
});

export const resolveRaid = internalMutation({
  args: {
    raidId: v.id("raids"),
  },
  handler: async (ctx, args) => {
    const raid = await ctx.db.get(args.raidId);
    if (!raid || raid.status === "resolved") {
      return { resolved: false };
    }

    const attacker = await ctx.db.get(raid.attackerId);
    if (!attacker) {
      await ctx.db.patch(raid._id, {
        status: "resolved",
        resolvedAt: Date.now(),
      });
      return { resolved: false };
    }

    const now = Date.now();
    let won = false;
    let resultText = "";
    let survivors = raid.units;

    if (raid.targetType === "open_acres") {
      const world = await ctx.db
        .query("gameState")
        .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
        .unique();
      const acres = Math.min(raid.acres ?? 1, world?.openAcres ?? 0);
      const defense =
        COMBAT_RULES.openDefenseBase + acres * COMBAT_RULES.openDefensePerAcre;
      won = raid.power >= defense && acres > 0;
      const losses = won
        ? Math.ceil(totalUnits(raid.units) * 0.15)
        : Math.ceil(totalUnits(raid.units) * 0.45);
      const lossResult = applySurvivalLosses(
        normalizeUnits(raid.units),
        losses,
        `${raid._id}:open:${now}`,
      );
      survivors = lossResult.survivors;

      if (won && world) {
        await ctx.db.patch(world._id, { openAcres: world.openAcres - acres });
        await ctx.db.patch(attacker._id, {
          acres: attacker.acres + acres,
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        resultText = `${attacker.name} won ${acres} open acres.`;
      } else {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        resultText = `${attacker.name} failed an open-acre raid.`;
      }
    }

    if (raid.targetType === "parshendi_spheres") {
      const defense =
        raid.defensePower ?? COMBAT_RULES.parshendiSphereRaidMaxDefense;
      const reward =
        raid.rewardSpheres ?? COMBAT_RULES.parshendiSphereRaidMinReward;
      won = raid.power >= defense;
      const losses = won
        ? Math.ceil(totalUnits(raid.units) * 0.08)
        : Math.ceil(totalUnits(raid.units) * 0.25);
      const lossResult = applySurvivalLosses(
        normalizeUnits(raid.units),
        losses,
        `${raid._id}:spheres:${now}`,
      );
      survivors = lossResult.survivors;
      const plunder = unitPlunder(normalizeUnits(raid.units));
      const recovered = won ? Math.min(reward, plunder) : 0;
      const leftBehind = won ? Math.max(0, reward - recovered) : 0;

      await ctx.db.patch(attacker._id, {
        spheres: attacker.spheres + recovered,
        units: addUnits(attacker.units, survivors),
        lastActiveAt: now,
      });
      resultText = won
        ? `${attacker.name} raided Parshendi spheres. Attack Power ${raid.power}, Defense Power ${defense}. Available ${reward}, plunder ${plunder}, recovered ${recovered}, left behind ${leftBehind}. Casualties: ${casualtySummary(lossResult.casualties)}.`
        : `${attacker.name} failed a Parshendi sphere raid. Attack Power ${raid.power}, Defense Power ${defense}. Casualties: ${casualtySummary(lossResult.casualties)}.`;
    }

    if (raid.targetType === "player") {
      const defender = raid.targetPlayerId
        ? await ctx.db.get(raid.targetPlayerId)
        : null;
      if (!defender) {
        await ctx.db.patch(attacker._id, {
          units: addUnits(attacker.units, raid.units),
          lastActiveAt: now,
        });
        resultText = `${attacker.name}'s raid found no target.`;
      } else {
        const defenseBonus =
          1 +
          defender.buildings.watchtower * COMBAT_RULES.watchtowerDefensePerLevel;
        const homePower = effectivePower(defender.units) * defenseBonus;
        const acres = Math.min(raid.acres ?? 1, Math.max(0, defender.acres - 1));
        won = raid.power > homePower && acres > 0;
        const attackerLosses = won
          ? Math.ceil(totalUnits(raid.units) * 0.22)
          : Math.ceil(totalUnits(raid.units) * 0.55);
        const defenderLosses = won
          ? Math.ceil(totalUnits(defender.units) * 0.18)
          : Math.ceil(totalUnits(defender.units) * 0.08);
        const attackerLossResult = applySurvivalLosses(
          normalizeUnits(raid.units),
          attackerLosses,
          `${raid._id}:player:attacker:${now}`,
        );
        survivors = attackerLossResult.survivors;
        const defenderLossResult = applySurvivalLosses(
          normalizeUnits(defender.units),
          defenderLosses,
          `${raid._id}:player:defender:${now}`,
        );

        await ctx.db.patch(attacker._id, {
          acres: attacker.acres + (won ? acres : 0),
          units: addUnits(attacker.units, survivors),
          lastActiveAt: now,
        });
        await ctx.db.patch(defender._id, {
          acres: defender.acres - (won ? acres : 0),
          units: defenderLossResult.survivors,
          lastActiveAt: now,
        });

        await ctx.db.insert("messages", {
          toPlayerId: defender._id,
          kind: "system",
          subject: won ? "Raid Lost" : "Defense Held",
          body: `${won ? `${attacker.name} seized ${acres} acres from your warcamp.` : `Your warcamp held against ${attacker.name}.`} Attack Power ${raid.power}, Defense Power ${homePower}. Attacker casualties: ${casualtySummary(attackerLossResult.casualties)}. Defender casualties: ${casualtySummary(defenderLossResult.casualties)}.`,
          createdAt: now,
        });
        resultText = won
          ? `${attacker.name} seized ${acres} acres from ${defender.name}. Attack Power ${raid.power}, Defense Power ${homePower}. Attacker casualties: ${casualtySummary(attackerLossResult.casualties)}. Defender casualties: ${casualtySummary(defenderLossResult.casualties)}.`
          : `${defender.name} held against ${attacker.name}. Attack Power ${raid.power}, Defense Power ${homePower}. Attacker casualties: ${casualtySummary(attackerLossResult.casualties)}. Defender casualties: ${casualtySummary(defenderLossResult.casualties)}.`;
      }
    }

    await ctx.db.patch(raid._id, {
      status: "resolved",
      resolvedAt: now,
    });
    await ctx.db.insert("messages", {
      toPlayerId: attacker._id,
      kind: "system",
      subject: won ? "Raid Won" : "Raid Resolved",
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
