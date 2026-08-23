import { describe, expect, test, vi } from "vitest";
import { createLoadCoordinator, createReconciliationLifecycle, createSessionQueryCache, createSubscriptionLifecycle, playerAccountingInputKey, playerStateSubscription, projectGameClock, projectPlayerSpheres, routeNeedsChronicle, routeNeedsPlateauBoard, routeNeedsTerritoryIntelligence, runMutationAction, SAFETY_RECONCILIATION_MS } from "./data-loading-state.js";

describe("Phase 1 data loading lifecycle", () => {
  test("loads a session-stable value once until the authenticated session changes", async () => {
    const cache = createSessionQueryCache();
    const loader = vi.fn().mockResolvedValue({ enabled: true });
    cache.setSession("session-a");
    await Promise.all([cache.get("admin", loader), cache.get("admin", loader)]);
    await cache.get("admin", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    cache.setSession("session-b");
    await cache.get("admin", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("allows settings to be invalidated after a local change", async () => {
    const cache = createSessionQueryCache();
    const loader = vi.fn().mockResolvedValueOnce({ confirm: true }).mockResolvedValueOnce({ confirm: false });
    cache.setSession("session-a");
    expect(await cache.get("settings", loader)).toEqual({ confirm: true });
    cache.invalidate("settings");
    expect(await cache.get("settings", loader)).toEqual({ confirm: false });
  });

  test("projects the authoritative game clock locally between synchronizations", () => {
    const clock = { elapsedGameDays: 1.5, browserReceivedAt: 1_000 };
    expect(projectGameClock(clock, 3_600_000, 1_000).label).toBe("Day 2, hour 12");
    expect(projectGameClock(clock, 3_600_000, 1_900_000).label).toBe("Day 3, hour 0");
  });

  test("projects authoritative Sphere income locally from a settled reference", () => {
    const player = { spheres: 1200, lastEconomyAt: 1_000, createdAt: 1_000 };
    const accounting = { economy: { incomePerGameDay: 360 } };
    expect(projectPlayerSpheres(player, accounting, 3_600_000, 1_801_000)).toBe(1380);
  });

  test("refreshes accounting only when authoritative accounting inputs change", () => {
    const base = {
      playerSummary: { player: { acres: 20, spheres: 100, gemhearts: 1, units: { bridgeman: 2 }, buildings: { market: 1 }, operatives: {}, defendingOperatives: {}, ardentiaConclaves: 0 } },
      plateaus: { mine: [{ _id: "p1", type: "sphere", status: "owned", large: false, highground: false }] },
      research: { completedLevels: { marketEconomics: 1 }, economicDoctrine: null },
    };
    const key = playerAccountingInputKey(base);
    expect(playerAccountingInputKey({ ...base, playerSummary: { player: { ...base.playerSummary.player, spheres: 500, gemhearts: 9, lastActiveAt: 99 } } })).toBe(key);
    expect(playerAccountingInputKey({ ...base, playerSummary: { player: { ...base.playerSummary.player, units: { bridgeman: 3 } } } })).not.toBe(key);
    expect(playerAccountingInputKey({ ...base, plateaus: { mine: [{ ...base.plateaus.mine[0], large: true }] } })).not.toBe(key);
    expect(playerAccountingInputKey({ ...base, research: { ...base.research, completedLevels: { marketEconomics: 2 } } })).not.toBe(key);
  });

  test("subscribes current clients to the narrow player summary", () => {
    const spec = playerStateSubscription({ getPlayerSummary: "players:getPlayerSummary" });
    expect(spec).toEqual({ key: "playerSummary", query: "players:getPlayerSummary" });
  });

  test("loads Chronicle history only for its destination route", () => {
    expect(routeNeedsChronicle({ view: "home" })).toBe(false);
    expect(routeNeedsChronicle({ view: "chronicle" })).toBe(true);
  });

  test("scopes heavy plateau and territory subscriptions to their destination routes", () => {
    expect(routeNeedsPlateauBoard({ view: "home" })).toBe(false);
    expect(routeNeedsPlateauBoard({ view: "plains", tab: "sieges" })).toBe(true);
    expect(routeNeedsTerritoryIntelligence({ view: "intelligence", tab: "ledger" })).toBe(false);
    expect(routeNeedsTerritoryIntelligence({ view: "intelligence", tab: "territory" })).toBe(true);
  });

  test("fallback reconciliation is substantially slower than the former 30-second cycle", () => {
    expect(SAFETY_RECONCILIATION_MS).toBe(300_000);
    expect(SAFETY_RECONCILIATION_MS).toBeGreaterThan(30_000);
  });

  test("subscription-covered mutations skip a full load unless one is explicitly required", async () => {
    const work = vi.fn().mockResolvedValue({ updated: true });
    const requestFullLoad = vi.fn().mockResolvedValue(undefined);
    expect(await runMutationAction(work, { requestFullLoad })).toEqual({ updated: true });
    expect(requestFullLoad).not.toHaveBeenCalled();
    await runMutationAction(work, { refresh: "full", requestFullLoad });
    expect(requestFullLoad).toHaveBeenCalledTimes(1);
  });

  test("coalesces overlapping full-load requests", async () => {
    let finish;
    const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const coordinator = createLoadCoordinator(load);
    const first = coordinator.request({ reason: "first" });
    const second = coordinator.request({ reason: "second" });
    expect(first).toBe(second);
    expect(coordinator.active).toBe(true);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    finish("done");
    await expect(first).resolves.toBe("done");
    expect(coordinator.active).toBe(false);
  });

  test("subscriptions initialize once, deduplicate, and dispose across sessions", async () => {
    const clients = [];
    const createClient = () => {
      const callbacks = new Map();
      const client = {
        callbacks,
        setAuth: vi.fn(),
        onUpdate: vi.fn((query, _args, callback) => {
          callbacks.set(query, callback);
          return vi.fn(() => callbacks.delete(query));
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      clients.push(client);
      return client;
    };
    const lifecycle = createSubscriptionLifecycle({ createClient, debounceMs: 0 });
    expect(lifecycle.start("session-a", async () => "token")).toBe(true);
    expect(lifecycle.start("session-a", async () => "token")).toBe(false);
    lifecycle.sync([{ key: "playerSummary", query: "players:getPlayerSummary" }, { key: "playerSummary", query: "players:getPlayerSummary" }]);
    lifecycle.sync([{ key: "playerSummary", query: "players:getPlayerSummary" }]);
    expect(clients[0].onUpdate).toHaveBeenCalledTimes(1);
    expect(lifecycle.size).toBe(1);
    expect(lifecycle.start("session-b", async () => "other-token")).toBe(true);
    await Promise.resolve();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    await lifecycle.dispose();
    expect(clients[1].close).toHaveBeenCalledTimes(1);
  });

  test("route changes remove heavy plateau listeners without duplicating global listeners", async () => {
    const unsubscribes = new Map();
    const client = {
      setAuth: vi.fn(),
      onUpdate: vi.fn((query) => {
        const unsubscribe = vi.fn();
        unsubscribes.set(query, unsubscribe);
        return unsubscribe;
      }),
      close: vi.fn(),
    };
    const lifecycle = createSubscriptionLifecycle({ createClient: () => client });
    lifecycle.start("session", async () => "token");
    lifecycle.sync([
      { key: "plateauSummary", query: "plateaus:getMyPlateauState" },
      { key: "plateauBoard", query: "plateaus:getSiegeBoard" },
    ]);
    lifecycle.sync([{ key: "plateauSummary", query: "plateaus:getMyPlateauState" }]);
    expect(unsubscribes.get("plateaus:getSiegeBoard")).toHaveBeenCalledTimes(1);
    expect(unsubscribes.get("plateaus:getMyPlateauState")).not.toHaveBeenCalled();
    expect(client.onUpdate).toHaveBeenCalledTimes(2);
    await lifecycle.dispose();
  });

  test("subscription changes are coalesced into one visible refresh batch", async () => {
    vi.useFakeTimers();
    const callbacks = new Map();
    const batches = [];
    const lifecycle = createSubscriptionLifecycle({
      createClient: () => ({
        setAuth: vi.fn(),
        onUpdate: (query, _args, callback) => { callbacks.set(query, callback); return vi.fn(); },
        close: vi.fn(),
      }),
      debounceMs: 25,
    });
    lifecycle.start("session", async () => "token", { onBatch: (batch) => batches.push(batch) });
    lifecycle.sync([
      { key: "playerSummary", query: "players:getPlayerSummary" },
      { key: "notifications", query: "notifications:list" },
    ]);
    callbacks.get("players:getPlayerSummary")({ player: { name: "Kaladin" } });
    callbacks.get("notifications:list")({ unreadCount: 1 });
    await vi.advanceTimersByTimeAsync(25);
    expect(batches).toHaveLength(1);
    expect([...batches[0].keys()]).toEqual(["playerSummary", "notifications"]);
    await lifecycle.dispose();
    vi.useRealTimers();
  });

  test("pauses safety reconciliation while hidden and reconciles on foreground resume", () => {
    let visible = false;
    let authenticated = true;
    let intervalCallback;
    let visibilityCallback;
    const reconcile = vi.fn();
    const lifecycle = createReconciliationLifecycle({
      reconcile,
      isAuthenticated: () => authenticated,
      isVisible: () => visible,
      setIntervalFn: (callback) => { intervalCallback = callback; return 7; },
      clearIntervalFn: vi.fn(),
      addVisibilityListener: (callback) => { visibilityCallback = callback; },
      removeVisibilityListener: vi.fn(),
    });

    intervalCallback();
    visibilityCallback();
    expect(reconcile).not.toHaveBeenCalled();
    visible = true;
    visibilityCallback();
    expect(reconcile).toHaveBeenCalledWith("foreground-resume");
    intervalCallback();
    expect(reconcile).toHaveBeenLastCalledWith("safety-reconciliation");
    authenticated = false;
    visibilityCallback();
    expect(reconcile).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });
});
