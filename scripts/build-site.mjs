import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const dist = path.join(root, "dist");

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }
  return values;
}

async function readLocalEnv() {
  try {
    return parseEnvFile(await fs.readFile(path.join(root, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

const localEnv = await readLocalEnv();
function resolveBuildIdentifier() {
  const candidate = process.env.GITHUB_SHA || (() => {
    try {
      return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "dev";
    }
  })();
  const sanitized = candidate.trim().toLowerCase().match(/^[0-9a-f]{7,40}$/)?.[0];
  return sanitized ? sanitized.slice(0, 7) : "dev";
}

const convexUrl =
  process.env.CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  localEnv.CONVEX_URL;

if (!convexUrl) {
  throw new Error("Set CONVEX_URL before building the static site.");
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const clientSource = await fs.readFile(
  path.join(root, "outputs", "convex-client.js"),
  "utf8",
);

await esbuild.build({
  absWorkingDir: root,
  plugins: [
    {
      name: "local-convex-browser",
      setup(build) {
        build.onResolve({ filter: /^convex\/browser$/ }, () => ({
          path: path.join(root, "node_modules", "convex", "dist", "esm", "browser", "index.js"),
        }));
        build.onResolve({ filter: /^\.\/espionage-ui-state\.js$/ }, () => ({
          path: path.join(root, "outputs", "espionage-ui-state.js"),
        }));
        build.onResolve({ filter: /^\.\/ui-overhaul-state\.js$/ }, () => ({
          path: path.join(root, "outputs", "ui-overhaul-state.js"),
        }));
        build.onResolve({ filter: /^\.\/data-loading-state\.js$/ }, () => ({
          path: path.join(root, "outputs", "data-loading-state.js"),
        }));
        build.onResolve({ filter: /^\.\.?\// }, (args) => {
          const importer = args.importer.replace(/\\/g, "/");
          if (!importer.includes("node_modules/convex/")) {
            return null;
          }
          return {
            path: path.resolve(path.dirname(args.importer), args.path),
          };
        });
      },
    },
  ],
  stdin: {
    contents: clientSource,
    sourcefile: "outputs/convex-client.js",
    resolveDir: root,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  outfile: path.join(dist, "convex-client.js"),
  sourcemap: true,
});

for (const stylesheet of [
  "shattered-plains-styles.css",
  "clarity-components.css",
  "clarity-responsive.css",
]) {
  await fs.copyFile(path.join(root, "outputs", stylesheet), path.join(dist, stylesheet));
}

for (const asset of [
  "manifest.webmanifest",
  "service-worker.js",
  "app-icon.svg",
  "app-icon-180.png",
  "app-icon-192.png",
  "app-icon-512.png",
]) {
  await fs.copyFile(path.join(root, "outputs", asset), path.join(dist, asset));
}

const sourceHtml = await fs.readFile(
  path.join(root, "outputs", "convex-client.html"),
  "utf8",
);
const buildIdentifier = resolveBuildIdentifier();
const configScript = `<script>window.SHATTERED_PLAINS_CONFIG = ${JSON.stringify({ convexUrl, buildIdentifier })};</script>`;
const cacheKey = Date.now().toString(36);
const html = sourceHtml.replace(
  /href="([^"]+\.css)"/g,
  `href="$1?v=${cacheKey}"`,
).replace(
  '<script type="module" src="convex-client.js"></script>',
  `${configScript}\n    <script type="module" src="convex-client.js?v=${cacheKey}"></script>`,
);

await fs.writeFile(path.join(dist, "index.html"), html);

console.log(`Built dist/ for ${convexUrl} (build ${buildIdentifier})`);
