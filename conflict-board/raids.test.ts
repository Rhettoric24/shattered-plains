import { describe, expect, it } from "vitest";
import { emptyUnits } from "../convex/rules";
import { defaults, scenario } from "../lab/scenarios";
import { resolveCycle } from "./resolver";
import {
  approveRoute,
  extendRoute,
  holdOrder,
  splitFormation,
} from "./planning";
import type { ConflictState, Formation } from "./types";

const config = {
  ...defaults,
  casualties: { factor: 0, minimum: 0, maximum: 0, surviveCap: null },
};
const run = (s: ConflictState, c = config, seed = "raid") =>
  resolveCycle({ state: s, cycle: s.cycle + 1, config: c, seed });
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
  spearman = 100,
  route: string[] = [],
  bridgeman = 0,
  chull = 0,
) {
  const f: Formation = {
    id,
    name: id,
    kingdom,
    position,
    units: { ...emptyUnits(), spearman, bridgeman, chull },
    history: [position],
    order: route.length
      ? { kind: "move", route, onDefeat: "continue" }
      : holdOrder(),
  };
  s.formations.push(f);
  return f;
}
function ready() {
  let s = blank();
  add(s, "raider", "blue", "A1", 100, [], 0, 10);
  s = run(s).state;
  s.formations[0].order = { kind: "raid", route: [], onDefeat: "pause" };
  return s;
}
const payouts = (r: ReturnType<typeof run>) =>
  r.events.filter((e) => e.type === "raid");

