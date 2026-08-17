import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { createNotification } from "./notificationHelpers";
import { requireCurrentPlayer } from "./ownership";
import { ownedUnitsIncludingAway } from "./provisionHelpers";
import { completedResearch } from "./researchHelpers";
import { activeSeason, awardSeasonPoints } from "./seasonLedger";
import { effectivePower, emptyUnits, identityPlateauType } from "./rules";
import { effectiveIntelLevel, presentIntelNumber, watchtowerTerritoryLevel } from "./intelligenceRules";
import {
  clampHostility,
  hostilityProgress,
  hostilityState,
  isRetaliationEligible,
  materializeHostilityDecay,
  retaliationPower,
  retaliationReward,
  retaliationTargetWeight,
  seededFraction,
  seededInt,
  WORLD_PRESSURE_RULES,
  type HostilityState,
} from "./worldPressureRules";

type DbCtx = QueryCtx | MutationCtx;

async function pressureRow(ctx: DbCtx, playerId: Id<"players">) {
  return await ctx.db
    .query("kingdomWorldPressure")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .unique();
}

function effectivePressure(row: Doc<"kingdomWorldPressure"> | null, now: number) {
  const decayed = materializeHostilityDecay({
    hostility: row?.hostility ?? 0,
    lastPlayerAggressionAt: row?.lastPlayerAggressionAt,
    decayIntervalsApplied: row?.decayIntervalsApplied ?? 0,
    now,
  });
  return { ...decayed, row };
}

async function notifyStateChange(
  ctx: MutationCtx,
  playerId: Id<"players">,
  oldHostility: number,
  newHostility: number,
  now: number,
) {
  const previous = hostilityState(oldHostility);
  const next = hostilityState(newHostility);
  if (previous.key === next.key) return;
  const direction = newHostility > oldHostility ? "risen" : "fallen";
  const body = `Parshendi Hostility has ${direction} to ${next.label} (${newHostility}/100).`;
  await ctx.db.insert("messages", {
    toPlayerId: playerId,
    kind: "system",
    subject: `Hostility: ${next.label}`,
    body,
    eventType: "hostility_state_changed", destinationView: "home",
    createdAt: now,
  });
  await createNotification(ctx, {
    playerId,
    category: "combat",
    eventType: "hostility_state_changed",
    title: `Parshendi Hostility: ${next.label}`,
    body,
    destinationView: "home",
    dedupeKey: `hostility:${playerId}:${next.key}:${now}`,
    createdAt: now,
  });
}

async function ownedEligiblePlateaus(ctx: DbCtx, playerId: Id<"players">) {
  const plateaus = await ctx.db
    .query("plateaus")
    .withIndex("by_owner", (q) => q.eq("ownerPlayerId", playerId))
    .take(200);
  return plateaus.filter((plateau) =>
    plateau.status === "owned" &&
    !plateau.activeSiegeId &&
    (plateau.origin === "neutral" || plateau.neutralDefenseInitial > 0),
  );
}

async function activeRetaliation(ctx: DbCtx, playerId: Id<"players">) {
  return await ctx.db
    .query("parshendiRetaliations")
    .withIndex("by_playerId_and_active", (q) => q.eq("playerId", playerId).eq("active", true))
    .unique();
}

function cooldownRange(state: HostilityState) {
  if (state === "agitated" || state === "hostile" || state === "vengeful" || state === "relentless") {
    return WORLD_PRESSURE_RULES.retaliation.cooldownHours[state];
  }
  return null;
}

async function scheduleRetaliation(
  ctx: MutationCtx,
  row: Doc<"kingdomWorldPressure">,
  now: number,
  forceRecalculate = false,
) {
  const state = hostilityState(row.hostility).key;
  const range = cooldownRange(state);
  const active = await activeRetaliation(ctx, row.playerId);
  const eligiblePlateaus = range && !active ? await ownedEligiblePlateaus(ctx, row.playerId) : [];
  if (!range || active || eligiblePlateaus.length === 0) {
    if (row.nextRetaliationAt || row.retaliationScheduleToken) {
      await ctx.db.patch(row._id, {
        nextRetaliationAt: undefined,
        retaliationScheduleToken: undefined,
        updatedAt: now,
      });
    }
    return;
  }
  if (!forceRecalculate && row.nextRetaliationAt && row.retaliationScheduleToken) return;

  const token = `${row.playerId}:${now}:${row.hostility}:${seededInt(`${row._id}:${now}`, 0, 999999)}`;
  const cooldownHours = seededInt(`${token}:cooldown`, range[0], range[1]);
  const warningHours = seededInt(
    `${token}:warning`,
    WORLD_PRESSURE_RULES.retaliation.warningLeadHours[0],
    WORLD_PRESSURE_RULES.retaliation.warningLeadHours[1],
  );
  const baseAt = row.lastRetaliationLaunchAt ?? now;
  const launchAt = Math.max(now + warningHours * 60 * 60 * 1000, baseAt + cooldownHours * 60 * 60 * 1000);
  const formationAt = Math.max(now, launchAt - warningHours * 60 * 60 * 1000);
  await ctx.db.patch(row._id, { nextRetaliationAt: launchAt, retaliationScheduleToken: token, updatedAt: now });
  await ctx.scheduler.runAt(formationAt, internal.worldPressure.beginRetaliationFormation, {
    playerId: row.playerId,
    scheduleToken: token,
  });
}

