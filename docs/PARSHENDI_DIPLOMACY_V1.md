# Parshendi Diplomacy V1

Implemented 2026-10-18. Balance is provisional and **TESTING**.

Warcamp → Diplomacy contains independent Hostility and Favor explanations,
standing tribute, the shared Parshendi Petitions board, and assistance tiers.
Purchasing an ally happens only inside an existing active PvP battlefield.
Existing Hostility bands, aggression, peaceful decay, retaliation, Deep Plains
eligibility and reward formulas remain in place.

## Balance constants

All values live in `convex/diplomacyRules.ts`.

| Contract | Payment | Reward | Hostility reduction |
| --- | --- | --- | --- |
| Standing tribute | Separate Sphere or Gemheart donations; accumulated 10,000 Spheres AND 1 Gemheart per Favor | 1 Favor per completed pair | First 10,000 Spheres: 8; first Gemheart: 4; cumulative logarithmic diminishing returns |
| Donate Plateau | Relinquish the requested neutral-origin plateau | 1 Favor | 15 |
| Challenge the Aggressor | Qualifying authoritative PvP battle victory | 1 Favor | 15 |
| Break the Occupation | Conquer a named plateau from its listed owner during the petition, retain control and claim | 1 Favor | 15 |

Personal donation progress has two bars, one for Spheres and one for Gemhearts.
Each completed pair consumes exactly 10,000 Sphere credit and one Gemheart credit
and grants a Favor. Excess stays saved toward subsequent Favor; progress does not
expire. Payments are independent and choose a whole amount with a slider or exact
input. The preview shows the actual whole-point Hostility reduction and Favor gain.

For total donations S and G within the kingdom's current 24-hour window, define:

`D(S,G) = floor(8 × log2(1 + S/10000) + 4 × log2(1 + G))`.

A donation reduces Hostility by the difference between D after and before payment,
never below zero. This makes splitting payments equivalent to a single payment,
including whole-point rounding. Diminishing returns reset 24 hours after the window's
first donation; Favor progress stays saved. The first 10,000 Spheres removes eight
Hostility, and the first Gemheart removes four. Later equal donations remove less.
A small donation can show zero whole-point reduction while still advancing Favor.
Per-payment limits are 1,000,000 Spheres or 1,000 Gemhearts, subject to affordability.

At five Favor, donations are blocked before any charge. A donation that would award
more Favor than the remaining room is rejected in full, with its progress preserved.
Petition rewards remain blocked at the cap. No reward is silently consumed.
Every donated Gemheart enters the shared authoritative reserve; no exchange exists.

The economy currently starts a kingdom at 1,200 Spheres and one Gemheart.
Research costs several thousand Spheres, while a Half-Shard costs 15,000 Spheres
and two Gemhearts. A completed donation pair is therefore an expensive repeatable option; petitions
require world actions and reduce more Hostility. These are explicit initial values,
not a conclusion about live-player affordability.

| Favor cost | Formation | Fixed Power |
| --- | --- | --- |
| 1 | Parshendi Scouts | 150 |
| 2 | Parshendi Warband | 300 |
| 3 | Parshendi Veterans | 500 |
| 4 | Parshendi Honor Guard | 750 |
| 5 | Chasmfiend | 1,000 |

Ordinary base Power is 1 per Spearman and 2 per Heavy, before Research and
Shardbearer support. Thus the top tier is approximately 1,000 unresearched
Spearmen or 500 Heavies. Existing Chasmfiend encounters also operate in this
general Power range. No ordinary unit balance was changed.

## Shared petition lifecycle and eligibility

An internal hourly mutation maintains up to three shared slots, each lasting
24 hours. Slot 2 is reserved for Break the Occupation once available: a random
player-owned holding weighted Gemheart 4, Ancient 3, other 1. Completion opens
that slot for the next hourly refresh; expiration selects a fresh 24-hour request.
The other slots select recently captured plateaus and kingdoms with effective
Hostility of at least 68, preferring a mix where possible. Available petitions
keep their original expiration. Fulfilled petitions leave immediately; hourly
evaluation fills empty slots only when another suitable world objective exists.
There are no rotating Sphere or Gemheart payments, including fallback offers.
Old unfulfilled supply petitions are hidden/rejected immediately and marked inactive
by the next refresh. Their historical rows remain intact. An empty board explains
that there are no suitable world events yet; it never invents a payment objective.
No personal acceptance, quest journal, or separate quest progress system exists.

Generation reads the most recent 200 captured owned plateaus and the highest
200 stored Hostility rows, using indexes and effective peaceful decay. It avoids
reissuing a plateau/target while it appears in the bounded recent petition window.
This is a small-world V1 selection policy, not a global event-processing system.
Occupation considers up to the 500 most recently created owned holdings, avoids
requesting the same plateau within 24 hours and avoids overlap with Return Plateau.
Its conquest proof, anti-farming checks and deliberately unimplemented mission
ideas are documented in [the targeted feasibility assessment](PARSHENDI_PETITION_FEASIBILITY.md).

