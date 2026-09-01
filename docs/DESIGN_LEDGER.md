# Shattered Plains --- Design Ledger

Statuses:

-   **DECIDED** --- current design unless deliberately reopened.
-   **TESTING** --- current direction, but evidence may change it.
-   **OPEN** --- unresolved.
-   **DEFERRED** --- interesting, intentionally outside current scope.

# Core

### DECIDED --- Asynchronous planning is the primary rhythm

Assess → decide → commit → leave → return. Avoid systems requiring
constant attendance.

### DECIDED --- Connect systems instead of stacking features

Prefer mechanics that make existing choices matter in new ways.

### DECIDED --- Preserve interpretation

Give players information to reason without routinely identifying the
optimal action.

### DECIDED --- Seasonal scoring rewards interaction, not hoarding

Raw Sphere balance/army size should not dominate.

### DECIDED --- Late-game power needs reasons to be spent and risked

Late game should not become a museum of accumulated resources.

# Research

### DECIDED --- Research improves rules; Fabrials bend them

Research is knowledge/institutional capability. Fabrials are physical
assets.

### DECIDED --- Painrials Research became Field Surgery

Internal ID remains `painrialMedicine`. Power bonuses removed. Survive
remains +1/+1/+2 per Spearman.

**Why:** separates battlefield medicine from the physical Painrial.

### DECIDED --- Soulcast Armor became Tailored Armor

Internal ID remains `soulcastArmor`. Existing Power/Speed tradeoffs
retained.

### TESTING --- Tailored Armor keeps its drawback

Ranks I--II trade Speed for Power; Rank III removes the Speed penalty.

**Question:** does per-Spearman Speed loss become excessive in large
armies?

### DECIDED --- Soulcasting became Warcamp Architecture

Internal ID remains `soulcasting`. Existing 5/10/20% building discounts
retained.

### DECIDED --- "AP" is not a player-facing currency

Show Ancient Plateau requirements directly. Spren III's virtual
research-only requirement bonus remains without implying territory
ownership.

### OPEN --- Spren Studies IV future purpose

Do not assign permanently to Radiants, Great Fabrials, or another system
yet.

### OPEN --- Religious Studies IV future purpose

Same rule.

# Fabrials

### DECIDED --- Fabrials are physical inventory

They can be discovered, owned, fabricated, committed/consumed, and
potentially lost.

### DECIDED --- One Fabrial per operation in V0

Creates mutually exclusive choices and avoids premature equipment-slot
complexity.

### DECIDED --- Discoveries use hidden Research combinations

Desired reaction: "Of course those fields produced this," not arbitrary
guessing.

### DECIDED --- Painrial discovery

Field Surgery II + Spren Studies II. First discovery grants one
prototype.

### DECIDED --- Soulcaster discovery

Warcamp Architecture II + Gem Cutting II + Spren Studies II. First
discovery grants one prototype.

### DECIDED --- Half-Shard discovery

Tailored Armor II + Siege Engineering II + Spren Studies III. First
discovery grants one prototype.

### DECIDED --- Religious Studies is not a V0 Fabrial prerequisite

Mystery should remain thematically satisfying.

### DECIDED --- Painrial is disposable insurance

10,000 Spheres → 3. Prevents floor(25% of calculated casualties).
Consumed on launch even if unnecessary.

### TESTING --- Painrial protection is 25%

Observe before tuning.

### DECIDED --- Half-Shard is reusable capital at risk

15,000 Spheres + 2 Gemhearts. Prevents floor(50% casualties), committed
while deployed, potentially lost.

### TESTING --- Half-Shard protection is 50%

Intentionally dramatic. Balance also comes from cost, commitment,
one-Fabrial limit, and loss risk.

### TESTING --- Current reusable failure loss is seeded 50%

Original design envisioned clean success 0%, normal success 0%, lower
failure 50%, catastrophic 100%. Current live outcomes do not expose the
full ladder.

### DECIDED --- Lost reusable Fabrials disappear in V0

No transfer to victorious human player yet.

### DECIDED --- Soulcaster affects Plunder recovery, not Provisions

15,000 Spheres + 1 Gemheart. Successful Sphere mission recovers 50% of
reward exceeding ordinary Plunder, never beyond reward pool.

