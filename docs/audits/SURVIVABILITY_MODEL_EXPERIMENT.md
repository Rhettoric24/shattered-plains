# Survivability model experiment

## WHAT QUESTION DID WE TEST?

Does normalized formation Survivability plus weighted individual selection produce size-stable, composition-sensitive losses and different individual risks? This is evidence about the existing experiments, not a balance decision. No constants or game behavior were changed.

The centerpiece has an important control: at exactly 100 troops, normalized Survival equals current total Survival. Consequently CURRENT and NORMALIZED have identical rate curves here; WEIGHTED and NORMALIZED + WEIGHTED have identical allocation behavior. The size experiment distinguishes normalization. Tables label theoretical rates versus sampled probabilities explicitly.

## CORE COMPOSITION GRADIENT

Theoretical loss %, identical for all four models at 100 troops. Columns are exact hostile/own Power ratios; weighting changes identities, never casualty totals.

BM / SP | 0.25× | 0.5× | 1× | 1.5× | 2×
--- | --- | --- | --- | --- | ---
100/0 | 12.50 | 25.00 | 50.00 | 75.00 | 95.00
75/25 | 9.38 | 18.75 | 37.50 | 56.25 | 75.00
50/50 | 6.25 | 12.50 | 25.00 | 37.50 | 50.00
25/75 | 4.17 | 8.33 | 16.67 | 25.00 | 33.33
0/100 | 3.13 | 6.25 | 12.50 | 18.75 | 25.00

The curve is continuous and monotone across this gradient. Pure Bridgemen at 2× would reach 100% before the 95% final cap. The 3% base floor remains configured throughout, but does not bind at these pressure levels (base rates are 6.25–50%).

## ARMY SIZE SCALING

Even pressure. Each cell is theoretical loss % / sampled loss %. Normalized uses equal selection here; adding weighting preserves its casualty count.

Composition | Troops | CURRENT | NORMALIZED
--- | --- | --- | ---
BM | 10 | 27.50 / 27.45 | 50.00 / 50.00
BM | 100 | 50.00 / 50.00 | 50.00 / 50.00
BM | 1000 | 95.00 / 95.00 | 50.00 / 50.00
50/50 | 10 | 25.00 / 25.14 | 25.00 / 25.14
50/50 | 100 | 25.00 / 25.00 | 25.00 / 25.00
50/50 | 1000 | 25.00 / 25.00 | 25.00 / 25.00
SP | 10 | 22.73 / 22.77 | 12.50 / 12.54
SP | 100 | 12.50 / 12.49 | 12.50 / 12.49
SP | 1000 | 2.27 / 2.27 | 12.50 / 12.50

Normalized theoretical percentages are exactly invariant. Integer casualty counts still create individual-battle variation, especially in small armies; sampled means need not be exactly equal. Zero-Survival mixed armies are already size invariant under CURRENT. Pure large Bridgemen hit the cap, hiding further raw amplification.

## CASUALTY DISTRIBUTION

Even pressure, 100 troops; sampled percentages of starting units lost. Allocation columns compare CURRENT versus WEIGHTED; normalization is identical at this size.

BM/SP | Equal BM loss % | Equal SP loss % | Weighted BM loss % | Weighted SP loss % | Weighted casualties that are BM %
--- | --- | --- | --- | --- | ---
75/25 | 37.65 | 37.04 | 45.40 | 13.76 | 90.82
50/50 | 25.04 | 24.96 | 38.66 | 11.34 | 77.32
25/75 | 16.79 | 16.63 | 35.77 | 10.31 | 53.63

Weighted sampling concentrates losses on fragile troops, creating a real ablative-screen incentive. It is not a kill-first rule: durable troops still die. Weights are sampling priorities, not final probability ratios; depletion of fragile troops changes the remaining lottery.

## SHARDBEARERS

Each formation has 100 infantry plus exactly one Shardbearer. Sampled death probabilities; C = CURRENT, N = NORMALIZED, W = WEIGHTED, NW = both. Full data also includes per-infantry risks, total losses and standard errors.

