import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function loadE2EEnvironment() {
  const environmentPath = path.join(__dirname, ".env.e2e.local");
  if (!fs.existsSync(environmentPath)) return;

  for (const line of fs.readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

loadE2EEnvironment();

const authState = path.join(__dirname, "test-results", ".auth", "developed-kingdom.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4180",
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "mobile-390",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authState,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "stress-700",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authState,
        viewport: { width: 700, height: 900 },
      },
    },
    {
      name: "desktop-1440",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authState,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
