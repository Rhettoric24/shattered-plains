import { describe,it,expect } from "vitest";
import { scenario,defaults } from "../lab/scenarios";
import { emptyUnits } from "../convex/rules";
import { battlefieldVision,disclosureLevel,projectConflict,projectJournal } from "./disclosure";
import { resolveCycle } from "./resolver";
function board() {
 const s=scenario();s.formations=[
 {...s.formations[1],id:"own",name:"Own",position:"B2",history:["B2"],order:{kind:"hold" as const,route:[],onDefeat:"pause" as const}},
 {...s.formations[0],id:"SECRET-ENEMY-ID",name:"SECRET-NAME",position:"B1",history:["B1"],cargo:98765,order:{kind:"move" as const,route:["A1"],onDefeat:"continue" as const}},
 {...s.formations[0],id:"SECRET-GREEN",kingdom:"green",position:"A1",history:["A1"]},
 ];return s;
}
it("orthogonal graph vision unions friendly positions without diagonals",()=>{
 const s=board();expect([...battlefieldVision(s,"blue")].sort()).toEqual(["A2","B1","B2","B3","C2"]);
 s.formations[0].position="A1";expect(battlefieldVision(s,"blue").size).toBe(3);
 s.formations.push({...s.formations[0],id:"friend",position:"C3"});
 const v=battlefieldVision(s,"blue");expect(v.has("approach")).toBe(true);expect(v.has("C2")).toBe(true);
});
it.each([[0,0,-1],[24,0,-1],[25,2,0],[74,2,0],[75,3,2],[100,3,2]])("Intel %s uses normal %s / fog %s",(amount,normal,fog)=>{
 expect(disclosureLevel(amount,false)).toBe(normal);expect(disclosureLevel(amount,true)).toBe(fog);
});
it("own formations remain exact; adjacency removes fog but does not grant exact enemy data",()=>{
 const s=board(),v=projectConflict(s,"blue",{},true);
 expect(v.own[0].formation).toEqual(s.formations[0]);
 expect(v.contacts).toHaveLength(1);expect(v.contacts[0]).toMatchObject({kingdom:"red",position:"B1",power:{mode:"label"}});
 expect(v.visiblePositions).not.toContain("A1");
});
it("per-rival Intel penetrates fog one tier lower; fog off restores global presence",()=>{
 const s=board(),v=projectConflict(s,"blue",{red:90,green:25},true);
 expect(v.contacts.map(c=>c.power?.mode)).toEqual(["exact","label"]);
 expect(projectConflict(s,"blue",{red:15,green:100},true).contacts.map(c=>c.power?.mode)).toEqual(["label","estimate"]);
 expect(projectConflict(s,"blue",{},false).contacts).toHaveLength(2);
});
it("projection allowlists enemy fields and excludes hidden records, orders, cargo, Research and journal",()=>{
 const s=board();s.kingdoms[1].research={painrialMedicine:3};
 s.arrivals=[{id:"SECRET-ARRIVAL",cycle:5,formation:s.formations[1]}];
 const view=projectConflict(s,"blue",{red:100},true),json=JSON.stringify(view);
 for(const secret of ["SECRET-ENEMY-ID","SECRET-NAME","SECRET-GREEN","SECRET-ARRIVAL","98765","painrialMedicine","treasury","events","raidValues"])expect(json).not.toContain(secret);
 expect(Object.keys(view.contacts[0]).sort()).toEqual(["kingdom","level","physicallyVisible","position","power"]);
 expect(view.ownArrivals).toEqual([]);
 expect(s.formations[1].name).toBe("SECRET-NAME");
});
it("filtered journal reveals only viewer battle losses without opponent data or unrelated event counts",()=>{
 const s=board();s.formations.forEach(f=>{f.position="B2";f.history=["B2"];f.order={kind:"hold",route:[],onDefeat:"pause"}});
 const result=resolveCycle({state:s,config:defaults,cycle:1,seed:"intel"});
 const reports=projectJournal([result],"blue");expect(reports.length).toBeGreaterThan(0);
 expect(Object.keys(reports[0]).sort()).toEqual(["casualties","cycle","position","survivors","won"]);
 expect(projectJournal([result],"unrelated")).toEqual([]);
});
it("empty viewer armies have no physical vision, and invalid viewers fail closed",()=>{
 const s=board();s.formations[0].units=emptyUnits();expect(battlefieldVision(s,"blue").size).toBe(0);
 expect(()=>projectConflict(s,"unknown",{},true)).toThrow();
});
