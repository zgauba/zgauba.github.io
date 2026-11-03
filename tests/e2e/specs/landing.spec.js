// Landing: signed-out platform entry (wireframe band 01) vs signed-in hub, plus the
// regressions carried from the original landing (plan Step 3 items 1–5), CSP,
// and the github.io → commons.ae canonical redirect.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, CONFIG } = require("./stub");

function cspViolations(page) {
  const v = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) v.push(m.text()); });
  return v;
}

async function signIn(page) {
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
}

test("signed out: platform entry with Sign in + Join, no hub, visit counted, no CSP violations", async ({ page }) => {
  const csp = cspViolations(page);
  const { calls, escaped } = await stubBackend(page);
  await page.goto("./");
  await expect(page.locator("#brand")).toHaveText("Commons");
  await expect(page.locator("#tagline")).toHaveText("Neighborhood software, run by neighbors.");
  await expect(page.locator("#feats li")).toHaveCount(4);
  await expect(page.locator("#feats li svg.ico")).toHaveCount(4);
  await expect(page.locator("#feats li").nth(3)).toContainText("The Community");
  await expect(page.locator("#feats li").nth(2).locator("b")).toHaveText("Pets");  // not "Pets of Jubail" — signed-out page is community-agnostic
  await expect(page.locator(".community svg.ico")).toHaveCount(1);
  for (const id of ["#privacy", "#yours"]) {
    expect(await page.locator(id).evaluate((n) => getComputedStyle(n).textAlign)).toBe("center");
  }
  expect(await page.locator("footer").evaluate((n) => getComputedStyle(n).textAlign)).toBe("center");
  await expect(page.locator("#credit")).toHaveText("Made by Zeeshan, your neighbor in Ain Al Maha");
  await expect(page.locator("#credit a")).toHaveText("Zeeshan");
  await expect(page.locator("#credit a")).toHaveAttribute("href", "https://zgauba.github.io/");
  const card = page.locator(".community[data-community=jubail]");
  await expect(card.locator(".names b")).toHaveText("Jubail Commons");
  await expect(card.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "account/?community=jubail");
  await expect(card.getByRole("link", { name: "Join" })).toHaveAttribute("href", "account/?community=jubail&view=join");
  await expect(page.locator("#hub")).toBeHidden();
  await expect(page.locator("#errbar")).toBeHidden();
  await expect.poll(() => calls.filter((c) => c.name === "jc_hit").length).toBe(1);
  expect(calls.find((c) => c.name === "jc_hit").args).toEqual({ p_community: "jubail", p_page: "landing" });
  expect(csp).toEqual([]);
  expect(escaped).toEqual([]);
});

test("Join → the code step, headed with the community's name", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  await page.locator(".community").getByRole("link", { name: "Join" }).click();
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#homeLink")).toHaveText("Jubail Commons");
});

test("signed-in member: the hub (broadcast + enabled module), not the picker", async ({ page }) => {
  await stubBackend(page, {
    rpc: { jc_config_get: () => ok(Object.assign({}, CONFIG, {
      broadcast: "Road closed at Souk",
      modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } },
    })) },
  });
  await signIn(page);
  await expect(page.locator("#brand")).toHaveText("Jubail Commons");
  await expect(page.locator("#bcast")).toHaveText("⚠️ Road closed at Souk");
  await expect(page.locator("#cards a.go[href='events/']")).toHaveText("Sign your home up");
  await expect(page.locator("#cards .card svg.ico")).toHaveCount(3);
  await expect(page.locator("#picker")).toBeHidden();
  await expect(page.locator("#authLink")).toHaveText("Account");
});

test("config failure shows the error bar and the default community — never a blank page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: () => ({ status: 500, body: { message: "boom" } }) } });
  await page.goto("./");
  await expect(page.locator("#errbar")).toBeVisible();
  await expect(page.locator(".community .names b")).toHaveText("Jubail Commons");
});

test("a failing visit counter never affects the page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_hit: () => ({ status: 500, body: { message: "down" } }) } });
  await page.goto("./");
  await expect(page.locator("#brand")).toHaveText("Commons");
  await expect(page.locator("#errbar")).toBeHidden();
});

test("language toggle switches to Arabic + RTL", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  await expect(page.locator(".community .names b")).toHaveText("Jubail Commons");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#brand")).toHaveText("كومنز");
  await expect(page.locator(".community .names b")).toHaveText("كومنز الجبيل");
  await expect(page.locator("#authLink")).toHaveText("تسجيل الدخول");
});

test("non-https archive link from config falls back to the default", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: () => ok(Object.assign({}, CONFIG, {
    links: { halloween_archive: "javascript:alert(1)" } })) } });
  await page.goto("./");
  await expect(page.locator(".community")).toHaveCount(1);
  await expect(page.locator("#archiveLink")).toHaveAttribute("href", "https://zgauba.github.io/jubail-halloween/");
});

test("canonical redirect: only the github.io copy forwards, path/query/fragment kept", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  const r = await page.evaluate(() => [
    jcCanonicalUrl("zgauba.github.io", "/commons/", "", ""),
    jcCanonicalUrl("zgauba.github.io", "/commons", "", ""),
    jcCanonicalUrl("zgauba.github.io", "/commons/account/", "?view=join&community=jubail", "#x"),
    jcCanonicalUrl("commons.ae", "/account/", "", ""),
    jcCanonicalUrl("commons-7ii.pages.dev", "/", "", ""),
    jcCanonicalUrl("localhost", "/commons/", "", ""),
    jcCanonicalUrl("zgauba.github.io", "/commonsfoo/", "", ""),
  ]);
  expect(r).toEqual([
    "https://commons.ae/",
    "https://commons.ae/",
    "https://commons.ae/account/?view=join&community=jubail#x",
    null, null, null,
    "https://commons.ae/commonsfoo/",
  ]);
});
