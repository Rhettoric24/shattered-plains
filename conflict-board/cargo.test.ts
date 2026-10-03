import { expect, it } from "vitest";
import { emptyUnits } from "../convex/rules";
import { scenario, defaults } from "../lab/scenarios";
import { battleCargo, cargoAmount, limitCargo, settleCargo } from "./cargo";
import { resolveCycle } from "./resolver";
import { approveRoute, splitFormation } from "./planning";
import type { Event } from "./types";
const config = {
  ...defaults,
  casualties: { factor: 0, minimum: 0, maximum: 0, surviveCap: null },
};
const run = (state: ReturnType<typeof scenario>) =>
  resolveCycle({ state, config, seed: "cargo", cycle: state.cycle + 1 });
function ready() {
  const s = scenario("Raid under attack");
  s.formations = s.formations.filter((f) => f.id === "Established raiders");
  s.treasury = 50000;
  return s;
}
it("repeated extraction fills capacity, not banked score; full and empty treasury stop extraction", () => {
  let s = ready();
  for (let i = 0; i < 6; i++) s = run(s).state;
  expect(cargoAmount(s.formations[0])).toBe(380);
  expect(s.treasury).toBe(49620);
  expect(s.raidValues?.blue ?? 0).toBe(0);
  expect(run(s).events).toContainEqual(
    expect.objectContaining({
      type: "raidFailed",
      reason: "Cargo capacity reached.",
    }),
  );
  s = ready();
  s.treasury = 7;
  s = run(s).state;
  expect(cargoAmount(s.formations[0])).toBe(7);
  expect(s.treasury).toBe(0);
  expect(run(s).state.treasury).toBe(0);
});
it("cargo prevents splitting; escape banks automatically and clears cargo", () => {
  let s = run(ready()).state;
  expect(() =>
    splitFormation(
      s,
      s.formations[0].id,
      { ...emptyUnits(), spearman: 1 },
      "child",
    ),
  ).toThrow("carrying Raid cargo");
  approveRoute(s.board, s.formations[0], ["A2", "A3", "approach"], "continue");
  for (let i = 0; i < 3; i++) s = run(s).state;
  expect(cargoAmount(s.formations[0])).toBe(0);
  expect(s.raidValues?.blue).toBe(100);
});
it("capacity overflow is lost proportionally, preserving provenance", () => {
  const s = ready(),
    f = s.formations[0],
    events: Event[] = [];
  f.units = { ...emptyUnits(), spearman: 10 };
  f.cargo = { red: 80, green: 20 };
  limitCargo(s, f, events, "test");
  expect(f.cargo).toEqual({ red: 4, green: 1 });
  expect(s.cargoLost).toBe(95);
});
it.each(["blue", "green", "red"])(
  "annihilation transfers original provenance to single %s winner up to capacity",
  (kingdom) => {
    const s = ready(),
      dead = s.formations[0],
      events: Event[] = [];
    dead.units = emptyUnits();
    dead.cargo = { red: 100 };
    const winner = {
      ...structuredClone(dead),
      id: "winner",
      kingdom,
      units: { ...emptyUnits(), spearman: 40 },
      cargo: {},
    };
    battleCargo(s, [dead, winner], kingdom, events);
    expect(winner.cargo).toEqual({ red: 20 });
    expect(cargoAmount(dead)).toBe(0);
    expect(s.cargoLost).toBe(80);
    winner.position = "approach";
    settleCargo(s, [winner], events);
    if (kingdom !== "red") expect(s.raidValues?.[kingdom]).toBe(20);
    else expect(cargoAmount(winner)).toBe(20);
  },
);
it("ambiguous winning detachments or ties lose annihilated cargo", () => {
  for (const winner of [null, "green"]) {
    const s = ready(),
      dead = s.formations[0];
    dead.units = emptyUnits();
    dead.cargo = { red: 10 };
    const a = {
      ...structuredClone(dead),
      id: "a",
      kingdom: "green",
      units: { ...emptyUnits(), spearman: 100 },
      cargo: {},
    };
    battleCargo(s, [dead, a, { ...a, id: "b" }], winner, []);
    expect(s.cargoLost).toBe(10);
  }
});
it("defender recovers only original-owner cargo at controlled post, not reserve/enemy post", () => {
  const s = ready(),
    f = s.formations[0];
  f.kingdom = "red";
  f.cargo = { red: 40, green: 3 };
  for (const position of ["reserve", "post"]) {
    f.position = position;
    s.objective.controller = "blue";
    settleCargo(s, [f], []);
    expect(f.cargo.red).toBe(40);
  }
  s.objective.controller = "red";
  settleCargo(s, [f], []);
  expect(f.cargo).toEqual({ green: 3 });
  expect(s.treasury).toBe(50040);
  expect(s.recovered).toBe(40);
});
it("empty Command Post stays controlled and defender arrivals land there", () => {
  let s = scenario();
  s.formations = [];
  s = run(s).state;
  expect(s.objective.controller).toBe("red");
  const f = scenario().formations[0];
  const { position, history, ...formation } = f;
  s.arrivals = [{ id: "arrival", cycle: 2, formation }];
  expect(run(s).state.formations[0].position).toBe("post");
});
it("friendly merges conserve cargo and route preferences", () => {
  const s = ready(),
    f = s.formations[0];
  f.cargo = { red: 20 };
  f.order.kind = "hold";
  const friend = {
    ...structuredClone(f),
    id: "friend",
    cargo: { green: 30 },
    position: "A2",
    history: ["A2"],
  };
  approveRoute(s.board, friend, ["A1"], "pause");
  s.formations.push(friend);
  const r = run(s);
  expect(r.state.formations).toHaveLength(1);
  expect(r.state.formations[0].cargo).toEqual({ green: 30, red: 20 });
  expect(run({ ...s, formations: [...s.formations].reverse() })).toEqual(r);
});
it("routed survivors retain cargo and cannot Raid", () => {
  const s = ready(),
    f = s.formations[0];
  f.cargo = { red: 100 };
  const enemy = {
    ...structuredClone(f),
    id: "enemy",
    kingdom: "red",
    cargo: {},
    units: { ...emptyUnits(), spearman: 500 },
    position: "B1",
    history: ["B1"],
  };
  approveRoute(s.board, enemy, ["A1"], "pause");
  s.formations.push(enemy);
  const r = run(s);
  expect(r.state.formations.find((g) => g.id === f.id)?.cargo).toEqual({
    red: 100,
  });
  expect(r.events.some((e) => e.type === "raid")).toBe(false);
  expect(r.events).toContainEqual(
    expect.objectContaining({ type: "cargo", action: "routed", amount: 100 }),
  );
});
it.each(["current", "experimental-survival"] as const)(
  "%s combat settles annihilation cargo after real casualty rolls",
  (combatModel) => {
    let captured = false;
    for (let i = 0; i < 100 && !captured; i++) {
      const s = ready(),
        f = s.formations[0];
      f.units = { ...emptyUnits(), bridgeman: 1 };
      f.cargo = { red: 1 };
      const enemy = {
        ...structuredClone(f),
        id: "enemy",
        kingdom: "green",
        cargo: {},
        units: { ...emptyUnits(), spearman: 100 },
        position: "B1",
        history: ["B1"],
      };
      approveRoute(s.board, enemy, ["A1"], "pause");
      s.formations.push(enemy);
      const input = {
        state: s,
        cycle: 2,
        config: { ...defaults, combatModel },
        seed: String(i),
      };
      const r = resolveCycle(input);
      if (!r.state.formations.some((g) => g.id === f.id)) {
        captured = true;
        expect(r.state.formations.find((g) => g.id === "enemy")!.cargo).toEqual(
          { red: 1 },
        );
        expect(r.events).toContainEqual(
          expect.objectContaining({
            type: "cargo",
            action: "captured",
            amount: 1,
          }),
        );
        expect(
          resolveCycle({
            ...input,
            state: { ...s, formations: [...s.formations].reverse() },
          }),
        ).toEqual(r);
        expect(f.cargo).toEqual({ red: 1 });
      }
    }
    expect(captured).toBe(true);
  },
);
it("actual casualties trim cargo before a surviving loser retreats", () => {
  const s = ready(),
    f = s.formations[0];
  f.units = { ...emptyUnits(), bridgeman: 100 };
  f.cargo = { red: 100 };
  const enemy = {
    ...structuredClone(f),
    id: "enemy",
    kingdom: "red",
    cargo: {},
    units: { ...emptyUnits(), spearman: 100 },
    position: "B1",
    history: ["B1"],
  };
  approveRoute(s.board, enemy, ["A1"], "pause");
  s.formations.push(enemy);
  const r = resolveCycle({
    state: s,
    cycle: 2,
    config: defaults,
    seed: "loss",
  });
  const survivor = r.state.formations.find((g) => g.id === f.id)!;
  expect(cargoAmount(survivor)).toBe(survivor.units.bridgeman);
  expect(cargoAmount(survivor)).toBeLessThan(100);
  expect(r.state.cargoLost! + cargoAmount(survivor)).toBe(100);
});
