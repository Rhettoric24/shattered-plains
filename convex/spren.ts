import { internalMutation } from "./_generated/server";
import { RESEARCH_RULES } from "./rules";

const FLAVOR_REPORTS = [
  ["Subtle Signals", "A ribbon of windspren followed an empty bridge crew for nearly an hour, then vanished the moment anyone acknowledged it."],
  ["An Ardent's Observation", "Creationspren gathered above a cracked stone in the shape of a tiny crown. No one agrees whether this was profound or merely rude."],
  ["Weather and Spren", "Anticipationspren appeared well before the distant stormlight on the horizon. The ardents have underlined the timing twice."],
  ["A Small Mystery", "A cluster of lifespren has persisted beside a dry cleft where nothing appears capable of growing."],
] as const;

export const deliverReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const window = Math.floor(now / RESEARCH_RULES.spren.reportIntervalMs);
    const rows = await ctx.db.query("playerResearch").take(200);
    const neutral = await ctx.db.query("plateaus").withIndex("by_status", (q) => q.eq("status", "neutral")).take(100);
    let delivered = 0;
    for (const row of rows) {
      if (Math.floor(row.completedLevels.sprenStudies ?? 0) < 1 || row.lastSprenReportWindow === window) continue;
      await ctx.db.patch(row._id, { lastSprenReportWindow: window, updatedAt: now });
      if (Math.random() < RESEARCH_RULES.spren.reportChance) {
        const [subject, body] = FLAVOR_REPORTS[Math.floor(Math.random() * FLAVOR_REPORTS.length)];
        await ctx.db.insert("messages", {
          toPlayerId: row.playerId, kind: "system", subject, body,
          eventType: "spren_observation", destinationView: "intelligence", destinationTab: "territory", createdAt: now,
        });
        delivered += 1;
      }
      const player = await ctx.db.get(row.playerId);
      if (Math.floor(row.completedLevels.sprenStudies ?? 0) < 2 || (player?.buildings.watchtower ?? 0) < 1 || neutral.length < 1 || Math.random() >= RESEARCH_RULES.spren.bonusDiscoveryChance) continue;
      const plateau = neutral[Math.floor(Math.random() * neutral.length)];
      const bonusFactText = `An odd congregation of spren fixes the plateau's resistance at exactly ${plateau.neutralDefenseRemaining} Power.`;
      const existing = await ctx.db.query("intelligenceReports").withIndex("by_viewerPlayerId_and_plateauId", (q) => q.eq("viewerPlayerId", row.playerId).eq("plateauId", plateau._id)).unique();
      const report = { viewerPlayerId: row.playerId, targetType: "territory" as const, plateauId: plateau._id, source: "watchtower" as const, level: 1, observedAt: now, resistance: plateau.neutralDefenseRemaining, plateauType: plateau.type, highground: plateau.highground, large: Boolean(plateau.large), bonusFactKind: "resistance", bonusFactText, bonusObservedAt: now };
      if (existing) await ctx.db.patch(existing._id, report);
      else await ctx.db.insert("intelligenceReports", report);
    }
    return { delivered, checked: rows.length, window };
  },
});
