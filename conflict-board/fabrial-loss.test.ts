import {it,expect} from "vitest";
import {scenario,defaults} from "../lab/scenarios";
import {emptyUnits} from "../convex/rules";
import {fabrialLossChance,resolveFabrialLosses,validateEquipment} from "./fabrials";
import {resolveCycle} from "./resolver";
import {holdOrder} from "./planning";
import type {Event} from "./types";
function setup() {
 const s=scenario(),f=s.formations[1];
 f.equipment={items:[{id:"active",kind:"halfShard",owner:"blue"},{id:"pending",kind:"soulcaster",owner:"blue"},{id:"carried",kind:"halfShard",owner:"blue"},{id:"pain",kind:"painrial",owner:"blue"}],active:"active",pending:{id:"pending",afterCycle:1}};
 return {s,f};
}
it.each([[1.01,.10],[1.499,.10],[1.5,.25],[1.999,.25],[2,.5],[2.999,.5],[3,.75],[10,.75]])("ratio %s selects chance %s",(ratio,chance)=>{
 expect(fabrialLossChance(ratio*100,100,true,false)).toBe(chance);
});
it("winners and ties are exempt; annihilation overrides every band and custom zero rates",()=>{
 expect(fabrialLossChance(200,100,false,false)).toBe(0);
 expect(fabrialLossChance(0,0,true,false)).toBe(.75);
 expect(fabrialLossChance(100,200,false,true,[0,0,0,0])).toBe(1);
});
it("all reusable slots roll once, consumption is separate, losses cancel ghost activation",()=>{
 const {s,f}=setup(),events:Event[]=[];
 resolveFabrialLosses(s,[f],{cycle:1,step:1,position:"B2",seed:"x",winnerPower:300,ownPower:100,defeated:true,rates:[1,1,1,1]},events);
 expect(f.equipment!.items.map(i=>i.id)).toEqual(["pain"]);expect(f.equipment!.active).toBeUndefined();expect(f.equipment!.pending).toBeUndefined();
 expect(s.equipmentRecords?.map(r=>r.status)).toEqual(["lost","lost","lost"]);expect(events).toHaveLength(3);expect(()=>validateEquipment(s)).not.toThrow();
});
it("seeded item rolls are independent of item order, active status and carrier ID",()=>{
 const a=setup(),b=setup();b.f.equipment!.items.reverse();b.f.id="different-carrier";delete b.f.equipment!.active;
 const args={cycle:1,step:1,position:"B2",seed:"same",winnerPower:200,ownPower:100,defeated:true};const ae:Event[]=[],be:Event[]=[];
 resolveFabrialLosses(a.s,[a.f],args,ae);resolveFabrialLosses(b.s,[b.f],args,be);
 const roll=(e:Event[])=>e.map(x=>x.type==="fabrial"?{item:x.item,roll:x.roll,action:x.action}:null);
 expect(roll(ae)).toEqual(roll(be));expect(new Set(ae.map(x=>x.type==="fabrial"?x.roll:0)).size).toBe(3);
});
it("multiway resolver uses winner Power before casualties, not summed hostility; deterministic replay",()=>{
 const {s,f}=setup();f.units={...emptyUnits(),spearman:100};f.position="B2";f.history=["B2"];f.order=holdOrder();
 const red=s.formations[0];red.units={...emptyUnits(),spearman:160};red.position="B2";red.history=["B2"];red.order=holdOrder();
 s.formations.push({...structuredClone(red),id:"green",kingdom:"green",units:{...emptyUnits(),spearman:140}});
 const input={state:s,config:defaults,cycle:1,seed:"multi"};const r=resolveCycle(input);
 const checks=r.events.filter(e=>e.type==="fabrial"&&e.lossChance!==undefined);
 expect(checks).toHaveLength(3);expect(checks.every(e=>e.type==="fabrial"&&e.lossChance===.25)).toBe(true);
 expect(resolveCycle(input)).toEqual(r);expect(resolveCycle({...input,state:{...s,formations:[...s.formations].reverse()}})).toEqual(r);
});
it("annihilation loses reusable devices even without defeat",()=>{
 const {s,f}=setup();f.units=emptyUnits();const events:Event[]=[];
 resolveFabrialLosses(s,[f],{cycle:1,step:1,position:"B2",seed:"x",winnerPower:100,ownPower:100,defeated:false},events);
 expect(events.every(e=>e.type==="fabrial"&&e.lossChance===1&&e.action==="lost")).toBe(true);
});
it("loss knobs reject invalid values",()=>{
 const {s}=setup();expect(()=>resolveCycle({state:s,cycle:1,seed:"x",config:{...defaults,fabrialLossRates:[0,0,0,1.01]}})).toThrow("Fabrial loss");
});
