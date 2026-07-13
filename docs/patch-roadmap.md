# Patch Roadmap

This is the near-term roadmap for the live Shattered Plains prototype.

For architecture and deployment context, read `docs/project-handoff.md` first.

## Current Live Goal

Keep the game small enough to understand while testing the core multiplayer loop:

- Account creation and login.
- Economy growth.
- Training units.
- Raiding open acres, Parshendi spheres, and other players.
- Plateau Runs.
- Inbox and World Alerts.
- Admin-only testing tools.

## Patch 1: Live Balance And Bug Pass

Use the live GitHub Pages version for a day or two and collect rough notes.

Things to watch:

- Do players get enough spheres to do something interesting quickly?
- Do raids feel too slow, too fast, too punishing, or too generous?
- Do Plateau Runs feel possible with the current active player count?
- Are Shardbearers too easy, too hard, or too swingy?
- Are Watchtowers meaningful without making player raids pointless?
- Do World Alerts make important events visible enough?
- Do messages and battle reports tell players what happened clearly?

Likely files for balance changes:

- `convex/rules.ts`

Likely balance categories:

- Starting acres, spheres, and gemhearts.
- Acre income and market income.
- Unit cost, power, speed, and unlock levels.
- Watchtower defense bonus.
- Raid travel timing and speed impact.
- Open-acre and Parshendi sphere raid difficulty/rewards.
- Plateau Run difficulty, reward pools, losses, and join bonuses.

## Patch 2: Reports And Alerts

Make the game easier to read after actions resolve.

Possible improvements:

- Better battle reports for raids.
- Better Plateau Run result breakdowns.
- Alerts for recently resolved raids.
- Clearer explanation of casualties, rewards, and power comparisons.
- Chronicle filters for raids, economy, Plateau Runs, and system events.

## Patch 3: Spy Networks

Add information warfare without overloading combat yet.

Possible systems:

- Spy Network building or upgrade.
- Spy missions against player warcamps.
- Scout enemy acres, units, buildings, or incoming/outgoing raids.
- Counter-spy defense from Watchtowers or a future building.
- Reports delivered through inbox.

## Patch 4: Research And Fabrials

Add longer-term progression.

Possible systems:

- Research projects with sphere costs and timers.
- Fabrial upgrades that improve economy, defense, speed, or raid rewards.
- Research unlocks for advanced buildings or units.
- A clear research tab in the sidebar.

## Patch 5: Highstorms

Add world rhythm and shared pressure.

Possible systems:

- Scheduled or semi-random highstorm events.
- Warnings before impact.
- Effects on raids, exposed armies, economy, or buildings.
- Stormlight/sphere-related bonuses after storms.
- World Alerts and inbox reports for storm activity.

## Patch 6: Radiants

Save this for later, when the core world is stable.

Possible systems:

- Rare Radiant emergence events.
- Orders or power paths.
- Progression through ideals.
- Major combat, diplomacy, or event effects.
- Strong narrative weight instead of treating Radiants as a normal unit type.

## Guiding Principle

Ship in small patches. Each patch should make the game more readable, more testable, or more strategically interesting without hiding the core loop.
