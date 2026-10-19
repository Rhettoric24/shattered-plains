# Shattered Plains --- Current State

**Snapshot:** September 2026, during the active friend test. Features explicitly
described as Yak-only below are pre-release and are not yet on the production
friend-test deployment.

This document records what is believed to be implemented now.
Aspirations belong in `IDEA_VAULT.md` or `ROADMAP.md`.

### Parshendi Diplomacy V1 — 2026-10-18

Warcamp → Diplomacy adds shared button-driven world petitions and independent Sphere or Gemheart
donations with personal progress bars. Every accumulated 10,000 Spheres plus one
Gemheart grants a Favor, capped at five. Donations use diminishing returns based
on 24-hour totals. The rotation contains no resource payments. Favor purchases one standalone
Parshendi ally globally per kingdom inside an active PvP Conflict Board. Allies
have fixed Power, move one square per resolution, never merge, disperse after
defeat and withdraw when their conflict ends. Hostility and Deep Plains rules
remain intact. [Rules, balance, safeguards and limitations](PARSHENDI_DIPLOMACY_V1.md).

### Conflict Board mobile fit and movement indicators — 2026-10-17

The active mobile battlefield hides the resource strip/Plains subnav and fits the
unchanged six-row board using stable small-viewport height and a reserved planning
peek. Fit is cached by container width/orientation: scrolling, Safari toolbar
changes and sheet state do not rescale it. Meaningful refits wait until active
route planning ends. Incoming armies have draggable markers at their expected
entry and share the arrived-army route/confirmation flow; execution waits for arrival.
Tiny/zoomed/landscape screens retain a scrollable minimum size. Expanded More
shows one detail category at a time. Fog uses a quiet inspectable question mark.
Gold markers show conditional resolution groups: Speed specialization permits two
steps, other formations one; arrival timing offsets traveling groups. Combat,
merges, Research changes, withdrawal and settlement can interrupt those estimates.
The viewer DTO adds own-arrival stats and the server resolution interval only.
Purple corner markers reuse the Lab's retreatShade helper and stored friendly
history, excluding the current tile; extended fallback history is optional.
Preview reads, subscription refresh warnings and uncertain order submissions have
separate messages. The specific mobile recording's network failure was not
reproduced. No movement, retreat, combat, schema or settlement rules changed.

### Conflict Board UI Phase 1 — 2026-10-17

Plains uses Parshendi | PvP | Plateau Runs; legacy raids/sieges URLs remain valid.
The live battlefield prioritizes the map and inspects tiles only from the filtered
viewer projection. Formation controls use a non-modal, draggable peek/expanded
bottom sheet with Move, Orders, and More. Tap routes and the existing arrived-army
drag gesture share explicit confirmation and the same server order endpoint.
Traveling formations can queue or cancel movement through that existing endpoint;
arrival/cycle timing, defender garrison merge precedence, fog/Intel, combat and
settlement remain unchanged. Defender Reserve geometry and fallback entry remain
intact. This requires a frontend publication, with no backend/schema/flag changes.

### Conflict Board Spanreed reports — 2026-10-12

Every scheduled resolution boundary sends each participant active at its start
one paired combat notification and system Spanreed report, including quiet and
final withdrawal/deadline resolutions. Reports summarize the recipient's own
movement, battles and troop losses, retreats, raids/cargo, equipment events, and
public conquest events. Final reports include returned troops/cargo. Hidden enemy
statistics, cargo, equipment and routes are never copied from the debug journal.
Highstorm exposure separately sends the affected owner a report naming the army,
its losses by troop type, and survivors, even if that army is annihilated.
Paired delivery is atomic and uses the existing notification deduplication key;
retrying a wake cannot resend it. Reports link back to the Board through Sieges.
This does not backfill historical cycles or change combat/Highstorm rules.

### Conflict Board integration update — 2026-10-11

Authenticated backend participation/orders/viewer projection, real troop/Fabrial
commitment, 10% treasury escrow and complete withdrawal/conquest/deadline settlement
are implemented and tested. The production backend is deployed to
`groovy-buzzard-108`. The normal **Plains → Sieges** screen now has authenticated
Board discovery, real commitments/reinforcements, explicit routes, orders,
splits, equipment controls, withdrawal and return reports. The runtime flag
`CONFLICT_BOARD_V1_ENABLED` controls new commitments; see deployment instructions
to inspect or disable it. Lab play remains browser-local/zero-Convex.
See [integration evidence and exact boundaries](audits/CONFLICT_BOARD_LIVE_INTEGRATION.md).
Earlier Lab-only descriptions below refer to the public testing surface; they
do not supersede this gated backend implementation.

