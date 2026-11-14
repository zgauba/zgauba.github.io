// R3c — accessibility (docs/plans/R3-app-shell.md F + Step 8; audit: docs/qa/R3-a11y-audit-2026-11-08.md).
// 1. axe (test-only devDependency) on the main screens, EN + AR/RTL: fails on serious/critical only.
// 2. The three sub-tab rows (event, My Home, Organizer Tools) behave as WAI-ARIA tabs: roving tabindex,
//    ←/→ mirrored in Arabic, Home/End, aria-controls → a real tabpanel, focus kept after the redraw, ?tab= URLs.
// 3. Focus after an action that redraws the view stays on the control, not <body>.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, CONFIG } = require("./stub");
const { eventsBackend, adminBackend, signIn, LIVE_ID, PINS_ID } = require("./backends");

const MODULES = { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } };

async function setup(page, { persona = "member", lang = "en" } = {}) {
  const scopes = persona === "community-admin" ? ["community", "events"] : [];
  const rpc = Object.assign({}, eventsBackend().rpc, adminBackend({ scopes }).rpc, {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { modules: MODULES })),
    jc_display_name_set: (a) => ok(Object.assign({}, require("./stub").MEMBER,
      { account: Object.assign({}, require("./stub").MEMBER.account, { display_name: a.p_name }) })),
  });
  if (!scopes.length) delete rpc.jc_me_get;            // stub.js's plain member
  await stubBackend(page, { rpc });
  await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, lang);
  if (persona !== "anon") await signIn(page);
}

// ── 1. axe ──
const SCREENS = [
  ["hub (signed out)", "", "anon", "#view, main"],
  ["hub", "", "member", "#tabbar"],
  ["events list", "events/", "member", "#lists .evcard, #lists p"],
  ["event · map", "events/?id=" + LIVE_ID + "&tab=map", "member", '[role="tabpanel"]'],
  ["event · list", "events/?id=" + LIVE_ID + "&tab=list", "member", '[role="tabpanel"]'],
  ["event · sign up", "events/?id=" + LIVE_ID + "&tab=mine", "member", '[role="tabpanel"]'],
  ["event with a look (pins)", "events/?id=" + PINS_ID + "&tab=list", "member", '[role="tabpanel"]'],
  ["My Home", "home/", "member", '[role="tabpanel"]'],
  ["My Home · household", "home/?tab=household", "member", '[role="tabpanel"]'],
  ["My Home · account + Settings", "home/?tab=account", "member", "#shellSec"],
  ["Organizer Tools · events", "admin/?tab=events", "community-admin", '[role="tabpanel"]'],
  ["Organizer Tools · banner", "admin/?tab=banner", "community-admin", "#bannerText"],
  ["Organizer Tools · community", "admin/?tab=community", "community-admin", '[role="tabpanel"]'],
  ["account (signed out)", "account/", "anon", "#email"],
];
const AR = ["hub", "event · list", "My Home · account + Settings", "Organizer Tools · community"];

for (const lang of ["en", "ar"]) {
  for (const [name, path, persona, ready] of SCREENS) {
    if (lang === "ar" && !AR.includes(name)) continue;
    test(`axe ${lang}: ${name} has no serious or critical issues`, async ({ page }) => {
      await setup(page, { persona, lang });
      await page.goto(path);
      await expect(page.locator(ready).first()).toBeAttached();
      await page.waitForLoadState("networkidle");
      if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(bad).toEqual([]);
    });
  }
}

// ── 2. tab rows ──
const ROWS = [
  { name: "event", persona: "member", path: "events/?id=" + LIVE_ID + "&tab=map", prefix: "tab-", keys: ["map", "list", "mine"],
    url: (k) => new RegExp("\\?id=" + LIVE_ID + "&tab=" + k + "$") },
  { name: "My Home", persona: "member", path: "home/", prefix: "mh-", keys: ["home", "household", "account"],
    url: (k) => (k === "home" ? /\/home\/$/ : new RegExp("\\?tab=" + k + "$")) },
  { name: "Organizer Tools", persona: "community-admin", path: "admin/?tab=events", prefix: "atab-", keys: ["events", "courts", "pets", "community", "banner"],
    url: (k) => new RegExp("\\?tab=" + k + "$") },
];

