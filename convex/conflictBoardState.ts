/** Transactional adapter for the shared resolver. Never imported by the Lab. */
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { addUnits, emptyUnits, totalUnits, type UnitCounts } from "./rules";
import { activeHighstorm } from "./highstorms";
import {
  completedResearch,
  reconcileResearch,
  recordSuccessfulDefensiveSiege,
} from "./researchHelpers";
import { startGemheartCycle } from "./plateauHelpers";
import { reconcileRetaliationSchedule } from "./worldPressure";
import {
  observePlateauOwnership,
  recordSiegeDefenseScore,
  recordSiegeVictoryScore,
} from "./seasonLedger";
import { createNotification } from "./notificationHelpers";
import { lossSummary, resolutionReport } from "./conflictBoardReports";
import { applyArrivals, resolveCycle } from "../conflict-board/resolver";
import { setHighstorm } from "../conflict-board/highstorms";
import { cargoAmount, settleUnclaimed } from "../conflict-board/cargo";
import { validateEquipment } from "../conflict-board/fabrials";
import type {
  ConflictState,
  Event,
  Formation,
  ResolverConfig,
} from "../conflict-board/types";

export const CYCLE_MS = 2 * 60 * 60 * 1000;
export const DURATION_MS = 24 * 60 * 60 * 1000;
export const wakeReference = makeFunctionReference<"mutation">(
  "conflictBoards:wake",
);
export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type ReadCtx = QueryCtx | MutationCtx;
export type Session = {
  conflict: Doc<"boardConflicts">;
  participants: Doc<"boardParticipants">[];
  forces: Doc<"boardForces">[];
  equipment: Doc<"boardEquipment">[];
  state: ConflictState;
  times: Map<string, number>;
  config: ResolverConfig;
  events: Event[];
  mergePreferences: Record<string, string>;
};

export function requireEnabled() {
  if (process.env.CONFLICT_BOARD_V1_ENABLED !== "true")
    throw Error("Conflict Board V1 is not enabled in this environment.");
}
export async function loadBoard(
  ctx: ReadCtx,
  id: Id<"boardConflicts">,
): Promise<Session> {
  const conflict = await ctx.db.get(id);
  if (!conflict) throw Error("Conflict not found.");
  const [participants, forces, equipment] = await Promise.all([
    ctx.db
      .query("boardParticipants")
      .withIndex("by_conflictId_and_playerId", (q) => q.eq("conflictId", id))
      .collect(),
    ctx.db
      .query("boardForces")
      .withIndex("by_conflictId", (q) => q.eq("conflictId", id))
      .collect(),
    ctx.db
      .query("boardEquipment")
      .withIndex("by_conflictId", (q) => q.eq("conflictId", id))
      .collect(),
  ]);
  const state: ConflictState = {
    ...conflict.state,
    kingdoms: participants.map((p) => p.kingdom),
    formations: forces
      .filter((f) => f.arriveAt === undefined)
      .map((f) => structuredClone(f.data)),
    arrivals: forces
      .filter((f) => f.arriveAt !== undefined)
      .map((f) => ({
        id: f.formationId,
        cycle: Number.MAX_SAFE_INTEGER,
        formation: structuredClone(f.data),
      })),
    equipmentRecords: equipment.flatMap((e) => (e.record ? [e.record] : [])),
  };
  return {
    conflict,
    participants,
    forces,
    equipment,
    state,
    times: new Map(
      forces
        .filter((f) => f.arriveAt !== undefined)
        .map((f) => [f.formationId, f.arriveAt!]),
    ),
    config: conflict.config,
    events: [],
    mergePreferences: conflict.state.mergePreferences ?? {},
  };
}

export const allForces = (s: Session) => [
  ...s.state.formations,
  ...s.state.arrivals.map((a) => a.formation),
];
export function ownedUnits(s: Session, playerId: string): UnitCounts {
  return allForces(s)
    .filter((f) => f.kingdom === playerId)
    .reduce((a, f) => addUnits(a, f.units), emptyUnits());
}
/** Safety budget bounds a transaction, not the number of formations a player may
 * tactically create. Reject before charging assets; never silently truncate. */
export function checkBudget(s: Session) {
  if (
    JSON.stringify(s.state).length > 400_000 ||
    allForces(s).reduce((n, f) => n + totalUnits(f.units), 0) > 100_000
  )
    throw Error(
      "This conflict exceeds the current server simulation safety budget.",
    );
  validateEquipment(s.state);
}

