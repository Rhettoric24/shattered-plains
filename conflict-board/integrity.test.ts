import { expect, test } from "vitest";
import { defaults, presetNames, scenario } from "../lab/scenarios";
import { emptyUnits, totalUnits, unitKeys } from "../convex/rules";
import { resolveCycle } from "./resolver";
import { splitFormation } from "./planning";
import { setHighstorm } from "./highstorms";
import { requestFabrialSwitch, validateEquipment } from "./fabrials";
import { cargoAmount, DEFAULT_TREASURY, battleCargo, settleCargo, settleUnclaimed } from "./cargo";
import { projectConflict } from "./disclosure";
import type { ConflictState, Formation, Event } from "./types";

const quiet={...defaults,casualties:{factor:0,minimum:0,maximum:0,surviveCap:null}};
const troops=(s:ConflictState)=>[...s.formations,...s.arrivals.map(a=>a.formation)].reduce((u,f)=>{for(const k of unitKeys())u[k]+=f.units[k];return u},emptyUnits());
const money=(s:ConflictState)=>(s.treasury??DEFAULT_TREASURY)+[...s.formations,...s.arrivals.map(a=>a.formation)].reduce((n,f)=>n+cargoAmount(f),0)+Object.values(s.raidValues??{}).reduce((n,v)=>n+v,0)+(s.cargoLost??0)+(s.cargoDestroyed??0);
const devices=(s:ConflictState)=>[...s.formations,...s.arrivals.map(a=>a.formation)].flatMap(f=>f.equipment?.items.map(i=>i.id)??[]).concat((s.equipmentRecords??[]).map(r=>r.item.id)).sort();
const run=(s:ConflictState,c=defaults,seed="integrity")=>resolveCycle({state:s,config:c,seed,cycle:s.cycle+1});
function force(id:string,kingdom:string,position:string,spearman=100):Formation{return {id,name:id,kingdom,position,history:[position],units:{...emptyUnits(),spearman},order:{kind:"hold",route:[],onDefeat:"pause"}};}

test("bounded preset stories conserve units, Spheres and equipment and ignore array order",()=>{
 for(const name of presetNames)for(let seed=0;seed<8;seed++) {
  let s=scenario(name);s.treasury=1000;
  s.formations.forEach((f,i)=>f.equipment={items:[{id:`item-${i}`,kind:"soulcaster",owner:f.kingdom}]});
  for(let turn=0;turn<5&&!s.objective.conqueredBy;turn++) {
   const before=structuredClone(s),ids=devices(s),counts=troops(s),cash=money(s);
   const r=run(s,defaults,String(seed)),rev=structuredClone(s);
   rev.formations.reverse();rev.arrivals.reverse();rev.kingdoms.reverse();rev.board.positions.reverse();rev.board.connections.reverse();
   expect(run(rev,defaults,String(seed))).toEqual(r);expect(s).toEqual(before);
   const lost=emptyUnits();for(const e of r.events){if(e.type==="battle")for(const f of e.forces)for(const k of unitKeys())lost[k]+=f.casualties[k];if(e.type==="highstorm")for(const k of unitKeys())lost[k]+=e.casualties[k];}
   for(const k of unitKeys())expect(troops(r.state)[k]+lost[k]).toBe(counts[k]);
   expect(money(r.state)).toBeCloseTo(cash,8);expect(devices(r.state)).toEqual(ids);validateEquipment(r.state);
   expect(()=>resolveCycle({state:r.state,cycle:r.state.cycle,config:defaults,seed:String(seed)})).toThrow();
   s=r.state;
  }
 }
});

