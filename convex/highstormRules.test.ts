import { describe, expect, test } from "vitest";
import { applyHighstormExposureLosses, dailyStorm, forecastFor, HIGHSTORM_RULES, isStormActive, mountainDateKey, stormCounterIntelligence, stormInvestigationIntel, stormParshendiPower, stormRewardPool } from "./highstormRules";
import { sphereHeistCasualties } from "./espionageRules";

describe("Highstorms V0 schedule", () => {
  test("is stable, daily, within the legal Mountain window, and exactly two hours", () => {
    const dates=["2026-01-15","2026-03-08","2026-07-15","2026-11-01"];
    const storms=dates.map(d=>dailyStorm(d));
    expect(new Set(storms.map(s=>s.stormId)).size).toBe(dates.length);
    expect(new Set(storms.map(s=>s.startAt%86_400_000)).size).toBeGreaterThan(1);
    for(const storm of storms){expect(storm.endAt-storm.startAt).toBe(7_200_000);expect(mountainDateKey(storm.startAt)).toBe(storm.dateKey);const local=new Intl.DateTimeFormat("en-US",{timeZone:HIGHSTORM_RULES.timezone,hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(new Date(storm.startAt));const hour=Number(local.find(p=>p.type==="hour")?.value);expect(hour).toBeGreaterThanOrEqual(9);expect(hour).toBeLessThanOrEqual(21);expect(dailyStorm(storm.dateKey)).toEqual(storm);}
  });
  test("uses active start-inclusive/end-exclusive boundaries",()=>{const s=dailyStorm("2026-08-28");expect(isStormActive(s,s.startAt-1)).toBe(false);expect(isStormActive(s,s.startAt)).toBe(true);expect(isStormActive(s,s.endAt-1)).toBe(true);expect(isStormActive(s,s.endAt)).toBe(false);});
});

describe("forecast authorization",()=>{
  test.each([[0,240],[1,120],[2,60]])("WT%i returns only a %i-minute containing window",(level,width)=>{for(const date of ["2026-01-01","2026-04-02","2026-08-28","2026-12-31"]){const s=dailyStorm(date);const f=forecastFor(s,level);expect(f.exact).toBe(false);expect((f.endAt-f.startAt)/60000).toBe(width);expect(f.startAt).toBeLessThanOrEqual(s.startAt);expect(f.endAt).toBeGreaterThanOrEqual(s.startAt);}});
  test("WT3 receives exact arrival",()=>{const s=dailyStorm("2026-08-28");expect(forecastFor(s,3)).toEqual({exact:true,startAt:s.startAt,endAt:s.startAt});});
});

test("central operation modifiers apply exactly once",()=>{expect(stormParshendiPower(101,true)).toBe(141);expect(stormParshendiPower(101,false)).toBe(101);expect(stormRewardPool(2400,true)).toBe(4800);expect(stormCounterIntelligence(90,true)).toBe(45);expect(stormInvestigationIntel(15,true,true)).toBe(23);expect(stormInvestigationIntel(15,false,true)).toBe(15);});
test("Highstorm doubles only existing Sphere Heist failure casualties",()=>{const force={informant:10,spy:0,ghostblood:0};expect(sphereHeistCasualties(force,"failure").lost).toBe(2);expect(sphereHeistCasualties(force,"failure",2).lost).toBe(4);expect(sphereHeistCasualties(force,"partial",2).lost).toBe(2);expect(sphereHeistCasualties(force,"success",2).lost).toBe(0);});

describe("storm exposure casualties", () => {
  test("large armies retain combined Survivability without becoming weatherproof", () => {
    const losses = applyHighstormExposureLosses({ bridgeman: 700, spearman: 1000, chull: 0, scout: 0, heavy: 0, shardbearer: 0 }, "reported-siege-force");
    const total = Object.values(losses.casualties).reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThanOrEqual(63);
    expect(total).toBeLessThanOrEqual(64);
    expect(losses.finalCasualtyRate).toBeCloseTo(0.0375);
  });

  test("strong cohorts cover weak cohorts, with storm mitigation capped", () => {
    const mixed = applyHighstormExposureLosses({ bridgeman: 1000, spearman: 1000, chull: 0, scout: 0, heavy: 0, shardbearer: 0 }, "mixed");
    const weak = applyHighstormExposureLosses({ bridgeman: 1000, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 0 }, "weak");
    const veryHardy = applyHighstormExposureLosses({ bridgeman: 0, spearman: 0, chull: 0, scout: 0, heavy: 0, shardbearer: 1000 }, "hardy");
    expect(mixed.finalCasualtyRate).toBeLessThan(weak.finalCasualtyRate);
    expect(veryHardy.finalCasualtyRate).toBeCloseTo(0.0375);
    expect(HIGHSTORM_RULES.exposureSurvivabilityCap).toBe(300);
  });
});
