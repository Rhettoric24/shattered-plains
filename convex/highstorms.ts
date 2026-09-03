import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCurrentPlayer } from "./ownership";
import { requireAdmin } from "./admin";
import { createNotification } from "./notificationHelpers";
import { completedResearch } from "./researchHelpers";
import { casualtySummary, effectivePower, effectiveSpeed, normalizeUnits, WORLD_KEY } from "./rules";
import { applyHighstormExposureLosses, forecastFor, isStormActive, mountainDateKey, stormAt } from "./highstormRules";
import { applyFabrialCasualtyProtection } from "./fabrialRules";

type DbCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
async function authoritativeStorm(ctx: DbCtx, now: number) {
  const world = await ctx.db.query("gameState").withIndex("by_key", q => q.eq("key", WORLD_KEY)).unique();
  if (world?.highstormOverrideStartAt !== undefined && world.highstormOverrideEndAt !== undefined && now < world.highstormOverrideEndAt) return { stormId: world.highstormOverrideId ?? "highstorm:dev", dateKey: mountainDateKey(world.highstormOverrideStartAt), startAt: world.highstormOverrideStartAt, endAt: world.highstormOverrideEndAt };
  return stormAt(now, WORLD_KEY);
}
export async function activeHighstorm(ctx: DbCtx, now: number) { const storm=await authoritativeStorm(ctx,now); return {storm,active:isStormActive(storm,now)}; }

export const getForecast = query({ args: {}, handler: async ctx => {
  const player=await requireCurrentPlayer(ctx); const now=Date.now(); const {storm,active}=await activeHighstorm(ctx,now);
  return active ? {stormId:storm.stormId,state:"active" as const,active:true,endAt:storm.endAt,serverNow:now} : {stormId:storm.stormId,state:now<storm.startAt?"approaching" as const:"forecast" as const,active:false,forecast:forecastFor(storm,player.buildings.watchtower??0),serverNow:now};
} });