describe("Raid V1", () => {
  it("an old occupier dying while a fresh friendly entrant wins still breaks continuity", () => {
    let found = false;
    for (let seed = 0; seed < 100 && !found; seed++) {
      const s = ready();
      s.formations[0].units = { ...emptyUnits(), spearman: 1 };
      add(s, "new-blue", "blue", "B1", 50, ["A1"]);
      add(s, "enemy", "red", "A2", 25, ["A1"]);
      const r = run(
        s,
        {
          ...config,
          casualties: { factor: 1, minimum: 1, maximum: 1, surviveCap: 0 },
        },
        String(seed),
      );
      if (
        !r.state.formations.some((f) => f.id === "raider") &&
        r.state.formations.some((f) => f.id === "new-blue")
      ) {
        found = true;
        expect(r.state.raidFootholds?.A1).toMatchObject({
          kingdom: "blue",
          establishedCycle: 2,
        });
        expect(payouts(r)).toHaveLength(0);
      }
    }
    expect(found).toBe(true);
  });
  it("arrival establishes foothold without payout, including Speed step two", () => {
    const s = blank();
    add(s, "fast", "blue", "A3", 0, ["A2", "A1"], 100);
    const r = run(s);
    expect(r.state.raidFootholds?.A1.establishedCycle).toBe(1);
    expect(payouts(r)).toHaveLength(0);
    expect(r.events.some((e) => e.type === "raidFoothold")).toBe(true);
  });
  it("pre-setting a Raid order on a new position never pays instantly", () => {
    const s = blank();
    add(s, "new", "blue", "A1").order = {
      kind: "raid",
      route: [],
      onDefeat: "pause",
    };
    expect(payouts(run(s))).toHaveLength(0);
  });
  it("scores on a subsequent boundary with Plunder and cap", () => {
    const r = run(ready());
    expect(payouts(r)).toEqual([
      expect.objectContaining({
        kingdom: "blue",
        target: "red",
        position: "A1",
        formation: "raider",
        plunder: 350,
        value: 100,
        cycle: 2,
      }),
    ]);
    expect(r.state.formations[0].cargo?.red).toBe(100);
    expect(r.state.raidValues?.blue ?? 0).toBe(0);
  });
  it("uses actual Plunder when below cap", () => {
    const s = ready();
    s.formations[0].units.chull = 0;
    expect(payouts(run(s))[0]).toMatchObject({ plunder: 50, value: 50 });
  });
  it("configured cap limits payout", () => {
    expect(payouts(run(ready(), { ...config, raidCap: 7 }))[0]).toMatchObject({
      value: 7,
    });
  });
  it.each(["hold", "move"] as const)("%s does not Raid", (kind) => {
    const s = ready();
    s.formations[0].order = {
      kind,
      route: kind === "move" ? ["A2"] : [],
      onDefeat: "pause",
    };
    expect(payouts(run(s))).toHaveLength(0);
  });
  it("raids repeatedly without reissuing the order", () => {
    const first = run(ready());
    const second = run(first.state);
    expect(second.state.formations[0].cargo?.red).toBe(200);
    expect(second.state.raidFootholds?.A1.establishedCycle).toBe(1);
  });
  it.each([1, 30])("failed %s-Power attacks do not interrupt Raid", (power) => {
    const s = ready();
    add(s, "attack", "red", "B1", power, ["A1"]);
    expect(payouts(run(s))).toHaveLength(1);
  });
  it("successful attack resets readiness and stops repeated scoring", () => {
    const s = ready();
    add(s, "attack", "red", "B1", 200, ["A1"]);
    const r = run(s);
    expect(payouts(r)).toHaveLength(0);
    expect(r.state.raidFootholds?.A1.kingdom).toBe("red");
    expect(r.events.some((e) => e.type === "raidBroken")).toBe(true);
    expect(payouts(run(r.state))).toHaveLength(0);
  });
  it("friendly reinforcements merge without erasing continuity", () => {
    const s = ready();
    add(s, "friend", "blue", "A2", 20, ["A1"]);
    const r = run(s);
    expect(payouts(r)).toHaveLength(1);
    expect(r.state.raidFootholds?.A1.establishedCycle).toBe(1);
    expect(payouts(run(r.state))).toHaveLength(1);
  });
  it("split defenders of a foothold preserve continuity when a child stays", () => {
    let s = ready();
    s = splitFormation(s, "raider", { ...emptyUnits(), spearman: 10 }, "child");
    approveRoute(
      s.board,
      s.formations.find((f) => f.id === "raider")!,
      ["A2"],
      "pause",
    );
    const r = run(s);
    expect(r.state.raidFootholds?.A1.establishedCycle).toBe(1);
    expect(payouts(r)[0]).toMatchObject({ formation: "child", value: 5 });
  });
  it("loss then Speed recapture in the same cycle starts a new foothold", () => {
    const s = ready();
    add(s, "enemy", "red", "B1", 200, ["A1"]);
    add(s, "relief", "blue", "C1", 0, ["B1", "A1"], 1000);
    const r = run(s);
    expect(r.state.raidFootholds?.A1).toMatchObject({
      kingdom: "blue",
      establishedCycle: 2,
    });
    expect(payouts(r)).toHaveLength(0);
    const relief = r.state.formations.find((f) => f.position === "A1")!;
    relief.order = { kind: "raid", route: [], onDefeat: "pause" };
    expect(payouts(run(r.state))).toHaveLength(1);
  });
  it("same-color replacement during movement also breaks the original foothold", () => {
    const s = ready();
    approveRoute(s.board, s.formations[0], ["A2"], "pause");
    add(s, "replacement", "blue", "B1", 200, ["A1"]);
    const r = run(s);
    expect(r.state.raidFootholds?.A1.establishedCycle).toBe(2);
  });
  it("annihilated occupier cannot raid", () => {
    let found = false;
    for (let i = 0; i < 100 && !found; i++) {
      const s = ready();
      s.formations[0].units = { ...emptyUnits(), spearman: 1 };
      add(s, "enemy", "red", "B1", 0, ["A1"], 1);
      const r = run(
        s,
        {
          ...config,
          casualties: { factor: 1, minimum: 1, maximum: 1, surviveCap: 0 },
        },
        String(i),
      );
      if (!r.state.formations.some((f) => f.id === "raider")) {
        found = true;
        expect(payouts(r)).toHaveLength(0);
        expect(r.events.some((e) => e.type === "raidBroken")).toBe(true);
      }
    }
    expect(found).toBe(true);
  });
  it("multiway control is order-independent", () => {
    const s = ready();
    add(s, "red", "red", "B1", 200, ["A1"]);
    add(s, "green", "green", "A2", 300, ["A1"]);
    const reordered = structuredClone(s);
    reordered.formations.reverse();
    reordered.board.positions.reverse();
    reordered.kingdoms.reverse();
    const r = run(s);
    expect(run(reordered)).toEqual(r);
    expect(r.state.raidFootholds?.A1.kingdom).toBe("green");
    expect(payouts(r)).toHaveLength(0);
  });
  it("highest tie empties the Raid objective", () => {
    const s = ready();
    add(s, "red", "red", "B1", 100, ["A1"]);
    expect(run(s).state.raidFootholds?.A1).toBeUndefined();
  });
  it("Raid does not alter conquest and conquest does not award Raid value", () => {
    const s = ready();
    const r = run(s);
    expect(r.state.objective).toEqual(s.objective);
    const conquest = run(run(scenario("Command Post hold")).state);
    expect(conquest.state.objective.conqueredBy).toBe("blue");
    expect(payouts(conquest)).toHaveLength(0);
  });
  it("original defender cannot raid itself", () => {
    const s = blank();
    add(s, "red", "red", "A1").order = {
      kind: "raid",
      route: [],
      onDefeat: "pause",
    };
    expect(payouts(run(run(s).state))).toHaveLength(0);
  });
  it("both flanks score independently", () => {
    const s = ready();
    add(s, "east", "blue", "C1", 100);
    const r = run(s);
    r.state.formations.find((f) => f.id === "east")!.order = {
      kind: "raid",
      route: [],
      onDefeat: "pause",
    };
    expect(payouts(run(r.state))).toHaveLength(2);
  });
  it("metadata, not node names, determines Raid objectives", () => {
    const s = blank();
    s.board.positions.find((p) => p.id === "B2")!.objective = "raid";
    add(s, "test", "blue", "B2").order = {
      kind: "raid",
      route: [],
      onDefeat: "pause",
    };
    expect(payouts(run(run(s).state))[0]).toMatchObject({ position: "B2" });
  });
});
describe("explicit board route editing", () => {
  it("extends connected paths, rejects jumps and backtracks one step", () => {
    const board = blank().board;
    let draft = extendRoute(board, "A1", [], "A2");
    draft = extendRoute(board, "A1", draft, "B2");
    expect(draft).toEqual(["A2", "B2"]);
    expect(() => extendRoute(board, "A1", draft, "C1")).toThrow();
    expect(extendRoute(board, "A1", draft, "A2")).toEqual(["A2"]);
  });
  it("proposals leave approved orders alone until confirmation, then resolve normally", () => {
    const s = blank();
    const f = add(s, "test", "blue", "A1", 100, ["B1"]);
    const old = structuredClone(f.order);
    const draft = extendRoute(s.board, f.position, [], "A2");
    expect(f.order).toEqual(old);
    approveRoute(s.board, f, draft, "continue");
    expect(f.order.route).toEqual(["A2"]);
    expect(run(s).state.formations[0].position).toBe("A2");
  });
});
