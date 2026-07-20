import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const unitCounts = v.object({
  bridgeman: v.number(),
  spearman: v.number(),
  chull: v.optional(v.number()),
  scout: v.number(),
  heavy: v.number(),
  shardbearer: v.number(),
});

const buildingLevels = v.object({
  market: v.number(),
  watchtower: v.number(),
  barracks: v.number(),
  soulcastBunker: v.optional(v.number()),
});

const plateauType = v.union(
  v.literal("sphere"),
  v.literal("training"),
  v.literal("gemheart"),
  v.literal("ancient_ruins"),
  v.literal("bridged"),
  v.literal("ancient"),
);

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

  plateaus: defineTable({
    name: v.string(),
    type: plateauType,
    status: v.union(v.literal("neutral"), v.literal("owned")),
    ownerPlayerId: v.optional(v.id("players")),
    highground: v.boolean(),
    large: v.optional(v.boolean()),
    neutralDefenseInitial: v.number(),
    neutralDefenseRemaining: v.number(),
    heldSince: v.optional(v.number()),
    lastGemheartAt: v.optional(v.number()),
    activeSiegeId: v.optional(v.id("sieges")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_owner", ["ownerPlayerId"])
    .index("by_active_siege", ["activeSiegeId"]),

  sieges: defineTable({
    plateauId: v.id("plateaus"),
    attackerId: v.id("players"),
    defenderId: v.optional(v.id("players")),
    targetType: v.union(v.literal("neutral"), v.literal("player")),
    attackerUnits: unitCounts,
    attackerPower: v.number(),
    attackerSpeed: v.number(),
    defenderUnits: v.optional(unitCounts),
    defenderPower: v.optional(v.number()),
    defenderSpeed: v.optional(v.number()),
    defenderCommittedAt: v.optional(v.number()),
    fortifyPercent: v.number(),
    emergencyDefensePercent: v.optional(v.number()),
    emergencyDefenseSpheresSpent: v.optional(v.number()),
    departAt: v.number(),
    resolveAt: v.number(),
    resolvedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("resolved"),
      v.literal("attacker_retreat"),
      v.literal("defender_retreat"),
    ),
  })
    .index("by_status_resolve", ["status", "resolveAt"])
    .index("by_attacker", ["attackerId"])
    .index("by_defender", ["defenderId"])
    .index("by_plateau", ["plateauId"]),

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
    scheduleKey: v.optional(v.string()),
    winnerPlayerId: v.optional(v.id("players")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_schedule_key", ["scheduleKey"])
    .index("by_closes_at", ["closesAt"]),

  plateauCommitments: defineTable({
    plateauRunId: v.id("plateauRuns"),
    playerId: v.id("players"),
    units: unitCounts,
    power: v.number(),
    speed: v.number(),
    bridgedTravelReductionPercent: v.optional(v.number()),
    travelMinutes: v.optional(v.number()),
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
