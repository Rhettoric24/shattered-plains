// Normal-game transport UI. Receives only the authenticated server projection;
// never imports a resolver, Lab snapshot, or hidden enemy state.
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
  return a ? { formation: { ...a.formation, position: arrivalPosition(data), history: [] }, traveling: true } : null;
}
function powerText(p) {
  if (!p) return "Unknown Power";
  if (p.mode === "exact") return `${num(p.value)} Power`;
  if (p.mode === "estimate" || p.mode === "range") return `${num(p.min)}–${p.max == null ? "∞" : num(p.max)} Power`;
  return p.label;
}

export function createConflictBoardUI({ root, query, mutate, onSelect, confirm = message => window.confirm(message) }) {
  let context, selected = null, selectedArmy = null, draft = null, draftOrigin = null;
  let signature = "", busy = false, notice = "", values = {}, pendingSubmission = null, handledFocus = null;
  const button = (action, label, disabled = false, extra = "") => `<button type="button" data-cb="${action}" ${disabled || busy ? "disabled" : ""} ${extra}>${label}</button>`;
  function select(id) {
    selected = id || null; selectedArmy = null; draft = null; values = {}; pendingSubmission = null;
    notice = ""; onSelect(selected); render();
  }
  function inputs(prefix, available) {
    return `<div class="cb-units">${troopKeys.map(k => `<label>${names[k]} <small>${num(available?.[k])} available</small><input data-cb-value="${prefix}-${k}" aria-label="${prefix} ${names[k]}" type="number" min="0" max="${available?.[k] || 0}" step="1" value="${esc(values[`${prefix}-${k}`] || 0)}"></label>`).join("")}</div>`;
  }
  const readUnits = prefix => ({ scout: 0, heavy: 0, ...Object.fromEntries(troopKeys.map(k => [k, Number(values[`${prefix}-${k}`] || 0)])) });
  const commitment = prefix => `${inputs(prefix, context.ready)}<label>Half-Shards to carry <input data-cb-value="${prefix}-fabrials" type="number" min="0" max="128" value="${esc(values[`${prefix}-fabrials`] || 0)}"></label><small>Uses your real inventory. Painrial, Soulcaster and Conclave attachment remain unavailable on live Boards.</small>`;
  const fabrials = prefix => {
    const count = Number(values[`${prefix}-fabrials`] || 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > 128) throw Error("Choose 0–128 available Half-Shards.");
    return Array(count).fill("halfShard");
  };
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
  function armyMarkup(d) {
    const row = selectedForce(d, selectedArmy);
    if (!row) return "<p>Tap one of your formations to command it. Enemy contacts show only what your Military Intel reveals.</p>";
    const f = row.formation, stats = row.stats, locked = d.status !== "active" || d.withdrawing || d.participantStatus !== "active";
    const raid = !row.traveling && d.view.viewer !== d.originalOwner && d.view.board.positions.find(p => p.id === f.position)?.objective === "raid";
    const items = f.equipment?.items || [];
    return `<section class="cb-army" aria-label="Selected formation"><h3>${esc(f.name)}</h3><p>${esc(unitsText(f.units))}</p>
      ${stats ? `<p>Power ${num(stats.power)} · Speed ${num(stats.speed)} · Survival ${num(stats.survive)} · Plunder ${num(stats.plunder)}<br>${esc(stats.specialization)} specialization · normalized Speed / Survival / Plunder: ${stats.ratings.map(num).join(" / ")}<br>Cargo ${num(row.cargo)} / ${num(row.capacity)}</p>` : "<p>Traveling force — arrival and entry determine its first available movement.</p>"}
      <p>Position: ${esc(f.position)} · Standing order: ${esc(f.order.kind)}${f.order.paused ? " (paused)" : ""}</p>
      <div class="cb-actions">${button("move", "Move", locked)}${button("hold", "Hold", locked)}${button("raid", "Raid", locked || !raid)}</div>
      <small>${raid ? "A foothold must survive into a later resolution. A Raid order repeats while you retain control." : "Raid requires an outside force at West or East Raid. Move there first."}</small>
      ${draft !== null ? `<div class="cb-route"><strong>Proposed: ${esc([draftOrigin, ...draft].join(" → "))}</strong><p>Tap connected positions. Tap the preceding position to backtrack.</p>${button("confirm-route", "Confirm route", !draft.length || locked)} ${button("clear-route", "Clear")} ${button("cancel-route", "Cancel")}</div>` : ""}
      <label>After defeat <select data-cb-value="defeat"><option value="continue" ${(values.defeat || f.order.onDefeat) === "continue" ? "selected" : ""}>Continue toward destination</option><option value="pause" ${(values.defeat || f.order.onDefeat) === "pause" ? "selected" : ""}>Pause movement</option></select></label>${button("standing", "Save standing order", locked)}
      <details><summary>Route and retreat details</summary><p>Approved: ${esc(f.order.route.join(" → ") || "None")}</p><p>Retreat history: ${esc(f.history.join(" → ") || "Not yet deployed")}</p><label>Preserve this formation's route when merging at <select data-cb-value="merge">${d.view.board.positions.map(p => `<option value="${esc(p.id)}" ${(values.merge || f.position) === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>${button("merge-route", "Choose merge route", locked || row.traveling)}</details>
      <details><summary>Split formation</summary><p>A new formation receives these troops and the selected equipment. Cargo carriers cannot split.</p>${inputs("split", f.units)}${items.map(item => `<label><input type="checkbox" data-cb-value="equipment:${esc(item.id)}" ${values[`equipment:${item.id}`] ? "checked" : ""}> Give ${esc(item.kind)} to the new formation</label>`).join("")}${button("split", "Split troops", locked || row.traveling || row.cargo > 0)}</details>
      <details><summary>Carried Fabrials (${items.length})</summary>${items.map(item => `<p>${esc(item.kind)} — ${f.equipment.active === item.id ? "Active" : f.equipment.pending?.id === item.id ? "Activates after next resolution" : "Carried"} ${button("switch", "Select", locked || row.traveling || f.equipment.active === item.id, `data-item="${esc(item.id)}"`)}</p>`).join("") || "No carried equipment."}${f.equipment?.pending ? button("cancel-switch", "Cancel pending change", locked || row.traveling) : ""}</details>
    </section>`;
  }
  function boardMarkup(d) {
    const view = d.view, f = selectedForce(d, selectedArmy)?.formation;
    const ys = view.board.positions.map(p => p.y), minY = Math.min(...ys);
    const kingdom = id => view.kingdoms.find(k => k.id === id)?.name || "Kingdom";
    const last = draft?.at(-1) || draftOrigin;
    return `<p>Cycle ${view.cycle} · ${view.highstorm ? "Highstorm active" : "Clear weather"} · Next resolution: ${esc(time(d.nextCycleAt))}<br>Deadline: ${esc(time(d.deadlineAt))}</p>
      <p>Command Post: ${esc(kingdom(d.commandPostController))}${d.conquestHold ? ` · ${esc(kingdom(d.conquestHold.kingdom))} will conquer if it keeps control through the next resolution.` : ""}</p>
      <p class="cb-legend">Cyan: current · blue: approved route · purple: retreat history · gold: proposed route</p>
      <div class="cb-grid" aria-label="Conflict battlefield">${view.board.positions.map(p => {
        const own = view.own.filter(r => r.formation.position === p.id), contacts = view.contacts.filter(c => c.position === p.id);
        const h = f?.history.indexOf(p.id) ?? -1, forward = f?.order.route.includes(p.id), proposed = draft?.includes(p.id);
        const valid = draft !== null && view.board.connections.some(([a,b]) => a === last && b === p.id || b === last && a === p.id);
        const ready = view.raidReady.find(r => r.position === p.id);
        return `<div class="cb-cell ${view.visiblePositions.includes(p.id) ? "" : "cb-fog"} ${f?.position === p.id ? "cb-current" : ""} ${forward ? "cb-forward" : ""} ${proposed ? "cb-proposed" : ""} ${valid ? "cb-next" : ""}" style="grid-column:${p.x + 1};grid-row:${p.y - minY + 1};${h >= 0 ? `background:rgba(126,67,190,${0.18 + 0.42 * (h + 1) / Math.max(1,f.history.length)})` : ""}">
        <button class="cb-position" type="button" data-cb="position" data-position="${esc(p.id)}" ${busy ? "disabled" : ""}>${esc(p.name)}${proposed ? ` <b>${draft.indexOf(p.id) + 1}</b>` : ""}</button>
        ${own.map(r => button("army", `${esc(r.formation.name)}<br>${num(Object.values(r.formation.units).reduce((a,b) => a+b,0))} troops`, false, `data-army="${esc(r.formation.id)}" aria-pressed="${selectedArmy === r.formation.id}"`)).join("")}
        ${contacts.map(c => `<p class="cb-contact">${esc(kingdom(c.kingdom))}<br>${esc(powerText(c.power))}</p>`).join("")}
        ${!own.length && !contacts.length ? `<small>${view.visiblePositions.includes(p.id) ? "No observed force" : "Beyond vision"}</small>` : ""}
        ${ready ? `<small>Foothold — Raid available next resolution if held</small>` : ""}</div>`;
      }).join("")}</div>${view.ownArrivals.length ? `<h3>Approaching forces</h3>${view.ownArrivals.map(a => button("army", `${esc(a.formation.name)} · arrives ${esc(time(d.ownArrivalTimes.find(t => t.formationId === a.formation.id)?.arriveAt))}`, false, `data-army="${esc(a.formation.id)}"`)).join(" ")}` : ""}
      ${armyMarkup(d)}`;
  }
  function render() {
    if (!context) return;
    const openDetails = new Set([...root.querySelectorAll("details[open]")].map(el => el.querySelector("summary")?.textContent));
    const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset.cbValue : null;
    const lobby = context.lobby, d = data();
    root.hidden = !lobby || (!lobby.enabled && !lobby.conflicts.length);
    if (root.hidden) { root.innerHTML = ""; return; }
    root.innerHTML = `<h2>Conflict Board</h2><p>Commit real armies. Plan routes now; the server resolves every two hours, even while you are offline.</p>
      ${!lobby.enabled ? "<p>New commitments are paused. Existing armies can still receive orders and withdraw.</p>" : ""}
      <p role="status" class="cb-notice">${esc(busy ? "Sending order…" : notice)}</p>
      <label>Your conflicts <select data-cb-value="conflict"><option value="">Choose a conflict</option>${lobby.conflicts.map(c => `<option value="${esc(c.conflictId)}" ${selected === c.conflictId ? "selected" : ""}>${esc(c.name)} — ${esc(c.status)}</option>`).join("")}</select></label>
      ${lobby.enabled ? `<details><summary>Open or join a rival conflict</summary><label>Rival holding<select data-cb-value="target"><option value="">Choose a holding</option>${context.targets.map(p => `<option value="${esc(p._id)}" ${values.target === p._id ? "selected" : ""}>${esc(p.name)} · ${esc(p.ownerName)}</option>`).join("")}</select></label>${commitment("commit")}${button("open", "Commit army / join conflict")}<p>Arrival takes roughly two hours, modified by travel Speed. Other kingdoms may join. The defender's vulnerable treasury pool is 10% at declaration.</p></details>` : ""}
      ${selected && !d ? "<p>Loading authenticated battlefield…</p>" : ""}
      ${d ? `<section data-entity-id="${esc(selected)}"><h3>${esc(lobby.conflicts.find(c => c.conflictId === selected)?.name || "Conflict")}</h3>
      ${d.status === "settled" ? `<p>Finished: ${esc(d.outcome)}. Surviving assets have returned.</p>` : boardMarkup(d)}
      <p>Returned: ${esc(unitsText(d.returnedUnits))} · ${num(d.returnedSpheres)} Spheres returned · ${num(d.banked)} Spheres extracted.</p>
      ${d.status === "active" ? `<p>${d.withdrawing ? "Withdrawal pending for next resolution." : d.participantStatus === "returned" ? "Your armies have returned. You may recommit while this conflict remains open." : ""}</p>
      ${lobby.enabled && !d.withdrawing ? `<details><summary>Send reinforcements</summary>${commitment("reinforce")}${button("reinforce", "Dispatch reinforcements")}</details>` : ""}
      ${d.participantStatus === "active" ? button("withdraw", "Withdraw all my forces", d.withdrawing) : ""}` : ""}
      <details><summary>Your battle reports (${d.journal.length})</summary>${d.journal.map(e => `<p>Cycle ${e.cycle}, ${esc(e.position)}: ${e.won ? "won" : "did not win"}. Lost ${esc(unitsText(e.casualties))}.</p>`).join("") || "No reported battles yet."}</details></section>` : ""}`;
    for (const el of root.querySelectorAll("details")) if (openDetails.has(el.querySelector("summary")?.textContent)) el.open = true;
    if (focusedKey) [...root.querySelectorAll("[data-cb-value]")].find(el => el.dataset.cbValue === focusedKey)?.focus({ preventScroll: true });
  }
  root.addEventListener("input", e => {
    const key = e.target.dataset.cbValue;
    if (key) values[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  });
  root.addEventListener("change", e => {
    const key = e.target.dataset.cbValue;
    if (key === "conflict") select(e.target.value);
    else if (key) values[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  });
  root.addEventListener("click", async e => {
    const target = e.target.closest("[data-cb]");
    if (!target || busy || target.disabled) return;
    const action = target.dataset.cb, d = data(), f = selectedForce(d, selectedArmy)?.formation;
    if (action === "army") { selectedArmy = target.dataset.army; draft = null; values.defeat = null; notice = ""; render(); return; }
    if (action === "move") { draft = []; draftOrigin = f.position; render(); return; }
    if (action === "cancel-route") { draft = null; render(); return; }
    if (action === "clear-route") { draft = []; render(); return; }
    if (action === "position") {
      if (draft !== null) { const next = routeStep(d.view.board, draftOrigin, draft, target.dataset.position); notice = next === draft ? "Choose a connected position." : ""; draft = next; render(); }
      return;
    }
    try {
      if (action === "withdraw" && !await confirm("Withdraw all your forces at the next resolution? Surviving troops, equipment and carried cargo return; other participants may continue.")) return;
      if (action === "open" && !values.target) throw Error("Choose a rival holding.");
      if (["open", "reinforce"].includes(action) && !await confirm("Commit these real troops and equipment? They leave your home army now and travel to the conflict.")) return;
      busy = true; notice = ""; render();
      if (action === "open") {
        const plateauId = values.target, c = await query("conflictBoards:atPlateau", { plateauId });
        const payload = { units: readUnits("commit"), fabrials: fabrials("commit") };
        const result = c ? await submit("reinforce", { ...payload, conflictId: c.conflictId, revision: c.revision }) : await submit("open", { ...payload, plateauId });
        select(c?.conflictId || result.conflictId);
      } else if (action === "reinforce") await submit("reinforce", { ...commandArgs(), units: readUnits("reinforce"), fabrials: fabrials("reinforce") });
      else if (action === "withdraw") await submit("withdraw", commandArgs());
      else if (action === "confirm-route") {
        if (f.position !== draftOrigin) throw Error("Your army moved while planning. Cancel and draw its route again.");
        await order("move", draft);
      } else if (action === "hold" || action === "raid") await order(action);
      else if (action === "standing") await order(f.order.kind, f.order.route);
      else if (action === "split") await submit("split", { ...commandArgs(), formationId: f.id, units: readUnits("split"), equipmentIds: (f.equipment?.items || []).filter(i => values[`equipment:${i.id}`]).map(i => i.id) });
      else if (action === "switch" || action === "cancel-switch") await submit("switchFabrial", { ...commandArgs(), formationId: f.id, itemId: action === "switch" ? target.dataset.item : null });
      else if (action === "merge-route") await submit("chooseMergeRoute", { ...commandArgs(), formationId: f.id, position: values.merge || f.position });
      notice = "Order accepted. The battlefield updates automatically.";
    } catch (error) { notice = error.message || "Unable to send order."; }
    finally { busy = false; render(); }
  });
  return {
    update(next) {
      context = next;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      if (next.focus && next.focus !== handledFocus && next.lobby?.conflicts.some(c => c.conflictId === next.focus)) { handledFocus = next.focus; select(next.focus); }
      if (!selected && next.lobby?.conflicts.some(c => c.status === "active")) select(next.lobby.conflicts.find(c => c.status === "active").conflictId);
      render();
    },
    select,
    get selected() { return selected; },
    reset() { context = null; selected = null; selectedArmy = null; draft = null; values = {}; signature = ""; pendingSubmission = null; handledFocus = null; root.innerHTML = ""; root.hidden = true; },
  };
}