export async function weatherDeadline(ctx: ReadCtx, at: number) {
  const { storm } = await activeHighstorm(ctx, at);
  if (storm.startAt > at) return storm.startAt;
  if (storm.endAt > at) return storm.endAt;
  const next = await activeHighstorm(ctx, at + 24 * 60 * 60 * 1000);
  return next.storm.startAt;
}
export async function applyWeather(ctx: MutationCtx, s: Session, at: number) {
  const { storm, active } = await activeHighstorm(ctx, at);
  // A forecast is not an ended exposure. Closing a future storm here would
  // poison its identity and cause the shared retry guard to skip its start.
  if (active || s.state.highstorm?.active) {
    const result = setHighstorm(
      s.state,
      s.config,
      active ? storm.stormId : s.state.highstorm!.id,
      active,
    );
    s.state = result.state;
    s.events.push(...result.events);
  }
  s.conflict.weatherAt = await weatherDeadline(ctx, at);
}
export async function notifyBoard(
  ctx: MutationCtx,
  s: Session,
  playerId: Id<"players">,
  key: string,
  title: string,
  body: string,
  at: number,
  spanreed = false,
) {
  const notification = await createNotification(ctx, {
    playerId,
    category: "combat",
    eventType: "conflict_board",
    title,
    body: spanreed && body.length > 240 ? `${body.slice(0, 237)}…` : body,
    destinationView: "plains",
    destinationTab: "sieges",
    entityId: String(s.conflict._id),
    dedupeKey: `board:${s.conflict._id}:${key}:${playerId}`,
    createdAt: at,
  });
  // Both writes commit atomically. The notification's existing indexed key is
  // also the receipt for the paired Spanreed report, including retried wakes.
  if (spanreed && notification.created) await ctx.db.insert("messages", {
    toPlayerId: playerId, kind: "system", subject: title, body,
    eventType: "conflict_board", entityType: "conflict_board",
    entityId: String(s.conflict._id), destinationView: "plains",
    destinationTab: "sieges", createdAt: at,
  });
}

/** Credits already extracted cargo once. The resolver's totals are cumulative. */
async function bankExtractions(ctx: MutationCtx, s: Session) {
  for (const p of s.participants) {
    const total = s.state.raidValues?.[p.playerId] ?? 0;
    const delta = total - p.banked;
    if (delta < 0) throw Error("Cargo banking cannot move backward.");
    if (!delta) continue;
    const player = await ctx.db.get(p.playerId);
    if (!player) throw Error("Missing asset owner.");
    await ctx.db.patch(player._id, { spheres: player.spheres + delta });
    p.banked = total;
  }
}

/** Equipment reservation ledger, never another random loss roll. */
async function returnEquipment(ctx: MutationCtx, s: Session, playerId: string) {
  const carried = new Set(
    allForces(s).flatMap((f) => f.equipment?.items.map((i) => i.id) ?? []),
  );
  for (const e of s.equipment.filter(
    (e) => e.playerId === playerId && e.status === "reserved",
  )) {
    const record = s.state.equipmentRecords?.find((r) => r.item.id === e._id);
    const retained = carried.has(e._id) || record?.status === "unsettled";
    if (!retained && record?.status !== "lost" && record?.status !== "consumed")
      throw Error("Equipment is missing from the conflict asset ledger.");
    const inventory = await ctx.db
      .query("playerFabrials")
      .withIndex("by_playerId_and_kind", (q) =>
        q.eq("playerId", e.playerId).eq("kind", e.kind),
      )
      .unique();
    if (!inventory || inventory.committed < 1)
      throw Error("Equipment reservation mismatch.");
    // Consumables are reserved while carried too, unlike legacy launch spending.
    // They are charged only if the shared resolver actually consumed/lost them.
    await ctx.db.patch(inventory._id, {
      committed: inventory.committed - 1,
      owned: inventory.owned - (retained ? 0 : 1),
    });
    e.status = retained
      ? "returned"
      : record?.status === "consumed"
        ? "consumed"
        : "lost";
    await ctx.db.patch(e._id, { status: e.status });
  }
}

