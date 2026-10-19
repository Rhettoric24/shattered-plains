/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { emptyUnits, emptyBuildings, effectivePower, applySurvivalLosses, WORLD_KEY } from "./rules";
import { DIPLOMACY, missionMinimumPower } from "./diplomacyRules";
import { serviceEligibility } from "./diplomacyServices";
import { ownedUnitsIncludingAway } from "./provisionHelpers";
import { applyHighstormExposureLosses } from "./highstormRules";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
async function setup(days = 0) {
  const t = convexTest(schema, modules), ids = [];
  for (const name of ["one", "two", "three"]) ids.push(await t.run(ctx => ctx.db.insert("players", { authUserId:name, name, normalizedName:name, acres:0, spheres:100000, gemhearts:10, units:{...emptyUnits(), spearman:1500}, buildings:emptyBuildings(), lastEconomyAt:Date.now(), lastActiveAt:Date.now(), createdAt:Date.now()-days*86400000 })));
  const player=t.withIdentity({subject:"one"});
  return {t,ids,player};
}
async function petition(f: Awaited<ReturnType<typeof setup>>, kind: "escort" | "storm" | "intel" = "escort") {
  return f.t.run(ctx => ctx.db.insert("parshendiPetitions", {slot:kind==="intel"?1:0,kind,active:true,title:kind,objective:kind,sphereCost:0,favor:1,hostilityReduction:15,createdAt:Date.now(),expiresAt:Date.now()+3600000,...(kind==="intel"?{targetId:f.ids[1],category:"military" as const}:{})}));
}
test.each([[0,200],[7,600],[14,1000],[99,1000],[-1,200]])("personal kingdom age %s days requires %s Power", (days,power)=>{
  expect(missionMinimumPower(Date.now()-days*86400000,Date.now())).toBe(power);
});
test("escort reserves troops, counts Provisions, pays once and returns once even at full Favor",async()=>{
  const f=await setup(), id=await petition(f), units={...emptyUnits(),spearman:200};
  const args={petitionId:id,units};
  await f.player.mutation(api.diplomacy.dispatch,args);
  await f.player.mutation(api.diplomacy.dispatch,args); // lost-response replay cannot duplicate anything
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({favor:1,assignments:[{kind:"escort",units,returnAt:Date.now()+4*3600000}]});
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1300);
  expect((await f.t.run(ctx=>ownedUnitsIncludingAway(ctx,f.ids[0],{...emptyUnits(),spearman:1300}))).spearman).toBe(1500);
  const assignment=(await f.t.run(ctx=>ctx.db.query("parshendiAssignments").collect()))[0];
  await f.t.mutation(internal.diplomacyServices.returnAssignment,{assignmentId:assignment._id});
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1300);
  const another=await petition(f);
  await expect(f.player.mutation(api.diplomacy.dispatch,{petitionId:another,units})).rejects.toThrow(/already has/);
  await f.t.run(async ctx=>{const rel=(await ctx.db.query("parshendiRelations").collect())[0];await ctx.db.patch(rel._id,{favor:5});});
  vi.setSystemTime(Date.now()+4*3600000);
  await f.t.mutation(internal.diplomacyServices.recoverReturns,{});
  await f.t.mutation(internal.diplomacyServices.returnAssignment,{assignmentId:assignment._id});
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1500);
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({favor:5,assignments:[]});
});
test("dispatch cannot bypass age scaling, availability, active types, whole counts, or cap",async()=>{
  const f=await setup(14), id=await petition(f);
  for(const units of [{...emptyUnits(),spearman:999},{...emptyUnits(),spearman:1501},{...emptyUnits(),spearman:1000.5},{...emptyUnits(),spearman:1000,heavy:1},{...emptyUnits(),spearman:1000,bridgeman:-1}]) {
    await expect(f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units})).rejects.toThrow();
  }
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:id})).rejects.toThrow(/Select troops/);
  await f.t.run(ctx=>ctx.db.insert("parshendiRelations",{playerId:f.ids[0],favor:5,tributeCount:0,tributeWindowAt:Date.now()}));
  await expect(f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units:{...emptyUnits(),spearman:1000}})).rejects.toThrow(/cap/);
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1500);
  expect(await f.t.run(ctx=>ctx.db.query("parshendiAssignments").collect())).toHaveLength(0);
});
test("simultaneous kingdoms cannot both take the same escort",async()=>{
  const f=await setup(),id=await petition(f);
  const results=await Promise.allSettled([f.player,f.t.withIdentity({subject:"two"})].map(p=>p.mutation(api.diplomacy.dispatch,{petitionId:id,units:{...emptyUnits(),spearman:200}})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(await f.t.run(ctx=>ctx.db.query("parshendiAssignments").collect())).toHaveLength(1);
});
test("storm research applies one seeded Survive roll and returns survivors, leaving ordinary storm rules alone",async()=>{
  const f=await setup(),id=await petition(f,"storm"),units={...emptyUnits(),spearman:200};
  await expect(f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units})).rejects.toThrow(/active Highstorm/);
  await f.t.run(ctx=>ctx.db.insert("gameState",{key:WORLD_KEY,openAcres:0,createdAt:Date.now(),updatedAt:Date.now(),highstormOverrideStartAt:Date.now()-1000,highstormOverrideEndAt:Date.now()+3600000,highstormOverrideId:"research-test"}));
  await f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units});
  const assignment=(await f.t.run(ctx=>ctx.db.query("parshendiAssignments").collect()))[0];
  const expected=applySurvivalLosses(units,.6,`research:${id}:${f.ids[0]}:research-test`,{},false,300);
  expect(assignment).toMatchObject({units:expected.survivors,casualties:expected.casualties,stormId:"research-test"});
  expect(assignment.casualties.spearman).toBe(40);
  expect(applyHighstormExposureLosses(units,"ordinary",{}).casualties.spearman).toBe(10);
  await f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units});
  await f.t.mutation(internal.highstorms.processActiveStorm,{});
  expect((await f.t.run(ctx=>ctx.db.get(assignment._id)))!.units).toEqual(expected.survivors);
  vi.setSystemTime(Date.now()+3600000);
  await f.t.mutation(internal.diplomacyServices.recoverReturns,{});
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1460);
});
test("late storm entry still rolls full exposure; stronger Survive reduces research loss",()=>{
  const exposed={...emptyUnits(),spearman:200,bridgeman:400},protectedUnits={...emptyUnits(),spearman:600};
  expect(effectivePower(exposed)).toBeGreaterThanOrEqual(200);
  expect(applySurvivalLosses(exposed,.6,"same",{},false,300).finalCasualtyRate).toBeGreaterThan(applySurvivalLosses(protectedUnits,.6,"same",{},false,300).finalCasualtyRate);
  expect(DIPLOMACY.researchStormBaseCasualtyRate).toBe(.6);
});
test("Intel category debit is atomic, honors cap, preserves other pools, and does not resurrect legacy Military Intel",async()=>{
  const f=await setup(),id=await petition(f,"intel");
  const resource=await f.t.run(ctx=>ctx.db.insert("kingdomIntelResources",{viewerPlayerId:f.ids[0],targetPlayerId:f.ids[1],amount:50,economyAmount:80,updatedAt:Date.now()}));
  await f.t.run(ctx=>ctx.db.insert("parshendiRelations",{playerId:f.ids[0],favor:5,tributeCount:0,tributeWindowAt:Date.now()}));
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:id})).rejects.toThrow(/cap/);
  expect((await f.t.run(ctx=>ctx.db.get(resource)))!.amount).toBe(50);
  await f.t.run(async ctx=>{const rel=(await ctx.db.query("parshendiRelations").collect())[0];await ctx.db.patch(rel._id,{favor:0});});
  const results=await Promise.allSettled([1,2].map(()=>f.player.mutation(api.diplomacy.fulfill,{petitionId:id})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(await f.t.run(ctx=>ctx.db.get(resource))).toMatchObject({militaryAmount:0,economyAmount:80});
  const next=await petition(f,"intel");
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:next})).rejects.toThrow(/you have 0/);
});
test("Intel uses legacy report fallback once and excludes self, same-account and observer targets",async()=>{
  const f=await setup(),id=await petition(f,"intel");
  await f.t.run(ctx=>ctx.db.insert("kingdomIntelligence",{viewerPlayerId:f.ids[0],targetPlayerId:f.ids[1],category:"military",achievedLevel:5,bestLevel:5,observedScore:100,observedAt:Date.now(),source:"test"}));
  for(const patch of [{authUserId:"one"},{authUserId:"two",isAdminObserver:true}]){
    await f.t.run(ctx=>ctx.db.patch(f.ids[1],patch));
    expect(await f.t.run(async ctx=>serviceEligibility(ctx,(await ctx.db.get(f.ids[0]))!,(await ctx.db.get(id))!))).toContain("not eligible");
  }
  await f.t.run(ctx=>ctx.db.patch(f.ids[1],{isAdminObserver:false}));
  await f.player.mutation(api.diplomacy.fulfill,{petitionId:id});
  expect((await f.t.run(ctx=>ctx.db.query("kingdomIntelResources").collect()))[0].militaryAmount).toBe(50);
});
test("random Intel request replaces on purchase, stops at three globally, and resumes next hour",async()=>{
  const f=await setup();
  for(let i=0;i<3;i++){
    await f.t.mutation(internal.diplomacy.refreshPetitions,{});
    const active=await f.t.run(ctx=>ctx.db.query("parshendiPetitions").withIndex("by_active_and_slot",q=>q.eq("active",true).eq("slot",1)).unique());
    expect(active?.kind).toBe("intel");
    expect(["military","economy","research","territory"]).toContain(active!.category);
    const viewer=f.ids.find(id=>id!==active!.targetId)!;
    const name=(await f.t.run(ctx=>ctx.db.get(viewer)))!.authUserId!;
    await f.t.run(async ctx=>{
      const row=await ctx.db.query("kingdomIntelResources").withIndex("by_viewerPlayerId_and_targetPlayerId",q=>q.eq("viewerPlayerId",viewer).eq("targetPlayerId",active!.targetId!)).unique();
      if(row) await ctx.db.patch(row._id,{militaryAmount:100,economyAmount:100,researchAmount:100,territoryAmount:100});
      else await ctx.db.insert("kingdomIntelResources",{viewerPlayerId:viewer,targetPlayerId:active!.targetId!,amount:0,militaryAmount:100,economyAmount:100,researchAmount:100,territoryAmount:100,updatedAt:Date.now()});
    });
    await f.t.withIdentity({subject:name}).mutation(api.diplomacy.fulfill,{petitionId:active!._id});
    const remaining=await f.t.run(ctx=>ctx.db.query("parshendiPetitions").withIndex("by_active_and_slot",q=>q.eq("active",true).eq("slot",1)).collect());
    expect(remaining).toHaveLength(i===2?0:1);
  }
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  expect((await f.player.query(api.diplomacy.get,{})).intelPurchases).toBe(3);
  expect((await f.player.query(api.diplomacy.get,{})).petitions.filter(p=>p.kind==="intel")).toHaveLength(0);
  vi.setSystemTime(Date.now()+3600000);
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({intelPurchases:0});
  expect((await f.player.query(api.diplomacy.get,{})).petitions.filter(p=>p.kind==="intel")).toHaveLength(1);
});

