import { describe, it, expect } from "vitest";
import { applySurvivalLosses, baseCasualtyRate, totalUnits } from "../convex/rules";
import { aggregate, seedFor } from "./aggregate";
import { armyMetrics, simulateArmy } from "./models";
import { survivalCatalog, survivalModels } from "./survival-catalog";
describe("focused Survival experiment",()=>{
  const scenarios=survivalCatalog();
  it("holds all parameters and four model identities fixed",()=>{
    expect(survivalModels.map(m=>m.id)).toEqual(["current","normalized","weighted","normalized-weighted"]);
    for(const m of survivalModels) {expect(m.floor).toBe(.03);expect(m.densityScale).toBe(100);expect(m.weightStrength).toBe(Math.log(2));expect(m.surviveCap).toBeUndefined();}
    expect(new Set(scenarios.map(s=>s.id)).size).toBe(scenarios.length);
    expect(scenarios.filter(s=>s.category==="gradient")).toHaveLength(25);
  });
  it("uses exact gradient pressures and does not infer a winner",()=>{
    for(const s of scenarios.filter(s=>s.category==="gradient")) {
      const r=aggregate(s,survivalModels[0],2)[0];
      expect([.25,.5,1,1.5,2]).toContain(r.hostilePower/r.power);
      expect(r.nominalWinnerSide).toBeNull();expect(r.nominalWinner).toBe(false);
      expect(r.troops).toBe(100);
    }
  });
  it("rejects invalid controlled opposition",()=>{
    for(const hostilePowers of [[],[-1],[NaN],[Infinity],[1,2]]) expect(()=>aggregate({...scenarios[0],hostilePowers},survivalModels[0],1)).toThrow();
  });
  it("controlled CURRENT exactly matches production, including research and zero own Power",()=>{
    for(const s of scenarios) {
      const a=s.armies[0],hostile=s.hostilePowers![0],m=armyMetrics(a,hostile,survivalModels[0]);
      const seed=seedFor(s.id,7,0);
      expect(simulateArmy(a,hostile,survivalModels[0],seed)).toEqual(applySurvivalLosses(a.units,baseCasualtyRate(m.power,hostile),seed,a.research,false));
    }
  });
  it("normalization is identical at 100 and invariant across proportional sizes",()=>{
    for(const s of scenarios.filter(s=>s.category==="gradient")) expect(armyMetrics(s.armies[0],s.hostilePowers![0],survivalModels[0]).final).toBe(armyMetrics(s.armies[0],s.hostilePowers![0],survivalModels[1]).final);
    for(const share of [0,.5,1]) {
      const rates=[10,100,1000].map(n=>{const s=scenarios.find(s=>s.id===`size-${n}-${share}`)!;return armyMetrics(s.armies[0],s.hostilePowers![0],survivalModels[1]).final;});
      expect(new Set(rates).size).toBe(1);
    }
  });
  it("weighted pairs preserve counts and aggregate runs reproduce",()=>{
    const s=scenarios.find(s=>s.id==="shard-50-2")!;
    for(const [equal,weighted] of [[0,2],[1,3]]) {
      const a=aggregate(s,survivalModels[equal],100)[0],b=aggregate(s,survivalModels[weighted],100)[0];
      expect(a.averageCasualties).toBe(b.averageCasualties);
      expect(aggregate(s,survivalModels[weighted],100)[0]).toEqual(b);
      const before=structuredClone(s);
      const result=simulateArmy(s.armies[0],s.hostilePowers![0],survivalModels[weighted],"conservation");
      expect(totalUnits(result.survivors)+totalUnits(result.casualties)).toBe(totalUnits(s.armies[0].units));expect(s).toEqual(before);
    }
  });
});
