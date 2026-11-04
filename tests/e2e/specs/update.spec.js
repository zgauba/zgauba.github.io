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

test("a host hiccup (503 on a check) is NOT a deploy — no reload, no banner", async ({ page }) => {
  await page.addInitScript(() => { window.JC_UPDATE_MS = 300; });
  await stubBackend(page);
  let fail = false;
  await page.route("**/assets/landing.js", (route) => {
    if (route.request().method() !== "HEAD") return route.continue();
    return fail ? route.fulfill({ status: 503, body: "" })
                : route.fulfill({ status: 200, headers: { etag: '"v1"' }, body: "" });
  });
  await page.goto("./");
  let reloads = 0;
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloads++; });
  await page.waitForTimeout(800);
  fail = true;                       // the host hiccups for a few polls…
  await page.waitForTimeout(1200);
  fail = false;                      // …and recovers, same version
  await page.waitForTimeout(1200);
  expect(reloads).toBe(0);
  await expect(page.locator("#jcUpdate")).toHaveCount(0);
});

test("a prefilled display name doesn't block the idle reload", async ({ page }) => {
  const { MEMBER } = require("./stub");
  await page.addInitScript(() => { window.JC_UPDATE_MS = 300; });
  const me = JSON.parse(JSON.stringify(MEMBER)); me.account.display_name = "Omar";
  const { ok, raise } = require("./stub");
  await stubBackend(page, { rpc: { jc_me_get: (a, c) => c.signedIn ? ok(me) : raise("NOT_SIGNED_IN") } });
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com"); await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  const deploy = await fakeDeploy(page, "home/home.js");
  await page.goto("home/?tab=account");
  await expect(page.locator("#dname")).toHaveValue("Omar");
  await page.locator(".who").click();          // focus off any input
  await page.waitForTimeout(800);
  const reloaded = page.waitForEvent("load", { timeout: 5000 });
  deploy();
  await reloaded;
});
