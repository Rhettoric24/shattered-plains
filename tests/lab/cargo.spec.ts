import { test, expect } from "@playwright/test";
test("raid cargo survives browser save and escape banks it", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4186/")) external.push(r.url());
  });
  await page.goto("/");
  await page.locator("#preset").selectOption("Chull raid");
  await page.locator("#reset").click();
  await page.locator("#resolve").click();
  await page.locator('[data-formation="Chull company"]').click();
  await page.locator("#raidArmy").click();
  await page.locator("#closeArmy").click();
  await page.locator("#resolve").click();
  await expect(page.locator("#cargoSummary")).toContainText("carried 100");
  await expect(page.locator("#cargoSummary")).toContainText("49900");
  await page.locator("#save").click();
  await page.reload();
  await page.locator("#load").click();
  await page.locator('[data-formation="Chull company"]').click();
  await expect(page.locator("#cargoInfo")).toContainText("Cargo: 100 / 915");
  await expect(page.locator("#cargoInfo")).toContainText(
    "originally belonging to red",
  );
  await page.locator("#split").click();
  await expect(page.locator("#armyError")).toContainText("carrying Raid cargo");
  await page.locator("#moveArmy").click();
  for (const node of ["A2", "A3", "approach"])
    await page.locator(`[data-route-node="${node}"]`).click();
  await page.locator("#confirmRoute").click();
  for (let i = 0; i < 3; i++) await page.locator("#resolve").click();
  await expect(page.locator("#cargoSummary")).toContainText(
    "Blue · carried 0 · banked 100",
  );
  await expect(page.locator("#log")).toContainText("cargo banked: 100");
  expect(external).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
