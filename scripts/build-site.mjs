import esbuild from "esbuild";
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

await fs.copyFile(
  path.join(root, "outputs", "shattered-plains-styles.css"),
  path.join(dist, "shattered-plains-styles.css"),
);

const sourceHtml = await fs.readFile(
  path.join(root, "outputs", "convex-client.html"),
  "utf8",
);
const configScript = `<script>window.SHATTERED_PLAINS_CONFIG = ${JSON.stringify({ convexUrl })};</script>`;
const html = sourceHtml.replace(
  '<script type="module" src="convex-client.js"></script>',
  `${configScript}\n    <script type="module" src="convex-client.js"></script>`,
);

await fs.writeFile(path.join(dist, "index.html"), html);

console.log(`Built dist/ for ${convexUrl}`);
