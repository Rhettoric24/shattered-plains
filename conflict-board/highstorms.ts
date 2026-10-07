import { applySurvivalLosses, totalUnits } from "../convex/rules";
import { HIGHSTORM_RULES } from "../convex/highstormRules";
import { archiveEquipment, protectWithEquipment, validateEquipment } from "./fabrials";
import { limitCargo } from "./cargo";
import type { ConflictState, ResolverConfig, Event } from "./types";

export const DEFAULT_STORM = {
  baseRate: HIGHSTORM_RULES.exposureBaseCasualtyRate,
  surviveCap: HIGHSTORM_RULES.exposureSurvivabilityCap as number | null,
  visionRadius: 0, fogPenalty: 2, raidMultiplier: 2,
};
export function stormSettings(config?: ResolverConfig) {
  const c={...DEFAULT_STORM,...config?.highstorm};
  if(!Number.isFinite(c.baseRate)||c.baseRate<0||c.baseRate>1 ||
     (c.surviveCap!==null&&(!Number.isFinite(c.surviveCap)||c.surviveCap<0)) ||
     !Number.isInteger(c.visionRadius)||c.visionRadius<0||c.visionRadius>10 ||
     !Number.isInteger(c.fogPenalty)||c.fogPenalty<0||c.fogPenalty>3 ||
     !Number.isFinite(c.raidMultiplier)||c.raidMultiplier<0||c.raidMultiplier>100)
    throw Error("Invalid Highstorm settings: casualties 0–100%, nonnegative Survival cap, vision 0–10, fog penalty 0–3, raid multiplier 0–100.");
  return c;
}
/** Atomic exposure boundary: run on storm start and on new commitments BEFORE
 * splitting/merging. All committed forces (including transit and staging) are
 * exposed once; splits inherit markers and resolver merges already-hit armies.
 * Server adapters must persist state + events together. No wall clock or I/O. */
export function exposeHighstorm(state:ConflictState,config:ResolverConfig,events:Event[]) {
  const c=stormSettings(config), storm=state.highstorm;
  if(!storm?.active)return;
  validateEquipment(state);
  const occupiedObjective=state.formations.some(f=>f.position===state.board.objective&&f.kingdom===state.objective.controller);
  const forces=[...state.formations,...state.arrivals.map(a=>a.formation)].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(const f of forces) {
    if(!totalUnits(f.units)) {
      archiveEquipment(state,f,state.cycle,events,"unsettled","Empty formation before exposure; equipment awaits settlement.");
      if("position" in f)limitCargo(state,f,events,"Empty formation has no carrying capacity.");
      continue;
    }
    if(f.lastHighstormExposureId===storm.id)continue;
    f.lastHighstormExposureId=storm.id;
    const raw=applySurvivalLosses(f.units,c.baseRate,`${state.id}:${storm.id}:${f.id}:exposure`,state.kingdoms.find(k=>k.id===f.kingdom)!.research,false,c.surviveCap??undefined);
    // Active reusable protection applies. Repeated-event consumable semantics
    // remain unapproved; storms never auto-consume a carried Painrial.
    const loss=protectWithEquipment(state,[f],raw,state.cycle,events,false);
    f.units=loss.survivors;
    events.push({type:"highstorm",formation:f.id,kingdom:f.kingdom,stormId:storm.id,casualties:loss.casualties,survivors:loss.survivors,finalRate:raw.finalCasualtyRate});
    if("position" in f)limitCargo(state,f,events,"Highstorm casualties reduced carrying capacity.");
    if(!totalUnits(f.units))archiveEquipment(state,f,state.cycle,events,"lost","Carrier annihilated by Highstorm; equipment lost.");
  }
  state.formations=state.formations.filter(f=>totalUnits(f.units)>0);
  state.arrivals=state.arrivals.filter(a=>totalUnits(a.formation.units)>0);
  for(const [position,h] of Object.entries(state.raidFootholds??{})) {
    h.occupants=h.occupants.filter(id=>state.formations.some(f=>f.id===id&&f.position===position));
    if(!h.occupants.length){delete state.raidFootholds![position];events.push({type:"raidBroken",position,kingdom:h.kingdom,cycle:state.cycle});}
  }
  if(occupiedObjective&&state.objective.controller&&!state.formations.some(f=>f.position===state.board.objective&&f.kingdom===state.objective.controller)) {
    if(state.objective.hold)events.push({type:"holdBroken",kingdom:state.objective.hold.kingdom});
    state.objective.controller=null;delete state.objective.hold;
  }
}
/** Same identity is a retry; a genuinely new storm requires a new identity. */
export function setHighstorm(state:ConflictState,config:ResolverConfig,id:string,active:boolean) {
  if(!id)throw Error("Storm identity required.");
  const next=structuredClone(state),events:Event[]=[];
  next.highstorm={id,active,sequence:state.highstorm?.id===id ? state.highstorm.sequence : (state.highstorm?.sequence??0)+1};exposeHighstorm(next,config,events);
  return {state:next,events};
}
