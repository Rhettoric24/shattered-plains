import { describe, expect, test, vi } from "vitest";
import { createSessionQueryCache, createSubscriptionLifecycle, projectGameClock, routeNeedsChronicle, SAFETY_RECONCILIATION_MS } from "./data-loading-state.js";

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

  test("loads Chronicle history only for its destination route", () => {
    expect(routeNeedsChronicle({ view: "home" })).toBe(false);
    expect(routeNeedsChronicle({ view: "chronicle" })).toBe(true);
  });

  test("fallback reconciliation is substantially slower than the former 30-second cycle", () => {
    expect(SAFETY_RECONCILIATION_MS).toBe(300_000);
    expect(SAFETY_RECONCILIATION_MS).toBeGreaterThan(30_000);
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
    lifecycle.sync([{ key: "dashboard", query: "players:getDashboard" }, { key: "dashboard", query: "players:getDashboard" }]);
    lifecycle.sync([{ key: "dashboard", query: "players:getDashboard" }]);
    expect(clients[0].onUpdate).toHaveBeenCalledTimes(1);
    expect(lifecycle.size).toBe(1);
    expect(lifecycle.start("session-b", async () => "other-token")).toBe(true);
    await Promise.resolve();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    await lifecycle.dispose();
    expect(clients[1].close).toHaveBeenCalledTimes(1);
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
      { key: "dashboard", query: "players:getDashboard" },
      { key: "notifications", query: "notifications:list" },
    ]);
    callbacks.get("players:getDashboard")({ player: { name: "Kaladin" } });
    callbacks.get("notifications:list")({ unreadCount: 1 });
    await vi.advanceTimersByTimeAsync(25);
    expect(batches).toHaveLength(1);
    expect([...batches[0].keys()]).toEqual(["dashboard", "notifications"]);
    await lifecycle.dispose();
    vi.useRealTimers();
  });
});
