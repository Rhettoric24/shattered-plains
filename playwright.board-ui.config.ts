import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/board-ui",
  reporter: "list",
  projects: [390, 1440].map(width => ({ name: `board-${width}`, use: { viewport: { width, height: 900 } } })),
  use: { baseURL: "http://127.0.0.1:4187" },
  webServer: { command: "node tests/lab-static/server.mjs", url: "http://127.0.0.1:4187/shattered-plains/", reuseExistingServer: false },
});
