import type { ConflictState, ResolverConfig } from "./types";
export function createBoard() {
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
  for (const [id, name] of [
    ["A1", "West Raid"],
    ["C1", "East Raid"],
  ]) {
    Object.assign(
      positions.find((p) => p.id === id)!,
      { objective: "raid", name: `${name} (${id})` },
    );
  }
  connections.push(
    ["reserve", "post"],
    ["post", "B1"],
    ["approach", "A3"],
    ["approach", "B3"],
    ["approach", "C3"],
  );
  return {
    positions,
    connections,
    approach: "approach",
    reserve: "reserve",
    objective: "post",
  };
}
export const BOARD_DEFAULTS: ResolverConfig = {
  combatModel: "current",
  raidCap: 100,
  specialization: {
    speedScale: 0.75,
    surviveScale: 2,
    plunderScale: 15,
    minimum: 1,
    dominance: 0.6,
  },
  casualties: { factor: 0.25, minimum: 0.03, maximum: 0.8, surviveCap: null },
};
