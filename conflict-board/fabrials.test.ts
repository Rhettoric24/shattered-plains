import {describe,it,expect} from "vitest";
import {scenario,defaults} from "../lab/scenarios";
import {emptyUnits,totalUnits} from "../convex/rules";
import {applyFabrialCasualtyProtection} from "../convex/fabrialRules";
import {mergeEquipment,requestFabrialSwitch,validateEquipment,protectWithEquipment} from "./fabrials";
import {splitFormation,holdOrder} from "./planning";
import {resolveCycle} from "./resolver";
import {labEquipmentCommand} from "../lab/equipment";
import {projectConflict} from "./disclosure";
import type {ConflictState,Formation,Event} from "./types";
const item=(id:string,kind:"halfShard"|"soulcaster"|"painrial",owner="blue")=>({id,kind,owner});
function equipped() {
 const s=scenario(),f=s.formations.find(f=>f.kingdom==="blue")!;
 f.equipment={items:[item("half","halfShard"),item("soul","soulcaster"),item("pain1","painrial"),item("pain2","painrial")],active:"half"};return s;
}
const blue=(s:ConflictState)=>s.formations.find(f=>f.kingdom==="blue")!;
const cycle=(state:ConflictState)=>resolveCycle({state,config:defaults,cycle:state.cycle+1,seed:"equipment"});
const ids=(s:ConflictState)=>[...s.formations.flatMap(f=>f.equipment?.items??[]),...s.arrivals.flatMap(a=>a.formation.equipment?.items??[]),...(s.equipmentRecords??[]).map(r=>r.item)].map(i=>i.id).sort();
describe("physical formation Fabrials",()=>{
 it("carries multiple types but rejects duplicated IDs and consumables in persistent slots",()=>{
  const s=equipped();expect(()=>validateEquipment(s)).not.toThrow();
  blue(s).equipment!.active="pain1";expect(()=>validateEquipment(s)).toThrow();
  blue(s).equipment!.active="half";blue(s).equipment!.items.push(item("half","halfShard"));expect(()=>validateEquipment(s)).toThrow();
 });
 it("switch waits until end of next resolution without interrupting movement or mutating input",()=>{
  const s=equipped(),next=requestFabrialSwitch(s,"blue",blue(s).id,"soul");
  expect(blue(next).equipment).toMatchObject({active:"half",pending:{id:"soul",afterCycle:1}});
  expect(blue(s).equipment!.pending).toBeUndefined();
  const r=cycle(next);expect(blue(r.state).position).toBe("B3");expect(blue(r.state).equipment!.active).toBe("soul");
  expect(blue(r.state).equipment!.pending).toBeUndefined();expect(ids(r.state)).toEqual(ids(s));
  expect(()=>requestFabrialSwitch(s,"red",blue(s).id,"soul")).toThrow();
 });
 it("splits assign exact instances, pending follows item, merging conserves all identities",()=>{
  let s=equipped();s=requestFabrialSwitch(s,"blue",blue(s).id,"soul");
  s=splitFormation(s,blue(s).id,{...emptyUnits(),bridgeman:10},"child",["soul","pain1"]);
  const parent=blue(s),child=s.formations.find(f=>f.id==="child")!;
  expect(parent.equipment!.active).toBe("half");expect(parent.equipment!.pending).toBeUndefined();
  expect(child.equipment!.pending?.id).toBe("soul");expect(child.equipment!.active).toBeUndefined();
  s.formations.forEach(f=>f.order=holdOrder());const before=ids(s),r=cycle(s);
  expect(ids(r.state)).toEqual(before);expect(blue(r.state).equipment!.active).toBe("soul");
 });
 it("one active survives merge; largest troop count wins multiple actives; ID resolves equal sizes",()=>{
  const s=equipped(),a=blue(s),b:Formation={...structuredClone(a),id:"A-small",units:{...emptyUnits(),shardbearer:1},equipment:{items:[item("other","soulcaster")],active:"other"}};
  expect(mergeEquipment([b,a])!.active).toBe("half");
  const eq=mergeEquipment([a,b])!;expect(eq.items).toHaveLength(5);expect(eq.active).toBe("half");
  b.units={...a.units};expect(mergeEquipment([b,a])!.active).toBe("other");
  expect(mergeEquipment([a,b])).toEqual(mergeEquipment([b,a]));
  delete a.equipment!.active;expect(mergeEquipment([a,b])!.active).toBe("other");
 });
 it("separate formations retain separate active devices until merging",()=>{
  const s=equipped(),a=blue(s);a.order=holdOrder();
  const b={...structuredClone(a),id:"separate",position:"A3",history:["A3"],equipment:{items:[item("other","soulcaster")],active:"other"}};
  s.formations.push(b);const r=cycle(s);expect(r.state.formations.filter(f=>f.kingdom==="blue").map(f=>f.equipment?.active).sort()).toEqual(["half","other"]);
 });
 it("defender arrivals choose largest incoming force once, independent of arrival order",()=>{
  const s=scenario();s.formations.forEach(f=>f.order=holdOrder());const g=s.formations[0];
  g.equipment={items:[item("g-half","halfShard","red")],active:"g-half"};
  const arrivals=[{id:"a",cycle:1,formation:{id:"a",name:"big",kingdom:"red",units:{...emptyUnits(),bridgeman:150},order:holdOrder(),equipment:{items:[item("a-soul","soulcaster","red")],active:"a-soul"}}},{id:"b",cycle:1,formation:{id:"b",name:"small",kingdom:"red",units:{...emptyUnits(),bridgeman:140},order:holdOrder(),equipment:{items:[item("b-half","halfShard","red")],active:"b-half"}}}];
  s.arrivals=arrivals;const r=cycle(s);expect(r.state.formations.find(f=>f.kingdom==="red")!.equipment!.active).toBe("a-soul");
  s.arrivals.reverse();expect(cycle(s)).toEqual(r);expect(ids(r.state)).toEqual(ids(s));
 });
 it("Painrial use is immediate under explicit engagement policy, consumes exactly one and does not stack",()=>{
  const s=equipped(),f=blue(s);delete f.equipment!.active;
  const raw={survivors:{...emptyUnits(),bridgeman:70},casualties:{...emptyUnits(),bridgeman:30}},events:Event[]=[];
  expect(protectWithEquipment(s,[f],raw,1,events,false)).toEqual(raw);
  const r=protectWithEquipment(s,[f],raw,1,events,true);expect(r).toEqual(applyFabrialCasualtyProtection("painrial",raw));
  expect(f.equipment!.items.filter(i=>i.kind==="painrial")).toHaveLength(1);
  f.equipment!.active="half";protectWithEquipment(s,[f],raw,1,events,true);
  expect(f.equipment!.items.filter(i=>i.kind==="painrial")).toHaveLength(1);expect(s.equipmentRecords).toHaveLength(1);
 });
 it("old persistent protects current combat, pending activates only afterward",()=>{
  let s=equipped();const f=blue(s);f.position="B2";f.history=["B2"];f.order=holdOrder();
  const red=s.formations[0];red.position="B2";red.history=["B2"];red.units={...emptyUnits(),spearman:100};red.order=holdOrder();
  s=requestFabrialSwitch(s,"blue",f.id,"soul");const r=cycle(s);
  expect(r.events.some(e=>e.type==="fabrial"&&e.item==="half"&&e.action==="protected")).toBe(true);
  expect(blue(r.state).equipment!.active).toBe("soul");
 });
 it("destroyed carriers retain explicit unsettled ownership records, not silent deletion",()=>{
  const s=equipped();blue(s).units=emptyUnits();const r=cycle(s);
  expect(r.state.equipmentRecords).toHaveLength(4);expect(r.state.equipmentRecords!.every(r=>r.status==="unsettled"&&r.item.owner==="blue")).toBe(true);
  expect(ids(r.state)).toEqual(ids(s));expect(()=>validateEquipment(r.state)).not.toThrow();
 });
 it("Lab acquisition creates unique instances on reinforcements; disclosure excludes rival equipment",()=>{
  let s=equipped();const f=blue(s);const {position,history,...army}=structuredClone(f);delete army.equipment;army.id="arrival";
  s.arrivals.push({id:"arrival",cycle:1,formation:army});s=labEquipmentCommand(s,"blue","arrival",{kind:"give",fabrial:"halfShard",active:true},()=>"new-half");
  expect(s.arrivals[0].formation.equipment!.active).toBe("new-half");
  expect(JSON.stringify(projectConflict(s,"red",{blue:100},false))).not.toContain("new-half");
  expect(()=>validateEquipment(cycle(s).state)).not.toThrow();
 });
 it("simultaneous pending switches are deterministic and canceled pending devices remain carried",()=>{
  const s=equipped(),a=blue(s);a.equipment!.pending={id:"soul",afterCycle:1};
  const b={...structuredClone(a),id:"other",units:{...emptyUnits(),bridgeman:10},equipment:{items:[item("other-half","halfShard"),item("other-soul","soulcaster")],active:"other-half",pending:{id:"other-soul",afterCycle:1}}};
  const merged=mergeEquipment([b,a])!;
  expect(merged.active).toBe("half");expect(merged.pending?.id).toBe("soul");expect(merged.items.map(i=>i.id)).toContain("other-soul");
  expect(mergeEquipment([a,b])).toEqual(merged);
 });
 it("empty first slot still requires forethought and repeated/canceled requests are safe",()=>{
  let s=equipped();delete blue(s).equipment!.active;
  s=requestFabrialSwitch(s,"blue",blue(s).id,"half");expect(blue(s).equipment!.active).toBeUndefined();
  const same=requestFabrialSwitch(s,"blue",blue(s).id,"half");expect(same).toEqual(s);
  s=requestFabrialSwitch(s,"blue",blue(s).id,null);expect(blue(s).equipment!.pending).toBeUndefined();
 });
 it("real combat defeat preserves every physical item across resolution",()=>{
  const s=equipped();const f=blue(s);f.position="B2";f.history=["B2"];f.units={...emptyUnits(),bridgeman:1};delete f.equipment!.active;f.order=holdOrder();
  const red=s.formations[0];red.position="B2";red.history=["B2"];red.units={...emptyUnits(),spearman:1000};
  for(let seed=0;seed<12;seed++) {
    const r=resolveCycle({state:s,config:defaults,cycle:1,seed:String(seed)});expect(ids(r.state)).toEqual(ids(s));
    expect(()=>validateEquipment(r.state)).not.toThrow();
  }
 });
});
