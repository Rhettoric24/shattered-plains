# Conflict Board V1 integrity pass — 2026-10-11

**YELLOW — integrate after the specific lifecycle/security blockers below.**
This pass changes no balance constants and enables/deploys nothing. It tests the
implemented reusable rules, not a hypothetical live Board backend.

## Lifecycle seams traced

| Stage | Current implementation / authority |
| --- | --- |
| Create conflict / register kingdoms | `ConflictState` in `conflict-board/types.ts`; currently constructed by `lab/scenarios.ts`. No live conflict table or admission mutation. |
| Commit / enter / reinforce | `formations` and `arrivals`; Lab Workshop creates fake units. `resolveCycle` consumes due arrivals before movement, using defender Post/reserve versus outsider Approach entry. No live unit reservation/travel adapter. |
| Orders and splits | `planning.ts` (`approveRoute`, `splitFormation`); standing orders stored on formations. Lab controls can edit these local records. |
| Movement, combat, retreat, merges | `resolver.ts`: `movementStep`, `resolveRetreats`, `mergeGroups`; two substeps, stop movement on combat, no edge fights, highest individual kingdom Power wins. |
| Raids and cargo | `raids.ts`: continuous foothold observation and `finishRaids`; `cargo.ts`: battle transfers, capacity limits, staging/Post banking, unclaimed destruction. |
| Intel | `disclosure.ts`: `projectConflict` / `projectJournal` allowlist DTOs; no authenticated Convex Board query. Full Lab state intentionally remains in the browser. |
| Fabrials | `fabrials.ts`: physical instances, switches, split/merge, protection, seeded losses and unavailable audit records. No aggregate live inventory reservation/return adapter. |
| Storms | `highstorms.ts`: pure immediate exposure and storm transitions; resolver exposes new commitments before merging. Uses shared live weather constants/casualty helper, but is NOT wired to `convex/highstorms.ts` or its cron. |
| Conquest | `resolveCycle`: completed hold sets `objective.conqueredBy`; destroys unclaimed cargo once; future cycles rejected. |
| Withdrawal / timeout / failed attack ending | Not implemented. Orders are Move/Hold/Raid. Staging is a position, not a mission return. Empty/abandoned boards continue accepting cycles. |
| Return / ownership / scoring / notification | Not implemented for Board. Survivors, transit records, carried cargo and equipment remain in terminal state for a future settlement adapter. `originalOwner` is not rewritten. |

Existing production `convex/plateaus.ts` still runs the old siege lifecycle:
`launchPlayerSiege`, `commitSiegeDefenders`, `reinforcePlayerSiege`,
`arriveSiegeReinforcement`, `resolveSiege`, and `getSiegeBoard`. Its pending-status
checks guard repeated resolution and it performs real survivor returns, plateau
updates, scoring and notifications. Those paths are not connected to Board rules.
`convex/seasonLedger.ts` records siege/territory outcomes; `fabrialHelpers.ts`
reserves/settles aggregate devices. These are integration seams, not verified Board
settlement. No backend files were modified in this pass.

## A. Fixed

- Weather could continue damaging a conquered conflict. Exposure/transition now
  leaves terminal state unchanged; split and persistent-switch commands reject it.
- Traveling forces' cargo was skipped by weather capacity reconciliation. Overflow
  now enters unclaimed immediately, including all cargo on annihilation; it no
  longer disappears when the transit record is removed.
- Delayed start/end delivery could reactivate an old storm after another storm.
  Closed storm identities now reject stale transitions. Existing same-storm
  exposure markers still guard split/merge/resolution/reload.
- Paused Move and Raid orders could still execute. Both now honor `paused`.
- Duplicate arrival record IDs and invalid objective controllers/hold references
  were accepted. Resolver validation rejects these malformed states before work.

## B. Verified

`conflict-board/integrity.test.ts` adds 12 focused tests. One runs all 15 presets
under eight seeds (120 trajectories, up to five cycles each), repeats each cycle
with reversed formations/arrivals/kingdoms/graph arrays, and checks:

