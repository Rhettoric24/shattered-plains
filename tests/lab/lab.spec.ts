import { test, expect } from "@playwright/test";
test("local planning, splitting, resolving and replaying", async ({
  page,
}, testInfo) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4186/")) external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Conflict Board Resolution Lab" }),
  ).toBeVisible();
  await page.locator("#unit-spearman").fill("20");
  await page.locator("#unit-bridgeman").fill("20");
  await page.getByRole("button", { name: "Split these counts off" }).click();
  await expect(page.locator("#formation option")).toHaveCount(3);
  await page.getByRole("button", { name: "Move · draw route" }).click();
  for (const node of ["B3", "B2", "B1", "post"])
    await page.locator(`[data-route-node="${node}"]`).click();
  await page.getByRole("button", { name: "Confirm route" }).click();
  await expect(page.locator("#route")).toHaveValue("B3, B2, B1, post");
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await expect(page.locator("#status")).toContainText("Cycle 1");
  await expect(page.locator("#log")).toContainText("merge");
  await page.getByRole("button", { name: "Save in this browser" }).click();
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await page.getByRole("button", { name: "Load saved" }).click();
  await expect(page.locator("#status")).toContainText("Cycle 1");
  await page.locator("#preset").selectOption("Three kingdoms");
  await page.getByRole("button", { name: "Load preset" }).click();
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await expect(page.locator("#log")).toContainText("blue wins");
  await page.screenshot({
    path: testInfo.outputPath("lab.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("Research, arrivals, configuration and isolated server", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.locator("#formation").selectOption("Garrison");
  await page.locator("#research-painrialMedicine").selectOption("3");
  await page
    .getByRole("button", { name: "Apply Research", exact: true })
    .click();
  await expect(page.locator("#stats")).toContainText("Survive");
  await page
    .getByRole("button", { name: "Queue these troops next cycle" })
    .click();
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await expect(page.locator("#log")).toContainText(
    "joins the unique or nominated garrison",
  );
  await page.locator("#config-minimum").fill("10");
  await page.getByRole("button", { name: "Apply constants" }).click();
  await expect(page.locator("#stats h2")).toHaveText("None");
  expect((await request.get("/.env.local")).status()).toBe(404);
  expect((await request.get("/convex/rules.ts")).status()).toBe(404);
  await expect(page.locator("#error")).toBeEmpty();
});
