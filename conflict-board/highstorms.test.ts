import { expect, test } from "vitest";
import { scenario, defaults } from "../lab/scenarios";
import { emptyUnits, totalUnits } from "../convex/rules";
import { applyHighstormExposureLosses } from "../convex/highstormRules";
import { setHighstorm, stormSettings, DEFAULT_STORM } from "./highstorms";
import { projectConflict, disclosureLevel } from "./disclosure";
import { splitFormation } from "./planning";
import { resolveCycle } from "./resolver";
import { finishRaids } from "./raids";

const config={...defaults,highstorm:{...DEFAULT_STORM}};
test("immediate exposure matches live weather helper, preserves cycle/orders and is repeatable",()=>{
 const s=scenario(),before=structuredClone(s);
 const r=setHighstorm(s,config,"storm1",true);
 expect(s).toEqual(before);expect(r.state.cycle).toBe(s.cycle);
 for(const f of s.formations){const raw=applyHighstormExposureLosses(f.units,`${s.id}:storm1:${f.id}:exposure`,s.kingdoms.find(k=>k.id===f.kingdom)!.research);expect(r.state.formations.find(g=>g.id===f.id)?.units).toEqual(raw.survivors);}
 expect(setHighstorm(s,config,"storm1",true)).toEqual(r);
 expect(setHighstorm(r.state,config,"storm1",true).events).toEqual([]);
 expect(setHighstorm(r.state,config,"storm1",false).state.formations).toEqual(r.state.formations);
 expect(setHighstorm(r.state,config,"storm2",true).events.some(e=>e.type==="highstorm")).toBe(true);
});
test("splits and merges do not repeat exposure; fresh traveling forces do get hit",()=>{
 let s=setHighstorm(scenario(),config,"storm",true).state;
 const f=s.formations.find(f=>f.kingdom==="blue")!;f.units={...emptyUnits(),spearman:100};f.order={kind:"hold",route:[],onDefeat:"pause"};
 s=splitFormation(s,f.id,{...emptyUnits(),spearman:20},"child");
 const arrived={...structuredClone(f),id:"fresh",lastHighstormExposureId:undefined};s.arrivals.push({id:"arrival",cycle:s.cycle+1,formation:arrived});
 const r=resolveCycle({state:s,config,cycle:s.cycle+1,seed:"x"});
 expect(r.events.filter(e=>e.type==="highstorm").map(e=>e.formation)).toEqual(["fresh"]);
 expect(setHighstorm(r.state,config,"storm",true).events.filter(e=>e.type==="highstorm")).toEqual([]);
});
test("storm fog uses occupied-only vision and two disclosure bands, without spending Intel",()=>{
 const s=scenario();s.highstorm={id:"x",active:true};
 const intel={red:74};const view=projectConflict(s,"blue",intel,true,config);
 expect(view.visiblePositions).toEqual([...new Set(s.formations.filter(f=>f.kingdom==="blue").map(f=>f.position))].sort());
 expect([0,24,25,74,75,100].map(n=>disclosureLevel(n,true,2))).toEqual([-1,-1,-1,-1,0,0]);
 expect(disclosureLevel(100,false,2)).toBe(3);expect(intel.red).toBe(74);
 expect(projectConflict(s,"blue",{red:100},false,config).contacts.every(c=>c.level===3)).toBe(true);
});
test("raid multiplier increases extraction, constrained by capacity and treasury; no instant raid",()=>{
 const s=scenario();const f=s.formations.find(f=>f.kingdom==="blue")!;s.formations=[f];f.position="A1";f.units={...emptyUnits(),chull:20};f.order={kind:"raid",route:[],onDefeat:"pause"};
 s.highstorm={id:"storm",active:true};s.raidFootholds={A1:{kingdom:f.kingdom,establishedCycle:0,occupants:[f.id]}};s.treasury=250;
 finishRaids(s,config,1,[]);expect(f.cargo).toBe(200);expect(s.treasury).toBe(50);
 finishRaids(s,config,2,[]);expect(f.cargo).toBe(250);expect(s.treasury).toBe(0);
 f.cargo=590;s.treasury=500;finishRaids(s,config,3,[]);expect(f.cargo).toBe(600);
 f.cargo=0;s.raidFootholds.A1.establishedCycle=4;finishRaids(s,config,4,[]);expect(f.cargo).toBe(0);
});
test("active Half-Shard protects, pending does not; storm is not a defeat equipment roll",()=>{
 const s=scenario(),f=s.formations[0];f.equipment={items:[{id:"half",owner:f.kingdom,kind:"halfShard"}],active:"half"};
 const protectedResult=setHighstorm(s,config,"storm",true);
 delete f.equipment.active;f.equipment.pending={id:"half",afterCycle:1};
 const pending=setHighstorm(s,config,"storm",true);
 expect(totalUnits(protectedResult.state.formations[0].units)).toBeGreaterThan(totalUnits(pending.state.formations[0].units));
 expect(pending.events.some(e=>e.type==="fabrial"&&e.lossChance!==undefined)).toBe(false);
 expect(pending.state.formations[0].equipment?.pending).toEqual(f.equipment.pending);
});
test("invalid storm knobs fail without mutating state",()=>{
 expect(()=>stormSettings({...config,highstorm:{...DEFAULT_STORM,baseRate:NaN}})).toThrow();
 expect(()=>stormSettings({...config,highstorm:{...DEFAULT_STORM,fogPenalty:4}})).toThrow();
});
test("storm order is independent of array ordering and Research is retained",()=>{
 const s=scenario();s.kingdoms.forEach(k=>k.research={painrialMedicine:3});
 const reversed=structuredClone(s);reversed.formations.reverse();reversed.kingdoms.reverse();
 const a=setHighstorm(s,config,"storm",true),b=setHighstorm(reversed,config,"storm",true);
 expect(a.events).toEqual(b.events);
 expect(a.state.formations.slice().sort((x,y)=>x.id.localeCompare(y.id))).toEqual(b.state.formations.slice().sort((x,y)=>x.id.localeCompare(y.id)));
});
test("annihilation removes foothold/hold and equipment; capacity overflow is unclaimed",()=>{
 const s=scenario(),f=s.formations.find(f=>f.kingdom==="blue")!;
 s.formations=[f];f.position=s.board.objective;f.units={...emptyUnits(),bridgeman:1};f.cargo=100;
 f.equipment={items:[{id:"soul",owner:f.kingdom,kind:"soulcaster"}],active:"soul"};
 s.objective={controller:f.kingdom,hold:{kingdom:f.kingdom,beganCycle:0}};
 s.raidFootholds={[f.position]:{kingdom:f.kingdom,establishedCycle:0,occupants:[f.id]}};
 const severe={...config,highstorm:{...DEFAULT_STORM,baseRate:1}};
 const r=Array.from({length:20},(_,i)=>setHighstorm(s,severe,`storm${i}`,true)).find(r=>!r.state.formations.length)!;
 expect(r).toBeDefined();expect(r.state.objective.controller).toBeNull();expect(r.state.objective.hold).toBeUndefined();
 expect(r.state.raidFootholds).toEqual({});expect(r.state.cargoLost).toBe(100);
 expect(r.state.equipmentRecords?.[0].status).toBe("lost");
});
test("nonlethal exposure preserves raid readiness and does not advance conquest",()=>{
 const s=scenario(),f=s.formations.find(f=>f.kingdom==="blue")!;f.position="A1";
 s.raidFootholds={A1:{kingdom:"blue",establishedCycle:0,occupants:[f.id]}};
 const r=setHighstorm(s,config,"storm",true);
 expect(r.state.raidFootholds).toEqual(s.raidFootholds);expect(r.state.objective).toEqual(s.objective);
 expect(r.events.some(e=>e.type==="raid"||e.type==="conquest")).toBe(false);
});
