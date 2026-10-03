import { cargoAmount } from "./cargo";
import {
  normalizeUnits,
  totalUnits,
  unitKeys,
  type UnitCounts,
} from "../convex/rules";
import type { Board, ConflictState, Formation, Order } from "./types";

export const holdOrder = (): Order => ({
  kind: "hold",
  route: [],
  onDefeat: "pause",
});
export function connected(board: Board, a: string, b: string) {
  return board.connections.some(
    ([x, y]) => (x === a && y === b) || (y === a && x === b),
  );
}
/** UI convenience only. Resolver never invokes pathfinding. User approves the result. */
export function proposedRoute(
  board: Board,
  from: string,
  to: string,
): string[] | null {
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const end = path[path.length - 1];
    if (end === to) return path;
    const neighbors = board.connections
      .flatMap(([a, b]) => (a === end ? [b] : b === end ? [a] : []))
      .sort();
    for (const next of neighbors) {
      // Safe areas are endpoints, never secret shortcuts through the board.
      const kind = board.positions.find((p) => p.id === next)?.kind;
      if (next !== to && (kind === "staging" || kind === "reserve")) continue;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}
export function appendHistory(history: string[], position: string) {
  const index = history.indexOf(position);
  return index < 0 ? [...history, position] : history.slice(0, index + 1);
}
export function splitFormation(
  state: ConflictState,
  id: string,
  requested: UnitCounts,
  childId: string,
): ConflictState {
  const next = structuredClone(state);
  const parent = next.formations.find((f) => f.id === id);
  if (
    !parent ||
    next.formations.some((f) => f.id === childId) ||
    next.arrivals.some((a) => a.formation.id === childId)
  )
    throw new Error("Choose an existing formation and a new child identity.");
  if (cargoAmount(parent))
    throw Error(
      "This formation is carrying Raid cargo. Bank or resolve the cargo before splitting.",
    );
  const units = normalizeUnits(requested);
  for (const key of unitKeys())
    if (
      !Number.isSafeInteger(requested[key] ?? 0) ||
      (requested[key] ?? 0) < 0 ||
      units[key] > parent.units[key]
    )
      throw new Error("Split counts must be whole, available troops.");
  if (!totalUnits(units) || totalUnits(units) >= totalUnits(parent.units))
    throw new Error("Leave troops in both formations.");
  for (const key of unitKeys()) parent.units[key] -= units[key];
  const child: Formation = {
    ...structuredClone(parent),
    id: childId,
    name: `${parent.name} detachment`,
    units,
  };
  next.formations.push(child);
  for (const foothold of Object.values(next.raidFootholds ?? {})) {
    if (foothold.occupants.includes(parent.id))
      foothold.occupants.push(child.id);
  }
  return next;
}

/** Both board drawing and advanced typed input commit the same validated order. */
export function approveRoute(
  board: Board,
  formation: Formation,
  route: string[],
  onDefeat: Order["onDefeat"],
) {
  let previous = formation.position;
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    if (!connected(board, previous, p))
      throw Error(`No connection from ${previous} to ${p}.`);
    if (
      i < route.length - 1 &&
      ["staging", "reserve"].includes(
        board.positions.find((node) => node.id === p)!.kind,
      )
    )
      throw Error("Safe areas cannot be route shortcuts.");
    previous = p;
  }
  formation.order = {
    kind: route.length ? "move" : "hold",
    route: [...route],
    onDefeat,
  };
}

export function extendRoute(
  board: Board,
  start: string,
  route: string[],
  target: string,
): string[] {
  const full = [start, ...route];
  if (target === full.at(-1)) return [...route];
  if (full.length > 1 && target === full.at(-2)) return route.slice(0, -1);
  const next = [...route, target];
  approveRoute(board, { position: start } as Formation, next, "pause");
  return next;
}