Plateau donation requires current ownership, a neutral origin/resistance history,
and no active siege or Conflict Board. Home plateaus cannot be donated. Donation
uses the existing neutral reclamation defense/count conventions, clears production
timers and ownership, updates seasonal territorial records, reconciles Research,
and reconciles retaliation scheduling. Ownership is checked inside the transaction.

Aggressor eligibility uses server-produced Conflict Board battle receipts, with
no acceptance prerequisite. The battle must occur during the petition's window,
have a surviving unambiguous winner, and inflict at least 10 troop casualties on a
target with at least 100 pre-battle Power. Same-account kingdoms and administrative
observers are excluded. The attacking participant's existing opponent-chain
position must be at most three (chains reset after 24 hours without another attack).
This is farming resistance, not a guarantee against coordinated human collusion.
Legacy PvP results do not earn these receipts; live PvP uses Conflict Boards.
One receipt lists all qualifying defeated targets and can be spent on only one
petition, including in a multi-kingdom battle. Replayed resolutions cannot duplicate it.

Fulfillment, costs, reward, receipt consumption and shared completion are one
Convex transaction. Donations also have a per-player receipt bound to the resource and amount for safe retries.
Favor is an integer from zero to five. A reward exceeding the cap rejects before
any economic settlement, donation, victory consumption or territory change.

## Allied formation rules and deliberate exceptions

Allies extend the existing formation record with an `allied` discriminator and
fixed tier/Power. Its empty `units` container exists for backward-compatible troop
accounting; it contains no synthetic soldiers or ordinary unit stats. Shared
presence/Power/projection helpers recognize the special piece.

- One active ally per kingdom globally, reserved and paid for atomically. Purchase
  uses the Board's existing revision and idempotency receipt. Rejected placements
  and retries never charge Favor.
- Active participants may deploy at their existing entry: the defending kingdom's
  controlled Command Post, otherwise Defender Reserve; attacking kingdoms use Safe
  Approach. Deployment is immediate, before the next resolution. There is no
  arbitrary-square placement. Enemy-occupied entry squares reject deployment;
  friendly occupancy is allowed without merging.
- Moves one connected square per resolution, following existing explicit routes,
  safe-area restrictions, collision/combat and combat-stops-movement rules. There
  is no Speed, Survive or Plunder specialization and no automatic pathfinding.
- Allied Power joins the kingdom's local combat Power. Ordinary troop Power is
  still calculated as a pooled force, preserving nonlinear Shardbearer effects.
  Ordinary casualty/equipment calculations only receive ordinary troops.
- One defeat disperses the ally, with a report to its owner. A tie disperses allies
  on both sides, consistent with the existing resolver routing all non-winners.
  Allies never retreat or suffer partial casualties; victorious allies retain Power.
- Friendly arrivals and convergence never merge allies into armies. Splitting,
  recruiting, transferring, carrying loot, equipping and raiding are unavailable.
- Allies may contest and capture the Command Post under the existing conquest hold.
  They cannot establish an independent raid foothold or extract Spheres.
- Storms do not inflict allied casualties or change allied Power. Storm vision and
  ordinary Ledger Intel filtering still apply. Allied contacts retain kingdom
  identity/colors and use a distinct marker without exposing their tier or routes.
- Allies persist within their conflict until defeated, withdrawn with the player's
  forces, or the conflict ends. Reservation cleanup shares the settlement transaction.
  Empty unit accounting prevents allies becoming permanent returned troops.

## Validation and release

Focused tests exercise resource/cap races, tribute retries/reserve/diminishing
returns, shared claims, expiration, ownership/siege checks, consumed victory
receipts, repeat-opponent farming, all Favor costs, illegal placement, concurrent
deployment, the global active limit, movement, merges/arrivals, small and large
combat, Chasmfiend defeat, storms, objectives, Intel and conflict-end withdrawal.
Browser tests cover mobile/desktop purchase controls and donation confirmation.

Release checks for the Occupation update: 504 Vitest tests; 50 live Board/Diplomacy browser tests at
390/1440 widths; 45 Lab browser tests at 390/700/1440; two static Pages-prefix
tests. Both static frontend and isolated Lab builds pass. The existing Plateau
Run tests can log scheduled push teardown warnings while still passing.

Schema changes add Diplomacy tables and indexes; no reset, destructive migration,
resource grant endpoint or backfill is needed. New progress and window totals are optional fields.
Already-rewarded full V1 contracts never become new Favor credit: legacy tribute
counts only initialize the current diminishing-returns history. Old cached clients
receive an explicit refresh message instead of being charged for the former contract. Existing kingdoms read as zero
Favor until their first Diplomacy transaction. Initialize petitions with the
idempotent internal `diplomacy:refreshPetitions` after deployment; hourly refresh
then maintains the board. Preserve `CONFLICT_BOARD_V1_ENABLED` and existing auth.

TypeScript's standalone compiler reports 38 existing diagnostics on both HEAD and
this implementation, with identical normalized messages and no new diagnostics.
The existing project does not install TypeScript as a dependency; deployment uses
`--typecheck disable` after the explicit baseline comparison and runtime tests.
This limitation is recorded rather than extending this feature into unrelated fixes.