export async function returnParticipant(
  ctx: MutationCtx,
  s: Session,
  p: Doc<"boardParticipants">,
  at: number,
) {
  if (p.status === "returned") return;
  await bankExtractions(ctx, s);
  const player = await ctx.db.get(p.playerId);
  if (!player) throw Error("Missing asset owner.");
  const units = ownedUnits(s, p.playerId);
  const cargo = allForces(s)
    .filter((f) => f.kingdom === p.playerId)
    .reduce((n, f) => n + cargoAmount(f), 0);
  await returnEquipment(ctx, s, p.playerId);
  await ctx.db.patch(player._id, {
    units: addUnits(player.units, units),
    spheres: player.spheres + cargo,
  });
  p.returnedUnits = addUnits(p.returnedUnits, units);
  p.returnedSpheres += cargo;
  p.units = emptyUnits();
  p.withdrawing = false;
  p.status = "returned";
  s.state.formations = s.state.formations.filter(
    (f) => f.kingdom !== p.playerId,
  );
  s.state.arrivals = s.state.arrivals.filter(
    (a) => a.formation.kingdom !== p.playerId,
  );
  for (const [position, h] of Object.entries(s.state.raidFootholds ?? {}))
    if (h.kingdom === p.playerId) delete s.state.raidFootholds![position];
  if (s.state.objective.controller === p.playerId) {
    s.state.objective.controller = null;
    delete s.state.objective.hold;
  }
  await notifyBoard(
    ctx,
    s,
    p.playerId,
    `return:${s.state.cycle}`,
    "Conflict forces returned",
    `${totalUnits(units)} surviving troops and ${cargo} carried Spheres returned to your kingdom.`,
    at,
  );
}

export async function finishBoard(
  ctx: MutationCtx,
  s: Session,
  winner: Id<"players">,
  reason: string,
  at: number,
) {
  if (s.conflict.status !== "active") return;
  const plateau = await ctx.db.get(s.conflict.plateauId);
  const valid =
    plateau?.activeConflictBoardId === s.conflict._id &&
    plateau.ownerPlayerId === s.conflict.ownerId;
  // Administrative ownership changes must not be overwritten by a stale siege.
  if (!valid) {
    winner = s.conflict.ownerId;
    reason = "cancelled: plateau ownership changed";
  }
  await bankExtractions(ctx, s);
  for (const p of s.participants) await returnParticipant(ctx, s, p, at);
  const owner = await ctx.db.get(s.conflict.ownerId);
  if (!owner) throw Error("Missing escrow owner.");
  await ctx.db.patch(owner._id, {
    spheres: owner.spheres + (s.state.treasury ?? 0),
  });
  s.state.treasury = 0;
  settleUnclaimed(s.state, s.events);
  if (plateau?.activeConflictBoardId === s.conflict._id)
    await ctx.db.patch(plateau._id, {
      activeConflictBoardId: undefined,
      updatedAt: at,
    });
  if (valid && plateau) {
    if (winner !== s.conflict.ownerId) {
      const victor = await ctx.db.get(winner);
      if (!victor) throw Error("Missing conquest owner.");
      await ctx.db.patch(plateau._id, {
        ownerPlayerId: winner,
        heldSince: at,
        lastGemheartAt: at,
        nextGemheartAt:
          plateau.type === "gemheart"
            ? startGemheartCycle(
                plateau._id,
                at,
                await completedResearch(ctx, winner),
              )
            : undefined,
      });
      await observePlateauOwnership(ctx, {
        plateauId: plateau._id,
        previousOwnerId: owner._id,
        newOwnerId: winner,
        heldSince: at,
        now: at,
      });
      await reconcileResearch(ctx, winner, at);
      await reconcileResearch(ctx, owner._id, at);
      const p = s.participants.find((p) => p.playerId === winner)!;
      if (p.seasonId && p.chainPosition)
        await recordSiegeVictoryScore(ctx, {
          siegeId: s.conflict._id,
          seasonId: p.seasonId,
          attackerId: winner,
          defenderId: owner._id,
          attackerName: victor.name,
          defenderName: owner.name,
          plateauName: plateau.name,
          chainPosition: p.chainPosition,
          now: at,
        });
      await reconcileRetaliationSchedule(ctx, winner, at);
    } else {
      await recordSuccessfulDefensiveSiege(ctx, owner._id, at);
      const p = s.participants.find(
        (p) => p.playerId === s.conflict.initiatorId,
      )!;
      if (p.seasonId)
        await recordSiegeDefenseScore(ctx, {
          siegeId: s.conflict._id,
          seasonId: p.seasonId,
          defenderId: owner._id,
          attackerId: p.playerId,
          attackerName: p.kingdom.name,
          plateauName: plateau.name,
          now: at,
        });
    }
    await reconcileRetaliationSchedule(ctx, owner._id, at);
  }
  s.conflict.status = "settled";
  s.conflict.settledAt = at;
  s.conflict.winnerId = valid ? winner : plateau?.ownerPlayerId;
  s.conflict.outcome = reason;
  s.state.objective = { controller: valid ? winner : null };
  s.mergePreferences = {};
  for (const p of s.participants)
    await notifyBoard(
      ctx,
      s,
      p.playerId,
      "settled",
      "Conflict ended",
      `${plateau?.name ?? "Plateau"}: ${reason}. Your remaining assets have been returned.`,
      at,
    );
}

