/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0 };

async function addAccount(t: ReturnType<typeof convexTest>, email: string, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    const playerId = await ctx.db.insert("players", {
      authUserId: String(userId), name, normalizedName: name.toLowerCase(), acres: 20,
      spheres: 1000, gemhearts: 0, units, buildings, lastActiveAt: 1, createdAt: 1,
    });
    return { userId, playerId };
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("playtest feedback", () => {
  test("stores player and browser context and restricts the report list to admins", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    const t = convexTest(schema, modules);
    const reporter = await addAccount(t, "reporter@example.com", "Bridge Four");
    const admin = await addAccount(t, "admin@example.com", "Rhett");

    await t.withIdentity({ subject: String(reporter.userId) }).mutation(api.playtestFeedback.submit, {
      message: "  The siege timer disappeared.  ",
      routeView: "plains",
      routeTab: "sieges",
      buildIdentifier: "abc1234",
      viewportWidth: 390,
      viewportHeight: 844,
    });

    await expect(t.withIdentity({ subject: String(reporter.userId) }).query(api.playtestFeedback.listRecent, {}))
      .rejects.toThrow("Admin access required");
    const reports = await t.withIdentity({ subject: String(admin.userId) }).query(api.playtestFeedback.listRecent, {});
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      playerId: reporter.playerId,
      playerName: "Bridge Four",
      message: "The siege timer disappeared.",
      routeView: "plains",
      routeTab: "sieges",
      buildIdentifier: "abc1234",
      viewportWidth: 390,
      viewportHeight: 844,
    });
  });

  test("rejects empty and oversized reports", async () => {
    const t = convexTest(schema, modules);
    const reporter = await addAccount(t, "reporter@example.com", "Bridge Four");
    const client = t.withIdentity({ subject: String(reporter.userId) });
    const context = { routeView: "home", buildIdentifier: "dev", viewportWidth: 390, viewportHeight: 844 };
    await expect(client.mutation(api.playtestFeedback.submit, { ...context, message: "  " }))
      .rejects.toThrow("at least 3 characters");
    await expect(client.mutation(api.playtestFeedback.submit, { ...context, message: "x".repeat(2001) }))
      .rejects.toThrow("2,000 characters");
  });
});
