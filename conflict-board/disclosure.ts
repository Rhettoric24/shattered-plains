import { effectivePower, totalUnits } from "../convex/rules";
import {
  ledgerMilitaryLevel,
  presentIntelNumber,
} from "../convex/intelligenceRules";
import type { ConflictState, CycleResult } from "./types";

export type MilitaryIntel = Record<string, number>;
export function battlefieldVision(state: ConflictState, viewer: string) {
  const visible = new Set<string>();
  for (const f of state.formations.filter(
    (f) => f.kingdom === viewer && totalUnits(f.units) > 0,
  )) {
    visible.add(f.position);
    for (const [a, b] of state.board.connections) {
      if (a === f.position) visible.add(b);
      if (b === f.position) visible.add(a);
    }
  }
  return visible;
}
export function disclosureLevel(amount: number, fogged: boolean) {
  const normal = ledgerMilitaryLevel(
    Number.isFinite(amount) ? Math.max(0, Math.min(100, amount)) : 0,
  );
  return fogged ? (normal === 3 ? 2 : normal === 2 ? 0 : -1) : normal;
}
/** Allowlisted transport DTO. No state spread, hidden identities, enemy orders,
 * composition, cargo, Research, arrival records or raw journal events.
 * A future authenticated query supplies authoritative viewer/rival Intel here. */
export function projectConflict(
  state: ConflictState,
  viewer: string,
  intel: MilitaryIntel,
  fog: boolean,
) {
  if (!state.kingdoms.some((k) => k.id === viewer))
    throw Error("Unknown viewing kingdom.");
  const visible = battlefieldVision(state, viewer);
  const own = state.formations
    .filter((f) => f.kingdom === viewer)
    .map((f) => ({
      formation: structuredClone(f),
      power: effectivePower(
        f.units,
        state.kingdoms.find((k) => k.id === viewer)!.research,
      ),
    }));
  const contacts: {
    kingdom: string;
    position: string;
    power: ReturnType<typeof presentIntelNumber>;
    physicallyVisible: boolean;
    level: number;
  }[] = [];
  for (const f of state.formations) {
    if (f.kingdom === viewer || !totalUnits(f.units)) continue;
    const physical = visible.has(f.position),
      level = disclosureLevel(intel[f.kingdom] ?? 0, fog && !physical);
    if (level < 0) continue;
    contacts.push({
      kingdom: f.kingdom,
      position: f.position,
      power: presentIntelNumber(
        effectivePower(
          f.units,
          state.kingdoms.find((k) => k.id === f.kingdom)!.research,
        ),
        level,
      ),
      physicallyVisible: physical,
      level,
    });
  }
  return {
    cycle: state.cycle,
    viewer,
    kingdoms: state.kingdoms.map((k) => ({
      id: k.id,
      name: k.name,
      color: k.color,
    })),
    board: structuredClone(state.board),
    visiblePositions: [...visible].sort(),
    fog,
    own,
    contacts,
    ownArrivals: state.arrivals
      .filter((a) => a.formation.kingdom === viewer)
      .map((a) => structuredClone(a)),
    raidReady: Object.entries(state.raidFootholds ?? {})
      .filter(([, h]) => h.kingdom === viewer && viewer !== state.originalOwner)
      .map(([position, h]) => ({
        position,
        ready: h.establishedCycle <= state.cycle,
      })),
  };
}
export type ConflictView = ReturnType<typeof projectConflict>;
/** Conservative first player journal: own battle results only. Do not expose
 * event counts or other players' actions via raw debug reports. */
export function projectJournal(history: CycleResult[], viewer: string) {
  return history.flatMap((r) =>
    r.events.flatMap((e) => {
      if (e.type !== "battle") return [];
      const own = e.forces.find((f) => f.kingdom === viewer);
      return own
        ? [
            {
              cycle: r.state.cycle,
              position: e.position,
              won: e.winner === viewer,
              casualties: structuredClone(own.casualties),
              survivors: structuredClone(own.survivors),
            },
          ]
        : [];
    }),
  );
}
