import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCompetitivePlayer, requireCurrentPlayer } from "./ownership";
import {
  unitCountsValidator,
  subtractAvailableUnits,
  validateMissionUnits,
} from "./armyRules";
import {
  addUnits,
  emptyUnits,
  normalizeUnits,
  totalUnits,
  missionMsForBase,
  type UnitCounts,
} from "./rules";
import { completedResearch } from "./researchHelpers";
import { plateauCountsForPlayer } from "./plateauHelpers";
import { recordOpponentAttack } from "./seasonLedger";
import { chooseAutomaticDefense } from "./plateaus";
import { createBoard, BOARD_DEFAULTS } from "../conflict-board/board";
import {
  holdOrder,
  approveRoute,
  splitFormation,
} from "../conflict-board/planning";
import { requestFabrialSwitch } from "../conflict-board/fabrials";
import { projectConflict, projectJournal } from "../conflict-board/disclosure";
import type { ConflictState, Formation } from "../conflict-board/types";
import {
  CYCLE_MS,
  DURATION_MS,
  clean,
  loadBoard,
  requireEnabled,
  weatherDeadline,
  applyWeather,
  notifyBoard,
  saveBoard,
  advanceBoard,
  checkBudget,
  wakeReference,
  type Session,
} from "./conflictBoardState";

const conflictId = v.id("boardConflicts");
const equipmentArgs = v.array(
  v.union(
    v.literal("halfShard"),
    v.literal("painrial"),
    v.literal("soulcaster"),
  ),
);
const commandFields = {
  conflictId,
  requestId: v.string(),
  revision: v.number(),
};

function checkedUnits(raw: Partial<UnitCounts>) {
  if (Object.values(raw).some((n) => !Number.isSafeInteger(n) || n < 0))
    throw Error("Troop counts must be nonnegative whole numbers.");
  const units = normalizeUnits(raw);
  if (totalUnits(units) < 1) throw Error("Commit at least one troop.");
  return units;
}
async function replay(
  ctx: MutationCtx,
  playerId: Id<"players">,
  requestId: string,
  fingerprint: string,
) {
  if (!requestId || requestId.length > 120)
    throw Error("A request identity of at most 120 characters is required.");
  const row = await ctx.db
    .query("boardCommands")
    .withIndex("by_playerId_and_requestId", (q) =>
      q.eq("playerId", playerId).eq("requestId", requestId),
    )
    .unique();
  if (row && row.fingerprint !== fingerprint)
    throw Error("This request identity was already used for another command.");
  return row;
}
async function receipt(
  ctx: MutationCtx,
  playerId: Id<"players">,
  requestId: string,
  fingerprint: string,
  result: unknown,
) {
  await ctx.db.insert("boardCommands", {
    playerId,
    requestId,
    fingerprint,
    result: clean(result),
  });
}
async function addParticipant(
  ctx: MutationCtx,
  s: Session,
  player: Doc<"players">,
) {
  const existing = s.participants.find((p) => p.playerId === player._id);
  if (existing) {
    if (existing.withdrawing)
      throw Error("This kingdom is withdrawing from this conflict.");
    existing.status = "active";
    existing.kingdom.research = await completedResearch(ctx, player._id);
    return existing;
  }
  const scoring =
    player._id !== s.conflict.ownerId
      ? await recordOpponentAttack(ctx, player._id, s.conflict.ownerId)
      : undefined;
  const id = await ctx.db.insert(
    "boardParticipants",
    clean({
      conflictId: s.conflict._id,
      playerId: player._id,
      status: "active" as const,
      kingdom: {
        id: player._id,
        name: player.name,
        color: player._id === s.conflict.ownerId ? "#ce5757" : "#568bd1",
        research: await completedResearch(ctx, player._id),
      },
      units: emptyUnits(),
      committed: emptyUnits(),
      returnedUnits: emptyUnits(),
      banked: 0,
      returnedSpheres: 0,
      withdrawing: false,
      seasonId: scoring?.seasonId,
      chainPosition: scoring?.chainPosition,
    }),
  );
  const p = (await ctx.db.get(id))!;
  s.participants.push(p);
  s.state.kingdoms.push(p.kingdom);
  return p;
}

