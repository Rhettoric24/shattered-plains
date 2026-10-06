import { FABRIAL_RULES, isFabrialKey, applyFabrialCasualtyProtection, type FabrialKey } from "../convex/fabrialRules";
import type { UnitCounts } from "../convex/rules";
import { totalUnits } from "../convex/rules";
import { seededFraction } from "../convex/worldPressureRules";
import { defeatBandIndex } from "./cargo";
import type { ConflictState, Formation, Event } from "./types";

export type FabrialInstance = { id: string; kind: FabrialKey; owner: string };
export type FormationEquipment = {
  items: FabrialInstance[];
  active?: string;
  pending?: { id: string; afterCycle: number };
};
export type EquipmentRecord = {
  item: FabrialInstance;
  formation: string;
  position?: string;
  cycle: number;
  status: "unsettled" | "consumed" | "removed-in-lab" | "lost";
  reason: string;
};
type Carrier = Pick<Formation, "id" | "kingdom" | "units" | "equipment"> & {position?:string};
const compare = (a:string,b:string) => a<b?-1:a>b?1:0;
const ranked = (rows:Carrier[]) => [...rows].sort((a,b)=>totalUnits(b.units)-totalUnits(a.units)||compare(a.id,b.id));
export const fabrialDefinitions = FABRIAL_RULES;
export const DEFAULT_FABRIAL_LOSS_RATES: [number,number,number,number]=[.10,.25,.50,.75];
export function fabrialLossChance(winnerPower:number,ownPower:number,defeated:boolean,annihilated:boolean,rates=DEFAULT_FABRIAL_LOSS_RATES) {
  return annihilated?1:defeated?rates[defeatBandIndex(winnerPower,ownPower)]:0;
}
/** One independent reproducible roll per physical reusable device per engagement.
 * The caller supplies pre-casualty Powers and post-protection survivors. */
export function resolveFabrialLosses(state:ConflictState,rows:Carrier[],args:{cycle:number;step:number;position:string;seed:string;winnerPower:number;ownPower:number;defeated:boolean;rates?:[number,number,number,number]},events:Event[]) {
  const annihilated=rows.every(f=>totalUnits(f.units)===0);
  if(!annihilated&&!args.defeated)return;
  const chance=fabrialLossChance(args.winnerPower,args.ownPower,args.defeated,annihilated,args.rates);
  for(const f of [...rows].sort((a,b)=>compare(a.id,b.id))) {
    const e=f.equipment;if(!e)continue;
    for(const item of [...e.items].sort((a,b)=>compare(a.id,b.id))) {
      if(!FABRIAL_RULES[item.kind].reusable)continue;
      const roll=seededFraction(JSON.stringify([state.id,args.cycle,args.step,args.position,f.kingdom,item.id,args.seed,"fabrial-loss"]));
      const lost=chance===1 || roll<chance;
      const reason=`${FABRIAL_RULES[item.kind].name}: ${annihilated?"army annihilated":`defeat band ${defeatBandIndex(args.winnerPower,args.ownPower)+1}`} · ${chance*100}% loss chance · ${lost?"lost":"retained"}.`;
      events.push({type:"fabrial",formation:f.id,kingdom:f.kingdom,item:item.id,action:lost?"lost":"retained",reason,lossChance:chance,roll});
      if(lost) {
        e.items=e.items.filter(i=>i.id!==item.id);
        if(e.active===item.id)delete e.active;
        if(e.pending?.id===item.id)delete e.pending;
        (state.equipmentRecords??=[]).push({item:{...item},formation:f.id,position:args.position,cycle:args.cycle,status:"lost",reason});
      }
    }
  }
}

export function validateEquipment(state: ConflictState) {
  const seen = new Set<string>();
  const check = (item:FabrialInstance, kingdom?:string) => {
    if (!item.id || seen.has(item.id) || !isFabrialKey(item.kind) || !state.kingdoms.some(k=>k.id===item.owner) || (kingdom && item.owner!==kingdom))
      throw Error("Fabrial identities must be unique and belong to their carrying kingdom.");
    seen.add(item.id);
  };
  for(const f of [...state.formations,...state.arrivals.map(a=>a.formation)]) {
    const e=f.equipment;if(!e)continue;
    for(const item of e.items)check(item,f.kingdom);
    for(const id of [e.active,e.pending?.id].filter(Boolean)) {
      const item=e.items.find(i=>i.id===id);
      if(!item || !FABRIAL_RULES[item.kind].reusable)throw Error("An active or pending slot must refer to a carried persistent Fabrial.");
    }
    if(e.pending && (!Number.isSafeInteger(e.pending.afterCycle)||e.pending.afterCycle<1||e.pending.id===e.active))throw Error("Invalid pending Fabrial activation.");
  }
  for(const record of state.equipmentRecords??[])check(record.item);
}

/** Pure command on an authoritative snapshot; caller supplies authenticated owner. */
export function requestFabrialSwitch(state:ConflictState, kingdom:string, formationId:string, itemId:string|null) {
  validateEquipment(state);
  const next=structuredClone(state);
  const f=[...next.formations,...next.arrivals.map(a=>a.formation)].find(f=>f.id===formationId&&f.kingdom===kingdom);
  if(!f)throw Error("Select your own formation.");
  const e=f.equipment;
  if(!e)throw Error("This formation carries no Fabrials.");
  if(itemId===null || itemId===e.active)delete e.pending;
  else {
    const item=e.items.find(i=>i.id===itemId);
    if(!item || !FABRIAL_RULES[item.kind].reusable)throw Error("Select a carried persistent Fabrial.");
    // Repeating the same command must not postpone an existing switch.
    if(e.pending?.id!==itemId)e.pending={id:itemId,afterCycle:state.cycle+1};
  }
  return next;
}

