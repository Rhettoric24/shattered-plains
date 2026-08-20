import { expect, test as setup } from "@playwright/test";
import path from "node:path";

const authState = path.join(__dirname, "..", "..", "test-results", ".auth", "developed-kingdom.json");

setup("authenticate developed read-only kingdom", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set in the Git-ignored .env.e2e.local file.");
  }

  await page.goto("/");
  await page.getByRole("tab", { name: "Return to Warcamp" }).click();
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.locator("#sign-in-form").getByRole("button", { name: "Return to Warcamp" }).click();

  await expect(page.locator("#game-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#account-screen")).toBeHidden();
  await page.context().storageState({ path: authState });
});
