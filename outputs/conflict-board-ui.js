// Normal-game transport UI. Receives only the authenticated server projection;
// never imports a resolver, Lab snapshot, or hidden enemy state.
import { retreatShade, queuedRouteHints } from "../conflict-board/movement-presentation";
import { attachRouteDrag } from "../conflict-board/route-drag";
import { effectivePower, effectiveSurvivability, unitPlunder, missionMsForBase } from "../convex/rules";
const troopKeys = ["bridgeman", "spearman", "chull", "shardbearer"];
const names = { bridgeman: "Bridgemen", spearman: "Spearmen", chull: "Chulls", shardbearer: "Shardbearers" };
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const time = value => value ? new Date(value).toLocaleString() : "Pending";
const unitsText = units => troopKeys.filter(k => units?.[k]).map(k => `${num(units[k])} ${names[k]}`).join(" · ") || "No troops";
export function routeStep(board, origin, route, next) {
  const path = [origin, ...route], last = path.at(-1);
  if (next === path.at(-2)) return route.slice(0, -1);
  if (next === last || route.length >= 128) return route;
  return board.connections.some(([a, b]) => a === last && b === next || b === last && a === next) ? [...route, next] : route;
}
export function arrivalPosition(data) {
  return data.view.viewer === data.originalOwner
    ? data.commandPostController === data.view.viewer ? data.view.board.objective : data.view.board.reserve
    : data.view.board.approach;
}
export function selectedForce(data, id) {
  const own = data?.view.own.find(row => row.formation.id === id);
  if (own) return own;
  const a = data?.view.ownArrivals.find(a => a.formation.id === id);
  return a ? { formation: { ...a.formation, position: arrivalPosition(data), history: [] }, stats: a.stats, traveling: true } : null;
}
function powerText(p) {
  if (!p) return "Unknown Power";
  if (p.mode === "exact") return `${num(p.value)} Power`;
  if (p.mode === "estimate" || p.mode === "range") return `${num(p.min)}–${p.max == null ? "∞" : num(p.max)} Power`;
  return p.label;
}