export async function saveBoard(
  ctx: MutationCtx,
  s: Session,
  eventProcessed = false,
) {
  // Admission/splitting enforce the resource budget. Never block casualties or
  // asset returns because their audit records made a snapshot slightly bigger.
  validateEquipment(s.state);
  await bankExtractions(ctx, s);
  const desired = new Map<string, { data: unknown; arriveAt?: number }>();
  for (const f of s.state.formations) desired.set(f.id, { data: f });
  for (const a of s.state.arrivals) {
    const arriveAt = s.times.get(a.id);
    if (arriveAt === undefined)
      throw Error("Reinforcement arrival time missing.");
    desired.set(a.formation.id, { data: a.formation, arriveAt });
  }
  for (const row of s.forces) {
    const next = desired.get(row.formationId);
    if (!next) await ctx.db.delete(row._id);
    else {
      if (
        JSON.stringify(row.data) !== JSON.stringify(next.data) ||
        row.arriveAt !== next.arriveAt
      )
        await ctx.db.patch(row._id, {
          data: clean(next.data),
          arriveAt: next.arriveAt,
        });
      desired.delete(row.formationId);
    }
  }
  for (const [formationId, row] of desired)
    await ctx.db.insert(
      "boardForces",
      clean({ conflictId: s.conflict._id, formationId, ...row }),
    );
  for (const e of s.equipment) {
    const record = s.state.equipmentRecords?.find((r) => r.item.id === e._id);
    if (record && JSON.stringify(record) !== JSON.stringify(e.record))
      await ctx.db.patch(e._id, { record: clean(record) });
  }
  for (const p of s.participants)
    await ctx.db.patch(
      p._id,
      clean({
        status: p.status,
        withdrawing: p.withdrawing,
        kingdom: p.kingdom,
        units: ownedUnits(s, p.playerId),
        committed: p.committed,
        banked: p.banked,
        returnedUnits: p.returnedUnits,
        returnedSpheres: p.returnedSpheres,
      }),
    );
  const { formations, arrivals, kingdoms, equipmentRecords, ...metadata } =
    s.state;
  const nextWakeAt = Math.min(
    s.conflict.nextCycleAt,
    s.conflict.weatherAt,
    ...s.state.arrivals.map((a) => s.times.get(a.id)!),
  );
  const schedule =
    eventProcessed ||
    s.conflict.revision === 0 ||
    nextWakeAt !== s.conflict.nextWakeAt;
  s.conflict.revision++;
  await ctx.db.patch(
    s.conflict._id,
    clean({
      state: { ...metadata, mergePreferences: s.mergePreferences },
      revision: s.conflict.revision,
      status: s.conflict.status,
      nextCycleAt: s.conflict.nextCycleAt,
      weatherAt: s.conflict.weatherAt,
      nextWakeAt,
      processedAt: s.conflict.processedAt,
      overtime: s.conflict.overtime,
      settledAt: s.conflict.settledAt,
      winnerId: s.conflict.winnerId,
      outcome: s.conflict.outcome,
    }),
  );
  if (s.events.length) {
    for (const event of s.events) {
      if (event.type === "highstorm")
        await notifyBoard(
          ctx,
          s,
          event.kingdom as Id<"players">,
          `storm:${event.stormId}:${event.formation}`,
          `Highstorm — ${event.formationName ?? "Army exposure"}`,
          `${event.formationName ?? event.formation} was caught in the Highstorm.\nTroop losses: ${lossSummary(event.casualties)}.\nSurvivors: ${lossSummary(event.survivors)}.`,
          s.conflict.processedAt,
          true,
        );
      if (event.type === "holdStarted")
        for (const p of s.participants.filter((p) => p.status === "active"))
          await notifyBoard(
            ctx,
            s,
            p.playerId,
            `hold:${s.state.cycle}`,
            "Command Post occupied",
            `${s.state.kingdoms.find((k) => k.id === event.kingdom)!.name} has begun a conquest hold. Ownership changes if it retains control through the next resolution.`,
            s.conflict.processedAt,
          );
    }
    // Append bounded journal chunks instead of repeatedly growing one document.
    for (let offset = 0; offset < s.events.length; offset += 100)
      await ctx.db.insert("boardCycles", {
        conflictId: s.conflict._id,
        cycle: s.state.cycle,
        at: s.conflict.processedAt,
        events: clean(s.events.slice(offset, offset + 100)),
      });
    s.events = [];
  }
  if (s.conflict.status === "active" && schedule)
    await ctx.scheduler.runAt(Math.max(Date.now(), nextWakeAt), wakeReference, {
      conflictId: s.conflict._id,
    });
}

