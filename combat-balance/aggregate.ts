import { createHash } from "node:crypto";
import { effectivePower, totalUnits, unitKeys } from "../convex/rules";
import {
  armyMetrics,
  simulateArmy,
  validateModel,
  type Model,
  type Scenario,
} from "./models";

export function seedFor(scenario: string, index: number, side: number) {
  // Hash the replication identity before passing it to production: adjacent
  // numeric IDs must not create correlated FNV stochastic-rounding inputs.
  return createHash("sha256")
    .update(`combat-balance/v1|${scenario}|${index}|${side}`)
    .digest("hex");
}
export function aggregate(
  scenario: Scenario,
  model: Model,
  replications: number,
  start = 0,
) {
  validateModel(model);
  if (scenario.hostilePowers && (scenario.hostilePowers.length !== scenario.armies.length || scenario.hostilePowers.some(p => !Number.isFinite(p) || p < 0)))
    throw Error("Controlled hostile Powers must match armies and be finite and nonnegative.");
  if (
    !Number.isSafeInteger(replications) ||
    replications < 1 ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(start + replications)
  )
    throw Error(
      "Use positive integer replications and a nonnegative safe seed range.",
    );
  const powers = scenario.armies.map((a) =>
    effectivePower(a.units, a.research),
  );
  const top = Math.max(...powers),
    winner =
      !scenario.hostilePowers && powers.filter((p) => p === top).length === 1 ? powers.indexOf(top) : null;
  const rows = scenario.armies.map((a, side) => {
    const hostile = scenario.hostilePowers?.[side] ?? powers.reduce((n, p, i) => n + (i === side ? 0 : p), 0),
      m = armyMetrics(a, hostile, model);
    const counts: number[] = [],
      byUnit = Object.fromEntries(unitKeys().map((k) => [k, 0]));
    let shardDeaths = 0,
      annihilations = 0;
    for (let i = start; i < start + replications; i++) {
      const r = simulateArmy(a, hostile, model, seedFor(scenario.id, i, side));
      const count = totalUnits(r.casualties);
      counts.push(count);
      for (const key of unitKeys()) byUnit[key] += r.casualties[key];
      if (r.casualties.shardbearer > 0) shardDeaths++;
      if (totalUnits(r.survivors) === 0) annihilations++;
    }
    counts.sort((a, b) => a - b);
    const mean = counts.reduce((a, b) => a + b, 0) / replications;
    const sd = Math.sqrt(
      counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / replications,
    );
    const death = a.units.shardbearer ? shardDeaths / replications : null;
    return {
      scenario: scenario.id,
      category: scenario.category,
      note: scenario.note,
      side,
      army: a.name,
      composition: JSON.stringify(a.units),
      research: JSON.stringify(a.research),
      opponents: JSON.stringify(scenario.armies.filter((_, i) => i !== side)),
      model: model.id,
      modelFamily: model.family ?? model.id,
      label: model.label,
      replications,
      seedStart: start,
      seedEnd: start + replications - 1,
      survivalMode: model.survival,
      selection: model.selection,
      floor: model.floor,
      densityScale: model.densityScale,
      weightStrength: model.weightStrength,
      surviveCap: model.surviveCap ?? null,
      power: m.power,
      hostilePower: m.hostilePower,
      totalSurvival: m.survival,
      appliedSurvival: m.appliedSurvival,
      troops: m.n,
      plunder: m.plunder,
      baseRate: m.base,
      finalRate: m.final,
      expectedCasualties: m.expected,
      averageCasualties: mean,
      casualtyPercent: m.n ? (100 * mean) / m.n : 0,
      median:
        (counts[Math.floor((replications - 1) / 2)] +
          counts[Math.floor(replications / 2)]) /
        2,
      min: counts[0],
      max: counts.at(-1)!,
      standardDeviation: sd,
      shardDeathProbability: death,
      allShardsSurviveProbability: death === null ? null : 1 - death,
      shardProbabilityStandardError:
        death === null ? null : Math.sqrt((death * (1 - death)) / replications),
      annihilationProbability: annihilations / replications,
      nominalWinnerSide: winner,
      nominalWinner: side === winner,
      ...Object.fromEntries(
        unitKeys().flatMap((k) => [
          [`${k}_averageCasualties`, byUnit[k] / replications],
          [
            `${k}_casualtyRate`,
            a.units[k] ? byUnit[k] / replications / a.units[k] : null,
          ],
        ]),
      ),
    };
  });
  return rows;
}
export type Row = ReturnType<typeof aggregate>[number];
