import { stormSettings } from "./highstorms";
import { effectivePower, totalUnits } from "../convex/rules";
import {
  ledgerMilitaryLevel,
  presentIntelNumber,
} from "../convex/intelligenceRules";
import type { ConflictState, CycleResult, ResolverConfig } from "./types";
import { formationStats } from "./stats";
import { cargoAmount, cargoCapacity } from "./cargo";

export type MilitaryIntel = Record<string, number>;
export function battlefieldVision(state: ConflictState, viewer: string, radius = 1) {
  const visible = new Set<string>();
  for (const f of state.formations.filter(
    (f) => f.kingdom === viewer && totalUnits(f.units) > 0,
  )) {
    visible.add(f.position);
  }
  for(let step=0;step<radius;step++) {
    const previous=new Set(visible);
    for(const [a,b] of state.board.connections) {
      if(previous.has(a))visible.add(b);
      if(previous.has(b))visible.add(a);
    }
  }
  return visible;
}
export function disclosureLevel(amount: number, fogged: boolean, penalty = 1) {
  const normal = ledgerMilitaryLevel(
    Number.isFinite(amount) ? Math.max(0, Math.min(100, amount)) : 0,
  );
  const bands=[-1,0,2,3];
  return fogged ? bands[Math.max(0,bands.indexOf(normal)-penalty)] : normal;
}
/** Allowlisted transport DTO. No state spread, hidden identities, enemy orders,
 * composition, cargo, Research, arrival records or raw journal events.
 * A future authenticated query supplies authoritative viewer/rival Intel here. */
export function projectConflict(
  state: ConflictState,
  viewer: string,
  intel: MilitaryIntel,
  fog: boolean,
  config?: ResolverConfig,
) {
  if (!state.kingdoms.some((k) => k.id === viewer))
    throw Error("Unknown viewing kingdom.");
  const weather=stormSettings(config);
  const storm=state.highstorm?.active===true;
  const visible = battlefieldVision(state, viewer, storm ? weather.visionRadius : 1);
  const own = state.formations
    .filter((f) => f.kingdom === viewer)
    .map((f) => ({
      formation: structuredClone(f),
      stats: config ? formationStats(f.units, state.kingdoms.find(k => k.id === viewer)!.research, config) : undefined,
      cargo: cargoAmount(f),
      capacity: cargoCapacity(state, f),
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
      level = disclosureLevel(intel[f.kingdom] ?? 0, fog && !physical, storm ? weather.fogPenalty : 1);
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
    highstorm: storm,
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
    ownEquipmentRecords:(state.equipmentRecords??[]).filter(r=>r.item.owner===viewer).map(r=>structuredClone(r)),
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
