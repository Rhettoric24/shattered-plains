# Combat balance microscope — generated baseline

No model is selected as a winner. No production or Lab rules were changed. These are fresh-army, single-engagement samples, not attrition campaigns.

## Run provenance

```json
{
  "formatVersion": 1,
  "sourceRevision": "d5ec7ed73532f73f661055e95f55fd6380bf4b85",
  "sourceHashes": {
    "convex/rules.ts": "11d31686330efc5ffd2a48ff69605fe9fb1183b052fc26b1c1badcecefe624ab",
    "conflict-board/resolver.ts": "cb466b53fba0e3e9a11f63f3562802c93fa4f39b28fde3f125463a94397182d6",
    "lab/scenarios.ts": "69018249dd159c1dad7ef5b47f78406cb86c5dbf0c3511eb96be439c14a0cb8c",
    "combat-balance/models.ts": "69bf256a0a8494c1d130fc3b572ce8ce7bfb28afd106d0dbc8fefc50982ef14c",
    "combat-balance/catalog.ts": "4cd77293c2368e55455ffdbfd40bbd66fd0fc3ae2239c1b06573ade36aa74551",
    "combat-balance/aggregate.ts": "a21d2c6c9761ed21ce4f7bb7c23e5a707608bbc45d29fb9604b75b1ade153036",
    "combat-balance/report.ts": "56fcb177e8cdb960892b8893a25ccd3b3948d23b151c19b6daaf79efd2a25ed1",
    "combat-balance/run.ts": "6b6cc85b10d9fcfad46790089abd347f5fe03ede60ab7426037878011255b340"
  },
  "seedSchedule": "SHA256(combat-balance/v1|scenario|replication|side), same across variants",
  "replications": 1000,
  "shardReplications": 5000,
  "seedStart": 0,
  "scenarios": 45,
  "models": [
    {
      "floor": 0.03,
      "survival": "total",
      "selection": "equal",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "current",
      "label": "CURRENT / BASELINE",
      "family": "current"
    },
    {
      "floor": 0.01,
      "survival": "total",
      "selection": "equal",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "floor1",
      "label": "EXPERIMENTAL / 1% floor",
      "family": "floor1"
    },
    {
      "floor": 0,
      "survival": "total",
      "selection": "equal",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "floor0",
      "label": "EXPERIMENTAL / 0% floor",
      "family": "floor0"
    },
    {
      "floor": 0.03,
      "survival": "total",
      "selection": "weighted",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "weighted",
      "label": "EXPERIMENTAL / weighted selection",
      "family": "weighted"
    },
    {
      "floor": 0.03,
      "survival": "density",
      "selection": "equal",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "normalized",
      "label": "EXPERIMENTAL / normalized Survival — NOT BALANCED",
      "family": "normalized"
    },
    {
      "floor": 0.03,
      "survival": "density",
      "selection": "weighted",
      "densityScale": 100,
      "weightStrength": 0.6931471805599453,
      "id": "normalized-weighted",
      "label": "EXPERIMENTAL / normalized + weighted — NOT BALANCED",
      "family": "normalized-weighted"
    }
  ],
  "battleReplications": 390000,
  "armyEvaluations": 786000,
  "aggregateRows": 546
}
```

Full aggregates: [results.csv](../../analysis/combat-balance/results.csv). No individual-seed records are stored. Paired SHA-256 replication identities are shared across variants.

## Verified implementation

CURRENT directly uses effectivePower, baseCasualtyRate, effectiveSurvivability and applySurvivalLosses from convex/rules.ts. The specified 25% Power ratio, 3%–80% base clamp, additive Survival, positive 100/(100+S), negative 1+abs(S)/100, 95% final clamp, seeded rounding and equal individual shuffle all match source. Zero hostility gives zero losses; zero own Power facing hostility uses the 80% base maximum. Conclaves, Fabrials and Highstorms are off, matching the Lab. The optional Survival cap defaults to uncapped.

Shardbearer support adds min(non-Shard base supporting Power, 100 × Shardbearers), besides their 20 Power each. Research Power is not additional supporting base Power. Field Surgery III adds 2 Survival per Spearman; Tailored Armor III adds 1 Power per Spearman. Shardbearer +5 Survival protects the army, not that individual from the CURRENT selection lottery.

