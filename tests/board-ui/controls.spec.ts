import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import fs from "node:fs";
const clientSource = fs.readFileSync("outputs/convex-client.js", "utf8");
const quantityHelpers = ["quantityControlMarkup", "bindQuantityControls"].map(name => { const start = clientSource.indexOf(`function ${name}(`); return clientSource.slice(start, clientSource.indexOf("\nfunction ", start + 1)); }).join("\n");
import { createBoard } from "../../conflict-board/board";
const units = { bridgeman: 10, spearman: 20, chull: 0, shardbearer: 0 };
const formation = { id: "ours", name: "Our formation", kingdom: "blue", units, position: "B3", history: ["approach", "B3"], order: { kind: "move", route: ["B2"], onDefeat: "continue" } };
const context = {
  focus: "board-one",
  lobby: { enabled: true, conflicts: [{ conflictId: "board-one", name: "Stonefield", status: "active" }] },
  conflict: { conflictId: "board-one", revision: 3, enabled: true, status: "active", participantStatus: "active", originalOwner: "red", commandPostController: "red", withdrawing: false,
    nextCycleAt: Date.now() + 7200000, deadlineAt: Date.now() + 86400000, returnedUnits: {}, returnedSpheres: 0, banked: 0, journal: [], ownArrivalTimes: [],
    view: { cycle: 1, viewer: "blue", board: createBoard(), kingdoms: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }],
      own: [{ formation, power: 25, stats: { power: 25, speed: 10, survive: 10, plunder: 20, ratings: [.4, .2, .1], specialization: "None" }, cargo: 0, capacity: 20 }],
      ownArrivals: [], contacts: [{ kingdom: "red", position: "B1", power: { mode: "label", label: "Small force" } }], visiblePositions: ["B3", "B2", "A3", "C3", "approach"], raidReady: [] } },
  targets: [{ _id: "plateau-two", name: "Rival holding", ownerName: "Red" }], ready: units,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/fixture", route => route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/shattered-plains/clarity-responsive.css"><div id="live-conflict-board"></div>' }));
  await page.route("**/board-ui.js", route => route.fulfill({ contentType: "text/javascript", body: buildSync({entryPoints:["outputs/conflict-board-ui.js"],bundle:true,format:"esm",write:false}).outputFiles[0].text }));
  await page.goto("/fixture");
  await page.evaluate(async fixture => {
    const module = await import("/board-ui.js");
    const w = window as any;
    w.calls = []; w.fixture = fixture;
    w.board = module.createConflictBoardUI({ root: document.getElementById("live-conflict-board"),
      query: async (name: string) => { if (w.failRead) throw new TypeError("Load failed"); return name === "conflictBoards:atPlateau" ? null : (w.preview || { cargo:0, remainingCapacity:100, cargoLost:0 }); },
      mutate: async (name: string, args: unknown) => { w.calls.push({ name, args }); if (w.failOrder) throw new TypeError("Load failed"); return { revision: 4 }; }, onSelect: (id:string) => {w.fixture.focus=id;w.board.update(w.fixture)}, confirm: (message:string) => {w.confirmMessage=message;return w.confirmReply!==false} });
    w.board.update(fixture);
  }, context);
});
test("select, draw, reject jumps, backtrack, cancel, confirm and preserve standing orders", async ({ page }) => {
  await page.getByRole("button", { name: /Our formation/ }).click();
  await expect(page.getByRole("region", { name: "Selected formation" })).toContainText("Power 25");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.locator('[data-position="post"]').click();
  await expect(page.locator(".cb-notice")).toHaveText("Choose a connected position.");
  await page.locator('[data-position="B2"]').click();
  await page.locator('[data-position="B1"]').click();
  await page.locator('[data-position="B2"]').click();
  await expect(page.locator(".cb-route strong")).toHaveText("Proposed: B3 → B2");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.locator('[data-position="B2"]').click();
  await page.getByRole("button", { name: "Confirm route" }).click();
  expect(await page.evaluate(() => (window as any).calls[0])).toMatchObject({ name: "conflictBoards:order", args: { conflictId: "board-one", revision: 3, formationId: "ours", route: ["B2"], onDefeat: "continue" } });
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(page.locator('[data-cb="raid"]')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("cargo warning cancels without a mutation, then confirms the exact server-calculated loss", async ({page})=>{
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.own[0].cargo=115;w.board.update(w.fixture);w.preview={cargo:115,remainingCapacity:65,cargoLost:50};w.confirmReply=false});
  await page.getByRole("button",{name:/Our formation/}).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Split formation",{exact:true}).click();
  await page.getByLabel("split Spearmen",{exact:true}).fill("5");
  await page.getByRole("button",{name:"Split troops"}).click();
  await expect(page.locator(".cb-notice")).toContainText("Split cancelled");
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).confirmMessage)).toContain("50 Spheres will be lost");
  await page.evaluate(()=>{(window as any).confirmReply=true});
  await page.getByRole("button",{name:"Split troops"}).click();
  await expect(page.locator(".cb-notice")).toContainText("accepted");
  expect(await page.evaluate(()=>(window as any).calls[0].args.acceptedCargoLoss)).toBe(50);
});
test("overview and battlefield are separate; mouse drag backtracks and requires confirmation",async({page})=>{
  await page.getByRole("button",{name:"← Back to PvP"}).click();
  await expect(page.locator(".cb-grid")).toHaveCount(0);
  await expect(page.getByText("Open or join a rival conflict",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Enter battlefield"}).click();
  await expect(page.locator(".cb-grid")).toBeVisible();
  await expect(page.getByText("Open or join a rival conflict",{exact:true})).toHaveCount(0);
  await page.locator('[data-own="ours"]').scrollIntoViewIfNeeded();
  const center=async(selector:string)=>{const b=await page.locator(selector).boundingBox();return{x:b!.x+b!.width/2,y:b!.y+b!.height/2}};
  const a=await center('[data-own="ours"]'),b=await center('[data-position="B2"]'),c=await center('[data-position="B1"]');
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:15});await page.mouse.move(c.x,c.y,{steps:15});await page.mouse.move(b.x,b.y,{steps:15});await page.mouse.up();
  await expect(page.locator(".cb-route strong")).toHaveText("Proposed: B3 → B2");
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  await page.getByRole("button",{name:"Confirm route"}).click();
  expect(await page.evaluate(()=>(window as any).calls[0].args.route)).toEqual(["B2"]);
});
test("touch hold draws the same explicit route",async({page,context})=>{
  await page.locator('[data-own="ours"]').scrollIntoViewIfNeeded();
  const center=async(selector:string)=>{const b=await page.locator(selector).boundingBox();return{x:b!.x+b!.width/2,y:b!.y+b!.height/2}};
  const a=await center('[data-own="ours"]'),b=await center('[data-position="B2"]');
  const cdp=await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...a,id:1}]});
  await page.waitForTimeout(400);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...b,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect(page.locator(".cb-route strong")).toHaveText("Proposed: B3 → B2");
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});
test("split and reinforcement controls submit only selected real units; disabled gate preserves withdrawal", async ({ page }) => {
  await page.getByRole("button", { name: /Our formation/ }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Split formation", { exact: true }).click();
  await page.getByLabel("split Spearmen", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Split troops" }).click();
  expect(await page.evaluate(() => (window as any).calls[0])).toMatchObject({ name: "conflictBoards:split", args: { formationId: "ours", units: { spearman: 5, bridgeman: 0 }, equipmentIds: [] } });
  await page.getByText("Send reinforcements", { exact: true }).click();
  await page.getByLabel("reinforce Bridgemen", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Dispatch reinforcements" }).click();
  expect(await page.evaluate(() => (window as any).calls[1])).toMatchObject({ name: "conflictBoards:reinforce", args: { units: { bridgeman: 3 }, fabrials: [] } });
  await page.evaluate(() => { const w = window as any; w.fixture.lobby.enabled = false; w.board.update(w.fixture); });
  await expect(page.getByText("Open or join a rival conflict", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Withdraw all my forces" }).click();
  expect(await page.evaluate(() => (window as any).calls[2].name)).toBe("conflictBoards:withdraw");
});

test("start a rival conflict from overview with the selected holding and army", async ({page}) => {
  await page.getByRole('button',{name:'← Back to PvP'}).click();
  await page.evaluate(()=>{ (window as any).preview=null; });
  await page.getByText('Open or join a rival conflict',{exact:true}).click();
  await page.getByRole('combobox',{name:'Target Plateau',exact:true}).selectOption('plateau-two');
  await page.getByLabel('commit Spearmen',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Commit army / join conflict'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:open',args:{plateauId:'plateau-two',units:{spearman:7,bridgeman:0},fabrials:[]}});
});

test('inspect any tile without commands; disclosure and reserve geometry stay intact', async ({page}) => {
  await page.locator('[data-position="C2"]').click();
  await expect(page.getByRole('complementary',{name:'Tile information'})).toContainText('presence is unknown');
  await expect(page.locator('[data-player-position="C2"]')).toHaveClass(/cb-inspected/);
  await expect(page.locator('[data-player-position="C2"]')).not.toHaveClass(/cb-known-contact/);
  await page.getByRole('button',{name:'Close tile information'}).click();
  await page.locator('[data-position="B1"]').click();
  await expect(page.getByRole('complementary',{name:'Tile information'})).toContainText('Small force');
  await expect(page.getByRole('complementary',{name:'Tile information'})).not.toContainText('20 Spearmen');
  await page.getByRole('button',{name:'Close tile information'}).click();
  await page.locator('[data-position="reserve"]').click();
  await expect(page.getByRole('complementary',{name:'Tile information'})).toContainText('Defender fallback entry');
  expect(await page.locator('[data-player-position]').count()).toBe(12);
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('formation sheet peeks, expands by tap and handle drag, keeps the map available', async ({page}) => {
  await page.locator('[data-own="ours"]').click();
  const sheet=page.getByRole('region',{name:'Selected formation'});
  await expect(sheet).toHaveClass(/cb-sheet-peek/);
  await expect(sheet).toContainText('30 troops');
  await expect(sheet).toContainText('Next: Move to B2');
  await page.getByRole('button',{name:'Expand formation',exact:false}).click();
  await expect(sheet).toHaveClass(/cb-sheet-expanded/);
  await expect(page.getByRole('button',{name:'Hold',exact:true})).toBeVisible();
  const handle=page.locator('.cb-sheet-handle');
  const box=await handle.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+20);await page.mouse.down();await page.mouse.move(box!.x+box!.width/2,box!.y+70,{steps:6});await page.mouse.up();
  await expect(sheet).toHaveClass(/cb-sheet-peek/);
  const visible=await page.locator('.cb-grid').evaluate(el=>{const r=el.getBoundingClientRect();const sheet=document.querySelector('.cb-sheet')!.getBoundingClientRect();return r.top<sheet.top&&r.bottom>0});
  expect(visible).toBe(true);
  await page.getByRole('button',{name:'Close formation controls'}).click();
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('traveling formation queues the same explicit order and cancels through Hold', async ({page}) => {
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.ownArrivals=[{id:'incoming',cycle:99,formation:{...w.fixture.conflict.view.own[0].formation,id:'incoming',name:'Incoming force',order:{kind:'hold',route:[],onDefeat:'continue'}}}];w.fixture.conflict.ownArrivalTimes=[{formationId:'incoming',arriveAt:Date.now()+7200000}];w.board.update(w.fixture)});
  await page.getByRole('button',{name:/Incoming force/}).click();
  await expect(page.locator('.cb-sheet')).toContainText('Arrives');
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.locator('[data-position="B3"]').click();
  await page.locator('[data-position="B2"]').click();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  await page.getByRole('button',{name:'Confirm route'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:order',args:{formationId:'incoming',kind:'move',route:['B3','B2']}});
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.ownArrivals[0].formation.order={kind:'move',route:['B3','B2'],onDefeat:'continue'};w.fixture.conflict.revision++;w.board.update(w.fixture)});
  await page.getByRole('button',{name:'Orders',exact:true}).click();
  await page.getByRole('button',{name:'Cancel queued route'}).click();
  expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({name:'conflictBoards:order',args:{formationId:'incoming',kind:'hold',route:[]}});
});

test('arrival position changes invalidate a draft; withdrawal and settlement close stale controls', async ({page}) => {
  await page.locator('[data-own="ours"]').click();
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.locator('[data-position="B2"]').click();
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.own[0].formation.position='A3';w.fixture.conflict.revision++;w.board.update(w.fixture)});
  await expect(page.getByRole('button',{name:'Confirm route'})).toHaveCount(0);
  await expect(page.locator('.cb-notice')).toContainText('position changed');
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.withdrawing=true;w.board.update(w.fixture)});
  await expect(page.locator('.cb-sheet')).toHaveCount(0);
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.status='settled';w.fixture.conflict.outcome='Deadline';w.fixture.conflict.view.own=[];w.fixture.conflict.view.ownArrivals=[];w.board.update(w.fixture)});
  await expect(page.locator('.cb-grid')).toHaveCount(0);
  await expect(page.getByText(/Finished: Deadline/)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('full game shell leaves the battlefield usable with the planning sheet on a phone', async ({page}, testInfo) => {
  if (page.viewportSize()!.width === 390) await page.setViewportSize({width:390,height:844});
  const fs = await import('node:fs');
  const fixture = await page.evaluate(()=>(window as any).fixture);
  const shell=fs.readFileSync('outputs/convex-client.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<head>','<head><base href="/shattered-plains/">');
  await page.route('**/shell-fixture',route=>route.fulfill({contentType:'text/html',body:shell}));
  await page.goto('/shell-fixture');
  await page.evaluate(async fixture=>{
    document.getElementById('account-screen')!.classList.add('hidden');document.getElementById('game-screen')!.classList.remove('hidden');
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-plateaus'));
    document.getElementById('space-subnav')!.innerHTML='<button>Parshendi</button><button>PvP</button><button>Plateau Runs</button>';
    const module=await import('/board-ui.js');const w=window as any;
    w.calls=[];w.fixture=fixture;
    w.board=module.createConflictBoardUI({root:document.getElementById('live-conflict-board'),query:async()=>null,mutate:async(name:string,args:unknown)=>{w.calls.push({name,args});return{}},onSelect:()=>{}});
    w.board.update(fixture);
  },fixture);
  await page.locator('[data-own="ours"]').click();
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.locator('[data-position="B2"]').click();
  const geometry=await page.locator('.cb-sheet').evaluate(el=>{const sheet=el.getBoundingClientRect(),map=document.querySelector('.cb-grid')!.getBoundingClientRect();return {sheet:sheet.height,viewport:innerHeight,boardVisible:map.top<sheet.top&&map.bottom>0,overflow:document.documentElement.scrollWidth>innerWidth,confirmVisible:(document.querySelector('[data-cb="confirm-route"]')!.getBoundingClientRect().bottom<=sheet.bottom)}});
  expect(geometry.sheet).toBeLessThan(geometry.viewport*.57);
  expect(geometry.boardVisible).toBe(true);expect(geometry.overflow).toBe(false);expect(geometry.confirmVisible).toBe(true);
  if (page.viewportSize()!.width === 390) {
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    for (const [width,height] of [[320,667],[375,667],[390,844],[430,932]]) {
      await page.setViewportSize({width,height});
      await expect.poll(async()=>page.locator('.cb-grid').evaluate(el=>{const r=el.getBoundingClientRect(), sheet=document.querySelector('.cb-sheet')!.getBoundingClientRect(),header=document.querySelector('.global-shell')!.getBoundingClientRect();return r.top>=header.bottom-1&&r.bottom<=sheet.top-1})).toBe(true);
      await page.getByRole('button',{name:'Move',exact:true}).click();
      await page.locator('[data-position="B2"]').click();
      await page.screenshot({path:testInfo.outputPath('fit-'+width+'-'+height+'.png')});
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    await page.getByRole('button',{name:'Move',exact:true}).click();
    await page.locator('[data-position="B2"]').click();
  }
  await page.screenshot({path:testInfo.outputPath('planning.png')});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByText('Send reinforcements',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Dispatch reinforcements'})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('touch sheet handle stays separate from army dragging and supports a subsequent tap', async ({page,context}) => {
  await page.locator('[data-own="ours"]').click();
  await page.getByRole('button',{name:'More',exact:true}).click();
  const box=await page.locator('.cb-sheet-handle').boundingBox();
  const cdp=await context.newCDPSession(page), x=box!.x+box!.width/2, y=box!.y+15;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+65,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.cb-sheet')).toHaveClass(/cb-sheet-peek/);
  await page.getByRole('button',{name:'Expand formation',exact:false}).click();
  await expect(page.locator('.cb-sheet')).toHaveClass(/cb-sheet-expanded/);
  await expect(page.locator('.cb-route')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('Orders and More preserve stop-on-loss, Hold, merge selection and Fabrial commands', async ({page}) => {
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.own[0].formation.equipment={items:[{id:'item-a',kind:'halfShard'},{id:'item-b',kind:'halfShard'}],active:'item-a',pending:{id:'item-b'}};w.board.update(w.fixture)});
  await page.locator('[data-own="ours"]').click();
  await page.getByRole('button',{name:'Orders',exact:true}).click();
  await page.getByLabel('After defeat').selectOption('pause');
  await page.getByRole('button',{name:'Save standing order'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:order',args:{formationId:'ours',kind:'move',route:['B2'],onDefeat:'pause'}});
  await page.getByRole('button',{name:'Hold',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({name:'conflictBoards:order',args:{kind:'hold',route:[]}});
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByText('Route and retreat details',{exact:true}).click();
  await page.locator('[data-cb-value="merge"]').selectOption('A3');
  await page.getByRole('button',{name:'Choose merge route'}).click();
  expect(await page.evaluate(()=>(window as any).calls[2])).toMatchObject({name:'conflictBoards:chooseMergeRoute',args:{formationId:'ours',position:'A3'}});
  await page.getByText('Carried Fabrials (2)',{exact:true}).click();
  await page.locator('[data-cb="switch"][data-item="item-b"]').click();
  expect(await page.evaluate(()=>(window as any).calls[3])).toMatchObject({name:'conflictBoards:switchFabrial',args:{itemId:'item-b'}});
  await page.getByRole('button',{name:'Cancel pending change'}).click();
  expect(await page.evaluate(()=>(window as any).calls[4])).toMatchObject({name:'conflictBoards:switchFabrial',args:{itemId:null}});
});

test('army dragging clears inspection overlays and restores only the planning peek', async ({page}) => {
  await page.locator('[data-own="ours"]').click();
  await page.locator('[data-position="C1"]').click();
  const center=async(selector:string)=>{const r=await page.locator(selector).boundingBox();return{x:r!.x+r!.width/2,y:r!.y+r!.height/2}};
  const a=await center('[data-own="ours"]'),b=await center('[data-position="B2"]');
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});
  await expect(page.locator('.cb-inspection')).toHaveCount(0);
  await expect(page.locator('.cb-sheet')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.cb-sheet')).toHaveClass(/cb-sheet-peek/);
  await expect(page.locator('.cb-route strong')).toHaveText('Proposed: B3 → B2');
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
});

test('queued gold groups Speed steps, proposed numbers clear, purple uses stored friendly history', async ({page}) => {
  await page.evaluate(()=>{const w=window as any,f=w.fixture.conflict.view.own[0];f.stats.specialization='Speed';f.formation.history=['approach','B3'];f.formation.order.route=['B2','B1','C1','C2'];w.board.update(w.fixture)});
  await page.locator('[data-own="ours"]').click();
  await expect(page.locator('[data-player-position="B2"]')).toHaveClass(/cb-queued-next/);
  await expect(page.locator('[data-player-position="B1"]')).toHaveClass(/cb-queued-next/);
  await expect(page.locator('[data-player-position="C1"] .cb-queue-mark')).toHaveText('→2');
  await expect(page.locator('[data-player-position="approach"] .cb-retreat-mark')).toHaveText('↶1');
  await expect(page.locator('[data-player-position="B3"] .cb-retreat-mark')).toHaveCount(0);
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.locator('[data-position="B2"]').click();
  await expect(page.locator('.cb-step')).toHaveText('1');
  await page.getByRole('button',{name:'Confirm route'}).click();
  await expect(page.locator('.cb-step')).toHaveCount(0);await expect(page.locator('.cb-proposed')).toHaveCount(0);
  await page.getByRole('button',{name:'Move',exact:true}).click();await page.locator('[data-position="B2"]').click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.cb-step')).toHaveCount(0);
  await page.evaluate(()=>{const w=window as any,f=w.fixture.conflict.view.own[0];f.formation.position='B2';f.formation.history=['approach','B3','B2'];w.fixture.conflict.revision++;w.board.update(w.fixture)});
  await expect(page.locator('[data-player-position="B3"] .cb-retreat-mark')).toHaveText('↶1');
  await expect(page.locator('[data-player-position="approach"] .cb-retreat-mark')).toHaveCount(0);
  await page.getByRole('button',{name:'More',exact:true}).click();await page.getByText('Route and retreat details',{exact:true}).click();await page.getByRole('button',{name:'Show extended history'}).click();
  await expect(page.locator('[data-player-position="approach"] .cb-retreat-mark')).toHaveText('↶2');
});

test('read and refresh failures stay distinct from order failures and preserve planning', async ({page}) => {
  await page.locator('[data-own="ours"]').click();await page.getByRole('button',{name:'Move',exact:true}).click();await page.locator('[data-position="B2"]').click();
  await page.evaluate(()=>(window as any).board.setRefreshError('conflictBoards:get'));
  await expect(page.locator('.cb-refresh-warning')).toContainText('not an order failure');
  await expect(page.locator('.cb-route strong')).toHaveText('Proposed: B3 → B2');expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  await page.evaluate(()=>(window as any).board.setRefreshError(null));
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'More',exact:true}).click();await page.getByText('Split formation',{exact:true}).click();
  await page.evaluate(()=>{(window as any).failRead=true});await page.getByRole('button',{name:'Split troops'}).click();
  await expect(page.locator('.cb-sheet-notice')).toContainText('Split preview could not load. No order was sent.');expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  await page.evaluate(()=>{const w=window as any;w.failRead=false;w.failOrder=true});
  await page.getByRole('button',{name:'Move',exact:true}).click();await page.locator('[data-position="B2"]').click();await page.getByRole('button',{name:'Confirm route'}).click();
  await expect(page.locator('.cb-sheet-notice')).toContainText('may have been received');
  await page.getByRole('button',{name:'Confirm route'}).click();
  const calls=await page.evaluate(()=>(window as any).calls);expect(calls[0].args.requestId).toBe(calls[1].args.requestId);
});

for (const input of ['mouse','touch'] as const) test(`incoming entry marker uses the shared ${input} drag and confirms a future order`,async({page,context})=>{
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.ownArrivals=[{id:'incoming',cycle:99,formation:{...w.fixture.conflict.view.own[0].formation,id:'incoming',name:'Incoming force',order:{kind:'hold',route:[],onDefeat:'continue'}}}];w.fixture.conflict.ownArrivalTimes=[{formationId:'incoming',arriveAt:Date.now()+7200000}];w.board.update(w.fixture)});
  const marker=page.locator('[data-player-position="approach"] [data-own="incoming"]');
  await expect(marker).toHaveAttribute('data-incoming','true');
  await marker.scrollIntoViewIfNeeded();
  const center=async(selector:string)=>{const b=await page.locator(selector).boundingBox();return{x:b!.x+b!.width/2,y:b!.y+b!.height/2}};
  const a=await center('[data-own="incoming"]'),b=await center('[data-position="B3"]'),c=await center('[data-position="B2"]');
  if(input==='mouse') {
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.move(c.x,c.y,{steps:10});await page.mouse.up();
  } else {
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});await page.waitForTimeout(360);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...b,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...c,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await expect(page.locator('.cb-route strong')).toHaveText('Proposed: approach → B3 → B2');
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  await expect(page.locator('.cb-sheet')).toContainText('Arrives');
  await page.getByRole('button',{name:'Confirm route'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:order',args:{formationId:'incoming',kind:'move',route:['B3','B2'],onDefeat:'continue'}});
  await expect(page.locator('.cb-proposed')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).fixture.conflict.view.ownArrivals[0].formation.id)).toBe('incoming');
});

test('mobile board height survives toolbar height changes, scrolling, sheet changes and route planning', async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.locator('#live-conflict-board').evaluate(el=>el.style.getPropertyValue('--cb-board-height'))).not.toBe('');
  const height=()=>page.locator('.cb-grid').evaluate(el=>el.getBoundingClientRect().height);
  const initial=await height();
  // Emulate Safari resize/visualViewport notifications and changed scroll positions.
  await page.evaluate(()=>{window.scrollTo(0,100);window.visualViewport?.dispatchEvent(new Event('scroll'));window.visualViewport?.dispatchEvent(new Event('resize'))});
  await page.setViewportSize({width:390,height:744});
  await expect.poll(height).toBe(initial);
  await page.locator('[data-own="ours"]').click();await page.getByRole('button',{name:'More',exact:true}).click();
  expect(await height()).toBe(initial);
  await page.getByRole('button',{name:'Move',exact:true}).click();await page.locator('[data-position="B2"]').click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.visualViewport?.dispatchEvent(new Event('scroll'))});
  expect(await height()).toBe(initial);
  await expect(page.locator('.cb-route strong')).toHaveText('Proposed: B3 → B2');
  // A real width change is deferred while the player is planning.
  await page.setViewportSize({width:430,height:932});expect(await height()).toBe(initial);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect.poll(height).not.toBe(initial);
  const wider=await height();
  await page.evaluate(()=>{window.visualViewport?.dispatchEvent(new Event('resize'));window.scrollTo(0,0)});
  expect(await height()).toBe(wider);
  await page.setViewportSize({width:430,height:700});
  expect(await height()).toBe(wider);
  await page.evaluate(()=>{Object.defineProperty(screen.orientation,'angle',{configurable:true,value:90});screen.orientation.dispatchEvent(new Event('change'))});
  await expect.poll(height).not.toBe(wider);
});

 test("launcher preserves Intel gates, live army controls and bottom history", async ({ page }) => {
  await page.getByRole('button', {name:'← Back to PvP'}).click();
  await page.evaluate(async helpers => {
    const w=window as any;
    w.board.reset();
    const module=await import('/board-ui.js');
    const quantity=new Function('let quantityIncrement=1;'+helpers+';return {quantityControlMarkup,bindQuantityControls}')();
    document.body.innerHTML='<link rel="stylesheet" href="/shattered-plains/shattered-plains-styles.css"><link rel="stylesheet" href="/shattered-plains/clarity-components.css"><link rel="stylesheet" href="/shattered-plains/clarity-responsive.css"><div id="live-conflict-board" class="panel"></div><div id="other-content">Other PvP controls</div><div id="history" class="panel"></div>';
    w.fixture.focus=null;
    w.fixture.targets=[{_id:'low',ownerPlayerId:'red',ownerName:'A very long rival kingdom name that should be shortened',name:'The Very Long Plateau Name Beyond The Limit',intelligenceLevel:0},{_id:'known',ownerPlayerId:'red',ownerName:'A very long rival kingdom name that should be shortened',name:'Known Gemheart',intelligenceLevel:1,type:'gemheart',highground:true,large:true}];
    w.fixture.lobby.conflicts.push({conflictId:'old',name:'Old conflict',status:'settled'});
    w.board=module.createConflictBoardUI({root:document.getElementById('live-conflict-board'),historyRoot:document.getElementById('history'),...quantity,query:async()=>null,mutate:async()=>({}),onSelect:(id:string)=>{w.fixture.focus=id;w.board.update(w.fixture)}});
    w.board.update(w.fixture);
  }, quantityHelpers);
  const select=page.getByRole('combobox',{name:'Target Plateau'});
  await select.selectOption('low');
  await expect(page.locator('[data-cb-plateau-info]')).toContainText('The Very Long Plateau Name Beyond The Limit');
  await expect(page.locator('[data-cb-plateau-info]')).toContainText('requires 25 Territory Intel');
  expect(await select.locator('optgroup').evaluateAll(els=>els.every(el=>Array.from((el as HTMLOptGroupElement).label).length<=28))).toBe(true);
  expect(await select.locator('option').evaluateAll(els=>els.every(el=>Array.from(el.textContent!.trim()).length<=28))).toBe(true);
  await page.getByLabel('commit Spearmen',{exact:true}).fill('7');
  const outlook=page.locator('[data-cb-army-outlook]');
  await expect(outlook).toContainText('7 Spearmen');
  const before=await outlook.textContent();
  await page.getByLabel('commit Spearmen',{exact:true}).locator('..').getByRole('button',{name:'Max',exact:true}).click();
  await expect(outlook).toContainText('20 Spearmen');
  expect(await outlook.textContent()).not.toBe(before);
  await select.selectOption('known');
  await expect(page.locator('[data-cb-plateau-info]')).toContainText('Highground · Large');
  await expect(page.locator('[data-cb-plateau-info]')).toContainText('Requires 75 Territory Intel');
  await expect(page.getByLabel('commit Spearmen',{exact:true})).toHaveValue('20');
  await expect(page.locator('.cb-active-conflicts')).toContainText('Stonefield');
  await expect(page.locator('.cb-active-conflicts')).not.toContainText('Old conflict');
  await expect(page.locator('#history')).toContainText('Old conflict');
  expect(await page.locator('#history').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('other-content')!) & Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/pvp-launcher-'+page.viewportSize()!.width+'.png',fullPage:true});
  await page.getByRole('button',{name:'View result',exact:true}).click();
  await expect(page.locator('#history')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).board.selected)).toBe('old');
 });

