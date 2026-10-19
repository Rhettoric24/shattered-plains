const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function diplomacyMarkup(d, { spheres = 0, gemhearts = 0, observer = false, now = Date.now(), busy = false } = {}) {
  if (!d) return '<p role="status">Loading Parshendi relations…</p>';
  const cap = d.favor >= d.cap;
  const blocked = busy || observer || cap || spheres < d.tribute.spheres || gemhearts < d.tribute.gemhearts;
  return `<div class="mission-summary"><strong>Hostility ${d.hostility}/100 · Favor ${d.favor}/${d.cap}</strong><span>Hostility governs Parshendi danger, retaliation, and high-Hostility Deep Plains access and rewards. Favor purchases allied assistance in PvP; gaining Favor does not require low Hostility.</span></div>
    ${cap ? '<p class="rule-callout">Favor is full. Spend Favor on a Conflict Board before fulfilling a petition or paying tribute. Nothing will be consumed at the cap.</p>' : ''}
    <h3>Standing tribute</h3><p>${d.tribute.spheres.toLocaleString()} Spheres <strong>and</strong> ${d.tribute.gemhearts} Gemheart → +1 Favor and −${d.tribute.hostilityReduction} Hostility (minimum 0).</p>
    <p class="hint">One complete contract, paid together. Repeated tribute reduces less Hostility within 24 hours; the resource price stays fixed. Petitions earn Favor more efficiently.</p>
    <button type="button" data-diplomacy="tribute" ${blocked ? 'disabled' : ''}>Pay standing tribute · +1 Favor</button>
    ${!cap && (spheres < d.tribute.spheres || gemhearts < d.tribute.gemhearts) ? '<p>Requires both the full Sphere cost and Gemheart cost.</p>' : ''}
    <h3>Parshendi Petitions</h3><p>Shared by all kingdoms. No acceptance needed: the first eligible kingdom to fulfill a petition receives its reward. Fulfilled petitions leave the board; empty slots refill hourly.</p>
    <div class="building-grid">${d.petitions.map(p => {
      const expired = p.expiresAt <= now;
      const missing = expired ? 'Expired; awaiting the hourly board refresh.' : p.missing;
      return `<article class="upgrade-card"><h4>${esc(p.title)}</h4><p>${esc(p.objective)}</p><p><strong>+${p.favor} Favor · −${p.hostilityReduction} Hostility</strong></p><p>Expires ${esc(new Date(p.expiresAt).toLocaleString())}</p><p role="status">${esc(missing || 'Requirements met · available to fulfill now')}</p><button type="button" data-diplomacy="fulfill" data-petition="${esc(p.id)}" ${busy || observer || missing || cap ? 'disabled' : ''}>${p.kind === 'plateau' ? 'Donate Plateau' : p.kind === 'aggressor' ? 'Claim Reward' : 'Deliver Spheres'}</button></article>`;
    }).join('') || '<p>Awaiting the hourly petition evaluation.</p>'}</div>
    <h3>Parshendi assistance</h3><p>Call assistance from an active PvP battlefield. One allied formation per kingdom across all conflicts. Allies remain separate from your armies, move one square per resolution, and disperse after one defeat or when the conflict ends.</p>
    <ul>${d.tiers.map(t => `<li>${t.cost} Favor: ${esc(t.name)} · ${t.power.toLocaleString()} Power</li>`).join('')}</ul>
    <p class="hint">Allies can capture the Command Post, but cannot raid, carry loot, split, merge, or use equipment. Storms restrict vision but cause no allied casualties.</p>
    <p>Shared Gemheart reserve: ${d.reserveGemhearts.toLocaleString()}. Donated Gemhearts are held for a future exchange.</p>`;
}
export function createDiplomacyUI({ root, mutate, refresh, confirm = message => window.confirm(message) }) {
  let data, resources, busy = false, notice = '', tributeRequestId = null;
  const render = () => { root.innerHTML = `<p role="status">${esc(notice)}</p>` + diplomacyMarkup(data, { ...resources, busy }); };
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-diplomacy]');
    if (!button || button.disabled || busy || !data) return;
    const petition = data.petitions.find(p => p.id === button.dataset.petition);
    if (petition?.kind === 'plateau' && !confirm(`Relinquish this plateau to the Parshendi immediately? ${petition.objective} Reward: +${petition.favor} Favor and −${petition.hostilityReduction} Hostility.`)) return;
    busy = true; notice = 'Submitting…'; render();
    try {
      if (button.dataset.diplomacy === 'tribute') {
        tributeRequestId ||= crypto.randomUUID();
        await mutate('diplomacy:tribute', { requestId: tributeRequestId });
        tributeRequestId = null;
      } else await mutate('diplomacy:fulfill', { petitionId: button.dataset.petition });
      notice = 'Fulfilled. Favor received.';
      data = await refresh();
    } catch (error) { notice = error.message || String(error); }
    finally { busy = false; render(); }
  });
  return { update(next, nextResources) { data = next; resources = nextResources; render(); } };
}
