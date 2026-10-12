# Conflict Board V1 backend integration — 2026-10-11

Status: implemented and tested locally; **not deployed or enabled**. This follows
the readiness fixes in `88b2e94`. Normal navigation and the legacy PvP frontend
remain unchanged. This is the authenticated backend integration, not a public
frontend cutover. The Lab remains a separate browser-local simulation.

## Authoritative boundary

`convex/conflictBoards.ts` exposes authenticated open, reinforce/join, standing
order, split, Fabrial switch, merge-route nomination, withdrawal and viewer-query
functions. Actor identity comes from the signed-in player; no client-provided
kingdom identity, Research, Intel, seed, clock, resolver configuration or full
snapshot is trusted. Only the internal scheduler can advance a resolution.

`CONFLICT_BOARD_V1_ENABLED=true` is required to open/join/commit. It is absent/off
by default. Turning it off does not strand existing participants: querying,
orders, withdrawal, scheduled processing and settlement continue. Nothing here
sets the environment variable or adds a normal-game navigation entry.

Commands carry a player-scoped request ID and expected revision. Exact retries
return their original receipt, conflicting reuse fails, and stale revisions
fail. At a due event boundary orders wait for the server update. A transaction
commits state, asset accounting, outcome notifications and its next scheduled
wake together. Duplicate wakes before the next due event do nothing; old wakes
may safely process the next genuinely overdue event. An indexed five-minute
recovery task reschedules overdue conflicts, without client polling.

## Storage and reusable core

- `boardConflicts`: bounded board/objective/cargo metadata, frozen rules, timing,
  revision, escrow and terminal outcome.
- `boardParticipants`: kingdom/Research, committed and currently deployed totals,
  withdrawal status, cumulative returned units/cargo and already credited loot.
- `boardForces`: one deployed/transit formation per row; authoritative arrival
  timestamps are separate from the resolver's cycle representation.
- `boardEquipment`: physical instance reservations and returned/lost/consumed
  receipts against existing aggregate kingdom Fabrial inventory.
- `boardCommands`: idempotent command receipts.
- `boardCycles`: private, bounded event chunks; only own battle results are
  projected to player queries.

`convex/conflictBoardState.ts` loads/persists these records and performs settlement.
`conflict-board/board.ts` extracts the existing Lab board/default rules without
changing them. `applyArrivals` was extracted from the existing resolver so travel
can finish between battles without advancing a cycle. The Lab and backend share
movement, combat, casualties, cargo, Intel projection, equipment and weather code.

The server accepts explicit approved routes, including orders submitted while
traveling. A changed defender arrival point can invalidate a route; the existing
resolver pauses it instead of secretly choosing a replacement. Routes are limited
to 128 steps per submitted command. Admission/splitting checks a 400,000-character
snapshot/100,000-current-troop transaction safety budget. These are technical
limits, not a tactical formation cap, and never prevent already-committed assets
from resolving or returning. They need production-load measurement before any
future expansion; no arbitrary three-formation restriction was added.

## Timing and settlement rules approved in this task

- Two-hour base travel uses existing Speed/bridged travel modifiers; two-hour
  resolution boundaries start at declaration. Early arrivals get no extra turn.
- Existing automatic-defense presets can place defenders at the Command Post
  when the conflict opens. Defender arrivals join a controlled Post immediately;
  otherwise they enter reserve. Outside armies always arrive at approach.
- Storm start/end and arrivals are scheduled alongside cycles. Overdue work is
  processed chronologically, one event transaction at a time. Research is loaded
  from the real kingdom for processing. New commitments meet active storms before
  merging. A forecast is never mistaken for an already-ended storm.
- At coincident events, weather is applied, due arrivals join, withdrawals return,
  then movement/combat resolves. Withdrawal therefore precedes battle movement;
  it does not dodge storm exposure already due at that timestamp.
- Participant withdrawal returns that participant's survivors, equipment and
  carried cargo. Owner withdrawal clears its objective control but does not end
  a conflict containing outside forces. A withdrawn kingdom can recommit real
  troops with normal travel while the conflict remains open.
- If no outside deployed/transit troops remain, the owner retains the plateau.
- At 24 hours ordinary maneuvering stops. A conquest hold already underway gets
  its one pending response resolution; if it fails there is no extension or new
  hold. With declaration-relative two-hour cycles, this final hold resolution is
  naturally on the 24-hour boundary. A fresh last-boundary capture cannot earn
  additional time.
- Conquest changes ownership only after the shared hold rule succeeds.
- Unclaimed cargo is destroyed once under the existing core rule. Cargo on
  surviving armies at withdrawal/end is paid to the carrying kingdom, including
  cargo still in transit. Remaining raid escrow goes back to the original owner.