async function commitForce(
  ctx: MutationCtx,
  s: Session,
  playerId: Id<"players">,
  raw: Partial<UnitCounts>,
  kinds: ("halfShard" | "soulcaster" | "painrial")[],
  requestId: string,
  immediate = false,
) {
  const player = (await ctx.db.get(playerId))!;
  const units = checkedUnits(raw);
  if (kinds.length > 128)
    throw Error("This equipment request exceeds the command safety budget.");
  validateMissionUnits(player.buildings, units);
  const remaining = subtractAvailableUnits(normalizeUnits(player.units), units);
  const p = await addParticipant(ctx, s, player);
  // Preserve the core's explicit effect boundary. These devices retain physical
  // identity, but do not silently enable unapproved repeated-event effects.
  if (kinds.some((k) => k !== "halfShard"))
    throw Error(
      "Only Half-Shards have an approved live Conflict Board effect. Painrial/Soulcaster testing remains in the Lab.",
    );
  const items = [];
  for (const kind of kinds) {
    const inv = await ctx.db
      .query("playerFabrials")
      .withIndex("by_playerId_and_kind", (q) =>
        q.eq("playerId", playerId).eq("kind", kind),
      )
      .unique();
    if (!inv || inv.owned - inv.committed < 1)
      throw Error(`No available ${kind}.`);
    await ctx.db.patch(inv._id, { committed: inv.committed + 1 });
    const id = await ctx.db.insert("boardEquipment", {
      conflictId: s.conflict._id,
      playerId,
      kind,
      status: "reserved",
    });
    s.equipment.push((await ctx.db.get(id))!);
    items.push({ id: String(id), kind, owner: String(playerId) });
  }
  const id = `${playerId}:${requestId}`;
  const f: Omit<Formation, "position" | "history"> = {
    id,
    name: `${player.name}'s formation`,
    kingdom: playerId,
    units,
    order: holdOrder(),
    ...(items.length ? { equipment: { items, active: items[0].id } } : {}),
  };
  if (immediate)
    s.state.formations.push({
      ...f,
      position: s.state.board.objective,
      history: [s.state.board.objective],
    });
  else {
    const arriveAt =
      Date.now() +
      missionMsForBase(
        CYCLE_MS,
        units,
        await plateauCountsForPlayer(ctx, playerId),
        p.kingdom.research,
      );
    s.times.set(id, arriveAt);
    s.state.arrivals.push({ id, cycle: Number.MAX_SAFE_INTEGER, formation: f });
  }
  p.committed = addUnits(p.committed, units);
  checkBudget(s);
  await ctx.db.patch(playerId, { units: remaining });
  // New troops meet an ongoing storm before they can merge with exposed troops.
  await applyWeather(ctx, s, Date.now());
  return id;
}

export const open = mutation({
  args: {
    plateauId: v.id("plateaus"),
    units: unitCountsValidator,
    fabrials: equipmentArgs,
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requireCompetitivePlayer(ctx);
    const fingerprint = JSON.stringify(["open", args]);
    const old = await replay(ctx, player._id, args.requestId, fingerprint);
    if (old) return old.result;
    requireEnabled();
    const plateau = await ctx.db.get(args.plateauId);
    if (
      !plateau ||
      plateau.status !== "owned" ||
      !plateau.ownerPlayerId ||
      plateau.ownerPlayerId === player._id
    )
      throw Error("Choose a rival-owned plateau.");
    if (plateau.activeSiegeId)
      throw Error("This plateau has a legacy siege already underway.");
    if (plateau.activeConflictBoardId)
      throw Error("A conflict is already open; join it instead.");
    const owner = await ctx.db.get(plateau.ownerPlayerId);
    if (!owner || owner.isAdminObserver)
      throw Error("This kingdom is not eligible for conflict.");
    const now = Date.now(),
      escrow = Math.floor(Math.max(0, owner.spheres) * 0.1);
    const state: ConflictState = {
      id: "pending",
      cycle: 0,
      board: createBoard(),
      kingdoms: [],
      originalOwner: owner._id,
      formations: [],
      arrivals: [],
      objective: { controller: owner._id },
      treasury: escrow,
    };
    const weatherAt = await weatherDeadline(ctx, now);
    const id = await ctx.db.insert("boardConflicts", {
      plateauId: plateau._id,
      ownerId: owner._id,
      initiatorId: player._id,
      status: "active",
      createdAt: now,
      nextCycleAt: now + CYCLE_MS,
      deadlineAt: now + DURATION_MS,
      weatherAt,
      nextWakeAt: Math.min(weatherAt, now + CYCLE_MS),
      processedAt: now,
      revision: 0,
      overtime: false,
      state,
      config: BOARD_DEFAULTS,
      escrow,
    });
    const s = await loadBoard(ctx, id);
    s.state.id = id;
    await ctx.db.patch(plateau._id, {
      activeConflictBoardId: id,
      updatedAt: now,
    });
    await ctx.db.patch(owner._id, { spheres: owner.spheres - escrow });
    await addParticipant(ctx, s, owner);
    const automatic = await chooseAutomaticDefense(ctx, owner);
    if (automatic)
      await commitForce(
        ctx,
        s,
        owner._id,
        automatic.units,
        [],
        "automatic-defense",
        true,
      );
    const formationId = await commitForce(
      ctx,
      s,
      player._id,
      args.units,
      args.fabrials,
      args.requestId,
    );
    await notifyBoard(
      ctx,
      s,
      owner._id,
      "opened",
      "A conflict has opened",
      `${player.name} has declared a siege at ${plateau.name}. Other kingdoms may join.`,
      now,
    );
    await saveBoard(ctx, s);
    const result = {
      conflictId: id,
      formationId,
      revision: s.conflict.revision,
    };
    await receipt(ctx, player._id, args.requestId, fingerprint, result);
    return result;
  },
});

