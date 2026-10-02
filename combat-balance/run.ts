import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { catalog } from "./catalog";
import { models } from "./models";
import { aggregate, type Row } from "./aggregate";
import { csv, markdown } from "./report";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "npm run balance:combat -- [--replications 1000] [--shard-replications 5000] [--seed-start 0] [--scenario substring] [--models current,floor1,floor0,weighted,normalized,normalized-weighted] [--floor 0.01] [--density-scale 100] [--weight-strength 0.6931471805599453] [--survive-cap 100] [--out directory]",
  );
  process.exit(0);
}
const allowed = new Set([
  "replications",
  "shard-replications",
  "seed-start",
  "scenario",
  "models",
  "floor",
  "density-scale",
  "weight-strength",
  "survive-cap",
  "out",
]);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, "");
  if (
    !args[i].startsWith("--") ||
    !allowed.has(key) ||
    args[i + 1] === undefined
  )
    throw Error(`Invalid option ${args[i]}; use --help.`);
  options[key] = args[i + 1];
}
const reps = Number(options.replications ?? 1000),
  shardReps = Number(
    options["shard-replications"] ?? (options.replications ? reps : 5000),
  ),
  start = Number(options["seed-start"] ?? 0);
const scenarios = catalog().filter(
  (s) => !options.scenario || s.id.includes(options.scenario),
);
const selectedNames = (
  options.models ?? models.map((m) => m.id).join(",")
).split(",");
if (selectedNames.some((id) => !models.some((m) => m.id === id)))
  throw Error("Unknown model; use --help.");
const variants = models
  .filter((m) => selectedNames.includes(m.id))
  .map((m) => {
    const v = { ...m, family: m.id };
    if (m.id === "current") return v;
    for (const [flag, key] of [
      ["floor", "floor"],
      ["density-scale", "densityScale"],
      ["weight-strength", "weightStrength"],
      ["survive-cap", "surviveCap"],
    ] as const)
      if (options[flag] !== undefined) {
        v[key] = Number(options[flag]);
        v.id += `-${flag}-${options[flag]}`;
      }
    return v;
  });
if (!scenarios.length) throw Error("No matching scenarios.");
const rows: Row[] = [];
for (const s of scenarios) {
  const count = s.category === "shardbearer" ? shardReps : reps;
  for (const model of variants) rows.push(...aggregate(s, model, count, start));
  console.log(`${s.id}: ${count} paired seeds × ${variants.length} models`);
}
const sources = [
  "convex/rules.ts",
  "conflict-board/resolver.ts",
  "lab/scenarios.ts",
  "combat-balance/models.ts",
  "combat-balance/catalog.ts",
  "combat-balance/aggregate.ts",
  "combat-balance/report.ts",
  "combat-balance/run.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sources.map(async (p) => [
      p,
      createHash("sha256")
        .update(await readFile(p))
        .digest("hex"),
    ]),
  ),
);
const manifest = {
  formatVersion: 1,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceHashes,
  seedSchedule:
    "SHA256(combat-balance/v1|scenario|replication|side), same across variants",
  replications: reps,
  shardReplications: shardReps,
  seedStart: start,
  scenarios: scenarios.length,
  models: variants,
  battleReplications: scenarios.reduce(
    (n, s) =>
      n + (s.category === "shardbearer" ? shardReps : reps) * variants.length,
    0,
  ),
  armyEvaluations: rows.reduce((n, r) => n + r.replications, 0),
  aggregateRows: rows.length,
};
const out = path.resolve(options.out ?? "analysis/combat-balance");
const reportPath = options.out
  ? path.join(out, "report.md")
  : path.resolve("docs/audits/COMBAT_BALANCE_BASELINE.md");
await mkdir(out, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(path.join(out, "results.csv"), csv(rows));
await writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  reportPath,
  markdown(
    rows,
    manifest,
    path
      .relative(path.dirname(reportPath), path.join(out, "results.csv"))
      .replaceAll("\\", "/"),
  ),
);
console.log(
  JSON.stringify({
    battleReplications: manifest.battleReplications,
    armyEvaluations: manifest.armyEvaluations,
    report: reportPath,
    data: out,
  }),
);