test("conquest retains all assets for the future return adapter and settles debris only once",()=>{
 const s=scenario();s.formations=[force("invader","blue","B1",1000),force("guard","red","post",1),force("third","green","C3")];
 s.formations[0].order={kind:"move",route:["post"],onDefeat:"continue"};s.formations[0].cargo=20;s.cargoLost=13;
 s.arrivals=[{id:"later",cycle:99,formation:force("late","green","approach")}];
 const initial=troops(s),cash=money(s);const first=run(s,quiet),last=run(first.state,quiet);
 expect(last.state.objective.conqueredBy).toBe("blue");expect(troops(last.state)).toEqual(initial);expect(money(last.state)).toBe(cash);
 expect(last.state.arrivals).toHaveLength(1);expect(last.state.cargoDestroyed).toBe(13);
 const snapshot=structuredClone(last.state);settleUnclaimed(last.state,[]);expect(last.state).toEqual(snapshot);
 expect(()=>run(last.state)).toThrow(/completed conquest/);
});

test("non-conquest endings are not implemented: empty and abandoned boards remain open",()=>{
 const s=scenario();s.formations=[];s.arrivals=[];
 const r=run(s);expect(r.state.objective.conqueredBy).toBeUndefined();expect(r.state.cycle).toBe(1);
 // This is an integration blocker, not permission to invent a timeout/winner.
 expect(r.state.originalOwner).toBe(s.originalOwner);
});

test("repeated split, reinforcement, merge and pending equipment preserve physical assets",()=>{
 let s=scenario();const f=force("parent","blue","B2",100);f.equipment={items:[{id:"a",kind:"halfShard",owner:"blue"},{id:"b",kind:"soulcaster",owner:"blue"}],active:"a",pending:{id:"b",afterCycle:1}};s.formations=[f];
 s=splitFormation(s,"parent",{...emptyUnits(),spearman:20},"child",["b"]);
 s=splitFormation(s,"parent",{...emptyUnits(),spearman:10},"child2");
 s.arrivals=[{id:"reinforce",cycle:1,formation:force("reinforce","blue","approach",50)}];
 const r=run(s,quiet);expect(troops(r.state).spearman).toBe(150);expect(devices(r.state)).toEqual(["a","b"]);
 expect(r.state.formations.find(f=>f.position==="B2")?.equipment?.active).toBe("b");
 validateEquipment(r.state);
});

test("cargo changes hands repeatedly with capacity limits, recapture and banking conserving money",()=>{
 for(const winnerCount of [0,20,2000])for(const ratio of [1.1,1.5,2,3]) {
  const s=scenario();s.formations=[force("carrier","blue","B2",1000),force("interceptor","green","B2",winnerCount),force("owner","red","B2",2000)];s.formations[0].cargo=400;
  const cash=money(s),events:Event[]=[];
  battleCargo(s,s.formations.slice(0,2),"green",events,new Map([["blue",100],["green",100*ratio]]));expect(money(s)).toBeCloseTo(cash);
  battleCargo(s,s.formations.slice(1),"red",events,new Map([["green",100],["red",300]]));expect(money(s)).toBeCloseTo(cash);
  s.formations[2].position="post";settleCargo(s,s.formations,events);expect(money(s)).toBeCloseTo(cash);
  settleUnclaimed(s,events);expect(money(s)).toBeCloseTo(cash);
 }
});

test("storm exposure never discards cargo on traveling reinforcements",()=>{
 const s=scenario();s.formations=[];s.arrivals=[{id:"arrival",cycle:9,formation:{...force("cargo-transit","blue","approach",100),cargo:1000}}];
 // Arrival wire shape has no board position.
 delete (s.arrivals[0].formation as Partial<Formation>).position;delete (s.arrivals[0].formation as Partial<Formation>).history;
 const r=setHighstorm(s,defaults,"storm",true);expect(money(r.state)).toBeCloseTo(money(s));
 expect(cargoAmount(r.state.arrivals[0].formation)).toBeLessThanOrEqual(r.state.arrivals[0].formation.units.spearman*.5);
});

