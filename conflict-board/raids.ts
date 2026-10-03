import { cargoAmount, DEFAULT_TREASURY } from "./cargo";
import { totalUnits, unitPlunder } from "../convex/rules";
import type { ConflictState, Event, Formation, ResolverConfig } from "./types";

type Occupant = Formation & { retreatPath?: string[] };
export const raidPositions = (state: ConflictState) =>
  state.board.positions
    .filter((p) => p.objective === "raid")
    .sort((a, b) => a.id.localeCompare(b.id));

/** Observe surviving occupants before retreats and after each substep. Overlapping
 * occupant sets preserve continuous defense; replacing every occupier breaks it,
 * even when the replacement carries the same kingdom color. */
export function observeRaidControl(
  state: ConflictState,
  groups: Occupant[],
  cycle: number,
  events: Event[],
) {
  state.raidFootholds ??= {};
  for (const position of raidPositions(state)) {
    const local = groups.filter(
      (g) =>
        g.position === position.id && !g.retreatPath && totalUnits(g.units),
    );
    const kingdoms = new Set(local.map((g) => g.kingdom));
    const kingdom = kingdoms.size === 1 ? local[0].kingdom : null;
    const old = state.raidFootholds[position.id];
    const continuous =
      old &&
      old.kingdom === kingdom &&
      local.some((g) => old.occupants.includes(g.id));
    if (old && !continuous) {
      events.push({
        type: "raidBroken",
        position: position.id,
        kingdom: old.kingdom,
        cycle,
      });
      delete state.raidFootholds[position.id];
    }
    if (kingdom)
      state.raidFootholds[position.id] = {
        kingdom,
        establishedCycle: continuous ? old.establishedCycle : cycle,
        occupants: local.map((g) => g.id).sort(),
      };
  }
}

/** Merging changes presentation identity, not physical continuity. This is called
 * only after observing all movement/combat/retreat consequences. */
export function finishRaids(
  state: ConflictState,
  config: ResolverConfig,
  cycle: number,
  events: Event[],
) {
  state.raidValues ??= {};
  for (const position of raidPositions(state)) {
    const foothold = state.raidFootholds?.[position.id];
    if (!foothold) continue;
    const force = state.formations.find(
      (f) => f.position === position.id && f.kingdom === foothold.kingdom,
    );
    if (!force) continue;
    foothold.occupants = [force.id];
    if (force.kingdom === state.originalOwner) continue;
    if (foothold.establishedCycle === cycle)
      events.push({
        type: "raidFoothold",
        position: position.id,
        kingdom: force.kingdom,
        cycle,
      });
    else if (foothold.establishedCycle === cycle - 1)
      events.push({
        type: "raidReady",
        position: position.id,
        kingdom: force.kingdom,
        cycle,
      });
    if (force.order.kind !== "raid") continue;
    if (foothold.establishedCycle >= cycle) {
      events.push({
        type: "raidFailed",
        position: position.id,
        formation: force.id,
        reason:
          "New foothold: retain control through a subsequent resolution before raiding.",
        cycle,
      });
      continue;
    }
    const plunder = unitPlunder(
      force.units,
      state.kingdoms.find((k) => k.id === force.kingdom)!.research,
    );
    state.treasury ??= DEFAULT_TREASURY;
    const value = Math.min(
      Math.max(0, plunder - cargoAmount(force)),
      config.raidCap ?? 100,
      state.treasury,
    );
    force.cargo ??= {};
    force.cargo[state.originalOwner] =
      (force.cargo[state.originalOwner] ?? 0) + value;
    state.treasury -= value;
    if (!value)
      events.push({
        type: "raidFailed",
        position: position.id,
        formation: force.id,
        cycle,
        reason:
          state.treasury === 0
            ? "Defender Treasury empty."
            : cargoAmount(force) >= plunder
              ? "Cargo capacity reached."
              : "Raid cap is zero.",
      });
    events.push({
      type: "raid",
      position: position.id,
      kingdom: force.kingdom,
      target: state.originalOwner,
      formation: force.id,
      plunder,
      value,
      treasuryRemaining: state.treasury,
      carried: cargoAmount(force),
      capacityReached: cargoAmount(force) >= plunder,
      cycle,
    });
  }
}
