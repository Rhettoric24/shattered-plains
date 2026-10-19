/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { emptyUnits, emptyBuildings } from "./rules";
import { relations } from "./diplomacyHelpers";
import { DIPLOMACY } from "./diplomacyRules";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });
async function setup(spheres = 100000, gemhearts = 10) {
  const t = convexTest(schema, modules);
  const ids = [];
  for (const name of ["one", "two"]) ids.push(await t.run(ctx => ctx.db.insert("players", { authUserId: name, name, normalizedName: name, acres: 0, spheres, gemhearts, units: emptyUnits(), buildings: emptyBuildings(), lastEconomyAt: Date.now(), lastActiveAt: Date.now(), createdAt: Date.now() })));
  return { t, id: ids[0], other: ids[1], player: t.withIdentity({ subject: "one" }), rival: t.withIdentity({ subject: "two" }) };
}
test("tribute atomically consumes both costs, grants one Favor and credits the shared reserve once", async () => {
  const f = await setup();
  await f.player.mutation(api.diplomacy.tribute, { requestId: "same" });
  await f.player.mutation(api.diplomacy.tribute, { requestId: "same" });
  const d = await f.player.query(api.diplomacy.get, {});
  expect(d).toMatchObject({ favor: 1, reserveGemhearts: 1, tribute: { hostilityReduction: 6 } });
  expect(await f.t.run(ctx => ctx.db.get(f.id))).toMatchObject({ spheres: 90000, gemhearts: 9 });
});
test.each([[9999, 1], [10000, 0]])("missing either tribute resource changes nothing (%i Spheres / %i Gemhearts)", async (spheres, gemhearts) => {
  const f = await setup(spheres, gemhearts);
  await expect(f.player.mutation(api.diplomacy.tribute, { requestId: "fail" })).rejects.toThrow(/both/);
  expect(await f.player.query(api.diplomacy.get, {})).toMatchObject({ favor: 0, reserveGemhearts: 0 });
  expect(await f.t.run(ctx => ctx.db.get(f.id))).toMatchObject({ spheres, gemhearts });
});
test("Favor cap rejects resource consumption; repeated concurrent tribute cannot exceed five", async () => {
  const f = await setup();
  for (let i = 0; i < 4; i++) await f.player.mutation(api.diplomacy.tribute, { requestId: `t${i}` });
  const outcomes = await Promise.allSettled(["a", "b"].map(requestId => f.player.mutation(api.diplomacy.tribute, { requestId })));
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await f.player.query(api.diplomacy.get, {})).toMatchObject({ favor: 5, reserveGemhearts: 5 });
  const before = await f.t.run(ctx => ctx.db.get(f.id));
  await expect(f.player.mutation(api.diplomacy.tribute, { requestId: "cap" })).rejects.toThrow(/cap/);
  expect(await f.t.run(ctx => ctx.db.get(f.id))).toEqual(before);
});
test("diminishing Hostility reduction resets after 24 hours without increasing tribute cost", async () => {
  const f = await setup();
  await f.t.run(ctx => ctx.db.insert("kingdomWorldPressure", { playerId: f.id, hostility: 60, decayIntervalsApplied: 0, updatedAt: Date.now() }));
  await f.player.mutation(api.diplomacy.tribute, { requestId: "1" });
  await f.player.mutation(api.diplomacy.tribute, { requestId: "2" });
  expect((await f.player.query(api.diplomacy.get, {})).hostility).toBe(42);
  vi.setSystemTime(Date.now() + DIPLOMACY.tributeWindowMs);
  expect((await f.player.query(api.diplomacy.get, {})).tribute).toMatchObject({ spheres: 10000, gemhearts: 1, hostilityReduction: 12 });
});
test("hourly evaluation creates three durable shared slots and expires/refills them", async () => {
  const f = await setup();
  await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  const first = await f.player.query(api.diplomacy.get, {});
  expect(first.petitions).toHaveLength(3);
  expect((await f.rival.query(api.diplomacy.get, {})).petitions.map(p => p.id)).toEqual(first.petitions.map(p => p.id));
  await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  expect((await f.player.query(api.diplomacy.get, {})).petitions.map(p => p.id)).toEqual(first.petitions.map(p => p.id));
  vi.setSystemTime(Date.now() + DIPLOMACY.petitionDurationMs);
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: first.petitions[0].id })).rejects.toThrow(/expired/);
  await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  expect((await f.player.query(api.diplomacy.get, {})).petitions.map(p => p.id)).not.toEqual(first.petitions.map(p => p.id));
});
test("shared claims are first-come-first-served and retries cannot duplicate rewards", async () => {
  const f = await setup(); await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  const petitionId = (await f.player.query(api.diplomacy.get, {})).petitions[0].id;
  const results = await Promise.allSettled([f.player, f.rival].map(c => c.mutation(api.diplomacy.fulfill, { petitionId })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((await f.player.query(api.diplomacy.get, {})).favor + (await f.rival.query(api.diplomacy.get, {})).favor).toBe(1);
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId })).rejects.toThrow(/expired|fulfilled/);
  expect((await f.player.query(api.diplomacy.get, {})).petitions).toHaveLength(2);
});
test("petitions at Favor cap stay unclaimed and preserve the objective", async () => {
  const f = await setup(); await f.t.mutation(internal.diplomacy.refreshPetitions, {});
  await f.t.run(ctx => ctx.db.insert("parshendiRelations", { playerId: f.id, favor: 5, tributeCount: 0, tributeWindowAt: Date.now() }));
  const p = (await f.player.query(api.diplomacy.get, {})).petitions[0];
  expect(p.missing).toContain("cap");
  await expect(f.player.mutation(api.diplomacy.fulfill, { petitionId: p.id })).rejects.toThrow(/cap/);
  expect(await f.t.run(ctx => ctx.db.get(p.id))).toMatchObject({ active: true });
});
test("Donate Plateau validates current ownership, rejects conflict, and applies neutral reclamation rules", async () => {
  const f = await setup();
  const plateauId = await f.t.run(ctx => ctx.db.insert("plateaus", { name: "Recent", type: "gemheart", status: "owned", ownerPlayerId: f.id, origin: "neutral", highground: false, neutralDefenseInitial: 100, neutralDefenseRemaining: 0, heldSince: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }));
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
