import { cargoAmount, cargoCapacity, DEFAULT_TREASURY } from "../conflict-board/cargo";
import { emptyUnits, totalUnits, unitKeys } from "../convex/rules";
import { resolveCycle } from "../conflict-board/resolver";
import { formationStats } from "../conflict-board/stats";
import {
  connected,
  holdOrder,
  splitFormation,
  approveRoute,
  extendRoute,
} from "../conflict-board/planning";
import type { CycleResult, Formation } from "../conflict-board/types";
import { defaults, presetNames, scenario } from "./scenarios";

let state = scenario(),
  config = structuredClone(defaults),
  selected = state.formations[1].id,
  history: CycleResult[] = [];
let serial = 0,
  preferences: Record<string, string> = {};
let inspectorOpen = false,
  proposed: string[] | null = null;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const option = (id: string, name: string, active?: string) =>
  `<option value="${escape(id)}" ${id === active ? "selected" : ""}>${escape(name)}</option>`;
const formation = () => state.formations.find((f) => f.id === selected);
const modelName = (model?: string) => model === "experimental-survival" ? "Experimental Survival" : "Current";
const uid = () => `lab-${Date.now()}-${serial++}`;
const action = (id: string, fn: () => void) =>
  $(id).addEventListener("click", () => {
    try {
      fn();
      $("error").textContent = "";
    } catch (e) {
      $("error").textContent = (e as Error).message;
      const panelError = document.getElementById("armyError");
      if (panelError) panelError.textContent = (e as Error).message;
    }
  });
const unitInputs = () =>
  Object.fromEntries(
    unitKeys().map((k) => [k, Number(value(`unit-${k}`))]),
  ) as Formation["units"];
