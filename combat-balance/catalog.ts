import { normalizeUnits, type UnitCounts } from "../convex/rules";
import type { Army, Scenario } from "./models";
export const army = (
  name: string,
  units: Partial<UnitCounts>,
  research: Record<string, number> = {},
): Army => ({ name, units: normalizeUnits(units), research });
export function catalog(): Scenario[] {
  const rows: Scenario[] = [];
  const duel = (id: string, category: string, a: Army, b: Army, note = "") =>
    rows.push({ id, category, note, armies: [a, b] });
  const b = (n: number) => army(`${n} Bridgemen`, { bridgeman: n });
  const s = (n: number, research: Record<string, number> = {}) =>
    army(`${n} Spearmen`, { spearman: n }, research);
  for (const n of [1, 10, 50, 100])
    duel(`bm-100-v-${n}`, "floor", b(100), b(n));
  for (const n of [1, 5, 10, 25, 50, 100, 250, 500, 1000])
    for (const [kind, force] of [
      ["bm", b(n)],
      ["sp", s(n)],
    ] as const)
      duel(`scale-${kind}-${n}`, "scaling", force, structuredClone(force));
  for (const [bm, sp] of [
    [50, 50],
    [80, 20],
    [20, 80],
  ]) {
    const a = army(`${bm} BM + ${sp} SP`, { bridgeman: bm, spearman: sp });
    duel(`mixed-${bm}-${sp}`, "mixed", a, structuredClone(a));
  }
  for (const n of [10, 100, 1000]) {
    const a = army(`Balanced ${n}`, { bridgeman: n / 2, spearman: n / 2 });
    duel(`scale-mixed-${n}`, "scaling", a, structuredClone(a));
  }
  duel(
    "chull-escort",
    "chulls",
    army("30 SP + 20 Chulls", { spearman: 30, chull: 20 }),
    s(60),
    "Plunder is measured, never used in casualty calculation.",
  );
  duel(
    "infantry-before-chulls",
    "chulls",
    s(30),
    s(60),
    "Control for adding 20 Chulls.",
  );
  duel(
    "chull-pack-harness",
    "chulls",
    army(
      "30 SP + 20 Chulls, Harness III",
      { spearman: 30, chull: 20 },
      { packHarnessDesign: 3 },
    ),
    s(60),
    "Plunder changes while Power and casualty math remain the same.",
  );
  for (const [id, units, opponent] of [
    ["bm20-light", { bridgeman: 20, shardbearer: 1 }, 1],
    ["bm100-moderate", { bridgeman: 100, shardbearer: 1 }, 100],
    ["bm100-severe", { bridgeman: 100, shardbearer: 1 }, 1000],
    ["sp20-moderate", { spearman: 20, shardbearer: 1 }, 60],
    ["mixed-moderate", { bridgeman: 50, spearman: 50, shardbearer: 1 }, 150],
  ] as [string, Partial<UnitCounts>, number][])
    duel(`shard-${id}`, "shardbearer", army(id, units), s(opponent));
  for (const n of [10, 100, 1000])
    duel(
      `surgery-${n}`,
      "research",
      s(n, { painrialMedicine: 3 }),
      s(n),
      "Compare side A with scale-sp at the same size: only its Field Surgery differs.",
    );
  duel(
    "armor-100",
    "research",
    s(100, { soulcastArmor: 3 }),
    s(100),
    "Compare scale-sp-100: Tailored Armor III doubles these Spearmen's Power.",
  );
  duel("ablative-before", "marginal", s(100), s(100));
  duel(
    "ablative-plus-bm",
    "marginal",
    army("100 SP + 1 BM", { spearman: 100, bridgeman: 1 }),
    s(100),
    "Adding a troop changes Power, total Survival and casualty allocation.",
  );
  duel("zero-own", "edge", army("10 Chulls", { chull: 10 }), s(10));
  duel(
    "zero-both",
    "edge",
    army("10 Chulls", { chull: 10 }),
    army("10 Chulls", { chull: 10 }),
  );
  rows.push({
    id: "multiway-400-300-200",
    category: "multiway",
    note: "Individual Power decides control; every other kingdom contributes hostile Power.",
    armies: [s(400), s(300), s(200)],
  });
  return rows;
}
