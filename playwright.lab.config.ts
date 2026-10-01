import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/lab",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4186" },
  projects: [390, 700, 1440].map((width) => ({
    name: `lab-${width}`,
    use: { viewport: { width, height: 1000 } },
  })),
  webServer: {
    command: "npm run lab",
    url: "http://127.0.0.1:4186",
    reuseExistingServer: true,
  },
  reporter: "list",
});