async function scheduleNextDecay(ctx: MutationCtx, row: Doc<"kingdomWorldPressure">, now: number) {
  if (row.hostility <= 0 || row.lastPlayerAggressionAt === undefined) return;
  const nextAt = row.lastPlayerAggressionAt +
    (row.decayIntervalsApplied + 1) * WORLD_PRESSURE_RULES.hostility.peacefulIntervalMs;
  await ctx.scheduler.runAt(Math.max(now + 1000, nextAt), internal.worldPressure.settleHostilityDecay, {
    playerId: row.playerId,
    peacefulAnchorAt: row.lastPlayerAggressionAt,
  });
}

async function writePressure(
  ctx: MutationCtx,
  playerId: Id<"players">,
  args: {
    now: number;
    hostility: number;
    lastPlayerAggressionAt?: number;
    decayIntervalsApplied: number;
  },
) {
  const existing = await pressureRow(ctx, playerId);
  if (existing) {
    await ctx.db.patch(existing._id, {
      hostility: clampHostility(args.hostility),
      ...(args.lastPlayerAggressionAt !== undefined ? { lastPlayerAggressionAt: args.lastPlayerAggressionAt } : {}),
      decayIntervalsApplied: args.decayIntervalsApplied,
      updatedAt: args.now,
    });
    return (await ctx.db.get(existing._id))!;
  }
  const id = await ctx.db.insert("kingdomWorldPressure", {
    playerId,
    hostility: clampHostility(args.hostility),
    ...(args.lastPlayerAggressionAt !== undefined ? { lastPlayerAggressionAt: args.lastPlayerAggressionAt } : {}),
    decayIntervalsApplied: args.decayIntervalsApplied,
    updatedAt: args.now,
  });
  return (await ctx.db.get(id))!;
}

export async function applyHostility(
  ctx: MutationCtx,
  args: {
    playerId: Id<"players">;
    gain?: number;
    playerInitiated?: boolean;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const existing = await pressureRow(ctx, args.playerId);
  const effective = effectivePressure(existing, now);
  const oldHostility = existing?.hostility ?? 0;
  const hostility = clampHostility(effective.hostility + Math.max(0, args.gain ?? 0));
  const oldState = hostilityState(oldHostility).key;
  const lastPlayerAggressionAt = args.playerInitiated ? now : existing?.lastPlayerAggressionAt;
  const decayIntervalsApplied = args.playerInitiated ? 0 : effective.decayIntervalsApplied;
  const row = await writePressure(ctx, args.playerId, {
    now,
    hostility,
    ...(lastPlayerAggressionAt !== undefined ? { lastPlayerAggressionAt } : {}),
    decayIntervalsApplied,
  });
  await notifyStateChange(ctx, args.playerId, oldHostility, hostility, now);
  await scheduleNextDecay(ctx, row, now);
  await scheduleRetaliation(ctx, row, now, oldState !== hostilityState(hostility).key);
  return { hostility, state: hostilityState(hostility) };
}

export async function resetWorldPressureForSeason(ctx: MutationCtx, now: number) {
  const rows = await ctx.db.query("kingdomWorldPressure").take(500);
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      hostility: 0,
      lastPlayerAggressionAt: undefined,
      decayIntervalsApplied: 0,
      nextRetaliationAt: undefined,
      retaliationScheduleToken: undefined,
      lastRetaliationLaunchAt: undefined,
      updatedAt: now,
    });
  }
  const forming = await ctx.db
    .query("parshendiRetaliations")
    .withIndex("by_phase_and_launchAt", (q) => q.eq("phase", "forming"))
    .take(500);
  for (const retaliation of forming) {
    await ctx.db.patch(retaliation._id, {
      phase: "cancelled",
      active: false,
      outcome: "cancelled",
      resolvedAt: now,
      updatedAt: now,
    });
  }
  return { kingdomsReset: rows.length, formationsCancelled: forming.length };
}

