import { totalUnits, unitPlunder } from "../convex/rules";
import type { ConflictState, Formation, Event } from "./types";
export const DEFAULT_TREASURY = 50000;
export const cargoAmount = (f: Pick<Formation, "cargo">) =>
  typeof f.cargo === "number"
    ? f.cargo
    : Object.values(f.cargo ?? {}).reduce((a, b) => a + b, 0);
export const cargoCapacity = (s: ConflictState, f: Formation) =>
  Math.max(
    0,
    unitPlunder(f.units, s.kingdoms.find((k) => k.id === f.kingdom)!.research),
  );
export const combineCargo = (rows: Pick<Formation, "cargo">[]) =>
  rows.reduce((n, f) => n + cargoAmount(f), 0);
export function cargoEvent(
  events: Event[],
  f: Formation,
  action: Extract<Event, { type: "cargo" }>["action"],
  reason: string,
  amount = cargoAmount(f),
  extra: { ratio?: number; dropRate?: number } = {},
) {
  if (amount > 0)
    events.push({
      type: "cargo",
      action,
      formation: f.id,
      kingdom: f.kingdom,
      amount,
      reason,
      ...extra,
    });
}
function unclaimed(
  s: ConflictState,
  f: Formation,
  amount: number,
  events: Event[],
  reason: string,
) {
  if (amount <= 0) return;
  s.cargoLost = (s.cargoLost ?? 0) + amount;
  cargoEvent(events, f, "lost", reason, amount);
}
export function limitCargo(
  s: ConflictState,
  f: Formation,
  events: Event[],
  reason: string,
) {
  const amount = cargoAmount(f),
    overflow = Math.max(0, amount - cargoCapacity(s, f));
  if (!overflow) return;
  f.cargo = amount - overflow;
  cargoEvent(events, f, "dropped", reason, overflow);
  unclaimed(
    s,
    f,
    overflow,
    events,
    "Capacity overflow enters the unclaimed pool; it is not offered for capture.",
  );
}
export function defeatCargoRate(winnerPower: number, loserPower: number) {
  const ratio = loserPower > 0 ? winnerPower / loserPower : Infinity;
  return ratio >= 3 ? 1 : ratio >= 2 ? 0.75 : ratio >= 1.5 ? 0.5 : 0.25;
}
/** Power snapshots precede casualties. Cargo still holds its pre-battle amount.
 * Temporary winning movement groups share capacity, without changing their routes.
 * Proportional bookkeeping keeps every group within capacity until the final merge. */
export function battleCargo(
  s: ConflictState,
  local: Formation[],
  winner: string | null,
  events: Event[],
  powers: ReadonlyMap<string, number>,
) {
  const rows = [...local].sort((a, b) => a.id.localeCompare(b.id));
  let dropped = 0;
  for (const f of rows) {
    const before = cargoAmount(f);
    if (!before) continue;
    const dead = !totalUnits(f.units);
    const defeated = winner !== null && f.kingdom !== winner;
    const own = powers.get(f.kingdom) ?? 0,
      winning = powers.get(winner ?? "") ?? 0;
    const rate = dead ? 1 : defeated ? defeatCargoRate(winning, own) : 0;
    const amount = before * rate;
    f.cargo = before - amount;
    dropped += amount;
    if (dead)
      cargoEvent(
        events,
        f,
        "annihilated",
        "Carrier annihilated; all cargo dropped.",
        amount,
      );
    cargoEvent(
      events,
      f,
      "dropped",
      dead ? "Annihilation" : "Defeat band from pre-casualty kingdom Power.",
      amount,
      {
        dropRate: rate,
        ...(defeated && own > 0 ? { ratio: winning / own } : {}),
      },
    );
    if (!dead)
      limitCargo(
        s,
        f,
        events,
        "Surviving capacity is below cargo remaining after defeat loss.",
      );
  }
  if (!dropped) return;
  const recipients = rows.filter(
    (f) => f.kingdom === winner && totalUnits(f.units),
  );
  const spaces = recipients.map((f) =>
    Math.max(0, cargoCapacity(s, f) - cargoAmount(f)),
  );
  const available = spaces.reduce((a, b) => a + b, 0),
    captured = Math.min(available, dropped);
  // One kingdom-level award; internal shares are never a player transfer action.
  let remaining = captured;
  const eligible = recipients.filter((_, i) => spaces[i] > 0);
  for (let i = 0; i < eligible.length; i++) {
    const f = eligible[i],
      space = Math.max(0, cargoCapacity(s, f) - cargoAmount(f));
    const share =
      i === eligible.length - 1
        ? Math.min(space, remaining)
        : Math.min(space, (captured * space) / available);
    f.cargo = cargoAmount(f) + share;
    remaining -= share;
  }
  const awarded = captured - remaining;
  if (recipients.length)
    cargoEvent(
      events,
      recipients[0],
      "captured",
      "Winning kingdom captures cargo using its combined available capacity.",
      awarded,
    );
  unclaimed(
    s,
    recipients[0] ?? rows[0],
    dropped - awarded,
    events,
    "Dropped cargo not carried by a surviving winner enters the unclaimed pool.",
  );
}
export function settleCargo(
  s: ConflictState,
  formations: Formation[],
  events: Event[],
) {
  for (const f of formations) {
    const amount = cargoAmount(f);
    if (!amount) continue;
    if (f.kingdom !== s.originalOwner && f.position === s.board.approach) {
      s.raidValues ??= {};
      s.raidValues[f.kingdom] = (s.raidValues[f.kingdom] ?? 0) + amount;
      cargoEvent(events, f, "banked", "Reached own staging; cargo banked.");
      f.cargo = 0;
    } else if (
      f.kingdom === s.originalOwner &&
      f.position === s.board.objective &&
      s.objective.controller === s.originalOwner
    ) {
      s.treasury = (s.treasury ?? DEFAULT_TREASURY) + amount;
      s.recovered = (s.recovered ?? 0) + amount;
      cargoEvent(
        events,
        f,
        "recovered",
        "Defender deposits carried cargo at its controlled Command Post, regardless of source.",
      );
      f.cargo = 0;
    }
  }
}
export function settleUnclaimed(s: ConflictState, events: Event[]) {
  const amount = s.cargoLost ?? 0;
  if (!amount) return;
  s.cargoDestroyed = (s.cargoDestroyed ?? 0) + amount;
  s.cargoLost = 0;
  events.push({
    type: "cargo",
    action: "destroyed",
    formation: "conflict",
    amount,
    reason:
      "Conflict ended: remaining unclaimed Spheres destroyed; historical total retained.",
  });
}
