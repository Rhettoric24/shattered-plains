# Conflict Board Resolution Lab

Development/testing, in-memory rules experiment. Run `npm run lab` at the repository root, then open **http://127.0.0.1:4186**. Restart the server after source edits. The local server bundles into memory and serves only three allowlisted assets on loopback. The Lab does not read environment credentials, create a Convex client, or call Convex. Browser Content Security Policy also disables connections.

## Remote testing / GitHub Pages

The direct public URL is **https://rhettoric24.github.io/shattered-plains/lab/**. No development PC or login is required. This URL is public, not access-controlled. A `noindex, nofollow` hint discourages search indexing; it is not security. There is no link in the player-facing navigation.

`npm run build` still builds the normal game. Run **`npm run build:lab` afterward** to add the three independent static assets in `dist/lab/`. The Lab build also works alone and needs no Convex environment variables. It never clears the game output. Running the game build afterward clears `dist`, so rebuild the Lab after it.

The existing `Deploy static site` workflow runs on pushes to `main` or manual dispatch. It builds the game with its unchanged `groovy-buzzard-108` frontend target, builds the Lab separately, then uploads the combined `dist/` directory and publishes it with GitHub Pages Actions. Neither step deploys Convex. Relative Lab asset links support the repository prefix and direct directory refreshes.

Hosted saves remain local to each browser/device and origin. They do not sync with other devices or localhost. `npm run test:lab:static` checks the built artifact under a simulated `/shattered-plains/lab/` prefix at mobile/desktop widths, including refresh, saves, and zero backend traffic. Build the game and Lab before running it.

## Playing

Load a preset and click/tap an army. This opens the existing Army Workshop in a dialog scoped to that army, including its Research and debug controls. **Move · draw route** returns to the board: tap connected positions in sequence, then **Confirm route**. Tapping the previous node backtracks one step; Clear empties the draft; Cancel leaves the committed route alone. Invalid jumps are rejected. Drag is deliberately not implemented. Advanced typed routes remain in the Workshop; both interfaces use the same approval function. No automatic pathfinding is used by this interface.

The selected army and its current position are highlighted. Approved paths have gold outlines, retreat history has purple dashed borders, and unconfirmed proposals have orange backgrounds/outlines. Numbered labels show path order even where histories overlap. Green node-button borders mark valid next taps. Nothing moves until **Resolve Next Cycle**. Routes persist; choose Continue or Pause after defeat. Reaching a destination becomes Hold. Splitting subtracts the entered troop counts from the selected parent.

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
8. Resolve eligible Raid orders against uninterrupted flank footholds, using surviving troops after combat/merges. Then an enemy end-of-cycle Post occupant starts a hold. Maintaining Post control through the next complete cycle marks conquest. Any displacement breaks it, including step-one loss followed by step-two recapture. An unsuccessful attack does not. Legal owner stays separate; no real ownership transfer. A conquered scenario must be reset before more cycles.

### Raid V1: carried loot (Lab only)

West Raid occupies **A1**, East Raid **C1**; graph connections are unchanged. Position metadata (`objective: "raid"`), not those labels, drives Raid rules. The Command Post remains the only conquest objective. New presets: **Center vs flanks**, **Chull raid**, and **Raid under attack**.

An outside kingdom must end a resolution controlling a Raid objective. It may then choose **Raid** for the subsequent resolution. Arrival never pays automatically, including Speed's second step. Hold and Move never pay. An active Raid order repeats each resolution while uninterrupted control remains; it does not require Plunder specialization. The original defender cannot raid itself.

Extraction per flank per cycle is **min(max(0, surviving Plunder − carried cargo), Raid cap, fake Treasury remaining)**. The existing editable cap stays **100** (the brief mentioned 20,000, but this checkout used 100). The original defender starts with **50,000 fake Spheres**, editable as remaining Treasury in scientist controls. Research affects capacity through existing Plunder. Extraction reduces Treasury and attaches cargo to the formation; it does not bank value.

Cargo is now an owner-agnostic amount. Legacy source-keyed saves are accepted by summing their amounts; source identity never affects capture or delivery. Splitting with cargo remains prohibited. Friendly merges sum cargo; no troop combat/stat formulas change.

Defeat cargo bands compare **winning kingdom pre-casualty Power / losing kingdom pre-casualty Power**: [1,1.5) drops 25%; [1.5,2) 50%; [2,3) 75%; >=3 drops 100%. These are discrete bands, not interpolation, and do not use combined hostile Power or Survival. Zero-Power losers facing a positive winner drop 100%. Annihilation drops all cargo. Highest-Power ties apply no defeat percentage; annihilated cargo and capacity overflow become unclaimed.