- A stale conflict cannot overwrite an administrative ownership change; it
  cancels, refunds surviving assets and releases its own plateau reference.

### Treasury pool: TESTING

Opening reserves `floor(max(0, defender.spheres) * 0.10)` from the currently
recorded treasury. No minimum or maximum was invented. It is escrow, not free
new Spheres: normal spending cannot double-spend the vulnerable funds. Separate
plateau conflicts reserve from the remaining treasury. The shared raid cap is
unchanged (100 per raid before the existing storm multiplier/capacity limits).
Production economic tuning remains open.

### Equipment compatibility

Half-Shards reserve real inventory, receive stable instance IDs, use the shared
formation lifecycle/loss rules, and reconcile once on return. Split/merge never
mints inventory. Lost items reduce owned stock; surviving items release committed
stock. There is no second legacy loss roll.

Painrial repeated-engagement consumption remains experimental and Soulcaster's
operation reward has no approved Board mapping. The live commitment endpoint
explicitly rejects them; their Lab controls and testing logic remain intact.
No hypothetical effect was enabled to make integration look complete.

## Downstream reconciliation

Conquest reuses Gemheart cycle initialization, Research reconciliation, plateau
holding history, territory scoring, retaliation scheduling and one final Military
outcome. The conquest winner receives the existing victory award using its own
opponent-chain record. Successful defense receives one existing defense award
against the initiating kingdom, plus the existing defensive-siege Research credit.
Tactical square battles never award siege victories.

Provisions include both deployed/transit Board forces. The existing omission of
traveling legacy siege reinforcements was also fixed; arrived reinforcement rows
are not counted twice. Finished conflicts leave zero active deployed totals,
no live formation/arrival rows, no pending order/activation references, no reserved
equipment and no plateau lock. Audit/command receipts remain intentionally.

Legacy sieges/retaliations cannot run simultaneously on a Board plateau; ordinary
neutral expeditions and combat formulas remain unchanged. New board tables are
included in existing administrative world resets; stale scheduled wakes after a
reset exit harmlessly. Legacy retaliation target exclusion remains the existing
policy, now including active Boards; the hard deadline prevents indefinite locks.

## Verification and limits

17 new backend integration tests cover authentication/gating, validation rollback,
idempotent commands, third-party entry, ownership enforcement, provisions,
automatic defense/combat, conquest and future conflict reopening, simultaneous
withdrawal/re-entry, timeout and in-transit returns, deadline holds, cargo raids
and third-party interception/conservation, physical equipment/split/merge/return,
server-side fog disclosure and real Highstorm identities/catch-up/retry behavior.

Full unit suite: **429 passed across 40 files**. Local production frontend and
isolated Lab builds passed. All **45 Lab browser tests** passed at 390/700/1440px;
both static subpath/refresh/zero-backend-traffic checks passed. Existing unrelated notification-push test teardown
warnings remain. The repository-wide TypeScript check has preexisting errors in
legacy files (including optional `chull` fields); new integration/shared Board
files have no reported TypeScript errors. A readiness-era cargo helper type was
narrowed to its actual required fields, without changing its calculation.

At the original integration checkpoint, Convex API type generation ran, but no `convex dev`/`convex deploy`, deployment
finalization, migration, environment update, main push or Pages publication was
performed. Convex component codegen does contact the configured service for
analysis; its CLI source confirms it does not finalize a deployment. Live load
and authenticated browser smoke tests against a development deployment have not
been claimed. They remain rollout checks when deployment is authorized.

That original checkpoint included no normal-game UI cutover, production activation, balance change, Conclave
attachment, new Fabrial effect or expanded Intel system is included.

### Authorized online rollout follow-up

The backend has since been explicitly deployed to `groovy-buzzard-108`. Normal
Siege UI plumbing now supplies authenticated discovery, selected-board subscriptions,
real commitments/reinforcements, explicit routes and standing orders, split/merge
route preferences, equipment switching and withdrawal. The army roster uses backend
owned-unit totals, including Board commitments. The enabled flag also prevents stale
clients creating new legacy PvP sieges. Existing legacy operations are unchanged.

Additional checks bring the unit suite to **434 tests across 41 files**, including
20 backend Board integration stories. Four new browser checks cover 390/1440px
route editing, scoped split/commit payloads and kill-switch withdrawal access.
All 45 existing Lab browser checks and both zero-backend static checks still pass.
Runtime activation/rollback commands and personal test steps are in
[DEPLOYMENT.md](../DEPLOYMENT.md). No balance constants changed.
