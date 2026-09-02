# Shattered Plains --- Current State

**Snapshot:** August 2026, after Highstorms V0 and Fabrials V0 became
live on the current test environment.

This document records what is believed to be implemented now.
Aspirations belong in `IDEA_VAULT.md` or `ROADMAP.md`.

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

The public PWA currently serves the Yak test build until an explicit
production frontend cutover. See `DEPLOYMENT.md` for the operating policy.

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
-   2 real hours
-   no cooldown
-   Intel not refunded

Spy Power vs Counter-Intel bands: - `<75%`: catastrophic - `75–99%`:
partial failure - `100–149%`: success - `≥150%`: overwhelm

At resolution:

`available = min(currentTreasury, clamp(currentTreasury × 5%, 1,000, 10,000))`

Success transfers 50%; overwhelm 100%.

# Economy Intel

Authoritative `economyAmount` from 0--100.

-   0--24: qualitative
-   25--74: estimate
-   75--100: exact snapshot

Economy Intel disclosure does not use freshness decay.

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
Parshendi opposition.

# Plateaus / Plateau Runs

Plateaus have deterministic human-readable names. Watchtower/Territory
Intelligence controls disclosure precision; owned plateaus are fully
known.

Plateau Runs are Chasmfiend boss encounters. Their Power begins at
`max(600, 250 + 125 × active players)`, rises linearly to `11/3` of that
base over the first 14 real days of a season, then caps. Each run receives
seeded ±5% variance. At four active players this is roughly 713–788 Power
at season start and 2,613–2,888 at full strength.

Power labels: - under 900 Young - 900–1,399 Mature - 1,400–1,999 Ancient
- 2,000–2,499 Colossal - 2,500+ Legendary

The Sphere pool begins at `6,000 + 3,000 × active players`, rises linearly
to 1.5× over the same 14-day ramp, and receives seeded ±5% variance. Four
active players therefore produce about 17,100–18,900 Spheres initially and
25,650–28,350 at full strength.

Plateau Run join-Speed bonuses: - first +10 - second +7 - third +5 -
later +0

Gemheart reward goes to highest final Speed with deterministic tie
handling. Highstorms can expose commitments.

# Intelligence

Watchtower and Territory Intelligence answer different questions. Rival
Intel supports espionage/rival understanding. Economy Intel enables
Sphere Heists and treasury disclosure.

Terminology remains a friend-test polish target.

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