For each battle: snapshot Power → resolve normal casualties → remove defeat/annihilation drops from pre-battle cargo → enforce surviving capacity on retained cargo (additional overflow goes directly to unclaimed) → offer defeat/annihilation drops to the surviving winning kingdom → uncarried remainder becomes unclaimed. Existing cargo has priority. Winners' temporary movement groups pool spare capacity, with proportional internal accounting until their existing end-of-cycle merge; routes, histories and Speed behavior remain unchanged. This also permits later substep combat to capture that cargo again. There is one kingdom-level captured event, not multiple competing awards.

After each substep's retreats/control updates, outside carriers at Approach bank cargo. Defender carriers at their controlled Command Post deposit **all** cargo into the fake Treasury, regardless of source. Reserve and an enemy-controlled Post are not drop-offs. Nothing returns to a treasury based on original ownership.

The conflict-level **Unclaimed** pool (cargoLost) records both overflow and uncarried drops. No tile loot or scavenging exists. When conquest ends the Lab conflict, the pool moves to cargoDestroyed with an explicit destruction event; its historical total remains visible. Cargo still carried by surviving armies is not silently destroyed or automatically banked at conquest.

The full cycle remains arrivals → step-one movement/combat/cargo → retreats/control → bank/deposit → same sequence for Speed step two → friendly merges → flank extraction → conquest and unclaimed settlement. New extraction cannot bank within that same cycle.

The earlier apparent transfer bug came from capacity overflow bypassing capture and the single-winning-formation restriction. Overflow after the approved defeat drop still deliberately goes directly to unclaimed, but defeat drops are now offered to pooled winner capacity.

Command Post control remains persistent when an occupier simply leaves, with displacement/annihilation breaking control as before this patch. Fractional cargo remains supported because Plunder is fractional. Both flanks still share one Treasury, allocating in sorted objective-ID order if scarce. Scientist removal discards that edited army; it is not a combat/settlement operation. Legacy V0 scores remain historical banked values.

The summary shows Treasury, carried/banked value per kingdom, deposited value, unclaimed cargo and historical settlement destruction. Army cards show carried amounts; the selected army shows capacity and owner-agnostic cargo. Journal events explain extraction, full/empty limits, annihilation, capture, overflow, routed cargo, banking and recovery. All saves stay browser-local. None of these numbers touch the real economy.

`raidFootholds[position]` stores kingdom, establishment cycle, and occupying formation IDs. Each movement/combat/retreat boundary checks that at least one previously occupying formation remains alive, in place and unrouted. Friendly overlap extends the occupant set. Splits propagate membership; final merges rebind identity without restarting the foothold. Replacing all occupiers breaks continuity even if the kingdom color stays the same, including an old occupier dying while a new friendly entrant wins the battle. Losing and retaking in a later substep also resets readiness. Failed enemy attacks do **not** reset it.

The journal records foothold establishment, Raid readiness, broken footholds, unsuccessful Raid orders, and payouts including kingdom, original-defender target, position, formation, Plunder, value and cycle. Newly established footholds display the response window; established ones show RAID-READY. Ordinary Lab saves remain local; older saves gain flank metadata without changing army orders or balances.

Continue after defeat restores the approved path from the accepted retreat node. If fallback reaches staging outside that approved path (possible after a fresh-root merge), the order pauses with an explanation rather than inventing a route.

### Stats and casualties

The **Combat model** selector defaults to **Current · reference**. **Experimental Survival** uses the existing balance-harness experiment: effective Survival = `100 × researched total Survival / troop count`, followed by weighted individual casualty selection with `weight = exp(clamp(-ln(2) × researched singleton Survival, -20, 20))`. Sampling uses the harness's seeded exponential race without replacement and preserves the rounded casualty count. It is not a balance decision.

Experimental keeps the fixed 25% base factor, 3% minimum, 80% maximum base rate, 95% final rate cap, and no optional Survival cap. Current's scientist casualty controls are disabled/ignored while Experimental is selected and retained when switching back. Research, unit values, Power winners and all movement/objective rules stay unchanged. Same-kingdom groups at a position still combine for one casualty calculation, so splitting does not multiply the normalization or lottery.

