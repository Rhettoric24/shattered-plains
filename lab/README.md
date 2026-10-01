# Conflict Board Resolution Lab

Development/testing, in-memory rules experiment. Run `npm run lab` at the repository root, then open **http://127.0.0.1:4186**. Restart the server after source edits. The local server bundles into memory and serves only three allowlisted assets on loopback. The Lab does not read environment credentials, create a Convex client, or call Convex. Browser Content Security Policy also disables connections.

## Remote testing / GitHub Pages

The direct public URL is **https://rhettoric24.github.io/shattered-plains/lab/**. No development PC or login is required. This URL is public, not access-controlled. A `noindex, nofollow` hint discourages search indexing; it is not security. There is no link in the player-facing navigation.

`npm run build` still builds the normal game. Run **`npm run build:lab` afterward** to add the three independent static assets in `dist/lab/`. The Lab build also works alone and needs no Convex environment variables. It never clears the game output. Running the game build afterward clears `dist`, so rebuild the Lab after it.

The existing `Deploy static site` workflow runs on pushes to `main` or manual dispatch. It builds the game with its unchanged `groovy-buzzard-108` frontend target, builds the Lab separately, then uploads the combined `dist/` directory and publishes it with GitHub Pages Actions. Neither step deploys Convex. Relative Lab asset links support the repository prefix and direct directory refreshes.

Hosted saves remain local to each browser/device and origin. They do not sync with other devices or localhost. `npm run test:lab:static` checks the built artifact under a simulated `/shattered-plains/lab/` prefix at mobile/desktop widths, including refresh, saves, and zero backend traffic. Build the game and Lab before running it.

## Playing

Load a preset, click any army, edit its troops or split some off. Splitting subtracts the entered troop counts from the selected parent. Choose a destination, inspect/change the proposed comma-separated route, then **Approve route**. Nothing moves until **Resolve Next Cycle**. Routes persist across cycles; choose Continue or Pause after defeat. Reaching a destination becomes Hold. The engine never chooses a new path.

Research applies to the selected kingdom. Army edits/creation and queued arrivals are fake troop creation tools, not economic actions. Changing an army's position resets its history. Use the merge control to nominate which incoming formation keeps its route/history. Save/load uses only this browser's localStorage. The journal includes readable results and expandable exact events. Tests use the same pure resolver as the UI.

## Experimental rules implemented

The board is an undirected graph. The supplied board has nine field nodes; only B1 connects to the Command Post. Approach connects to all three bottom nodes; reserve connects to the Post. Safe areas allow hostile coexistence and cannot be intermediate route shortcuts.

Each cycle:

1. Validate next cycle, troop counts, identities, histories and configuration; clone inputs.
2. Apply due fake arrivals. Outsiders arrive at Approach. Original-owner troops arrive at a defender-controlled Post, otherwise reserve. At the Post, a unique or explicitly nominated garrison absorbs arrivals immediately, retaining its order. If multiple planned detachments have no nominated recipient, arrivals Hold there as a separate temporary group, combine for local combat, and merge at cycle end. No database or actual travel clocks are involved.
3. Freeze each movement group's Speed eligibility from its current composition and Research. Invalid approved routes pause.
4. Move everyone one connection simultaneously; crossing opponents pass. At every contested position aggregate same-kingdom troops, calculate all Power and losses from the same pre-battle state, then apply losses. Highest individual Power wins; ties send everyone back. Fighting consumes the whole cycle's remaining voluntary movement.
5. Record objective displacement, then resolve retreats against surviving non-retreating occupants. Retreat claims happen in simultaneous fallback rounds. Opposing claims to the same empty node all skip it. Same-kingdom claims can share. Accepted destinations block later fallback rounds; no retreat battles or recursive eviction. Exhausted history falls back to the kingdom's safe area. Histories truncate and revisits erase loops.
6. Repeat movement/combat/retreat for eligible unfought Speed groups' second step. A group that fought in step one can still be attacked again.
7. Auto-merge same kingdom/position. Preserve explicit nominated source; otherwise a unique stationary resident; otherwise identical histories/orders; otherwise Hold with the current node as a fresh retreat root. No database/ID initiative chooses strategic routes. Temporary groups stay distinct until this point so merging cannot carry slow or already-fought troops into a second move.
8. An enemy end-of-cycle Post occupant starts a hold. Maintaining control through the next complete cycle marks conquest. Any displacement breaks it, including step-one loss followed by step-two recapture. An unsuccessful attack does not. Legal owner stays separate; no real ownership transfer. A conquered scenario must be reset before more cycles.