async function expectSelected(page, row, k) {
  const tab = page.locator("#" + row.prefix + k);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeFocused();                              // focus survived the redraw
  await expect(page).toHaveURL(row.url(k));
  // roving tabindex: only the selected tab is in the Tab order
  const idx = await page.locator('[role="tablist"] [role="tab"]').evaluateAll((ts) => ts.map((t) => t.getAttribute("tabindex")));
  expect(idx).toEqual(row.keys.map((x) => (x === k ? "0" : "-1")));
  // aria-controls → an existing tabpanel labelled by the selected tab
  const panel = page.locator("#" + (await tab.getAttribute("aria-controls")));
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", row.prefix + k);
}

for (const row of ROWS) {
  test(`${row.name} tabs: ←/→ wrap, Home/End; focus stays on the selected tab; ?tab= URLs unchanged`, async ({ page }) => {
    await setup(page, { persona: row.persona });
    await page.goto(row.path);
    const a = row.keys[0], b = row.keys[1], c = row.keys[row.keys.length - 1];   // any number of tabs (R4b-1b: 4)
    await expect(page.locator('[role="tablist"]')).toHaveAttribute("aria-label", /\S/);
    await page.locator("#" + row.prefix + a).focus();
    for (const k of row.keys.slice(1)) { await page.keyboard.press("ArrowRight"); await expectSelected(page, row, k); }
    await page.keyboard.press("ArrowRight"); await expectSelected(page, row, a);   // wraps
    await page.keyboard.press("ArrowLeft");  await expectSelected(page, row, c);   // wraps back
    await page.keyboard.press("Home");       await expectSelected(page, row, a);
    await page.keyboard.press("End");        await expectSelected(page, row, c);
    await page.locator("#" + row.prefix + b).click();
    await expect(page.locator("#" + row.prefix + b)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(row.url(b));
  });
}

test("Arabic: the arrows follow the reading direction (→ goes back, ← goes on)", async ({ page }) => {
  await setup(page, { lang: "ar" });
  await page.goto("home/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator("#mh-home").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#mh-household")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#mh-household")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#mh-home")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#mh-home")).toBeFocused();
});

test("a one-place event (two tabs) still wires every key; Organizer Tools tab focus kept (was the only row that did)", async ({ page }) => {
  await setup(page, { persona: "community-admin" });
  await page.goto("admin/?tab=community");
  await page.locator("#atab-community").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#atab-pets")).toBeFocused();                // R5d-1: … Courts · Pets · Community · Banner
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#atab-banner")).toBeFocused();              // the Banner is the last tab (Zee 2026-11-14)
  await expect(page.locator("#bannerText")).toBeVisible();
  // a half-typed banner survives switching away and back by keyboard
  await page.locator("#bannerText").fill("Road closed");
  await page.locator("#atab-banner").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#atab-community")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#bannerText")).toHaveValue("Road closed");
  // a modified arrow (e.g. Alt/Cmd+← = browser Back) is left to the browser
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#atab-banner")).toHaveAttribute("aria-selected", "true");
});

// ── 3. names, focus ring, language, focus after an action ──
test("bottom bar has its own name (not its first button's); the language button says which language it's in", async ({ page }) => {
  await setup(page);
  await page.goto("events/");
  await expect(page.locator("#tabbar")).toHaveAttribute("aria-label", "Main");
  await expect(page.locator("#langBtn")).toHaveAttribute("lang", "ar");     // "عربي" is Arabic text
  await page.locator("#langBtn").click();
  await expect(page.locator("#tabbar")).toHaveAttribute("aria-label", "القائمة الرئيسية");
  await expect(page.locator("#langBtn")).toHaveAttribute("lang", "en");     // "EN"
});

test("textarea gets the same focus ring as inputs", async ({ page }) => {
  await setup(page, { persona: "community-admin" });
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerText").focus();
  const o = await page.locator("#bannerText").evaluate((t) => { const s = getComputedStyle(t); return s.outlineStyle + " " + s.outlineWidth; });
  expect(o).toBe("solid 2px");
});

test("My Home: Save (keyboard) redraws the view and focus stays on Save, not <body>", async ({ page }) => {
  await setup(page);
  await page.goto("home/?tab=account");
  await page.locator("#dname").fill("Sam");
  await page.locator("#saveName").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#msg")).toHaveClass(/ok/);
  await expect(page.locator("#saveName")).toBeFocused();
});

test("My Home has a level-one heading for screen readers (visually hidden)", async ({ page }) => {
  await setup(page);
  await page.goto("home/");
  await expect(page.locator("h1.sr-only")).toHaveText("My Home");
});
