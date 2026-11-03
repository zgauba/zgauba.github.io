// Landing regressions (T5 plan, Step 3 items 1–5) + CSP + auth link.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, CONFIG } = require("./stub");

function cspViolations(page) {
  const v = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) v.push(m.text()); });
  return v;
}

test("renders config from the server, counts the visit, no CSP violations", async ({ page }) => {
  const csp = cspViolations(page);
  const { calls, escaped } = await stubBackend(page, {
    rpc: { jc_config_get: () => ok(Object.assign({}, CONFIG, {
      broadcast: "Road closed at Souk",
      modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } },
    })) },
  });
  await page.goto("./");
  await expect(page.locator("#brand")).toHaveText("Jubail Commons");
  await expect(page.locator("#bcast")).toHaveText("⚠️ Road closed at Souk");
  await expect(page.locator("#cards a.go[href='events/']")).toHaveText("Sign your home up");
  await expect(page.locator("#errbar")).toBeHidden();
  await expect.poll(() => calls.filter((c) => c.name === "jc_hit").length).toBe(1);
  expect(calls.find((c) => c.name === "jc_hit").args).toEqual({ p_community: "jubail", p_page: "landing" });
  expect(csp).toEqual([]);
  expect(escaped).toEqual([]);
});

test("config failure shows the error bar and defaults — never a blank page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: () => ({ status: 500, body: { message: "boom" } }) } });
  await page.goto("./");
  await expect(page.locator("#errbar")).toBeVisible();
  await expect(page.locator("#brand")).toHaveText("Jubail Commons");
  await expect(page.locator("#cards .card")).toHaveCount(4);
});

test("a failing visit counter never affects the page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_hit: () => ({ status: 500, body: { message: "down" } }) } });
  await page.goto("./");
  await expect(page.locator("#brand")).toHaveText("Jubail Commons");
  await expect(page.locator("#errbar")).toBeHidden();
});

test("language toggle switches to Arabic + RTL, header from config name_ar", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#brand")).toHaveText("كومنز الجبيل");
  await expect(page.locator("#authLink")).toHaveText("تسجيل الدخول");
});

test("non-https archive link from config falls back to the default", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: () => ok(Object.assign({}, CONFIG, {
    links: { halloween_archive: "javascript:alert(1)" } })) } });
  await page.goto("./");
  await expect(page.locator("#cards a[target=_blank]")).toHaveAttribute("href", "https://zgauba.github.io/jubail-halloween/");
});

test("auth link: 'Sign in' signed out, 'Account' once signed in", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  await expect(page.locator("#authLink")).toHaveText("Sign in");
  await expect(page.locator("#authLink")).toHaveAttribute("href", "account/");
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  await expect(page.locator("#authLink")).toHaveText("Account");
});
