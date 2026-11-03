import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (docs/prd.md §28). In CI they run against the production
// Docker image (E2E_BASE_URL is set by the workflow). Locally, with no
// E2E_BASE_URL, Playwright builds and starts the app itself.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  // §28 order: phones first (mobile-first, §27), desktop second.
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "android", use: { ...devices["Pixel 7a"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm build && pnpm start", url: baseURL, reuseExistingServer: false, timeout: 180_000 },
});
