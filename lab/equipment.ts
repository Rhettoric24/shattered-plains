import { fabrialDefinitions, requestFabrialSwitch, validateEquipment } from "../conflict-board/fabrials";
import type { ConflictState, Formation } from "../conflict-board/types";
import type { FabrialKey } from "../convex/fabrialRules";
export type EquipmentCommand = { kind:"switch";id:string|null } | {kind:"give";fabrial:FabrialKey;active:boolean} | {kind:"remove";id:string};
/** Test acquisition only. Production adapters supply owned instance IDs instead. */
export function labEquipmentCommand(state:ConflictState,owner:string,formation:string,command:EquipmentCommand,uid:()=>string) {
  if(command.kind==="switch")return requestFabrialSwitch(state,owner,formation,command.id);
  const next=structuredClone(state);
  const f=[...next.formations,...next.arrivals.map(a=>a.formation)].find(f=>f.id===formation&&f.kingdom===owner);
  if(!f)throw Error("Select your own equipment carrier.");
  const e=f.equipment??={items:[]};
  if(command.kind==="give") {
    if(!fabrialDefinitions[command.fabrial])throw Error("Unknown Fabrial.");
    const item={id:uid(),owner,kind:command.fabrial};e.items.push(item);
    if(command.active && fabrialDefinitions[item.kind].reusable){e.active=item.id;delete e.pending;}
  } else {
    const item=e.items.find(i=>i.id===command.id);if(!item)throw Error("Unknown carried item.");
    e.items=e.items.filter(i=>i.id!==item.id);
    if(e.active===item.id)delete e.active;if(e.pending?.id===item.id)delete e.pending;
    (next.equipmentRecords??=[]).push({item,formation:f.id,cycle:state.cycle,status:"removed-in-lab",reason:"Explicit Lab equipment removal."});
  }
  validateEquipment(next);return next;
}
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function equipmentMarkup(f:Pick<Formation,"equipment">,prefix:string) {
  const e=f.equipment;
  return `<h3>Fabrials</h3><p>One active persistent device. Switching takes effect after the next resolution; your army can still act.</p><ul class="fabrial-list">${(e?.items??[]).map(i=>{
    const rule=fabrialDefinitions[i.kind];
    const status=!rule.reusable?"Consumable":e?.active===i.id?"Active":e?.pending?.id===i.id?"Activates next resolution":"Carried";
    return `<li><strong>${esc(rule.name)}</strong> — ${status}${rule.reusable?`<button data-${prefix}-switch="${esc(i.id)}" ${e?.pending?.id===i.id?"disabled":""}>${e?.active===i.id?"Keep active / cancel switch":"Activate next resolution"}</button>`:""}</li>`;
  }).join("")||"<li>No Fabrials carried.</li>"}</ul><p class="muted">Every carried reusable device risks loss on defeat, whether active or inactive. Default band chances: 10 / 25 / 50 / 75%; annihilation: 100%. Soulcaster's Board reward effect is still deferred.</p>`;
}
export function equipmentLabMarkup(prefix:string) {
  return `<details><summary>Lab-only Fabrial setup</summary><label>Device<select id="${prefix}Kind">${Object.entries(fabrialDefinitions).map(([key,r])=>`<option value="${key}">${r.name}</option>`).join("")}</select></label><label><input type="checkbox" id="${prefix}Active"> Start active (test setup only; replaces active slot)</label><button id="${prefix}Give">Give one device</button><label>Instance to remove<select id="${prefix}RemoveId"></select></label><button id="${prefix}Remove">Remove device (Lab only)</button></details>`;
}
