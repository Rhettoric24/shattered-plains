import { describe, expect, it } from "vitest";
import { emptyUnits, totalUnits, effectivePower } from "../convex/rules";
import { defaults, presetNames, scenario } from "../lab/scenarios";
import { resolveCycle } from "./resolver";
import {
  appendHistory,
  holdOrder,
  proposedRoute,
  splitFormation,
} from "./planning";
import { formationStats } from "./stats";
import type { ConflictState, Formation, ResolverConfig } from "./types";

const quiet: ResolverConfig = {
  ...defaults,
  casualties: { factor: 0, minimum: 0, maximum: 0, surviveCap: null },
};
const units = (spearman = 0, bridgeman = 0, chull = 0) => ({
  ...emptyUnits(),
  spearman,
  bridgeman,
  chull,
});
function blank() {
  const s = scenario();
  s.formations = [];
  s.objective = { controller: null };
  return s;
}
function add(
  s: ConflictState,
  id: string,
  kingdom: string,
  position: string,
  u = units(100),
  route: string[] = [],
  history = [position],
) {
  const f: Formation = {
    id,
    name: id,
    kingdom,
    position,
    units: u,
    history,
    order: route.length
      ? { kind: "move", route, onDefeat: "continue" }
      : holdOrder(),
  };
  s.formations.push(f);
  return f;
}
const run = (
  state: ConflictState,
  config = quiet,
  seed = "test",
  mergePreferences?: Record<string, string>,
) =>
  resolveCycle({
    state,
    cycle: state.cycle + 1,
    seed,
    config,
    mergePreferences,
  });
const find = (s: ConflictState, id: string) =>
  s.formations.find((f) => f.id === id)!;