Infantry | Pressure | C Shard % | N Shard % | W Shard % | NW Shard % | NW BM % | NW SP % | NW total loss %
--- | --- | --- | --- | --- | --- | --- | --- | ---
100/0 | 0.5 | 24.84 | 24.75 | 0.44 | 0.44 | 24.50 | — | 24.27
100/0 | 2 | 95.00 | 95.00 | 4.43 | 4.43 | 95.90 | — | 94.99
50/50 | 0.5 | 11.75 | 11.75 | 0.28 | 0.28 | 18.93 | 5.12 | 11.91
50/50 | 2 | 47.38 | 47.39 | 1.84 | 1.84 | 70.26 | 25.95 | 47.65
0/100 | 0.5 | 5.99 | 6.02 | 0.45 | 0.45 | — | 6.18 | 6.13
0/100 | 2 | 23.87 | 23.99 | 1.80 | 1.82 | — | 24.74 | 24.51

Every individual's weight is positive, so no unit is mathematically immortal. Low observed Shardbearer risk can nevertheless feel nearly immune. Sampling uncertainty matters: standard errors are in the data; a zero observed rate would only imply an approximate 95% upper bound of 3/replications, not immunity.

## CHULLS

50 BM + 50 SP, adding Chulls; even relative pressure. Chulls add no Power, so hostile Power also stays fixed. Rates are theoretical except individual death percentages.

Added Chulls | CURRENT loss % | NORMALIZED loss % | NW BM % | NW SP % | NW Chull %
--- | --- | --- | --- | --- | ---
0 | 25.00 | 25.00 | 38.49 | 11.51 | —
1 | 24.51 | 24.51 | 38.09 | 11.33 | 5.30
5 | 22.73 | 22.83 | 36.55 | 10.86 | 5.16
20 | 17.86 | 18.75 | 33.32 | 9.80 | 4.76
100 | 8.33 | 12.50 | 31.70 | 8.94 | 4.68

Adding Chulls smoothly reduces the formation casualty percentage here. Weighted Chulls are protected more than infantry, rather than absorbing more deaths themselves. Their contribution can shield other units through the rate stage even though they contribute no combat Power.

Pure Chulls | Own / hostile Power | CURRENT loss % | NORMALIZED loss %
--- | --- | --- | ---
1 | 0 / 10 | 78.43 | 26.67
10 | 0 / 10 | 66.67 | 26.67
100 | 0 / 10 | 26.67 | 26.67

Zero own Power with positive opposition uses the existing 80% base cap. These are fixed-opposition diagnostics, not proportional fights; the ratio is undefined. Pure Chulls cannot win against positive Power just because they survive. At one Chull, a normalized 26.67% rate means either zero or one death, not a fractional survivor.

## FIELD SURGERY

Even pressure. Theoretical loss percentages by rank 0 / I / II / III. Rank I and II give the same existing +1 Survival per Spearman; III gives +2. This plateau is source behavior, not simulation noise.

BM share | Troops | CURRENT 0 / I / II / III | NORMALIZED 0 / I / II / III
--- | --- | --- | ---
0 | 10 | 22.73 / 20.83 / 20.83 / 19.23 | 12.50 / 8.33 / 8.33 / 6.25
0 | 100 | 12.50 / 8.33 / 8.33 / 6.25 | 12.50 / 8.33 / 8.33 / 6.25
0 | 1000 | 2.27 / 1.19 / 1.19 / 0.81 | 12.50 / 8.33 / 8.33 / 6.25
0.5 | 10 | 25.00 / 23.81 / 23.81 / 22.73 | 25.00 / 16.67 / 16.67 / 12.50
0.5 | 100 | 25.00 / 16.67 / 16.67 / 12.50 | 25.00 / 16.67 / 16.67 / 12.50
0.5 | 1000 | 25.00 / 4.17 / 4.17 / 2.27 | 25.00 / 16.67 / 16.67 / 12.50
0.25 | 20 | 22.73 / 20.00 / 20.00 / 17.86 | 16.67 / 11.11 / 11.11 / 8.33
0.25 | 100 | 16.67 / 11.11 / 11.11 / 8.33 | 16.67 / 11.11 / 11.11 / 8.33
0.25 | 1000 | 4.17 / 1.85 / 1.85 / 1.19 | 16.67 / 11.11 / 11.11 / 8.33

