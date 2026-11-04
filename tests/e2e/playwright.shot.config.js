// Screenshot harness config — separate from the stubbed suite so `npx playwright test`
// never runs it. Usage: see shots/shot.spec.js (or /shot).
const base = require("./playwright.config.js");

module.exports = Object.assign({}, base, {
  testDir: "shots",
  testMatch: /shot\.spec\.js$/,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
});
