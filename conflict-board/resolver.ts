import {
  battleCargo,
  cargoAmount,
  cargoEvent,
  combineCargo,
  limitCargo,
  settleCargo,
  settleUnclaimed,
} from "./cargo";
import {
  addUnits,
  ARMY_RULES,
  applySurvivalLosses,
  effectivePower,
  emptyUnits,
  totalUnits,
  unitKeys,
  type UnitCounts,
} from "../convex/rules";
import { appendHistory, connected, holdOrder } from "./planning";
import { formationStats } from "./stats";
import { experimentalSurvivalLosses } from "./experimental-survival";
import { observeRaidControl, finishRaids } from "./raids";
import { validateEquipment, mergeEquipment, archiveEquipment, finishFabrialSwitches, protectWithEquipment, retainPooledEquipment, resolveFabrialLosses } from "./fabrials";
import type {
  BattleForce,
  ConflictState,
  CycleInput,
  CycleResult,
  Event,
  Formation,
  Order,
} from "./types";

type Group = Formation & {
  fought: boolean;
  speed: boolean;
  moved: boolean;
  retreatPath?: string[];
  resume?: string[];
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => compare(a.id, b.id));
const safe = (state: ConflictState, id: string) =>
  ["staging", "reserve"].includes(
    state.board.positions.find((p) => p.id === id)!.kind,
  );
const home = (state: ConflictState, kingdom: string) =>
  kingdom === state.originalOwner ? state.board.reserve : state.board.approach;
const combined = (groups: Group[]) =>
  groups.reduce((sum, g) => addUnits(sum, g.units), emptyUnits());