test("the final hourly Intel purchase cannot race across distinct eligible offers",async()=>{
  const f=await setup();
  const ids=[await petition(f,"intel"),await petition(f,"intel")];
  await f.t.run(async ctx=>{
    await ctx.db.insert("parshendiIntelHours",{hour:Math.floor(Date.now()/3600000),purchases:2});
    for(const viewer of [f.ids[0],f.ids[2]]) await ctx.db.insert("kingdomIntelResources",{viewerPlayerId:viewer,targetPlayerId:f.ids[1],amount:100,updatedAt:Date.now()});
  });
  const results=await Promise.allSettled([f.player,f.t.withIdentity({subject:"three"})].map((p,i)=>p.mutation(api.diplomacy.fulfill,{petitionId:ids[i]})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await f.t.run(ctx=>ctx.db.query("parshendiIntelHours").collect()))[0].purchases).toBe(3);
  const balances=await f.t.run(ctx=>ctx.db.query("kingdomIntelResources").collect());
  expect(balances.map(r=>r.militaryAmount??r.amount).sort((a,b)=>a-b)).toEqual([50,100]);
});
test("joining in a storm's final millisecond still takes full exposure before returning",async()=>{
  const f=await setup(),id=await petition(f,"storm"),now=Date.now();
  await f.t.run(ctx=>ctx.db.insert("gameState",{key:WORLD_KEY,openAcres:0,createdAt:now,updatedAt:now,highstormOverrideStartAt:now-7199999,highstormOverrideEndAt:now+1,highstormOverrideId:"late-storm"}));
  await f.player.mutation(api.diplomacy.dispatch,{petitionId:id,units:{...emptyUnits(),spearman:200}});
  const assignment=(await f.t.run(ctx=>ctx.db.query("parshendiAssignments").collect()))[0];
  expect(assignment.casualties.spearman).toBe(40);
  expect(assignment.returnAt).toBe(now+1);
  vi.setSystemTime(now+1);
  await f.t.mutation(internal.diplomacyServices.recoverReturns,{});
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1460);
});

test("storm petitions bind the active storm identity and reject a replacement storm",async()=>{
  const f=await setup(),now=Date.now();
  const world=await f.t.run(ctx=>ctx.db.insert("gameState",{key:WORLD_KEY,openAcres:0,createdAt:now,updatedAt:now,highstormOverrideStartAt:now-1000,highstormOverrideEndAt:now+3600000,highstormOverrideId:"original"}));
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  const p=(await f.player.query(api.diplomacy.get,{})).petitions.find(p=>p.kind==="storm")!;
  expect((await f.t.run(ctx=>ctx.db.get(p.id)))!.stormId).toBe("original");
  await f.t.run(ctx=>ctx.db.patch(world,{highstormOverrideId:"replacement"}));
  await expect(f.player.mutation(api.diplomacy.dispatch,{petitionId:p.id,units:{...emptyUnits(),spearman:200}})).rejects.toThrow(/requested active Highstorm/);
  expect((await f.t.run(ctx=>ctx.db.get(f.ids[0])))!.units.spearman).toBe(1500);
});
