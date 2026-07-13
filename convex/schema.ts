import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const unitCounts = v.object({
  bridgeman: v.number(),
  spearman: v.number(),
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

const buildingLevels = v.object({
  market: v.number(),
  watchtower: v.number(),
  barracks: v.number(),
});

export default defineSchema({
  ...authTables,

  players: defineTable({
    authUserId: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.string(),
    acres: v.number(),
    spheres: v.number(),
    gemhearts: v.number(),
    units: unitCounts,
    buildings: buildingLevels,
    lastEconomyAt: v.optional(v.number()),
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_auth_user", ["authUserId"])
    .index("by_name", ["name"])
    .index("by_normalized_name", ["normalizedName"])
    .index("by_last_active", ["lastActiveAt"]),

  raids: defineTable({
    attackerId: v.id("players"),
    targetType: v.union(
      v.literal("open_acres"),
      v.literal("player"),
      v.literal("parshendi_spheres"),
    ),
    targetPlayerId: v.optional(v.id("players")),
    units: unitCounts,
    power: v.number(),
    speed: v.number(),
    acres: v.optional(v.number()),
    defensePower: v.optional(v.number()),
    rewardSpheres: v.optional(v.number()),
    departAt: v.number(),
    arriveAt: v.number(),
    resolvedAt: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("resolved")),
  })
    .index("by_attacker", ["attackerId"])
    .index("by_target_player", ["targetPlayerId"])
    .index("by_status_arrival", ["status", "arriveAt"]),

  messages: defineTable({
    fromPlayerId: v.optional(v.id("players")),
    toPlayerId: v.id("players"),
    kind: v.union(v.literal("player"), v.literal("system")),
    subject: v.string(),
    body: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_to_player", ["toPlayerId"])
    .index("by_to_player_created", ["toPlayerId", "createdAt"]),

  plateauRuns: defineTable({
    status: v.union(v.literal("open"), v.literal("resolved")),
    opensAt: v.number(),
    closesAt: v.number(),
    resolvesAt: v.number(),
    difficulty: v.number(),
    spherePool: v.number(),
    gemheartReward: v.number(),
    winnerPlayerId: v.optional(v.id("players")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_closes_at", ["closesAt"]),

  plateauCommitments: defineTable({
    plateauRunId: v.id("plateauRuns"),
    playerId: v.id("players"),
    units: unitCounts,
    power: v.number(),
    speed: v.number(),
    committedAt: v.number(),
  })
    .index("by_run", ["plateauRunId"])
    .index("by_player", ["playerId"])
    .index("by_run_player", ["plateauRunId", "playerId"]),

  gameState: defineTable({
    key: v.string(),
    openAcres: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  gameEvents: defineTable({
    text: v.string(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),
});