/** One chronological event per transaction. The next wake catches up overdue work
 * without ever applying a later storm/arrival before an earlier battle. */
export async function advanceBoard(ctx: MutationCtx, s: Session, now: number) {
  if (s.conflict.status !== "active") return false;
  const at = Math.min(
    s.conflict.nextCycleAt,
    s.conflict.weatherAt,
    ...s.state.arrivals.map((a) => s.times.get(a.id)!),
  );
  if (at > now) return false;
  const resolutionDue = s.conflict.nextCycleAt <= at;
  const before = structuredClone(s.state);
  const recipients = s.participants.filter(p => p.status === "active").map(p => p.playerId);
  s.conflict.processedAt = at;
  for (const p of s.participants)
    p.kingdom.research = await completedResearch(ctx, p.playerId);
  s.state.kingdoms = s.participants.map((p) => p.kingdom);
  await applyWeather(ctx, s, at);
  applyArrivals(
    s.state,
    new Set(
      s.state.arrivals.filter((a) => s.times.get(a.id)! <= at).map((a) => a.id),
    ),
    s.events,
    s.mergePreferences,
  );
  if (s.conflict.nextCycleAt <= at) {
    for (const p of s.participants.filter((p) => p.withdrawing))
      await returnParticipant(ctx, s, p, at);
    if (
      !allForces(s).some(
        (f) => f.kingdom !== s.state.originalOwner && totalUnits(f.units) > 0,
      )
    ) {
      await finishBoard(
        ctx,
        s,
        s.conflict.ownerId,
        "all outside forces left or were defeated",
        at,
      );
    } else {
      // The 24h boundary is the end of ordinary maneuvering. Only a hold already
      // underway before that boundary earns this final response resolution.
      if (
        at >= s.conflict.deadlineAt &&
        !s.conflict.overtime &&
        !s.state.objective.hold
      )
        await finishBoard(
          ctx,
          s,
          s.conflict.ownerId,
          "deadline: owner retained plateau",
          at,
        );
      else {
        const final = at >= s.conflict.deadlineAt;
        if (final) s.conflict.overtime = true;
        const result = resolveCycle({
          state: s.state,
          cycle: s.state.cycle + 1,
          seed: `${s.conflict._id}:${s.state.cycle + 1}`,
          config: s.config,
          mergePreferences: s.mergePreferences,
        });
        s.state = result.state;
        s.events.push(...result.events);
        s.mergePreferences = {};
        if (s.state.objective.conqueredBy)
          await finishBoard(
            ctx,
            s,
            s.state.objective.conqueredBy as Id<"players">,
            "conquest",
            at,
          );
        else if (final)
          await finishBoard(
            ctx,
            s,
            s.conflict.ownerId,
            "deadline: conquest hold failed",
            at,
          );
        else if (
          !allForces(s).some(
            (f) =>
              f.kingdom !== s.state.originalOwner && totalUnits(f.units) > 0,
          )
        )
          await finishBoard(
            ctx,
            s,
            s.conflict.ownerId,
            "all outside forces defeated",
            at,
          );
      }
    }
    s.conflict.nextCycleAt += CYCLE_MS;
  }
  // Weather can annihilate the last attacker between turns.
  if (
    s.conflict.status === "active" &&
    !allForces(s).some(
      (f) => f.kingdom !== s.state.originalOwner && totalUnits(f.units) > 0,
    )
  )
    await finishBoard(
      ctx,
      s,
      s.conflict.ownerId,
      "all outside forces defeated",
      at,
    );
  if (resolutionDue) {
    const plateau = await ctx.db.get(s.conflict.plateauId);
    for (const playerId of recipients) {
      const participant = s.participants.find(p => p.playerId === playerId)!;
      const ending = s.conflict.settledAt !== undefined ? `\nConflict ended: ${s.conflict.outcome}.` : "";
      const returned = participant.status === "returned" ? `\nYour forces have returned. Units: ${lossSummary(participant.returnedUnits)}. Spheres returned at settlement/withdrawal: ${participant.returnedSpheres}.` : "";
      await notifyBoard(ctx, s, playerId, `resolution:${at}`,
        `${plateau?.name ?? "Plateau"} — resolution report`,
        resolutionReport(before, s.events, playerId) + ending + returned, at, true);
    }
  }
  await saveBoard(ctx, s, true);
  return true;
}