Cargo-bearing splits now keep cargo on the original formation and place overflow
in unclaimed only after explicit confirmation of the server-calculated loss.
The live Siege overview opens a focused battlefield with shared mouse/touch drag
movement, explicit route confirmation, and Back to Sieges. Lab controls remain intact.

## Technical Shape

-   Convex backend
-   Browser/PWA frontend
-   GitHub repository and GitHub Pages deployment
-   Responsive targets: 390px, 700px, 1440px
-   Vitest + Playwright regression harness
-   Server authority for consequential state

### Environments

**Development backend:** `clean-yak-51`

**Production/friend-test backend:** `groovy-buzzard-108`. It receives
only deliberate production deployments; experimental and pre-release
work remains on Yak.

The public PWA serves the Buzzard production/friend-test backend. Yak
remains the development and pre-release environment. See `DEPLOYMENT.md`
for the operating policy.

## Kingdom / Warcamp

Players develop a warcamp, recruit forces, build infrastructure, conduct
Research, gather Intelligence, and launch military operations.

Warcamp → Recruitment is the personnel hub for normal military units,
Scout Conclaves, Informants, Spies, and Ghostbloods. Recruitment
sections are collapsible and persistent.

Eligible available units/operatives/Conclaves can be disbanded.
Deployed/committed assets have restrictions. Shardbearers cannot be
disbanded.

## Army Stats

Core concepts:

-   Power
-   Speed
-   Plunder
-   Survive

Mission composers communicate army capability, opposition, reward, and
timing.

# Research

Top-level areas:

-   Current
-   Libraries
-   Ardents
-   `???` before Fabrial discovery / **Fabrials** afterward

Libraries:

-   Economic Studies
-   Military Studies
-   Ancient Lore

Research has one active slot. Paid progress can be parked when switching
projects.

Ancient Plateau requirements are now presented as Ancient Plateau
requirements rather than a generic spendable "AP." Spren Studies III
still supplies one research-only virtual Ancient Plateau-equivalent
without granting territory.

## Military Studies

### Bridge Engineering

Improves army Speed.

### Pack Harnesses

Improves Chull Plunder with Speed tradeoffs.

### Field Surgery

Internal ID: `painrialMedicine`.

-   I: +1 Survive per Spearman
-   II: +1 Survive per Spearman
-   III: +2 Survive per Spearman

Previous Power bonuses were removed.

### Tailored Armor

Internal ID: `soulcastArmor`.

-   I: +0.5 Power / Spearman, −0.5 Speed / Spearman
-   II: +1 Power / Spearman, −0.5 Speed / Spearman
-   III: +1 Power / Spearman, no Speed penalty

The drawback is intentionally retained for testing.

### Siege Engineering

Reduces Emergency Defense cost and eventually includes a defensive-siege
experience requirement.

## Economic Studies

### Gem Cutting

Improves Gemheart generation timing.

### Warcamp Architecture

Internal ID: `soulcasting`.

-   I: 5% building discount
-   II: 10%
-   III: 20%

### Market Economics

Improves Market income.

### Economic Doctrines

Mutually exclusive doctrines include Tax It All, Military State, and
Gemheart Baron.

## Ancient Lore

### Spren Studies

Includes strange reports, Territory information improvements, and the
Rank III research-only Ancient Plateau-equivalent.

Rank IV remains deliberately unresolved.

### Religious Studies

Develops Scout Conclave capabilities for Research and later
army-strengthening applications.

Rank IV remains deliberately unresolved.

Do not assume either Rank IV currently means Radiants, Great Fabrials,
or another specific system.

# Fabrials V0

Fabrials are server-authoritative physical inventory discovered through
hidden combinations of Research.

Only discovered Fabrials are shown. One operation/army may carry at most
**one Fabrial** in V0.

## Hidden discoveries

**Painrial:** Field Surgery II + Spren Studies II

**Soulcaster:** Warcamp Architecture II + Gem Cutting II + Spren Studies
II

**Half-Shard:** Tailored Armor II + Siege Engineering II + Spren Studies
III

Conditions are server-side. First discovery grants exactly one
idempotent prototype.

## Painrial

Fabrication: **10,000 Spheres → 3**

-   disposable
-   consumed on launch
-   prevents `floor(original casualties × 0.25)`
-   applies after normal casualty calculation
-   can protect applicable Highstorm exposure

## Half-Shard

Fabrication: **15,000 Spheres + 2 Gemhearts → 1**

