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
    // Same iPhone viewport/UA on the real iOS engine (WebKit). Three shipped bugs were iPhone-Safari-only
    // and passed the Chromium project (Known Gap 17). Bare `npx playwright test` runs BOTH projects (needs webkit installed); `npm test` = Chromium only. Run on its own: `npx playwright test --project=webkit`.
    { name: "webkit", use: { ...devices["iPhone 13"], trace: "retain-on-failure" } },
  ],
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory ../..",
    url: "http://localhost:4173/commons/",
    // never reuse: a stray server on 4173 would silently serve another checkout
    reuseExistingServer: false,
  },
});