## Experimental definitions — NOT BALANCED

- FLOOR 1 / FLOOR 0 change only the base floor.
- NORMALIZED: S_effective = densityScale × total researched Survival / troops; zero for an empty army. Default densityScale = 100. Existing final-rate caps still apply.
- WEIGHTED: w = exp(clamp(-weightStrength × individual researched Survival, -20, 20)); default strength = ln(2). Default weights: Bridgeman 2, Spearman 0.5, Chull 0.25, Shardbearer 0.03125; Surgery III Spearman 0.125. A seeded exponential key -ln(U)/w per individual selects casualties without replacement. Weights are positive. Total losses exactly match the equal-selection model per seed. Weight ratios are not final death-probability ratios when most troops must die.
- NORMALIZED + WEIGHTED combines those isolated changes.

Normalized selection reuses production rounding/shuffling by neutralizing its Survival adjustment and feeding the desired rate; it does not copy the engine. CURRENT cannot be experimentally overridden. CLI overrides affect only experimental rows; exact settings are in the manifest and CSV.

## Observations — not recommendations

1. 100 Bridgemen versus 1: CURRENT averages 6 deaths; removing only the floor averages 0.504. Analytic expectations: 6 and 0.5.

2. Equal Bridgeman armies rise from 27.5% final losses at size 10 to 95% at size 1,000. The final 95% cap binds at size 280 under the current 25% base rate.

3. Equal Spearman armies: growing from 100 to 1,000 changes expected losses from 12.5 to 22.7273 despite ten times as many troops. Final rates: 12.5% and 2.2727%.

4. Illustrative density normalization makes equal pure-Spearman loss percentages independent of size (12.5% before rounding). Its arbitrary scale of 100 matches CURRENT at 100 troops; this is not an approved balance constant.

5. 100 Bridgemen + 1 Shardbearer vs 100 Spearmen: Shardbearer death is 40.38% under CURRENT and 0.82% under weighting. Total losses are exactly paired per seed; different units absorb them.

6. Field Surgery III on 1,000 Spearmen reduces expected losses from 22.7273 to 8.0645 against the same untreated opponent. Per-Spearman +2 Survival changes the army-size curve.

7. Adding 20 Chulls to 30 Spearmen facing 60 Spearmen leaves Power unchanged; expected total losses change from 11.5385 to 14.7059. Average Spearman deaths change from 11.515 to 8.766: Chulls supply both army Survival and casualty-pool tickets. Plunder itself does not affect combat.

8. Adding one Bridgeman to 100 Spearmen against 100 Spearmen changes expected total losses from 12.5 to 12.6253. Extra Power does not necessarily offset the added body and reduced Survival.

9. The one-Bridgeman tie has 25.25% final loss rate, but individual samples lose 0 or 1 troops. More generally the 95% rate cap does not guarantee survivors in tiny forces because of stochastic rounding.

10. Tailored Armor III changes 100 Spearmen from 100 to 200 Power. Against 100 untreated Spearmen expected losses fall from 12.5 to 6.25 without changing Survival.

## Floor comparison — first army

Scenario | Model | Power | Hostile | Survival | Base % | Final % | Expected deaths | Mean deaths
--- | --- | --- | --- | --- | --- | --- | --- | ---
bm-100-v-1 | current | 50 | 0.5 | -100 | 3 | 6 | 6 | 6
bm-100-v-1 | floor1 | 50 | 0.5 | -100 | 1 | 2 | 2 | 2
bm-100-v-1 | floor0 | 50 | 0.5 | -100 | 0.25 | 0.5 | 0.5 | 0.504
bm-100-v-10 | current | 50 | 5 | -100 | 3 | 6 | 6 | 6
bm-100-v-10 | floor1 | 50 | 5 | -100 | 2.5 | 5 | 5 | 5
bm-100-v-10 | floor0 | 50 | 5 | -100 | 2.5 | 5 | 5 | 5
bm-100-v-50 | current | 50 | 25 | -100 | 12.5 | 25 | 25 | 25
bm-100-v-50 | floor1 | 50 | 25 | -100 | 12.5 | 25 | 25 | 25
bm-100-v-50 | floor0 | 50 | 25 | -100 | 12.5 | 25 | 25 | 25
bm-100-v-100 | current | 50 | 50 | -100 | 25 | 50 | 50 | 50
bm-100-v-100 | floor1 | 50 | 50 | -100 | 25 | 50 | 50 | 50
bm-100-v-100 | floor0 | 50 | 50 | -100 | 25 | 50 | 50 | 50

