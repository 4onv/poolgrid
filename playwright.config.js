import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  timeout: 60000,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { headless: true, viewport: { width: 1440, height: 1050 } },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
