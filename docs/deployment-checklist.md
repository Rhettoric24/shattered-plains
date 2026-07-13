# Deployment Checklist

This project now has two deployable pieces:

- Convex backend: database, auth, game functions, scheduled raid/Plateau Run logic.
- Static frontend: browser files built into `dist/`.

## Local Preview

Build and preview the deployable frontend:

```powershell
npm run preview
```

Then open:

```text
http://127.0.0.1:4180/
```

## Build Static Files

```powershell
npm run build
```

This creates:

```text
dist/index.html
dist/convex-client.js
dist/shattered-plains-styles.css
```

The build reads `CONVEX_URL` from `.env.local` unless you provide a different one in the terminal.

## First Online Test

For the first friend test, it is acceptable to point the static site at the current Convex dev deployment.

The flow is:

1. Keep `npx convex dev` running while testing the current dev backend.
2. Run `npm run build`.
3. Upload or publish the contents of `dist/` to a static host.
4. Open the hosted URL and create a normal player account.
5. Confirm the admin account still sees Testing and the normal account does not.

## GitHub Pages Path

This repo includes a GitHub Pages workflow:

```text
.github/workflows/deploy-static-site.yml
```

The workflow builds `dist/` and publishes it to GitHub Pages whenever `main` is pushed.

In GitHub:

1. Open the repo Settings.
2. Go to Pages.
3. Set Source to `GitHub Actions`.
4. Optional but recommended: go to Settings -> Secrets and variables -> Actions -> Variables.
5. Add a repository variable named `CONVEX_URL`.
6. Set it to the Convex deployment URL the site should use.

If `CONVEX_URL` is not set, the workflow currently falls back to the dev deployment:

```text
https://clean-yak-51.convex.cloud
```

That is fine for a first test, but production should use the production Convex deployment URL.

## Production Later

When ready for a more official test:

```powershell
npx convex deploy
```

Then build the static site with the production Convex URL:

```powershell
$env:CONVEX_URL="https://your-production-deployment.convex.cloud"
npm run build
```

The hosted frontend can be GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any other static file host.
