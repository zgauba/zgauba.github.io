// Real-backend smoke test config — separate from the stubbed suite so `npx
// playwright test` can never touch the live project by accident.
const base = require("./playwright.config.js");

module.exports = Object.assign({}, base, {
  testDir: "smoke",
  testMatch: /.*\.smoke\.js$/,
  fullyParallel: false,
  workers: 1,
});