export function createConflictBoardUI({ root, historyRoot, query, mutate, onSelect, quantityControlMarkup, bindQuantityControls, confirm = message => window.confirm(message) }) {
  let context, selected = null, selectedArmy = null, draft = null, draftOrigin = null;
  let signature = "", busy = false, notice = "", values = {}, pendingSubmission = null, handledFocus = null;
  let sheetGesture = null, suppressSheetClick = false;
  let showHistory = false, refreshWarning = "";
  let dragging = false, sheetExpanded = false, sheetPanel = "orders", inspectedTile = null;
  const button = (action, label, disabled = false, extra = "") => `<button type="button" data-cb="${action}" ${disabled || busy ? "disabled" : ""} ${extra}>${label}</button>`;
  function select(id) {
    if (selected !== (id || null)) fittedLayout = null;
    selected = id || null; selectedArmy = null; draft = null; inspectedTile = null; sheetExpanded = false; values = {}; pendingSubmission = null;
    notice = "";
    try { onSelect(selected); } catch (error) { console.warn("Conflict Board navigation refresh failed", error); refreshWarning = "Battlefield navigation could not refresh. This is separate from order submission."; }
    render();
  }
  function inputs(prefix, available) {
    return `<div class="cb-units">${troopKeys.map(k => `<label>${names[k]} <small>${num(available?.[k])} available</small><input data-cb-value="${prefix}-${k}" aria-label="${prefix} ${names[k]}" type="number" min="0" max="${available?.[k] || 0}" step="1" value="${esc(values[`${prefix}-${k}`] || 0)}"></label>`).join("")}</div>`;
  }
  const readUnits = prefix => ({ scout: 0, heavy: 0, ...Object.fromEntries(troopKeys.map(k => [k, Number(values[`${prefix}-${k}`] || 0)])) });
  const commitment = prefix => `${inputs(prefix, context.ready)}<label>Half-Shards to carry <input data-cb-value="${prefix}-fabrials" type="number" min="0" max="128" value="${esc(values[`${prefix}-fabrials`] || 0)}"></label><small>Uses your real inventory. Painrial, Soulcaster and Conclave attachment remain unavailable on live Boards.</small>`;
  const shortName = name => Array.from(String(name || "Unknown")).length > 28 ? Array.from(String(name)).slice(0, 27).join("") + "…" : String(name || "Unknown");
  function targetOptions() {
    const groups = new Map();
    for (const p of context.targets) {
      const key = p.ownerPlayerId || p.ownerName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups.values()].map(rows => `<optgroup label="${esc(shortName(rows[0].ownerName))}">${rows.map(p => `<option value="${esc(p._id)}" ${values.target === p._id ? "selected" : ""}>　${esc(shortName(p.name))}</option>`).join("")}</optgroup>`).join("");
  }
  function plateauInfo() {
    const p = context.targets.find(p => p._id === values.target);
    if (!p) return "";
    const fact = (label, value) => `<span>${esc(label)}<strong>${esc(value)}</strong></span>`;
    const typeNames = { sphere: "Sphere", bridged: "Bridged", ancient: "Ancient", gemheart: "Gemheart" };
    return fact("Held by", p.ownerName) + fact("Plateau", p.name) + fact("Type", typeNames[p.type] || "Unknown · requires 25 Territory Intel") +
      fact("Traits", p.type ? [p.highground ? "Highground" : "", p.large ? "Large" : ""].filter(Boolean).join(" · ") || "None" : "Unknown · requires 25 Territory Intel") +
      (p.type === "gemheart" ? fact("Next Gemheart", p.gemheartProgress ? time(p.gemheartProgress.nextGemheartAt) : "Requires 75 Territory Intel") : "") +
      (p.intelligenceLevel >= 2 ? fact("Parshendi reclamations", num(p.parshendiReclamationCount)) + fact("Base neutral defense", num(p.baseNeutralDefense)) : "");
  }
  function launcherUnits() {
    return `<div class="unit-input-grid">${troopKeys.filter(k => !context.unitConfig || context.unitConfig[k]).map(k => {
      const u = context.unitConfig?.[k], available = context.ready?.[k] || 0;
      const attrs = `data-cb-value="commit-${k}" aria-label="commit ${names[k]}"`;
      return `<div class="unit-input mission-unit-input"><div class="mission-unit-heading"><strong>${esc(u?.name || names[k])}</strong><small>Available ${num(available)}${u ? ` · Power ${num(u.power)} · Speed ${num(u.speed)} · Plunder ${num(u.plunder)} · Survive ${num(u.survivability)}` : ""}</small></div>${quantityControlMarkup ? quantityControlMarkup(attrs, values[`commit-${k}`] || 0, available, { half: true, max: true }) : `<input ${attrs} type="number" min="0" max="${available}" value="${esc(values[`commit-${k}`] || 0)}">`}</div>`;
    }).join("")}</div>`;
  }
  function armyOutlook() {
    const units = readUnits("commit"), research = context.research || {};
    const ms = missionMsForBase(7200000, units, context.plateauCounts, research);
    const cell = (label, value) => `<div class="outlook-cell"><span>${label}</span><strong>${esc(value)}</strong></div>`;
    return `<div class="outlook-heading"><span>Army composition</span><strong>${esc(unitsText(units))}</strong></div><div class="outlook-grid">${cell("Power", num(effectivePower(units, research)))}${cell("Survive", num(effectiveSurvivability(units, research)))}${cell("Travel time", `${Math.ceil(ms / 60000)} min`)}${cell("Carry", `${num(Math.max(0, unitPlunder(units, research)))} Spheres`)}</div>`;
  }
  function conflictList(rows, history = false) {
    return `<section class="${history ? "cb-history" : "cb-active-conflicts"}"><h3>${history ? "Conflict history" : "Active conflicts"}</h3><div class="cb-conflict-list">${rows.map(c => `<article><h3>${esc(c.name)}</h3><p>${esc(c.status)}${c.status === "active" ? ` · Next resolution ${esc(time(c.nextCycleAt))}` : ""}</p>${button("enter", c.status === "active" ? "Enter battlefield" : "View result", false, `data-conflict="${esc(c.conflictId)}"`)}</article>`).join("") || `<p>${history ? "No closed conflicts yet." : "No active conflicts."}</p>`}</div></section>`;
  }
  const fabrials = prefix => {
    const count = Number(values[`${prefix}-fabrials`] || 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > 128) throw Error("Choose 0–128 available Half-Shards.");
    return Array(count).fill("halfShard");
  };
  async function readCommand(name, args) {
    try { return await query(name, args); }
    catch (error) { console.warn("Conflict Board read failed: " + name, error); throw Error((name.endsWith("previewSplit") ? "Split preview" : "Rival holding") + " could not load. No order was sent. Retry when connected."); }
  }
  async function submit(name, args) {
    const payloadKey = JSON.stringify([name, args]);
    // Repeating a submission after an uncertain network failure reuses its receipt.
    if (pendingSubmission?.key !== payloadKey) pendingSubmission = { key: payloadKey, args: { ...args, requestId: crypto.randomUUID() } };
    const result = await mutate(`conflictBoards:${name}`, pendingSubmission.args);
    pendingSubmission = null;
    return result;
  }
  function data() { return context?.conflict?.conflictId === selected ? context.conflict : null; }
  function commandArgs() {
    const d = data();
    if (!d) throw Error("Wait for the battlefield to load.");
    return { conflictId: selected, revision: d.revision };
  }
  async function order(kind, route = []) {
    const f = selectedForce(data(), selectedArmy)?.formation;
    if (!f) throw Error("Select your formation again.");
    await submit("order", { ...commandArgs(), formationId: f.id, kind, route, onDefeat: values.defeat || f.order.onDefeat });
    draft = null;
  }
  function assistanceMarkup(d) {
    if (!d.diplomacy || d.status !== "active" || d.participantStatus !== "active" || d.withdrawing || !d.enabled) return "";
    const rel = d.diplomacy, entry = arrivalPosition(d);
    return '<details class="cb-assistance"><summary>Call Parshendi assistance · ' + rel.favor + '/5 Favor</summary><p>Deploy at ' + esc(d.view.board.positions.find(p => p.id === entry)?.name || entry) + '. One square per resolution; separate formation; disperses after defeat. Can capture objectives, cannot raid. No storm casualties.</p>' + (rel.activeFormationId ? '<p>You already have an active Parshendi ally. It must disperse or withdraw before another can be called.</p>' : rel.tiers.map(t => button("call-parshendi", esc(t.name) + ' · ' + t.power + ' Power · ' + t.cost + ' Favor', rel.favor < t.cost, 'data-tier="' + t.cost + '"')).join('')) + '</details>';
  }
  function conflictTools(d) {
    return `<p>Deadline: ${esc(time(d.deadlineAt))} · Returned: ${esc(unitsText(d.returnedUnits))} · ${num(d.returnedSpheres)} Spheres returned · ${num(d.banked)} extracted.</p>
      ${d.withdrawing ? "<p>Withdrawal pending for next resolution.</p>" : ""}
      ${d.status === "active" && context.lobby.enabled && !d.withdrawing ? `<details><summary>Send reinforcements</summary>${commitment("reinforce")}${button("reinforce", "Dispatch reinforcements")}</details>` : ""}
      ${d.status === "active" && d.participantStatus === "active" ? button("withdraw", "Withdraw all my forces", d.withdrawing) : ""}
      <details><summary>Your battle reports (${d.journal.length})</summary>${d.journal.map(e => `<p>Cycle ${e.cycle}, ${esc(e.position)}: ${e.won ? "won" : "did not win"}. Lost ${esc(unitsText(e.casualties))}.</p>`).join("") || "No reported battles yet."}</details>`;
  }
  function armyMarkup(d) {
    const row = selectedForce(d, selectedArmy);
    if (!row) return "";
    const f = row.formation, stats = row.stats, locked = d.status !== "active" || d.withdrawing || d.participantStatus !== "active";
    const raid = !f.allied && !row.traveling && d.view.viewer !== d.originalOwner && d.view.board.positions.find(p => p.id === f.position)?.objective === "raid";
    const items = f.equipment?.items || [];
    const arrival = d.ownArrivalTimes.find(a => a.formationId === f.id)?.arriveAt;
    const position = d.view.board.positions.find(p => p.id === f.position)?.name || f.position;
    const next = d.withdrawing ? "Withdraw at next resolution" : row.traveling ? "Arrive, then follow orders when eligible" : f.order.paused ? "Paused after defeat" : f.order.kind === "move" && f.order.route.length ? "Move to " + f.order.route[0] + " when eligible" : f.order.kind === "raid" ? "Raid if foothold is eligible" : "Hold position";
    return `<section class="cb-sheet ${sheetExpanded ? "cb-sheet-expanded" : "cb-sheet-peek"}" aria-label="Selected formation">
      <div class="cb-sheet-top">${button("sheet-toggle", sheetExpanded ? "⌄ Collapse formation" : "⌃ Expand formation", false, `class="cb-sheet-handle" aria-expanded="${sheetExpanded}" aria-controls="cb-sheet-body"`)}${button("close-sheet", "Close", false, 'aria-label="Close formation controls"')}</div>
      <div class="cb-sheet-overview"><strong>${esc(f.name)}</strong><span class="cb-expanded-only"> · ${f.allied ? "Parshendi ally" : num(Object.values(f.units).reduce((a,b)=>a+b,0)) + " troops"}</span>
      <small>${row.traveling ? "Arrives " + esc(time(arrival)) + " · entry " : "At "}${esc(position)} · ${esc(f.order.kind)}${f.order.paused ? " (paused)" : ""}</small>
      <small>Next: ${esc(next)}</small>
      ${f.allied ? `<small>Power ${num(f.allied.power)} · Moves 1 square per resolution · Disperses after defeat</small>` : stats ? `<small class="cb-expanded-only">Power ${num(stats.power)} · Speed ${num(stats.speed)} · Survive ${num(stats.survive)} · Plunder ${num(stats.plunder)}</small>` : ""}</div>
      <div class="cb-actions cb-primary">${button("move", "Move", locked)}${button("orders", "Orders", locked, `aria-pressed="${sheetExpanded && sheetPanel === "orders"}"`)}${button("more", "More", false, `aria-pressed="${sheetExpanded && sheetPanel === "more"}"`)}</div>
      ${notice || busy ? `<p class="cb-sheet-notice" role="status">${esc(busy ? "Sending order…" : notice)}</p>` : ""}
      ${draft !== null ? `<div class="cb-route"><strong>Proposed: ${esc([draftOrigin, ...draft].join(" → "))}</strong><div>${button("confirm-route", "Confirm route", !draft.length || locked)} ${button("clear-route", "Clear")} ${button("cancel-route", "Cancel")}</div></div>` : ""}
      <div id="cb-sheet-body" class="cb-sheet-body" ${sheetExpanded ? "" : "hidden"}>
      <p>${f.allied ? "Indivisible Parshendi ally. Remains separate from every army, including on shared squares." : esc(unitsText(f.units))}</p>
      ${f.allied ? "<p>No cargo or equipment. Withdraws when this conflict ends.</p>" : stats ? `<p>${esc(stats.specialization)} specialization · Cargo ${num(row.cargo)} / ${num(row.capacity)}</p>` : "<p>Traveling: orders wait for arrival and the next eligible resolution. Defender reinforcements joining a garrison keep the resident garrison's order.</p>"}
      <div ${sheetPanel === "orders" ? "" : "hidden"}>
        <div class="cb-actions">${button("hold", "Hold", locked)}${button("raid", "Raid", locked || !raid)}${button("stop-route", "Cancel queued route", locked || f.order.kind !== "move")}</div>
        <p>Queued route: ${esc(f.order.route.join(" → ") || "None")}</p>
        <small>Raid requires an outside force at West or East Raid with an eligible foothold.</small>
        ${!f.allied ? `<label>After defeat <select data-cb-value="defeat"><option value="continue" ${(values.defeat || f.order.onDefeat) === "continue" ? "selected" : ""}>Continue toward destination</option><option value="pause" ${(values.defeat || f.order.onDefeat) === "pause" ? "selected" : ""}>Stop on loss</option></select></label>${button("standing", "Save standing order", locked)}` : "<p>Defeat disperses this ally; it cannot retreat.</p>"}
      </div>
      <div class="cb-more-panel" ${sheetPanel === "more" ? "" : "hidden"}>
        ${!f.allied ? `<details><summary>Route and retreat details</summary>${button("history", showHistory ? "Hide extended history" : "Show extended history", false, `aria-pressed="${showHistory}"`)}<p>Approved: ${esc(f.order.route.join(" → ") || "None")}</p><p>Retreat history: ${esc(f.history.join(" → ") || "Not yet deployed")}</p><label>Preserve this formation's route when merging at <select data-cb-value="merge">${d.view.board.positions.map(p => `<option value="${esc(p.id)}" ${(values.merge || f.position) === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>${button("merge-route", "Choose merge route", locked || row.traveling)}</details>
        <details><summary>Split formation</summary><p>Cargo stays with the original army. Any capacity loss requires confirmation.</p>${inputs("split", f.units)}${items.map(item => `<label><input type="checkbox" data-cb-value="equipment:${esc(item.id)}" ${values[`equipment:${item.id}`] ? "checked" : ""}> Give ${esc(item.kind)} to the new formation</label>`).join("")}${button("split", "Split troops", locked || row.traveling)}</details>
        <details><summary>Carried Fabrials (${items.length})</summary>${items.map(item => `<p>${esc(item.kind)} — ${f.equipment.active === item.id ? "Active" : f.equipment.pending?.id === item.id ? "Activates after next resolution" : "Carried"} ${button("switch", "Select", locked || row.traveling || f.equipment.active === item.id, `data-item="${esc(item.id)}"`)}</p>`).join("") || "No carried equipment."}${f.equipment?.pending ? button("cancel-switch", "Cancel pending change", locked || row.traveling) : ""}</details>
        ` : ""}${conflictTools(d)}
      </div></div>
    </section>`;
  }
  function tileMarkup(d) {
    const view = d.view, p = view.board.positions.find(p => p.id === inspectedTile);
    if (!p) return "";
    const own = [...view.own, ...view.ownArrivals.map(a => selectedForce(d, a.formation.id))].filter(r => r.formation.position === p.id), contacts = view.contacts.filter(c => c.position === p.id);
    const role = p.id === view.board.reserve ? "Defender fallback entry when the Command Post is lost. Safe staging; geometry and arrival rules are unchanged." : p.id === view.board.objective ? "Control this post through the next resolution to complete a conquest hold." : p.objective === "raid" ? "Raid objective. An outside army must establish a foothold before raiding." : p.id === view.board.approach ? "Safe entry for outside armies." : "Field position.";
    return `<aside class="cb-inspection" aria-label="Tile information"><strong>${esc(p.name)}</strong>${button("close-inspection", "Close", false, 'aria-label="Close tile information"')}<p>${role}</p>
      ${own.map(r => button("army", esc(r.formation.name) + (r.traveling ? " · incoming" : ""), false, `data-army="${esc(r.formation.id)}"`)).join("")}
      ${contacts.map(c => `<p>${esc(view.kingdoms.find(k => k.id === c.kingdom)?.name || "Kingdom")} · ${c.allied ? "Parshendi ally · " : ""}${esc(powerText(c.power))}${c.physicallyVisible ? " · in sight" : " · Intel report"}</p>`).join("")}
      ${!contacts.length ? `<p>${view.visiblePositions.includes(p.id) ? "No enemy force observed." : "Beyond vision. Enemy presence is unknown."}</p>` : ""}
      ${p.id === view.board.objective ? `<p>Controller: ${esc(view.kingdoms.find(k => k.id === d.commandPostController)?.name || "Kingdom")}${d.conquestHold ? ` · ${esc(view.kingdoms.find(k => k.id === d.conquestHold.kingdom)?.name || "Kingdom")} holds for conquest at the next resolution if retained.` : ""}</p>` : ""}
      <small>Inspecting never sends an order.</small></aside>`;
  }
  function movementMarks(d, position) {
    const row = selectedForce(d, selectedArmy), f = row?.formation;
    if (!f) return {classes:"", style:"", markup:""};
    const shade = f.allied ? null : retreatShade(f, position), history = shade && (showHistory || shade.depth === 1);
    const hints = queuedRouteHints(row, { nextCycleAt:d.nextCycleAt, resolutionIntervalMs:d.resolutionIntervalMs,
      arriveAt:d.ownArrivalTimes.find(a => a.formationId === f.id)?.arriveAt }).filter(h => h.position === position);
    const resolution = hints.length ? Math.min(...hints.map(h => h.resolution ?? Infinity)) : Infinity;
    const proposed = draft?.flatMap((id,i) => id === position ? [i+1] : []) || [];
    return {
      classes: (hints.length ? " cb-queued" : "") + (resolution === 1 ? " cb-queued-next" : hints.length ? " cb-queued-later" : "") + (history ? " cb-retreat" : "") + (proposed.length ? " cb-proposed" : ""),
      style: '--queue-opacity:' + (resolution === 1 ? 1 : Number.isFinite(resolution) ? Math.max(.18, .6 / (resolution-1)) : .25) + ';--retreat-color:' + (shade?.color || "transparent"),
      markup: (history ? `<span class="cb-retreat-mark" title="Stored fallback ${shade.depth}; availability depends on occupation">↶${shade.depth}</span>` : "") +
        (hints.length ? `<span class="cb-queue-mark" title="Conditional queued steps ${hints.map(h => h.step).join(", ")}; ${Number.isFinite(resolution) ? "earliest resolution +" + resolution : "timing paused or unavailable"}. Combat, arrival, merging or settlement can interrupt movement.">→${Number.isFinite(resolution) ? resolution : "?"}</span>` : "") +
        (proposed.length ? `<span class="cb-step" aria-label="Proposed waypoint ${proposed.join(", ")}">${proposed.join(",")}</span>` : ""),
    };
  }
  function boardMarkup(d) {
    const view = d.view, f = selectedForce(d, selectedArmy)?.formation;
    const ys = view.board.positions.map(p => p.y), minY = Math.min(...ys);
    const kingdom = id => view.kingdoms.find(k => k.id === id)?.name || "Kingdom";
    const last = draft?.at(-1) || draftOrigin;
    return `<div class="cb-battle-status"><span>Cycle ${view.cycle} · ${view.highstorm ? "Highstorm" : "Clear"}</span><span>Next: ${esc(time(d.nextCycleAt))}</span></div>
      <div class="cb-map-frame">${tileMarkup(d)}<p class="cb-drag-feedback" role="status"></p>
      <div class="cb-grid" aria-label="Conflict battlefield">${view.board.positions.map(p => {
        const own = [...view.own, ...view.ownArrivals.map(a => selectedForce(d, a.formation.id))].filter(r => r.formation.position === p.id), contacts = view.contacts.filter(c => c.position === p.id);
        const marks = movementMarks(d, p.id);
        const valid = draft !== null && view.board.connections.some(([a,b]) => a === last && b === p.id || b === last && a === p.id);
        const ready = view.raidReady.find(r => r.position === p.id);
        return `<div data-player-position="${esc(p.id)}" class="cb-cell ${p.id === view.board.reserve ? "cb-reserve" : ""} ${p.id === view.board.objective || p.objective === "raid" ? "cb-objective" : ""} ${contacts.length ? "cb-known-contact" : ""} ${inspectedTile === p.id ? "cb-inspected" : ""} ${view.visiblePositions.includes(p.id) ? "" : "cb-fog"} ${f?.position === p.id ? "cb-current" : ""} ${marks.classes} ${valid ? "cb-next" : ""}" style="grid-column:${p.x + 1};grid-row:${p.y - minY + 1};${marks.style}">
        <button class="cb-position" type="button" data-cb="position" data-position="${esc(p.id)}" aria-pressed="${inspectedTile === p.id}" ${busy ? "disabled" : ""}>${p.id === view.board.objective || p.objective === "raid" ? "◇ " : ""}${esc(p.name)}</button>
        ${own.length ? '<div class="cb-armies">' : ""}${own.map(r => button("army", `<span class="cb-army-name">${esc(r.formation.name)}</span><span>${r.traveling ? "◷" : "●"} ${r.formation.allied ? "✦" : num(Object.values(r.formation.units).reduce((a,b) => a+b,0))}</span>`, false, `aria-label="${esc(r.formation.name)}${r.traveling ? " (incoming)" : ""}" ${r.traveling ? 'data-incoming="true" title="Incoming formation: drag or tap to plan from its expected entry. Movement waits for arrival."' : ""} data-own="${esc(r.formation.id)}" data-army="${esc(r.formation.id)}" aria-pressed="${selectedArmy === r.formation.id}"`)).join("")}${own.length ? "</div>" : ""}
        ${contacts.map(c => `<p class="cb-contact">${c.allied ? "✦" : "◆"} ${esc(kingdom(c.kingdom))}<span class="cb-contact-power"> · ${esc(powerText(c.power))}</span></p>`).join("")}
        ${!view.visiblePositions.includes(p.id) ? '<span class="cb-fog-mark" aria-label="Beyond vision; tap to inspect">?</span>' : ""}
        ${ready ? `<small class="cb-foothold">Foothold</small>` : ""}<span class="cb-movement-marks">${marks.markup}</span></div>`;
      }).join("")}</div></div>
      <small class="cb-board-hint">Gold →1 next, →2+ later (conditional) · purple ↶ fallback · numbered ◇ proposed. Tap tiles for details.</small>
      ${armyMarkup(d)}`;
  }
  function render() {
    if (!context || dragging || sheetGesture) return;
    const openDetails = new Set([...root.querySelectorAll("details[open]")].map(el => el.querySelector("summary")?.textContent));
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = active?.dataset.cbValue;
    const focusSelector = active?.dataset.army ? '[data-army="' + CSS.escape(active.dataset.army) + '"]' : active?.dataset.position ? '[data-position="' + CSS.escape(active.dataset.position) + '"]' : active?.dataset.cb ? '[data-cb="' + CSS.escape(active.dataset.cb) + '"]' : null;
    const lobby = context.lobby, d = data();
    const battlefield = Boolean(context.focus && selected === context.focus);
    if (d && selectedArmy) {
      const row = selectedForce(d, selectedArmy);
      if (!row || d.status !== "active" || d.withdrawing || d.participantStatus !== "active") {
        selectedArmy = null; draft = null; sheetExpanded = false;
      } else if (draft !== null && row.formation.position !== draftOrigin) {
        draft = null; notice = "Your army's entry or position changed. Plan again from its current position.";
      }
    }
    const wasBattlefield = document.body.classList.contains("cb-battlefield-mode");
    document.body.classList.toggle("cb-battlefield-mode", battlefield && d?.status === "active");
    if (!wasBattlefield && document.body.classList.contains("cb-battlefield-mode") && matchMedia("(max-width: 720px)").matches) window.scrollTo({top:0});
    root.classList.toggle("cb-has-sheet", battlefield && Boolean(selectedArmy));
    root.parentElement?.classList.toggle("cb-battlefield-open", battlefield);
    root.hidden = !lobby || (!lobby.enabled && !lobby.conflicts.length);
    if (root.hidden) { root.innerHTML = ""; if (historyRoot) { historyRoot.hidden = true; historyRoot.innerHTML = ""; } return; }
    root.innerHTML = `${battlefield ? button("back", "← Back to PvP") : ""}<h2 class="cb-heading">${battlefield ? "Battlefield" : "Conflict Board"}</h2>${battlefield ? "" : "<p>Choose a conflict to enter its battlefield. Orders resolve every two hours, even while you are offline.</p>"}
      ${!lobby.enabled ? "<p>New commitments are paused. Existing armies can still receive orders and withdraw.</p>" : ""}
      ${refreshWarning ? `<p class="cb-refresh-warning" role="status">${esc(refreshWarning)}</p>` : ""}
      <p role="status" class="cb-notice">${esc(busy ? "Sending order…" : notice)}</p>
      ${!battlefield ? conflictList(lobby.conflicts.filter(c => c.status === "active")) : ""}
      ${lobby.enabled && !battlefield ? `<section class="cb-launcher"><h3>Open or join a rival conflict</h3><div class="attack-planner"><div class="mission-summary form-wide"><strong>March on a rival plateau</strong><span>Other kingdoms may join. The defender's vulnerable treasury pool is 10% at declaration.</span></div><div class="target-selector form-wide"><label for="cb-plateau-target">Target Plateau</label><select id="cb-plateau-target" data-cb-value="target"><option value="">Choose a holding</option>${targetOptions()}</select><div class="target-selection-details" data-cb-plateau-info>${plateauInfo()}</div></div><div class="form-wide"><label>Select Units</label>${launcherUnits()}</div><div class="attack-outlook form-wide" data-cb-army-outlook>${armyOutlook()}</div><label class="form-wide">Half-Shards to carry<input data-cb-value="commit-fabrials" type="number" min="0" max="128" value="${esc(values["commit-fabrials"] || 0)}"></label>${button("open", "Commit army / join conflict", !values.target)}<p class="hint form-wide">Arrival takes roughly two hours before army Speed and Bridged Plateau reductions.</p></div></section>` : ""}
      ${!battlefield && !historyRoot ? conflictList(lobby.conflicts.filter(c => c.status !== "active"), true) : ""}
      ${battlefield && !d ? "<p>Loading authenticated battlefield…</p>" : ""}
      ${battlefield && d ? `<section data-entity-id="${esc(selected)}"><h3>${esc(lobby.conflicts.find(c => c.conflictId === selected)?.name || "Conflict")}</h3>
      ${assistanceMarkup(d)}
      ${d.status === "settled" ? `<p>Finished: ${esc(d.outcome)}. Surviving assets have returned.</p>` : boardMarkup(d)}
      ${!selectedForce(d, selectedArmy) ? `<details><summary>Conflict actions and reports</summary>${conflictTools(d)}</details>` : ""}</section>` : ""}`;
    for (const el of root.querySelectorAll("details")) if (openDetails.has(el.querySelector("summary")?.textContent)) el.open = true;
    if (focusedKey) [...root.querySelectorAll("[data-cb-value]")].find(el => el.dataset.cbValue === focusedKey)?.focus({ preventScroll: true });
    else if (focusSelector) root.querySelector(focusSelector)?.focus({preventScroll:true});
    if (historyRoot) {
      historyRoot.hidden = battlefield;
      historyRoot.innerHTML = battlefield ? "" : conflictList(lobby.conflicts.filter(c => c.status !== "active"), true);
    }
    bindQuantityControls?.(root);
    fitBoard();
  }
  root.addEventListener("input", e => {
    const key = e.target.dataset.cbValue;
    if (key) values[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (key?.startsWith("commit-")) { const card = root.querySelector("[data-cb-army-outlook]"); if (card) card.innerHTML = armyOutlook(); }
  });
  root.addEventListener("change", e => {
    const key = e.target.dataset.cbValue;
    if (key === "conflict") select(e.target.value);
    else if (key) values[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (key === "target") render();
  });
  root.addEventListener("click", async e => {
    const target = e.target.closest("[data-cb]") || e.target.closest("[data-player-position]");
    if (!target || busy || target.disabled) return;
    const action = target.dataset.cb || "position", d = data(), f = selectedForce(d, selectedArmy)?.formation;
    if (action === "enter") { select(target.dataset.conflict); return; }
    if (action === "back") { select(null); return; }
    if (action === "history") { showHistory = !showHistory; render(); return; }
    if (action === "army") { selectedArmy = target.dataset.army; draft = null; values.defeat = null; notice = ""; sheetExpanded = false; inspectedTile = null; render(); return; }
    if (action === "sheet-toggle") { sheetExpanded = !sheetExpanded; render(); root.querySelector('[data-cb="sheet-toggle"]')?.focus({preventScroll:true}); return; }
    if (action === "close-sheet") { selectedArmy = null; draft = null; sheetExpanded = false; render(); return; }
    if (action === "close-inspection") { inspectedTile = null; render(); return; }
    if (action === "orders" || action === "more") { sheetPanel = action; sheetExpanded = true; render(); return; }
    if (action === "move") { if (!f) return; draft = []; draftOrigin = f.position; sheetExpanded = false; inspectedTile = null; notice = ""; render(); return; }
    if (action === "cancel-route") { draft = null; render(); return; }
    if (action === "clear-route") { draft = []; render(); return; }
    if (action === "position") {
      if (draft !== null) { const next = routeStep(d.view.board, draftOrigin, draft, target.dataset.position || target.dataset.playerPosition); notice = next === draft ? "Choose a connected position." : ""; draft = next; render(); }
      else { inspectedTile = target.dataset.position || target.dataset.playerPosition; render(); }
      return;
    }
    try {
      if (action === "withdraw" && !await confirm("Withdraw all your forces at the next resolution? Surviving troops, equipment and carried cargo return; other participants may continue.")) return;
      if (action === "open" && !values.target) throw Error("Choose a rival holding.");
      if (["open", "reinforce"].includes(action) && !await confirm("Commit these real troops and equipment? They leave your home army now and travel to the conflict.")) return;
      busy = true; notice = ""; render();
      if (action === "open") {
        const plateauId = values.target, c = await readCommand("conflictBoards:atPlateau", { plateauId });
        const payload = { units: readUnits("commit"), fabrials: fabrials("commit") };
        const result = c ? await submit("reinforce", { ...payload, conflictId: c.conflictId, revision: c.revision }) : await submit("open", { ...payload, plateauId });
        select(c?.conflictId || result.conflictId);
      } else if (action === "call-parshendi") {
        const tier = Number(target.dataset.tier);
        if (!await confirm('Spend ' + tier + ' Favor to deploy a separate Parshendi ally at your current entry? It disperses after defeat and withdraws when this conflict ends.')) return;
        await submit("callParshendi", { ...commandArgs(), tier, position: arrivalPosition(data()) });
      } else if (action === "reinforce") await submit("reinforce", { ...commandArgs(), units: readUnits("reinforce"), fabrials: fabrials("reinforce") });
      else if (action === "withdraw") await submit("withdraw", commandArgs());
      else if (action === "confirm-route") {
        if (f.position !== draftOrigin) throw Error("Your army moved while planning. Cancel and draw its route again.");
        await order("move", draft);
      } else if (action === "stop-route") await order("hold");
      else if (action === "hold" || action === "raid") await order(action);
      else if (action === "standing") await order(f.order.kind, f.order.route);
      else if (action === "split") {
        const args = { ...commandArgs(), formationId: f.id, units: readUnits("split"), equipmentIds: (f.equipment?.items || []).filter(i => values[`equipment:${i.id}`]).map(i => i.id) };
        const preview = await readCommand("conflictBoards:previewSplit", args);
        if (preview.cargoLost > 0 && !await confirm(`Splitting off this much Plunder leaves capacity for ${num(preview.remainingCapacity)} of your ${num(preview.cargo)} Spheres. ${num(preview.cargoLost)} Spheres will be lost to the unclaimed pool. Split anyway?`)) { notice = "Split cancelled. Your army and cargo are unchanged."; return; }
        await submit("split", { ...args, acceptedCargoLoss: preview.cargoLost });
      }
      else if (action === "switch" || action === "cancel-switch") await submit("switchFabrial", { ...commandArgs(), formationId: f.id, itemId: action === "switch" ? target.dataset.item : null });
      else if (action === "merge-route") await submit("chooseMergeRoute", { ...commandArgs(), formationId: f.id, position: values.merge || f.position });
      notice = "Order accepted. The battlefield updates automatically.";
    } catch (error) { notice = /load failed|failed to fetch|networkerror/i.test(error.message || "") ? "Order confirmation unavailable. It may have been received. Retry the same command when connected; its receipt prevents duplicates." : error.message || "Unable to send order."; }
    finally { busy = false; render(); }
  });
  historyRoot?.addEventListener("click", e => {
    const entry = e.target.closest('[data-cb="enter"]');
    if (entry && !busy) select(entry.dataset.conflict);
  });
  const paintDrag = () => {
    const f = selectedForce(data(), selectedArmy)?.formation;
    const last = draft?.at(-1) || draftOrigin;
    for (const cell of root.querySelectorAll("[data-player-position]")) {
      const id = cell.dataset.playerPosition;
      cell.classList.toggle("cb-current", f?.position === id);
      const marks = movementMarks(data(), id);
      for (const cls of ["cb-proposed", "cb-queued", "cb-queued-next", "cb-queued-later", "cb-retreat"]) cell.classList.toggle(cls, marks.classes.split(" ").includes(cls));
      cell.querySelector(".cb-movement-marks").innerHTML = marks.markup;
      for (const part of marks.style.split(";")) { const [key,value] = part.split(":"); if (key && value) cell.style.setProperty(key,value); }
      cell.classList.toggle("cb-next", draft !== null && data().view.board.connections.some(([a,b]) => a === last && b === id || b === last && a === id));
    }
    const feedback = root.querySelector(".cb-drag-feedback");
    if (feedback) feedback.textContent = draft === null ? "" : `${[draftOrigin, ...draft].join(" → ")} — release, then Confirm.`;
  };
  attachRouteDrag(root, {
    begin: id => {
      const d = data(), row = selectedForce(d, id);
      if (busy || !row || d.status !== "active" || d.withdrawing || d.participantStatus !== "active") return false;
      root.querySelector(".cb-inspection")?.remove();
      root.querySelector(".cb-sheet")?.remove();
      dragging = true; sheetExpanded = false; inspectedTile = null; selectedArmy = id; draftOrigin = row.formation.position; draft = []; values.defeat = null; paintDrag();
    },
    visit: position => { if (!dragging || draft === null) return; draft = routeStep(data().view.board, draftOrigin, draft, position); paintDrag(); },
    cancel: () => { dragging = false; draft = null; render(); },
    end: () => { dragging = false; render(); },
  });
  root.addEventListener("pointerdown", e => {
    const handle = e.target.closest(".cb-sheet-handle");
    if (!handle || !e.isPrimary || e.button !== 0 || dragging) return;
    suppressSheetClick = false;
    sheetGesture = { id:e.pointerId, y:e.clientY, handle };
    handle.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", e => {
    if (!sheetGesture || e.pointerId !== sheetGesture.id) return;
    const delta = e.clientY - sheetGesture.y;
    const sheet = root.querySelector(".cb-sheet");
    if (sheet) sheet.style.transform = 'translateY(' + Math.max(-60, Math.min(80, delta)) + 'px)';
  });
  const endSheetGesture = (e, cancel = false) => {
    if (!sheetGesture || e.pointerId !== sheetGesture.id) return;
    const gesture = sheetGesture, delta = e.clientY - gesture.y;
    sheetGesture = null;
    if (gesture.handle.hasPointerCapture(e.pointerId)) gesture.handle.releasePointerCapture(e.pointerId);
    if (!cancel && Math.abs(delta) > 24) { sheetExpanded = delta < 0; suppressSheetClick = true; }
    if (cancel || Math.abs(delta) > 24) render();
    else { const sheet = root.querySelector(".cb-sheet"); if (sheet) sheet.style.transform = ""; }
  };
  root.addEventListener("pointerup", e => endSheetGesture(e));
  root.addEventListener("pointercancel", e => endSheetGesture(e, true));
  root.addEventListener("lostpointercapture", e => { if (sheetGesture) endSheetGesture(e, true); });
  root.addEventListener("click", e => {
    if (suppressSheetClick && e.target.closest(".cb-sheet-handle")) { e.stopImmediatePropagation(); e.preventDefault(); suppressSheetClick = false; }
  }, true);
  root.addEventListener("toggle", e => {
    if (!e.target.matches?.(".cb-more-panel > details") || !e.target.open) return;
    for (const detail of e.target.parentElement.children) if (detail !== e.target && detail.tagName === "DETAILS") detail.open = false;
    fitBoard();
  }, true);
  // Safari toolbar/scroll changes must not resize tactical targets. Reserve the
  // planning peek even before selection, and cache against width/orientation only.
  let fittedLayout = null;
  function fitBoard() {
    if (dragging || sheetGesture || draft !== null) return;
    if (!matchMedia("(max-width: 720px)").matches || !document.body.classList.contains("cb-battlefield-mode")) return;
    const grid = root.querySelector(".cb-grid");
    if (!grid) return;
    const width = Math.round(root.getBoundingClientRect().width);
    const orientation = screen.orientation?.angle ?? window.orientation ?? 0;
    if (fittedLayout?.width === width && fittedLayout.orientation === orientation) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;height:100svh;width:0";
    root.append(probe);
    const viewportHeight = probe.getBoundingClientRect().height || innerHeight;
    probe.remove();
    const navHeight = document.querySelector(".primary-nav")?.getBoundingClientRect().height || 0;
    const gridTop = grid.getBoundingClientRect().top + window.scrollY;
    const height = Math.max(279, viewportHeight - gridTop - Math.max(68, navHeight) - 190 - 22);
    root.style.setProperty("--cb-board-height", height + "px");
    fittedLayout = {width, orientation};
  }
  // ResizeObserver ignores height changes caused by the board/sheet itself.
  const boardWidthObserver = new ResizeObserver(() => fitBoard());
  boardWidthObserver.observe(root);
  window.addEventListener("resize", fitBoard);
  window.addEventListener("orientationchange", fitBoard);
  screen.orientation?.addEventListener("change", fitBoard);
  return {
    setRefreshError(key) { refreshWarning = key ? "Battlefield refresh unavailable (" + key + "). Showing the last view; this is not an order failure." : ""; render(); },
    update(next) {
      context = next;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      if (next.focus && next.focus !== handledFocus && next.lobby?.conflicts.some(c => c.conflictId === next.focus)) { handledFocus = next.focus; select(next.focus); }
      if (!next.focus) handledFocus = null;
      render();
    },
    select,
    get selected() { return selected; },
    reset() { fittedLayout = null; root.style.removeProperty("--cb-board-height"); document.body.classList.remove("cb-battlefield-mode"); root.parentElement?.classList.remove("cb-battlefield-open"); sheetExpanded = false; inspectedTile = null; root.classList.remove("cb-has-sheet"); context = null; selected = null; selectedArmy = null; draft = null; values = {}; signature = ""; pendingSubmission = null; handledFocus = null; root.innerHTML = ""; root.hidden = true; if (historyRoot) { historyRoot.innerHTML = ""; historyRoot.hidden = true; } },
  };
}
