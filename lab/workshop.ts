import { totalUnits, unitKeys, type UnitCounts } from "../convex/rules";
import { holdOrder, splitFormation } from "../conflict-board/planning";
import type { ConflictState, Formation, Order } from "../conflict-board/types";

export function validateTroops(units: UnitCounts) {
  if (unitKeys().some(k => !Number.isSafeInteger(units[k]) || units[k] < 0) || !totalUnits(units))
    throw Error("Use nonnegative whole troop counts and at least one troop.");
}
export function queueReinforcements(state: ConflictState, formation: Formation, arrivalId: string) {
  validateTroops(formation.units);
  const {position, history, ...troops} = structuredClone(formation);
  // Arrival placement remains exclusively the resolver's responsibility.
  state.arrivals.push({id: arrivalId, cycle: state.cycle + 1, formation: troops});
}
export type WorkshopCommand = {
  kind: "edit" | "add" | "split" | "create" | "arrive" | "remove";
  name: string;
  units: UnitCounts;
  onDefeat: Order["onDefeat"];
};
/** Lab-only mutation boundary: edits are restricted to this viewer's army.
 * No rules engine or production resource/accounting changes. */
export function playerWorkshop(state: ConflictState, viewer: string, id: string, command: WorkshopCommand, uid: () => string) {
  const next = structuredClone(state);
  const f = next.formations.find(f => f.id === id && f.kingdom === viewer);
  if (!f) throw Error("Select your own army.");
  if (command.kind === "remove") {
    next.formations = next.formations.filter(g => g.id !== id);
    return {state: next, selected: next.formations.find(g => g.kingdom === viewer)?.id ?? ""};
  }
  validateTroops(command.units);
  if (command.kind === "split") {
    const child = uid();
    return {state: splitFormation(next, id, command.units, child), selected: child};
  }
  if (command.kind === "edit" || command.kind === "add") {
    const units = structuredClone(command.units);
    if (command.kind === "add") for (const k of unitKeys()) units[k] += f.units[k];
    validateTroops(units);
    f.units = units;
    f.name = command.name.trim() || f.name;
    f.order.onDefeat = command.onDefeat;
    return {state: next, selected: id};
  }
  const newArmy: Formation = {id: uid(), name: command.name.trim() || `${f.name} reinforcements`, kingdom: viewer,
    position: f.position, history: [f.position], units: structuredClone(command.units), order: {...holdOrder(), onDefeat: command.onDefeat}};
  if (command.kind === "arrive") queueReinforcements(next, newArmy, uid());
  else next.formations.push(newArmy);
  return {state: next, selected: command.kind === "create" ? newArmy.id : id};
}

/** Current square excluded: 1 is the first fallback, larger numbers are older. */
export function retreatShade(f: Pick<Formation, "history" | "position">, position: string) {
  const route = f.history.filter(p => p !== f.position).slice().reverse();
  const index = route.indexOf(position);
  return index < 0 ? null : {depth: index + 1, color: `hsl(270 40% ${44 - 26 * index / Math.max(1, route.length - 1)}%)`};
}