25/75 cannot be represented exactly with ten troops: its small-army check uses twenty (5 BM / 15 SP). No composition rounding is hidden. Normalization makes research's percentage-point effect stable across proportional sizes, but not uniform across compositions. The full four-model data also captures Surgery's per-Spearman effect on selection weights.

## MARGINAL UNIT EFFECTS

Even relative pressure; theoretical normalized loss percentage and expected deaths. Holding relative pressure fixed intentionally removes the combat advantage from added Power. The fixed-hostile column restores that advantage against the original opponent Power.

Formation | Power | Normalized loss % | Expected deaths | Fixed-hostile normalized loss %
--- | --- | --- | --- | ---
sp | 100 | 12.50 | 12.500 | 12.50
sp-plus-bm | 100.5 | 12.63 | 12.751 | 12.56
bm | 50 | 50.00 | 50.000 | 50.00
bm-plus-sp | 51 | 49.50 | 50.000 | 48.53
mixed | 75 | 25.00 | 25.000 | 25.00
mixed-plus-bm | 75.5 | 25.25 | 25.500 | 25.08
mixed-plus-sp | 76 | 24.75 | 25.002 | 24.43
mixed-plus-chull | 75 | 24.51 | 24.760 | 24.51
mixed-plus-shard | 170 | 23.82 | 24.059 | 10.51

One fragile troop worsens percentage resilience slightly; adding a durable troop improves it in these cases. Percent losses and absolute deaths are different: a lower percentage applied to more troops can still mean more deaths. Shardbearers also unlock existing support Power, so fixed-opposition results differ sharply from controlled relative pressure without implying a Survival discontinuity.

## ANOMALIES / SURPRISES

- The entire 100-troop gradient cannot distinguish normalization from CURRENT; it tests composition and selection only.
- CURRENT size scaling is severe for pure compositions, but absent for zero-total-Survival 50/50 infantry.
- Normalization assigns the same percentage resilience to a lone specialist and a thousand proportional specialists; small-battle outcomes remain discrete.
- Weighting creates a strong fragile-screen incentive, not just a cosmetic distribution change.
- Very durable rare units can have low practical risk without being mathematically immune.
- Severe pressure depletes the fragile pool and increases durable-unit exposure; weight ratios do not translate directly into death-probability ratios.
- The 95% rate cap masks the worst negative-Survival amplification and does not guarantee a surviving troop.
- Field Surgery I and II are identical; there is no smooth improvement at every research rank.
- Chulls lower loss rates without raising Power; survival must not be confused with positional victory.
- Marginal Power changes, especially Shardbearer support, would confound Survival comparisons without controlled pressure.

## METHOD AND REPRODUCTION

This run contains 102 scenarios, 408 aggregate rows and 696,000 seeded army evaluations. Ordinary rows use 1000 seeds; Shardbearer-containing rows use 10000. These are independent single engagements, not attrition campaigns.

Only CURRENT, NORMALIZED, WEIGHTED and NORMALIZED + WEIGHTED are included. All retain floor 0.03, base factor 0.25, maximum base 0.80, final cap 0.95, no optional Survival cap, and no Conclave effects. Normalized effective Survival = 100 × researched total Survival / troop count. Weighted selection uses w = exp(clamp(−ln(2) × researched singleton Survival, −20, 20)), then an exponential race −ln(U)/w sampled without replacement, preserving the exact casualty count. Default weights: BM 2, SP 0.5, Chull 0.25, Shardbearer 0.03125. Field Surgery I/II makes SP weight 0.25; III makes it 0.125.

CURRENT calls the real applySurvivalLosses. Other variants use the existing isolated adapters without changing formulas. Each formation's researched effectivePower is multiplied by the specified ratio to supply exact scalar hostile Power; no fabricated opponent units or battle winner are inferred. All models share scenario/replication seeds. Aggregate per-unit probability means average deaths / starting count; casualty share means aggregate deaths of that type / aggregate total deaths.

Run `npm run balance:survivability` (optional `-- --reps 1000 --rare-reps 10000`). [Full CSV](../../analysis/survivability-model/results.csv) includes every composition/pressure/model metric; [manifest](../../analysis/survivability-model/manifest.json) records source hashes, configuration and counts. Seeds start at zero; no seed-level bulk files are written. Sampled tables show two decimals, so very small differences may be rounding. No model is ranked or selected.
