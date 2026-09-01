# Shattered Plains --- Project Brain

## What This Game Is

**Shattered Plains** is an asynchronous strategy game about building and
directing a warcamp on the Shattered Plains.

The player should be able to log in, understand the current situation,
make a few consequential decisions, and leave. When they return, the
world should have moved.

The game draws its strength from interconnected systems: armies,
plateaus, research, intelligence, economy, rival kingdoms, Parshendi
hostility, Highstorms, and increasingly strange technologies. New
systems should usually deepen those relationships rather than become
isolated minigames.

## Core Player Fantasy

The player is running a kingdom/warcamp in a dangerous contested world.
Good decisions should involve competing priorities:

-   safety vs. reward
-   speed vs. strength
-   immediate gain vs. future capacity
-   information vs. action
-   economic development vs. military investment
-   aggression vs. provoking the world
-   protecting valuable assets vs. risking them for greater returns

## Design Principles

### Meaningful choices over automatic upgrades

A strong mechanic changes what the player considers.

> **What behavior does this rule make optimal?**

If one option is obviously correct in nearly every circumstance, inspect
the system.

### Connect systems instead of stacking features

Prefer mechanics that make existing systems matter in new ways.

Highstorms connect timing, Watchtowers, armies, espionage, raids,
sieges, and rewards. Fabrials connect Research, Gemhearts, Spheres,
casualties, Plunder, mission outcomes, and Highstorms.

### Specialization without hard exclusivity

Players should be able to develop recognizable strategies without being
permanently locked out of most of the game.

### Narrative first, mechanics underneath

Communicate fantasy and consequence first while allowing exact mechanics
to be inspected when useful. Do not turn every screen into a spreadsheet
merely because the simulation contains math.

### Preserve interpretation

Give players enough information to reason without routinely telling them
the correct move.

### Asynchronous by design

> Log in → assess → decide → commit → leave → return to consequences.

Avoid mechanics that require constant attendance or disproportionately
reward catching another player offline.

### Late game should create reasons to use the kingdom

Power should create new decisions, risks, and expenditures rather than
simply producing a larger hoard.

### Seasonal scoring should reward interaction

Season success should primarily reflect what players **did** with their
kingdom, not how many resources or troops they stockpiled.

## Current Experimental Thesis

The game becomes more interesting when powerful systems also expose the
player to risk.

Current examples:

-   Highstorms create danger and opportunity.
-   Deep Plains rewards scale with a more hostile world.
-   Reusable Fabrials are powerful capital assets that can be committed
    and potentially lost.
-   Soulcasters recover otherwise unreachable haul.
-   Painrials create consumable insurance decisions.
-   Half-Shards provide dramatic protection worth risking.

These effects are intentionally allowed to be dramatic during testing.
Do not automatically flatten them before observing player behavior.

## Friend-Test Goal

The first friend test is not intended to prove the game is balanced or
complete. It should answer:

-   Can a new player understand the basic loop without creator
    explanation?
-   Where do players become confused?
-   What systems naturally attract attention?
-   What choices feel meaningful?
-   When does the economy stop forcing choices?
-   Do players develop different strategies?
-   Do Highstorms change plans?
-   Are Fabrials desirable enough to manufacture and risk?
-   Does Intelligence feel useful?
-   Does hostility make aggression feel consequential?
-   What goals do players create without a formal endgame?

The first test deliberately does **not** require Narak or a complete
endgame.

## Development Philosophy

Build guardrails, then use them.

The project has automated unit/browser testing and responsive visual
coverage. Once a feature has been scoped thoughtfully, prefer focused
implementation and verification over endless audits.

> design → thin implementation → automated verification → manual
> playtest → tune

Some fallout during experimentation is acceptable. Detect it, understand
it, fix it, and continue.

## Research and Fabrial Philosophy

> **Research improves the rules. Fabrials let players bend them.**

Research represents knowledge, doctrine, engineering, and institutional
improvements.

Fabrials are physical assets. They require knowledge to discover,
resources to manufacture, and decisions about when to deploy them.

Fabrial breakthroughs should emerge from combinations of knowledge
rather than obvious storefront-style Research unlocks.

## Current Boundary

Before the first friend test, resist expanding into:

-   Narak/endgame
-   Great Fabrials
-   Fourth Bridge
-   bombs/explosives
-   Radiants
-   Fabrial component chains
-   army upkeep/attrition
-   large new diplomacy/trade systems

These are not rejected ideas. They are outside the current test
boundary.

## North Star

> **What are you willing to risk for what you want?**