async function command(
  ctx: MutationCtx,
  args: {
    conflictId: Id<"boardConflicts">;
    requestId: string;
    revision: number;
  },
  kind: string,
  payload: unknown,
  run: (s: Session, player: Doc<"players">) => Promise<unknown>,
) {
  const player = await requireCompetitivePlayer(ctx),
    fingerprint = JSON.stringify([kind, payload]);
  const old = await replay(ctx, player._id, args.requestId, fingerprint);
  if (old) return old.result;
  const s = await loadBoard(ctx, args.conflictId);
  if (s.conflict.status !== "active") throw Error("This conflict has ended.");
  if (s.conflict.revision !== args.revision)
    throw Error("The battlefield changed. Refresh before issuing this order.");
  const due = Math.min(
    s.conflict.nextCycleAt,
    s.conflict.weatherAt,
    ...s.state.arrivals.map((a) => s.times.get(a.id)!),
  );
  if (due <= Date.now())
    throw Error("The next battlefield update is processing. Refresh shortly.");
  const result = await run(s, player);
  await saveBoard(ctx, s);
  const response = { revision: s.conflict.revision, result: result ?? null };
  await receipt(ctx, player._id, args.requestId, fingerprint, response);
  return response;
}
function participant(s: Session, id: string) {
  const p = s.participants.find(
    (p) => p.playerId === id && p.status === "active",
  );
  if (!p) throw Error("You are not an active participant.");
  return p;
}
function ownFormation(s: Session, playerId: string, id: string) {
  if (participant(s, playerId).withdrawing)
    throw Error("Withdrawal is pending.");
  const f = s.state.formations.find(
    (f) => f.id === id && f.kingdom === playerId,
  );
  if (!f) throw Error("Choose your own deployed formation.");
  return f;
}

export const reinforce = mutation({
  args: {
    ...commandFields,
    units: unitCountsValidator,
    fabrials: equipmentArgs,
  },
  handler: (ctx, args) =>
    command(ctx, args, "reinforce", args, async (s, p) => {
      requireEnabled();
      if (Date.now() >= s.conflict.deadlineAt)
        throw Error("The conflict is closing.");
      return await commitForce(
        ctx,
        s,
        p._id,
        args.units,
        args.fabrials,
        args.requestId,
      );
    }),
});

