import { intelText } from "../convex/intelligenceRules";
import {
  approveRoute,
  extendRoute,
  holdOrder,
} from "../conflict-board/planning";
import { totalUnits } from "../convex/rules";
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
  let selected = view.own[0]?.formation.id ?? "",
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
  const update = () => {
    const f = army();
    el("ownInfo").textContent = f
      ? `${f.name} · ${f.position} · Approved: ${f.order.route.join(" → ") || f.order.kind} · Retreat: ${f.history.join(" → ")} · Composition: ${JSON.stringify(f.units)}`
      : "No deployed formations.";
    el("draftPath").textContent =
      draft && f ? [f.position, ...draft].join(" → ") : "";
    root
      .querySelectorAll<HTMLElement>("[data-player-position]")
      .forEach((e) =>
        e.classList.toggle(
          "proposed",
          draft?.includes(e.dataset.playerPosition!) ?? false,
        ),
      );
  };
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
        draft = null;
        update();
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
    if (army()) actions.order(selected, holdOrder());
  });
  act("playerRaid", () => {
    const f = army();
    if (!f) return;
    if (!view.raidReady.some((h) => h.position === f.position && h.ready))
      throw Error("Establish a flank foothold first.");
    actions.order(selected, {
      kind: "raid",
      route: [],
      onDefeat: f.order.onDefeat,
    });
  });
  act("playerConfirm", () => {
    const f = army();
    if (!f || draft === null) return;
    approveRoute(view.board, f, draft, f.order.onDefeat);
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
  update();
}
