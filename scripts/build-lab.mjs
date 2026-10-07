import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("dist/lab/", root);
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: [fileURLToPath(new URL("lab/main.ts", root))],
  tsconfigRaw: { compilerOptions: { target: "ES2022" } },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  metafile: true,
});

// Only these pure shared rules modules may enter from the backend directory.
// Fail publication if a later Lab import introduces a client or server module.
for (const input of Object.keys(result.metafile.inputs)) {
  const normalized = input.replaceAll("\\", "/");
  if (
    !normalized.startsWith("lab/") &&
    !normalized.startsWith("conflict-board/") &&
    normalized !== "convex/highstormRules.ts" && normalized !== "convex/rules.ts" && normalized !== "convex/intelligenceRules.ts" && normalized !== "convex/fabrialRules.ts" && normalized !== "convex/worldPressureRules.ts"
  ) {
    throw new Error(`Unexpected dependency in static Lab: ${input}`);
  }
}

await mkdir(output, { recursive: true });
await writeFile(
  new URL("index.html", output),
  await readFile(new URL("lab/index.html", root)),
);
await writeFile(
  new URL("lab.css", output),
  await readFile(new URL("lab/style.css", root)),
);
await writeFile(new URL("lab.js", output), result.outputFiles[0].contents);
console.log(
  "Built isolated static Lab at dist/lab/ (no Convex configuration or client).",
);