- Per-unit survivors + recorded battle/storm losses = initial deployed + transit.
- Treasury + carried + banked + unclaimed + destroyed remains conserved. Recovered
  is an informational counter and is not counted again as money.
- Every initial device remains exactly once in inventory or an explicit consumed/
  lost/unsettled record; equipment validation continues to pass.
- Input snapshots are unchanged and stale cycle submissions are rejected.

Additional tests cover conquest with a third kingdom and late transit assets;
repeated split/merge/reinforcement with pending equipment; narrow through severe
cargo drops with zero/partial/full capture capacity, recapture and banking;
transit storm overflow/annihilation and retries; terminal commands; stale storm
delivery; paused commands; invalid identities; and exact secret-field exclusion
across view changes, splitting, storm fog and JSON reloads.

Existing resolver/cargo/Fabrial/disclosure suites retain movement crossing,
multiway ties, simultaneous retreats, stop-on-combat, return routes, raid/escape,
readiness continuity, equipment consumption/loss and disclosure-band coverage.

## C. Remaining activation blockers

1. **Authenticated durable Board boundary.** Add authoritative conflict/participant
   commitments, authorized orders, per-viewer query projection, atomic versioned
   cycle/storm writes and retry guards. Pure deterministic replay is not database
   idempotency. No live payload exists to security-certify today. Never expose the
   Lab state/seed/config/history as the real player query.
2. **Complete endings and exactly-once settlement.** Implement the approved live
   exits, including failed/abandoned conflicts, and reconcile deployed/transit
   troops, carried loot, surviving equipment, pending orders, plateau flags,
   ownership, scoring and notifications. Then prove a new conflict can start.
   Current conquest preserves assets but does not return them; empty boards have
   no terminal transition. Choosing timeout/withdrawal rules is not this repair.
3. **Live accounting and integration gates.** Include traveling commitments in
   provisions/army ownership; the existing `ownedUnitsIncludingAway` omits legacy
   `siegeReinforcements`. Map real Fabrial inventory to physical instances and return
   once. Unsupported Soulcaster rewards/Painrial policies must be explicitly
   gated or resolved before accepting those live commitments. Keep neutral/PvE
   siege paths separate and preserve existing defensive investments deliberately.

Performance sanity: no subscriptions, polling or Convex queries were introduced.
The static build allowlist still excludes backend clients. Projection is local
to one conflict and does not return enemy compositions, equipment, orders or raw
state. Shared casualty selection allocates per troop; live admission/transaction
work must respect resource limits. This pass did not impose a gameplay formation
cap or claim a database-load benchmark for a nonexistent backend.

## D. Preserved rules / playtest questions

No casualty, cargo, specialization, storm or Fabrial percentages changed.
Voluntary departure still leaves Post control persistent under implemented rules;
retreats may help a cargo carrier escape; ties and multiway control are unchanged.
Cargo-bearing splitting remains prohibited. Same-cycle scarce treasury still
allocates in objective-ID order. These are recorded behavior/design questions,
not silently changed as bookkeeping fixes. Deathball strength, sleep fairness,
storm harshness and raid reward tuning remain playtest questions.

## E. Deferred V2

Terrain, formal alliances, Narak, additional devices/Intel operations and new
objectives are not requirements for integrity. Entrenchment remains deferred;
no new tactical ability or ending rule was invented here.

## F. Verification

- Full unit suite: 412 passed across 39 files, including all 12 new integrity tests.
- Browser regression suite: 45 passed at 390/700/1440px.
- Production static frontend build and isolated Lab build: passed.
- Static subpath/zero-backend-traffic checks: 2 passed.
- Existing notificationPush teardown warnings still appear in unit tests; they
  did not fail the suite and were not changed here.
- No deployment, publication, migration or live feature activation.

## G. Changes

Core: `cargo.ts`, `fabrials.ts`, `highstorms.ts`, `planning.ts`, `raids.ts`,
`resolver.ts`, `types.ts`. Tests: new `integrity.test.ts`. Documentation:
this report and `lab/README.md` (including stale drag/storm/equipment statements).
Preexisting AGENTS.md and ROADMAP.md edits are untouched.
