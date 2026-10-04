import { intelText } from "../convex/intelligenceRules";
import {
  approveRoute,
  extendRoute,
  holdOrder,
} from "../conflict-board/planning";
import { totalUnits, unitKeys, type UnitCounts } from "../convex/rules";
import { retreatShade, type WorkshopCommand } from "./workshop";
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
export function renderPlayerView(
  root: HTMLElement,
  view: ConflictView,
  intel: MilitaryIntel,
  journal: ReturnType<typeof projectJournal>,
  actions: {
    selected: string;
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
  let selected = view.own.some(f => f.formation.id === actions.selected) ? actions.selected : view.own[0]?.formation.id ?? "",
    draft: string[] | null = null;
  const name = (id: string) =>
    view.kingdoms.find((k) => k.id === id)?.name ?? id;
  root.innerHTML = `<header><h1>Conflict Board · Player view</h1><p>Lab visibility simulation only. This browser still holds full scientist state; this is not secure multiplayer fog.</p><button id="scientistMode">Return to scientist mode</button></header><section><label>Viewing kingdom<select id="viewKingdom">${view.kingdoms.map((k) => `<option value="${esc(k.id)}" ${k.id === view.viewer ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label><label><input id="fogToggle" type="checkbox" ${view.fog ? "checked" : ""}> Adjacency fog</label><details><summary>Lab Intel controls · this viewer against each rival</summary>${view.kingdoms
    .filter((k) => k.id !== view.viewer)
    .map(
      (k) =>
        `<label>${esc(k.name)} Military Intel (0–100)<input type="number" min="0" max="100" data-intel="${esc(k.id)}" value="${intel[k.id] ?? 0}"></label>`,
    )
    .join(
      "",
    )}<p>These are simulated values, independent for every viewer/rival pair.</p></details><p>Cycle ${view.cycle}</p><button id="playerResolve">Resolve next cycle</button><button id="playerSave">Save in this browser</button><button id="playerLoad">Load saved</button><p id="playerError" role="alert"></p></section><section><div class="board">${[
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
    )}</div></section><section><h2>Your army</h2><div id="ownInfo"></div><button id="playerMove">Move · tap connected positions</button><button id="playerHold">Hold</button><button id="playerRaid">Raid</button><p id="draftPath"></p><button id="playerConfirm">Confirm route</button><button id="playerCancel">Cancel</button></section><section><h2>Your battle reports</h2><p>Only your battle results are shown here. The full debug journal remains in scientist mode.</p>${journal.map((e) => `<p>Cycle ${e.cycle} · ${esc(e.position)} · ${e.won ? "Held the position" : "Did not hold the position"} · Your losses: ${totalUnits(e.casualties)}</p>`).join("")}</section>`;
  const el = (id: string) => root.querySelector<HTMLElement>("#" + id)!;
  const act = (id: string, fn: () => void) =>
    (el(id).onclick = () => {
      try {
        fn();
      } catch (e) {
        el("playerError").textContent = (e as Error).message;
      }
    });
  const army = () =>
    view.own.find((f) => f.formation.id === selected)?.formation;
  el("playerCancel").insertAdjacentHTML("afterend", `<div id="playerWorkshop"><p class="history-key">Purple retreat trail: lighter = nearest fallback, darker = farther back. Numbers show fallback order.</p><h3>Army workshop · Lab edits</h3><p>These controls create/edit fake troops only. Reinforcements arrive next cycle through the normal side entry, not at the selected army.</p><label>Name<input id="playerName"></label><div class="units">${unitKeys().map(k=>`<label>${esc(k)}<input id="playerUnit-${k}" type="number" min="0" step="1"></label>`).join("")}</div><label>After defeat<select id="playerDefeat"><option value="continue">Continue</option><option value="pause">Pause</option></select></label><button id="playerEdit">Apply army edit</button><button id="playerAdd">Add these units</button><button id="playerSplit">Split these counts off</button><button id="playerCreate">Create army here</button><button id="playerArrive">Queue these troops next cycle</button><button id="playerRemove">Remove army</button><p>Apply replaces troop counts; Add adds the entered counts. Split subtracts them and must leave troops in both armies. Cargo-bearing armies cannot split.</p><p>${view.ownArrivals.length} of your reinforcement arrivals pending.</p><details><summary>Advanced route / merge controls</summary><label>Approved route (comma separated)<input id="playerRoute"></label><button id="playerApprove">Approve typed route</button><label>Merge position<select id="playerMergePosition">${view.board.positions.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label><button id="playerNominate">Retain selected source on merge</button><p id="playerMergeStatus"></p></details></div>`);
  const input = (id: string) => el(id) as HTMLInputElement;
  const fillWorkshop = () => {
    const f = army();
    el("playerWorkshop").hidden = !f;
    input("playerName").value = f?.name ?? "";
    for (const k of unitKeys()) input(`playerUnit-${k}`).value = String(f?.units[k] ?? 0);
    input("playerDefeat").value = f?.order.onDefeat ?? "pause";
    input("playerRoute").value = f?.order.route.join(", ") ?? "";
    input("playerMergePosition").value = f?.position ?? view.board.approach;
    el("playerMergeStatus").textContent = "";
  };
  const update = () => {
    const f = army();
    el("ownInfo").textContent = f
      ? `${f.name} · ${f.position} · Approved: ${f.order.route.join(" → ") || f.order.kind} · Retreat: ${f.history.join(" → ")} · Composition: ${JSON.stringify(f.units)}`
      : "No deployed formations.";
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
        marks.textContent = [f?.position === id ? "● Current" : "", shade ? `↶ Fallback ${shade.depth}` : "", f?.order.route.includes(id) ? "→ Approved" : "", draft?.includes(id) ? "◇ Proposed" : ""].filter(Boolean).join(" · ");
      });
    root.querySelectorAll<HTMLElement>("[data-own]").forEach(e=>{
      e.classList.toggle("selected", e.dataset.own === selected);
      e.setAttribute("aria-pressed", String(e.dataset.own === selected));
    });
  };
  for (const [button, kind] of [["Edit","edit"],["Add","add"],["Split","split"],["Create","create"],["Arrive","arrive"],["Remove","remove"]] as const) {
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
  act("scientistMode", actions.scientist);
  act("playerResolve", actions.resolve);
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
        el("ownInfo").scrollIntoView({block:"nearest"});
      }),
  );
  act("playerMove", () => {
    if (army()) {
      draft = [];
      update();
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
  fillWorkshop();
  update();
}