-   reusable
-   committed while deployed
-   prevents `floor(original casualties × 0.50)`
-   can protect applicable Highstorm exposure
-   may be lost on poor outcomes

Current live raid/siege outcomes do not expose the originally envisioned
full four-tier outcome ladder. Existing failures currently use
deterministic seeded 50% reusable-Fabrial loss. Framework support exists
for catastrophic 100% loss if such an outcome becomes live later.

## Soulcaster

Fabrication: **15,000 Spheres + 1 Gemheart → 1**

-   reusable
-   successful Sphere-producing military missions only
-   recovers 50% of reward pool exceeding ordinary Plunder capacity
-   never exceeds underlying reward pool
-   no failed-operation bonus
-   shares reusable commitment/loss infrastructure with Half-Shards

## Supported Fabrial operations

-   ordinary Parshendi Sphere raids
-   Deep Plains raids
-   neutral siege attackers
-   PvP siege attackers

Soulcasters apply only to Sphere-producing raid types.

Intentionally unsupported where no clean loadout moment exists: Plateau
Runs, committed defenders, retaliation defenders, and similar paths.

# Highstorms V0

Server-authoritative deterministic storms.

-   one storm per Mountain date
-   arrival 9 AM--9 PM Mountain
-   exactly 2 real hours
-   DST-safe
-   browser not authoritative

Watchtower forecast: - WT0: 4-hour window - WT1: 2-hour - WT2: 1-hour -
WT3: exact

Eligible deployed armies can suffer storm casualties using the existing
casualty engine. Stable operation markers prevent duplicate exposure.

During storms: - relevant Parshendi opposition gets +40% Power -
ordinary Sphere raid rewards double - Deep Plains rewards double - human
PvP siege Power is not storm-multiplied - sieges receive exposure
instead

Espionage at storm-time resolution halves defending Counter-Intel and
gives successful/overwhelming investigations ×1.5 targeted Intel. Sphere
Heist failure casualty rates increase during storms.

The UI includes persistent forecast/active state and Storm Details.

# Sphere Heist V0

Requires Ghostblood Network I+, valid rival, available operative, and 50
Economy Intel.

-   consumes exactly 50 Economy Intel
-   1 real hour
-   no cooldown
-   Intel not refunded

Spy Power vs Counter-Intel bands: - `<75%`: catastrophic - `75–99%`:
partial failure - `100–149%`: success - `≥150%`: overwhelm

At resolution:

`available = min(currentTreasury, currentTreasury × 10%, 5,000)`

Success transfers 50%; overwhelm 100%.
Transfers retain their exact fractional value internally; player-facing Heist reports round the amount to the nearest whole Sphere.

# Rival Ledger Intel

Each viewer tracks four independent persistent 0--100 Intel pools against
each rival: `militaryAmount`, `economyAmount`, `researchAmount`, and
`territoryAmount`.

-   0--24: descriptive label
-   25--74: estimated current score
-   75--100: exact current score

Investigations take one real hour and reward only the selected category. These pools do not decay,
and Intel can no longer be spent to boost investigation Spy Power. Economy
Intel still pays for Sphere Heists; Military Intel still pays for active PvP
siege investigations.

An overwhelming investigation also creates a permanent, timestamped Bonus
Discovery in its selected category. Each viewer/rival/category pair alternates
between two facts:

-   Military: exact home-force composition / exact deployed-force compositions
-   Economy: exact Sphere treasury / exact Gemheart holdings
-   Research: current study or doctrine / completed levels by research library
-   Territory: exact plateau-type counts without names or traits / one fully
    observed Ancient or Gemheart plateau

The Ledger category detail popup shows the complete discovery history newest
first. A valid observation that no study, deployment, or valuable plateau exists
still consumes its place in the rotation.

# Ordinary Sphere Raids

`rewardBase = seeded 1,200–2,400`

`rewardPool = round(rewardBase × (1 + Hostility/100))`

`recovery = min(rewardPool, launchArmyPlunder)`

Storm modifiers layer on top.

# Deep Plains

Unlock at Hostility ≥68.

-   6--8h base duration before modifiers
-   stronger opposition
-   higher casualty pressure
-   10% Gemheart chance on success
-   +10 Hostility on success
-   larger Sphere rewards

During storms: Parshendi Power ×1.4, reward ×2, plus separate exposure.

# World Hostility / Brutality

Hostility runs 0--100 with bands Quiet, Watchful, Agitated, Hostile,
Vengeful, Relentless.

Aggression raises Hostility; peaceful time decays it. Hostility affects
neutral danger/reward, Deep Plains, retaliation, and the consequences of
repeated aggression.

