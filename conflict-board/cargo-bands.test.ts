import { it, expect } from "vitest";
import { emptyUnits } from "../convex/rules";
import { scenario, defaults } from "../lab/scenarios";
import {
  battleCargo,
  cargoAmount,
  defeatCargoRate,
  settleCargo,
} from "./cargo";
import { resolveCycle } from "./resolver";
import type { Formation, Event } from "./types";
const force = (
  id: string,
  kingdom: string,
  spearman: number,
  cargo = 0,
): Formation => ({
  id,
  name: id,
  kingdom,
  position: "B2",
  history: ["B2"],
  units: { ...emptyUnits(), spearman },
  cargo,
  order: { kind: "hold", route: [], onDefeat: "pause" },
});
it.each([
  [1, 0.25],
  [1.49, 0.25],
  [1.5, 0.5],
  [1.99, 0.5],
  [2, 0.75],
  [2.99, 0.75],
  [3, 1],
  [10, 1],
])("ratio %s drops %s", (ratio, rate) =>
  expect(defeatCargoRate(ratio * 100, 100)).toBe(rate),
);
it.each([0, 2000, 6000])(
  "capture capacity %s and additional overflow conserve all cargo",
  (capacity) => {
    const s = scenario(),
      loser = force("l", "blue", 7000, 5000),
      winner = force("w", "green", capacity * 2),
      events: Event[] = [];
    battleCargo(
      s,
      [loser, winner],
      "green",
      events,
      new Map([
        ["blue", 100],
        ["green", 110],
      ]),
    );
    expect(cargoAmount(loser)).toBe(3500);
    expect(cargoAmount(winner)).toBe(Math.min(capacity, 1250));
    expect(s.cargoLost).toBe(1500 - Math.min(capacity, 1250));
    expect(cargoAmount(loser) + cargoAmount(winner) + (s.cargoLost ?? 0)).toBe(
      5000,
    );
    expect(
      events.some((e) => e.type === "cargo" && e.action === "dropped"),
    ).toBe(true);
  },
);
it("ties drop no defeat percentage, but capacity and annihilation become unclaimed", () => {
  const s = scenario(),
    a = force("a", "blue", 100, 100),
    b = force("b", "green", 100, 10),
    dead = force("dead", "red", 0, 20);
  battleCargo(
    s,
    [a, b, dead],
    null,
    [],
    new Map([
      ["blue", 100],
      ["green", 100],
      ["red", 10],
    ]),
  );
  expect(cargoAmount(a)).toBe(50);
  expect(cargoAmount(b)).toBe(10);
  expect(s.cargoLost).toBe(70);
});
it("pooled capture fills winning groups and is independent of input order", () => {
  const initial = scenario(),
    rows = [
      force("l", "blue", 1000, 100),
      force("a", "green", 40),
      force("b", "green", 160),
    ];
  const apply = (order: Formation[]) => {
    const s = structuredClone(initial),
      events: Event[] = [];
    battleCargo(
      s,
      order,
      "green",
      events,
      new Map([
        ["blue", 100],
        ["green", 300],
      ]),
    );
    return { s, events, rows: order.sort((a, b) => a.id.localeCompare(b.id)) };
  };
  const r = apply(structuredClone(rows));
  expect(r.rows.map(cargoAmount)).toEqual([20, 80, 0]);
  expect(apply(structuredClone(rows).reverse())).toEqual(r);
});
it("third party can capture cargo again and bank without returning it to original treasury", () => {
  const s = scenario();
  s.treasury = 1000;
  const a = force("a", "blue", 2000, 100),
    b = force("b", "green", 2000),
    c = force("c", "blue", 2000);
  battleCargo(
    s,
    [a, b],
    "green",
    [],
    new Map([
      ["blue", 100],
      ["green", 300],
    ]),
  );
  battleCargo(
    s,
    [b, c],
    "blue",
    [],
    new Map([
      ["green", 100],
      ["blue", 300],
    ]),
  );
  expect(cargoAmount(c)).toBe(100);
  c.position = "approach";
  settleCargo(s, [c], []);
  expect(s.raidValues?.blue).toBe(100);
  expect(s.treasury).toBe(1000);
});
it("resolver uses pre-casualty individual kingdom Power, not combined hostility, and merges captured cargo", () => {
  const s = scenario();
  s.formations = [
    force("loser", "blue", 100, 40),
    force("g1", "green", 100),
    force("g2", "green", 50),
    force("red", "red", 90),
  ];
  const config = {
    ...defaults,
    casualties: { factor: 0, minimum: 0, maximum: 0, surviveCap: null },
  };
  const r = resolveCycle({ state: s, config, cycle: 1, seed: "bands" });
  expect(
    cargoAmount(r.state.formations.find((f) => f.kingdom === "green")!),
  ).toBe(20);
  expect(r.events).toContainEqual(
    expect.objectContaining({
      type: "cargo",
      action: "dropped",
      ratio: 1.5,
      dropRate: 0.5,
      amount: 20,
    }),
  );
  expect(r.state.formations.filter((f) => f.kingdom === "green")).toHaveLength(
    1,
  );
});
it("conquest destroys the unclaimed pool explicitly and retains its historical amount", () => {
  const s = scenario("Command Post hold");
  s.cargoLost = 42;
  const first = resolveCycle({
    state: s,
    config: defaults,
    cycle: 1,
    seed: "end",
  });
  const r = resolveCycle({
    state: first.state,
    config: defaults,
    cycle: 2,
    seed: "end",
  });
  expect(r.state.cargoLost).toBe(0);
  expect(r.state.cargoDestroyed).toBe(42);
  expect(r.events).toContainEqual(
    expect.objectContaining({ type: "cargo", action: "destroyed", amount: 42 }),
  );
});
it("seeded real combat conserves spheres under both casualty models", () => {
  for (const combatModel of ["current", "experimental-survival"] as const)
    for (let seed = 0; seed < 40; seed++) {
      const s = scenario();
      s.formations = [
        force("a", "blue", 100, 40),
        force("b", "green", 200, 70),
        force("c", "red", 80, 20),
      ];
      const r = resolveCycle({
        state: s,
        config: { ...defaults, combatModel },
        cycle: 1,
        seed: String(seed),
      });
      const accounted =
        r.state.formations.reduce((n, f) => n + cargoAmount(f), 0) +
        Object.values(r.state.raidValues ?? {}).reduce((a, b) => a + b, 0) +
        (r.state.cargoLost ?? 0) +
        (r.state.recovered ?? 0);
      expect(accounted).toBeCloseTo(130, 10);
    }
});
