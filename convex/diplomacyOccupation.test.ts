/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { emptyUnits, emptyBuildings } from "./rules";
import { BOARD_DEFAULTS } from "../conflict-board/board";
import { chooseOccupationTarget, occupationTargetWeight, DIPLOMACY } from "./diplomacyRules";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
async function setup(extra = false) {
  const t = convexTest(schema, modules), players: Id<"players">[] = [];
  for (const name of ["owner", "challenger", "third"]) players.push(await t.run(ctx => ctx.db.insert("players", { authUserId:name, name, normalizedName:name, spheres:1000, gemhearts:0, acres:0, units:emptyUnits(), buildings:emptyBuildings(), createdAt:Date.now(), lastActiveAt:Date.now(), lastEconomyAt:Date.now() })));
  const ids: Id<"plateaus">[] = [];
  for (const type of extra ? ["gemheart", "ancient"] as const : ["gemheart"] as const) ids.push(await t.run(ctx => ctx.db.insert("plateaus", { name:type + " holding", type, origin:"home", status:"owned", ownerPlayerId:players[0], highground:false, neutralDefenseInitial:0, neutralDefenseRemaining:0, heldSince:Date.now()-48*3600000, createdAt:Date.now(), updatedAt:Date.now() })));
  await t.mutation(internal.diplomacy.refreshPetitions, {});
  const player=t.withIdentity({ subject:"challenger" }), petition=(await player.query(api.diplomacy.get, {})).petitions.find(p=>p.kind==="occupation")!;
  return {t,player,owner:t.withIdentity({subject:"owner"}),players,ids,petition};
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function capture(f: Fixture, overrides: { at?:number; outcome?:string; chain?:number; plateauId?:Id<"plateaus">; ownerId?:Id<"players"> } = {}) {
  const at = overrides.at ?? Date.now()+1000;
  return await f.t.run(async ctx => {
    const petition=(await ctx.db.get(f.petition.id))!;
    const plateauId=overrides.plateauId ?? petition.plateauId!;
    const id=await ctx.db.insert("boardConflicts", { plateauId,ownerId:overrides.ownerId ?? f.players[0],initiatorId:f.players[1],winnerId:f.players[1],status:"settled",createdAt:at-3600000,settledAt:at,nextCycleAt:at,deadlineAt:at,weatherAt:at,nextWakeAt:at,processedAt:at,revision:2,overtime:false,state:{},config:BOARD_DEFAULTS,escrow:0,outcome:overrides.outcome ?? "conquest" });
    await ctx.db.insert("boardParticipants", { conflictId:id,playerId:f.players[1],status:"returned",kingdom:{},units:emptyUnits(),committed:emptyUnits(),returnedUnits:emptyUnits(),banked:0,returnedSpheres:0,withdrawing:false,chainPosition:overrides.chain ?? 1 });
    await ctx.db.patch(plateauId,{ownerPlayerId:f.players[1],heldSince:at,updatedAt:at});
    return id;
  });
}
test("one stable 24-hour occupation target uses a dedicated shared slot",async()=>{
  const f=await setup(); expect(f.petition).toMatchObject({kind:"occupation",favor:1,hostilityReduction:15,expiresAt:Date.now()+24*3600000});
  expect(f.petition.objective).toContain("Capture gemheart holding from owner");
  expect((await f.owner.query(api.diplomacy.get,{})).petitions.find(p=>p.id===f.petition.id)?.missing).toContain("Your kingdom held");
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  expect((await f.player.query(api.diplomacy.get,{})).petitions.filter(p=>p.kind==="occupation").map(p=>p.id)).toEqual([f.petition.id]);
});
test("weighted selection prefers Gemheart and Ancient holdings without guaranteeing them",()=>{
  const candidates=[{type:"sphere"},{type:"gemheart"},{type:"ancient"}], counts={sphere:0,gemheart:0,ancient:0};
  for(let i=0;i<800;i++) counts[chooseOccupationTarget(candidates,(i+.5)/800)!.type as keyof typeof counts]++;
  expect(counts).toEqual({sphere:100,gemheart:400,ancient:300});
  expect(occupationTargetWeight("ancient_ruins")).toBe(3);
  expect(chooseOccupationTarget([],0)).toBeUndefined();
});
test("mere ownership cannot claim; verified conquest keeps the plateau and grants once",async()=>{
  const f=await setup();
  const plateauId=(await f.t.run(ctx=>ctx.db.get(f.petition.id)))!.plateauId!;
  await f.t.run(ctx=>ctx.db.patch(plateauId,{ownerPlayerId:f.players[1],heldSince:Date.now()}));
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
  const id=await capture(f);vi.setSystemTime(Date.now()+1000);
  expect((await f.player.query(api.diplomacy.get,{})).petitions.find(p=>p.id===f.petition.id)?.missing).toBeNull();
  const results=await Promise.allSettled([1,2].map(()=>f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await f.player.query(api.diplomacy.get,{})).favor).toBe(1);
  expect(await f.t.run(ctx=>ctx.db.get(id))).toMatchObject({parshendiPetitionId:f.petition.id});
  expect(await f.t.run(ctx=>ctx.db.get(plateauId))).toMatchObject({ownerPlayerId:f.players[1]});
});
test.each(["deadline: owner retained plateau","cancelled: plateau ownership changed","all outside forces left or were defeated"])("%s is not conquest proof",async outcome=>{
  const f=await setup();await capture(f,{outcome});vi.setSystemTime(Date.now()+1000);
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
});
test("pre-window conquest, wrong occupier, and repeat-opponent farming cannot earn Favor",async()=>{
  for(const overrides of [{at:Date.now()-1},{ownerId:undefined,chain:4}]){
    const f=await setup();await capture(f,overrides);vi.setSystemTime(Date.now()+1000);
    await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
  }
  const f=await setup();await capture(f,{ownerId:f.players[2]});vi.setSystemTime(Date.now()+1000);
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
});
test("losing control invalidates the claim; old conquest cannot be used after an unrelated reacquisition",async()=>{
  const f=await setup(),id=await capture(f);vi.setSystemTime(Date.now()+1000);
  const board=(await f.t.run(ctx=>ctx.db.get(id)))!;
  await f.t.run(ctx=>ctx.db.patch(board.plateauId,{ownerPlayerId:f.players[2],heldSince:Date.now()+1}));
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
  await f.t.run(ctx=>ctx.db.patch(board.plateauId,{ownerPlayerId:f.players[1],heldSince:Date.now()+2}));
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/Capture this plateau/);
});
test("Favor cap preserves conquest proof and one conquest cannot fulfill another petition",async()=>{
  const f=await setup(),id=await capture(f);vi.setSystemTime(Date.now()+1000);
  const rel=await f.t.run(ctx=>ctx.db.insert("parshendiRelations",{playerId:f.players[1],favor:5,tributeCount:0,tributeWindowAt:Date.now()}));
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id})).rejects.toThrow(/cap/);
  expect((await f.t.run(ctx=>ctx.db.get(id)))?.parshendiPetitionId).toBeUndefined();
  await f.t.run(ctx=>ctx.db.patch(rel,{favor:4}));
  await f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id});
  const other=await f.t.run(async ctx=>{const p=(await ctx.db.get(f.petition.id))!;const {_id,_creationTime,fulfilledBy,fulfilledAt,...rest}=p;await ctx.db.patch(rel,{favor:4});return ctx.db.insert("parshendiPetitions",{...rest,active:true});});
  await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:other})).rejects.toThrow(/Capture this plateau/);
});
test("hourly refill chooses another eligible target after completion; unclaimed targets expire after 24 hours",async()=>{
  const f=await setup(true);await capture(f);vi.setSystemTime(Date.now()+1000);
  await f.player.mutation(api.diplomacy.fulfill,{petitionId:f.petition.id});
  expect((await f.player.query(api.diplomacy.get,{})).petitions.filter(p=>p.kind==="occupation")).toHaveLength(0);
  vi.setSystemTime(Date.now()+3600000);await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  const next=(await f.player.query(api.diplomacy.get,{})).petitions.find(p=>p.kind==="occupation")!;
  expect(next.id).not.toBe(f.petition.id);expect(next.objective).not.toBe(f.petition.objective);
  vi.setSystemTime(next.expiresAt);await expect(f.player.mutation(api.diplomacy.fulfill,{petitionId:next.id})).rejects.toThrow(/expired/);
  await f.t.mutation(internal.diplomacy.refreshPetitions,{});
  expect((await f.t.run(ctx=>ctx.db.get(next.id)))?.active).toBe(false);
});
