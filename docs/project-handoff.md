# Project Handoff

Use this file first when returning to the Shattered Plains project or starting a fresh Codex chat.

## Current Status

The project is live as a browser-playable Convex multiplayer prototype.

- Live site: `https://rhettoric24.github.io/shattered-plains/`
- GitHub repo: `https://github.com/Rhettoric24/shattered-plains`
- Backend: Convex dev deployment, currently `https://clean-yak-51.convex.cloud`
- Frontend host: GitHub Pages
- Current development folder: `C:\Users\rhett\Documents\Codex\2026-07-01\i-a`

The old local JSON server prototype has been removed from the active project. The current architecture is Convex plus a static browser frontend.

## Mental Model

There are two live halves:

- Convex is the game world: accounts, player records, server-side game actions, plateaus, sieges, raids, Plateau Runs, scheduled jobs, messages, admin checks, and database state.
- GitHub Pages is the browser shell: HTML, CSS, and JavaScript that players open. The browser calls Convex directly.

The normal update flow is:

```text
Backend change -> npx convex dev -> Convex updates
Frontend/code change -> git commit -> git push -> GitHub Actions -> GitHub Pages updates
```

If a change touches both `convex/` and `outputs/`, do both halves.

## Important Files

- `convex/rules.ts`: main balance knobs for economy, combat, buildings, units, Plateau Runs, and timing.
- `convex/schema.ts`: Convex database tables and indexes.
- `convex/players.ts`: account-owned player creation and dashboard data.
- `convex/army.ts`: unit training.
- `convex/buildings.ts`: building upgrades.
- `convex/raids.ts`: Parshendi sphere raid launch and legacy raid resolution.
- `convex/plateaus.ts`: plateau listing, neutral expeditions, PvP sieges, fortification, retreat, and plateau backfill.
- `convex/plateauRuns.ts`: Plateau Run creation, joining, rewards, and resolution.
- `convex/crons.ts`: recurring scheduled jobs, including twice-daily Plateau Run checks.
- `convex/messages.ts`: inbox and player/system messages.
- `convex/admin.ts`: single-admin email gate.
- `outputs/convex-client.html`: browser app structure.
- `outputs/convex-client.js`: browser app behavior and Convex calls.
- `outputs/shattered-plains-styles.css`: browser app styling.
- `scripts/build-site.mjs`: bundles the static site into `dist/`.
- `.github/workflows/deploy-static-site.yml`: GitHub Pages deployment workflow.

## Current Gameplay Scope

Players can:

- Create an account and warcamp.
- Generate spheres through Sphere Plateaus and markets.
- Train units.
- Upgrade buildings.
- Claim neutral plateaus and siege player-owned plateaus.
- Raid neutral Parshendi sphere stores.
- Raid other players.
- Join Plateau Runs.
- Receive system and player messages.
- See World Alerts for major current events.

Current unit types:

- Bridgeman
- Spearman
- Scout
- Heavy Infantry
- Shardbearer

Current buildings:

- Gemheart Market
- Watchtower
- Barracks

## Time And Scheduling

- One real hour equals one game day for the game clock and raid travel baseline.
- Economy uses lazy settlement. It does not constantly tick every player in the background.
- Raids schedule their own future resolver when launched.
- Plateau Runs are checked every five minutes by Convex cron.
- Scheduled Plateau Runs open during the noon and 8 PM Mountain time windows.
- Each Plateau Run has a 15 minute real-time join window.

## Auth And Admin

Convex Auth owns login. Player-owned actions should derive the current player from the signed-in account, not from a browser-supplied player id.

Admin access is controlled by the Convex environment variable `ADMIN_EMAILS`.

```powershell
npx convex env set ADMIN_EMAILS "admin@example.com"
```

The frontend hides Testing from normal players, but the backend also protects admin-only helpers. Do not rely on frontend hiding for security.

## Deployment Notes

Local preview:

```powershell
npm start
```

Static deploy build:

```powershell
npm run build
```

Push frontend changes:

```powershell
git add .
git commit -m "Describe the patch"
git push
```

Push backend changes:

```powershell
npx convex dev
```

For now, the GitHub Pages workflow points at the current Convex URL unless the repo variable `CONVEX_URL` is changed.

## Next Patch Direction

Immediate next work is Patch 1: live testing, balance changes, and bug fixes.

Do not rush major new systems until the live loop has been tested:

- Economy pacing.
- Raid pacing and losses.
- Plateau Run difficulty and rewards.
- Shardbearer impact.
- Watchtower usefulness.
- Message/report clarity.
- World Alert usefulness.

See `docs/patch-roadmap.md` for the planned patch sequence.

## Fresh Chat Prompt

If starting a new chat, paste this:

```text
This is the Shattered Plains Convex browser game in C:\Users\rhett\Documents\Codex\2026-07-01\i-a.
Read AGENTS.md, README.md, docs/project-handoff.md, docs/patch-roadmap.md, and docs/convex-migration-plan.md first.
The app is live at https://rhettoric24.github.io/shattered-plains/ and uses Convex for the backend.
We are working on [describe patch or bug].
```
