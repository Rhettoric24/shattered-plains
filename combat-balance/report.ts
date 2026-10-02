import type { Row } from "./aggregate";
const n = (v: unknown) =>
  typeof v === "number"
    ? Number(v.toFixed(4)).toString()
    : v === null
      ? "—"
      : String(v);
export function csv(rows: Row[]) {
  if (!rows.length) throw Error("No results to report.");
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return (
    [
      keys.map(escape).join(","),
      ...rows.map((row) =>
        keys.map((k) => escape((row as Record<string, unknown>)[k])).join(","),
      ),
    ].join("\n") + "\n"
  );
}
const table = (headers: string[], rows: unknown[][]) =>
  [
    headers.join(" | "),
    headers.map(() => "---").join(" | "),
    ...rows.map((r) => r.map(n).join(" | ")),
  ].join("\n");
export function markdown(
  rows: Row[],
  manifest: Record<string, unknown>,
  dataLink: string,
) {
  const a = rows.filter((r) => r.side === 0),
    observations: string[] = [];
  const get = (id: string, model = "current") =>
    a.find((r) => r.scenario === id && r.model === model);
  const mismatch = get("bm-100-v-1"),
    floor0 = get("bm-100-v-1", "floor0");
  if (mismatch && floor0)
    observations.push(
      `100 Bridgemen versus 1: CURRENT averages ${n(mismatch.averageCasualties)} deaths; removing only the floor averages ${n(floor0.averageCasualties)}. Analytic expectations: ${n(mismatch.expectedCasualties)} and ${n(floor0.expectedCasualties)}.`,
    );
  const largeB = get("scale-bm-1000"),
    smallB = get("scale-bm-10");
  if (largeB && smallB)
    observations.push(
      `Equal Bridgeman armies rise from ${n(smallB.finalRate * 100)}% final losses at size 10 to ${n(largeB.finalRate * 100)}% at size 1,000. The final 95% cap binds at size 280 under the current 25% base rate.`,
    );
  const sp100 = get("scale-sp-100"),
    sp1000 = get("scale-sp-1000");
  if (sp100 && sp1000)
    observations.push(
      `Equal Spearman armies: growing from 100 to 1,000 changes expected losses from ${n(sp100.expectedCasualties)} to ${n(sp1000.expectedCasualties)} despite ten times as many troops. Final rates: ${n(sp100.finalRate * 100)}% and ${n(sp1000.finalRate * 100)}%.`,
    );
  const normalized = get("scale-sp-1000", "normalized");
  if (normalized)
    observations.push(
      `Illustrative density normalization makes equal pure-Spearman loss percentages independent of size (${n(normalized.finalRate * 100)}% before rounding). Its arbitrary scale of 100 matches CURRENT at 100 troops; this is not an approved balance constant.`,
    );
  const shard = get("shard-bm100-moderate"),
    weighted = get("shard-bm100-moderate", "weighted");
  if (shard && weighted)
    observations.push(
      `100 Bridgemen + 1 Shardbearer vs 100 Spearmen: Shardbearer death is ${n(shard.shardDeathProbability! * 100)}% under CURRENT and ${n(weighted.shardDeathProbability! * 100)}% under weighting. Total losses are exactly paired per seed; different units absorb them.`,
    );
  const surgery = get("surgery-1000");
  if (surgery && sp1000)
    observations.push(
      `Field Surgery III on 1,000 Spearmen reduces expected losses from ${n(sp1000.expectedCasualties)} to ${n(surgery.expectedCasualties)} against the same untreated opponent. Per-Spearman +2 Survival changes the army-size curve.`,
    );
  const chulls = get("chull-escort"),
    noChulls = get("infantry-before-chulls");
  if (chulls && noChulls)
    observations.push(
      `Adding 20 Chulls to 30 Spearmen facing 60 Spearmen leaves Power unchanged; expected total losses change from ${n(noChulls.expectedCasualties)} to ${n(chulls.expectedCasualties)}. Average Spearman deaths change from ${n(noChulls.spearman_averageCasualties)} to ${n(chulls.spearman_averageCasualties)}: Chulls supply both army Survival and casualty-pool tickets. Plunder itself does not affect combat.`,
    );
  const before = get("ablative-before"),
    after = get("ablative-plus-bm");
  if (before && after)
    observations.push(
      `Adding one Bridgeman to 100 Spearmen against 100 Spearmen changes expected total losses from ${n(before.expectedCasualties)} to ${n(after.expectedCasualties)}. Extra Power does not necessarily offset the added body and reduced Survival.`,
    );
  const tiny = get("scale-bm-1");
  if (tiny)
    observations.push(
      `The one-Bridgeman tie has ${n(tiny.finalRate * 100)}% final loss rate, but individual samples lose ${tiny.min} or ${tiny.max} troops. More generally the 95% rate cap does not guarantee survivors in tiny forces because of stochastic rounding.`,
    );
  const armor = get("armor-100");
  if (armor && sp100)
    observations.push(
      `Tailored Armor III changes 100 Spearmen from ${n(sp100.power)} to ${n(armor.power)} Power. Against 100 untreated Spearmen expected losses fall from ${n(sp100.expectedCasualties)} to ${n(armor.expectedCasualties)} without changing Survival.`,
    );
  return (
    [
      "# Combat balance microscope — generated baseline",
      "No model is selected as a winner. No production or Lab rules were changed. These are fresh-army, single-engagement samples, not attrition campaigns.",
      "## Run provenance",
      "```json\n" + JSON.stringify(manifest, null, 2) + "\n```",
      `Full aggregates: [results.csv](${dataLink}). No individual-seed records are stored. Paired SHA-256 replication identities are shared across variants.`,
      "## Verified implementation",
      "CURRENT directly uses effectivePower, baseCasualtyRate, effectiveSurvivability and applySurvivalLosses from convex/rules.ts. The specified 25% Power ratio, 3%–80% base clamp, additive Survival, positive 100/(100+S), negative 1+abs(S)/100, 95% final clamp, seeded rounding and equal individual shuffle all match source. Zero hostility gives zero losses; zero own Power facing hostility uses the 80% base maximum. Conclaves, Fabrials and Highstorms are off, matching the Lab. The optional Survival cap defaults to uncapped.",
      "Shardbearer support adds min(non-Shard base supporting Power, 100 × Shardbearers), besides their 20 Power each. Research Power is not additional supporting base Power. Field Surgery III adds 2 Survival per Spearman; Tailored Armor III adds 1 Power per Spearman. Shardbearer +5 Survival protects the army, not that individual from the CURRENT selection lottery.",
      "## Experimental definitions — NOT BALANCED",
      "- FLOOR 1 / FLOOR 0 change only the base floor.\n- NORMALIZED: S_effective = densityScale × total researched Survival / troops; zero for an empty army. Default densityScale = 100. Existing final-rate caps still apply.\n- WEIGHTED: w = exp(clamp(-weightStrength × individual researched Survival, -20, 20)); default strength = ln(2). Default weights: Bridgeman 2, Spearman 0.5, Chull 0.25, Shardbearer 0.03125; Surgery III Spearman 0.125. A seeded exponential key -ln(U)/w per individual selects casualties without replacement. Weights are positive. Total losses exactly match the equal-selection model per seed. Weight ratios are not final death-probability ratios when most troops must die.\n- NORMALIZED + WEIGHTED combines those isolated changes.",
      "Normalized selection reuses production rounding/shuffling by neutralizing its Survival adjustment and feeding the desired rate; it does not copy the engine. CURRENT cannot be experimentally overridden. CLI overrides affect only experimental rows; exact settings are in the manifest and CSV.",
      "## Observations — not recommendations",
      observations.map((o, i) => `${i + 1}. ${o}`).join("\n\n"),
      "## Floor comparison — first army",
      table(
        [
          "Scenario",
          "Model",
          "Power",
          "Hostile",
          "Survival",
          "Base %",
          "Final %",
          "Expected deaths",
          "Mean deaths",
        ],
        a
          .filter(
            (r) =>
              r.category === "floor" &&
              ["current", "floor1", "floor0"].includes(r.modelFamily),
          )
          .map((r) => [
            r.scenario,
            r.model,
            r.power,
            r.hostilePower,
            r.totalSurvival,
            100 * r.baseRate,
            100 * r.finalRate,
            r.expectedCasualties,
            r.averageCasualties,
          ]),
      ),
      "## Army-size curves",
      table(
        [
          "Scenario",
          "Model",
          "Troops",
          "Power",
          "Total S",
          "Applied S",
          "Base %",
          "Final %",
          "Expected",
          "Mean",
          "Observed %",
        ],
        a
          .filter(
            (r) =>
              r.category === "scaling" &&
              ["current", "normalized"].includes(r.modelFamily),
          )
          .map((r) => [
            r.scenario,
            r.model,
            r.troops,
            r.power,
            r.totalSurvival,
            r.appliedSurvival,
            r.baseRate * 100,
            r.finalRate * 100,
            r.expectedCasualties,
            r.averageCasualties,
            r.casualtyPercent,
          ]),
      ),
      "## Single-Shardbearer risk",
      "Sample estimates, not exact probabilities. SE is binomial standard error in percentage points. Observed zero has SE zero but does not imply immortality: a rough upper 95% bound is 3 / replications.",
      table(
        [
          "Scenario",
          "Model",
          "Runs",
          "Expected deaths",
          "Mean deaths",
          "Shard dies %",
          "All Shards survive %",
          "SE pp",
        ],
        a
          .filter((r) => r.category === "shardbearer")
          .map((r) => [
            r.scenario,
            r.model,
            r.replications,
            r.expectedCasualties,
            r.averageCasualties,
            100 * r.shardDeathProbability!,
            100 * r.allShardsSurviveProbability!,
            100 * r.shardProbabilityStandardError!,
          ]),
      ),
      "## Mixed-army allocation",
      table(
        [
          "Scenario",
          "Model",
          "Mean total",
          "BM deaths",
          "SP deaths",
          "Chull deaths",
        ],
        a
          .filter(
            (r) =>
              ["mixed", "chulls"].includes(r.category) &&
              ["current", "weighted"].includes(r.modelFamily),
          )
          .map((r) => [
            r.scenario,
            r.model,
            r.averageCasualties,
            r.bridgeman_averageCasualties,
            r.spearman_averageCasualties,
            r.chull_averageCasualties,
          ]),
      ),
      "## Research — only the first army researched",
      table(
        [
          "Scenario",
          "Model",
          "Power",
          "Total S",
          "Applied S",
          "Final %",
          "Mean deaths",
        ],
        a
          .filter(
            (r) =>
              r.category === "research" &&
              ["current", "normalized"].includes(r.modelFamily),
          )
          .map((r) => [
            r.scenario,
            r.model,
            r.power,
            r.totalSurvival,
            r.appliedSurvival,
            r.finalRate * 100,
            r.averageCasualties,
          ]),
      ),
      "## Reading the data",
      "CSV includes every army, opponents and Research, per-type casualties/rates, mean/median/min/max/population SD, rare-unit risk, annihilation, model constants and seed ranges. Unit rates and probabilities are fractions; casualtyPercent is percent. Absent-unit rates are blank, not measured zero risk. Nominal winner means unique highest pre-casualty individual Power; ties have none. The harness does not simulate board control, retreat, conquest or promotion. These benchmark opponents do not establish actual play frequency. No balance decision follows automatically from these measurements.",
    ].join("\n\n") + "\n"
  );
}
