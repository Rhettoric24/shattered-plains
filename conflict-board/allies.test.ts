import { describe, expect, test } from "vitest";
import { createBoard, BOARD_DEFAULTS } from "./board";
import { resolveCycle, applyArrivals } from "./resolver";
import { exposeHighstorm } from "./highstorms";
import { projectConflict } from "./disclosure";
import { splitFormation, holdOrder } from "./planning";
import { emptyUnits } from "../convex/rules";
import type { ConflictState, Formation, Event } from "./types";

function state(): ConflictState {
  return { id: "allies", cycle: 0, board: createBoard(), originalOwner: "red", kingdoms: ["red", "blue"].map(id => ({ id, name: id, color: id, research: {} })), formations: [], arrivals: [], objective: { controller: "red" } };
}
function piece(s: ConflictState, id: string, kingdom: string, position: string, power?: number, troops = 0) {
  const f: Formation = { id, kingdom, name: id, position, history: [position], units: { ...emptyUnits(), spearman: troops }, order: holdOrder(), ...(power ? { allied: { tier: 5, power } } : {}) };
  s.formations.push(f);
  return f;
}
const run = (s: ConflictState) => resolveCycle({ state: s, cycle: s.cycle + 1, seed: "ally", config: BOARD_DEFAULTS });

describe("indivisible Parshendi formations", () => {
  test("shares a square without ever merging; survives multiple resolutions", () => {
    const s = state(); piece(s, "ally", "blue", "B2", 1000); piece(s, "troops", "blue", "B2", undefined, 200);
    const first = run(s); const second = run(first.state);
    expect(second.state.formations.map(f => f.id)).toEqual(["ally", "troops"]);
    expect(second.events.some(e => e.type === "merge")).toBe(false);
    expect(second.state.formations[0].allied?.power).toBe(1000);
  });
  test("moves exactly one connected square and can capture the post", () => {
    const s = state(); s.objective.controller = null;
    const f = piece(s, "ally", "blue", "B2", 1000);
    f.order = { kind: "move", route: ["B1", "post"], onDefeat: "pause" };
    const first = run(s); expect(first.state.formations[0].position).toBe("B1");
    const second = run(first.state); expect(second.state.objective.hold?.kingdom).toBe("blue");
    expect(run(second.state).state.objective.conqueredBy).toBe("blue");
  });
  test.each([50, 3000])("Chasmfiend meets an ordinary army with %i Power", troops => {
    const s = state(); piece(s, "ally", "blue", "B2", 1000); piece(s, "enemy", "red", "B2", undefined, troops);
    const r = run(s);
    expect(r.state.formations.some(f => f.id === "ally")).toBe(troops < 1000);
    expect(r.events.filter(e => e.type === "allyDispersed")).toHaveLength(troops > 1000 ? 1 : 0);
    expect(r.events.some(e => e.type === "retreat" && e.formation === "ally")).toBe(false);
  });
  test("Power combines with ordinary troops but the ally takes no victory casualties", () => {
    const s = state(); piece(s, "ally", "blue", "B2", 1000); piece(s, "blue", "blue", "B2", undefined, 100); piece(s, "red", "red", "B2", undefined, 1050);
    const r = run(s), battle = r.events.find(e => e.type === "battle");
    expect(battle?.type === "battle" && battle.winner).toBe("blue");
    expect(battle?.type === "battle" && battle.forces.find(f => f.kingdom === "blue")?.power).toBe(1100);
    expect(r.state.formations.find(f => f.id === "ally")?.allied?.power).toBe(1000);
  });
  test("ties disperse allies using the existing losing-side rule", () => {
    const s = state(); piece(s, "blue", "blue", "B2", 1000); piece(s, "red", "red", "B2", 1000);
    expect(run(s).state.formations).toHaveLength(0);
  });
  test("storms preserve an allied garrison and its visibility while exposing ordinary troops", () => {
    const s = state(); piece(s, "ally", "red", "post", 1000); piece(s, "troops", "red", "B1", undefined, 100);
    s.highstorm = { id: "storm", active: true }; const events: Event[] = [];
    exposeHighstorm(s, BOARD_DEFAULTS, events);
    expect(s.formations.find(f => f.id === "ally")).toBeDefined();
    expect(s.objective.controller).toBe("red");
    expect(events.some(e => e.type === "highstorm" && e.formation === "ally")).toBe(false);
    expect(events.some(e => e.type === "highstorm" && e.formation === "troops")).toBe(true);
    expect(projectConflict(s, "red", {}, true, BOARD_DEFAULTS).visiblePositions).toContain("post");
  });
  test("defender reinforcements stay separate from an allied garrison", () => {
    const s = state(); piece(s, "ally", "red", "post", 1000);
    s.arrivals.push({ id: "incoming", cycle: 1, formation: { id: "incoming", name: "incoming", kingdom: "red", units: { ...emptyUnits(), spearman: 10 }, order: holdOrder() } });
    applyArrivals(s, new Set(["incoming"]), []);
    expect(s.formations).toHaveLength(2);
    expect(s.formations[0].units.spearman).toBe(0);
  });
  test("split and raid attempts fail and enemy allied Power obeys existing Intel", () => {
    const s = state(); const f = piece(s, "ally", "blue", "B2", 1000);
    expect(() => splitFormation(s, f.id, emptyUnits(), "child")).toThrow(/cannot split/);
    expect(projectConflict(s, "red", {}, true, BOARD_DEFAULTS).contacts).toHaveLength(0);
    expect(projectConflict(s, "red", { blue: 100 }, false, BOARD_DEFAULTS).contacts[0]).toMatchObject({ allied: true, power: { value: 1000 } });
    f.order.kind = "raid"; expect(() => run(s)).toThrow(/Invalid allied/);
  });
});
