import { totalUnits, unitPlunder } from "../convex/rules";
import type { ConflictState, Formation, Event } from "./types";

export const DEFAULT_TREASURY = 50000;
export const cargoAmount = (f: Pick<Formation, "cargo">) =>
  Object.values(f.cargo ?? {}).reduce((a, b) => a + b, 0);
export const cargoCapacity = (state: ConflictState, f: Formation) =>
  Math.max(
    0,
    unitPlunder(
      f.units,
      state.kingdoms.find((k) => k.id === f.kingdom)!.research,
    ),
  );
export function combineCargo(rows: Pick<Formation, "cargo">[]) {
  const cargo: Record<string, number> = {};
  for (const row of rows)
    for (const [owner, amount] of Object.entries(row.cargo ?? {}))
      cargo[owner] = (cargo[owner] ?? 0) + amount;
  return Object.fromEntries(
    Object.entries(cargo)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export function cargoEvent(
  events: Event[],
  f: Formation,
  action: Extract<Event, { type: "cargo" }>["action"],
  reason: string,
  cargo = f.cargo ?? {},
) {
  events.push({
    type: "cargo",
    action,
    formation: f.id,
    amount: cargoAmount({ cargo }),
    cargo: { ...cargo },
    reason,
  });
}
/** Proportional provenance retention avoids favoring a source kingdom. */
export function limitCargo(
  state: ConflictState,
  f: Formation,
  events: Event[],
  reason: string,
) {
  const amount = cargoAmount(f),
    capacity = cargoCapacity(state, f);
  if (amount <= capacity) return;
  const lost: Record<string, number> = {};
  for (const [owner, n] of Object.entries(f.cargo!)) {
    const retained = (n * capacity) / amount;
    f.cargo![owner] = retained;
    lost[owner] = n - retained;
  }
  state.cargoLost = (state.cargoLost ?? 0) + amount - capacity;
  cargoEvent(events, f, "lost", reason, lost);
}
/** Called after all casualty draws, before dead formations are removed. */
export function battleCargo(
  state: ConflictState,
  local: Formation[],
  winner: string | null,
  events: Event[],
) {
  const dead = local.filter((f) => !totalUnits(f.units) && cargoAmount(f) > 0);
  for (const f of local.filter((f) => totalUnits(f.units)))
    limitCargo(
      state,
      f,
      events,
      "Casualties reduced carrying capacity; overflow is lost.",
    );
  const recipients = local.filter(
    (f) => f.kingdom === winner && totalUnits(f.units),
  );
  for (const f of dead)
    cargoEvent(
      events,
      f,
      "annihilated",
      "Carrier annihilated; cargo awaits battle settlement.",
    );
  const salvage = combineCargo(dead);
  for (const f of dead) f.cargo = {};
  if (!cargoAmount({ cargo: salvage })) return;
  if (recipients.length !== 1) {
    state.cargoLost = (state.cargoLost ?? 0) + cargoAmount({ cargo: salvage });
    cargoEvent(
      events,
      dead[0],
      "lost",
      "No single surviving winning formation; cargo lost.",
      salvage,
    );
    return;
  }
  const receiver = recipients[0],
    available = Math.max(
      0,
      cargoCapacity(state, receiver) - cargoAmount(receiver),
    );
  const fraction = Math.min(1, available / cargoAmount({ cargo: salvage }));
  const captured = Object.fromEntries(
    Object.entries(salvage).map(([k, n]) => [k, n * fraction]),
  );
  const lost = Object.fromEntries(
    Object.entries(salvage).map(([k, n]) => [k, n * (1 - fraction)]),
  );
  receiver.cargo = combineCargo([receiver, { cargo: captured }]);
  cargoEvent(
    events,
    receiver,
    "captured",
    "Captured cargo retains its original owner.",
    captured,
  );
  if (fraction < 1) {
    state.cargoLost = (state.cargoLost ?? 0) + cargoAmount({ cargo: lost });
    cargoEvent(
      events,
      receiver,
      "lost",
      "Captured cargo exceeded available capacity.",
      lost,
    );
  }
}
export function settleCargo(
  state: ConflictState,
  formations: Formation[],
  events: Event[],
) {
  for (const f of formations) {
    if (!cargoAmount(f)) continue;
    if (
      f.kingdom !== state.originalOwner &&
      f.position === state.board.approach
    ) {
      state.raidValues ??= {};
      state.raidValues[f.kingdom] =
        (state.raidValues[f.kingdom] ?? 0) + cargoAmount(f);
      cargoEvent(events, f, "banked", "Reached own staging; cargo banked.");
      f.cargo = {};
    } else if (
      f.kingdom === state.originalOwner &&
      f.position === state.board.objective &&
      state.objective.controller === state.originalOwner
    ) {
      const amount = f.cargo?.[state.originalOwner] ?? 0;
      if (!amount) continue;
      state.treasury = (state.treasury ?? DEFAULT_TREASURY) + amount;
      state.recovered = (state.recovered ?? 0) + amount;
      cargoEvent(
        events,
        f,
        "recovered",
        "Own cargo restored at controlled Command Post.",
        { [state.originalOwner]: amount },
      );
      delete f.cargo![state.originalOwner];
    }
  }
}