export const order = mutation({
  args: {
    ...commandFields,
    formationId: v.string(),
    kind: v.union(v.literal("hold"), v.literal("move"), v.literal("raid")),
    route: v.array(v.string()),
    onDefeat: v.union(v.literal("continue"), v.literal("pause")),
  },
  handler: (ctx, args) =>
    command(ctx, args, "order", args, async (s, p) => {
      if (participant(s, p._id).withdrawing)
        throw Error("Withdrawal is pending.");
      const deployed = s.state.formations.find(
        (f) => f.id === args.formationId && f.kingdom === p._id,
      );
      const arrival = s.state.arrivals.find(
        (a) =>
          a.formation.id === args.formationId && a.formation.kingdom === p._id,
      );
      if (!deployed && !arrival) throw Error("Choose your own formation.");
      const entry =
        p._id === s.state.originalOwner
          ? s.state.objective.controller === p._id
            ? s.state.board.objective
            : s.state.board.reserve
          : s.state.board.approach;
      const f = deployed ?? {
        ...arrival!.formation,
        position: entry,
        history: [entry],
      };
      if (args.route.length > 128)
        throw Error("This route exceeds the command storage safety limit.");
      if (args.kind === "move")
        approveRoute(s.state.board, f, args.route, args.onDefeat);
      else {
        if (
          args.kind === "raid" &&
          (p._id === s.state.originalOwner ||
            s.state.board.positions.find((n) => n.id === f.position)
              ?.objective !== "raid")
        )
          throw Error(
            "Raid orders require an outside force at a Raid objective.",
          );
        f.order = { kind: args.kind, route: [], onDefeat: args.onDefeat };
      }
      if (arrival) arrival.formation.order = f.order;
    }),
});
export const split = mutation({
  args: {
    ...commandFields,
    formationId: v.string(),
    units: unitCountsValidator,
    equipmentIds: v.array(v.string()),
  },
  handler: (ctx, args) =>
    command(ctx, args, "split", args, async (s, p) => {
      ownFormation(s, p._id, args.formationId);
      const units = checkedUnits(args.units);
      const id = `${p._id}:${args.requestId}`;
      s.state = splitFormation(
        s.state,
        args.formationId,
        units,
        id,
        args.equipmentIds,
      );
      checkBudget(s);
      return id;
    }),
});
export const switchFabrial = mutation({
  args: {
    ...commandFields,
    formationId: v.string(),
    itemId: v.union(v.string(), v.null()),
  },
  handler: (ctx, args) =>
    command(ctx, args, "switch", args, async (s, p) => {
      ownFormation(s, p._id, args.formationId);
      s.state = requestFabrialSwitch(
        s.state,
        p._id,
        args.formationId,
        args.itemId,
      );
    }),
});
export const chooseMergeRoute = mutation({
  args: { ...commandFields, formationId: v.string(), position: v.string() },
  handler: (ctx, args) =>
    command(ctx, args, "merge-route", args, async (s, p) => {
      ownFormation(s, p._id, args.formationId);
      if (!s.state.board.positions.some((n) => n.id === args.position))
        throw Error("Unknown position.");
      s.mergePreferences[`${p._id}@${args.position}`] = args.formationId;
    }),
});
export const withdraw = mutation({
  args: commandFields,
  handler: (ctx, args) =>
    command(ctx, args, "withdraw", args, async (s, p) => {
      participant(s, p._id).withdrawing = true;
    }),
});

export const get = query({
  args: { conflictId },
  handler: async (ctx, args) => {
    const player = await requireCurrentPlayer(ctx);
    const s = await loadBoard(ctx, args.conflictId);
    const p = s.participants.find((p) => p.playerId === player._id);
    if (!p) throw Error("Join this conflict before viewing its battlefield.");
    const intel: Record<string, number> = {};
    for (const rival of s.participants.filter(
      (p) => p.playerId !== player._id,
    )) {
      const row = await ctx.db
        .query("kingdomIntelResources")
        .withIndex("by_viewerPlayerId_and_targetPlayerId", (q) =>
          q
            .eq("viewerPlayerId", player._id)
            .eq("targetPlayerId", rival.playerId),
        )
        .unique();
      intel[rival.playerId] = row?.militaryAmount ?? row?.amount ?? 0;
    }
    const cycles = await ctx.db
      .query("boardCycles")
      .withIndex("by_conflictId_and_cycle", (q) =>
        q.eq("conflictId", s.conflict._id),
      )
      .order("desc")
      .take(12);
    return clean({
      conflictId: s.conflict._id,
      enabled: process.env.CONFLICT_BOARD_V1_ENABLED === "true",
      revision: s.conflict.revision,
      status: s.conflict.status,
      plateauId: s.conflict.plateauId,
      originalOwner: s.state.originalOwner,
      nextCycleAt: s.conflict.nextCycleAt,
      deadlineAt: s.conflict.deadlineAt,
      winnerId: s.conflict.winnerId,
      outcome: s.conflict.outcome,
      conquestHold: s.state.objective.hold ?? null,
      participantStatus: p.status,
      commandPostController: s.state.objective.controller,
      withdrawing: p.withdrawing,
      returnedUnits: p.returnedUnits,
      returnedSpheres: p.returnedSpheres,
      banked: p.banked,
      view: projectConflict(s.state, player._id, intel, true, s.config),
      ownArrivalTimes: s.state.arrivals
        .filter((a) => a.formation.kingdom === player._id)
        .map((a) => ({
          formationId: a.formation.id,
          arriveAt: s.times.get(a.id),
        })),
      journal: projectJournal(
        cycles
          .reverse()
          .map((c) => ({
            id: String(c._id),
            state: { ...s.state, cycle: c.cycle },
            events: c.events,
          })),
        player._id,
      ),
    });
  },
});
/** Route-scoped discovery: only this player's commitments and recent returns.
 * Never loads enemy forces or subscribes to all conflicts. */
