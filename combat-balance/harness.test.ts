import { describe, expect, it } from "vitest";
import {
  applySurvivalLosses,
  baseCasualtyRate,
  effectivePower,
  effectiveSurvivability,
  emptyUnits,
  totalUnits,
  unitKeys,
} from "../convex/rules";
import { army, catalog } from "./catalog";
import { aggregate, seedFor } from "./aggregate";
import {
  armyMetrics,
  baseRate,
  casualtyWeight,
  models,
  simulateArmy,
  validateModel,
  weightedLosses,
} from "./models";
import { csv } from "./report";
const current = models[0],
  weighted = models.find((m) => m.id === "weighted")!,
  normalized = models.find((m) => m.id === "normalized")!;

describe("production baseline equivalence", () => {
  it.each(catalog().map((s) => [s.id, s] as const))(
    "%s calls the actual loss model unchanged",
    (_, scenario) => {
      for (let side = 0; side < scenario.armies.length; side++) {
        const a = scenario.armies[side],
          hostile = scenario.armies.reduce(
            (n, b, i) =>
              n + (i === side ? 0 : effectivePower(b.units, b.research)),
            0,
          );
        for (let i = 0; i < 3; i++) {
          const seed = seedFor(scenario.id, i, side);
          expect(simulateArmy(a, hostile, current, seed)).toEqual(
            applySurvivalLosses(
              a.units,
              baseCasualtyRate(effectivePower(a.units, a.research), hostile),
              seed,
              a.research,
              false,
            ),
          );
        }
      }
    },
  );
  it("floor variants change only the floor, preserving source rounding and allocation", () => {
    const a = army("100BM", { bridgeman: 100 });
    for (const m of models.filter((m) => m.id.startsWith("floor"))) {
      expect({
        ...m,
        id: current.id,
        label: current.label,
        floor: current.floor,
      }).toEqual(current);
      expect(simulateArmy(a, 0.5, m, "seed")).toEqual(
        applySurvivalLosses(
          a.units,
          Math.max(m.floor, 0.0025),
          "seed",
          a.research,
          false,
        ),
      );
    }
  });
  it("zero hostility and zero own Power use production exceptions", () => {
    for (const m of models) {
      expect(baseRate(0, 0, m.floor)).toBe(0);
      expect(baseRate(0, 10, m.floor)).toBe(0.8);
      expect(
        totalUnits(
          simulateArmy(army("chulls", { chull: 10 }), 0, m, "zero").casualties,
        ),
      ).toBe(0);
    }
  });
  it("CURRENT rejects altered model settings", () => {
    expect(() => validateModel({ ...current, floor: 0 })).toThrow();
    expect(() => validateModel({ ...current, survival: "density" })).toThrow();
  });
});
describe("isolated experiments", () => {
  it("weighted allocation exactly preserves losses for every paired seed", () => {
    const a = army(
      "mixed",
      { bridgeman: 50, spearman: 30, chull: 10, shardbearer: 1 },
      { painrialMedicine: 3 },
    );
    for (let i = 0; i < 100; i++)
      for (const base of [current, normalized]) {
        const seed = seedFor("paired", i, 0),
          w = { ...base, id: "experiment", selection: "weighted" as const };
        const plain = simulateArmy(a, 150, base, seed),
          weightedResult = simulateArmy(a, 150, w, seed);
        expect(totalUnits(weightedResult.casualties)).toBe(
          totalUnits(plain.casualties),
        );
        expect(weightedResult.finalCasualtyRate).toBe(plain.finalCasualtyRate);
        expect(simulateArmy(a, 150, w, seed)).toEqual(weightedResult);
        for (const k of unitKeys())
          expect(
            weightedResult.survivors[k] + weightedResult.casualties[k],
          ).toBe(a.units[k]);
      }
  });
  it("individual weights include Research without using total army Survival", () => {
    const a = army(
      "a",
      { spearman: 1000, bridgeman: 1 },
      { painrialMedicine: 3 },
    );
    expect(casualtyWeight(a, "spearman", Math.log(2))).toBeCloseTo(0.125);
    expect(casualtyWeight(a, "bridgeman", Math.log(2))).toBeCloseTo(2);
    expect(casualtyWeight(a, "shardbearer", Math.log(2))).toBeCloseTo(0.03125);
  });
  it("weights do not make any unit immune and are not a death priority", () => {
    const a = army("mixed", { bridgeman: 10, spearman: 10, shardbearer: 1 });
    expect(weightedLosses(a, 21, "all", Math.log(2)).casualties).toEqual(
      a.units,
    );
    let bm = 0,
      sp = 0;
    for (let i = 0; i < 1000; i++) {
      const r = weightedLosses(a, 1, seedFor("draw", i, 0), Math.log(2));
      bm += r.casualties.bridgeman;
      sp += r.casualties.spearman;
    }
    expect(bm).toBeGreaterThan(sp);
    expect(sp).toBeGreaterThan(0);
  });
  it("normalized adapter uses desired rate even when it increases positive Survival", () => {
    for (const units of [
      { spearman: 1 },
      { spearman: 1000 },
      { bridgeman: 1 },
      { bridgeman: 1000 },
      { spearman: 10, bridgeman: 10 },
      {},
    ]) {
      const a = army("test", units, { painrialMedicine: 3 });
      const m = armyMetrics(a, 100, normalized);
      expect(
        simulateArmy(a, 100, normalized, "seed").finalCasualtyRate,
      ).toBeCloseTo(m.final, 12);
    }
  });
  it("density rates are scale invariant for homogeneous equal matches", () => {
    const rates = [1, 10, 100, 1000].map(
      (n) => armyMetrics(army("sp", { spearman: n }), n, normalized).final,
    );
    expect(new Set(rates).size).toBe(1);
  });
  it("experiments do not mutate input composition, Research, or production behavior", () => {
    const a = army(
      "a",
      { spearman: 10, bridgeman: 10 },
      { painrialMedicine: 3 },
    );
    const snapshot = structuredClone(a),
      baseline = simulateArmy(a, 30, current, "seed");
    for (const m of models) simulateArmy(a, 30, m, "seed");
    expect(a).toEqual(snapshot);
    expect(simulateArmy(a, 30, current, "seed")).toEqual(baseline);
  });
});
describe("aggregation and provenance", () => {
  const scenario = catalog().find((s) => s.id === "shard-bm100-moderate")!;
  it("aggregates and CSV are reproducible", () => {
    const a = aggregate(scenario, current, 50, 10),
      b = aggregate(scenario, current, 50, 10);
    expect(a).toEqual(b);
    expect(csv(a)).toBe(csv(b));
  });
  it("rare-unit probabilities and averages equal explicitly counted trials", () => {
    const row = aggregate(scenario, current, 100)[0];
    let deaths = 0,
      losses = 0;
    for (let i = 0; i < 100; i++) {
      const r = simulateArmy(
        scenario.armies[0],
        row.hostilePower,
        current,
        seedFor(scenario.id, i, 0),
      );
      deaths += r.casualties.shardbearer > 0 ? 1 : 0;
      losses += totalUnits(r.casualties);
    }
    expect(row.shardDeathProbability).toBe(deaths / 100);
    expect(row.allShardsSurviveProbability).toBe(1 - deaths / 100);
    expect(row.averageCasualties).toBe(losses / 100);
    expect(
      unitKeys().reduce((n, k) => n + Number(row[`${k}_averageCasualties`]), 0),
    ).toBeCloseTo(row.averageCasualties, 12);
  });
  it("reports absent Shardbearers as not applicable, not immortal", () => {
    expect(
      aggregate(catalog()[0], current, 10)[0].shardDeathProbability,
    ).toBeNull();
  });
  it("rejects invalid replications, seed ranges and model values", () => {
    for (const count of [0, -1, 1.5, NaN])
      expect(() => aggregate(scenario, current, count)).toThrow();
    expect(() => aggregate(scenario, current, 1, -1)).toThrow();
    expect(() => validateModel({ ...weighted, floor: 0.9 })).toThrow();
  });
  it("multiway uses combined hostility with no coalition victory", () => {
    const rows = aggregate(
      catalog().find((s) => s.category === "multiway")!,
      current,
      10,
    );
    expect(rows.map((r) => r.hostilePower)).toEqual([500, 600, 700]);
    expect(rows.map((r) => r.nominalWinner)).toEqual([true, false, false]);
  });
});
