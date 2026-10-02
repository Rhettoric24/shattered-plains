# Combat balance microscope

Developer-only analysis. CURRENT is the control group. No experiment is a selected balance change. Nothing here is imported by the game or Resolution Lab; no database, network, accounts, deployment or live armies are used.

## Run

```sh
npm run balance:combat
npm run balance:combat -- --help
npm run balance:combat -- --scenario shard --replications 10000 --out analysis/combat-balance-shards
npm run balance:combat -- --models current,weighted,normalized-weighted --floor 0 --weight-strength 0.4 --out analysis/combat-balance-experiment
npm run balance:combat -- --scenario scale-sp --models current,normalized --density-scale 50 --seed-start 10000 --out analysis/combat-balance-density
```

Default: 1,000 seeds per scenario/model; 5,000 for each single-Shardbearer scenario. Explicit `--replications` sets both unless `--shard-replications` is also supplied. All variants share each scenario/army's SHA-256-derived seed. A fixed range is reproducible; change `--seed-start` for disjoint samples. There is no dependency installation or persistent compiled output: the existing esbuild tool bundles the CLI in memory.

Default output: `docs/audits/COMBAT_BALANCE_BASELINE.md`, `analysis/combat-balance/results.csv`, and `manifest.json`. `--out` places all three together (`report.md` instead). Only aggregates are written, never hundreds of thousands of seed records. The checked-in default snapshot is evidence; use `--out` for scratch comparisons. Reports record source hashes, the parent/source checkout revision, exact model parameters and counts. Hashes capture uncommitted implementation used by a run; the revision alone does not claim those files were already committed. Generation timestamps are omitted to permit identical reruns.

## Models

- **current:** direct production `baseCasualtyRate` + `applySurvivalLosses`; locked 3% floor, total researched Survival, equal-per-individual selection, no optional cap.
- **floor1 / floor0:** only the minimum base rate changes.
- **weighted:** current rate/count; experimentally weighted identities.
- **normalized:** `S_effective = densityScale × total researched Survival / troop count`, default scale 100. Zero troops gives zero effective Survival. This arbitrary reference-size model is illustrative, NOT BALANCED.
- **normalized-weighted:** combines the two isolated experiments.

Experimental overrides: `--floor`, `--density-scale`, `--weight-strength`, `--survive-cap`. CURRENT is never overridden. Defaults remain uncapped. The optional cap limits the effective Survival after the model's total/density transformation. Exact overridden settings are recorded, with variant IDs extended to avoid confusing them with defaults.

Weight per individual: `exp(clamp(-weightStrength × individualSurvival, -20, 20))`, default strength `ln(2)`. Individual Survival is computed by the real stat helper on one unit, including Field Surgery for Spearmen. Conclaves are off; army-wide modifiers are not misapplied to individuals. Draw `-ln(U)/weight` for every individual using a separate deterministic stream, sort ascending, and select exactly the production-determined loss count. This is weighted sampling without replacement, not weakest-first killing. Positive bounded weights prevent immunity. At heavy losses even protected types must die.

Normalized mode still uses the real final-rate helper. It passes a compensated rate and zero positive-Survival cap into the real loss function, which preserves its stochastic rounding and equal individual shuffle. Only the target final rate differs. Tests verify both negative/positive inputs; production is not refactored or monkey-patched.

## Scope and interpretation

Catalog includes 45 scenarios: Bridgeman mismatches; pure Bridgeman/Spearman size curves; balanced and skewed mixes; Chulls and Pack Harnesses; five single-Shardbearer cases from light to severe losses; Field Surgery III at three sizes; Tailored Armor III; marginal troop addition; zero Power; and a three-kingdom engagement. Both sides/all participants are reported. Power selects a nominal pre-casualty winner independently of losses; ties have no winner. No retreat or board campaign is simulated.

CSV includes all unit types, researched stats, hostile Power, analytical rates/expectations, observed mean/median/min/max/population SD, rare-unit probability/standard error and annihilation frequency. Per-unit rates are fractions; `casualtyPercent` is percent. Blank per-unit rates mean no such units were present. For these catalog cases Shardbearer death means the single Shardbearer dies; for custom armies with multiple it means at least one dies.

Finite Monte Carlo estimates are not guarantees. Zero observed deaths is not immortality. Seed pairing removes count differences from selection-only comparisons. Weighting necessarily reallocates casualties to other troops. No model is recommended by the tool.

Run tests with `npx vitest run combat-balance` or the full `npm test`. The baseline equivalence suite compares every catalog participant directly against production losses for multiple seeds.
