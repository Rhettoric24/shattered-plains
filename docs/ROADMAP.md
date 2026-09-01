# Shattered Plains --- Roadmap

A living priority list, not a promise that every idea ships.

# NOW --- Test Highstorms + Fabrials

## Highstorms

Observe: - forecast usefulness - deployment timing changes -
active-state clarity - casualty clarity - doubled-reward temptation -
+40% Parshendi danger - Fabrial interactions - duplicate exposure -
PWA/mobile behavior

## Painrial

-   Is 25% prevention noticeable?
-   Does launch consumption feel like insurance?
-   Does Watchtower forecasting affect use?
-   Do players fabricate replacements?

## Half-Shard

-   Is 50% protection exciting?
-   Is loss risk scary?
-   Does commitment behave correctly?
-   Does storm protection work?
-   Any duplication/return/loss bugs?

## Soulcaster

-   Does it create an interesting alternative to protection?
-   Is extra recovery understandable/substantial?
-   Does it make low-Plunder/high-reward armies interesting?
-   Is it too obviously correct on storm/Deep Plains raids?

# NOW --- Fresh Account Run

Track: - first meaningful military choice - first Research - Ancient
Plateau requirements - Market progression - first Highstorm - Hostility
escalation - first Deep Plains - first Fabrial discovery/fabrication -
first Sphere Heist opportunity - Ghostblood accessibility

Key question:

> **When do I stop having to choose?**

Pay special attention around Market 4--5.

# BEFORE FRIEND TEST --- Small Clarity Pass

-   ✅ Make Power/Speed/Plunder/Survive explanations tap-accessible
    on mobile.
-   ✅ Add one narrative-first fresh-player hint connecting Warcamp
    recruitment → Plains expedition. No build order.
-   ✅ Communicate starting Gemheart scarcity before easy irreversible
    spending.
-   ✅ Clarify rival Intel vs Economy Intel vs Ledger/disclosure quality.
-   ✅ Add one concise Intelligence-purpose explanation.
-   ✅ Standardize player-facing terminology on Survive.
-   ✅ Give empty neutral- and rival-plateau selectors explicit disabled
    states.

# FRIEND-TEST RELEASE HARDENING

Chosen environments: - DEV/pre-release: `clean-yak-51` -
PROD/friend test: `groovy-buzzard-108`. Add a third persistent staging
deployment later only if the workflow demonstrates a need for it.

Completed production preparation:

-   ✅ Removed the conditional frontend fallback; Pages explicitly names
    Yak until a deliberate production cutover.
-   ✅ Configured Buzzard auth, `SITE_URL`, admin access, and VAPID push.
-   ✅ Deployed the current backend and verified its function contract
    matches Yak.
-   ✅ Exported a pre-friend-test production snapshot.
-   ✅ Initialized the clean production world and reran bootstrap to
    verify idempotency. No legacy player migrations were required.

Remaining before friend invitations:

-   Run the production auth/new-account smoke test.
-   Change the Pages workflow backend from Yak to Buzzard explicitly.
-   Publish the production frontend and smoke-test the live PWA.

# FRIEND TEST

Primary purpose: learn, not impress.

Watch: - what players do first - recruitment/army composition
comprehension - four-stat comprehension - building comparisons -
mission-risk comprehension - Highstorm awareness and timing choices -
Hostility understanding - Intelligence usefulness - Fabrial
discovery/use - strategic specialization - economy tradeoffs - tedious
moments - exciting moments - self-created goals without formal endgame

Record behavior separately from explanations.

# AFTER / AROUND FRIEND TEST --- PvP Siege V2

Goal: asynchronous attack becomes asynchronous confrontation.

Candidate flow: 1. attacker encircles 2. defender can reinforce 3.
attacker can reinforce 4. attacker deliberately begins assault 5. hard
deadline prevents indefinite stalling

Before implementation settle: - minimum setup time - maximum duration -
reinforcement rules - timing reset behavior - notifications - deadline
resolution - Fabrial interaction

Do not expand into siege engines, surrender, prisoners, diplomacy, or
equipment capture yet.

# ECONOMY TUNING --- AFTER FRESH-RUN EVIDENCE

## Market

Does Market 4--5 remove meaningful Sphere decisions too early?

## Ghostbloods

Investigate rarity, acquisition, caps/requirements, and whether price is
the wrong balancing lever.

## Fabrial sinks

Measure whether Painrial/Soulcaster/Half-Shard fabrication naturally
addresses Sphere abundance.

# LATER

-   Narak/shared endgame
-   Great Fabrials
-   Fourth Bridge
-   component chains
-   bombs/explosives
-   Radiants or alternate Ancient Lore future
-   diplomacy/trade expansion
-   plateau ownership affecting Provision capacity
-   reusable Fabrial capture
-   broader equipment
-   upkeep/attrition only if deliberately chosen
-   splash/world-entry only if testing demonstrates need

# Explicitly Not Doing Right Now

-   comprehensive QA of every state
-   responsive-shell redesign
-   balancing from max accounts alone
-   preemptive Research price increases
-   upkeep through Soulcasters
-   assigning Spren IV/Religious IV merely because they're available
-   Narak because "games need an ending"
-   expanding Fabrials before V0 produces evidence
