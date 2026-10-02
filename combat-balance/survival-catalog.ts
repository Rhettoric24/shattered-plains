import { effectivePower } from "../convex/rules";
import { army } from "./catalog";
import { models, type Army, type Scenario } from "./models";

export const survivalModels = ["current", "normalized", "weighted", "normalized-weighted"].map(id => models.find(m => m.id === id)!);
export function controlled(id: string, category: string, force: Army, ratio = 1, fixedPower?: number): Scenario {
  return { id, category, armies: [force], hostilePowers: [fixedPower ?? effectivePower(force.units, force.research) * ratio],
    note: fixedPower === undefined ? `Exact hostile/own Power = ${ratio}; scalar opposition, not a simulated opponent.` : `Fixed hostile Power ${fixedPower}; ratio is undefined when own Power is zero.` };
}
export function survivalCatalog(): Scenario[] {
  const out: Scenario[] = [];
  const infantry = (bm: number, sp: number, research = {}) => army(`${bm} BM / ${sp} SP`, { bridgeman: bm, spearman: sp }, research);
  for (const bm of [100, 75, 50, 25, 0]) for (const ratio of [.25, .5, 1, 1.5, 2])
    out.push(controlled(`gradient-${bm}-${ratio}`, "gradient", infantry(bm, 100-bm), ratio));
  for (const n of [10, 100, 1000]) for (const share of [1, .5, 0])
    out.push(controlled(`size-${n}-${share}`, "size", infantry(n*share, n*(1-share))));
  for (const [bm, sp] of [[100,0],[50,50],[0,100]]) for (const ratio of [.5,2])
    out.push(controlled(`shard-${bm}-${ratio}`, "shard", army(`${bm} BM / ${sp} SP / 1 Shard`, { bridgeman: bm, spearman: sp, shardbearer: 1 }), ratio));
  for (const chulls of [0,1,5,20,100])
    out.push(controlled(`chull-${chulls}`, "chull", army(`50 BM / 50 SP / ${chulls} Chulls`, { bridgeman: 50, spearman: 50, chull: chulls })));
  for (const n of [1,10,100]) out.push(controlled(`chull-zero-power-${n}`, "chull-zero-power", army(`${n} Chulls`, { chull:n }), 1, 10));
  // 25/75 cannot be represented at ten troops. Use twenty for that exact composition, never silently round.
  for (const share of [0,.5,.25]) for (const n of (share === .25 ? [20,100,1000] : [10,100,1000])) for (let rank=0;rank<=3;rank++)
    out.push(controlled(`surgery-${share}-${n}-${rank}`, "surgery", infantry(n*share,n*(1-share),{ painrialMedicine:rank })));
  for (const [id,bm,sp,chull,shardbearer] of [
    ["sp",0,100,0,0],["sp-plus-bm",1,100,0,0],["bm",100,0,0,0],["bm-plus-sp",100,1,0,0],
    ["mixed",50,50,0,0],["mixed-plus-bm",51,50,0,0],["mixed-plus-sp",50,51,0,0],
    ["mixed-plus-chull",50,50,1,0],["mixed-plus-shard",50,50,0,1],
  ] as const) {
    const a = army(id,{bridgeman:bm,spearman:sp,chull,shardbearer});
    out.push(controlled(`marginal-${id}`, "marginal", a));
    out.push(controlled(`fixed-${id}`, "marginal-fixed", a,1,id.startsWith("sp")?100:id.startsWith("bm")?50:75));
  }
  return out;
}
