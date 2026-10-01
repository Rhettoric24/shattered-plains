import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/lab-static",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4187" },
  projects: [390, 1440].map((width) => ({
    name: `static-${width}`,
    use: { viewport: { width, height: 1000 } },
  })),
  webServer: {
    command: "node tests/lab-static/server.mjs",
    url: "http://127.0.0.1:4187/shattered-plains/lab/",
    reuseExistingServer: false,
  },
  reporter: "list",
});