function render() {
  const previousSeed = document.getElementById("seed")
    ? value("seed")
    : "playtest";
  const previousPreset = document.getElementById("preset")
    ? value("preset")
    : presetNames[0];
  const f = formation();
  $("app").innerHTML =
    `<header><h1>Conflict Board Resolution Lab</h1><p class="muted">Local experiments · fake armies · no Convex traffic · experimental rules, not live sieges</p><label>Combat model<select id="combatModel">${option("current", "Current · reference", config.combatModel ?? "current")}${option("experimental-survival", "Experimental Survival · normalized + weighted", config.combatModel)}</select></label><p id="combatModelStatus"><strong>${modelName(config.combatModel)}</strong> · ${config.combatModel === "experimental-survival" ? "Survival = 100 × researched Survival / troops; weighted individual losses. Fixed 3% floor, 25% factor, 80% base cap, 95% final cap; no Survival cap. Current debug casualty settings are ignored." : "Existing total Survival and equal individual casualty selection. Reference defaults include the 3% floor; scientist constants remain available."} Changes apply to future battles only. Load the same preset and seed to compare.</p></header>
 <section><div class="row"><label>Scenario<select id="preset">${presetNames.map((n) => option(n, n)).join("")}</select></label><label>Casualty seed<input id="seed" value="playtest"></label></div><button id="reset">Load preset</button><button id="save">Save in this browser</button><button id="load">Load saved</button><button id="resolve">Resolve Next Cycle</button><p id="status">Cycle ${state.cycle} · legal owner: ${escape(state.originalOwner)} · Command Post: ${escape(state.objective.controller ?? "empty")}${state.objective.hold ? ` · hold began cycle ${state.objective.hold.beganCycle}` : ""}${state.objective.conqueredBy ? ` · CONQUEST: ${escape(state.objective.conqueredBy)}` : ""}</p><div id="cargoSummary"><strong>Fake defender Treasury: ${state.treasury ?? DEFAULT_TREASURY}</strong><p>Recovered: ${state.recovered ?? 0} · Unclaimed: ${state.cargoLost ?? 0} · Destroyed at settlement: ${state.cargoDestroyed ?? 0}</p>${state.kingdoms.map(k => `<p>${escape(k.name)} · carried ${state.formations.filter(f => f.kingdom === k.id).reduce((sum,f) => sum+cargoAmount(f),0)} · banked ${state.raidValues?.[k.id] ?? 0}</p>`).join("")}</div><p id="error" class="error" role="alert"></p></section>
 <div class="layout"><div><section id="battlefield"><h2>Battlefield · Center = Conquest / Flanks = Raid</h2><p class="muted">Tap an army to command it. Move: tap connected positions, then Confirm. Only B1 connects to the Command Post.</p><p class="legend">● Current · <span class="forward-key">→ Approved</span> · <span class="history-key">↶ Retreat</span> · <span class="draft-key">◇ Proposed</span></p><div id="routeBuilder" hidden><strong id="routeTitle"></strong><p id="proposedPath"></p><p id="routeError" class="error" role="alert"></p><button id="clearRoute">Clear</button><button id="cancelRoute">Cancel</button><button id="confirmRoute">Confirm route</button></div><div class="board">${[
   ...state.board.positions,
 ]
   .sort((a, b) => a.y - b.y || a.x - b.x)
   .map(
     (p) =>
       `<div class="tile ${p.kind !== "field" ? "wide" : ""} ${p.objective === "raid" ? "raid-node" : ""}" data-position="${p.id}"><button class="node-target" data-route-node="${p.id}" aria-label="Route through ${p.name}">${p.id === "post" ? "Command Post · CONQUEST" : p.name}</button><div class="pathMarks"></div>${p.objective === "raid" ? raidStatus(p.id) : ""}${state.formations
         .filter((g) => g.position === p.id)
         .map(
           (g) =>
             `<button class="army" data-formation="${escape(g.id)}" style="border-color:${state.kingdoms.find((k) => k.id === g.kingdom)!.color}">${escape(g.name)} · ${totalUnits(g.units)} troops · cargo ${cargoAmount(g)}<br>${formationStats(g.units, state.kingdoms.find((k) => k.id === g.kingdom)!.research, config).specialization} · P ${formationStats(g.units, state.kingdoms.find((k) => k.id === g.kingdom)!.research, config).power}</button>`,
         )
         .join("")}</div>`,
   )
   .join("")}</div></section>
 <section><h2>Cycle journal</h2><div id="log">${
   history.length
     ? history
         .slice()
         .reverse()
         .map(
           (result) =>
             `<details open><summary>Cycle ${result.state.cycle} · ${result.events.length} events</summary><ol>${result.events.map((e) => `<li>${describe(e)}<details><summary>Exact event</summary><pre>${escape(JSON.stringify(e, null, 2))}</pre></details></li>`).join("")}</ol></details>`,
         )
         .join("")
     : "Issue an order, then resolve a cycle."
 }</div></section></div>
 <div><div id="armyPanel"><section><button id="closeArmy" ${inspectorOpen ? "" : "hidden"}>Close army panel</button><h2 id="armyTitle">Army workshop · ${escape(f?.name ?? "New army")}</h2><p id="cargoInfo">Cargo: ${f ? cargoAmount(f) : 0} / ${f ? cargoCapacity(state,f) : 0}<br>Owner-agnostic Spheres; bank at your drop-off.</p><p>Standing order: <strong>${escape(f?.order.kind ?? "hold")}</strong></p><button id="moveArmy">Move · draw route</button><button id="raidArmy" ${canOrderRaid(f) ? "" : "disabled"}>Raid</button><p id="raidHint">${raidHint(f)}</p><label>Formation<select id="formation">${state.formations.map((g) => option(g.id, g.name, selected)).join("")}</select></label><label>Name<input id="name" value="${escape(f?.name ?? "New army")}"></label><div class="row"><label>Kingdom<select id="kingdom">${state.kingdoms.map((k) => option(k.id, k.name, f?.kingdom)).join("")}</select></label><label>Position<select id="position">${state.board.positions.map((p) => option(p.id, p.name, f?.position)).join("")}</select></label></div><div class="units">${unitKeys()
   .map(
     (k) =>
       `<label>${k}<input id="unit-${k}" type="number" min="0" step="1" value="${f?.units[k] ?? 0}"></label>`,
   )
   .join(
     "",
   )}</div><button id="edit">Apply army edit</button><button id="create">Create army</button><button id="split">Split these counts off</button><button id="remove">Remove army</button><button id="arrive">Queue these troops next cycle</button><p class="muted">Editing position resets its route/history. Splitting subtracts these counts from the selected army. Queued reinforcements are new fake troops.</p><p>${state.arrivals.length} arrival(s) pending.</p><div id="stats"></div>
 <details><summary>Add another kingdom</summary><label>Kingdom name<input id="newKingdom" value="Gold"></label><button id="addKingdom">Add kingdom</button></details>
 <h2>Standing intention</h2><label>After defeat<select id="defeat">${option("continue", "Continue", f?.order.onDefeat)}${option("pause", "Pause", f?.order.onDefeat)}</select></label><button id="hold">Hold / cancel route</button><p id="armyRoutes" class="muted">Approved: ${escape(f?.position)} → ${escape(f?.order.route.join(" → ") || "Hold")}. Retreat history: ${escape(f?.history.join(" → "))}</p><details><summary>Advanced typed route</summary><label>Approved route (next positions, comma separated)<input id="route" value="${escape(f?.order.route.join(", ") ?? "")}"></label><button id="approve">Approve route</button></details>
 <details><summary>Intentional merge route</summary><p>Nominate the selected formation to retain its history and standing order if it merges at this position.</p><label>Merge position<select id="mergePosition">${state.board.positions.map((p) => option(p.id, p.name, "B2")).join("")}</select></label><button id="nominate">Retain selected source</button><pre>${escape(JSON.stringify(preferences, null, 2))}</pre></details></section>
 <section><h2>Kingdom Research</h2><p>Applies to the kingdom selected above. Real Research formulas; no Conclave effects.</p>${[
   ["bridgeEngineering", "Bridge Engineering"],
   ["painrialMedicine", "Field Surgery"],
   ["soulcastArmor", "Tailored Armor"],
   ["packHarnessDesign", "Pack Harnesses"],
 ]
   .map(
     ([id, name]) =>
       `<label>${name}<select id="research-${id}">${[0, 1, 2, 3].map((rank) => option(String(rank), String(rank), String(state.kingdoms.find((k) => k.id === f?.kingdom)?.research[id] ?? 0))).join("")}</select></label>`,
   )
   .join("")}<button id="research">Apply Research</button></section></div>
 <section><h2>Experimental constants</h2><p>Ratings use positive stat ÷ (scale × troop count). One rating must reach the minimum and exceed the dominance share. Power is independent. Only Speed has a board ability in this Lab.</p>${Object.entries(
   config.specialization,
 )
   .map(
     ([k, v]) =>
       `<label>${k}<input id="config-${k}" type="number" step="0.01" value="${v}"></label>`,
   )
   .join("")}${Object.entries(config.casualties)
   .map(
     ([k, v]) =>
       `<label>Current casualties: ${k}<input id="casualty-${k}" ${config.combatModel === "experimental-survival" ? "disabled" : ""} type="number" step="0.01" value="${v ?? ""}" placeholder="uncapped"></label>`,
   )
   .join(
     "",
   )}<label>Fake defender Treasury remaining<input id="treasury" type="number" min="0" value="${state.treasury ?? DEFAULT_TREASURY}"></label><label>Raid cap per objective per cycle<input id="raidCap" type="number" min="0" value="${config.raidCap ?? 100}"></label><button id="config">Apply constants</button><p class="muted">Bridge Engineering is excluded from tactical Speed only. The comparison travel Speed retains it. Existing casualty rounding, troop selection and final loss cap are reused.</p></section></div></div><dialog id="armyDialog" aria-labelledby="armyTitle"></dialog>`;
  document.querySelectorAll<HTMLButtonElement>("[data-formation]").forEach(
    (b) =>
      (b.onclick = () => {
        if (proposed !== null) return;
        selected = b.dataset.formation!;
        inspectorOpen = true;
        render();
      }),
  );
  $("formation").onchange = () => {
    proposed = null;
    selected = value("formation");
    render();
  };
  $("kingdom").onchange = () => {
    const k = state.kingdoms.find((k) => k.id === value("kingdom"))!;
    for (const key of [
      "bridgeEngineering",
      "painrialMedicine",
      "soulcastArmor",
      "packHarnessDesign",
    ])
      $<HTMLSelectElement>(`research-${key}`).value = String(
        k.research[key] ?? 0,
      );
    statsPreview();
  };
  for (const key of unitKeys()) $(`unit-${key}`).oninput = statsPreview;
  action("reset", () => {
    inspectorOpen = false;
    proposed = null;
    state = scenario(value("preset"));
    selected = state.formations.at(-1)?.id ?? "";
    history = [];
    preferences = {};
    render();
  });
  $<HTMLSelectElement>("combatModel").onchange = () => {
    config.combatModel = value("combatModel") as "current" | "experimental-survival";
    render();
  };
  action("save", () =>
    localStorage.setItem(
      "conflict-lab",
      JSON.stringify({ state, config, history, preferences }),
    ),
  );
  action("load", () => {
    const data = JSON.parse(localStorage.getItem("conflict-lab") ?? "null");
    if (!data) throw Error("No saved Lab state.");
    state = data.state;
    config = data.config;
    config.combatModel ??= "current";
    config.raidCap ??= 100;
    // Older local saves retain all armies/orders. Only add flank metadata.
    for (const p of state.board.positions)
      if (p.id === "A1" || p.id === "C1") p.objective = "raid";
    inspectorOpen = false;
    proposed = null;
    history = data.history;
    preferences = data.preferences;
    selected = state.formations[0]?.id ?? "";
    render();
  });
  action("resolve", () => {
    if (proposed !== null)
      throw Error("Confirm or Cancel the proposed route before resolving.");
    const seed = value("seed");
    const result = resolveCycle({
      state,
      config,
      cycle: state.cycle + 1,
      seed,
      mergePreferences: preferences,
    });
    state = result.state;
    history.push(result);
    preferences = {};
    if (!formation()) selected = state.formations[0]?.id ?? "";
    render();
    $<HTMLInputElement>("seed").value = seed;
  });
  const draft = (): Formation => {
    const units = unitInputs();
    if (
      unitKeys().some((k) => !Number.isSafeInteger(units[k]) || units[k] < 0) ||
      !totalUnits(units)
    )
      throw Error("Use nonnegative whole troop counts and at least one troop.");
    const position = value("position");
    return {
      id: uid(),
      name: value("name"),
      kingdom: value("kingdom"),
      position,
      history: [position],
      units,
      order: holdOrder(),
    };
  };
  action("create", () => {
    const g = draft();
    state.formations.push(g);
    selected = g.id;
    render();
  });
  action("edit", () => {
    const g = draft(),
      current = formation();
    if (!current) throw Error("Select an army.");
    if (g.position === current.position) {
      g.history = current.history;
      g.order = current.order;
    }
    Object.assign(current, g, { id: current.id });
    render();
  });
  action("remove", () => {
    state.formations = state.formations.filter((g) => g.id !== selected);
    selected = state.formations[0]?.id ?? "";
    render();
  });
  action("split", () => {
    const id = uid();
    state = splitFormation(state, selected, unitInputs(), id);
    selected = id;
    render();
  });
  action("arrive", () => {
    const { position, history: routeHistory, ...g } = draft();
    state.arrivals.push({ id: uid(), cycle: state.cycle + 1, formation: g });
    render();
  });
  action("addKingdom", () => {
    state.kingdoms.push({
      id: uid(),
      name: value("newKingdom"),
      color: "#f7d76c",
      research: {},
    });
    render();
  });
  action("approve", () => {
    const g = formation();
    if (!g) throw Error("Select an army.");
    const route = value("route")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    approveRoute(
      state.board,
      g,
      route,
      value("defeat") as "continue" | "pause",
    );
    render();
  });
  action("hold", () => {
    if (formation()) formation()!.order = holdOrder();
    render();
  });
  action("nominate", () => {
    const g = formation();
    if (!g) throw Error("Select an army.");
    preferences[`${g.kingdom}@${value("mergePosition")}`] = g.id;
    render();
  });
  action("research", () => {
    const k = state.kingdoms.find((k) => k.id === value("kingdom"))!;
    for (const id of [
      "bridgeEngineering",
      "painrialMedicine",
      "soulcastArmor",
      "packHarnessDesign",
    ])
      k.research[id] = Number(value(`research-${id}`));
    render();
  });
  action("config", () => {
    const next = structuredClone(config);
    next.raidCap = Number(value("raidCap"));
    for (const k of Object.keys(
      next.specialization,
    ) as (keyof typeof next.specialization)[])
      next.specialization[k] = Number(value(`config-${k}`));
    for (const k of Object.keys(
      next.casualties,
    ) as (keyof typeof next.casualties)[])
      (next.casualties as Record<string, number | null>)[k] =
        k === "surviveCap" && value(`casualty-${k}`) === ""
          ? null
          : Number(value(`casualty-${k}`));
    const probe = scenario();
    resolveCycle({ state: probe, cycle: 1, seed: "validate", config: next });
    const treasury = Number(value("treasury"));
    if (!Number.isFinite(treasury) || treasury < 0) throw Error("Treasury must be nonnegative and finite.");
    state.treasury = treasury;
    config = next;
    render();
  });
  $<HTMLInputElement>("seed").value = previousSeed;
  $<HTMLSelectElement>("preset").value = previousPreset;
  statsPreview();
  $("armyTitle").after($("stats"));
  $("moveArmy").after($("hold"));
  const panelError = document.createElement("p");
  panelError.id = "armyError";
  panelError.className = "error";
  panelError.setAttribute("role", "alert");
  $("armyTitle").before(panelError);
  action("closeArmy", () => {
    inspectorOpen = false;
    render();
  });
  action("moveArmy", () => {
    if (!formation()) throw Error("Select an army.");
    proposed = [];
    inspectorOpen = false;
    render();
    $("battlefield").scrollIntoView({ block: "start" });
  });
  action("raidArmy", () => {
    const g = formation();
    if (!canOrderRaid(g)) throw Error("Establish a flank foothold first.");
    g!.order = { kind: "raid", route: [], onDefeat: g!.order.onDefeat };
    render();
  });
  action("clearRoute", () => {
    proposed = [];
    paintBoard();
  });
  action("cancelRoute", () => {
    proposed = null;
    paintBoard();
  });
  action("confirmRoute", () => {
    const g = formation();
    if (!g || proposed === null) return;
    approveRoute(
      state.board,
      g,
      proposed,
      value("defeat") as "continue" | "pause",
    );
    proposed = null;
    render();
  });
  $("defeat").onchange = () => {
    if (formation())
      formation()!.order.onDefeat = value("defeat") as "continue" | "pause";
  };
  document.querySelectorAll<HTMLElement>("[data-position]").forEach(
    (tile) =>
      (tile.onclick = () => {
        if (proposed === null || !formation()) return;
        try {
          proposed = extendRoute(
            state.board,
            formation()!.position,
            proposed,
            tile.dataset.position!,
          );
          $("routeError").textContent = "";
          paintBoard();
        } catch (e) {
          $("routeError").textContent = (e as Error).message;
        }
      }),
  );
  const dialog = $<HTMLDialogElement>("armyDialog");
  dialog.oncancel = (e) => {
    e.preventDefault();
    inspectorOpen = false;
    render();
  };
  if (inspectorOpen) {
    dialog.append($("armyPanel"));
    dialog.showModal();
  }
  paintBoard();
}

