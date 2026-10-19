# Additional Parshendi petitions — code fit and unresolved design

Initial assessment requested 2026-10-18; service requirements approved 2026-10-19.
Occupation and all three service types below are implemented. Numerical balance
remains TESTING; the current rules replace the earlier discussion-only proposals.

## Break the Occupation — implemented

One shared occupation slot chooses a named player-owned plateau for 24 hours.
The internal hourly refresh fills the slot after completion or expiration. Within
the current candidate pool, Gemheart weight is 4, Ancient/legacy Ancient weight 3,
and other types weight 1. These are provisional weights, not guaranteed categories.
Selection considers up to the 500 most recently created owned holdings, excludes
administrative/missing owners, legacy siege targets, active petition targets and
plateaus already requested for occupation within the last 24 hours. Existing active
non-occupation petitions keep their terms until completion/expiry. Slot 2 becomes
dedicated to occupation once available. Home holdings are eligible under the same
existing PvP targeting rules; the listed owner need not have high Hostility.

Occupation is selected before new Return Plateau requests to avoid contradictory
objectives for the same holding. The original owner cannot claim its own bounty.
Names and owners are public; the petition does not disclose protected type/trait
Intel simply because selection favored valuable types.

The existing `boardConflicts` settlement record is authoritative proof: outcome
must be `conquest`, winner must be the claimant, original defender must be the
listed occupier, and settlement must occur during the petition window. A Board
already underway when the request appeared can qualify. The claimant must still
own the plateau with the same `heldSince` timestamp as that settlement. Ownership
alone, neutral/PvE capture, administrative transfer, deadline defense, cancellation
and losing then independently reacquiring the holding are insufficient.

The winner's existing attacker chain position must be 1–3; same-account/observer
targets are excluded. Claiming marks the conquest record with a petition ID in
the same transaction as the reward and shared completion, so it cannot satisfy a
second occupation petition. Favor cap rejection leaves both proof and reward
unconsumed. Reward is 1 Favor and 15 Hostility reduction; the winner keeps the
plateau. A combat victory and a later conquest are distinct outcomes; claiming
the conquest does not consume an unrelated battle receipt used by Aggressor.

No combat, territorial transfer, Board geometry or casualty rules were changed.

## Escort, Intel and Highstorm services — implemented 2026-10-19

All remain shared, first-come petitions. There is no acceptance, personal quest log,
community contribution meter, or separate completion step. Favor and Hostility
rewards are paid atomically at dispatch/sharing: **1 Favor and 15 Hostility**.
The cap is checked before spending Intel or reserving troops.

### Troop requirements and returns

Both troop missions use Research-adjusted ordinary formation Power, including the
existing Shardbearer support rule. Minimum Power is personal to the contributing
kingdom, using real age since founding, rather than world age or current army size:

`ceil(200 + 800 × clamp((now - kingdom.createdAt) / 14 days, 0, 1))`.

This reaches 600 at seven days and 1,000 at fourteen, then stays capped. A new
kingdom in an old world starts at 200. Sending troops elsewhere cannot lower this
requirement. It remains TESTING; age is a predictable initial proxy for development,
not evidence that every kingdom will grow at the same pace.

Dispatch subtracts selected ready troops and creates an authoritative assignment
in the same transaction as shared fulfillment and reward. Counts must be whole,
nonnegative, available and currently allowed by Barracks/unit rules. Allied
Parshendi pieces, equipment, operatives and Conclaves cannot be loaned.

A kingdom may have **one active troop assignment across both mission types**.
Survivors still count toward Provisions, recruitment capacity and military ownership
through the existing away-unit accounting helper. The Diplomacy view shows the
commitment, losses and return time as army activity. No cancellation or early recall.
The scheduled internal return and five-minute overdue recovery share an idempotent
return operation; retries cannot duplicate soldiers. A completed dispatch can be
retried with the same petition and composition without another cost/reward.

Escort service lasts exactly four real hours. All loaned soldiers return safely,
including if an ordinary Highstorm occurs during the loan. Speed does not shorten
this commitment. Its safe-service exception is deliberate.

### Share Intelligence

The server chooses a random non-observer kingdom from the latest 200 kingdoms and
one of Military, Economy, Research or Territory. Targets need not have high
Hostility. Self/same-account targets are ineligible to the contributor. Another
kingdom can fulfill that shared request. With fewer than two candidate kingdoms,
no request is published. A draw may repeat a target or category.

The action spends **50 Intel in that category against that target**, using the
existing persistent category pool and legacy report fallback. Explicit zero balances
mask old fallback data after spending; other targets/categories and historical
reports remain intact. The preview shows the balance and disclosure tier after
sharing. This is Intel sold to the Parshendi for Favor, with no spy travel, new
operative mission, or transfer of player reports to another kingdom.

At most **three successful purchases globally per UTC clock hour**. The third
removes the Intel offer until the next hour. Purchases immediately draw the next
request in the same transaction; concurrent claims, repeated refreshes and stale
buttons cannot bypass the counter or duplicate a reward. Requests expire at the
next hour boundary; the shared hourly refresh runs on that boundary.

### Investigate New Forms

Dispatch is legal only during an authoritative active Highstorm. Selected troops
undergo one immediate deterministic exposure roll with a dedicated **60% base
casualty rate**, Research-adjusted pooled Survive, and a **300 Survive cap**.
For nonnegative Survive, final rate is `0.60 × 100 / (100 + min(Survive,300))`;
negative Survive follows the existing increased-loss formula and final-rate cap.
Existing seeded whole-troop casualty selection/rounding is reused. Equipment and
Conclave mitigation do not apply. Ordinary storm exposure remains at its 15% base.

Examples before rounding: 0 Survive → 60%, 100 → 30%, 300+ → 15%. These are
research-only TESTING constants in diplomacyRules.ts and can be tuned separately.
Casualties are permanent. Useful committed Power earns the fixed reward even if
none survive; the reward never scales with deaths. Late storm entry still pays
the full one-time exposure roll, but survivors wait less time before return.

The assignment retains its storm ID, losses and original return deadline. Neither
ordinary storm processing, retries nor return applies a second exposure. No future
forecast timing leaks through a petition: research publishes only during an active
storm. “New forms” is narrative purpose only, without unlocks or allied upgrades.

### Three-slot publication policy

Occupation retains slot 2, its 24-hour objective and hourly refill after completion.
Slot 1 becomes Intel when any pre-upgrade request there ends; published requests
keep their original terms. Slot 0 alternates available world objectives and escorts
at refill. Return Plateau and Aggressor remain world candidates; an escort is the
fallback when neither qualifies. Active storms take priority when slot 0 is free.
World objectives last 24 hours, escort offers four hours, and research offers until
the active storm ends. Existing unexpired requests are never evicted for a storm,
so research is opportunistic rather than guaranteed every storm. Troop/world
fulfillments refill hourly; only Intel refills immediately after purchase.

Selection remains bounded for this small-world version. Recent-petition selection
now takes the newest 200 rows in the indexed recent-expiry window to accommodate
up to 72 Intel purchases per day alongside the world/escort records.