## Army-size curves

Scenario | Model | Troops | Power | Total S | Applied S | Base % | Final % | Expected | Mean | Observed %
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
scale-bm-1 | current | 1 | 0.5 | -1 | -1 | 25 | 25.25 | 0.2525 | 0.25 | 25
scale-bm-1 | normalized | 1 | 0.5 | -1 | -100 | 25 | 50 | 0.5 | 0.489 | 48.9
scale-sp-1 | current | 1 | 1 | 1 | 1 | 25 | 24.7525 | 0.2475 | 0.229 | 22.9
scale-sp-1 | normalized | 1 | 1 | 1 | 100 | 25 | 12.5 | 0.125 | 0.119 | 11.9
scale-bm-5 | current | 5 | 2.5 | -5 | -5 | 25 | 26.25 | 1.3125 | 1.308 | 26.16
scale-bm-5 | normalized | 5 | 2.5 | -5 | -100 | 25 | 50 | 2.5 | 2.506 | 50.12
scale-sp-5 | current | 5 | 5 | 5 | 5 | 25 | 23.8095 | 1.1905 | 1.17 | 23.4
scale-sp-5 | normalized | 5 | 5 | 5 | 100 | 25 | 12.5 | 0.625 | 0.606 | 12.12
scale-bm-10 | current | 10 | 5 | -10 | -10 | 25 | 27.5 | 2.75 | 2.734 | 27.34
scale-bm-10 | normalized | 10 | 5 | -10 | -100 | 25 | 50 | 5 | 5 | 50
scale-sp-10 | current | 10 | 10 | 10 | 10 | 25 | 22.7273 | 2.2727 | 2.281 | 22.81
scale-sp-10 | normalized | 10 | 10 | 10 | 100 | 25 | 12.5 | 1.25 | 1.253 | 12.53
scale-bm-25 | current | 25 | 12.5 | -25 | -25 | 25 | 31.25 | 7.8125 | 7.803 | 31.212
scale-bm-25 | normalized | 25 | 12.5 | -25 | -100 | 25 | 50 | 12.5 | 12.51 | 50.04
scale-sp-25 | current | 25 | 25 | 25 | 25 | 25 | 20 | 5 | 5 | 20
scale-sp-25 | normalized | 25 | 25 | 25 | 100 | 25 | 12.5 | 3.125 | 3.11 | 12.44
scale-bm-50 | current | 50 | 25 | -50 | -50 | 25 | 37.5 | 18.75 | 18.735 | 37.47
scale-bm-50 | normalized | 50 | 25 | -50 | -100 | 25 | 50 | 25 | 25 | 50
scale-sp-50 | current | 50 | 50 | 50 | 50 | 25 | 16.6667 | 8.3333 | 8.323 | 16.646
scale-sp-50 | normalized | 50 | 50 | 50 | 100 | 25 | 12.5 | 6.25 | 6.253 | 12.506
scale-bm-100 | current | 100 | 50 | -100 | -100 | 25 | 50 | 50 | 50 | 50
scale-bm-100 | normalized | 100 | 50 | -100 | -100 | 25 | 50 | 50 | 50 | 50
scale-sp-100 | current | 100 | 100 | 100 | 100 | 25 | 12.5 | 12.5 | 12.469 | 12.469
scale-sp-100 | normalized | 100 | 100 | 100 | 100 | 25 | 12.5 | 12.5 | 12.469 | 12.469
scale-bm-250 | current | 250 | 125 | -250 | -250 | 25 | 87.5 | 218.75 | 218.752 | 87.5008
scale-bm-250 | normalized | 250 | 125 | -250 | -100 | 25 | 50 | 125 | 125 | 50
scale-sp-250 | current | 250 | 250 | 250 | 250 | 25 | 7.1429 | 17.8571 | 17.855 | 7.142
scale-sp-250 | normalized | 250 | 250 | 250 | 100 | 25 | 12.5 | 31.25 | 31.271 | 12.5084
scale-bm-500 | current | 500 | 250 | -500 | -500 | 25 | 95 | 475 | 475 | 95
scale-bm-500 | normalized | 500 | 250 | -500 | -100 | 25 | 50 | 250 | 250 | 50
scale-sp-500 | current | 500 | 500 | 500 | 500 | 25 | 4.1667 | 20.8333 | 20.821 | 4.1642
scale-sp-500 | normalized | 500 | 500 | 500 | 100 | 25 | 12.5 | 62.5 | 62.463 | 12.4926
scale-bm-1000 | current | 1000 | 500 | -1000 | -1000 | 25 | 95 | 950 | 950 | 95
scale-bm-1000 | normalized | 1000 | 500 | -1000 | -100 | 25 | 50 | 500 | 500 | 50
scale-sp-1000 | current | 1000 | 1000 | 1000 | 1000 | 25 | 2.2727 | 22.7273 | 22.738 | 2.2738
scale-sp-1000 | normalized | 1000 | 1000 | 1000 | 100 | 25 | 12.5 | 125 | 125 | 12.5
scale-mixed-10 | current | 10 | 7.5 | 0 | 0 | 25 | 25 | 2.5 | 2.489 | 24.89
scale-mixed-10 | normalized | 10 | 7.5 | 0 | 0 | 25 | 25 | 2.5 | 2.489 | 24.89
scale-mixed-100 | current | 100 | 75 | 0 | 0 | 25 | 25 | 25 | 25 | 25
scale-mixed-100 | normalized | 100 | 75 | 0 | 0 | 25 | 25 | 25 | 25 | 25
scale-mixed-1000 | current | 1000 | 750 | 0 | 0 | 25 | 25 | 250 | 250 | 25
scale-mixed-1000 | normalized | 1000 | 750 | 0 | 0 | 25 | 25 | 250 | 250 | 25

