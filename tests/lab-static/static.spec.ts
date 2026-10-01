import { test, expect } from "@playwright/test";

test("Pages subpath loads, refreshes and plays without backend traffic", async ({
  page,
  request,
}) => {
  const requests: string[] = [],
    failures: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/shattered-plains/lab");
  await expect(page).toHaveURL(/\/shattered-plains\/lab\/$/);
  await expect(
    page.getByRole("heading", { name: "Conflict Board Resolution Lab" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await expect(page.locator("#status")).toContainText("Cycle 1");
  await page.getByRole("button", { name: "Save in this browser" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Load saved" }).click();
  await expect(page.locator("#status")).toContainText("Cycle 1");
  await page.getByRole("button", { name: "Resolve Next Cycle" }).click();
  await expect(page.locator("#status")).toContainText("Cycle 2");
  expect(
    requests.every((url) =>
      url.startsWith("http://127.0.0.1:4187/shattered-plains/lab"),
    ),
  ).toBe(true);
  expect(requests.some((url) => url.endsWith("/lab/lab.js"))).toBe(true);
  expect(requests.some((url) => url.endsWith("/lab/lab.css"))).toBe(true);
  expect(failures).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const html = await (await request.get("/shattered-plains/lab/")).text();
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain('content="noindex, nofollow"');
  const game = await request.get("/shattered-plains/");
  expect(game.ok()).toBe(true);
  expect(await game.text()).toContain("SHATTERED_PLAINS_CONFIG");
  expect(await game.text()).not.toContain("Conflict Board Resolution Lab");
});
