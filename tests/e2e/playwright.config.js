// Serves the repo root as-is (Pages has no build either) and runs against stubs —
// no test ever reaches the real Supabase project (see specs/stub.js).
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "specs",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173/commons/",
    serviceWorkers: "block",
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory ../..",
    url: "http://localhost:4173/commons/",
    reuseExistingServer: true,
  },
});
