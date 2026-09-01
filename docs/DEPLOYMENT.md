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

## Future staging

A third persistent staging deployment can be added later if the friend
test demonstrates a need for a long-lived environment between Yak and
Buzzard. Until then, Yak serves pre-release work and Buzzard serves the
invited production world.