export function splitEquipment(e:FormationEquipment|undefined, childIds:string[]) {
  if(new Set(childIds).size!==childIds.length || childIds.some(id=>!e?.items.some(i=>i.id===id)))throw Error("Split equipment must be carried unique instances.");
  const part=(child:boolean):FormationEquipment|undefined=>{
    if(!e)return undefined;
    const items=e.items.filter(i=>childIds.includes(i.id)===child).map(i=>({...i}));
    return {items,...(items.some(i=>i.id===e.active)?{active:e.active}:{}),...(items.some(i=>i.id===e.pending?.id)?{pending:{...e.pending!}}:{})};
  };
  return {parent:part(false),child:part(true)};
}

/** Largest means individual troop count, never Power; IDs break ties bytewise. */
export function mergeEquipment(rows:Carrier[]):FormationEquipment|undefined {
  if(!rows.some(f=>f.equipment))return undefined;
  const order=ranked(rows);
  const items=order.flatMap(f=>f.equipment?.items??[]).map(i=>({...i})).sort((a,b)=>compare(a.id,b.id));
  if(new Set(items.map(i=>i.id)).size!==items.length)throw Error("Cannot merge duplicate Fabrial instances.");
  const active=order.find(f=>f.equipment?.active)?.equipment?.active;
  const pending=order.find(f=>f.equipment?.pending)?.equipment?.pending;
  return {items,...(active?{active}:{}),...(pending && pending.id!==active?{pending:{...pending}}:{})};
}

/** Same-kingdom combat is already pooled by the resolver. Consolidate equipment
 * for that same local force before effects, independent of route-source choice. */
export function consolidateEquipment(rows:Carrier[]) {
  const equipment=mergeEquipment(rows);
  if(!equipment)return;
  const recipient=ranked(rows)[0];
  for(const f of rows)delete f.equipment;
  recipient.equipment=equipment;
}
export function protectWithEquipment(state:ConflictState,rows:Carrier[],raw:{survivors:UnitCounts;casualties:UnitCounts},cycle:number,events:Event[],consumeOnEngagement:boolean) {
  consolidateEquipment(rows);
  const carrier=rows.find(f=>f.equipment), e=carrier?.equipment;
  if(!carrier||!e)return raw;
  const active=e.items.find(i=>i.id===e.active);
  // Definitions, not lifecycle branches, select devices with casualty protection.
  const persistent=active && FABRIAL_RULES[active.kind].casualtyProtection>0?active:undefined;
  const disposable=consumeOnEngagement ? [...e.items].sort((a,b)=>compare(a.id,b.id)).find(i=>!FABRIAL_RULES[i.kind].reusable&&FABRIAL_RULES[i.kind].casualtyProtection>0):undefined;
  const item=persistent??disposable;if(!item)return raw;
  const protectedLosses=applyFabrialCasualtyProtection(item.kind,raw);
  if(!FABRIAL_RULES[item.kind].reusable) {
    e.items=e.items.filter(i=>i.id!==item.id);
    (state.equipmentRecords??=[]).push({item:{...item},formation:carrier.id,position:carrier.position,cycle,status:"consumed",reason:"Consumed for this engagement, including zero-prevention rounding."});
  }
  events.push({type:"fabrial",formation:carrier.id,kingdom:carrier.kingdom,item:item.id,action:FABRIAL_RULES[item.kind].reusable?"protected":"consumed",reason:`${FABRIAL_RULES[item.kind].name} prevented ${protectedLosses.prevented} calculated casualties.`});
  return protectedLosses;
}

export function retainPooledEquipment(rows:Carrier[]) {
  const carrier=rows.find(f=>f.equipment);
  if(carrier&&!totalUnits(carrier.units)) {
    const survivor=ranked(rows.filter(f=>totalUnits(f.units)))[0];
    if(survivor){survivor.equipment=carrier.equipment;delete carrier.equipment;}
  }
}

export function finishFabrialSwitches(state:ConflictState,cycle:number,events:Event[]) {
  for(const f of [...state.formations,...state.arrivals.map(a=>a.formation)].sort((a,b)=>compare(a.id,b.id))) {
    const e=f.equipment;
    if(e?.pending && e.pending.afterCycle<=cycle) {
      e.active=e.pending.id;delete e.pending;
      events.push({type:"fabrial",formation:f.id,kingdom:f.kingdom,item:e.active,action:"activated",reason:"Pending Fabrial becomes active after resolution."});
    }
  }
}

/** Preserve residual equipment (e.g. unspent consumables) on removed armies.
 * Combat already settles reusable loss; other disposal rules remain explicit. */
export function archiveEquipment(state:ConflictState,f:Carrier & {position?:string},cycle:number,events:Event[],status:EquipmentRecord["status"]="unsettled",reason="Formation destroyed; equipment outcome awaits settlement.") {
  for(const item of f.equipment?.items??[]) {
    (state.equipmentRecords??=[]).push({item:{...item},formation:f.id,position:f.position,cycle,status,reason});
    events.push({type:"fabrial",formation:f.id,kingdom:f.kingdom,item:item.id,action:status,reason});
  }
  delete f.equipment;
}
