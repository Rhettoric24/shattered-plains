/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  emptyBuildings,
  emptyUnits,
  normalizeUnits,
  totalUnits,
  WORLD_KEY,
} from "./rules";
import { ownedUnitsIncludingAway } from "./provisionHelpers";
import { CYCLE_MS, loadBoard } from "./conflictBoardState";
import type { Id } from "./_generated/dataModel";
const modules = import.meta.glob("./**/*.ts");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`conflictBoards:${name}`);
const q = (name: string) =>
  makeFunctionReference<"query">(`conflictBoards:${name}`);
const units = (spearman: number, bridgeman = 0, chull = 0) => ({
  ...emptyUnits(),
  spearman,
  bridgeman,
  chull,
});
let request = 0;
const requestId = () => `test-${++request}`;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T16:00:00Z"));
  vi.stubEnv("CONFLICT_BOARD_V1_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("gameState", {
      key: WORLD_KEY,
      openAcres: 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      highstormOverrideId: "no-storm-until-tomorrow",
      highstormOverrideStartAt: Date.now() + 48 * 3600000,
      highstormOverrideEndAt: Date.now() + 50 * 3600000,
    }),
  );
  const players: {
    id: Id<"players">;
    client: ReturnType<typeof t.withIdentity>;
  }[] = [];
  for (const name of ["Owner", "Blue", "Green"]) {
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: `${name}@test.example` }),
    );
    const id = await t.run((ctx) =>
      ctx.db.insert("players", {
        authUserId: String(userId),
        name,
        normalizedName: name.toLowerCase(),
        acres: 1,
        spheres: 10000,
        gemhearts: 0,
        units: units(2000, 2000, 500),
        buildings: { ...emptyBuildings(), barracks: 5 },
        lastEconomyAt: Date.now(),
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      }),
    );
    players.push({ id, client: t.withIdentity({ subject: String(userId) }) });
  }
  const plateauId = await t.run((ctx) =>
    ctx.db.insert("plateaus", {
      name: "Test Plateau",
      type: "sphere",
      status: "owned",
      ownerPlayerId: players[0].id,
      highground: false,
      neutralDefenseInitial: 0,
      neutralDefenseRemaining: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return {
    t,
    players,
    owner: players[0],
    blue: players[1],
    green: players[2],
    plateauId,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function open(f: Fixture, force = units(100), fabrials: string[] = []) {
  return (await f.blue.client.mutation(m("open"), {
    plateauId: f.plateauId,
    units: force,
    fabrials,
    requestId: requestId(),
  })) as {
    conflictId: Id<"boardConflicts">;
    formationId: string;
    revision: number;
  };
}
async function read(f: Fixture, id: Id<"boardConflicts">) {
  const s = await f.t.run(async (ctx) => {
    const s = await loadBoard(ctx, id);
    return { ...s, times: [...s.times] };
  });
  return { ...s, times: new Map(s.times) };
}
async function cmd(
  f: Fixture,
  id: Id<"boardConflicts">,
  player: Fixture["blue"],
  name: string,
  extra: Record<string, unknown> = {},
) {
  const s = await read(f, id);
  return await player.client.mutation(m(name), {
    conflictId: id,
    revision: s.conflict.revision,
    requestId: requestId(),
    ...extra,
  });
}
async function advanceTo(f: Fixture, id: Id<"boardConflicts">, at: number) {
  vi.setSystemTime(at);
  for (let n = 0; n < 80; n++) {
    const s = await read(f, id);
    if (s.conflict.status === "settled" || s.conflict.nextWakeAt > at) return;
    await f.t.mutation(m("wake"), { conflictId: id });
  }
  throw Error("Scheduler did not converge.");
}
async function nextCycle(f: Fixture, id: Id<"boardConflicts">) {
  await advanceTo(f, id, (await read(f, id)).conflict.nextCycleAt);
}
async function arrive(f: Fixture, id: Id<"boardConflicts">) {
  const s = await read(f, id);
  await advanceTo(f, id, Math.max(...s.times.values()));
}
async function move(
  f: Fixture,
  id: Id<"boardConflicts">,
  player: Fixture["blue"],
  formationId: string,
  route: string[],
) {
  await cmd(f, id, player, "order", {
    formationId,
    kind: "move",
    route,
    onDefeat: "continue",
  });
}

describe("gated authenticated Conflict Board integration", () => {
  test("resolution Spanreeds and alerts are private, paired, and retry safe through withdrawal", async () => {
    const f = await setup(), { conflictId: id } = await open(f);
    await nextCycle(f, id);
    const reports = () => f.t.run(async ctx => ({
      messages: (await ctx.db.query("messages").collect()).filter(m => m.entityId === id && m.subject.includes("resolution report")),
      alerts: (await ctx.db.query("notifications").collect()).filter(n => n.entityId === id && n.title.includes("resolution report")),
    }));
    const first = await reports();
    expect(first.messages).toHaveLength(2);
    expect(first.alerts).toHaveLength(2);
    expect(first.messages.map(m => m.toPlayerId).sort()).toEqual([f.owner.id, f.blue.id].sort());
    expect(first.messages.find(m => m.toPlayerId === f.owner.id)!.body).not.toContain("arrived");
    await f.t.mutation(m("wake"), { conflictId: id });
    expect(await reports()).toEqual(first);
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    const final = await reports();
    expect(final.messages).toHaveLength(4);
    expect(final.messages.filter(m => m.body.includes("Conflict ended:"))).toHaveLength(2);
    await f.t.mutation(m("wake"), { conflictId: id });
    expect(await reports()).toEqual(final);
  });
  test("cargo split preview requires confirmation, preserves ownership and is retry safe", async () => {
    const f=await setup(), {conflictId:id}=await open(f,units(0,10,2));
    await arrive(f,id);
    let s=await read(f,id);
    const carrier=s.forces.find(row=>row.data.kingdom===f.blue.id)!;
    await f.t.run(async ctx=>{
      await ctx.db.patch(carrier._id,{data:{...carrier.data,cargo:50}});
      await ctx.db.patch(id,{state:{...s.conflict.state,treasury:s.state.treasury!-50}});
    });
    const args={conflictId:id,revision:s.conflict.revision,formationId:carrier.formationId,units:units(0,0,2),equipmentIds:[]};
    await expect(f.green.client.query(q("previewSplit"),args)).rejects.toThrow();
    expect(await f.blue.client.query(q("previewSplit"),args)).toEqual({cargo:50,remainingCapacity:10,cargoLost:40});
    await expect(f.blue.client.mutation(m("split"),{...args,requestId:requestId()})).rejects.toThrow("confirm");
    expect((await read(f,id)).state.formations.find(row=>row.id===carrier.formationId)!.cargo).toBe(50);
    const approved={...args,requestId:requestId(),acceptedCargoLoss:40};
    await f.blue.client.mutation(m("split"),approved);
    await f.blue.client.mutation(m("split"),approved);
    s=await read(f,id);
    expect(s.state.cargoLost).toBe(40);
    expect(s.state.formations.find(row=>row.id===carrier.formationId)!.cargo).toBe(10);
    expect(s.state.formations.filter(row=>row.kingdom===f.blue.id).map(row=>row.cargo??0).sort((a,b)=>Number(a)-Number(b))).toEqual([0,10]);
    await expect(f.blue.client.query(q("previewSplit"),args)).rejects.toThrow("changed");
  });
  test("normal-game lobby is authenticated, scoped, and remains usable with the gate off", async () => {
    const f = await setup();
    await expect(f.t.query(q("lobby"), {})).rejects.toThrow();
    const { conflictId: id } = await open(f);
    expect((await f.green.client.query(q("lobby"), {})).conflicts).toEqual([]);
    for (const p of [f.owner, f.blue]) {
      const lobby = await p.client.query(q("lobby"), {});
      expect(lobby.enabled).toBe(true);
      expect(lobby.conflicts.map(c => c.conflictId)).toEqual([id]);
      expect(JSON.stringify(lobby)).not.toContain("units");
    }
    const dto = await f.blue.client.query(q("get"), { conflictId: id });
    expect(dto.conflictId).toBe(id);
    expect(dto.participantStatus).toBe("active");
    expect(dto.commandPostController).toBe(f.owner.id);
    vi.stubEnv("CONFLICT_BOARD_V1_ENABLED", "false");
    expect((await f.blue.client.query(q("lobby"), {})).enabled).toBe(false);
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    expect((await f.blue.client.query(q("lobby"), {})).conflicts[0].status).toBe("settled");
    const accounting = await f.blue.client.query(makeFunctionReference<"query">("players:getPlayerAccounting"), {});
    expect(accounting.ownedUnits.spearman).toBe(2000);
  });
  test("enabled gate prevents an old client from creating a legacy PvP siege", async () => {
    const f = await setup();
    await expect(f.blue.client.mutation(makeFunctionReference<"mutation">("plateaus:launchPlayerSiege"), {
      plateauId: f.plateauId, units: units(10),
    })).rejects.toThrow("Conflict Board");
    expect(await f.t.run(ctx => ctx.db.query("sieges").collect())).toEqual([]);
  });
  test("traveling route orders, authenticated reinforcement and recovery scheduler use normal-game seams", async () => {
    const f = await setup(), { conflictId: id, formationId } = await open(f, units(40));
    await move(f, id, f.blue, formationId, ["B3", "B2", "B1", "post"]);
    await expect(cmd(f, id, f.green, "order", { formationId, kind: "hold", route: [], onDefeat: "continue" })).rejects.toThrow();
    const home = await f.blue.client.query(makeFunctionReference<"query">("players:getPlayerAccounting"), {});
    expect(home.ownedUnits.spearman).toBe(2000);
    const scheduled = await f.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some(row => row.name === "conflictBoards:wake" || row.name === "conflictBoards.js:wake")).toBe(true);
    await arrive(f, id);
    await nextCycle(f, id);
    const dto = await f.blue.client.query(q("get"), { conflictId: id });
    expect(dto.view.own[0].formation.position).not.toBe("approach");
    expect(dto.view.own[0].formation.order.route.length).toBeLessThan(4);
  });
  test("return and re-entry cannot bank cargo or equipment twice", async () => {
    const f = await setup(), { conflictId: id } = await open(f);
    await cmd(f,id,f.green,"reinforce",{units:units(20),fabrials:[]});
    await cmd(f,id,f.blue,"withdraw"); await nextCycle(f,id);
    await cmd(f,id,f.blue,"reinforce",{units:units(50),fabrials:[]});
    const again=await read(f,id);
    expect(again.participants.find(p=>p.playerId===f.blue.id)?.status).toBe("active");
    expect((await f.t.run(ctx=>ctx.db.get(f.blue.id)))!.units.spearman).toBe(1950);
    await cmd(f,id,f.blue,"withdraw"); await cmd(f,id,f.green,"withdraw");
    const at=(await read(f,id)).conflict.nextCycleAt;
    vi.setSystemTime(at);
    await Promise.all([f.t.mutation(m("wake"),{conflictId:id}),f.t.mutation(m("wake"),{conflictId:id})]);
    await advanceTo(f,id,at);
    expect((await read(f,id)).conflict.status).toBe("settled");
    for (const p of f.players) expect((await f.t.run(ctx=>ctx.db.get(p.id)))!.units.spearman).toBe(2000);
  });
  test("off by default; authenticated actor, real troop checks, atomic rollback", async () => {
    const f = await setup();
    vi.stubEnv("CONFLICT_BOARD_V1_ENABLED", "");
    await expect(open(f)).rejects.toThrow("not enabled");
    vi.stubEnv("CONFLICT_BOARD_V1_ENABLED", "true");
    await expect(
      f.t.mutation(m("open"), {
        plateauId: f.plateauId,
        units: units(10),
        fabrials: [],
        requestId: requestId(),
      }),
    ).rejects.toThrow("Sign in");
    await expect(open(f, units(99999))).rejects.toThrow("Not enough");
    expect(
      await f.t.run((ctx) => ctx.db.query("boardConflicts").collect()),
    ).toEqual([]);
    expect((await f.t.run((ctx) => ctx.db.get(f.owner.id)))!.spheres).toBe(
      10000,
    );
    await expect(open(f, units(1.5))).rejects.toThrow("whole numbers");
  });
  test("open retry, join, commitment, reinforcement provisions, private commands", async () => {
    const f = await setup(),
      key = requestId();
    const args = {
      plateauId: f.plateauId,
      units: units(100),
      fabrials: [],
      requestId: key,
    };
    const opened = await f.blue.client.mutation(m("open"), args);
    expect(await f.blue.client.mutation(m("open"), args)).toEqual(opened);
    const { conflictId: id, formationId } = opened;
    expect((await f.t.run((ctx) => ctx.db.get(f.owner.id)))!.spheres).toBe(
      9000,
    );
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.blue.id)))!.units.spearman,
    ).toBe(1900);
    expect(
      (
        await f.t.run(async (ctx) =>
          ownedUnitsIncludingAway(
            ctx,
            f.blue.id,
            normalizeUnits((await ctx.db.get(f.blue.id))!.units),
          ),
        )
      ).spearman,
    ).toBe(2000);
    await expect(
      f.green.client.query(q("get"), { conflictId: id }),
    ).rejects.toThrow("Join");
    await cmd(f, id, f.green, "reinforce", { units: units(1), fabrials: [] });
    await arrive(f, id);
    await expect(
      cmd(f, id, f.green, "order", {
        formationId,
        kind: "hold",
        route: [],
        onDefeat: "pause",
      }),
    ).rejects.toThrow("own");
    const s = await read(f, id),
      rid = requestId();
    const order = {
      conflictId: id,
      revision: s.conflict.revision,
      requestId: rid,
      formationId,
      kind: "move",
      route: ["B3"],
      onDefeat: "continue",
    };
    const response = await f.blue.client.mutation(m("order"), order);
    expect(await f.blue.client.mutation(m("order"), order)).toEqual(response);
    await expect(
      f.blue.client.mutation(m("order"), { ...order, route: ["A3"] }),
    ).rejects.toThrow("already used");
    await expect(
      f.blue.client.mutation(m("order"), { ...order, requestId: requestId() }),
    ).rejects.toThrow("Refresh");
  });
  test("conquest returns every army, closes reservations, scores only once and unlocks plateau", async () => {
    const f = await setup(),
      { conflictId: id, formationId } = await open(f);
    await arrive(f, id);
    await move(f, id, f.blue, formationId, ["B3", "B2", "B1", "post"]);
    for (
      let i = 0;
      i < 6 && (await read(f, id)).conflict.status === "active";
      i++
    )
      await nextCycle(f, id);
    const s = await read(f, id);
    expect(s.conflict).toMatchObject({
      status: "settled",
      winnerId: f.blue.id,
      outcome: "conquest",
    });
    expect(s.forces).toHaveLength(0);
    expect(
      s.participants.every(
        (p) => p.status === "returned" && totalUnits(p.units) === 0,
      ),
    ).toBe(true);
    const before = await f.t.run(async (ctx) => ({
      players: await ctx.db.query("players").collect(),
      scores: await ctx.db.query("seasonScoreEvents").collect(),
    }));
    await f.t.mutation(m("wake"), { conflictId: id });
    const after = await f.t.run(async (ctx) => ({
      players: await ctx.db.query("players").collect(),
      scores: await ctx.db.query("seasonScoreEvents").collect(),
    }));
    expect(after).toEqual(before);
    const plateau = await f.t.run((ctx) => ctx.db.get(f.plateauId));
    expect(plateau?.ownerPlayerId).toBe(f.blue.id);
    expect(plateau?.activeConflictBoardId).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.blue.id)))!.units.spearman,
    ).toBe(2000);
    expect((await f.t.run((ctx) => ctx.db.get(f.owner.id)))!.spheres).toBe(
      10000,
    );
    const again = await f.green.client.mutation(m("open"), {
      plateauId: f.plateauId,
      units: units(1),
      fabrials: [],
      requestId: requestId(),
    });
    expect(again.conflictId).not.toBe(id);
  });
  test("owner withdrawal does not end three-kingdom conflict; last outsider withdrawal does", async () => {
    const f = await setup(),
      { conflictId: id } = await open(f);
    await cmd(f, id, f.green, "reinforce", { units: units(20), fabrials: [] });
    await cmd(f, id, f.owner, "withdraw");
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    expect((await read(f, id)).conflict.status).toBe("active");
    expect((await read(f, id)).state.objective.controller).toBeNull();
    await cmd(f, id, f.green, "withdraw");
    vi.stubEnv("CONFLICT_BOARD_V1_ENABLED", ""); // kill switch must not strand assets
    await nextCycle(f, id);
    expect((await read(f, id)).conflict.status).toBe("settled");
    for (const p of f.players)
      expect((await f.t.run((ctx) => ctx.db.get(p.id)))!.units.spearman).toBe(
        2000,
      );
  });
  test("deadline settles unattended staging and pending late reinforcements", async () => {
    const f = await setup(),
      { conflictId: id } = await open(f);
    const deadline = (await read(f, id)).conflict.deadlineAt;
    await advanceTo(f, id, deadline);
    const s = await read(f, id);
    expect(s.conflict.status).toBe("settled");
    expect(s.conflict.winnerId).toBe(f.owner.id);
    expect(s.state.arrivals).toHaveLength(0);
    expect(s.forces).toHaveLength(0);
  });
  test("split, pending equipment, merge, transit reinforcement and return conserve physical assets", async () => {
    const f = await setup();
    await f.t.run((ctx) =>
      ctx.db.insert("playerFabrials", {
        playerId: f.blue.id,
        kind: "halfShard",
        owned: 3,
        committed: 0,
        discoveredAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const { conflictId: id, formationId } = await open(f, units(100), [
      "halfShard",
      "halfShard",
    ]);
    await arrive(f, id);
    const items = (await read(f, id)).state.formations[0].equipment!.items;
    await cmd(f, id, f.blue, "switchFabrial", {
      formationId,
      itemId: items[1].id,
    });
    await cmd(f, id, f.blue, "split", {
      formationId,
      units: units(40),
      equipmentIds: [items[1].id],
    });
    const split = await read(f, id);
    expect(split.state.formations).toHaveLength(2);
    expect(
      split.state.formations.find((f) => f.id !== formationId)?.equipment
        ?.pending?.id,
    ).toBe(items[1].id);
    await cmd(f, id, f.blue, "reinforce", {
      units: units(20),
      fabrials: ["halfShard"],
    });
    await nextCycle(f, id);
    await nextCycle(f, id);
    expect((await read(f, id)).state.formations).toHaveLength(1);
    expect(
      (await read(f, id)).state.formations[0].equipment?.items,
    ).toHaveLength(3);
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    const equipment = await f.t.run((ctx) =>
      ctx.db.query("boardEquipment").collect(),
    );
    expect(equipment.every((e) => e.status === "returned")).toBe(true);
    expect(
      await f.t.run((ctx) => ctx.db.query("playerFabrials").first()),
    ).toMatchObject({ owned: 3, committed: 0 });
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.blue.id)))!.units.spearman,
    ).toBe(2000);
  });
  test("real raid escrow, repeated extraction and end cargo payout conserve Spheres", async () => {
    const f = await setup(),
      { conflictId: id, formationId } = await open(f, units(100, 0, 10));
    await arrive(f, id);
    await move(f, id, f.blue, formationId, ["A3", "A2", "A1"]);
    for (let n = 0; n < 3; n++) await nextCycle(f, id);
    await cmd(f, id, f.blue, "order", {
      formationId,
      kind: "raid",
      route: [],
      onDefeat: "continue",
    });
    await nextCycle(f, id);
    await nextCycle(f, id);
    const raiding = await read(f, id);
    expect(raiding.state.treasury).toBe(800);
    expect(raiding.state.formations[0].cargo).toBe(200);
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    const owner = await f.t.run((ctx) => ctx.db.get(f.owner.id)),
      blue = await f.t.run((ctx) => ctx.db.get(f.blue.id));
    expect(owner!.spheres).toBe(9800);
    expect(blue!.spheres).toBe(10200);
    expect(owner!.spheres + blue!.spheres).toBe(20000);
  });
  test("server fog payload omits enemy exact data and hidden location", async () => {
    const f = await setup(),
      { conflictId: id } = await open(f);
    await cmd(f, id, f.owner, "reinforce", {
      units: units(42, 7),
      fabrials: [],
    });
    await arrive(f, id);
    const low = await f.blue.client.query(q("get"), { conflictId: id });
    expect(low.view.contacts).toEqual([]);
    const resource = await f.t.run((ctx) =>
      ctx.db.insert("kingdomIntelResources", {
        viewerPlayerId: f.blue.id,
        targetPlayerId: f.owner.id,
        amount: 100,
        militaryAmount: 100,
        updatedAt: Date.now(),
      }),
    );
    const high = await f.blue.client.query(q("get"), { conflictId: id });
    expect(high.view.contacts).toHaveLength(1);
    expect(Object.keys(high.view.contacts[0]).sort()).toEqual([
      "kingdom",
      "level",
      "physicallyVisible",
      "position",
      "power",
    ]);
    expect(high.view.contacts[0].level).toBe(2);
    expect(JSON.stringify(high)).not.toContain('"spearman":42');
    await f.t.run((ctx) => ctx.db.patch(resource, { militaryAmount: 0 }));
    expect(
      (await f.blue.client.query(q("get"), { conflictId: id })).view.contacts,
    ).toEqual([]);
  });
  test("storm start is authoritative and retry-safe, including split histories", async () => {
    const f = await setup(),
      { conflictId: id, formationId } = await open(f, units(0, 100));
    await arrive(f, id);
    const start = Date.now() + 1000;
    await f.t.run(async (ctx) => {
      const w = (await ctx.db.query("gameState").first())!;
      await ctx.db.patch(w._id, {
        highstormOverrideStartAt: start,
        highstormOverrideEndAt: start + CYCLE_MS,
        highstormOverrideId: "storm-test",
      });
      await ctx.db.patch(id, { weatherAt: start, nextWakeAt: start });
    });
    await advanceTo(f, id, start);
    const hit = await read(f, id),
      count = totalUnits(hit.state.formations[0].units);
    expect(count).toBeLessThan(100);
    const stormReports = () => f.t.run(async ctx => (await ctx.db.query("messages").collect()).filter(m => m.subject.startsWith("Highstorm —")));
    const stormMessages = await stormReports();
    expect(stormMessages).toHaveLength(1);
    expect(stormMessages[0].toPlayerId).toBe(f.blue.id);
    expect(stormMessages[0].body).toContain(`${100-count} Bridgemen`);
    expect(stormMessages[0].body).toContain(hit.state.formations[0].name);
    await f.t.mutation(m("wake"), { conflictId: id });
    expect(await stormReports()).toEqual(stormMessages);
    expect(totalUnits((await read(f, id)).state.formations[0].units)).toBe(
      count,
    );
    await cmd(f, id, f.blue, "split", {
      formationId,
      units: units(0, 10),
      equipmentIds: [],
    });
    await nextCycle(f, id);
    expect(totalUnits((await read(f, id)).state.formations[0].units)).toBe(
      count,
    );
    await f.t.run(async (ctx) => {
      const w = (await ctx.db.query("gameState").first())!;
      await ctx.db.patch(w._id, {
        highstormOverrideStartAt: Date.now() + 48 * 3600000,
        highstormOverrideEndAt: Date.now() + 50 * 3600000,
        highstormOverrideId: "next-storm",
      });
    });
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.blue.id)))!.units.bridgeman,
    ).toBe(1900 + count);
  });
  test("traveling standing orders participate in opening deployment; exact-boundary orders lock", async () => {
    const f = await setup(),
      { conflictId: id, formationId } = await open(f);
    await move(f, id, f.blue, formationId, ["B3", "B2", "B1", "post"]);
    const at = (await read(f, id)).conflict.nextCycleAt;
    vi.setSystemTime(at);
    await expect(
      cmd(f, id, f.blue, "order", {
        formationId,
        kind: "hold",
        route: [],
        onDefeat: "pause",
      }),
    ).rejects.toThrow("processing");
    await advanceTo(f, id, at);
    expect((await read(f, id)).state.formations[0].position).toBe("B3");
    const before = await read(f, id);
    await f.t.mutation(m("wake"), { conflictId: id });
    expect((await read(f, id)).state).toEqual(before.state);
  });
  test("automatic defense fights; survivor/casualty accounting and reusable losses reconcile", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("playerSettings", {
        playerId: f.owner.id,
        confirmConsequentialMissions: true,
        autoDefenseEnabled: true,
        autoDefensePrimary: units(1000),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("playerFabrials", {
        playerId: f.blue.id,
        kind: "halfShard",
        owned: 1,
        committed: 0,
        discoveredAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { conflictId: id, formationId } = await open(f, units(5), [
      "halfShard",
    ]);
    await move(f, id, f.blue, formationId, ["B3", "B2", "B1", "post"]);
    for (let n = 0; n < 4; n++) await nextCycle(f, id);
    const fighting = await read(f, id);
    const attacker = fighting.participants.find(
      (p) => p.playerId === f.blue.id,
    )!;
    expect(totalUnits(attacker.units)).toBeLessThan(5);
    await cmd(f, id, f.blue, "withdraw");
    await nextCycle(f, id);
    const final = await read(f, id);
    expect(final.conflict.winnerId).toBe(f.owner.id);
    const cycles = await f.t.run((ctx) =>
      ctx.db.query("boardCycles").collect(),
    );
    for (const p of [f.blue, f.owner]) {
      const losses = cycles
        .flatMap((c) => c.events)
        .filter((e) => e.type === "battle")
        .flatMap((e) => e.forces)
        .filter((force) => force.kingdom === p.id)
        .reduce((n, force) => n + force.casualties.spearman, 0);
      expect(
        (await f.t.run((ctx) => ctx.db.get(p.id)))!.units.spearman + losses,
      ).toBe(2000);
    }
    const item = final.equipment[0],
      inv = await f.t.run((ctx) => ctx.db.query("playerFabrials").first());
    expect(inv!.committed).toBe(0);
    expect(inv!.owned).toBe(item.status === "lost" ? 0 : 1);
  });
  test("third-party raid interception preserves every Sphere through capacity overflow and settlement", async () => {
    const f = await setup(),
      { conflictId: id, formationId } = await open(f, units(100, 0, 10));
    await cmd(f, id, f.green, "reinforce", {
      units: units(1000),
      fabrials: [],
    });
    await arrive(f, id);
    await move(f, id, f.blue, formationId, ["A3", "A2", "A1"]);
    for (let n = 0; n < 3; n++) await nextCycle(f, id);
    await cmd(f, id, f.blue, "order", {
      formationId,
      kind: "raid",
      route: [],
      onDefeat: "continue",
    });
    await nextCycle(f, id);
    const green = (await read(f, id)).state.formations.find(
      (fm) => fm.kingdom === f.green.id,
    )!;
    await move(f, id, f.green, green.id, ["A3", "A2", "A1"]);
    for (let n = 0; n < 3; n++) await nextCycle(f, id);
    const intercepted = await read(f, id);
    expect(
      intercepted.state.formations.find((fm) => fm.kingdom === f.green.id)!
        .cargo,
    ).toBeGreaterThan(0);
    await cmd(f, id, f.blue, "withdraw");
    await cmd(f, id, f.green, "withdraw");
    await nextCycle(f, id);
    const settled = await read(f, id);
    const spheres = await f.t.run(async (ctx) =>
      (await ctx.db.query("players").collect()).reduce(
        (n, p) => n + p.spheres,
        0,
      ),
    );
    expect(spheres + (settled.state.cargoDestroyed ?? 0)).toBe(30000);
    expect(settled.state.cargoLost ?? 0).toBe(0);
    expect(settled.state.treasury).toBe(0);
    expect(settled.forces).toHaveLength(0);
  });
  test("one pending deadline hold completes; a failed hold cannot extend again", async () => {
    for (const success of [true, false]) {
      const f = await setup(),
        { conflictId: id } = await open(f);
      await arrive(f, id);
      const s = await read(f, id);
      await f.t.run(async (ctx) => {
        await ctx.db.patch(s.forces[0]._id, {
          data: { ...s.forces[0].data, position: "post", history: ["post"] },
        });
        await ctx.db.patch(id, {
          nextCycleAt: s.conflict.deadlineAt,
          nextWakeAt: s.conflict.deadlineAt,
          state: {
            ...s.conflict.state,
            cycle: 11,
            objective: {
              controller: f.blue.id,
              hold: { kingdom: f.blue.id, beganCycle: 11 },
            },
          },
        });
      });
      if (!success) await cmd(f, id, f.blue, "withdraw");
      await advanceTo(f, id, s.conflict.deadlineAt);
      const result = await read(f, id);
      expect(result.conflict.status).toBe("settled");
      expect(result.conflict.winnerId).toBe(success ? f.blue.id : f.owner.id);
      expect(result.state.arrivals).toHaveLength(0);
    }
  });
  test("deadline returns a formation still in transit and administrative ownership changes do not overwrite the new owner", async () => {
    const f = await setup(),
      { conflictId: id } = await open(f);
    const s = await read(f, id);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(s.forces[0]._id, {
        arriveAt: s.conflict.deadlineAt + CYCLE_MS,
      });
      await ctx.db.patch(f.plateauId, { ownerPlayerId: f.green.id });
    });
    await advanceTo(f, id, s.conflict.deadlineAt);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.plateauId)))?.ownerPlayerId,
    ).toBe(f.green.id);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.blue.id)))!.units.spearman,
    ).toBe(2000);
    expect((await read(f, id)).conflict.outcome).toContain("cancelled");
  });
  test("legacy siege cannot overlap, while another outside kingdom can enter the same board", async () => {
    const f = await setup(),
      { conflictId: id } = await open(f, units(1));
    await expect(
      f.green.client.mutation(
        makeFunctionReference<"mutation">("plateaus:launchPlayerSiege"),
        { plateauId: f.plateauId, units: units(20) },
      ),
    ).rejects.toThrow();
    await cmd(f, id, f.green, "reinforce", { units: units(20), fabrials: [] });
    expect((await read(f, id)).participants).toHaveLength(3);
  });
  test("a forecast storm is not marked ended; delayed scheduler catches the actual exposure once", async () => {
    const f = await setup(),
      start = Date.now() + CYCLE_MS / 2;
    await f.t.run(async (ctx) => {
      const w = (await ctx.db.query("gameState").first())!;
      await ctx.db.patch(w._id, {
        highstormOverrideStartAt: start,
        highstormOverrideEndAt: start + CYCLE_MS,
        highstormOverrideId: "forecast-same-id",
      });
    });
    const { conflictId: id } = await open(f, units(0, 100));
    expect((await read(f, id)).state.endedHighstormIds ?? []).not.toContain(
      "forecast-same-id",
    );
    await advanceTo(f, id, start + CYCLE_MS / 2);
    const events = await f.t.run((ctx) =>
      ctx.db.query("boardCycles").collect(),
    );
    expect(
      events
        .flatMap((c) => c.events)
        .filter(
          (e) => e.type === "highstorm" && e.stormId === "forecast-same-id",
        ),
    ).toHaveLength(1);
  });
});
