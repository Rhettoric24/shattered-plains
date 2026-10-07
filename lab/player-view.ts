import { intelText } from "../convex/intelligenceRules";
import {
  approveRoute,
  extendRoute,
  holdOrder,
} from "../conflict-board/planning";
import { totalUnits, unitKeys, type UnitCounts } from "../convex/rules";
import { retreatShade, type WorkshopCommand } from "./workshop";
import { attachRouteDrag } from "./route-drag";
import { equipmentMarkup, equipmentLabMarkup, type EquipmentCommand } from "./equipment";
import type {
  ConflictView,
  MilitaryIntel,
  projectJournal,
} from "../conflict-board/disclosure";
import type { Order } from "../conflict-board/types";
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let disposeDrag: (() => void) | undefined;
export function renderPlayerView(
  root: HTMLElement,
  view: ConflictView,
  intel: MilitaryIntel,
  journal: ReturnType<typeof projectJournal>,
  actions: {
    selected: string;
    consumableTest:boolean;
    setConsumableTest:(on:boolean)=>void;
    equipment: (id:string,command:EquipmentCommand)=>void;
    select: (id: string) => void;
    workshop: (id: string, command: WorkshopCommand) => void;
    nominate: (id: string, position: string) => void;
    scientist: () => void;
    viewer: (id: string) => void;
    fog: (on: boolean) => void;
    intel: (id: string, n: number) => void;
    order: (id: string, order: Order) => void;
    resolve: () => void;
    save: () => void;
    load: () => void;
  },
) {
  const reopen = !!root.querySelector<HTMLDialogElement>("#playerArmyDialog")?.open;
  disposeDrag?.();
  let selected = view.own.some(f => f.formation.id === actions.selected) ? actions.selected : view.own[0]?.formation.id ?? "",
    draft: string[] | null = null;
  const name = (id: string) =>
    view.kingdoms.find((k) => k.id === id)?.name ?? id;
  root.innerHTML = `<header><h1>Conflict Board · Player view</h1><p>Lab visibility simulation only. This browser still holds full scientist state; this is not secure multiplayer fog.</p><button id="scientistMode">Return to scientist mode</button></header><section><label>Viewing kingdom<select id="viewKingdom">${view.kingdoms.map((k) => `<option value="${esc(k.id)}" ${k.id === view.viewer ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label><label><input id="fogToggle" type="checkbox" ${view.fog ? "checked" : ""}> Battlefield fog${view.highstorm?" · Highstorm visibility":""}</label><details><summary>Lab Intel controls · this viewer against each rival</summary>${view.kingdoms
    .filter((k) => k.id !== view.viewer)
    .map(
      (k) =>
        `<label>${esc(k.name)} Military Intel (0–100)<input type="number" min="0" max="100" data-intel="${esc(k.id)}" value="${intel[k.id] ?? 0}"></label>`,
    )
    .join(
      "",
    )}<p>These are simulated values, independent for every viewer/rival pair.</p></details><p>Cycle ${view.cycle}</p><button id="playerResolve">Resolve next cycle</button><button id="playerSave">Save in this browser</button><button id="playerLoad">Load saved</button><p id="playerError" role="alert"></p></section><section class="player-battlefield"><h2>Battlefield</h2><p class="muted">Tap an army for orders. Mouse: drag. Touch: hold, then drag. Release to review your route.</p><div class="board player-board">${[
    ...view.board.positions,
  ]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p) => {
      const known = !view.fog || view.visiblePositions.includes(p.id),
        contacts = view.contacts.filter((c) => c.position === p.id);
      return `<div class="tile ${p.kind !== "field" ? "wide" : ""} ${known ? "" : "fogged"}" data-player-position="${esc(p.id)}"><button data-player-node="${esc(p.id)}">${esc(p.name)}</button><p>${known ? "In view" : contacts.length ? "Intel reports presence · outside vision" : "Unknown · outside vision"}</p>${view.own
        .filter((f) => f.formation.position === p.id)
        .map(
          (f) =>
            `<button data-own="${esc(f.formation.id)}">${esc(f.formation.name)} · ${totalUnits(f.formation.units)} troops · Power ${f.power}</button>`,
        )
        .join(
          "",
        )}${contacts.map((c) => `<p class="enemy-contact">${esc(name(c.kingdom))} force · Power ${esc(intelText(c.power))}</p><details><summary>Observation quality</summary><p>${c.physicallyVisible ? "Physically visible" : "Outside vision"} · ${c.level === 3 ? "Exact" : c.level === 2 ? "Estimated" : "Basic"}</p></details>`).join("")}</div>`;
    })
    .join(
      "",
    )}</div></section><section id="playerArmySection"><h2 id="playerArmyTitle">Your army</h2><div id="ownInfo"></div><button id="playerMove">Move</button><button id="playerHold">Hold</button><button id="playerRaid">Raid</button><button id="playerSplit">Split</button><button id="playerReinforce">Reinforcements · Lab</button><p id="playerRaidHint" class="muted"></p><div id="splitEditor" hidden><h3>Split a detachment</h3><p>Choose troops to detach; leave at least one troop behind.</p><div class="units">${unitKeys().map(k=>`<label>${esc(k)}<input id="splitUnit-${k}" type="number" min="0" step="1" value="0"></label>`).join("")}</div><button id="playerSplitConfirm">Create detachment</button></div><p id="draftPath"></p><button id="playerConfirm">Confirm route</button><button id="playerCancel">Cancel</button></section><section><h2>Your battle reports</h2><p>Only your battle results are shown here. The full debug journal remains in scientist mode.</p>${journal.map((e) => `<p>Cycle ${e.cycle} · ${esc(e.position)} · ${e.won ? "Held the position" : "Did not hold the position"} · Your losses: ${totalUnits(e.casualties)}</p>`).join("")}</section>`;
  const el = (id: string) => root.querySelector<HTMLElement>("#" + id)!;
  const act = (id: string, fn: () => void) =>
    (el(id).onclick = () => {
      try {
        fn();
      } catch (e) {
        el("playerError").textContent = (e as Error).message;
        const modalError=root.querySelector("#playerModalError");if(modalError)modalError.textContent=(e as Error).message;
      }
    });
  const army = () =>
    view.own.find((f) => f.formation.id === selected)?.formation;
  el("playerCancel").insertAdjacentHTML("afterend", `<div id="playerWorkshop"><p class="history-key">Purple retreat trail: lighter = nearest fallback, darker = farther back. Numbers show fallback order.</p><h3>Lab-only unit editor</h3><p>These controls create/edit fake troops only. Reinforcements arrive next cycle through the normal side entry, not at the selected army.</p><label>Name<input id="playerName"></label><div class="units">${unitKeys().map(k=>`<label>${esc(k)}<input id="playerUnit-${k}" type="number" min="0" step="1"></label>`).join("")}</div><button id="playerEdit">Apply army edit</button><button id="playerAdd">Add these units</button><button id="playerCreate">Create army here</button><button id="playerArrive">Queue these troops next cycle</button><button id="playerRemove">Remove army</button><p>Apply replaces troop counts; Add adds the entered counts. Split subtracts them and must leave troops in both armies. Cargo-bearing armies cannot split.</p><p>${view.ownArrivals.length} of your reinforcement arrivals pending.</p><h3>Standing orders</h3><label>After defeat<select id="playerDefeat"><option value="continue">Continue</option><option value="pause">Pause</option></select></label><button id="playerSaveDefeat">Save standing behavior</button><details><summary>Advanced route / merge controls</summary><label>Approved route (comma separated)<input id="playerRoute"></label><button id="playerApprove">Approve typed route</button><label>Merge position<select id="playerMergePosition">${view.board.positions.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label><button id="playerNominate">Retain selected source on merge</button><p id="playerMergeStatus"></p></details></div>`);
  const input = (id: string) => el(id) as HTMLInputElement;
  el("ownInfo").insertAdjacentHTML("afterend",'<details id="playerEquipment"><summary>Fabrials · carried equipment</summary><div id="playerEquipmentContents"></div></details>');
  el("playerWorkshop").insertAdjacentHTML("beforeend",`<h3>Fabrial test setup</h3><label>Equipment carrier<select id="equipmentCarrier"></select></label><div id="carrierEquipment"></div>${equipmentLabMarkup("playerFabrial")}`);
  el("playerWorkshop").insertAdjacentHTML("beforeend",`<label><input id="playerConsumableTest" type="checkbox" ${actions.consumableTest?"checked":""}> Experimental: consume one Painrial per engagement. Half-Shard takes priority.</label><p>Automatic Painrial combat use is off by default pending Board design confirmation.</p>`);
  el("playerWorkshop").insertAdjacentHTML("beforeend",`<details><summary>Your equipment records (${view.ownEquipmentRecords.length})</summary>${view.ownEquipmentRecords.map(r=>`<p>${esc(r.item.kind)} · ${esc(r.item.id)} · ${esc(r.status)} · ${esc(r.reason)}</p>`).join("")}</details>`);
  input("playerConsumableTest").onchange=e=>actions.setConsumableTest((e.target as HTMLInputElement).checked);
  const dialog = document.createElement("dialog");
  dialog.id = "playerArmyDialog";
  dialog.setAttribute("aria-labelledby", "playerArmyTitle");
  dialog.innerHTML = '<button id="playerClose" aria-label="Close army">Close ×</button>';
  dialog.append(el("playerArmySection"));root.append(dialog);
  el("ownInfo").insertAdjacentHTML("beforebegin",'<p id="playerModalError" role="alert"></p>');
  act("playerClose",()=>dialog.close());
  dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close()});
  const routeBar = document.createElement("div");routeBar.id="playerRouteBar";
  for(const id of ["draftPath","playerConfirm","playerCancel"])routeBar.append(el(id));
  routeBar.insertAdjacentHTML("beforeend",'<p id="routeFeedback" role="status"></p><button id="playerClear">Clear route</button>');
  root.append(routeBar);
  act("playerClear",()=>{draft=[];update()});
  const fillWorkshop = () => {
    const f = army();
    el("playerWorkshop").hidden = !f;
    input("playerName").value = f?.name ?? "";
    for (const k of unitKeys()) input(`playerUnit-${k}`).value = String(f?.units[k] ?? 0);
    input("playerDefeat").value = f?.order.onDefeat ?? "pause";
    input("playerRoute").value = f?.order.route.join(", ") ?? "";
    input("playerMergePosition").value = f?.position ?? view.board.approach;
    el("playerMergeStatus").textContent = "";
    for(const k of unitKeys()) input(`splitUnit-${k}`).value="0";
    el("splitEditor").hidden=true;
    el("splitEditor").querySelector(".split-equipment")?.remove();
    el("splitEditor").insertAdjacentHTML("beforeend",`<div class="split-equipment"><h4>Equipment for the detachment</h4><p>Unchecked devices stay with the parent. Activation state follows each selected item.</p>${(f?.equipment?.items??[]).map(i=>`<label><input type="checkbox" data-split-equipment="${esc(i.id)}"> ${esc(i.kind)} · ${esc(i.id)}</label>`).join("")}</div>`);
    input("equipmentCarrier").innerHTML=[...view.own.map(g=>g.formation),...view.ownArrivals.map(a=>a.formation)].map(g=>`<option value="${esc(g.id)}">${esc(g.name)}${view.ownArrivals.some(a=>a.formation.id===g.id)?" (reinforcements)":""}</option>`).join("");
    input("equipmentCarrier").value=f?.id??"";
    fillEquipment();
  };
  const fillEquipment=()=>{
    const f=army();el("playerEquipmentContents").innerHTML=f?equipmentMarkup(f,"player"):"No selected army.";
    root.querySelectorAll<HTMLElement>("[data-player-switch]").forEach(b=>b.onclick=()=>actions.equipment(selected,{kind:"switch",id:b.dataset.playerSwitch!}));
    const carrier=[...view.own.map(g=>g.formation),...view.ownArrivals.map(a=>a.formation)].find(g=>g.id===input("equipmentCarrier").value);
    el("carrierEquipment").textContent=(carrier?.equipment?.items??[]).map(i=>`${i.kind} · ${i.id}`).join(", ")||"No devices";
    input("playerFabrialRemoveId").innerHTML=(carrier?.equipment?.items??[]).map(i=>`<option value="${esc(i.id)}">${esc(i.kind)} · ${esc(i.id)}</option>`).join("");
  };
  input("equipmentCarrier").onchange=fillEquipment;
  act("playerFabrialGive",()=>actions.equipment(input("equipmentCarrier").value,{kind:"give",fabrial:input("playerFabrialKind").value as any,active:input("playerFabrialActive").checked}));
  act("playerFabrialRemove",()=>actions.equipment(input("equipmentCarrier").value,{kind:"remove",id:input("playerFabrialRemoveId").value}));
  const update = () => {
    const f = army();
    const own = view.own.find(g=>g.formation.id===selected), stats=own?.stats;
    el("playerArmyTitle").textContent=f?.name??"Your army";
    el("ownInfo").innerHTML = f ? `<p class="army-specialization">${esc(stats?.specialization??"None")} specialization · ${esc(f.position)}</p><div class="army-unit-summary">${unitKeys().filter(k=>f.units[k]>0).map(k=>`<span><strong>${f.units[k]}</strong> ${esc(k)}</span>`).join("")}</div><div class="army-stat-grid">${[["Power",own?.power],["Speed",stats?.speed],["Survivability",stats?.survive],["Plunder",stats?.plunder]].map(([label,n])=>`<div><small>${label}</small><strong>${Number(n??0).toFixed(1)}</strong></div>`).join("")}</div><p>Normalized Speed / Survive / Plunder<br><strong>${stats?.ratings.map(n=>n.toFixed(2)).join(" / ")??"—"}</strong></p><p>Cargo <strong>${own?.cargo??0} / ${own?.capacity??0}</strong> · Standing order <strong>${esc(f.order.kind)}${f.order.paused?" (paused)":""}</strong></p><p class="muted">Approved: ${esc(f.order.route.join(" → ")||"Hold")}<br>Retreat: ${esc(f.history.join(" → "))}</p>` : "No deployed formations.";
    const ready=!!f && view.raidReady.some(h=>h.position===f.position&&h.ready);
    (el("playerRaid") as HTMLButtonElement).disabled=!ready;
    el("playerRaidHint").textContent=ready?"Raid this flank next resolution if you retain control.":view.raidReady.some(h=>h.position===f?.position)?"Foothold established. Retain this flank to become Raid-ready.":"Reach a flank Raid objective and establish a foothold before raiding. The original defender cannot raid its own logistics.";
    (el("playerSplit") as HTMLButtonElement).disabled=(own?.cargo??0)>0;
    el("playerSplit").title=(own?.cargo??0)>0?"Bank or resolve carried cargo before splitting.":"Detach troops from this army";
    routeBar.hidden=draft===null;
    el("draftPath").textContent =
      draft && f ? [f.position, ...draft].join(" → ") : "";
    root
      .querySelectorAll<HTMLElement>("[data-player-position]")
      .forEach((e) => {
        const id = e.dataset.playerPosition!, shade = f ? retreatShade(f, id) : null;
        e.classList.toggle("current", f?.position === id);
        e.classList.toggle("route", f?.order.route.includes(id) ?? false);
        e.classList.toggle("fallback", !!shade);
        e.classList.toggle("retreat-shade", !!shade);
        e.style.setProperty("--retreat-color", shade?.color ?? "transparent");
        e.classList.toggle("proposed", draft?.includes(id) ?? false);
        let marks = e.querySelector<HTMLElement>(".pathMarks");
        if (!marks) { marks = document.createElement("p"); marks.className = "pathMarks"; e.append(marks); }
        marks.textContent = [f?.position === id ? "● Current" : "", shade ? `↶ Fallback ${shade.depth}` : "", f?.order.route.includes(id) ? "→ Approved" : "", draft?.includes(id) ? `◇ ${draft.map((p,i)=>p===id?i+1:null).filter(Boolean).join(", ")}` : ""].filter(Boolean).join(" · ");
      });
    root.querySelectorAll<HTMLElement>("[data-own]").forEach(e=>{
      e.classList.toggle("selected", e.dataset.own === selected);
      e.setAttribute("aria-pressed", String(e.dataset.own === selected));
    });
  };
  act("playerSplit",()=>{el("splitEditor").hidden=false;el("splitEditor").scrollIntoView({block:"nearest"})});
  act("playerSplitConfirm",()=>actions.workshop(selected,{kind:"split",name:input("playerName").value,
    childEquipmentIds:[...root.querySelectorAll<HTMLInputElement>("[data-split-equipment]:checked")].map(e=>e.dataset.splitEquipment!),
    units:Object.fromEntries(unitKeys().map(k=>[k,Number(input(`splitUnit-${k}`).value)])) as UnitCounts,
    onDefeat:input("playerDefeat").value as Order["onDefeat"]}));
  act("playerReinforce",()=>{el("playerWorkshop").scrollIntoView({block:"start"});input("playerName").focus()});
  act("playerSaveDefeat",()=>{const f=army();if(f)actions.order(selected,{...f.order,onDefeat:input("playerDefeat").value as Order["onDefeat"]})});
  for (const [button, kind] of [["Edit","edit"],["Add","add"],["Create","create"],["Arrive","arrive"],["Remove","remove"]] as const) {
    act(`player${button}`, () => actions.workshop(selected, {kind, name: input("playerName").value,
      units: Object.fromEntries(unitKeys().map(k=>[k, Number(input(`playerUnit-${k}`).value)])) as UnitCounts,
      onDefeat: input("playerDefeat").value as Order["onDefeat"]}));
  }
  act("playerApprove", () => {
    const f = army(); if (!f) return;
    approveRoute(view.board, f, input("playerRoute").value.split(",").map(p=>p.trim()).filter(Boolean), input("playerDefeat").value as Order["onDefeat"]);
    actions.order(selected, f.order);
  });
  act("playerNominate", () => { actions.nominate(selected, input("playerMergePosition").value); el("playerMergeStatus").textContent = "Selected source nominated for this merge position."; });
  act("scientistMode", ()=>{disposeDrag?.();disposeDrag=undefined;actions.scientist()});
  act("playerResolve", ()=>{if(draft!==null)throw Error("Confirm or Cancel the proposed route first.");actions.resolve()});
  act("playerSave", actions.save);
  act("playerLoad", actions.load);
  (el("viewKingdom") as HTMLSelectElement).onchange = (e) =>
    actions.viewer((e.target as HTMLSelectElement).value);
  (el("fogToggle") as HTMLInputElement).onchange = (e) =>
    actions.fog((e.target as HTMLInputElement).checked);
  root.querySelectorAll<HTMLInputElement>("[data-intel]").forEach(
    (e) =>
      (e.onchange = () => {
        const n = Number(e.value);
        if (e.value.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
          el("playerError").textContent =
            "Military Intel must be between 0 and 100.";
          return;
        }
        actions.intel(e.dataset.intel!, n);
      }),
  );
  root.querySelectorAll<HTMLElement>("[data-own]").forEach(
    (e) =>
      (e.onclick = () => {
        selected = e.dataset.own!;
        actions.select(selected);
        draft = null;
        fillWorkshop();
        update();
        dialog.showModal();
      }),
  );
  act("playerMove", () => {
    if (army()) {
      draft = [];
      dialog.close();
      update();
      root.querySelector(".player-battlefield")?.scrollIntoView({block:"start"});
    }
  });
  act("playerCancel", () => {
    draft = null;
    update();
  });
  act("playerHold", () => {
    if (army()) actions.order(selected, {...holdOrder(), onDefeat: input("playerDefeat").value as Order["onDefeat"]});
  });
  act("playerRaid", () => {
    const f = army();
    if (!f) return;
    if (!view.raidReady.some((h) => h.position === f.position && h.ready))
      throw Error("Establish a flank foothold first.");
    actions.order(selected, {
      kind: "raid",
      route: [],
      onDefeat: input("playerDefeat").value as Order["onDefeat"],
    });
  });
  act("playerConfirm", () => {
    const f = army();
    if (!f || draft === null) return;
    approveRoute(view.board, f, draft, input("playerDefeat").value as Order["onDefeat"]);
    actions.order(selected, f.order);
  });
  root.querySelectorAll<HTMLElement>("[data-player-node]").forEach(
    (e) =>
      (e.onclick = () => {
        try {
          const f = army();
          if (f && draft !== null) {
            draft = extendRoute(
              view.board,
              f.position,
              draft,
              e.dataset.playerNode!,
            );
            update();
          }
        } catch (err) {
          el("playerError").textContent = (err as Error).message;
        }
      }),
  );
  disposeDrag=attachRouteDrag(root,{
    begin:id=>{selected=id;actions.select(id);draft=[];dialog.close();fillWorkshop();update();el("routeFeedback").textContent="Trace connected squares. Release, then Confirm."},
    visit:id=>{
      const f=army();if(!f||draft===null)return;
      try{draft=extendRoute(view.board,f.position,draft,id);el("routeFeedback").textContent="Release to review. Backtrack to erase steps.";update()}
      catch {el("routeFeedback").textContent="That square is not connected. Return to the last route square.";}
    },
    cancel:()=>{draft=null;update()},
  });
  fillWorkshop();
  update();
  if(reopen && army()) dialog.showModal();
}