export async function completeRetaliation(
  ctx: MutationCtx,
  args: { retaliationId: Id<"parshendiRetaliations">; defended: boolean; now: number },
) {
  const retaliation = await ctx.db.get(args.retaliationId);
  if (!retaliation || !retaliation.active) return null;
  await ctx.db.patch(retaliation._id, {
    phase: "resolved",
    active: false,
    outcome: args.defended ? "defended" : "reclaimed",
    resolvedAt: args.now,
    updatedAt: args.now,
  });
  if (args.defended) {
    const player = await ctx.db.get(retaliation.playerId);
    if (player) {
      const spheres = retaliationReward(retaliation.power);
      await ctx.db.patch(player._id, { spheres: player.spheres + spheres, lastActiveAt: args.now });
      const season = await activeSeason(ctx);
      if (season) {
        await awardSeasonPoints(ctx, {
          seasonId: season._id,
          playerId: player._id,
          category: "military",
          sourceType: "parshendi_retaliation_defense",
          sourceKey: `retaliation:${retaliation._id}:defense`,
          basePoints: WORLD_PRESSURE_RULES.retaliation.rewards.militarySeasonPoints,
          description: `Defended ${retaliation.power} Power of Parshendi retaliation`,
          entityType: "retaliation",
          entityId: String(retaliation._id),
          now: args.now,
        });
      }
      await applyHostility(ctx, {
        playerId: player._id,
        gain: WORLD_PRESSURE_RULES.hostility.gains.retaliationVictory,
        playerInitiated: false,
        now: args.now,
      });
      return { spheres };
    }
  }
  const row = await pressureRow(ctx, retaliation.playerId);
  if (row) await scheduleRetaliation(ctx, row, args.now, true);
  return { spheres: 0 };
}

function weightedTarget(plateaus: Doc<"plateaus">[], now: number, seed: string) {
  const weighted = plateaus.map((plateau) => ({
    plateau,
    weight: retaliationTargetWeight({
      type: identityPlateauType(plateau.type),
      large: plateau.large,
      heldSince: plateau.heldSince,
      reclamationCount: plateau.parshendiReclamationCount,
      now,
    }),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = seededFraction(seed) * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.plateau;
  }
  return weighted[weighted.length - 1]?.plateau ?? null;
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const now = Date.now();
    const row = await pressureRow(ctx, player._id);
    const effective = effectivePressure(row, now);
    const progress = hostilityProgress(effective.hostility);
    const retaliation = await activeRetaliation(ctx, player._id);
    const passiveIntelLevel = watchtowerTerritoryLevel(Math.min(3, player.buildings.watchtower ?? 0));
    const territoryReport = retaliation
      ? await ctx.db
          .query("intelligenceReports")
          .withIndex("by_viewerPlayerId_and_plateauId", (q) =>
            q.eq("viewerPlayerId", player._id).eq("plateauId", retaliation.targetPlateauId),
          )
          .unique()
      : null;
    const intelLevel = Math.max(
      passiveIntelLevel,
      territoryReport ? effectiveIntelLevel(territoryReport.level, territoryReport.observedAt, now) : 0,
    );
    const plateau = retaliation ? await ctx.db.get(retaliation.targetPlateauId) : null;
    const warning = retaliation
      ? {
          phase: retaliation.phase,
          intelligenceLevel: intelLevel,
          message: intelLevel <= 0
            ? "Parshendi activity appears to be increasing near your holdings."
            : intelLevel === 1
              ? "A substantial Parshendi warband appears to be gathering."
              : "Scouts have identified the likely target and strength of the gathering force.",
          ...(intelLevel >= 2 && plateau ? {
            targetPlateauId: plateau._id,
            targetName: plateau.name,
            estimatedStrength: presentIntelNumber(retaliation.power, intelLevel),
            launchWindowStartAt: retaliation.launchAt - 30 * 60 * 1000,
            launchWindowEndAt: retaliation.launchAt + 30 * 60 * 1000,
          } : {}),
          ...(retaliation.siegeId ? { siegeId: retaliation.siegeId } : {}),
        }
      : null;
    const nextDecayAt = row?.lastPlayerAggressionAt !== undefined && effective.hostility > 0
      ? row.lastPlayerAggressionAt +
        (effective.decayIntervalsApplied + 1) * WORLD_PRESSURE_RULES.hostility.peacefulIntervalMs
      : null;
    return {
      hostility: effective.hostility,
      state: progress.state,
      nextState: progress.nextState,
      progressPercent: progress.progressPercent,
      nextDecayAt,
      nextRetaliationAt: row?.nextRetaliationAt ?? null,
      retaliationEligible: isRetaliationEligible(effective.hostility),
      warning,
    };
  },
});