test("Parshendi purchase uses the legal entry and allied controls never offer merging or splitting", async ({page}) => {
  await page.evaluate(() => {
    const w=window as any;
    w.fixture.conflict.diplomacy={favor:5,activeFormationId:null,tiers:[{cost:1,power:150,name:'Parshendi Scouts'},{cost:5,power:1000,name:'Chasmfiend'}]};
    w.board.update(w.fixture);
  });
  await page.getByText('Call Parshendi assistance', {exact:false}).click();
  await page.getByRole('button',{name:'Chasmfiend · 1000 Power · 5 Favor'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:callParshendi',args:{tier:5,position:'approach',revision:3}});
  await page.evaluate(()=>{
    const w=window as any, r=w.fixture.conflict.view.own[0];
    r.formation.name='Chasmfiend';r.formation.units={bridgeman:0,spearman:0,chull:0,heavy:0,scout:0,shardbearer:0};
    r.formation.allied={tier:5,power:1000}; r.stats={power:1000,movement:1,specialization:'None'};
    w.board.update(w.fixture);
  });
  await page.getByRole('button',{name:/^Chasmfiend/}).last().click();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await expect(page.locator('[data-cb="split"]')).toHaveCount(0);
  await expect(page.locator('[data-cb="merge-route"]')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Selected formation'})).toContainText('Moves 1 square');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