## Single-Shardbearer risk

Sample estimates, not exact probabilities. SE is binomial standard error in percentage points. Observed zero has SE zero but does not imply immortality: a rough upper 95% bound is 3 / replications.

Scenario | Model | Runs | Expected deaths | Mean deaths | Shard dies % | All Shards survive % | SE pp
--- | --- | --- | --- | --- | --- | --- | ---
shard-bm20-light | current | 5000 | 0.7245 | 0.7256 | 3.94 | 96.06 | 0.2751
shard-bm20-light | floor1 | 5000 | 0.2415 | 0.2342 | 1.16 | 98.84 | 0.1514
shard-bm20-light | floor0 | 5000 | 0.1509 | 0.1452 | 0.88 | 99.12 | 0.1321
shard-bm20-light | weighted | 5000 | 0.7245 | 0.7256 | 0.06 | 99.94 | 0.0346
shard-bm20-light | normalized | 5000 | 1.08 | 1.0766 | 6.06 | 93.94 | 0.3374
shard-bm20-light | normalized-weighted | 5000 | 1.08 | 1.0766 | 0.08 | 99.92 | 0.04
shard-bm100-moderate | current | 5000 | 41.0313 | 41.0302 | 40.38 | 59.62 | 0.6939
shard-bm100-moderate | floor1 | 5000 | 41.0313 | 41.0302 | 40.38 | 59.62 | 0.6939
shard-bm100-moderate | floor0 | 5000 | 41.0313 | 41.0302 | 40.38 | 59.62 | 0.6939
shard-bm100-moderate | weighted | 5000 | 41.0313 | 41.0302 | 0.82 | 99.18 | 0.1275
shard-bm100-moderate | normalized | 5000 | 40.8333 | 40.8328 | 40.2 | 59.8 | 0.6934
shard-bm100-moderate | normalized-weighted | 5000 | 40.8333 | 40.8328 | 0.82 | 99.18 | 0.1275
shard-bm100-severe | current | 5000 | 95.95 | 95.9482 | 95.18 | 4.82 | 0.3029
shard-bm100-severe | floor1 | 5000 | 95.95 | 95.9482 | 95.18 | 4.82 | 0.3029
shard-bm100-severe | floor0 | 5000 | 95.95 | 95.9482 | 95.18 | 4.82 | 0.3029
shard-bm100-severe | weighted | 5000 | 95.95 | 95.9482 | 4.58 | 95.42 | 0.2956
shard-bm100-severe | normalized | 5000 | 95.95 | 95.9482 | 95.18 | 4.82 | 0.3029
shard-bm100-severe | normalized-weighted | 5000 | 95.95 | 95.9482 | 4.58 | 95.42 | 0.2956
shard-sp20-moderate | current | 5000 | 4.2 | 4.2038 | 19.48 | 80.52 | 0.5601
shard-sp20-moderate | floor1 | 5000 | 4.2 | 4.2038 | 19.48 | 80.52 | 0.5601
shard-sp20-moderate | floor0 | 5000 | 4.2 | 4.2038 | 19.48 | 80.52 | 0.5601
shard-sp20-moderate | weighted | 5000 | 4.2 | 4.2038 | 1.62 | 98.38 | 0.1785
shard-sp20-moderate | normalized | 5000 | 2.3967 | 2.4038 | 11.32 | 88.68 | 0.4481
shard-sp20-moderate | normalized-weighted | 5000 | 2.3967 | 2.4038 | 0.88 | 99.12 | 0.1321
shard-mixed-moderate | current | 5000 | 21.2185 | 21.2204 | 21.48 | 78.52 | 0.5808
shard-mixed-moderate | floor1 | 5000 | 21.2185 | 21.2204 | 21.48 | 78.52 | 0.5808
shard-mixed-moderate | floor0 | 5000 | 21.2185 | 21.2204 | 21.48 | 78.52 | 0.5808
shard-mixed-moderate | weighted | 5000 | 21.2185 | 21.2204 | 0.66 | 99.34 | 0.1145
shard-mixed-moderate | normalized | 5000 | 21.2285 | 21.229 | 21.48 | 78.52 | 0.5808
shard-mixed-moderate | normalized-weighted | 5000 | 21.2285 | 21.229 | 0.66 | 99.34 | 0.1145