Continue after defeat restores the approved path from the accepted retreat node. If fallback reaches staging outside that approved path (possible after a fresh-root merge), the order pauses with an explanation rather than inventing a route.

### Stats and casualties

Directly imports `effectivePower`, `effectiveSpeed`, `effectiveSurvivability`, `unitPlunder`, `applySurvivalLosses` and troop helpers from `convex/rules.ts`, which is a pure rules module. Shardbearer support is calculated once per kingdom per engagement. Casualties are rolled once per kingdom and allocated fairly back to temporary groups with a seeded draw. Splitting does not multiply support or casualty rolls.

Specialization is independent of Power. For N troops, ratings are:

- Speed: positive tactical Speed / (0.75 × N)
- Survive: positive Survive / (2 × N)
- Plunder: positive Plunder / (15 × N)

The unique largest rating must be at least 1 and strictly greater than 60% of the sum. Otherwise None. All constants are editable Lab settings. Only Speed currently grants an ability; Entrenchment and Raid remain deferred.

Field Surgery (`painrialMedicine`) affects Survive. Tailored Armor (`soulcastArmor`) affects Power and Speed. Pack Harnesses (`packHarnessDesign`) affects Plunder and Speed. Bridge Engineering's flat bonus is excluded only from tactical Speed; the displayed travel comparison includes it. Conclave modifiers are off. Production Research is unchanged.

Base casualty rate is clamped to 3%–80%, using 0.25 × combined hostile Power / own Power. These parameters and an optional positive-Survive cap are configurable. Existing survivability mitigation, negative-Survive amplification, seeded rounding, troop selection and final 95% rate cap are retained. Large positive-Survive forces can be very resilient; this is deliberately visible for experimentation.

Zero hostile Power causes no casualties. Zero own Power against positive hostility uses the configured maximum base rate. All-zero contests tie and retreat without losses; a lone zero-Power army can occupy an empty node. An annihilated highest-Power winner leaves no controller and never promotes the runner-up.

## Files and tests

- `conflict-board/types.ts`: graph/state/order/result types.
- `planning.ts`: explicit route suggestions, split accounting, loop-erased histories.
- `stats.ts`: actual stat adapter and specialization.
- `resolver.ts`: pure phased engine and structured journal.
- `resolver.test.ts`: movement, combat, casualty conservation, retreat, merging, research, objective and determinism regression tests.
- `lab/`: browser workshop, presets and experimental defaults.
- `scripts/conflict-lab.mjs`: isolated loopback server/in-memory bundle.
- `playwright.lab.config.ts`, `tests/lab/`: separate browser harness; no live-game auth/setup.

Run `npm test` and `npm run test:lab:browser`. Browser tests cover 390, 700 and 1440px and assert no external requests.

Pure deterministic replay is not database idempotency: replaying identical inputs yields identical results, and stale cycle numbers are rejected. A future live adapter still needs atomic cycle persistence and immutable input/config versions. This Lab intentionally has no scheduler or database writes. The current shared casualty helper allocates a per-troop array; giant synthetic armies can be expensive. No arbitrary gameplay formation cap has been added. Production resource budgets and asset/exposure cohorts must be addressed before integration.

## Deliberately deferred

Live sieges, economy, deadlines/overtime, withdrawal missions, Intel, storms, equipment, Conclaves, notifications, scoring and all production migration/integration. Formations are command groups, not permanent equipment or exposure identities; later accounting cohorts can sit beneath them without changing graph/order concepts.

Verified unrelated accounting issue: `ownedUnitsIncludingAway` in `convex/provisionHelpers.ts` includes deployed siege troops but omits traveling `siegeReinforcements`. Recruitment uses this for provisions and Gemheart Baron Chull limits. Left unchanged; resolve separately before live integration.