Every preset works under either model; loading a preset retains the selection. Use the same preset and seed for comparison. Switching midway affects future battles only, not previous outcomes. The journal labels each battle's actual model and shows per-type `lost/starting` counts, including zero losses for participating unit types. Saves retain the selection; older saves without it load as Current.

`conflict-board/experimental-survival.ts` carries only the browser-safe experimental calculation from `combat-balance/models.ts` at analysis commit `45733e7`, with no CLI/report imports. `survival-harness-fixtures.json` contains 162 exact harness outputs across size, research, Shardbearer and zero-Power cases (three seeds each). `current-lab-fixtures.json` contains 116 cycle hashes from the unchanged resolver at `d5ec7ed`, covering all presets and two seeds, up to four cycles or conquest. Tests verify the port against the former and Current against the latter, excluding the newly added battle-model label and the Raid-under-attack preset whose V0 score semantics were intentionally replaced by V1 cargo. Direct model integration tests still verify real casualty outputs for both selectors. Neither the analysis branch nor its report corpus was merged into this Lab branch.

Directly imports `effectivePower`, `effectiveSpeed`, `effectiveSurvivability`, `unitPlunder`, `applySurvivalLosses` and troop helpers from `convex/rules.ts`, which is a pure rules module. Shardbearer support is calculated once per kingdom per engagement. Casualties are rolled once per kingdom and allocated fairly back to temporary groups with a seeded draw. Splitting does not multiply support or casualty rolls.

Specialization is independent of Power. For N troops, ratings are:

- Speed: positive tactical Speed / (0.75 × N)
- Survive: positive Survive / (2 × N)
- Plunder: positive Plunder / (15 × N)

The unique largest rating must be at least 1 and strictly greater than 60% of the sum. Otherwise None. All constants are editable Lab settings. Speed grants tactical movement; Entrenchment remains deferred. Raid V1 is available to any eligible outside formation, with its payout derived from actual Plunder rather than a specialization gate.

Field Surgery (`painrialMedicine`) affects Survive. Tailored Armor (`soulcastArmor`) affects Power and Speed. Pack Harnesses (`packHarnessDesign`) affects Plunder and Speed. Bridge Engineering's flat bonus is excluded only from tactical Speed; the displayed travel comparison includes it. Conclave modifiers are off. Production Research is unchanged.

Base casualty rate is clamped to 3%–80%, using 0.25 × combined hostile Power / own Power. These parameters and an optional positive-Survive cap are configurable. Existing survivability mitigation, negative-Survive amplification, seeded rounding, troop selection and final 95% rate cap are retained. Large positive-Survive forces can be very resilient; this is deliberately visible for experimentation.

Zero hostile Power causes no casualties. Zero own Power against positive hostility uses the configured maximum base rate. All-zero contests tie and retreat without losses; a lone zero-Power army can occupy an empty node. An annihilated highest-Power winner leaves no controller and never promotes the runner-up.

## Files and tests

- `conflict-board/types.ts`: graph/state/order/result types.
- `planning.ts`: route approval/drafting, split accounting, loop-erased histories.
- `stats.ts`: actual stat adapter and specialization.
- `resolver.ts`: pure phased engine and structured journal.
- `resolver.test.ts`: movement, combat, casualty conservation, retreat, merging, research, objective and determinism regression tests.
- `raids.ts`, `raids.test.ts`: continuous flank control, Lab-only payouts and Raid/route regression tests.
- `lab/`: browser workshop, presets and experimental defaults.
- `scripts/conflict-lab.mjs`: isolated loopback server/in-memory bundle.
- `playwright.lab.config.ts`, `tests/lab/`: separate browser harness; no live-game auth/setup.

Run `npm test` and `npm run test:lab:browser`. Browser tests cover 390, 700 and 1440px and assert no external requests.

Pure deterministic replay is not database idempotency: replaying identical inputs yields identical results, and stale cycle numbers are rejected. A future live adapter still needs atomic cycle persistence and immutable input/config versions. This Lab intentionally has no scheduler or database writes. The current shared casualty helper allocates a per-troop array; giant synthetic armies can be expensive. No arbitrary gameplay formation cap has been added. Production resource budgets and asset/exposure cohorts must be addressed before integration.

## Deliberately deferred

Live sieges, real treasury theft, final Raid balance, deadlines/overtime, withdrawal missions, live Intel integration, storms, equipment, Conclaves, notifications, production scoring and all production migration/integration. Formations are command groups, not permanent equipment or exposure identities; later accounting cohorts can sit beneath them without changing graph/order concepts.

