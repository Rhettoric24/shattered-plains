import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import fixtures from "./survival-harness-fixtures.json";
import currentFixtures from "./current-lab-fixtures.json";
import { experimentalSurvivalLosses } from "./experimental-survival";
import { applySurvivalLosses, baseCasualtyRate, emptyUnits } from "../convex/rules";
import { resolveCycle } from "./resolver";
import { defaults, scenario } from "../lab/scenarios";
import { holdOrder } from "./planning";

it("matches 162 seeded normalized + weighted results from harness commit 45733e7 exactly",()=>{
  for(const f of fixtures) {
    const original=structuredClone(f.army);
    expect(experimentalSurvivalLosses(f.army.units,f.base,f.seed,f.army.research)).toEqual(f.result);
    expect(f.army).toEqual(original);
  }
});
it("Current and legacy unset model reproduce original main Lab cycles exactly, apart from model labels",()=>{
  for(const explicit of [false,true]) {
    const states=new Map();
    for(const f of currentFixtures) {
      const key=f.name+f.seed, state=states.get(key)??scenario(f.name);
      const config=structuredClone(defaults); if(!explicit)delete config.combatModel;
      const result=resolveCycle({state,config,cycle:f.cycle,seed:f.seed});
      states.set(key,result.state);
      for(const event of result.events)if(event.type==="battle") {expect(event.combatModel).toBe("current");delete event.combatModel;}
      expect(createHash("sha256").update(JSON.stringify(result)).digest("hex")).toBe(f.hash);
    }
  }
});
it("resolver uses the selected model with fixed experimental parameters and deterministic order-independent results",()=>{
  for(const combatModel of ["current","experimental-survival"] as const) {
    const state=scenario();
    state.formations=state.kingdoms.slice(0,2).map((k,i)=>({id:`army-${i}`,name:k.name,kingdom:k.id,position:"B2",history:["B2"],order:holdOrder(),units:{...emptyUnits(),bridgeman:50,spearman:50,shardbearer:i}}));
    const config={...structuredClone(defaults),combatModel};
    if(combatModel==="experimental-survival")config.casualties={factor:0,minimum:0,maximum:0,surviveCap:0};
    const input={state,config,cycle:1,seed:"integration"};
    const result=resolveCycle(input);
    expect(resolveCycle(input)).toEqual(result);
    expect(resolveCycle({...input,state:{...state,formations:[...state.formations].reverse()}})).toEqual(result);
    const battle=result.events.find(e=>e.type==="battle")!;
    expect(battle.combatModel).toBe(combatModel);
    for(const force of battle.forces) {
      const a=state.formations.find(f=>f.kingdom===force.kingdom)!;
      const research=state.kingdoms.find(k=>k.id===force.kingdom)!.research;
      const seed=JSON.stringify([state.id,1,"integration",1,"B2",force.kingdom]);
      const base=baseCasualtyRate(force.power,force.hostilePower);
      const expected=combatModel==="current"?applySurvivalLosses(a.units,base,seed,research,false):experimentalSurvivalLosses(a.units,base,seed,research);
      expect(force.casualties).toEqual(expected.casualties);expect(force.survivors).toEqual(expected.survivors);expect(force.finalRate).toBe(expected.finalCasualtyRate);
    }
  }
});
