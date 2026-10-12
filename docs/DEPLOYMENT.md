# Shattered Plains --- Deployment Policy

This project has two persistent Convex environments with deliberately
different jobs.

## Development --- Yak

`clean-yak-51` is the default development and pre-release environment.

Use Yak for:

-   local development and `npx convex dev`
-   automated browser tests and test accounts
-   unfinished features, migrations, and backfill rehearsal
-   UI previews and pre-friend-test verification
-   experiments that may require resets or disposable data

Committing or pushing code does **not** authorize a production backend
deployment. Normal backend development commands must continue targeting
Yak.

## Production --- Buzzard

`groovy-buzzard-108` is the production environment and the friend-test
world.

Use Buzzard only when the user explicitly asks to deploy, publish, make a
feature live in production, or update Buzzard. Production deployment must
be a deliberate step using the production deployment command; never use
`npx convex dev` for Buzzard.

Before changing Buzzard:

1. Confirm the intended commit has passed proportionate tests on Yak.
2. Review schema and migration/backfill implications.
3. Confirm production environment variables without printing secrets.
4. Deploy the backend explicitly to production.
5. Run only known-safe, idempotent maintenance operations.
6. Verify production functions and authentication.
7. Point the frontend at Buzzard only when the user explicitly requests
   the production frontend cutover.

## Frontend configuration

The static build requires an explicit `CONVEX_URL`. GitHub Pages declares
that URL directly in its workflow. There is no conditional or silent
fallback.

-   A Yak URL publishes a development/test frontend.
-   A Buzzard URL publishes the production/friend-test frontend.

Changing the workflow's `CONVEX_URL` from Yak to Buzzard is a release
action and must be explicitly requested and reported separately from
committing, pushing, and deploying Convex functions.

## Conflict Board V1 personal online testing

User-authorized production rollout connects the normal **Plains → Sieges** screen
to the deployed Board backend. GitHub Pages remains on Buzzard; no wipe or migration
is required. The Lab remains separate at `/shattered-plains/lab/`.

Inspect the runtime flag:

```sh
npx convex env get CONFLICT_BOARD_V1_ENABLED --deployment groovy-buzzard-108
```

Activate only after deploying the backend and publishing the matching frontend:

```sh
npx convex env set CONFLICT_BOARD_V1_ENABLED true --deployment groovy-buzzard-108
```

Quick stop (no redeploy required):

```sh
npx convex env set CONFLICT_BOARD_V1_ENABLED false --deployment groovy-buzzard-108
```

False blocks new Board openings and reinforcements, while existing Boards retain
queries, orders, withdrawal, scheduled processing and asset settlement. It does
not freeze or erase ongoing conflicts. Legacy PvP launch is rejected while true;
preexisting legacy sieges and neutral expeditions keep their existing lifecycle.

The normal UI subscribes only to this player's lobby/accounting and the selected
Board while viewing Sieges. No resolver or Lab state enters the production bundle.
Full load/reload retains discovery and recovers from authoritative queries. Orders
include the current revision and an idempotency identity. Enemy contacts come only
from the filtered backend projection.

Personal test: recruit troops, open Sieges, choose **Open or join a rival conflict**,
commit to a holding belonging to your other test kingdom, and select the approaching
formation to plan its route. Switch accounts to reinforce/defend. Resolutions use
real two-hour windows; no browser needs to remain open. Withdrawal happens at the
next resolution. Check the return summary after settlement. Real backend support
currently includes Half-Shards; Painrial/Soulcaster and Conclave attachment remain
Lab-only/unavailable on live Boards. Main-game routes support tap/click and the
shared Lab mouse-drag/touch-hold gestures, always followed by Confirm. Enter a
conflict from the overview to open its focused battlefield. Its `focus` URL parameter
supports direct loading and browser history within the existing Pages application.

Checks: `npm test`, `npm run build`, `npm run build:lab`,
`npm run test:board:browser`, `npm run test:lab:browser`, `npm run test:lab:static`.

## Future staging

A third persistent staging deployment can be added later if the friend
test demonstrates a need for a long-lived environment between Yak and
Buzzard. Until then, Yak serves pre-release work and Buzzard serves the
invited production world.