### DECIDED --- Soulcaster does not introduce upkeep/attrition

No Provision-cap, upkeep, Market-income, reward-generation, or
failed-mission changes.

### TESTING --- Soulcaster recovers 50% of excess reward

Test whether it competes with protection without becoming mandatory.

# Highstorms

### DECIDED --- Highstorms are infrastructure, not decoration

They connect timing, armies, Watchtowers, espionage, raids, sieges,
rewards.

### DECIDED --- Server controls storm schedule

One deterministic storm per Mountain date, 9 AM--9 PM arrival, exactly 2
hours.

### DECIDED --- Watchtower improves forecasting

WT0 4h, WT1 2h, WT2 1h, WT3 exact.

### DECIDED --- Storms offer opportunity and danger

Relevant Parshendi +40% Power while ordinary/Deep Plains Sphere rewards
can double.

### TESTING --- Storm casualty pressure

Observe whether it changes plans rather than merely annoys.

### DECIDED --- Human PvP siege Power is not storm-multiplied

Human siege armies face exposure instead.

# Hostility

### DECIDED --- Repeated aggression changes the world

Neutral combat is not consequence-free farming.

### DECIDED --- Peace can decay Hostility

Players can de-escalate.

### DECIDED --- Reclaimed neutral plateaus become harder

Repeated reclamation increases resistance.

### DECIDED --- Deep Plains unlock through high Hostility

Aggression creates a dangerous/high-reward option.

### TESTING --- Brutality tuning

Fresh progression should test whether escalation creates tension without
punishment spirals.

# Economy

### TESTING --- Market 4--5 may make Spheres too comfortable

Key question: **When do I stop having to choose?**

### OPEN --- Market tuning

Fabrials add new sinks. Gather fresh-run evidence before rebalance.

### OPEN --- Ghostblood rarity

Desired fantasy: exceptionally rare, perhaps comparable to or rarer than
Shardbearers. Do not solve only with absurd pricing.

# Intelligence

### DECIDED --- Economy Intel is authoritative/spendable

0--100 `economyAmount`; Sphere Heist consumes 50.

### DECIDED --- Economy Intel disclosure does not freshness-decay

Ledger amount controls disclosure.

### TESTING --- Intel terminology needs clarity

Rival Intel, Economy Intel, Ledger quality, and other categories may
blur together.

# Sieges

### OPEN --- PvP Siege V2

Desired direction: asynchronous escalating confrontation with
attacker/defender reinforcement and deliberate assault timing.

### DECIDED --- Unlimited siege stalling is undesirable

Future design needs deadline/pressure so "wait until opponent is
offline" is not optimal.

# Future

### DECIDED --- Plateau Runs are escalating Chasmfiend bosses

Plateau Runs should begin as difficult shared encounters and become much
harder as a season progresses. For the friend-test tuning pass, four active
players produce about 750 base Power at season start and about 2,750 before
variance at full strength after 14 real days. Maturity labels communicate
the escalation without adding persistence or specialty reward rules yet.
The ordinary Sphere pool starts at 3,000 plus 1,000 per active player and
ramps to 1.5× over the season-strength window, with ±5% variance.

### DEFERRED --- Narak

Not required for first friend test.

### DEFERRED --- Fourth Bridge

Potential Great Fabrial that may break Highstorm-exposure rules. Test
normal Fabrials first.

### DEFERRED --- Great Fabrials / component chains

Potential knowledge → components → Great Fabrial progression. Avoid
accidental factory-game sprawl.

### DEFERRED --- Bombs/explosives

Fabrials provide a plausible route. Not now.

### OPEN --- Radiants

Earlier Rank-IV connection is no longer assumed.

### DEFERRED --- Upkeep / attrition

Only as an intentional economy redesign, not a casual resource sink.

# Development / Release

### DECIDED --- Keep development and production separate

Experimental, local, automated-test, and pre-release work uses
`clean-yak-51`. The friend-test world uses `groovy-buzzard-108`, which is
updated only after an explicit request to deploy or publish to production.
See `DEPLOYMENT.md` for the release procedure.

### DECIDED --- Commit, push, backend deploy, frontend deploy are separate

Always report them separately.

### DECIDED --- Use regression guardrails instead of endless audits

Audit when architecture is genuinely uncertain, not ritualistically.
