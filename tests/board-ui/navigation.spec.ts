import fs from "node:fs";
import { test, expect } from "@playwright/test";
const source = fs.readFileSync("outputs/convex-client.js", "utf8");
const html = fs.readFileSync("outputs/convex-client.html", "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace('<head>', '<head><base href="/shattered-plains/">');
function fn(name: string) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end);
}
const constants = source.slice(source.indexOf("const SPACE_TABS"), source.indexOf("let currentRoute"));
const setup = `
const $ = id => document.getElementById(id);
let state = null, rawStateData = null;
const intelligenceUnlocks = () => ({ network:true, watchtower:true });
const escapeHtml = s => s;
const conflictBoardUI = { update() {}, selected:null };
const renderPlateauBonusSummary = () => {};
const renderGroupedHoldings = () => {};
const renderRaidPreviews = () => {};
const siegeCard = siege => '<article data-entity-id="'+siege.id+'">'+siege.id+'</article>';
${fn('renderPlateaus').split('  document.querySelectorAll("[data-commit-siege-defenders]")')[0]} }
window.renderFixture = (data, enabled) => { state=data; rawStateData={conflictLobby:{enabled}}; renderPlateaus(); };
const refreshRouteDetails = async () => {};
const ensureReactiveSubscriptions = () => {};
const shouldResetRouteScroll = () => true;
${constants}
let currentRoute = routeFromLocation();
${['normalizeRoute','routeSection','renderSpaceSubnav','applyRouteFocus','bindRouteControls','showRoute'].map(fn).join('\n')}
document.getElementById('account-screen').classList.add('hidden');
document.querySelectorAll('[id="dashboard"], [id="game-screen"]').forEach(el=>el.classList.remove('hidden'));
window.openRoute = showRoute;
window.addEventListener('popstate', event => showRoute(event.state || routeFromLocation(), {history:'none'}));
showRoute(currentRoute, {history:'replace'});
`;
test.beforeEach(async ({page}) => {
  await page.route('**/navigation-fixture*', route => route.fulfill({contentType:'text/html',body:html}));
  await page.goto('/navigation-fixture?view=plains&tab=raids');
  await page.addScriptTag({content:setup});
  // Authentication is outside this frontend-only fixture.
  await page.evaluate(() => { document.querySelectorAll('.hidden').forEach(el => { if(el.contains(document.getElementById('space-subnav'))) el.classList.remove('hidden'); }); });
});
test('three tabs, activity placement, mobile fit, refresh and legacy links', async ({page}) => {
  const nav=page.locator('#space-subnav');
  await expect(nav.locator('button')).toHaveText(['Parshendi','PvP','Plateau Runs']);
  await expect(page.locator('#neutral-siege-form')).toBeVisible();
  await expect(page.locator('#sphere-form')).toBeVisible();
  await expect(page.locator('#view-raids #deep-plains-panel')).toHaveCount(1);
  await expect(page.locator('[data-expedition-mode]')).toHaveCount(0);
  const fits=await nav.evaluate(el=>Array.from(el.children).every(child=>{const r=child.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));
  expect(fits).toBe(true);
  await nav.getByRole('button',{name:'PvP',exact:true}).click();
  await expect(page.locator('#player-siege-form')).toBeVisible();
  await expect(page.locator('#auto-defense-form')).toBeVisible();
  await expect(page.locator('#neutral-siege-form')).toBeHidden();
  await expect(page).toHaveURL(/tab=sieges/);
  await page.reload();await page.addScriptTag({content:setup});
  await expect(page.locator('#view-plateaus')).toHaveClass(/active/);
  await page.evaluate(()=>(window as any).openRoute('plateaus'));
  await expect(nav.getByRole('button',{name:'PvP',exact:true})).toHaveClass(/active/);
  await nav.getByRole('button',{name:'Plateau Runs',exact:true}).click();
  await expect(page.locator('#plateau-form')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#view-plateaus')).toHaveClass(/active/);
});

test('active expeditions stay with their faction and old neutral focus links follow them', async ({page}) => {
  await page.evaluate(() => (window as any).renderFixture({me:{id:'me'},plateaus:{sieges:[
    {id:'neutral-one',targetType:'neutral',attackerId:'me'},
    {id:'rival-one',targetType:'player',defenderId:'me'},
    {id:'rival-two',targetType:'player',attackerId:'other'}
  ]}}, false));
  await expect(page.locator('#active-neutral-expeditions')).toHaveText('neutral-one');
  await expect(page.locator('#urgent-sieges')).toHaveText('rival-one');
  await expect(page.locator('#active-sieges')).toHaveText('rival-two');
  await page.evaluate(()=>(window as any).openRoute({view:'plains',tab:'sieges',focus:'neutral-one'}));
  await expect(page).toHaveURL(/tab=raids/);
  await page.evaluate(() => (window as any).renderFixture({me:{id:'me'},plateaus:{sieges:[]}}, true));
  await page.evaluate(()=>(window as any).openRoute({view:'plains',tab:'sieges'}));
  await expect(page.locator('#player-siege-form')).toBeHidden();
  await expect(page.getByRole('heading',{name:'Challenge a rival holding',exact:true})).toBeHidden();
});
