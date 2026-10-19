/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { emptyUnits, emptyBuildings } from "./rules";
import { relations } from "./diplomacyHelpers";
import { DIPLOMACY, donationReduction, tributeProgress } from "./diplomacyRules";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });
async function setup(spheres = 100000, gemhearts = 10) {
  const t = convexTest(schema, modules);
  const ids = [];
  for (const name of ["one", "two"]) ids.push(await t.run(ctx => ctx.db.insert("players", { authUserId: name, name, normalizedName: name, acres: 0, spheres, gemhearts, units: emptyUnits(), buildings: emptyBuildings(), lastEconomyAt: Date.now(), lastActiveAt: Date.now(), createdAt: Date.now() })));
  return { t, id: ids[0], other: ids[1], player: t.withIdentity({ subject: "one" }), rival: t.withIdentity({ subject: "two" }) };
}
test("separate donations retain personal progress, grant Favor only with both resources, and preserve excess", async () => {
  const f = await setup();
  await f.player.mutation(api.diplomacy.tribute, { requestId:"s1",resource:"spheres",amount:15000 });
  expect(await f.player.query(api.diplomacy.get, {})).toMatchObject({ favor:0, tribute:{ sphereCredit:15000, gemheartCredit:0 } });
  await f.player.mutation(api.diplomacy.tribute, { requestId:"g1",resource:"gemhearts",amount:2 });
  expect(await f.player.query(api.diplomacy.get, {})).toMatchObject({ favor:1,reserveGemhearts:2,tribute:{sphereCredit:5000,gemheartCredit:1} });
  await f.player.mutation(api.diplomacy.tribute, { requestId:"s2",resource:"spheres",amount:5000 });
  expect(await f.player.query(api.diplomacy.get, {})).toMatchObject({ favor:2,tribute:{sphereCredit:0,gemheartCredit:0} });
  expect(await f.rival.query(api.diplomacy.get, {})).toMatchObject({ favor:0,tribute:{sphereCredit:0,gemheartCredit:0} });
});
test("Gemhearts alone can lower Hostility and enter the reserve without any Spheres", async () => {
  const f=await setup(0,2);
  await f.t.run(ctx=>ctx.db.insert("kingdomWorldPressure",{playerId:f.id,hostility:60,decayIntervalsApplied:0,updatedAt:Date.now()}));
  await f.player.mutation(api.diplomacy.tribute,{requestId:"g",resource:"gemhearts",amount:1});
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({hostility:56,favor:0,reserveGemhearts:1,tribute:{gemheartCredit:1}});
  expect(await f.t.run(ctx=>ctx.db.get(f.id))).toMatchObject({spheres:0,gemhearts:1});
});
test("donation receipts replay exactly once and reject reusing an identity for a different payment",async()=>{
  const f=await setup(), args={requestId:"same",resource:"spheres" as const,amount:10000};
  const first=await f.player.mutation(api.diplomacy.tribute,args);
  expect(await f.player.mutation(api.diplomacy.tribute,args)).toEqual(first);
  await expect(f.player.mutation(api.diplomacy.tribute,{...args,amount:20000})).rejects.toThrow(/different payment/);
  expect(await f.t.run(ctx=>ctx.db.get(f.id))).toMatchObject({spheres:90000});
  await expect(f.player.mutation(api.diplomacy.tribute,{requestId:"old-client"})).rejects.toThrow(/Refresh Diplomacy/);
});
test.each([0,-1,1.5,Infinity,NaN,1000001])("invalid Sphere amount %s changes no resources",async amount=>{
  const f=await setup(),before=await f.t.run(ctx=>ctx.db.get(f.id));
  await expect(f.player.mutation(api.diplomacy.tribute,{requestId:"invalid",resource:"spheres",amount})).rejects.toThrow();
  expect(await f.t.run(ctx=>ctx.db.get(f.id))).toEqual(before);
});
test("concurrent donations cannot overdraw resources or exceed the Favor cap",async()=>{
  const f=await setup(10000,1);
  const outcomes=await Promise.allSettled(["a","b"].map(requestId=>f.player.mutation(api.diplomacy.tribute,{requestId,resource:"spheres",amount:10000})));
  expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  await f.t.run(async ctx=>{const rel=(await relations(ctx,f.id))!;await ctx.db.patch(rel._id,{favor:4,sphereCredit:20000});});
  const claims=await Promise.allSettled(["complete-a","complete-b"].map(requestId=>f.player.mutation(api.diplomacy.tribute,{requestId,resource:"gemhearts",amount:1})));
  expect(claims.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const before=await f.t.run(ctx=>ctx.db.get(f.id));
  await expect(f.player.mutation(api.diplomacy.tribute,{requestId:"cap",resource:"spheres",amount:1})).rejects.toThrow(/cap/);
  expect(await f.t.run(ctx=>ctx.db.get(f.id))).toEqual(before);
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({favor:5,tribute:{sphereCredit:10000,gemheartCredit:0}});
});
test("a donation that would award too many Favor rejects atomically",async()=>{
  const f=await setup();
  await f.t.run(ctx=>ctx.db.insert("parshendiRelations",{playerId:f.id,favor:4,sphereCredit:20000,tributeCount:0,tributeWindowAt:Date.now()}));
  await expect(f.player.mutation(api.diplomacy.tribute,{requestId:"too-many",resource:"gemhearts",amount:2})).rejects.toThrow(/cap/);
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({favor:4,reserveGemhearts:0,tribute:{sphereCredit:20000,gemheartCredit:0}});
});
test("diminishing returns depend on total donations, never transaction size or order",()=>{
  for(const resource of ["spheres","gemhearts"] as const){
    const n=resource==="spheres"?1000:1;
    let window={spheres:0,gemhearts:0},total=0;
    for(let i=0;i<10;i++){total+=donationReduction(window,resource,n);window[resource]+=n;}
    expect(total).toBe(donationReduction({spheres:0,gemhearts:0},resource,10*n));
  }
  expect(donationReduction({spheres:0,gemhearts:0},"spheres",10000)).toBe(8);
  expect(donationReduction({spheres:0,gemhearts:0},"gemhearts",1)).toBe(4);
  expect(donationReduction({spheres:10000,gemhearts:1},"spheres",10000)).toBeLessThan(8);
  expect(tributeProgress(25000,2,0)).toEqual({favorGranted:2,sphereCredit:5000,gemheartCredit:0});
});
test("the 24-hour reduction window resets, but Favor progress never expires",async()=>{
  const f=await setup();
  await f.player.mutation(api.diplomacy.tribute,{requestId:"old",resource:"spheres",amount:10000});
  vi.setSystemTime(Date.now()+DIPLOMACY.tributeWindowMs);
  const d=await f.player.query(api.diplomacy.get,{});
  expect(d.tribute).toMatchObject({sphereCredit:10000,window:{spheres:0,gemhearts:0}});
  const r=await f.player.mutation(api.diplomacy.tribute,{requestId:"new",resource:"gemhearts",amount:1});
  expect(r?.favorGranted).toBe(1);
});
test("old full contracts keep their awarded Favor without granting new donation progress",async()=>{
  const f=await setup();
  await f.t.run(ctx=>ctx.db.insert("parshendiRelations",{playerId:f.id,favor:2,tributeCount:2,tributeWindowAt:Date.now()}));
  expect(await f.player.query(api.diplomacy.get,{})).toMatchObject({favor:2,tribute:{sphereCredit:0,gemheartCredit:0,window:{spheres:20000,gemhearts:2}}});
});
test("rotation removes resource petitions and stays empty without suitable events",async()=>{
  const f=await setup();
  const id=await f.t.run(ctx=>ctx.db.insert("parshendiPetitions",{kind:"supplies",slot:0,active:true,title:"old",objective:"Pay",sphereCost:2500,favor:1,hostilityReduction:15,createdAt:Date.now(),expiresAt:Date.now()+DIPLOMACY.petitionDurationMs}));
  expect((await f.player.query(api.diplomacy.get,{})).petitions).toEqual([]);
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:id})).rejects.toThrow(/only through standing/);
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  expect(await f.t.run(ctx=>ctx.db.get(id))).toMatchObject({active:false});
  expect((await f.player.query(api.diplomacy.get,{})).petitions).toEqual([]);
});
test("world petitions retain shared first-come completion, cap safeguards and expiration",async()=>{
  const f=await setup();
  await f.t.run(ctx=>ctx.db.insert("kingdomWorldPressure",{playerId:f.other,hostility:80,decayIntervalsApplied:0,updatedAt:Date.now()}));
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  const p=(await f.player.query(api.diplomacy.get,{})).petitions[0];
  expect((await f.rival.query(api.diplomacy.get,{})).petitions[0].id).toBe(p.id);
  await f.t.run(async ctx=>{
    await ctx.db.insert("parshendiVictories",{key:"win",winnerId:f.id,targetIds:[f.other],at:Date.now()});
    await ctx.db.insert("parshendiRelations",{playerId:f.id,favor:5,tributeCount:0,tributeWindowAt:Date.now()});
  });
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:p.id})).rejects.toThrow(/cap/);
  await f.t.run(async ctx=>{const r=(await relations(ctx,f.id))!;await ctx.db.patch(r._id,{favor:4});});
  const results=await Promise.allSettled([1,2].map(()=>f.player.mutation(api.diplomacy.fulfill,{petitionId:p.id})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await f.player.query(api.diplomacy.get,{})).favor).toBe(5);
  const expiration=await f.t.run(async ctx=>{const original=(await ctx.db.get(p.id))!;const {_id,_creationTime,fulfilledBy,fulfilledAt,...fields}=original;return ctx.db.insert("parshendiPetitions",{...fields,active:true});});
  vi.setSystemTime(Date.now()+DIPLOMACY.petitionDurationMs);
  await f.t.run(async ctx=>{const r=(await relations(ctx,f.id))!;await ctx.db.patch(r._id,{favor:4});});
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:expiration})).rejects.toThrow(/expired/);
});
test("Donate Plateau validates current ownership, rejects conflict, and applies neutral reclamation rules", async () => {
  const f = await setup();
  const plateauId = await f.t.run(ctx => ctx.db.insert("plateaus", { name: "Recent", type: "gemheart", status: "owned", ownerPlayerId: f.id, origin: "neutral", highground: false, neutralDefenseInitial: 100, neutralDefenseRemaining: 0, heldSince: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }));
  // This test exercises an existing Return request; the new occupation slot gets
  // first choice of an otherwise-unrequested holding during generation.
  await f.t.run(ctx => ctx.db.insert("parshendiPetitions", { slot:0,active:true,kind:"plateau",plateauId,title:"Return Recent",objective:"Return Recent",sphereCost:0,favor:1,hostilityReduction:15,createdAt:Date.now(),expiresAt:Date.now()+DIPLOMACY.petitionDurationMs }));
  await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  const p = (await f.player.query(api.diplomacy.get, {})).petitions.find(p => p.kind === "plateau")!;
  await expect(f.rival.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/currently own/);
  await f.t.run(ctx => ctx.db.patch(plateauId, { ownerPlayerId: f.other }));
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/currently own/);
  const siegeId = await f.t.run(ctx => ctx.db.insert("sieges", { plateauId, attackerId: f.id, targetType: "player", attackerUnits: emptyUnits(), attackerPower: 0, attackerSpeed: 0, fortifyPercent: 0, departAt: Date.now(), resolveAt: Date.now() + 1000, status: "pending" }));
  await f.t.run(ctx => ctx.db.patch(plateauId, { activeSiegeId: siegeId }));
  await expect(f.rival.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/free of active conflict/);
  await f.t.run(ctx => ctx.db.patch(plateauId, { activeSiegeId: undefined }));
  await f.rival.mutation(api.diplomacy.fulfill, { petitionId: p.id });
  const plateau = await f.t.run(ctx => ctx.db.get(plateauId));
  expect(plateau).toMatchObject({ status: "neutral", parshendiReclamationCount: 1 });
  expect(plateau!.ownerPlayerId).toBeUndefined(); expect(plateau!.nextGemheartAt).toBeUndefined();
  expect(plateau!.neutralDefenseRemaining).toBeGreaterThan(100);
});
test("aggressor claims require an in-window authoritative victory and consume it only once", async () => {
  const f = await setup();
  await f.t.run(ctx => ctx.db.insert("kingdomWorldPressure", { playerId: f.other, hostility: 80, decayIntervalsApplied: 0, updatedAt: Date.now() }));
  await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  const p = (await f.player.query(api.diplomacy.get, {})).petitions.find(p => p.kind === "aggressor")!;
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/Win a PvP/);
  const id = await f.t.run(ctx => ctx.db.insert("parshendiVictories", { key: "old", winnerId: f.id, targetIds: [f.other], at: Date.now() - 1 }));
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/Win a PvP/);
  await f.t.run(ctx => ctx.db.patch(id, { at: Date.now() }));
  await f.player.mutation(api.diplomacy.fulfill, { petitionId: p.id });
  expect(await f.t.run(ctx => ctx.db.get(id))).toMatchObject({ petitionId: p.id });
  expect((await f.t.run(ctx => relations(ctx, f.id)))?.favor).toBe(1);
  const second = await f.t.run(async ctx => {
    const original = (await ctx.db.get(p.id))!;
    const { _id, _creationTime, fulfilledBy, fulfilledAt, ...fields } = original;
    return await ctx.db.insert("parshendiPetitions", { ...fields, active: true });
  });
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: second })).rejects.toThrow(/Win a PvP/);
});