export const settleHostilityDecay = internalMutation({
  args: { playerId: v.id("players"), peacefulAnchorAt: v.number() },
  handler: async (ctx, args) => {
    const row = await pressureRow(ctx, args.playerId);
    if (!row || row.lastPlayerAggressionAt !== args.peacefulAnchorAt) return { settled: false };
    const now = Date.now();
    const decayed = materializeHostilityDecay({ ...row, now });
    if (decayed.intervalsAppliedNow <= 0) return { settled: false };
    const oldHostility = row.hostility;
    await ctx.db.patch(row._id, {
      hostility: decayed.hostility,
      decayIntervalsApplied: decayed.decayIntervalsApplied,
      updatedAt: now,
    });
    const updated = (await ctx.db.get(row._id))!;
    await notifyStateChange(ctx, row.playerId, oldHostility, decayed.hostility, now);
    await scheduleRetaliation(ctx, updated, now, hostilityState(oldHostility).key !== hostilityState(decayed.hostility).key);
    await scheduleNextDecay(ctx, updated, now);
    return { settled: true, hostility: decayed.hostility };
  },
});

export const beginRetaliationFormation = internalMutation({
  args: { playerId: v.id("players"), scheduleToken: v.string() },
  handler: async (ctx, args) => {
    const row = await pressureRow(ctx, args.playerId);
    if (!row || row.retaliationScheduleToken !== args.scheduleToken) return { formed: false };
    const now = Date.now();
    const decayed = materializeHostilityDecay({ ...row, now });
    if (decayed.hostility !== row.hostility || decayed.decayIntervalsApplied !== row.decayIntervalsApplied) {
      await ctx.db.patch(row._id, {
        hostility: decayed.hostility,
        decayIntervalsApplied: decayed.decayIntervalsApplied,
        updatedAt: now,
      });
    }
    if (!isRetaliationEligible(decayed.hostility) || await activeRetaliation(ctx, args.playerId)) {
      await ctx.db.patch(row._id, { nextRetaliationAt: undefined, retaliationScheduleToken: undefined, updatedAt: now });
      return { formed: false };
    }
    const plateaus = await ownedEligiblePlateaus(ctx, args.playerId);
    const target = weightedTarget(plateaus, now, `${args.scheduleToken}:target`);
    const player = await ctx.db.get(args.playerId);
    const season = await activeSeason(ctx);
    if (!target || !player || !season) return { formed: false };
    const allUnits = await ownedUnitsIncludingAway(ctx, player._id, player.units);
    const completed = await completedResearch(ctx, player._id);
    const militaryCapacity = effectivePower(allUnits, completed);
    const seasonDay = Math.floor(Math.max(0, now - season.startsAt) / (24 * 60 * 60 * 1000)) + 1;
    const power = retaliationPower({ militaryCapacity, hostility: decayed.hostility, seasonDay });
    const launchAt = row.nextRetaliationAt ?? now + WORLD_PRESSURE_RULES.retaliation.warningLeadHours[0] * 60 * 60 * 1000;
    const retaliationId = await ctx.db.insert("parshendiRetaliations", {
      playerId: player._id,
      targetPlateauId: target._id,
      phase: "forming",
      active: true,
      hostilityAtFormation: decayed.hostility,
      militaryCapacity,
      seasonDay,
      power,
      formationAt: now,
      launchAt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(row._id, { nextRetaliationAt: undefined, retaliationScheduleToken: undefined, updatedAt: now });
    const report = await ctx.db
      .query("intelligenceReports")
      .withIndex("by_viewerPlayerId_and_plateauId", (q) =>
        q.eq("viewerPlayerId", player._id).eq("plateauId", target._id),
      )
      .unique();
    const intelLevel = Math.max(
      watchtowerTerritoryLevel(Math.min(3, player.buildings.watchtower ?? 0)),
      report ? effectiveIntelLevel(report.level, report.observedAt, now) : 0,
    );
    const body = intelLevel >= 2
      ? `A Parshendi warband is gathering. Likely target: ${target.name}. Estimated strength: ${presentIntelNumber(power, intelLevel)?.label ?? "unknown"}.`
      : intelLevel === 1
        ? "A substantial Parshendi warband appears to be gathering near your holdings."
        : "Parshendi activity appears to be increasing near your holdings.";
    await ctx.db.insert("messages", { toPlayerId: player._id, kind: "system", subject: "Parshendi Activity", body, eventType: "parshendi_retaliation_forming", destinationView: "intelligence", destinationTab: "territory", createdAt: now });
    await createNotification(ctx, {
      playerId: player._id,
      category: "combat",
      eventType: "parshendi_retaliation_forming",
      title: "Parshendi Activity Increasing",
      body,
      destinationView: "intelligence", destinationTab: "territory",
      entityId: String(retaliationId),
      dedupeKey: `retaliation:${retaliationId}:forming`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(launchAt, internal.worldPressure.launchRetaliation, { retaliationId });
    return { formed: true, retaliationId, launchAt };
  },
});

export const launchRetaliation = internalMutation({
  args: { retaliationId: v.id("parshendiRetaliations") },
  handler: async (ctx, args) => {
    const retaliation = await ctx.db.get(args.retaliationId);
    if (!retaliation || !retaliation.active || retaliation.phase !== "forming") return { launched: false };
    const now = Date.now();
    const player = await ctx.db.get(retaliation.playerId);
    let target = await ctx.db.get(retaliation.targetPlateauId);
    if (!target || target.ownerPlayerId !== retaliation.playerId || target.status !== "owned" || target.activeSiegeId) {
      target = weightedTarget(await ownedEligiblePlateaus(ctx, retaliation.playerId), now, `${retaliation._id}:${now}:retarget`);
    }
    if (!player || !target) {
      if (!player || (await ownedEligiblePlateaus(ctx, retaliation.playerId)).length === 0) {
        await ctx.db.patch(retaliation._id, {
          phase: "cancelled",
          active: false,
          outcome: "cancelled",
          resolvedAt: now,
          updatedAt: now,
        });
        return { launched: false };
      }
      const retryAt = now + WORLD_PRESSURE_RULES.retaliation.retryDelayMs;
      await ctx.db.patch(retaliation._id, { launchAt: retryAt, updatedAt: now });
      await ctx.scheduler.runAt(retryAt, internal.worldPressure.launchRetaliation, { retaliationId: retaliation._id });
      return { launched: false, deferred: true };
    }
    const resolveAt = now + WORLD_PRESSURE_RULES.retaliation.siegeDurationMs;
    const siegeId = await ctx.db.insert("sieges", {
      plateauId: target._id,
      defenderId: player._id,
      targetType: "parshendi_retaliation",
      attackerUnits: emptyUnits(),
      attackerPower: retaliation.power,
      attackerSpeed: 0,
      defenderUnits: emptyUnits(),
      defenderPower: 0,
      defenderSpeed: 0,
      fortifyPercent: 0,
      emergencyDefensePercent: 0,
      emergencyDefenseSpheresSpent: 0,
      retaliationId: retaliation._id,
      departAt: now,
      resolveAt,
      status: "pending",
    });
    await ctx.db.patch(target._id, { activeSiegeId: siegeId, updatedAt: now });
    await ctx.db.patch(retaliation._id, {
      targetPlateauId: target._id,
      phase: "launched",
      siegeId,
      launchAt: now,
      updatedAt: now,
    });
    const row = await pressureRow(ctx, player._id);
    if (row) await ctx.db.patch(row._id, { lastRetaliationLaunchAt: now, updatedAt: now });
    const body = `A ${retaliation.power}-Power Parshendi force has launched an attack against ${target.name}. Commit defenders before it arrives.`;
    await ctx.db.insert("messages", { toPlayerId: player._id, kind: "system", subject: "Parshendi Retaliation", body, eventType: "parshendi_retaliation_launched", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siegeId), createdAt: now });
    await createNotification(ctx, {
      playerId: player._id,
      category: "combat",
      eventType: "parshendi_retaliation_launched",
      title: "Parshendi Retaliation Launched",
      body,
      destinationView: "plains", destinationTab: "sieges",
      entityId: String(siegeId),
      dedupeKey: `retaliation:${retaliation._id}:launched`,
      createdAt: now,
    });
    await ctx.scheduler.runAt(resolveAt, internal.plateaus.resolveSiege, { siegeId });
    return { launched: true, siegeId, resolveAt };
  },
});
