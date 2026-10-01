import { test, expect } from "@playwright/test";

test("army popup, tap route drafting, cancel, confirm and selected edits", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('[data-formation="Vanguard"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#name")).toHaveValue("Vanguard");
  await expect(page.locator("#armyRoutes")).toContainText(
    "approach → B3 → B2 → B1 → post",
  );
  await expect(page.locator('[data-position="approach"]')).toHaveClass(
    /current/,
  );
  await expect(page.locator('[data-position="B3"]')).toHaveClass(/route/);
  await expect(page.locator('[data-position="approach"]')).toHaveClass(
    /fallback/,
  );
  await page.locator("#name").fill("My vanguard");
  await page.locator("#edit").click();
  await expect(page.locator('[data-formation="Garrison"]')).toContainText(
    "Garrison",
  );
  await page.locator("#moveArmy").click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.locator('[data-route-node="A3"]').click();
  await page.locator('[data-route-node="A2"]').click();
  await page.locator('[data-route-node="C1"]').click();
  await expect(page.locator("#routeError")).toContainText("No connection");
  await expect(page.locator("#proposedPath")).toHaveText("approach → A3 → A2");
  await page.locator('[data-route-node="A3"]').click();
  await expect(page.locator("#proposedPath")).toHaveText("approach → A3");
  await page.locator("#cancelRoute").click();
  await expect(page.locator("#route")).toHaveValue("B3, B2, B1, post");
  await page.locator('[data-formation="Vanguard"]').click();
  await page.locator("#moveArmy").click();
  for (const node of ["A3", "A2", "A1"])
    await page.locator(`[data-route-node="${node}"]`).click();
  await page.locator("#confirmRoute").click();
  await page.locator("#resolve").click();
  await expect(
    page.locator('[data-position="A3"] [data-formation="Vanguard"]'),
  ).toBeVisible();
  await page.locator('[data-formation="Vanguard"]').click();
  await expect(page.locator("#armyRoutes")).toContainText(
    "Retreat history: approach → A3",
  );
  await page.screenshot({ path: testInfo.outputPath("army-panel.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Raid action repeats through failed attacks and scientist controls remain available", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4186/")) external.push(r.url());
  });
  await page.goto("/");
  await page.locator("#preset").selectOption("Raid under attack");
  await page.locator("#reset").click();
  await page.locator('[data-formation="Established raiders"]').click();
  await expect(page.locator("#raidArmy")).toBeEnabled();
  await page.locator("#raidArmy").click();
  await page.locator("#closeArmy").click();
  await page.locator("#resolve").click();
  await expect(page.locator("#log")).toContainText("Lab Raid value: 100");
  await expect(page.locator('[data-position="A1"] .raid-status')).toContainText(
    "RAID-READY",
  );
  await page.locator("#resolve").click();
  await expect(page.locator('[data-position="A1"] .raid-status')).toContainText(
    "Lab Raid total: 200",
  );
  await page.screenshot({
    path: testInfo.outputPath("raid-board.png"),
    fullPage: true,
  });
  expect(external).toEqual([]);
});

test("actual touch taps construct a route", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:4186/");
    await page.locator('[data-formation="Vanguard"]').tap();
    await page.locator("#moveArmy").tap();
    await page.locator('[data-route-node="B3"]').tap();
    await page.locator('[data-route-node="B2"]').tap();
    await expect(page.locator("#proposedPath")).toHaveText(
      "approach → B3 → B2",
    );
    await page.locator("#confirmRoute").tap();
    await expect(page.locator("#route")).toHaveValue("B3, B2");
  } finally {
    await context.close();
  }
});
