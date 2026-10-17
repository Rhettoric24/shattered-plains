import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
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
      query: async (name: string) => name === "conflictBoards:atPlateau" ? null : (w.preview || { cargo:0, remainingCapacity:100, cargoLost:0 }),
      mutate: async (name: string, args: unknown) => { w.calls.push({ name, args }); return { revision: 4 }; }, onSelect: (id:string) => {w.fixture.focus=id;w.board.update(w.fixture)}, confirm: (message:string) => {w.confirmMessage=message;return w.confirmReply!==false} });
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
  await expect(page.locator('[data-cb="raid"]')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("cargo warning cancels without a mutation, then confirms the exact server-calculated loss", async ({page})=>{
  await page.evaluate(()=>{const w=window as any;w.fixture.conflict.view.own[0].cargo=115;w.board.update(w.fixture);w.preview={cargo:115,remainingCapacity:65,cargoLost:50};w.confirmReply=false});
  await page.getByRole("button",{name:/Our formation/}).click();
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
  await page.getByRole('combobox',{name:'Rival holding',exact:true}).selectOption('plateau-two');
  await page.getByLabel('commit Spearmen',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Commit army / join conflict'}).click();
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({name:'conflictBoards:open',args:{plateauId:'plateau-two',units:{spearman:7,bridgeman:0},fabrials:[]}});
});