function by<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.entries()].sort(([a], [b]) => compare(a, b));
}
function random(seed: string) {
  let hash = 2166136261;
  for (const char of seed)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return () => {
    hash |= 0;
    hash = (hash + 0x6d2b79f5) | 0;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function validate(input: CycleInput) {
  const { state, config, cycle } = input;
  validateEquipment(state);
  if(config.fabrialLossRates!==undefined && (!Array.isArray(config.fabrialLossRates)||config.fabrialLossRates.length!==4||!config.fabrialLossRates.every(n=>Number.isFinite(n)&&n>=0&&n<=1)))throw Error("Fabrial loss percentages must each be between 0 and 100.");
  if (config.cargoDropRates !== undefined && (!Array.isArray(config.cargoDropRates) || config.cargoDropRates.length !== 4 || !config.cargoDropRates.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) throw Error("Cargo drop percentages must each be between 0 and 100.");
  if (
    config.combatModel !== undefined &&
    !["current", "experimental-survival"].includes(config.combatModel)
  )
    throw new Error("Unknown Lab combat model.");
  if (
    config.raidCap !== undefined &&
    (!Number.isFinite(config.raidCap) || config.raidCap < 0)
  )
    throw new Error("Raid cap must be a nonnegative number.");
  if (!Number.isSafeInteger(cycle) || cycle !== state.cycle + 1)
    throw new Error(
      "Cycle must be exactly the next cycle. Duplicate/stale requests are rejected.",
    );
  if (state.objective.conqueredBy)
    throw new Error(
      "This scenario has completed conquest. Reset or edit a new scenario.",
    );
  if (
    state.treasury !== undefined &&
    (!Number.isFinite(state.treasury) || state.treasury < 0)
  )
    throw Error("Treasury must be nonnegative and finite.");
  for (const f of [
    ...state.formations,
    ...state.arrivals.map((a) => a.formation),
  ])
    for (const amount of Object.values(
      typeof f.cargo === "number" ? { amount: f.cargo } : (f.cargo ?? {}),
    ))
      if (!Number.isFinite(amount) || amount < 0) throw Error("Invalid cargo.");
  const unique = (ids: string[]) =>
    ids.every(Boolean) && new Set(ids).size === ids.length;
  if (
    !unique(state.board.positions.map((p) => p.id)) ||
    !unique(state.kingdoms.map((k) => k.id)) ||
    !unique([
      ...state.formations.map((f) => f.id),
      ...state.arrivals.map((a) => a.formation.id),
    ])
  )
    throw new Error(
      "Position, kingdom and formation identities must be unique.",
    );
  const positions = new Set(state.board.positions.map((p) => p.id)),
    kingdoms = new Set(state.kingdoms.map((k) => k.id));
  if (
    !kingdoms.has(state.originalOwner) ||
    ![state.board.objective, state.board.approach, state.board.reserve].every(
      (p) => positions.has(p),
    )
  )
    throw new Error("Missing owner or board anchors.");
  if (
    state.board.connections.some(
      ([a, b]) => !positions.has(a) || !positions.has(b) || a === b,
    )
  )
    throw new Error("Invalid board connection.");
  const counts = (f: Pick<Formation, "units" | "kingdom">) => {
    if (!kingdoms.has(f.kingdom)) throw new Error("Unknown formation kingdom.");
    for (const key of unitKeys())
      if (!Number.isSafeInteger(f.units[key]) || f.units[key] < 0)
        throw new Error("Troop counts must be nonnegative safe integers.");
  };
  for (const f of state.formations) {
    counts(f);
    if (
      !positions.has(f.position) ||
      f.history.at(-1) !== f.position ||
      new Set(f.history).size !== f.history.length ||
      f.history.some((p) => !positions.has(p)) ||
      f.history
        .slice(1)
        .some((p, i) => !connected(state.board, f.history[i], p))
    )
      throw new Error("Invalid formation position or retreat history.");
  }
  for (const a of state.arrivals) {
    counts(a.formation);
    if (!Number.isSafeInteger(a.cycle) || a.cycle < 1)
      throw new Error("Invalid arrival cycle.");
  }
  for (const k of state.kingdoms)
    for (const v of Object.values(k.research))
      if (!Number.isSafeInteger(v) || v < 0)
        throw new Error("Research ranks must be nonnegative integers.");
  const s = config.specialization,
    c = config.casualties;
  if (
    ![s.speedScale, s.surviveScale, s.plunderScale, s.minimum].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    !Number.isFinite(s.dominance) ||
    s.dominance < 0.5 ||
    s.dominance >= 1
  )
    throw new Error("Invalid specialization configuration.");
  if (
    ![c.factor, c.minimum, c.maximum].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
    c.minimum > c.maximum ||
    c.maximum > 1 ||
    (c.surviveCap !== null &&
      (!Number.isFinite(c.surviveCap) || c.surviveCap < 0))
  )
    throw new Error("Invalid casualty configuration.");
}
function distributeCasualties(
  groups: Group[],
  casualties: UnitCounts,
  seed: string,
) {
  // One kingdom-wide casualty lottery, then fair seeded assignment back to
  // temporary movement groups. Splitting never adds extra casualty rolls.
  const rows = sorted(groups),
    roll = random(seed);
  for (const key of unitKeys()) {
    let remaining = rows.reduce((sum, g) => sum + g.units[key], 0);
    for (let loss = 0; loss < casualties[key]; loss++) {
      let pick = Math.floor(roll() * remaining);
      for (const group of rows) {
        if (pick < group.units[key]) {
          group.units[key]--;
          break;
        }
        pick -= group.units[key];
      }
      remaining--;
    }
  }
}
function updateControl(
  state: ConflictState,
  groups: Group[],
  step: number,
  events: Event[],
) {
  const controller =
    groups.find(
      (g) =>
        g.position === state.board.objective &&
        !g.retreatPath &&
        totalUnits(g.units),
    )?.kingdom ??
    (groups.some(
      (g) =>
        g.position === state.board.objective &&
        g.kingdom === state.objective.controller &&
        (g.retreatPath || !totalUnits(g.units)),
    )
      ? null
      : state.objective.controller);
  if (controller === state.objective.controller) return;
  events.push({
    type: "control",
    step,
    from: state.objective.controller,
    to: controller,
  });
  if (state.objective.hold && state.objective.hold.kingdom !== controller) {
    events.push({ type: "holdBroken", kingdom: state.objective.hold.kingdom });
    delete state.objective.hold;
  }
  state.objective.controller = controller;
}
function resolveRetreats(
  state: ConflictState,
  groups: Group[],
  step: number,
  events: Event[],
) {
  let pending = groups.filter((g) => g.retreatPath && totalUnits(g.units));
  const occupied = new Map(
    groups
      .filter(
        (g) =>
          !g.retreatPath && totalUnits(g.units) && !safe(state, g.position),
      )
      .map((g) => [g.position, g.kingdom]),
  );
  while (pending.length) {
    const claims = new Map<string, Group[]>();
    for (const g of pending) {
      while (g.retreatPath!.length) {
        const p = g.retreatPath!.at(-1)!;
        if (
          p !== g.position &&
          (safe(state, p) || !occupied.has(p) || occupied.get(p) === g.kingdom)
        )
          break;
        g.retreatPath!.pop();
      }
      const target = g.retreatPath!.at(-1) ?? home(state, g.kingdom);
      claims.set(target, [...(claims.get(target) ?? []), g]);
    }
    const again: Group[] = [];
    for (const [target, claimants] of [...claims].sort(([a], [b]) =>
      compare(a, b),
    )) {
      const kingdoms = [...new Set(claimants.map((g) => g.kingdom))].sort();
      if (!safe(state, target) && kingdoms.length > 1) {
        events.push({
          type: "retreatCollision",
          step,
          position: target,
          kingdoms,
        });
        for (const g of claimants) {
          g.retreatPath!.pop();
          again.push(g);
        }
        continue;
      }
      for (const g of sorted(claimants)) {
        const from = g.position;
        g.position = target;
        g.moved = true;
        g.history = g.retreatPath!.length ? [...g.retreatPath!] : [target];
        if (g.order.kind === "move" && g.order.onDefeat === "continue") {
          const original = g.resume!;
          const index = original.indexOf(target);
          if (index >= 0) g.order.route = original.slice(index + 1);
          else {
            g.order = { ...holdOrder(), paused: true };
            events.push({
              type: "order",
              formation: g.id,
              reason:
                "Objective paused: staging fallback is outside the approved route. No automatic rerouting.",
            });
          }
        } else g.order = { ...holdOrder(), paused: true };
        events.push({
          type: "retreat",
          step,
          formation: g.id,
          from,
          to: target,
          history: [...g.history],
        });
        events.push({
          type: "order",
          formation: g.id,
          reason:
            g.order.kind === "move"
              ? "Standing objective remains active after defeat."
              : "Standing objective paused after defeat.",
        });
        if (cargoAmount(g))
          cargoEvent(
            events,
            g,
            "routed",
            "Routed survivor retains cargo subject to surviving capacity.",
          );
        delete g.retreatPath;
        delete g.resume;
      }
      if (!safe(state, target)) occupied.set(target, claimants[0].kingdom);
    }
    pending = again;
  }
}
function movementStep(
  input: CycleInput,
  state: ConflictState,
  groups: Group[],
  step: number,
  events: Event[],
) {
  const previous = new Map(groups.map((g) => [g.id, g.position]));
  for (const g of sorted(groups)) {
    if (
      g.fought ||
      (step === 2 && !g.speed) ||
      g.order.kind !== "move" ||
      !g.order.route.length
    )
      continue;
    const to = g.order.route.shift()!;
    events.push({ type: "move", step, formation: g.id, from: g.position, to });
    g.position = to;
    g.moved = true;
  }
  const retreating = new Set<string>();
  for (const [position, local] of by(
    groups.filter((g) => totalUnits(g.units)),
    (g) => g.position,
  )) {
    const kingdoms = by(local, (g) => g.kingdom);
    if (safe(state, position) || kingdoms.length < 2) continue;
    const powers = kingdoms.map(([kingdom, rows]) => ({
      kingdom,
      rows,
      power: effectivePower(
        combined(rows),
        state.kingdoms.find((k) => k.id === kingdom)!.research,
      ),
    }));
    const top = Math.max(...powers.map((p) => p.power));
    const leaders = powers.filter((p) => p.power === top);
    const winner = leaders.length === 1 ? leaders[0].kingdom : null;
    const sum = powers.reduce((n, p) => n + p.power, 0);
    const forces: BattleForce[] = [];
    for (const p of powers) {
      const research = state.kingdoms.find((k) => k.id === p.kingdom)!.research;
      const experimental = input.config.combatModel === "experimental-survival";
      const c = experimental
          ? {
              factor: ARMY_RULES.baseCasualtyFactor,
              minimum: ARMY_RULES.minimumBaseCasualtyRate,
              maximum: ARMY_RULES.maximumBaseCasualtyRate,
              surviveCap: null,
            }
          : input.config.casualties,
        hostilePower = sum - p.power;
      const baseRate =
        hostilePower <= 0
          ? 0
          : p.power <= 0
            ? c.maximum
            : Math.min(
                c.maximum,
                Math.max(c.minimum, (c.factor * hostilePower) / p.power),
              );
      const seed = JSON.stringify([
        state.id,
        input.cycle,
        input.seed,
        step,
        position,
        p.kingdom,
      ]);
      const rawResult = experimental
        ? experimentalSurvivalLosses(combined(p.rows), baseRate, seed, research)
        : applySurvivalLosses(
            combined(p.rows),
            baseRate,
            seed,
            research,
            false,
            c.surviveCap ?? undefined,
          );
      const protectedResult=protectWithEquipment(state,p.rows,rawResult,input.cycle,events,input.config.consumeFabrialPerEngagement===true);
      const result={...rawResult,...protectedResult};
      distributeCasualties(p.rows, result.casualties, seed + ":allocation");
      retainPooledEquipment(p.rows);
      resolveFabrialLosses(state,p.rows,{cycle:input.cycle,step,position,seed:input.seed,winnerPower:top,ownPower:p.power,defeated:winner!==null&&p.kingdom!==winner,rates:input.config.fabrialLossRates},events);
      forces.push({
        kingdom: p.kingdom,
        power: p.power,
        hostilePower,
        baseRate,
        finalRate: result.finalCasualtyRate,
        casualties: result.casualties,
        survivors: result.survivors,
      });
      for (const g of p.rows) {
        g.fought = true;
        if (p.kingdom !== winner) {
          // Before append: movers may fall back to their departure square;
          // stationary losers must leave the position they just lost.
          g.retreatPath =
            previous.get(g.id) === position
              ? g.history.slice(0, -1)
              : [...g.history];
          g.resume = [
            ...g.history,
            ...(g.history.at(-1) === position ? [] : [position]),
            ...g.order.route,
          ];
          retreating.add(g.id);
        }
      }
    }
    battleCargo(
      state,
      local,
      winner,
      events,
      new Map(powers.map((p) => [p.kingdom, p.power])),
      input.config.cargoDropRates,
    );
    const annihilated =
      winner !== null &&
      !totalUnits(forces.find((f) => f.kingdom === winner)!.survivors);
    events.push({
      type: "battle",
      combatModel: input.config.combatModel ?? "current",
      step,
      position,
      forces,
      winner: annihilated ? null : winner,
      annihilated,
    });
  }
  for (const g of groups)
    if (!retreating.has(g.id) && totalUnits(g.units))
      g.history = appendHistory(g.history, g.position);
  // Observe displacement before retreat landings or later substeps can retake it.
  observeRaidControl(state, groups, input.cycle, events);
  updateControl(state, groups, step, events);
  resolveRetreats(state, groups, step, events);
  updateControl(state, groups, step, events);
  observeRaidControl(state, groups, input.cycle, events);
  settleCargo(
    state,
    groups.filter((g) => totalUnits(g.units)),
    events,
  );
  for(const g of groups.filter(g=>!totalUnits(g.units)))archiveEquipment(state,g,input.cycle,events);
  return groups.filter((g) => totalUnits(g.units));
}
function mergeGroups(
  input: CycleInput,
  state: ConflictState,
  groups: Group[],
  events: Event[],
): Formation[] {
  return by(groups, (g) => JSON.stringify([g.kingdom, g.position]))
    .map(([, rows]) => {
      const first = rows[0];
      let source: Group | undefined;
      let reason = "Explicitly nominated fallback route/order.";
      const nominated =
        input.mergePreferences?.[`${first.kingdom}@${first.position}`];
      source = rows.find((g) => g.id === nominated);
      if (!source) {
        const residents = rows.filter((g) => !g.moved);
        if (residents.length === 1) {
          source = residents[0];
          reason = "Unique resident retains fallback route/order.";
        } else if (
          rows.every(
            (g) =>
              JSON.stringify([g.history, g.order]) ===
              JSON.stringify([first.history, first.order]),
          )
        ) {
          source = first;
          reason = "Identical routes/orders preserved.";
        } else
          reason =
            "Unexpected convergence: Hold; current position becomes the new retreat-history root.";
      }
      if (rows.length === 1) source = first;
      const id =
        rows.length === 1
          ? first.id
          : `merged:${JSON.stringify([state.id, input.cycle, first.kingdom, first.position])}`;
      const order: Order = source ? structuredClone(source.order) : holdOrder();
      if (order.kind === "move" && !order.route.length) {
        Object.assign(order, holdOrder());
        events.push({
          type: "order",
          formation: id,
          reason: "Destination reached; now holding.",
        });
      }
      const result: Formation = {
        id,
        name:
          rows.length === 1
            ? first.name
            : `${state.kingdoms.find((k) => k.id === first.kingdom)!.name} · ${state.board.positions.find((p) => p.id === first.position)!.name}`,
        kingdom: first.kingdom,
        position: first.position,
        units: combined(rows),
        history: source ? [...source.history] : [first.position],
        order,
      };
      const equipment=mergeEquipment(rows);
      if(equipment)result.equipment=equipment;
      if (rows.some((g) => g.cargo !== undefined))
        result.cargo = combineCargo(rows);
      limitCargo(state, result, events, "Merged capacity overflow is lost.");
      if (rows.length > 1)
        events.push({
          type: "merge",
          position: first.position,
          kingdom: first.kingdom,
          sources: rows.map((g) => g.id).sort(),
          formation: id,
          routeSource: source?.id ?? null,
          reason,
        });
      return result;
    })
    .sort((a, b) => compare(a.id, b.id));
}

/** Pure synchronous rules calculation. No clocks, I/O, database or global RNG.
 * A future server adapter must atomically persist this result keyed by conflict
 * and cycle; the pure function alone is not a persistence/idempotency layer. */
export function resolveCycle(input: CycleInput): CycleResult {
  validate(input);
  const state = structuredClone(input.state),
    events: Event[] = [];
  for(const f of state.formations.filter(f=>!totalUnits(f.units)))archiveEquipment(state,f,input.cycle,events);
  for (const f of sorted(state.formations))
    limitCargo(
      state,
      f,
      events,
      "Current capacity overflow is lost (including scientist edits).",
    );
  observeRaidControl(state, state.formations, input.cycle, events);
  state.kingdoms = sorted(state.kingdoms);
  state.board.positions = sorted(state.board.positions);
  state.board.connections = state.board.connections
    .map(([a, b]) => [a, b].sort() as [string, string])
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const garrison = state.formations.filter(
    (f) =>
      f.kingdom === state.originalOwner &&
      f.position === state.board.objective &&
      totalUnits(f.units),
  );
  const nominatedGarrison =
    input.mergePreferences?.[`${state.originalOwner}@${state.board.objective}`];
  const arrivalRecipient =
    garrison.find((f) => f.id === nominatedGarrison) ??
    (garrison.length === 1 ? garrison[0] : undefined);
  const arrivals = sorted(state.arrivals.filter((a) => a.cycle <= input.cycle));
  if(arrivalRecipient) {
    const joining=arrivals.filter(a=>a.formation.kingdom===state.originalOwner && state.objective.controller===state.originalOwner);
    const equipment=mergeEquipment([arrivalRecipient,...joining.map(a=>a.formation)]);
    if(equipment)arrivalRecipient.equipment=equipment;
  }
  for (const a of arrivals) {
    const position =
      a.formation.kingdom === state.originalOwner
        ? state.objective.controller === state.originalOwner
          ? state.board.objective
          : state.board.reserve
        : state.board.approach;
    events.push({ type: "arrival", formation: a.formation.id, position });
    if (position === state.board.objective && arrivalRecipient) {
      if (a.formation.cargo)
        arrivalRecipient.cargo = combineCargo([arrivalRecipient, a.formation]);
      arrivalRecipient.units = addUnits(
        arrivalRecipient.units,
        a.formation.units,
      );
      events.push({
        type: "merge",
        position,
        kingdom: state.originalOwner,
        sources: [arrivalRecipient.id, a.formation.id].sort(),
        formation: arrivalRecipient.id,
        routeSource: arrivalRecipient.id,
        reason:
          "Defender arrival joins the unique or nominated garrison before movement; its route/order is retained.",
      });
    } else
      state.formations.push({ ...a.formation, position, history: [position] });
  }
  state.arrivals = sorted(state.arrivals.filter((a) => a.cycle > input.cycle));
  let groups: Group[] = sorted(state.formations)
    .filter((f) => totalUnits(f.units))
    .map((f) => {
      const research = state.kingdoms.find((k) => k.id === f.kingdom)!.research;
      let previous = f.position;
      const valid = f.order.route.every((p, i) => {
        const yes =
          connected(state.board, previous, p) &&
          (!safe(state, p) || i === f.order.route.length - 1);
        previous = p;
        return yes;
      });
      if (f.order.kind === "move" && !valid) {
        f.order = { ...holdOrder(), paused: true };
        events.push({
          type: "order",
          formation: f.id,
          reason: "Invalid approved route; paused without automatic rerouting.",
        });
      }
      return {
        ...f,
        speed:
          formationStats(f.units, research, input.config).specialization ===
          "Speed",
        fought: false,
        moved: false,
      };
    });
  groups = movementStep(input, state, groups, 1, events);
  groups = movementStep(input, state, groups, 2, events);
  state.formations = mergeGroups(input, state, groups, events);
  finishRaids(state, input.config, input.cycle, events);
  for (const f of input.state.formations.filter(
    (f) => f.order.kind === "raid",
  )) {
    if (
      !state.formations.some(
        (g) =>
          g.position === f.position &&
          g.kingdom === f.kingdom &&
          g.order.kind === "raid",
      )
    )
      events.push({
        type: "raidFailed",
        position: f.position,
        formation: f.id,
        reason:
          "Raid order no longer active at this position after retreat, destruction or merge.",
        cycle: input.cycle,
      });
  }
  const controller = state.objective.controller;
  if (controller && controller !== state.originalOwner) {
    if (
      state.objective.hold?.kingdom === controller &&
      state.objective.hold.beganCycle < input.cycle
    ) {
      state.objective.conqueredBy = controller;
      settleUnclaimed(state, events);
      events.push({ type: "conquest", kingdom: controller });
    } else if (!state.objective.hold) {
      state.objective.hold = { kingdom: controller, beganCycle: input.cycle };
      events.push({ type: "holdStarted", kingdom: controller });
    }
  }
  state.cycle = input.cycle;
  finishFabrialSwitches(state,input.cycle,events);
  validateEquipment(state);
  return {
    id: JSON.stringify([state.id, input.cycle, input.seed]),
    state,
    events,
  };
}
