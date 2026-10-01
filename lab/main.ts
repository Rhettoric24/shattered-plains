import { emptyUnits, totalUnits, unitKeys } from "../convex/rules";
import { resolveCycle } from "../conflict-board/resolver";
import { formationStats } from "../conflict-board/stats";
import {
  connected,
  holdOrder,
  proposedRoute,
  splitFormation,
} from "../conflict-board/planning";
import type { CycleResult, Formation } from "../conflict-board/types";
import { defaults, presetNames, scenario } from "./scenarios";

let state = scenario(),
  config = structuredClone(defaults),
  selected = state.formations[1].id,
  history: CycleResult[] = [];
let serial = 0,
  preferences: Record<string, string> = {};
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
const uid = () => `lab-${Date.now()}-${serial++}`;
const action = (id: string, fn: () => void) =>
  $(id).addEventListener("click", () => {
    try {
      fn();
      $("error").textContent = "";
    } catch (e) {
      $("error").textContent = (e as Error).message;
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
    `<header><h1>Conflict Board Resolution Lab</h1><p class="muted">Local experiments · fake armies · no Convex traffic · experimental rules, not live sieges</p></header>
 <section><div class="row"><label>Scenario<select id="preset">${presetNames.map((n) => option(n, n)).join("")}</select></label><label>Casualty seed<input id="seed" value="playtest"></label></div><button id="reset">Load preset</button><button id="save">Save in this browser</button><button id="load">Load saved</button><button id="resolve">Resolve Next Cycle</button><p id="status">Cycle ${state.cycle} · legal owner: ${escape(state.originalOwner)} · Command Post: ${escape(state.objective.controller ?? "empty")}${state.objective.hold ? ` · hold began cycle ${state.objective.hold.beganCycle}` : ""}${state.objective.conqueredBy ? ` · CONQUEST: ${escape(state.objective.conqueredBy)}` : ""}</p><p id="error" class="error" role="alert"></p></section>
 <div class="layout"><div><section><h2>Battlefield</h2><p class="muted">Orthogonal links; only B1 connects to the Post. Safe Approach connects to A3, B3 and C3. Click a formation to inspect it. Gold outlines show its approved route.</p><div class="board">${[
   ...state.board.positions,
 ]
   .sort((a, b) => a.y - b.y || a.x - b.x)
   .map(
     (p) =>
       `<div class="tile ${p.kind !== "field" ? "wide" : ""} ${f?.order.route.includes(p.id) ? "route" : ""}" data-position="${p.id}"><strong>${p.name}</strong>${state.formations
         .filter((g) => g.position === p.id)
         .map(
           (g) =>
             `<button class="army" data-formation="${escape(g.id)}" style="border-color:${state.kingdoms.find((k) => k.id === g.kingdom)!.color}">${escape(g.name)} · ${totalUnits(g.units)} troops<br>${formationStats(g.units, state.kingdoms.find((k) => k.id === g.kingdom)!.research, config).specialization} · P ${formationStats(g.units, state.kingdoms.find((k) => k.id === g.kingdom)!.research, config).power}</button>`,
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
 <div><section><h2>Army workshop</h2><label>Formation<select id="formation">${state.formations.map((g) => option(g.id, g.name, selected)).join("")}</select></label><label>Name<input id="name" value="${escape(f?.name ?? "New army")}"></label><div class="row"><label>Kingdom<select id="kingdom">${state.kingdoms.map((k) => option(k.id, k.name, f?.kingdom)).join("")}</select></label><label>Position<select id="position">${state.board.positions.map((p) => option(p.id, p.name, f?.position)).join("")}</select></label></div><div class="units">${unitKeys()
   .map(
     (k) =>
       `<label>${k}<input id="unit-${k}" type="number" min="0" step="1" value="${f?.units[k] ?? 0}"></label>`,
   )
   .join(
     "",
   )}</div><button id="edit">Apply army edit</button><button id="create">Create army</button><button id="split">Split these counts off</button><button id="remove">Remove army</button><button id="arrive">Queue these troops next cycle</button><p class="muted">Editing position resets its route/history. Splitting subtracts these counts from the selected army. Queued reinforcements are new fake troops.</p><p>${state.arrivals.length} arrival(s) pending.</p><div id="stats"></div>
 <details><summary>Add another kingdom</summary><label>Kingdom name<input id="newKingdom" value="Gold"></label><button id="addKingdom">Add kingdom</button></details>
 <h2>Standing intention</h2><label>Destination<select id="destination">${state.board.positions.map((p) => option(p.id, p.name, "post")).join("")}</select></label><button id="propose">Show proposed route</button><label>Approved route (next positions, comma separated)<input id="route" value="${escape(f?.order.route.join(", ") ?? "")}"></label><label>After defeat<select id="defeat">${option("continue", "Continue", f?.order.onDefeat)}${option("pause", "Pause", f?.order.onDefeat)}</select></label><button id="approve">Approve route</button><button id="hold">Hold / cancel route</button><p class="muted">Route: ${escape(f?.position)} → ${escape(f?.order.route.join(" → ") || "Hold")}. Retreat history: ${escape(f?.history.join(" → "))}</p>
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
   .join("")}<button id="research">Apply Research</button></section>
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
       `<label>Casualties: ${k}<input id="casualty-${k}" type="number" step="0.01" value="${v ?? ""}" placeholder="uncapped"></label>`,
   )
   .join(
     "",
   )}<button id="config">Apply constants</button><p class="muted">Bridge Engineering is excluded from tactical Speed only. The comparison travel Speed retains it. Existing casualty rounding, troop selection and final loss cap are reused.</p></section></div></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-formation]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.formation!;
        render();
      }),
  );
  $("formation").onchange = () => {
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
    state = scenario(value("preset"));
    selected = state.formations.at(-1)?.id ?? "";
    history = [];
    preferences = {};
    render();
  });
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
    history = data.history;
    preferences = data.preferences;
    selected = state.formations[0]?.id ?? "";
    render();
  });
  action("resolve", () => {
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
  action("propose", () => {
    if (!formation()) throw Error("Select an army.");
    const route = proposedRoute(
      state.board,
      formation()!.position,
      value("destination"),
    );
    if (!route) throw Error("No connected route.");
    $<HTMLInputElement>("route").value = route.slice(1).join(", ");
  });
  action("approve", () => {
    const g = formation();
    if (!g) throw Error("Select an army.");
    const route = value("route")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let prev = g.position;
    for (const p of route) {
      if (!connected(state.board, prev, p))
        throw Error(`No connection from ${prev} to ${p}.`);
      prev = p;
    }
    g.order = {
      kind: route.length ? "move" : "hold",
      route,
      onDefeat: value("defeat") as "continue" | "pause",
    };
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
    config = next;
    render();
  });
  $<HTMLInputElement>("seed").value = previousSeed;
  $<HTMLSelectElement>("preset").value = previousPreset;
  statsPreview();
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
    case "battle":
      return `${escape(e.position)}: ${e.forces.map((f) => `${escape(f.kingdom)} P ${f.power} faces ${f.hostilePower}; loses ${totalUnits(f.casualties)} (${(f.finalRate * 100).toFixed(1)}%)`).join(" · ")}. ${e.annihilated ? "Nominal winner annihilated; no controller." : e.winner ? `${escape(e.winner)} wins.` : "Highest Power tied; everyone retreats."}`;
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