test("annihilated transit cargo is explicitly unclaimed, including on retry",()=>{
 const s=scenario();s.formations=[];const f=force("transit","blue","approach",0);f.units.bridgeman=1;f.cargo=5;
 delete (f as Partial<Formation>).position;delete (f as Partial<Formation>).history;
 s.arrivals=[{id:"transit",cycle:9,formation:f}];
 const c={...defaults,highstorm:{baseRate:1,surviveCap:300,visionRadius:0,fogPenalty:2,raidMultiplier:2}};
 const r=Array.from({length:20},(_,i)=>setHighstorm(s,c,`storm-${i}`,true)).find(r=>!r.state.arrivals.length)!;
 expect(r).toBeDefined();expect(r.state.cargoLost).toBe(5);expect(money(r.state)).toBe(money(s));
 expect(setHighstorm(r.state,c,r.state.highstorm!.id,true).state).toEqual(r.state);
});

test("delayed storm start cannot reactivate an ended or superseded storm",()=>{
 let s=setHighstorm(scenario(),defaults,"first",true).state;
 s=setHighstorm(s,defaults,"first",false).state;
 expect(setHighstorm(s,defaults,"first",true).state).toEqual(s);
 s=setHighstorm(s,defaults,"second",true).state;
 expect(setHighstorm(s,defaults,"first",true).state).toEqual(s);
 expect(setHighstorm(s,defaults,"first",false).state).toEqual(s);
});

test("completed conflicts cannot take weather casualties or accept physical planning commands",()=>{
 const s=scenario();s.objective.conqueredBy="blue";const f=s.formations[1];
 expect(setHighstorm(s,defaults,"late-storm",true).state).toEqual(s);
 expect(()=>splitFormation(s,f.id,{...emptyUnits(),bridgeman:1},"after-end")).toThrow(/completed/);
 expect(()=>requestFabrialSwitch(s,f.kingdom,f.id,null)).toThrow(/completed/);
});

test("paused routes do not move and cannot perform a paused raid",()=>{
 const s=scenario();s.formations=[force("paused","blue","A1")];s.formations[0].order={kind:"move",route:["B1"],onDefeat:"pause",paused:true};
 expect(run(s,quiet).state.formations[0].position).toBe("A1");
 s.formations[0].order={kind:"raid",route:[],onDefeat:"pause",paused:true};s.raidFootholds={A1:{kingdom:"blue",establishedCycle:0,occupants:["paused"]}};
 expect(run(s,quiet).state.formations[0].cargo??0).toBe(0);
});

test("malformed objective and duplicate arrival identities fail closed",()=>{
 const s=scenario();s.objective.controller="missing-kingdom";expect(()=>run(s)).toThrow(/objective/i);
 s.objective.controller="red";s.arrivals=[{id:"same",cycle:1,formation:force("a","blue","approach")},{id:"same",cycle:1,formation:force("b","green","approach")}];
 expect(()=>run(s)).toThrow(/identit/i);
});

test("viewer projection never includes rival secrets across movement, splits, storms or JSON refresh",()=>{
 let s=scenario();s.formations=[force("own","blue","B2"),force("SECRET_RED","red","B1"),force("SECRET_GREEN","green","A1")];
 for(const f of s.formations.slice(1)){f.cargo=123;f.equipment={items:[{id:`SECRET_DEVICE_${f.id}`,kind:"soulcaster",owner:f.kingdom}]};}
 for(let i=0;i<3;i++) {
  const v=projectConflict(JSON.parse(JSON.stringify(s)),"blue",{red:25,green:0},true,defaults),json=JSON.stringify(v);
  expect(json).not.toContain("SECRET_");expect(v.contacts.every(c=>Object.keys(c).sort().join(',')==="kingdom,level,physicallyVisible,position,power")).toBe(true);
  expect(v.contacts.every(c=>c.power?.mode!=="exact")).toBe(true);
  s.formations.find(f=>f.id==="SECRET_RED")!.cargo=0;
  s=splitFormation(s,"SECRET_RED",{...emptyUnits(),spearman:1},`SECRET_CHILD_${i}`);
  s.formations.find(f=>f.id==="own")!.position="C3";s.formations.find(f=>f.id==="own")!.history=["C3"];
  if(i===1)s=setHighstorm(s,defaults,"storm",true).state;
 }
});
