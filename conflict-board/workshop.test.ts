import { expect, it } from "vitest";
import { scenario, defaults } from "../lab/scenarios";
import { playerWorkshop, retreatShade, type WorkshopCommand } from "../lab/workshop";
import { emptyUnits, totalUnits } from "../convex/rules";
import { resolveCycle } from "./resolver";
let serial = 0;
const uid = () => `workshop-${serial++}`;
const command = (kind: WorkshopCommand["kind"]): WorkshopCommand => ({kind, name:"Edited", units:{...emptyUnits(),bridgeman:5},onDefeat:"continue"});
it("own workshop splits conserve troops; edits target only the selected formation", () => {
  const s=scenario(), f=s.formations.find(f=>f.kingdom==="blue")!;
  const result=playerWorkshop(s,"blue",f.id,command("split"),uid);
  expect(result.state.formations.filter(g=>g.kingdom==="blue").reduce((n,g)=>n+totalUnits(g.units),0)).toBe(totalUnits(f.units));
  const edited=playerWorkshop(result.state,"blue",result.selected,command("add"),uid);
  expect(edited.state.formations.find(g=>g.id===result.selected)!.units.bridgeman).toBe(10);
  expect(edited.state.formations.find(g=>g.id===f.id)).toEqual(result.state.formations.find(g=>g.id===f.id));
  expect(()=>playerWorkshop(s,"red",f.id,command("edit"),uid)).toThrow("own army");
  expect(s.formations.find(g=>g.id===f.id)).toEqual(f);
});
it("reinforcements use existing side entry and edit preserves route/history/cargo", () => {
  const s=scenario(), f=s.formations.find(f=>f.kingdom==="blue")!;
  f.position="B2";f.history=["approach","B3","B2"];f.order={kind:"hold",route:[],onDefeat:"pause"};f.cargo=7;
  const edited=playerWorkshop(s,"blue",f.id,command("edit"),uid).state;
  const g=edited.formations.find(g=>g.id===f.id)!;
  expect(g.history).toEqual(f.history);expect(g.cargo).toBe(7);
  expect(()=>playerWorkshop(s,"blue",f.id,command("split"),uid)).toThrow("cargo");
  const queued=playerWorkshop(s,"blue",f.id,command("arrive"),uid).state;
  expect(queued.arrivals[0].cycle).toBe(1);
  const r=resolveCycle({state:queued,cycle:1,config:defaults,seed:"workshop"});
  expect(r.events).toContainEqual({type:"arrival",formation:queued.arrivals[0].formation.id,position:"approach"});
});
it("workshop rejects invalid counts without changing source", () => {
  const s=scenario(), f=s.formations.find(f=>f.kingdom==="blue")!;
  for (const count of [-1,1.5,NaN,Infinity]) {
    const c=command("edit");c.units.bridgeman=count;
    expect(()=>playerWorkshop(s,"blue",f.id,c,uid)).toThrow();
  }
});
it("retreat shade follows fallback distance and clears unrelated/current tiles", () => {
  const f={position:"B1",history:["approach","B3","B2","B1"]};
  expect(retreatShade(f,"B1")).toBeNull();expect(retreatShade(f,"A1")).toBeNull();
  expect(retreatShade(f,"B2")).toEqual({depth:1,color:"hsl(270 40% 44%)"});
  expect(retreatShade(f,"approach")).toEqual({depth:3,color:"hsl(270 40% 18%)"});
});