export const lobby = query({
  args: {},
  handler: async (ctx) => {
    const player = await requireCurrentPlayer(ctx);
    const active = await ctx.db.query("boardParticipants")
      .withIndex("by_playerId_and_status", q => q.eq("playerId", player._id).eq("status", "active"))
      .collect();
    const recent = await ctx.db.query("boardParticipants")
      .withIndex("by_playerId_and_status", q => q.eq("playerId", player._id).eq("status", "returned"))
      .order("desc").take(10);
    const conflicts = [];
    for (const p of [...active, ...recent]) {
      const c = await ctx.db.get(p.conflictId);
      if (!c) continue;
      const plateau = await ctx.db.get(c.plateauId);
      conflicts.push({ conflictId: c._id, plateauId: c.plateauId,
        name: plateau?.name ?? "Former holding", status: c.status,
        participantStatus: p.status, nextCycleAt: c.nextCycleAt,
        deadlineAt: c.deadlineAt, outcome: c.outcome ?? null });
    }
    return { enabled: process.env.CONFLICT_BOARD_V1_ENABLED === "true", conflicts };
  },
});
/** Discovery reveals no forces/participants. Existing plateau lookup is scoped,
 * and open participation uses this revision when submitting reinforcement. */
export const atPlateau = query({
  args: { plateauId: v.id("plateaus") },
  handler: async (ctx, args) => {
    await requireCurrentPlayer(ctx);
    const plateau = await ctx.db.get(args.plateauId);
    const c = plateau?.activeConflictBoardId
      ? await ctx.db.get(plateau.activeConflictBoardId)
      : null;
    return c?.status === "active"
      ? {
          conflictId: c._id,
          revision: c.revision,
          nextCycleAt: c.nextCycleAt,
          deadlineAt: c.deadlineAt,
        }
      : null;
  },
});
export const wake = internalMutation({
  args: { conflictId },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.conflictId))) return false; // world reset cancelled the conflict
    const s = await loadBoard(ctx, args.conflictId);
    return await advanceBoard(ctx, s, Date.now());
  },
});

/** Recovery only: indexed due work, no global subscriptions or client polling. */
export const recoverDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("boardConflicts")
      .withIndex("by_status_and_nextWakeAt", (q) =>
        q.eq("status", "active").lte("nextWakeAt", Date.now()),
      )
      .take(50);
    for (const c of due)
      await ctx.scheduler.runAfter(0, wakeReference, { conflictId: c._id });
    return due.length;
  },
});

/** Development weather overrides are rare; page active conflicts only when one
 * changes. Ordinary storms already have exact scheduled start/end events. */
export const weatherChanged = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("boardConflicts")
      .withIndex("by_status_and_nextWakeAt", (q) => q.eq("status", "active"))
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    for (const c of page.page) {
      const weatherAt = Math.min(c.weatherAt, Date.now());
      await ctx.db.patch(c._id, {
        weatherAt,
        nextWakeAt: Math.min(c.nextWakeAt, weatherAt),
      });
      await ctx.scheduler.runAfter(0, wakeReference, { conflictId: c._id });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation">("conflictBoards:weatherChanged"),
        { cursor: page.continueCursor },
      );
  },
});
