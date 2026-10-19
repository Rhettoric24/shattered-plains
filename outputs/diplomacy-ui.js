import { DIPLOMACY, donationReduction, tributeProgress } from "../convex/diplomacyRules";
import { effectivePower, effectiveSurvivability, casualtyRateAfterSurvivability, UNIT_RULES, emptyUnits, unitKeys, casualtySummary } from "../convex/rules";
import { categoryIntelDisclosureLevel } from "../convex/espionageRules";
const intelTier = amount => ["public information", "estimates", "exact disclosure"][categoryIntelDisclosureLevel(amount)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = value => Number(value || 0).toLocaleString();
const resourceLabel = (resource, amount) => resource === 'spheres' ? 'Spheres' : amount === 1 ? 'Gemheart' : 'Gemhearts';
export function donationPreview(d, resource, amount, available) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) return { missing: "Choose a whole amount you can afford." };
  if (d.favor >= d.cap) return { missing: "Favor is full. Spend Favor first; your donation progress is saved." };
  const t = d.tribute;
  try {
    const progress = tributeProgress((t.sphereCredit || 0) + (resource === "spheres" ? amount : 0), (t.gemheartCredit || 0) + (resource === "gemhearts" ? amount : 0), d.favor);
    return { ...progress, reduction: Math.min(d.hostility, donationReduction(t.window || { spheres:0, gemhearts:0 }, resource, amount)), missing: null };
  } catch (error) { return { missing: error.message }; }
}
export function troopPreview(missions, units, kind) {
  const power = effectivePower(units, missions.completed);
  const survive = effectiveSurvivability(units, missions.completed);
  const rate = casualtyRateAfterSurvivability(missions.stormBaseRate, Math.min(survive, missions.stormSurviveCap));
  return { power, missing: power < missions.minimumPower ? `Choose at least ${num(missions.minimumPower)} Power.` : null,
    risk: kind === 'storm' ? `Expected troop losses: ${(rate * 100).toFixed(1)}% on dispatch (rounded by the existing casualty roll). Survivors return at storm end. No equipment or Conclave protection.` : 'All troops return safely after four real hours. No cancellation.' };
}
function troopControls(p, d, selected, busy) {
  const preview = troopPreview(d.missions, selected, p.kind);
  return `<fieldset class="diplomacy-troops" data-troop-picker="${esc(p.id)}"><legend>Choose troops · minimum ${num(d.missions.minimumPower)} Power</legend>${
    unitKeys().filter(k => UNIT_RULES[k].active).map(k => `<label>${esc(UNIT_RULES[k].name)} · ${num(d.missions.units[k])} ready<input aria-label="${esc(p.title + ' ' + UNIT_RULES[k].name)}" type="number" min="0" step="1" max="${d.missions.units[k]}" data-mission-unit="${k}" value="${selected[k] || 0}" ${busy ? 'disabled' : ''}></label>`).join('')
  }<p data-troop-preview aria-live="polite">${esc(num(preview.power) + ' / ' + num(d.missions.minimumPower) + ' Power. ' + preview.risk)}</p></fieldset>`;
}
export function diplomacyMarkup(d, { spheres = 0, gemhearts = 0, observer = false, now = Date.now(), busy = false, resource = "spheres", amount = 1000, selections = new Map() } = {}) {
  if (!d) return '<p role="status">Loading Parshendi relations…</p>';
  const cap = d.favor >= d.cap, t = d.tribute;
  const limit = resource === "spheres" ? DIPLOMACY.maximumSphereDonation : DIPLOMACY.maximumGemheartDonation;
  const available = Math.max(0, Math.min(limit, Math.floor(resource === "spheres" ? spheres : gemhearts)));
  const preview = donationPreview(d, resource, amount, available);
  return `<div class="mission-summary"><strong>Hostility ${d.hostility}/100 · Favor ${d.favor}/${d.cap}</strong><span>Hostility governs Parshendi danger, retaliation, and high-Hostility Deep Plains access and rewards. Favor purchases allied assistance in PvP; gaining Favor does not require low Hostility.</span></div>
    ${cap ? '<p class="rule-callout">Favor is full. Spend Favor before donating or fulfilling a petition. Your donation progress is saved; nothing will be consumed at the cap.</p>' : ''}
    <h3>Standing tribute</h3><p>Donate Spheres or Gemhearts separately to lower Hostility. Your kingdom remembers both donations: every ${num(t.spheres)} Spheres <strong>and</strong> ${num(t.gemhearts)} Gemheart earns 1 Favor. Excess carries forward.</p>
    <div class="diplomacy-progress" aria-label="Your tribute progress">
      <label>Spheres toward Favor <strong>${num(t.sphereCredit)} / ${num(t.spheres)}</strong><progress aria-label="Spheres toward Favor" max="${t.spheres}" value="${Math.min(t.sphereCredit || 0, t.spheres)}"></progress></label>
      <label>Gemhearts toward Favor <strong>${num(t.gemheartCredit)} / ${num(t.gemhearts)}</strong><progress aria-label="Gemhearts toward Favor" max="${t.gemhearts}" value="${Math.min(t.gemheartCredit || 0, t.gemhearts)}"></progress></label>
      <small>Both bars must fill for a Favor. Progress belongs to your kingdom and does not expire.</small>
    </div>
    <div class="diplomacy-donation"><div class="cb-actions"><button type="button" data-donation-resource="spheres" aria-pressed="${resource === 'spheres'}" ${busy ? 'disabled' : ''}>Spheres</button><button type="button" data-donation-resource="gemhearts" aria-pressed="${resource === 'gemhearts'}" ${busy ? 'disabled' : ''}>Gemhearts</button></div>
      <label for="donation-amount">${resource === 'spheres' ? 'Spheres' : 'Gemhearts'} to donate · ${num(available)} available</label>
      <input id="donation-range" aria-label="Donation amount slider" type="range" data-donation-range min="0" max="${available}" step="1" value="${Math.min(amount, available)}" ${busy || !available ? 'disabled' : ''}>
      <input id="donation-amount" aria-label="Exact donation amount" type="number" data-donation-amount min="1" max="${available}" step="1" value="${amount}" ${busy || !available ? 'disabled' : ''}>
      <p data-donation-preview aria-live="polite">${esc(preview.missing || `Hostility −${preview.reduction} (${d.hostility} → ${d.hostility - preview.reduction}) · +${preview.favorGranted} Favor`)}</p>
      <button type="button" data-diplomacy="tribute" ${busy || observer || preview.missing ? 'disabled' : ''}>Donate ${num(amount)} ${resourceLabel(resource, amount)}</button>
    </div>
    <p class="hint">Larger donations lower more Hostility, with diminishing returns based on your total donations in a 24-hour window. Splitting payments gives the same result. Petitions remain the more efficient Favor path.${t.windowResetsAt ? ` The current donation window resets ${esc(new Date(t.windowResetsAt).toLocaleString())}.` : ''}</p>
    <h3>Parshendi Petitions</h3><p>Shared by all kingdoms. First eligible fulfillment wins. All Sphere and Gemheart payments belong to standing tribute.</p>
    <p>${num(d.intelPurchases)} / ${DIPLOMACY.intelPurchasesPerHour} Intel requests purchased this hour across all kingdoms. A purchase draws another random player and category until the limit; resets ${esc(new Date(d.intelResetsAt || now).toLocaleTimeString())}.</p>
    <div class="building-grid">${d.petitions.filter(p => p.kind !== 'supplies').map(p => {
      const missing = p.expiresAt <= now ? 'Expired; awaiting the hourly board refresh.' : p.missing;
      const troop = p.kind === 'escort' || p.kind === 'storm', selected = selections.get(p.id) || emptyUnits();
      const troopMissing = troop && d.missions ? troopPreview(d.missions, selected, p.kind).missing : null;
      return `<article class="upgrade-card"><h4>${esc(p.title)}</h4><p>${esc(p.objective)}</p><p><strong>+${p.favor} Favor · −${p.hostilityReduction} Hostility</strong></p><p>Expires ${esc(new Date(p.expiresAt).toLocaleString())}</p>${troop && d.missions ? troopControls(p, d, selected, busy) : ''}${p.kind === 'intel' && p.intelRemaining >= 0 ? `<p>After sharing: ${p.intelRemaining} ${esc(p.category || 'category')} Intel. ${intelTier(p.intelRemaining + DIPLOMACY.intelCost)} → ${intelTier(p.intelRemaining)}.</p>` : ''}<p data-petition-status role="status">${esc(missing || troopMissing || 'Requirements met · available to fulfill now')}</p><button type="button" data-diplomacy="fulfill" data-petition="${esc(p.id)}" ${busy || observer || missing || troopMissing || cap ? 'disabled' : ''}>${p.kind === 'plateau' ? 'Donate Plateau' : troop ? 'Dispatch troops' : p.kind === 'intel' ? 'Share Intel' : 'Claim Reward'}</button></article>`;
    }).join('') || '<p>No active petitions. The board refreshes hourly. Occupation needs an eligible holding; Intel needs at least two kingdoms and room under the hourly purchase limit.</p>'}</div>
    ${d.assignments?.length ? '<h3>Troops on assignment</h3>' + d.assignments.map(a => '<p>' + (a.kind === 'storm' ? 'Storm researchers' : 'Escort') + ': ' + esc(casualtySummary(a.units)) + '. Returns ' + esc(new Date(a.returnAt).toLocaleString()) + (a.kind === 'storm' ? '. Research casualties: ' + esc(casualtySummary(a.casualties)) : '') + '.</p>').join('') + '<p class="hint">Away troops remain in Provisions. Favor was paid at dispatch; returning troops does not require room under the cap.</p>' : ''}
    <h3>Parshendi assistance</h3><p>Call assistance from an active PvP battlefield. One allied formation per kingdom across all conflicts. Allies remain separate from your armies, move one square per resolution, and disperse after one defeat or when the conflict ends.</p>
    <ul>${d.tiers.map(tier => `<li>${tier.cost} Favor: ${esc(tier.name)} · ${num(tier.power)} Power</li>`).join('')}</ul>
    <p class="hint">Allies can capture the Command Post, but cannot raid, carry loot, split, merge, or use equipment. Storms restrict vision but cause no allied casualties.</p>
    <p>Shared Gemheart reserve: ${num(d.reserveGemhearts)}. Donated Gemhearts are held for a future exchange.</p>`;
}
export function createDiplomacyUI({ root, mutate, refresh, confirm = message => window.confirm(message) }) {
  let data, resources, busy = false, notice = '', resource = 'spheres';
  const amounts = { spheres:1000, gemhearts:1 }, requests = new Map(), selections = new Map();
  const render = () => { root.innerHTML = `<p role="status">${esc(notice)}</p>` + diplomacyMarkup(data, { ...resources, busy, resource, selections, amount:amounts[resource] }); };
  function updatePreview() {
    const available = Math.min(resource === 'spheres' ? DIPLOMACY.maximumSphereDonation : DIPLOMACY.maximumGemheartDonation, Math.floor(resources?.[resource] || 0));
    const preview = donationPreview(data, resource, amounts[resource], available), button = root.querySelector('[data-diplomacy="tribute"]');
    root.querySelector('[data-donation-preview]').textContent = preview.missing || `Hostility −${preview.reduction} (${data.hostility} → ${data.hostility - preview.reduction}) · +${preview.favorGranted} Favor`;
    button.disabled = busy || resources?.observer || Boolean(preview.missing);
    button.textContent = `Donate ${num(amounts[resource])} ${resourceLabel(resource, amounts[resource])}`;
  }
  root.addEventListener('input', event => {
    if (event.target.matches('[data-mission-unit]') && data?.missions) {
      const picker = event.target.closest('[data-troop-picker]'), id = picker.dataset.troopPicker;
      const units = selections.get(id) || emptyUnits();
      units[event.target.dataset.missionUnit] = Number(event.target.value); selections.set(id, units);
      const petition = data.petitions.find(p => p.id === id), preview = troopPreview(data.missions, units, petition.kind);
      picker.querySelector('[data-troop-preview]').textContent = num(preview.power) + ' / ' + num(data.missions.minimumPower) + ' Power. ' + preview.risk;
      picker.parentElement.querySelector('[data-petition-status]').textContent = petition.missing || preview.missing || 'Requirements met · available to dispatch now';
      const invalid = unitKeys().some(k => !Number.isSafeInteger(units[k]) || units[k] < 0 || units[k] > (data.missions.units[k] || 0));
      picker.parentElement.querySelector('[data-diplomacy]').disabled = busy || resources?.observer || Boolean(petition.missing || preview.missing || invalid) || data.favor >= data.cap;
      return;
    }
    if (!event.target.matches('[data-donation-range], [data-donation-amount]') || !data) return;
    amounts[resource] = Number(event.target.value);
    for (const input of root.querySelectorAll('[data-donation-range], [data-donation-amount]')) if (input !== event.target) input.value = amounts[resource];
    updatePreview();
  });
  root.addEventListener('click', async event => {
    const choice = event.target.closest('[data-donation-resource]');
    if (choice && !busy) { resource = choice.dataset.donationResource; render(); return; }
    const button = event.target.closest('[data-diplomacy]');
    if (!button || button.disabled || busy || !data) return;
    const petition = data.petitions.find(p => p.id === button.dataset.petition);
    if (petition?.kind === 'plateau' && !await confirm(`Relinquish this plateau to the Parshendi immediately? ${petition.objective} Reward: +${petition.favor} Favor and −${petition.hostilityReduction} Hostility.`)) return;
    const troop = petition && (petition.kind === 'escort' || petition.kind === 'storm');
    if (troop && !await confirm(`Dispatch ${num(troopPreview(data.missions, selections.get(petition.id) || emptyUnits(), petition.kind).power)} Power? ${troopPreview(data.missions, selections.get(petition.id) || emptyUnits(), petition.kind).risk} Reward now: +${petition.favor} Favor.`)) return;
    busy = true; notice = 'Submitting…'; render();
    try {
      if (button.dataset.diplomacy === 'tribute') {
        const key = `${resource}:${amounts[resource]}`;
        if (!requests.has(key)) requests.set(key, crypto.randomUUID());
        const result = await mutate('diplomacy:tribute', { requestId:requests.get(key), resource, amount:amounts[resource] });
        requests.delete(key);
        notice = `Donation sent. +${result?.favorGranted || 0} Favor; remaining progress saved.`;
      } else if (troop) {
        await mutate('diplomacy:dispatch', { petitionId:petition.id, units:selections.get(petition.id) || emptyUnits() });
        notice = 'Troops dispatched. Favor received; return recorded.';
      } else {
        await mutate('diplomacy:fulfill', { petitionId: button.dataset.petition });
        notice = 'Fulfilled. Favor received.';
      }
      data = await refresh();
    } catch (error) { notice = error.message || String(error); }
    finally { busy = false; render(); }
  });
  return { update(next, nextResources) { data = next; resources = nextResources; render(); } };
}