Verified unrelated accounting issue: `ownedUnitsIncludingAway` in `convex/provisionHelpers.ts` includes deployed siege troops but omits traveling `siegeReinforcements`. Recruitment uses this for provisions and Gemheart Baron Chull limits. Left unchanged; resolve separately before live integration.

### Publishing this feature branch

No deployment is part of Raid V1 implementation. The existing main-branch Pages workflow republishes the combined game + Lab artifact, not Lab alone. Publishing later requires reviewing/merging the focused branch with explicit publication approval, or approving a separate Lab-only artifact workflow. No Convex deploy is needed.

### Experimental cargo percentages

Under Experimental constants, edit the four **Defeat cargo drop percentages** (0–100%) and click **Apply constants**. Defaults are 25/50/75/100. Power boundaries remain 1×, 1.5×, 2× and 3×; only the percentage dropped changes. Each band is independently adjustable, including non-monotonic experiments. Applies to future battles under either combat model. Highest-Power ties still have no defeat drop, annihilation always drops all cargo, and capacity overflow rules are unchanged. Settings persist across presets and browser saves; older saves use the defaults. **Reset cargo percentages** immediately restores these four defaults without changing other constants.

## Lab player view and Military Intel (TESTING)

Use **Enter player view · Fog / Intel** to test visibility and issue own-army orders. Return to scientist mode for unrestricted editing, presets and the existing Current/Experimental Survival controls. Select a viewing kingdom and expand **Lab Intel controls** to edit its Military Intel against each rival independently. Values, fog preference and viewing kingdom persist with browser-local saves.

Vision includes every occupied friendly node and its directly connected neighbors. Intel uses the existing shared Military disclosure helpers, not a new ladder:

| Military Intel | Inside vision (or fog off) | Outside vision with fog on |
| --- | --- | --- |
| 0–24 | Qualitative Power | Hidden |
| 25–74 | Estimated Power | Qualitative Power |
| 75–100 | Exact Power | Estimated Power |

Fog off reveals presence everywhere but preserves the Intel limits on details. High Intel does not reveal enemy composition, cargo, routes, orders, Research or raw debug events. Player battle reports show only the viewer's own results. Historical investigation discoveries and enemy reinforcement ETA disclosure remain deferred.

`conflict-board/disclosure.ts` creates an allowlisted transport projection; `lab/player-view.ts` renders only that projection. A later authenticated Convex query can supply authoritative state, viewer identity and per-rival Military Intel to these pure helpers. No backend schema, query, mutation or deployment is added now.

**This is a visibility simulation, not secure multiplayer fog.** The browser still stores full scientist state and allows changing viewers/Intel. Real secrecy requires server-side projection and authorization. Ordinary play remains entirely client-side with zero Convex requests.

### Selected-army Workshop in player view

Tap your army on the board to select it and open its controls below the board. The player Workshop supports naming/editing troop counts, adding entered counts, splitting, creating a local army, removing an army, and queuing fake reinforcements for the next cycle. Existing split conservation/cargo restrictions and resolver-controlled reinforcement entry are reused. Continue/Pause, typed routes and planned merge-source nomination are also available. Edits affect only the selected viewer's armies; enemy disclosure is unchanged. Selection stays with the edited/split army across rerenders.

Retreat history in both views uses a single purple hue: the nearest fallback is lighter, with progressively darker older positions. Fallback numbers accompany the colors. Current position, approved route and unconfirmed route retain distinct markers; selecting a different army clears the previous trail.

### Player popup and drag movement (local playtest)

Tap your own army to open its stats/orders popup (a bottom sheet on mobile). Summary stats reuse `formationStats` with the current Lab configuration, including normalized specialization ratings, plus cargo/capacity. Move, Hold, Split and Raid sit above the Lab-only unit editor. Split has its own troop selector. Unavailable Raid is dimmed with a flank/foothold explanation. Standing behavior and advanced route/merge controls follow the editor.

Mouse: press and drag an army. Touch: hold an army briefly (320 ms), then drag. Each crossed connected square is numbered; retracing the previous step removes it. Release leaves a proposed route for Confirm/Cancel. Move also supports existing tap-by-tap routes. Escape, lost touch capture and interrupted gestures cancel without replacing the standing order. Army cards reserve touch gestures; scroll from the surrounding board. During dragging, the viewport gently scrolls near its top/bottom edges. Scientist layout and resolver behavior are unchanged.
