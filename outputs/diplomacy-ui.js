import { DIPLOMACY, donationReduction, tributeProgress } from "../convex/diplomacyRules";
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
export function diplomacyMarkup(d, { spheres = 0, gemhearts = 0, observer = false, now = Date.now(), busy = false, resource = "spheres", amount = 1000 } = {}) {
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
    <h3>Parshendi Petitions</h3><p>Shared by all kingdoms. First eligible fulfillment wins. Only world objectives appear here; all Sphere and Gemheart payments belong to standing tribute.</p>
    <div class="building-grid">${d.petitions.filter(p => p.kind !== 'supplies').map(p => {
      const missing = p.expiresAt <= now ? 'Expired; awaiting the hourly board refresh.' : p.missing;
      return `<article class="upgrade-card"><h4>${esc(p.title)}</h4><p>${esc(p.objective)}</p><p><strong>+${p.favor} Favor · −${p.hostilityReduction} Hostility</strong></p><p>Expires ${esc(new Date(p.expiresAt).toLocaleString())}</p><p role="status">${esc(missing || 'Requirements met · available to fulfill now')}</p><button type="button" data-diplomacy="fulfill" data-petition="${esc(p.id)}" ${busy || observer || missing || cap ? 'disabled' : ''}>${p.kind === 'plateau' ? 'Donate Plateau' : 'Claim Reward'}</button></article>`;
    }).join('') || '<p>No active petitions. The board checks hourly for rival holdings, captured plateaus and hostile kingdoms; it may show fewer than three when there are no suitable world events.</p>'}</div>
    <h3>Parshendi assistance</h3><p>Call assistance from an active PvP battlefield. One allied formation per kingdom across all conflicts. Allies remain separate from your armies, move one square per resolution, and disperse after one defeat or when the conflict ends.</p>
    <ul>${d.tiers.map(tier => `<li>${tier.cost} Favor: ${esc(tier.name)} · ${num(tier.power)} Power</li>`).join('')}</ul>
    <p class="hint">Allies can capture the Command Post, but cannot raid, carry loot, split, merge, or use equipment. Storms restrict vision but cause no allied casualties.</p>
    <p>Shared Gemheart reserve: ${num(d.reserveGemhearts)}. Donated Gemhearts are held for a future exchange.</p>`;
}
export function createDiplomacyUI({ root, mutate, refresh, confirm = message => window.confirm(message) }) {
  let data, resources, busy = false, notice = '', resource = 'spheres';
  const amounts = { spheres:1000, gemhearts:1 }, requests = new Map();
  const render = () => { root.innerHTML = `<p role="status">${esc(notice)}</p>` + diplomacyMarkup(data, { ...resources, busy, resource, amount:amounts[resource] }); };
  function updatePreview() {
    const available = Math.min(resource === 'spheres' ? DIPLOMACY.maximumSphereDonation : DIPLOMACY.maximumGemheartDonation, Math.floor(resources?.[resource] || 0));
    const preview = donationPreview(data, resource, amounts[resource], available), button = root.querySelector('[data-diplomacy="tribute"]');
    root.querySelector('[data-donation-preview]').textContent = preview.missing || `Hostility −${preview.reduction} (${data.hostility} → ${data.hostility - preview.reduction}) · +${preview.favorGranted} Favor`;
    button.disabled = busy || resources?.observer || Boolean(preview.missing);
    button.textContent = `Donate ${num(amounts[resource])} ${resourceLabel(resource, amounts[resource])}`;
  }
  root.addEventListener('input', event => {
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
    busy = true; notice = 'Submitting…'; render();
    try {
      if (button.dataset.diplomacy === 'tribute') {
        const key = `${resource}:${amounts[resource]}`;
        if (!requests.has(key)) requests.set(key, crypto.randomUUID());
        const result = await mutate('diplomacy:tribute', { requestId:requests.get(key), resource, amount:amounts[resource] });
        requests.delete(key);
        notice = `Donation sent. +${result?.favorGranted || 0} Favor; remaining progress saved.`;
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
