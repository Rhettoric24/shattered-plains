export const HIGHSTORM_RULES = {
  timezone: "America/Denver", arrivalStartMinute: 540, arrivalEndMinute: 1260,
  durationMs: 7_200_000, forecastWindowMinutes: [240, 120, 60, 0],
  exposureBaseCasualtyRate: 0.0375, parshendiPowerMultiplier: 1.4,
  raidRewardMultiplier: 2, counterIntelligenceMultiplier: 0.5,
  investigationIntelMultiplier: 1.5, failureCasualtyMultiplier: 2,
} as const;

function hash32(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function parts(timestamp: number) { return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: HIGHSTORM_RULES.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value])); }
export function mountainDateKey(timestamp: number) { const p = parts(timestamp); return `${p.year}-${p.month}-${p.day}`; }
function offsetAt(timestamp: number) { const p = parts(timestamp); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - timestamp; }
export function mountainLocalToUtc(dateKey: string, minute: number) { const [y,m,d] = dateKey.split("-").map(Number); const local = Date.UTC(y,m-1,d,Math.floor(minute/60),minute%60); let result = local-offsetAt(local); return local-offsetAt(result); }
export function dailyStorm(dateKey: string, worldKey="main") { const span=HIGHSTORM_RULES.arrivalEndMinute-HIGHSTORM_RULES.arrivalStartMinute; const minute=HIGHSTORM_RULES.arrivalStartMinute+(hash32(`${worldKey}:${dateKey}:highstorm-v0`)%(span+1)); const startAt=mountainLocalToUtc(dateKey,minute); return {stormId:`highstorm:${worldKey}:${dateKey}`,dateKey,startAt,endAt:startAt+HIGHSTORM_RULES.durationMs}; }
export function stormAt(now:number, worldKey="main") { const today=dailyStorm(mountainDateKey(now),worldKey); return now<today.endAt?today:dailyStorm(mountainDateKey(now+86_400_000),worldKey); }
export function isStormActive(storm:{startAt:number;endAt:number},now:number){return now>=storm.startAt&&now<storm.endAt;}
export function forecastFor(storm:ReturnType<typeof dailyStorm>,watchtower:number){const level=Math.max(0,Math.min(3,Math.floor(watchtower)));const width=HIGHSTORM_RULES.forecastWindowMinutes[level];if(!width)return{exact:true,startAt:storm.startAt,endAt:storm.startAt};const trueMinute=Math.round((storm.startAt-mountainLocalToUtc(storm.dateKey,0))/60000);let start=Math.round(trueMinute-width/2);start=Math.max(540,Math.min(start,1260-width));return{exact:false,startAt:mountainLocalToUtc(storm.dateKey,start),endAt:mountainLocalToUtc(storm.dateKey,start+width)};}
export const stormParshendiPower=(normal:number,active:boolean)=>active?Math.round(normal*1.4):normal;
export const stormRewardPool=(normal:number,active:boolean)=>active?Math.round(normal*2):normal;
export const stormCounterIntelligence=(normal:number,active:boolean)=>active?normal*.5:normal;
export const stormInvestigationIntel=(normal:number,success:boolean,active:boolean)=>active&&success?Math.round(normal*1.5):normal;
