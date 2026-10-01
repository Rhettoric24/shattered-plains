import { emptyUnits } from "../convex/rules";
import { holdOrder } from "../conflict-board/planning";
import type { ConflictState, ResolverConfig } from "../conflict-board/types";
export const defaults: ResolverConfig = {
  specialization: {
    speedScale: 0.75,
    surviveScale: 2,
    plunderScale: 15,
    minimum: 1,
    dominance: 0.6,
  },
  casualties: { factor: 0.25, minimum: 0.03, maximum: 0.8, surviveCap: null },
};
export const presetNames = [
  "Opening march",
  "Deathball",
  "Speed screen",
  "Speed flank",
  "Three kingdoms",
  "Highest tie",
  "Retreat collision",
  "Converging friends",
  "Command Post hold",
  "Research comparison",
  "Chulls and escorts",
  "Sleep order",
];
export function scenario(name = presetNames[0]): ConflictState {
  const positions: ConflictState["board"]["positions"] = [];
  const connections: [string, string][] = [];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const id = `${"ABC"[x]}${y + 1}`;
      positions.push({ id, name: id, kind: "field", x, y: y + 1 });
      if (x) connections.push([`${"ABC"[x - 1]}${y + 1}`, id]);
      if (y) connections.push([`${"ABC"[x]}${y}`, id]);
    }
  positions.push(
    { id: "post", name: "Command Post", kind: "objective", x: 1, y: 0 },
    { id: "approach", name: "Safe Approach", kind: "staging", x: 1, y: 4 },
    { id: "reserve", name: "Defender Reserve", kind: "reserve", x: 1, y: -1 },
  );
  connections.push(
    ["reserve", "post"],
    ["post", "B1"],
    ["approach", "A3"],
    ["approach", "B3"],
    ["approach", "C3"],
  );
  const state: ConflictState = {
    id: "lab",
    cycle: 0,
    board: {
      positions,
      connections,
      approach: "approach",
      reserve: "reserve",
      objective: "post",
    },
    kingdoms: [
      { id: "blue", name: "Blue", color: "#65b5ff", research: {} },
      { id: "red", name: "Red", color: "#ff8686", research: {} },
      { id: "green", name: "Green", color: "#7be3aa", research: {} },
    ],
    originalOwner: "red",
    formations: [],
    arrivals: [],
    objective: { controller: "red" },
  };
  const add = (
    id: string,
    kingdom: string,
    position: string,
    spearman: number,
    bridgeman = 0,
    route: string[] = [],
    history = [position],
    chull = 0,
  ) =>
    state.formations.push({
      id,
      name: id,
      kingdom,
      position,
      units: { ...emptyUnits(), spearman, bridgeman, chull },
      history,
      order: route.length
        ? { kind: "move", route, onDefeat: "continue" }
        : holdOrder(),
    });
  add("Garrison", "red", "post", 120);
  if (name === "Opening march")
    add("Vanguard", "blue", "approach", 100, 100, ["B3", "B2", "B1", "post"]);
  if (name === "Deathball")
    add(
      "Deathball",
      "blue",
      "approach",
      1000,
      1000,
      ["B3", "B2", "B1", "post"],
      undefined,
      100,
    );
  if (name === "Speed screen") {
    add("Runners", "blue", "B3", 0, 100, ["B2", "B1"]);
    add("Screen", "green", "B2", 0, 1);
  }
  if (name === "Speed flank") {
    add("Runners", "blue", "B3", 0, 100, ["A3", "A2", "A1", "B1", "post"]);
    add("Blocker", "green", "B2", 200);
  }
  if (name === "Sleep order") {
    add("Persistent army", "blue", "approach", 100, 100, [
      "B3",
      "B2",
      "B1",
      "post",
    ]);
    add("Opposition", "green", "B2", 180);
  }
  if (name === "Three kingdoms" || name === "Highest tie") {
    add("Blue army", "blue", "A2", 400, 0, ["B2"]);
    add("Red army", "red", "C2", name === "Highest tie" ? 400 : 300, 0, ["B2"]);
    add("Green army", "green", "B1", 200, 0, ["B2"]);
  }
  if (name === "Retreat collision") {
    add(
      "Blue scout",
      "blue",
      "A2",
      10,
      0,
      ["A1"],
      ["approach", "B3", "B2", "A2"],
    );
    add(
      "Green scout",
      "green",
      "C2",
      10,
      0,
      ["C1"],
      ["approach", "B3", "B2", "C2"],
    );
    add("Block A", "red", "A2", 200);
    add("Block C", "red", "C2", 200);
    add("Guard A", "red", "A1", 200);
    add("Guard C", "red", "C1", 200);
  }
  if (name === "Converging friends") {
    add("West", "blue", "A2", 20, 0, ["B2", "B1"]);
    add("East", "blue", "C2", 20, 0, ["B2", "B3"]);
  }
  if (name === "Command Post hold") {
    state.formations = [];
    state.objective.controller = null;
    add("Occupier", "blue", "B1", 100, 0, ["post"]);
  }
  if (name === "Research comparison") {
    state.kingdoms[0].research = {
      bridgeEngineering: 3,
      painrialMedicine: 3,
      soulcastArmor: 3,
      packHarnessDesign: 3,
    };
    add("Mixed", "blue", "approach", 100, 100, [], undefined, 10);
  }
  if (name === "Chulls and escorts")
    add("Caravan", "blue", "approach", 50, 0, [], undefined, 50);
  return state;
}