async function expose(ctx: MutationCtx, now: number) {
  const { storm, active } = await activeHighstorm(ctx, now);
  if (!active) return { active: false, exposed: 0 };
  let exposed = 0;
  const raids = await ctx.db.query("raids").withIndex("by_status_arrival", q => q.eq("status", "pending")).take(100);
  for (const raid of raids) {
    if (raid.lastHighstormExposureId === storm.stormId) continue;
    const completed = await completedResearch(ctx, raid.attackerId);
    const raw = applyHighstormExposureLosses(raid.units, `${raid._id}:${storm.stormId}:exposure`, completed, Boolean(raid.conclaveId));
    const loss = applyFabrialCasualtyProtection(raid.fabrialKind, raw);
    await ctx.db.patch(raid._id, { units: loss.survivors, power: effectivePower(loss.survivors, completed, Boolean(raid.conclaveId)), speed: effectiveSpeed(loss.survivors, completed, Boolean(raid.conclaveId)), lastHighstormExposureId: storm.stormId, fabrialPreventedCasualties: (raid.fabrialPreventedCasualties ?? 0) + loss.prevented });
    await createNotification(ctx, { playerId: raid.attackerId, category: "combat", eventType: "highstorm_exposure", title: "Army Caught in Highstorm", body: `Highstorm exposure casualties: ${casualtySummary(loss.casualties)}.${loss.prevented ? ` ${raid.fabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${loss.prevented}.` : ""}`, destinationView: "plains", destinationTab: "raids", entityId: String(raid._id), dedupeKey: `${storm.stormId}:raid:${raid._id}`, createdAt: now });
    await ctx.db.insert("messages", { toPlayerId: raid.attackerId, kind: "system", subject: "Highstorm Exposure", body: `Your deployed raid force suffered Highstorm exposure. Casualties: ${casualtySummary(loss.casualties)}.`, eventType: "highstorm_exposure", destinationView: "plains", destinationTab: "raids", entityType: "raid", entityId: String(raid._id), createdAt: now });
    exposed++;
  }
  const sieges = await ctx.db.query("sieges").withIndex("by_status_resolve", q => q.eq("status", "pending")).take(100);
  for (const siege of sieges) {
    if (siege.attackerId && siege.attackerHighstormExposureId !== storm.stormId) {
      const completed = await completedResearch(ctx, siege.attackerId);
      const raw = applyHighstormExposureLosses(siege.attackerUnits, `${siege._id}:${storm.stormId}:attacker`, completed, Boolean(siege.conclaveId));
      const loss = applyFabrialCasualtyProtection(siege.fabrialKind, raw);
      await ctx.db.patch(siege._id, { attackerUnits: loss.survivors, attackerPower: effectivePower(loss.survivors, completed, Boolean(siege.conclaveId)), attackerSpeed: effectiveSpeed(loss.survivors, completed, Boolean(siege.conclaveId)), attackerHighstormExposureId: storm.stormId, fabrialPreventedCasualties: (siege.fabrialPreventedCasualties ?? 0) + loss.prevented });
      await createNotification(ctx, { playerId: siege.attackerId, category: "combat", eventType: "highstorm_exposure", title: "Army Caught in Highstorm", body: `Highstorm exposure casualties: ${casualtySummary(loss.casualties)}.${loss.prevented ? ` ${siege.fabrialKind === "halfShard" ? "Half-Shard" : "Painrial"} protection prevented ${loss.prevented}.` : ""}`, destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id), dedupeKey: `${storm.stormId}:siege:${siege._id}:attacker`, createdAt: now });
      await ctx.db.insert("messages", { toPlayerId: siege.attackerId, kind: "system", subject: "Highstorm Exposure", body: `Your siege force suffered Highstorm exposure. Casualties: ${casualtySummary(loss.casualties)}.`, eventType: "highstorm_exposure", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siege._id), createdAt: now });
      exposed++;
    }
    if (siege.defenderId && siege.defenderCommittedAt && siege.defenderHighstormExposureId !== storm.stormId) {
      const completed = await completedResearch(ctx, siege.defenderId);
      const loss = applyHighstormExposureLosses(normalizeUnits(siege.defenderUnits), `${siege._id}:${storm.stormId}:defender`, completed);
      await ctx.db.patch(siege._id, { defenderUnits: loss.survivors, defenderPower: effectivePower(loss.survivors, completed), defenderSpeed: effectiveSpeed(loss.survivors, completed), defenderHighstormExposureId: storm.stormId });
      await createNotification(ctx, { playerId: siege.defenderId, category: "combat", eventType: "highstorm_exposure", title: "Defenders Caught in Highstorm", body: `Highstorm exposure casualties: ${casualtySummary(loss.casualties)}.`, destinationView: "plains", destinationTab: "sieges", entityId: String(siege._id), dedupeKey: `${storm.stormId}:siege:${siege._id}:defender`, createdAt: now });
      await ctx.db.insert("messages", { toPlayerId: siege.defenderId, kind: "system", subject: "Highstorm Exposure", body: `Your committed plateau defenders suffered Highstorm exposure. Casualties: ${casualtySummary(loss.casualties)}.`, eventType: "highstorm_exposure", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(siege._id), createdAt: now });
      exposed++;
    }
  }
  const reinforcements = await ctx.db.query("siegeReinforcements").withIndex("by_status_and_arriveAt", q => q.eq("status", "traveling")).take(200);
  for (const reinforcement of reinforcements) {
    if (reinforcement.lastHighstormExposureId === storm.stormId) continue;
    const completed = await completedResearch(ctx, reinforcement.playerId);
    const loss = applyHighstormExposureLosses(reinforcement.units, `${reinforcement._id}:${storm.stormId}:reinforcement`, completed);
    await ctx.db.patch(reinforcement._id, { units: loss.survivors, power: effectivePower(loss.survivors, completed), speed: effectiveSpeed(loss.survivors, completed), lastHighstormExposureId: storm.stormId });
    await createNotification(ctx, { playerId: reinforcement.playerId, category: "combat", eventType: "highstorm_exposure", title: "Reinforcements Caught in Highstorm", body: `Highstorm exposure casualties: ${casualtySummary(loss.casualties)}.`, destinationView: "plains", destinationTab: "sieges", entityId: String(reinforcement.siegeId), dedupeKey: `${storm.stormId}:siege-reinforcement:${reinforcement._id}`, createdAt: now });
    await ctx.db.insert("messages", { toPlayerId: reinforcement.playerId, kind: "system", subject: "Highstorm Exposure", body: `Your traveling siege reinforcements suffered Highstorm exposure. Casualties: ${casualtySummary(loss.casualties)}.`, eventType: "highstorm_exposure", destinationView: "plains", destinationTab: "sieges", entityType: "siege", entityId: String(reinforcement.siegeId), createdAt: now });
    exposed++;
  }
  const runs = await ctx.db.query("plateauRuns").withIndex("by_status", q => q.eq("status", "open")).take(25);
  for (const run of runs) for await (const commitment of ctx.db.query("plateauCommitments").withIndex("by_run", q => q.eq("plateauRunId", run._id))) {
    if (commitment.lastHighstormExposureId === storm.stormId) continue;
    const completed = await completedResearch(ctx, commitment.playerId);
    const loss = applyHighstormExposureLosses(commitment.units, `${commitment._id}:${storm.stormId}`, completed, Boolean(commitment.conclaveId));
    await ctx.db.patch(commitment._id, { units: loss.survivors, power: effectivePower(loss.survivors, completed, Boolean(commitment.conclaveId)), speed: effectiveSpeed(loss.survivors, completed, Boolean(commitment.conclaveId)), lastHighstormExposureId: storm.stormId });
    await createNotification(ctx, { playerId: commitment.playerId, category: "combat", eventType: "highstorm_exposure", title: "Plateau Run Force Caught in Highstorm", body: `Highstorm exposure casualties: ${casualtySummary(loss.casualties)}.`, destinationView: "plains", destinationTab: "plateau-runs", entityId: String(run._id), dedupeKey: `${storm.stormId}:plateau-run:${commitment._id}`, createdAt: now });
    await ctx.db.insert("messages", { toPlayerId: commitment.playerId, kind: "system", subject: "Highstorm Exposure", body: `Your Plateau Run force suffered Highstorm exposure. Casualties: ${casualtySummary(loss.casualties)}.`, eventType: "highstorm_exposure", destinationView: "plains", destinationTab: "plateau-runs", entityType: "plateau_run", entityId: String(run._id), createdAt: now });
    exposed++;
  }
  return { active: true, stormId: storm.stormId, exposed };
}
export const processActiveStorm=internalMutation({args:{},handler:async ctx=>await expose(ctx,Date.now())});
export const setDevelopmentOverride=mutation({args:{state:v.union(v.literal("forecast"),v.literal("active"),v.literal("ended"))},handler:async(ctx,args)=>{await requireAdmin(ctx);const now=Date.now();const world=await ctx.db.query("gameState").withIndex("by_key",q=>q.eq("key",WORLD_KEY)).unique();if(!world)throw new Error("World not found.");const start=args.state==="forecast"?now+3_600_000:args.state==="active"?now-60_000:now-7_260_000;await ctx.db.patch(world._id,{highstormOverrideStartAt:start,highstormOverrideEndAt:start+7_200_000,highstormOverrideId:`highstorm:dev:${now}`});return args.state==="active"?await expose(ctx,now):{state:args.state};}});