describe("movement and persistent intentions", () => {
  it("normal force moves one edge; Speed moves two", () => {
    const s = blank();
    add(s, "normal", "blue", "A3", units(100), ["A2", "A1"]);
    add(s, "fast", "green", "C3", units(0, 100), ["C2", "C1"]);
    const r = run(s);
    expect(find(r.state, "normal").position).toBe("A2");
    expect(find(r.state, "fast").position).toBe("C1");
    expect(find(r.state, "fast").order.kind).toBe("hold");
  });
  it("opponents can swap without edge combat", () => {
    const s = blank();
    add(s, "a", "blue", "A2", units(100), ["B2"]);
    add(s, "b", "red", "B2", units(100), ["A2"]);
    expect(run(s).events.filter((e) => e.type === "battle")).toHaveLength(0);
  });
  it("a one-unit screen stops a winning Speed force for this cycle", () => {
    const s = blank();
    add(s, "a", "blue", "B3", units(0, 100), ["B2", "B1"]);
    add(s, "screen", "red", "B2", units(0, 1));
    const r = run(s);
    expect(find(r.state, "a").position).toBe("B2");
    expect(find(r.state, "a").order.route).toEqual(["B1"]);
    expect(
      run(r.state).state.formations.find((f) => f.id === "a")?.position,
    ).toBe("B1");
  });
  it("a fought force can be attacked again in step two", () => {
    const s = blank();
    add(s, "a", "blue", "A2", units(100));
    add(s, "b", "red", "A3", units(10), ["A2"]);
    add(s, "c", "green", "C2", units(0, 300), ["B2", "A2"]);
    expect(run(s).events.filter((e) => e.type === "battle")).toHaveLength(2);
  });
  it("does not carry slow troops through a temporary friendly meeting", () => {
    const s = blank();
    add(s, "fast", "blue", "A3", units(0, 100), ["B3", "C3"]);
    add(s, "slow", "blue", "B2", units(100), ["B3", "C3"]);
    const r = run(s);
    expect(find(r.state, "fast").position).toBe("C3");
    expect(find(r.state, "slow").position).toBe("B3");
  });
  it("invalid routes pause without pathfinding", () => {
    const s = blank();
    add(s, "a", "blue", "A3", units(100), ["post"]);
    const r = run(s);
    expect(find(r.state, "a").position).toBe("A3");
    expect(find(r.state, "a").order.paused).toBe(true);
  });
  it("safe staging cannot be a transit shortcut", () => {
    const s = blank();
    add(s, "a", "blue", "A3", units(0, 100), ["approach", "C3"]);
    expect(find(run(s).state, "a").position).toBe("A3");
  });
  it("Continue rebuilds the approved objective after retreat", () => {
    const s = blank();
    add(s, "a", "blue", "B3", units(10), ["B2", "B1"], ["approach", "B3"]);
    add(s, "b", "red", "B2", units(100));
    const r = run(s);
    expect(find(r.state, "a").order.route).toEqual(["B2", "B1"]);
    expect(run(r.state).events.some((e) => e.type === "battle")).toBe(true);
  });
  it("Pause ends the standing objective after defeat", () => {
    const s = blank();
    const f = add(s, "a", "blue", "B3", units(10), ["B2"]);
    f.order.onDefeat = "pause";
    add(s, "b", "red", "B2");
    expect(find(run(s).state, "a").order.kind).toBe("hold");
  });
  it("loops erase stale retreat rights", () => {
    expect(appendHistory(["A3", "A2", "B2"], "A2")).toEqual(["A3", "A2"]);
  });
  it("route suggestion is explicit and never transits safe areas", () => {
    expect(proposedRoute(blank().board, "A3", "C3")).toEqual([
      "A3",
      "B3",
      "C3",
    ]);
  });
});
describe("combat", () => {
  it("highest individual wins and hostile Power is combined", () => {
    const r = run(scenario("Three kingdoms"));
    const battle = r.events.find((e) => e.type === "battle");
    expect(battle?.type).toBe("battle");
    if (battle?.type !== "battle") return;
    expect(battle.winner).toBe("blue");
    expect(battle.forces.map((f) => [f.power, f.hostilePower])).toEqual([
      [400, 500],
      [200, 700],
      [300, 600],
    ]);
  });
  it("highest tie retreats everyone, including weaker third party", () => {
    const r = run(scenario("Highest tie"));
    expect(r.state.formations.filter((f) => f.position === "B2")).toHaveLength(
      0,
    );
    expect(r.events.filter((e) => e.type === "retreat")).toHaveLength(3);
  });
  it("zero Power versus zero Power ties without casualties", () => {
    const s = blank();
    add(s, "a", "blue", "A2", units(0, 0, 10), ["B2"]);
    add(s, "b", "red", "C2", units(0, 0, 10), ["B2"]);
    const r = run(s, defaults);
    expect(r.events.find((e) => e.type === "battle")).toMatchObject({
      winner: null,
      forces: [{ baseRate: 0 }, { baseRate: 0 }],
    });
  });
  it("zero Power faces the configured maximum against positive Power", () => {
    const s = blank();
    add(s, "a", "blue", "A2", units(0, 0, 10), ["B2"]);
    add(s, "b", "red", "B2", units(100));
    const e = run(s, defaults).events.find((e) => e.type === "battle");
    if (e?.type !== "battle") throw Error("missing battle");
    expect(e.forces.find((f) => f.kingdom === "blue")?.baseRate).toBe(0.8);
  });
  it("casualties persist and conserve troops by type", () => {
    const s = scenario("Three kingdoms");
    const r = run(s, defaults);
    for (const e of r.events)
      if (e.type === "battle")
        for (const force of e.forces) {
          const before = s.formations
            .filter((f) => f.kingdom === force.kingdom && f.id !== "Garrison")
            .reduce((n, f) => n + totalUnits(f.units), 0);
          expect(
            totalUnits(force.casualties) + totalUnits(force.survivors),
          ).toBe(before);
          expect(totalUnits(force.casualties)).toBeGreaterThan(0);
        }
  });
  it("same-kingdom split does not duplicate army support or casualty rolls", () => {
    const s = blank();
    add(s, "a", "blue", "A2", { ...units(100), shardbearer: 1 }, ["B2"]);
    add(s, "b", "red", "B2", units(300));
    const split = splitFormation(s, "a", units(50), "child");
    const first = run(s, defaults).events.find((e) => e.type === "battle");
    const second = run(split, defaults).events.find((e) => e.type === "battle");
    expect(second).toEqual(first);
  });
  it("annihilated nominal winner never promotes a runner-up", () => {
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      const s = blank();
      add(s, "a", "blue", "A2", units(1), ["B2"]);
      add(s, "b", "red", "C2", units(0, 1), ["B2"]);
      const cfg = {
        ...defaults,
        casualties: { factor: 1, minimum: 1, maximum: 1, surviveCap: 0 },
      };
      const r = run(s, cfg, String(i));
      const e = r.events.find((e) => e.type === "battle");
      if (e?.type === "battle" && e.annihilated) {
        expect(e.winner).toBeNull();
        expect(r.state.formations.some((f) => f.position === "B2")).toBe(false);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
describe("retreat and merge", () => {
  it("skips blocked history, truncating it to the accepted fallback", () => {
    const s = blank();
    add(s, "a", "blue", "B2", units(10), ["B1"], ["approach", "B3", "B2"]);
    add(s, "b", "red", "B1", units(100));
    add(s, "c", "red", "C2", units(100), ["B2"]);
    const r = run(s);
    expect(find(r.state, "a").history).toEqual(["approach", "B3"]);
  });
  it("opposing retreat claims both skip a shared empty fallback", () => {
    const r = run(scenario("Retreat collision"));
    expect(
      r.events.some(
        (e) => e.type === "retreatCollision" && e.position === "B2",
      ),
    ).toBe(true);
    expect(find(r.state, "Blue scout").position).toBe("approach");
    expect(find(r.state, "Green scout").position).toBe("approach");
  });
  it("safe staging permits hostile coexistence", () => {
    const s = blank();
    add(s, "a", "blue", "approach");
    add(s, "b", "green", "approach");
    expect(run(s).events.some((e) => e.type === "battle")).toBe(false);
  });
  it("stationary defeated owner falls back to defender reserve", () => {
    const s = blank();
    add(s, "a", "red", "post", units(10));
    add(s, "b", "blue", "B1", units(100), ["post"]);
    expect(find(run(s).state, "a").position).toBe("reserve");
  });
  it("unexpected convergence without a resident holds with a fresh root", () => {
    const r = run(scenario("Converging friends"));
    const f = r.state.formations.find((f) => f.kingdom === "blue")!;
    expect(f.history).toEqual(["B2"]);
    expect(f.order.kind).toBe("hold");
  });
  it("intentional merge retains the nominated route", () => {
    const s = scenario("Converging friends");
    const r = run(s, quiet, "test", { "blue@B2": "West" });
    const f = r.state.formations.find((f) => f.kingdom === "blue")!;
    expect(f.history).toEqual(["A2", "B2"]);
    expect(f.order.route).toEqual(["B1"]);
  });
  it("unique resident keeps its retreat history", () => {
    const s = blank();
    add(s, "resident", "blue", "B2", units(100), [], ["approach", "B3", "B2"]);
    add(s, "arrival", "blue", "A2", units(100), ["B2"]);
    const f = run(s).state.formations[0];
    expect(f.history).toEqual(["approach", "B3", "B2"]);
  });
  it("splitting conserves units and clones histories/orders without mutation", () => {
    const s = scenario();
    const before = structuredClone(s);
    const r = splitFormation(s, "Vanguard", units(20, 30), "child");
    expect(s).toEqual(before);
    expect(
      totalUnits(find(r, "Vanguard").units) +
        totalUnits(find(r, "child").units),
    ).toBe(200);
    expect(find(r, "child").history).not.toBe(find(r, "Vanguard").history);
  });
  it("rejects empty, excessive and fractional splits", () => {
    const s = scenario();
    for (const u of [units(), units(1000), units(0.5)])
      expect(() => splitFormation(s, "Vanguard", u, "child")).toThrow();
  });
});
describe("specialization", () => {
  it.each([
    [units(0, 100), "Speed"],
    [units(100), "None"],
    [units(0, 0, 100), "Plunder"],
    [units(50, 50), "None"],
    [units(10, 90), "Speed"],
  ])("classifies representative composition %j", (u, expected) => {
    expect(
      formationStats(u as Formation["units"], {}, defaults).specialization,
    ).toBe(expected);
  });
  it("classification is invariant under army scale", () => {
    for (const factor of [1, 10, 100])
      expect(
        formationStats(units(10 * factor, 90 * factor), {}, defaults)
          .specialization,
      ).toBe("Speed");
  });
  it("Bridge Engineering changes comparison speed, not classification", () => {
    const a = formationStats(units(1), {}, defaults),
      b = formationStats(units(1), { bridgeEngineering: 3 }, defaults);
    expect(b.speed).toBe(a.speed);
    expect(b.travelSpeed).toBeGreaterThan(a.travelSpeed);
    expect(b.specialization).toBe(a.specialization);
  });
  it("Field Surgery can qualify a Spearman force", () => {
    expect(
      formationStats(units(100), { painrialMedicine: 3 }, defaults)
        .specialization,
    ).toBe("Survive");
  });
  it("Tailored Armor affects Power independently and tactical speed as defined", () => {
    const a = formationStats(units(100), {}, defaults),
      b = formationStats(units(100), { soulcastArmor: 3 }, defaults);
    expect(b.power).toBeGreaterThan(a.power);
    expect(b.specialization).toBe(a.specialization);
  });
  it("Pack Harnesses alter both tactical speed and plunder", () => {
    const a = formationStats(units(0, 0, 10), {}, defaults),
      b = formationStats(units(0, 0, 10), { packHarnessDesign: 3 }, defaults);
    expect(b.plunder).toBeGreaterThan(a.plunder);
    expect(b.speed).toBeLessThan(a.speed);
  });
  it("configurable minimum can disable otherwise eligible specialists", () => {
    expect(
      formationStats(
        units(0, 100),
        {},
        {
          ...defaults,
          specialization: { ...defaults.specialization, minimum: 5 },
        },
      ).specialization,
    ).toBe("None");
  });
});
describe("objective, arrivals and deterministic inputs", () => {
  it("a defender arrival joins the garrison before its movement and combat", () => {
    const s = blank();
    s.objective.controller = "red";
    add(s, "garrison", "red", "post", units(100), ["B1"]);
    add(s, "enemy", "blue", "B1", units(150));
    s.arrivals = [
      {
        id: "a",
        cycle: 1,
        formation: {
          id: "arriving",
          name: "Relief",
          kingdom: "red",
          units: units(100),
          order: holdOrder(),
        },
      },
    ];
    const r = run(s);
    expect(r.events.find((e) => e.type === "battle")).toMatchObject({
      winner: "red",
    });
    expect(find(r.state, "garrison").units.spearman).toBe(200);
    expect(find(r.state, "garrison").position).toBe("B1");
  });
  it("a zero-Power formation can occupy an empty position", () => {
    const s = blank();
    add(s, "chulls", "blue", "A3", units(0, 0, 20), ["A2"]);
    expect(find(run(s).state, "chulls").position).toBe("A2");
  });
  it("same-kingdom retreaters share a fallback and auto-merge", () => {
    const s = blank();
    add(s, "left", "blue", "A2", units(10), ["A1"], ["B2", "A2"]);
    add(s, "right", "blue", "C2", units(10), ["C1"], ["B2", "C2"]);
    add(s, "enemy-left", "red", "A1", units(100));
    add(s, "enemy-right", "red", "C1", units(100));
    add(s, "cut-left", "red", "A3", units(100), ["A2"]);
    add(s, "cut-right", "red", "C3", units(100), ["C2"]);
    const r = run(s);
    const blue = r.state.formations.filter((f) => f.kingdom === "blue");
    expect(blue).toHaveLength(1);
    expect(blue[0].position).toBe("B2");
    expect(totalUnits(blue[0].units)).toBe(20);
  });
  it("Speed defeat in step two retreats to the successfully traversed middle node", () => {
    const s = blank();
    add(s, "fast", "blue", "A3", units(0, 100), ["A2", "A1"]);
    add(s, "enemy", "red", "A1", units(100));
    expect(find(run(s).state, "fast").position).toBe("A2");
  });
  it("every preset resolves with valid histories and no mixed hostile field occupancy", () => {
    for (const name of presetNames) {
      let s = scenario(name);
      for (let i = 0; i < 8 && !s.objective.conqueredBy; i++) {
        s = run(s, defaults).state;
        for (const p of s.board.positions.filter(
          (p) => p.kind === "field" || p.kind === "objective",
        )) {
          expect(
            new Set(
              s.formations
                .filter((f) => f.position === p.id)
                .map((f) => f.kingdom),
            ).size,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it("occupying begins a hold; one full subsequent cycle conquers", () => {
    const a = run(scenario("Command Post hold"));
    expect(a.state.objective.hold).toEqual({ kingdom: "blue", beganCycle: 1 });
    expect(a.state.objective.conqueredBy).toBeUndefined();
    expect(run(a.state).state.objective.conqueredBy).toBe("blue");
  });
  it("an unsuccessful attack does not reset the hold", () => {
    const s = run(scenario("Command Post hold")).state;
    add(s, "counter", "red", "B1", units(1), ["post"]);
    expect(run(s).state.objective.conqueredBy).toBe("blue");
  });
  it("displacement breaks the hold", () => {
    const s = run(scenario("Command Post hold")).state;
    add(s, "counter", "red", "B1", units(1000), ["post"]);
    const r = run(s);
    expect(r.state.objective.hold).toBeUndefined();
    expect(r.events.some((e) => e.type === "holdBroken")).toBe(true);
  });
  it("loss in step one and friendly recapture in step two restarts hold", () => {
    const s = blank();
    s.cycle = 1;
    s.objective = {
      controller: "blue",
      hold: { kingdom: "blue", beganCycle: 1 },
    };
    add(s, "old", "blue", "post", units(10));
    add(s, "invader", "red", "B1", units(100), ["post"]);
    add(s, "relief", "blue", "B2", units(0, 1000), ["B1", "post"]);
    const r = run(s);
    expect(r.state.objective.hold).toEqual({ kingdom: "blue", beganCycle: 2 });
    expect(r.state.objective.conqueredBy).toBeUndefined();
  });
  it.each(["red", "blue"])(
    "defender arrival respects Post control %s",
    (controller) => {
      const s = blank();
      s.objective.controller = controller;
      add(s, "resident", controller, "post");
      s.arrivals = [
        {
          id: "arr",
          cycle: 1,
          formation: {
            id: "reinforce",
            name: "reinforce",
            kingdom: "red",
            units: units(10),
            order: holdOrder(),
          },
        },
      ];
      expect(run(s).events.find((e) => e.type === "arrival")).toMatchObject({
        position: controller === "red" ? "post" : "reserve",
      });
    },
  );
  it("outside arrivals use staging; future arrivals stay queued", () => {
    const s = blank();
    s.arrivals = [1, 2].map((cycle) => ({
      id: `a${cycle}`,
      cycle,
      formation: {
        id: `f${cycle}`,
        name: "reinforce",
        kingdom: "blue",
        units: units(10),
        order: holdOrder(),
      },
    }));
    const r = run(s);
    expect(find(r.state, "f1").position).toBe("approach");
    expect(r.state.arrivals).toHaveLength(1);
  });
  it("reordered arrays produce identical results without mutating inputs", () => {
    const s = scenario("Three kingdoms");
    const original = structuredClone(s);
    const reversed = structuredClone(s);
    reversed.formations.reverse();
    reversed.kingdoms.reverse();
    reversed.board.positions.reverse();
    reversed.board.connections.reverse();
    expect(run(reversed, defaults)).toEqual(run(s, defaults));
    expect(s).toEqual(original);
  });
  it("same seed repeats; different seeds can vary casualty selection", () => {
    const s = scenario("Three kingdoms");
    expect(run(s, defaults)).toEqual(run(s, defaults));
    const outputs = new Set(
      Array.from({ length: 20 }, (_, i) =>
        JSON.stringify(
          run(s, defaults, String(i)).events.filter((e) => e.type === "battle"),
        ),
      ),
    );
    expect(outputs.size).toBeGreaterThan(1);
  });
  it("rejects duplicate or stale cycles", () => {
    const s = run(blank()).state;
    expect(() =>
      resolveCycle({ state: s, cycle: 1, seed: "x", config: defaults }),
    ).toThrow("next cycle");
  });
  it("rejects invalid troop counts before allocation", () => {
    const s = blank();
    add(s, "bad", "blue", "A3", units(-1));
    expect(() => run(s)).toThrow("Troop counts");
  });
});
