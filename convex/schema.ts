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
  ardentMonastery: v.optional(v.number()),
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
    ardentiaConclaves: v.optional(v.number()),
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
    ardentiaConclave: v.optional(v.boolean()),
    conclaveId: v.optional(v.id("ardentConclaves")),
    conclaveXpAwarded: v.optional(v.number()),
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
    origin: v.optional(v.union(v.literal("home"), v.literal("neutral"))),
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
    ardentiaConclave: v.optional(v.boolean()),
    conclaveId: v.optional(v.id("ardentConclaves")),
    conclaveXpAwarded: v.optional(v.number()),
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

  notifications: defineTable({
    playerId: v.id("players"),
    category: v.union(
      v.literal("combat"),
      v.literal("missions"),
      v.literal("research"),
      v.literal("plateau_runs"),
      v.literal("messages"),
    ),
    eventType: v.string(),
    title: v.string(),
    body: v.string(),
    destinationView: v.string(),
    entityId: v.optional(v.string()),
    dedupeKey: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_playerId_and_createdAt", ["playerId", "createdAt"])
    .index("by_playerId_and_readAt", ["playerId", "readAt"])
    .index("by_playerId_and_dedupeKey", ["playerId", "dedupeKey"]),

  notificationState: defineTable({
    playerId: v.id("players"),
    unreadCount: v.number(),
    combat: v.boolean(),
    missions: v.boolean(),
    research: v.boolean(),
    plateauRuns: v.boolean(),
    messages: v.boolean(),
    updatedAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  pushSubscriptions: defineTable({
    playerId: v.id("players"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    deviceLabel: v.string(),
    soundEnabled: v.boolean(),
    disabledAt: v.optional(v.number()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_endpoint", ["endpoint"]),

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
    conclaveId: v.optional(v.id("ardentConclaves")),
    conclaveXpAwarded: v.optional(v.number()),
    committedAt: v.number(),
  })
    .index("by_run", ["plateauRunId"])
    .index("by_player", ["playerId"])
    .index("by_run_player", ["plateauRunId", "playerId"]),

  ardentConclaves: defineTable({
    ownerPlayerId: v.id("players"),
    name: v.string(),
    normalizedName: v.string(),
    xp: v.number(),
    missionKind: v.optional(v.union(
      v.literal("raid"),
      v.literal("siege"),
      v.literal("plateau_run"),
    )),
    missionId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerPlayerId", ["ownerPlayerId"])
    .index("by_ownerPlayerId_and_normalizedName", ["ownerPlayerId", "normalizedName"]),

  playerResearch: defineTable({
    playerId: v.id("players"),
    completedLevels: v.record(v.string(), v.number()),
    activeProject: v.optional(v.string()),
    activeLevel: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"))),
    accumulatedBaseMs: v.optional(v.number()),
    lastAdvancedAt: v.optional(v.number()),
    projectedCompletionAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  gameState: defineTable({
    key: v.string(),
    openAcres: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  gameEvents: defineTable({
      text: v.string(),
      kind: v.optional(v.string()),
      gameDate: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

  intelligenceReports: defineTable({
    viewerPlayerId: v.id("players"),
    targetType: v.union(v.literal("kingdom"), v.literal("territory")),
    targetPlayerId: v.optional(v.id("players")),
    plateauId: v.optional(v.id("plateaus")),
    source: v.union(
      v.literal("player_raid"),
      v.literal("neutral_expedition"),
      v.literal("watchtower"),
      v.literal("ardent"),
    ),
    level: v.number(),
    observedAt: v.number(),
    militaryPower: v.optional(v.number()),
    sphereStockpile: v.optional(v.number()),
    resistance: v.optional(v.number()),
    rewardSpheres: v.optional(v.number()),
    plateauType: v.optional(plateauType),
    highground: v.optional(v.boolean()),
    large: v.optional(v.boolean()),
  })
    .index("by_viewerPlayerId_and_targetType", ["viewerPlayerId", "targetType"])
    .index("by_viewerPlayerId_and_targetPlayerId", ["viewerPlayerId", "targetPlayerId"])
    .index("by_viewerPlayerId_and_plateauId", ["viewerPlayerId", "plateauId"]),
});