function canOrderRaid(f: Formation | undefined) {
  const foothold = f && state.raidFootholds?.[f.position];
  return (
    !!f &&
    f.kingdom !== state.originalOwner &&
    !!foothold &&
    foothold.kingdom === f.kingdom &&
    foothold.establishedCycle <= state.cycle &&
    foothold.occupants.includes(f.id)
  );
}
function raidHint(f: Formation | undefined) {
  if (!f) return "Select an army.";
  if (f.kingdom === state.originalOwner)
    return "The original defender protects these logistics; it cannot raid itself.";
  if (!state.board.positions.find((p) => p.id === f.position)?.objective)
    return "Reach West or East Raid and establish a foothold first.";
  return canOrderRaid(f)
    ? "Raid next resolution if you retain control. Failed attacks do not delay it."
    : "End a resolution controlling this flank first. No payout on arrival.";
}
function raidStatus(id: string) {
  const h = state.raidFootholds?.[id];
  if (!h) return `<p class="raid-status">No established foothold · Cap ${config.raidCap ?? 100} · Treasury ${state.treasury ?? DEFAULT_TREASURY}</p>`;
  const name =
    state.kingdoms.find((k) => k.id === h.kingdom)?.name ?? h.kingdom;
  return `<p class="raid-status">${escape(name)} · ${h.kingdom === state.originalOwner ? "Defending" : h.establishedCycle === state.cycle ? "Foothold · Raid available next resolution" : "RAID-READY"}<br>Cap: ${config.raidCap ?? 100} · Treasury: ${state.treasury ?? DEFAULT_TREASURY} · Banked: ${state.raidValues?.[h.kingdom] ?? 0}</p>`;
}
function paintBoard() {
  const f = formation();
  $("routeBuilder").hidden = proposed === null;
  if (proposed !== null && f) {
    $("routeTitle").textContent = `Drawing route · ${f.name}`;
    $("proposedPath").textContent = [f.position, ...proposed].join(" → ");
  }
  document.querySelectorAll<HTMLElement>("[data-position]").forEach((tile) => {
    const id = tile.dataset.position!,
      marks: string[] = [];
    const current = f?.position === id,
      forward = f?.order.route.includes(id) ?? false,
      retreat = f?.history.includes(id) ?? false,
      draft = proposed?.includes(id) ?? false;
    tile.classList.toggle("current", current);
    tile.classList.toggle("route", forward);
    tile.classList.toggle("fallback", retreat);
    tile.classList.toggle("proposed", draft);
    let valid = false;
    if (proposed !== null && f) {
      try {
        extendRoute(state.board, f.position, proposed, id);
        valid = true;
      } catch {}
    }
    tile.classList.toggle("next", valid && proposed !== null);
    if (current) marks.push("● Current");
    if (forward)
      marks.push(
        `→ Approved ${f!.order.route
          .map((p, i) => (p === id ? i + 1 : null))
          .filter(Boolean)
          .join(",")}`,
      );
    if (retreat) marks.push(`↶ History ${f!.history.indexOf(id) + 1}`);
    if (draft)
      marks.push(
        `◇ Proposed ${proposed!
          .map((p, i) => (p === id ? i + 1 : null))
          .filter(Boolean)
          .join(",")}`,
      );
    tile.querySelector(".pathMarks")!.textContent = marks.join(" · ");
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-formation]")
    .forEach((b) => {
      b.classList.toggle("selected", b.dataset.formation === selected);
      b.setAttribute("aria-pressed", String(b.dataset.formation === selected));
    });
}
function statsPreview() {
  const stats = formationStats(
    unitInputs(),
    state.kingdoms.find((k) => k.id === value("kingdom"))!.research,
    config,
  );
  $("stats").innerHTML =
    `<h2>${stats.specialization}</h2><p>Power ${stats.power} · tactical Speed ${stats.speed} · travel Speed ${stats.travelSpeed}<br>Survive ${stats.survive} · Plunder ${stats.plunder}</p><p>Normalized Speed / Survive / Plunder: ${stats.ratings.map((n) => n.toFixed(2)).join(" / ")}</p>`;
}
function describe(e: CycleResult["events"][number]) {
  switch (e.type) {
    case "cargo":
      return `${escape(e.kingdom ?? e.formation)} · cargo ${e.action}: ${e.amount}. ${escape(e.reason)}`;
    case "raidFoothold":
      return `${escape(e.kingdom)} established a foothold at ${escape(e.position)}. Raid available next resolution if control is retained.`;
    case "raidReady":
      return `${escape(e.kingdom)} retained uninterrupted control of ${escape(e.position)} and is Raid-ready.`;
    case "raidBroken":
      return `${escape(e.kingdom)} lost its foothold at ${escape(e.position)}. Readiness reset, even if it retakes the flank.`;
    case "raidFailed":
      return `${escape(e.formation)} could not Raid ${escape(e.position)}: ${escape(e.reason)}`;
    case "raid":
      return `${escape(e.kingdom)} raided ${escape(e.target)} at ${escape(e.position)}. Plunder: ${e.plunder}. Extracted ${e.value} into carried cargo; fake Treasury reduced by ${e.value} (remaining ${e.treasuryRemaining ?? "legacy"}). ${e.capacityReached ? "Cargo capacity reached. " : ""}Escape to staging to bank it.`;
    case "battle":
      return `[${modelName(e.combatModel)}] ${escape(e.position)}: ${e.forces.map((f) => `${escape(f.kingdom)} P ${f.power} faces ${f.hostilePower}; loses ${totalUnits(f.casualties)} (${(f.finalRate * 100).toFixed(1)}% rate). Casualties: ${unitKeys().filter(k => f.casualties[k] + f.survivors[k] > 0).map(k => `${escape(k)} ${f.casualties[k]}/${f.casualties[k]+f.survivors[k]}`).join(", ")} (lost/starting)`).join(" · ")}. ${e.annihilated ? "Nominal winner annihilated; no controller." : e.winner ? `${escape(e.winner)} wins.` : "Highest Power tied; everyone retreats."}`;
    case "move":
      return `${escape(e.formation)} moves ${escape(e.from)} → ${escape(e.to)} (step ${e.step}).`;
    case "retreat":
      return `${escape(e.formation)} retreats ${escape(e.from)} → ${escape(e.to)}.`;
    case "merge":
      return `Friendly forces merge at ${escape(e.position)}. ${escape(e.reason)}`;
    case "order":
      return `${escape(e.formation)}: ${escape(e.reason)}`;
    case "retreatCollision":
      return `Hostile retreat claims at ${escape(e.position)}: all skip this fallback.`;
    case "arrival":
      return `${escape(e.formation)} arrives at ${escape(e.position)}.`;
    case "control":
      return `Command Post: ${escape(e.from ?? "empty")} → ${escape(e.to ?? "empty")}.`;
    default:
      return `${e.type}: ${escape(e.kingdom)}.`;
  }
}
render();
