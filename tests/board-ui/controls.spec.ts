import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createBoard } from "../../conflict-board/board";
const units = { bridgeman: 10, spearman: 20, chull: 0, shardbearer: 0 };
const formation = { id: "ours", name: "Our formation", kingdom: "blue", units, position: "B3", history: ["approach", "B3"], order: { kind: "move", route: ["B2"], onDefeat: "continue" } };
const context = {
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
  await page.route("**/board-ui.js", route => route.fulfill({ contentType: "text/javascript", body: readFileSync("outputs/conflict-board-ui.js", "utf8") }));
  await page.goto("/fixture");
  await page.evaluate(async fixture => {
    const module = await import("/board-ui.js");
    const w = window as any;
    w.calls = []; w.fixture = fixture;
    w.board = module.createConflictBoardUI({ root: document.getElementById("live-conflict-board"),
      query: async () => ({ conflictId: "board-one", revision: 3 }),
      mutate: async (name: string, args: unknown) => { w.calls.push({ name, args }); return { revision: 4 }; }, onSelect: () => {}, confirm: () => true });
    w.board.update(fixture);
  }, context);
});
test("select, draw, reject jumps, backtrack, cancel, confirm and preserve standing orders", async ({ page }) => {
  await page.getByRole("button", { name: /Our formation/ }).click();
  await expect(page.getByRole("region", { name: "Selected formation" })).toContainText("Power 25");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.locator('[data-position="post"]').click();
  await expect(page.getByRole("status")).toHaveText("Choose a connected position.");
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