## Mixed-army allocation

Scenario | Model | Mean total | BM deaths | SP deaths | Chull deaths
--- | --- | --- | --- | --- | ---
mixed-50-50 | current | 25 | 12.524 | 12.476 | 0
mixed-50-50 | weighted | 25 | 19.279 | 5.721 | 0
mixed-80-20 | current | 40 | 32.013 | 7.987 | 0
mixed-80-20 | weighted | 40 | 37.143 | 2.857 | 0
mixed-20-80 | current | 15.611 | 3.121 | 12.49 | 0
mixed-20-80 | weighted | 15.611 | 7.264 | 8.347 | 0
chull-escort | current | 14.691 | 0 | 8.766 | 5.925
chull-escort | weighted | 14.691 | 0 | 10.808 | 3.883
infantry-before-chulls | current | 11.515 | 0 | 11.515 | 0
infantry-before-chulls | weighted | 11.515 | 0 | 11.515 | 0
chull-pack-harness | current | 14.681 | 0 | 8.784 | 5.897
chull-pack-harness | weighted | 14.681 | 0 | 10.805 | 3.876

## Research — only the first army researched

Scenario | Model | Power | Total S | Applied S | Final % | Mean deaths
--- | --- | --- | --- | --- | --- | ---
surgery-10 | current | 10 | 30 | 30 | 19.2308 | 1.924
surgery-10 | normalized | 10 | 30 | 300 | 6.25 | 0.632
surgery-100 | current | 100 | 300 | 300 | 6.25 | 6.278
surgery-100 | normalized | 100 | 300 | 300 | 6.25 | 6.278
surgery-1000 | current | 1000 | 3000 | 3000 | 0.8065 | 8.071
surgery-1000 | normalized | 1000 | 3000 | 300 | 6.25 | 62.484
armor-100 | current | 200 | 100 | 100 | 6.25 | 6.275
armor-100 | normalized | 200 | 100 | 100 | 6.25 | 6.275

## Reading the data

CSV includes every army, opponents and Research, per-type casualties/rates, mean/median/min/max/population SD, rare-unit risk, annihilation, model constants and seed ranges. Unit rates and probabilities are fractions; casualtyPercent is percent. Absent-unit rates are blank, not measured zero risk. Nominal winner means unique highest pre-casualty individual Power; ties have none. The harness does not simulate board control, retreat, conquest or promotion. These benchmark opponents do not establish actual play frequency. No balance decision follows automatically from these measurements.
