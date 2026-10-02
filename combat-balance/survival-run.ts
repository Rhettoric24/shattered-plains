import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { aggregate } from "./aggregate";
import { survivalCatalog, survivalModels } from "./survival-catalog";
import { survivalReport } from "./survival-report";
import { csv } from "./report";
import { unitKeys } from "../convex/rules";
let reps=1000, rare=10000;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2) {
  const n=Number(args[i+1]);
  if(!["--reps","--rare-reps"].includes(args[i]) || !Number.isSafeInteger(n) || n<1) throw Error("Use --reps N and/or --rare-reps N, positive integers.");
  if(args[i]==="--reps") reps=n; else rare=n;
}
const scenarios=survivalCatalog();
const rows=scenarios.flatMap(s=>survivalModels.flatMap(m=>aggregate(s,m,s.armies[0].units.shardbearer?rare:reps))).map(r=>({...r,
  powerRatio:r.power?r.hostilePower/r.power:null,
  ...Object.fromEntries(unitKeys().map(k=>[`${k}_casualtyShare`,r.averageCasualties?Number(r[`${k}_averageCasualties`])/r.averageCasualties:null])),
}));
const sources=["convex/rules.ts","conflict-board/resolver.ts","combat-balance/models.ts","combat-balance/aggregate.ts","combat-balance/catalog.ts","combat-balance/report.ts","combat-balance/survival-catalog.ts","combat-balance/survival-report.ts","combat-balance/survival-run.ts","scripts/combat-balance.mjs"];
const manifest={sourceRevision:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sourceHashes:Object.fromEntries(sources.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")])),replications:reps,rareReplications:rare,seedStart:0,models:survivalModels,scenarios:scenarios.length,rows:rows.length,evaluations:rows.reduce((n,r)=>n+r.replications,0),opposition:"Explicit scalar hostile Power; no opponent or winner inferred."};
mkdirSync("analysis/survivability-model",{recursive:true});
writeFileSync("analysis/survivability-model/results.csv",csv(rows));
writeFileSync("analysis/survivability-model/manifest.json",JSON.stringify(manifest,null,2)+"\n");
writeFileSync("docs/audits/SURVIVABILITY_MODEL_EXPERIMENT.md",survivalReport(rows));
console.log(JSON.stringify({scenarios:manifest.scenarios,rows:manifest.rows,evaluations:manifest.evaluations}));
