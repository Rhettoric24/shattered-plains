# Additional Parshendi petitions — code fit and unresolved design

Assessment requested 2026-10-18. **Only Break the Occupation is implemented.**
Escort, Intel sharing and Highstorm research below are concepts under discussion,
not approved requirements or a feature backlog. No assignment tables, mission
endpoints, Intel spending actions or storm changes were added for these concepts.

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

## Escort loan — fits, with a small new reservation record

The proposed four-hour escort can reuse `armyRules.ts` commitment validation,
`subtractAvailableUnits`, scheduler patterns and normal troop return operations.
It cannot simply store troops in the petition: after shared fulfillment disappears,
the game still needs a durable, idempotent record of whose troops are due back.

A future assignment record would hold the kingdom, committed units, dispatch/return
times, status and petition receipt. Dispatch atomically subtracts available home
troops, fulfills the shared petition and schedules the return. Completion returns
troops once; an indexed overdue recovery pass covers scheduler delays. No army
may be donated twice, disbanded from home while away, or returned twice by retries.

`ownedUnitsIncludingAway` in `provisionHelpers.ts` explicitly sums each deployment
table. It must include escorts so loaned troops continue using Provisions. That
same helper supplies recruitment capacity, player accounting and world military
capacity. The normal roster should show an escort commitment and return time;
that is an army activity, not a personal quest log.

Recommended first version for discussion: guaranteed return after four real hours,
no cancellation, no equipment or Conclaves, fixed minimum meaningful commitment,
and one active escort per kingdom. Speed should not shorten a deliberately fixed
service commitment. Minimum contribution must consider combat value/composition,
not merely headcount, or cheap support troops could dominate the action.

OPEN: how many troops/Power, which types, whether there are losses, and reward
timing. An upfront Favor reward works for a guaranteed four-hour service loan.
If reward waits until return, later Favor gains can fill the cap: that requires
reserved reward capacity or an explicitly retained unclaimed reward. Silently
discarding Favor at return is unacceptable. Reservation would need every Favor
grant path to account for it; that is a larger change than the troop loan itself.

## Intel sharing — the smallest additional integration

`espionage.ts` already has four independent per-rival Intel pools and an atomic
Intel debit in Sphere Heist. A future Share Intelligence petition could ask for
a specified category against a named hostile kingdom; one eligible click spends
that Intel and grants Favor atomically. Existing investigations supply the Intel.
No new spy travel mission or operative risk is necessary for this version.

The current `categoryIntelAmount` and `intelResource` helpers are private to
`espionage.ts`. A future implementation should extract/reuse these helpers rather
than inventing another Intel balance or debit path. Category-specific fields must
be written explicitly, including zero, to mask legacy `amount`/report fallbacks
and prevent an already-spent dossier from appearing to replenish itself.

OPEN: category and cost (Military Intel has the clearest connection to an aggressor),
Hostility eligibility at publication versus fulfillment, and fixed reward. The UI
must preview the Intel remaining and any disclosure tier lost. Current information
can become less precise; old reports remain historical observations. Never erase
other category pools or another rival's Intel. A shared named target, cap checks,
and atomic first fulfillment prevent repeated consumption of the same petition.

If the intention is to actually dispatch spies, use the existing espionage mission
lifecycle and explicitly define operative commitment, return/loss and reward timing.
That is a separate decision from sharing already-gathered Intel.

## Highstorm field research — feasible, with the most decisions

The existing server owns storm identity/timing (`activeHighstorm`, `highstormRules.ts`).
`applySurvivalLosses` already uses Research-adjusted formation Survive, a seeded
whole-army casualty lottery, and an optional Survive cap. A future research
assignment can reuse it with a dedicated higher base casualty rate, preserving
ordinary exposure's existing 15% base and 300 Survive cap.

For nonnegative Survive, the current formula is
`baseRate × 100 / (100 + min(Survive, cap))`. Negative Survive instead increases
losses and must retain its existing rule. Examples for discussion, before seeded
whole-troop rounding, without equipment or Conclave effects:

| Formation Survive | Current ordinary storm: 15% base | Example research only: 60% base |
| --- | --- | --- |
| 0 | 15% | 60% |
| 100 | 7.5% | 30% |
| 300 or more, capped at 300 | 3.75% | 15% |

**60% is an illustrative design value, not an implemented constant.** Survive is
a pooled formation stat; it does not independently protect each soldier type.
Large formations can hit the cap, so requirements/rewards must not encourage
arbitrary troop splitting or a huge cheap force purely to exploit mitigation.

A future assignment needs a fixed storm ID and exactly one exposure receipt.
Retries, the ordinary storm cron, and mission completion cannot apply the research
loss twice. Troops committed during a storm need an explicit one-time entry rule;
late joining must not bypass the dangerous roll. Survivors return once at the end,
and committed troops stay in Provisions until losses/return settle. Equipment and
Conclave eligibility must be explicit. Parshendi allied pieces are not loanable
ordinary units and retain their agreed storm immunity.

The narrowest first version would enable the action only during an active storm:
commit the required troops, apply one research exposure roll immediately, grant a
fixed Favor reward in that same transaction, and return survivors when the storm
ends. This matches existing exposure-on-entry behavior, avoids reserving future
Favor capacity, and hides no extra forecast information. Late entry would still
pay the full casualty risk; only survivor waiting time would be shorter. This is
a suggested design to discuss, not an implemented rule. Publishing a minimum
useful military contribution remains necessary even if all losses earn fixed Favor.

OPEN: preparation versus joining an active storm, exact commitment, base loss rate,
Fabrial protection, whether complete loss can still fulfill the research, and when
Favor is awarded/reserved. Fixed rewards should depend on useful committed effort
or successful research, never on maximizing deaths. Use a preview of risk and
Survive mitigation. Do not reveal exact future storm times through petition
expiration or assignment countdowns to low-Watchtower players.

“Investigate new forms” can provide narrative purpose. It does not authorize a
new forms system, persistent Parshendi upgrades, Research unlocks or allied stat
changes. Any such mechanical outcome needs a separate design decision.

## Suggested discussion order

Intel sharing is the smallest next addition. A guaranteed four-hour escort is a
moderate extension with clear opportunity cost. Highstorm research has the strongest
risk/reward potential but needs the reward timing, casualty policy and exposure
boundary resolved before implementation. All three can preserve the shared
button-driven board; the delayed missions need army activity records, not quest logs.
