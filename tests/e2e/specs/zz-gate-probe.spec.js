// Throwaway (gate-probe, ci-shard row 4): one planted failure, must turn e2e and e2e-webkit red.
const { test, expect } = require("@playwright/test");

test("gate-probe: planted failure", () => {
  expect(1, "planted by gate-probe").toBe(2);
});
