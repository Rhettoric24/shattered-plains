import { describe, expect, test, vi } from "vitest";
import { createSessionQueryCache, projectGameClock, routeNeedsChronicle } from "./data-loading-state.js";

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
});
