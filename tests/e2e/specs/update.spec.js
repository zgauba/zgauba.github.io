// Auto-update (assets/update.js): a "deploy" mid-visit is simulated by changing the
// ETag a page script reports. Idle page → reloads itself; mid-form → banner, no reload.
const { test, expect } = require("@playwright/test");
const { stubBackend } = require("./stub");

async function fakeDeploy(page, file) {
  let deployed = false;
  await page.route("**/" + file, (route) => {
    if (route.request().method() !== "HEAD") return route.continue();
    return route.fulfill({ status: 200, headers: { etag: deployed ? '"v2"' : '"v1"' }, body: "" });
  });
  return () => { deployed = true; };
}

test("idle page reloads itself after a deploy", async ({ page }) => {
  await page.addInitScript(() => { window.JC_UPDATE_MS = 300; });
  await stubBackend(page);
  const deploy = await fakeDeploy(page, "assets/landing.js");
  await page.goto("./");
  await expect(page.locator("#brand")).toHaveText("Commons");
  let reloads = 0;
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloads++; });
  await page.waitForTimeout(800);            // baseline fingerprint taken
  expect(reloads).toBe(0);                   // nothing changed yet → no reload
  const reloaded = page.waitForEvent("load", { timeout: 5000 });
  deploy();
  await reloaded;                            // waiting for the event, not peeking mid-navigation
  expect(reloads).toBeGreaterThanOrEqual(1);
});

test("mid-form: no reload, a tappable banner instead", async ({ page }) => {
  const csp = [];  // the update check must never be blocked by the page's own CSP
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await page.addInitScript(() => { window.JC_UPDATE_MS = 300; });
  await stubBackend(page);
  const deploy = await fakeDeploy(page, "account/account.js");
  await page.goto("account/");
  await page.locator("#email").fill("half-typed@exa");
  await page.evaluate(() => { window.__before = true; });
  await page.waitForTimeout(800);
  deploy();
  await expect(page.locator("#jcUpdate")).toHaveText("A new version of Commons is ready. Tap to refresh.", { timeout: 5000 });
  expect(await page.evaluate(() => window.__before)).toBe(true);   // not reloaded
  await expect(page.locator("#email")).toHaveValue("half-typed@exa");
  expect(csp).toEqual([]);
});
