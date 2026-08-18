/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { awardSeasonPoints, createFreshSeason, initializeSeasonBaseline, observePlateauOwnership, recordOpponentAttack, unlockAchievement } from "./seasonLedger";
import { chainMultiplier, SEASON_SCORING_RULES } from "./seasonScoringRules";

const modules = import.meta.glob("./**/*.ts");
const units = { bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 };
const buildings = { market: 0, watchtower: 0, ardentMonastery: 0, barracks: 0, soulcastBunker: 0 };

async function addPlayer(t: ReturnType<typeof convexTest>, name: string, authUserId?: string) {
  return await t.run(async (ctx) => await ctx.db.insert("players", {
    ...(authUserId ? { authUserId } : {}), name, normalizedName: name.toLowerCase(), acres: 20,
    spheres: 1000, gemhearts: 1, units, buildings, lastActiveAt: 1, createdAt: 1,
  }));
}

describe("season scoring", () => {
  test("central rules retain a meaningful but bounded siege chain penalty", () => {
    expect([1, 2, 3, 4, 9].map(chainMultiplier)).toEqual([1, 0.85, 0.7, 0.5, 0.5]);
    expect(SEASON_SCORING_RULES.opponentChains.resetAfterMs).toBe(24 * 60 * 60 * 1000);
  });

  test("score source keys are idempotent and aggregates stay exact", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Kholin");
    await t.run(async (ctx) => await createFreshSeason(ctx, 1, 1));
    const first = await t.run((ctx) => awardSeasonPoints(ctx, { playerId, category: "military", sourceType: "test", sourceKey: "same", basePoints: 5, description: "Test victory", now: 2 }));
    const duplicate = await t.run((ctx) => awardSeasonPoints(ctx, { playerId, category: "military", sourceType: "test", sourceKey: "same", basePoints: 5, description: "Test victory", now: 3 }));
    const result = await t.run(async (ctx) => ({
      scores: await ctx.db.query("seasonScores").collect(),
      events: await ctx.db.query("seasonScoreEvents").collect(),
    }));
    expect(first.awarded).toBe(true);
    expect(duplicate.awarded).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.scores[0]).toMatchObject({ total: 5, categoryTotals: { military: 5, research: 0, economy: 0, territory: 0 } });
  });

  test("opponent chains share siege attempts and reset after 24 quiet hours", async () => {
    const t = convexTest(schema, modules);
    const attackerId = await addPlayer(t, "Alethi");
    const opponentId = await addPlayer(t, "Veden");
    await t.run(async (ctx) => await createFreshSeason(ctx, 1, 1));
    const first = await t.run((ctx) => recordOpponentAttack(ctx, attackerId, opponentId, 100));
    const second = await t.run((ctx) => recordOpponentAttack(ctx, attackerId, opponentId, 200));
    const reset = await t.run((ctx) => recordOpponentAttack(ctx, attackerId, opponentId, 200 + 24 * 60 * 60 * 1000));
    expect([first.chainPosition, second.chainPosition, reset.chainPosition]).toEqual([1, 2, 1]);
  });

  test("achievements and their bonus events unlock once", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Thaylen");
    const seasonId = await t.run(async (ctx) => await createFreshSeason(ctx, 1, 1));
    await t.run((ctx) => unlockAchievement(ctx, { seasonId, playerId, key: "holdTheLine", now: 2 }));
    await t.run((ctx) => unlockAchievement(ctx, { seasonId, playerId, key: "holdTheLine", now: 3 }));
    const result = await t.run(async (ctx) => ({ achievements: await ctx.db.query("seasonAchievements").collect(), events: await ctx.db.query("seasonScoreEvents").collect() }));
    expect(result.achievements).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].points).toBe(5);
  });

  test("successful Parshendi Sphere recovery creates one Military event", async () => {
    const t = convexTest(schema, modules);
    const playerId = await addPlayer(t, "Herdazian");
    const seasonId = await t.run(async (ctx) => await createFreshSeason(ctx, 1, 1));
    const raidUnits = { ...units, spearman: 20, chull: 1 };
    const raidId = await t.run(async (ctx) => await ctx.db.insert("raids", {
      attackerId: playerId, targetType: "parshendi_spheres", units: raidUnits, power: 20, speed: -1,
      defensePower: 5, rewardSpheres: 100, departAt: 1, arriveAt: 2, status: "pending", scoringSeasonId: seasonId,
    }));
    await t.mutation(internal.raids.resolveRaid, { raidId });
    await t.mutation(internal.raids.resolveRaid, { raidId });
    const result = await t.run(async (ctx) => ({ raid: await ctx.db.get(raidId), events: await ctx.db.query("seasonScoreEvents").collect() }));
    expect(result.raid?.spheresRecovered).toBeGreaterThan(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ category: "military", points: 5, sourceType: "parshendi_raid_victory" });
  });

  test("authenticated ledger returns only the current player's totals", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email: "ledger@example.com" }));
    const playerId = await addPlayer(t, "Ledger House", String(userId));
    await addPlayer(t, "Rival House");
    await t.run(async (ctx) => {
      await createFreshSeason(ctx, 1, 1);
      await awardSeasonPoints(ctx, { playerId, category: "economy", sourceType: "test", sourceKey: "market", basePoints: 2, description: "Market upgraded", now: 2 });
    });
    const ledger = await t.withIdentity({ subject: String(userId) }).query(api.seasonLedger.getMine, {});
    expect(ledger.total).toBe(2);
    expect(ledger.categoryTotals.economy).toBe(2);
    expect(ledger.events).toHaveLength(1);
  });

  test("Ancient hold milestones award once for the same ownership epoch", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const heldSince = now - 12 * 60 * 60 * 1000 - 1000;
    const playerId = await addPlayer(t, "Ancient Keeper");
    const seasonId = await t.run(async (ctx) => await createFreshSeason(ctx, 1, heldSince));
    const plateauId = await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Ancient Test", type: "ancient", status: "owned", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 10, neutralDefenseRemaining: 0,
      heldSince, createdAt: heldSince, updatedAt: heldSince,
    }));
    await t.run((ctx) => observePlateauOwnership(ctx, { plateauId, newOwnerId: playerId, heldSince, now: heldSince }));
    await t.mutation(internal.seasonLedger.evaluatePlateauHold, { seasonId, plateauId, playerId, heldSince });
    const scheduledAfterFirst = await t.run(async (ctx) => (await ctx.db.query("seasonPlateauHolds").collect())[0]?.nextEvaluationAt);
    await t.mutation(internal.seasonLedger.evaluatePlateauHold, { seasonId, plateauId, playerId, heldSince });
    const scheduledAfterDuplicate = await t.run(async (ctx) => (await ctx.db.query("seasonPlateauHolds").collect())[0]?.nextEvaluationAt);
    const events = await t.run(async (ctx) => await ctx.db.query("seasonScoreEvents").collect());
    expect(events.map((event) => [event.category, event.points])).toEqual(expect.arrayContaining([["territory", 2], ["research", 3]]));
    expect(events.filter((event) => event.sourceType === "plateau_hold")).toHaveLength(1);
    expect(events.filter((event) => event.sourceType === "ancient_hold")).toHaveLength(1);
    expect(scheduledAfterDuplicate).toBe(scheduledAfterFirst);
  });

  test("every Ancient hold completes its Custodian checkpoint after the kingdom achievement exists", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const heldSince = now - SEASON_SCORING_RULES.ancientCustodianMs - 1000;
    const playerId = await addPlayer(t, "Many Ancient Keeps");
    const seasonId = await t.run(async (ctx) => await createFreshSeason(ctx, 1, heldSince));
    const plateauIds = await t.run(async (ctx) => await Promise.all(["First Ancient", "Second Ancient"].map((name) =>
      ctx.db.insert("plateaus", {
        name, type: "ancient", status: "owned", ownerPlayerId: playerId,
        highground: false, neutralDefenseInitial: 10, neutralDefenseRemaining: 0,
        heldSince, createdAt: heldSince, updatedAt: heldSince,
      }),
    )));
    for (const plateauId of plateauIds) {
      await t.run((ctx) => observePlateauOwnership(ctx, { plateauId, newOwnerId: playerId, heldSince, now: heldSince }));
      await t.mutation(internal.seasonLedger.evaluatePlateauHold, { seasonId, plateauId, playerId, heldSince });
    }
    const result = await t.run(async (ctx) => ({
      achievements: await ctx.db.query("seasonAchievements").collect(),
      holds: await ctx.db.query("seasonPlateauHolds").collect(),
    }));
    expect(result.achievements.filter((achievement) => achievement.key === "ancientCustodian")).toHaveLength(1);
    expect(result.holds).toHaveLength(2);
    expect(result.holds.every((hold) => hold.custodianAwarded)).toBe(true);
  });

  test("existing-world season baseline initialization is idempotent", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const playerId = await addPlayer(t, "Existing Kingdom");
    await t.run(async (ctx) => await ctx.db.insert("plateaus", {
      name: "Existing Plateau", type: "sphere", status: "owned", ownerPlayerId: playerId,
      highground: false, neutralDefenseInitial: 0, neutralDefenseRemaining: 0,
      heldSince: now - 1000, createdAt: now - 1000, updatedAt: now - 1000,
    }));
    const seasonId = await t.run(async (ctx) => await createFreshSeason(ctx, 1, now));
    await t.run(async (ctx) => initializeSeasonBaseline(ctx, (await ctx.db.get(seasonId))!, now));
    await t.run(async (ctx) => initializeSeasonBaseline(ctx, (await ctx.db.get(seasonId))!, now + 1000));
    const rows = await t.run(async (ctx) => ({
      holds: await ctx.db.query("seasonPlateauHolds").collect(),
      claims: await ctx.db.query("seasonPlateauClaims").collect(),
      territory: await ctx.db.query("seasonTerritoryStates").collect(),
    }));
    expect(rows.holds).toHaveLength(1);
    expect(rows.claims).toHaveLength(1);
    expect(rows.territory).toHaveLength(1);
  });
});
