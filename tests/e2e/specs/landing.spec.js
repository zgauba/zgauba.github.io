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
  await expect(page.getByText(/Zero-PII/)).toHaveCount(0);  // removed 2026-11-03
  await expect(page.locator("#yours")).toHaveText("Commons is starting small: for now it's just Jubail Island. More neighborhoods may follow one day.");
  await expect(page.locator("#yours a")).toHaveCount(0);  // no call to action
  for (const id of ["#yours"]) {
    expect(await page.locator(id).evaluate((n) => getComputedStyle(n).textAlign)).toBe("center");
  }
  expect(await page.locator("footer").evaluate((n) => getComputedStyle(n).textAlign)).toBe("center");
  await expect(page.locator("#credit")).toHaveText("Made by Zeeshan, your neighbor in Jubail Island");
  await expect(page.locator("#credit a")).toHaveText("Zeeshan");
  await expect(page.locator("#credit a")).toHaveAttribute("href", "https://zgauba.github.io/");
  const card = page.locator(".community[data-community=jubail]");
  await expect(card.locator(".names b")).toHaveText("Jubail Commons");
  await expect(card.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "account/?community=jubail");
  await expect(card.getByRole("link", { name: "Join" })).toHaveAttribute("href", "account/?community=jubail&view=join");
  await expect(page.locator("#hub")).toBeHidden();
  await expect(page.locator("#authLink")).toBeHidden();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(1);
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
  await expect(page.locator("#cards a.go[href='events/']")).toHaveText("See events");
  await expect(page.locator("#cards .card svg.ico")).toHaveCount(4);  // + The Community
  await expect(page.locator("#picker")).toBeHidden();
  await expect(page.locator("#authLink")).toBeHidden();  // the My Home tab is the account page
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
  await expect(page.locator("#authLink")).toBeHidden();  // no duplicate Sign in for signed-out visitors
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

test("?community=e2e adds that community's card for this visitor only", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: (a) => ok(a.p_community === "e2e"
    ? { id: "e2e", name_en: "E2E Test Commons", name_ar: null, modules: {} } : CONFIG) } });
  await page.goto("./?community=e2e");
  await expect(page.locator(".community")).toHaveCount(2);
  const card = page.locator('.community[data-community="e2e"]');
  await expect(card.locator(".names b")).toHaveText("E2E Test Commons");
  await expect(card.getByRole("link", { name: "Join" })).toHaveAttribute("href", "account/?community=e2e&view=join");
});

test("without ?community=, only Jubail is listed (e2e never public)", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  await expect(page.locator(".community")).toHaveCount(1);
  await expect(page.locator('.community[data-community="e2e"]')).toHaveCount(0);
});

test("module boxes are equal height; community cards are spaced apart", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_config_get: (a) => ok(a.p_community === "e2e"
    ? { id: "e2e", name_en: "E2E Test Commons", modules: {} } : CONFIG) } });
  await page.goto("./?community=e2e");
  await expect(page.locator(".community")).toHaveCount(2);
  const hs = await page.locator("#feats li").evaluateAll((ns) => ns.map((n) => Math.round(n.getBoundingClientRect().height)));
  expect(new Set(hs).size).toBe(1);
  const [a, b] = await page.locator(".community").evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect()));
  expect(b.top - a.bottom).toBeGreaterThanOrEqual(10);
});

// Link previews (WhatsApp, iMessage) read the raw HTML and never run scripts: commons.ae
// is the platform, so its static title / description name no community (Zee, 2026-11-04).
test("static page heads are community-agnostic (what link previews show)", async ({ page }) => {
  for (const path of ["./", "account/"]) {
    const html = await (await page.request.get(path)).text();
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head, path).not.toMatch(/Jubail/i);
    expect(head, path).toMatch(/<title>Commons/);
  }
  const root = await (await page.request.get("./")).text();
  expect(root).toMatch(/<meta property="og:title" content="Commons">/);
});

// Zee 2026-11-04: icons looked different sizes — each glyph's dots now span its whole box
test("icons: every glyph fills its square box on the long side", async ({ page }) => {
  await page.goto("./");
  const gaps = await page.evaluate(() => Object.keys(JC_ICONS).map((k) => {
    const host = document.createElement("div");
    host.innerHTML = jcIcon(k, 100);
    document.body.appendChild(host);
    const svg = host.firstChild, s = svg.getBoundingClientRect();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    svg.querySelectorAll("circle").forEach((c) => { const r = c.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
    host.remove();
    return [k, Math.round(Math.max(x1 - x0, y1 - y0) / s.width * 100)];
  }));
  for (const [k, pct] of gaps) expect(pct, k).toBeGreaterThanOrEqual(99);
});