Repeatedly reclaimed neutral plateaus become harder.

# Retaliations

At sufficient Hostility, Parshendi retaliation can target eligible
territory. Committed defenders matter. Highground/Emergency Defense
apply. A Parshendi victory can neutralize territory and increase future
reclamation difficulty. Highstorms can expose defenders and strengthen
Parshendi opposition. Defending against an incoming retaliation does not
raise Hostility or reset peaceful decay.

# Plateaus / Plateau Runs

Plateaus have deterministic human-readable names. Watchtower/Territory
Intelligence controls disclosure precision; owned plateaus are fully
known. Rival plateau names and owners are visible at every Territory Intel
band. At 25 Intel, type and Highground/Large traits are revealed; at 75,
exact Gemheart timing and neutral reclamation details are revealed.

Plateau Runs are Chasmfiend boss encounters. Their Power begins at
`max(600, 250 + 125 × active players)`, rises linearly to `11/3` of that
base over 42 successful Chasmfiend kills in a season, then caps. Failed or
empty hunts do not advance the scale. Each run receives seeded ±5% variance.
At four active players this is roughly 713–788 Power at zero victories and
2,613–2,888 at full strength.

Power labels: - under 900 Young - 900–1,399 Mature - 1,400–1,999 Ancient
- 2,000–2,499 Colossal - 2,500+ Legendary

The Sphere pool begins at `6,000 + 3,000 × active players`, rises linearly
to 1.5× over the same 42-victory ramp, and receives seeded ±5% variance. Four
active players therefore produce about 17,100–18,900 Spheres initially and
25,650–28,350 at full strength.

Plateau Run join-Speed bonuses: - first +10 - second +7 - third +5 -
later +0

Gemheart reward goes to highest final Speed with deterministic tie
handling. Highstorms can expose commitments.

Gemheart Plateaus on Yak grant one Gemheart after a stable, hidden random
10--12 real-hour base cycle. Gem Cutting and Gemheart Baron retain their prior
hour reductions against that randomized base. Cycles already underway keep
their previous fixed deadline; random scheduling begins after their next
payout. Ownership changes begin a fresh random cycle. Watchtower/Territory
Intel continues to control whether a rival can see the exact timer.

# PvP Sieges

PvP Siege V2 is the active flow: a one-hour Encirclement, followed by a period
where either side may deliberately begin battle, with forced resolution at the
24-hour deadline and a +10% defender Power bonus at that deadline. Ties favor
the defender.

On Yak, both sides may dispatch reinforcements as soon as the siege begins;
battle remains locked until Encirclement ends. A defender must first have an
initial commitment. Defenders can opt into future standing orders consisting
of a complete Primary army and optional complete Fallback army. At siege
creation the server commits the Primary only if every requested unit is home,
otherwise tries the Fallback, otherwise commits nothing. Standing orders never
spend Spheres, Gemhearts, or Fabrials and do not alter existing sieges.

# Spanreed Resource Gifts

On Yak, the Spanreed Hub supports immediate one-way gifts of whole Spheres and
Gemhearts to another non-admin warcamp. The server settles both economies,
validates the sender's current balance, applies both balance changes and an
audit record atomically, and creates permanent receipts for both players plus
a recipient notification. This is not a marketplace or negotiated trade.

# Intelligence

Watchtower Intel covers Parshendi and neutral-world activity. Rival Ledger
Intel covers PvP kingdoms in four categories. Territory Intel also gates
rival plateau types, traits, and exact holding details; names are always visible. Economy Intel enables
Sphere Heists, and Military Intel enables active PvP siege investigations.

# Season Ledger

North star: **reward interactive behavior rather than hoarding.**

Military favors victories/defenses/contributions rather than raw army
size. Economy should not primarily reward sitting on Spheres. Territory
rewards meaningful control/defense. Exact scoring remains testable.

# Regression Harness

-   Vitest
-   Playwright
-   390 / 700 / 1440 checks
-   visual baselines
-   console/page/network guards

At Fabrials V0 completion: - Vitest 153/153 - browser suite 41 passed +
2 intentional skips - local build passed

# Current Testing Questions

-   Does Tailored Armor's per-Spearman Speed penalty scale well?
-   Are Painrials worth consuming?
-   Is 50% Half-Shard protection appropriately dramatic?
-   Are reusable losses scary enough?
-   Is Soulcaster exciting without becoming mandatory?
-   Do players understand hidden Fabrial discovery?
-   Do Highstorms change behavior?
-   Is Market 4--5 where Sphere scarcity disappears?
-   Are Ghostbloods too common for their intended fantasy?
