// R3a — your bottom bar + start page + Settings (docs/plans/R3-app-shell.md A–D, Step 8).
// The bar reads jc_me_get.account.prefs.shell; Settings writes it with jc_prefs_set (whole object
// replaced server-side, so the client merges into a FRESH copy). Module flags are re-read live.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_HOME } = require("./stub");
const { signIn } = require("./backends");

const EVENTS_ON = { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } };

// A resident whose prefs / roles / module flags the test controls; jc_prefs_set behaves like the server
// (replaces the whole object, BAD_PREFS over 2 KB, returns jc_me_get).
function shellBackend(opts = {}) {
  const st = {
    me: JSON.parse(JSON.stringify(Object.assign({}, opts.me || MEMBER, opts.extra || {}))),
    modules: JSON.parse(JSON.stringify(opts.modules || EVENTS_ON)),
    badPrefs: false,
  };
  if (opts.prefs !== undefined) st.me.account = Object.assign({}, st.me.account, { prefs: opts.prefs });
  const rpc = {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { modules: st.modules })),
    jc_me_get: (a, c) => (c.signedIn ? ok(st.me) : raise("NOT_SIGNED_IN")),
    jc_prefs_set: (a) => {
      if (st.badPrefs || JSON.stringify(a.p_prefs).length > 2048) return raise("BAD_PREFS");
      st.me = Object.assign({}, st.me, { account: Object.assign({}, st.me.account, { prefs: a.p_prefs }) });
      return ok(st.me);
    },
    jc_my_history: () => raise("MODULE_OFF"),
    jc_events_list: () => ok([]),
  };
  return { st, rpc };
}

const bar = (page) => page.locator("#tabbar a").evaluateAll((as) => as.map((a) => a.dataset.tab));
const settings = (page) => page.locator("#shellSec li[data-dest]").evaluateAll((ls) => ls.map((l) => l.dataset.dest));
async function openSettings(page) {
  await page.goto("home/?tab=account");
  await expect(page.locator("#shellSec")).toBeVisible();
}
// Pretend the not-yet-built pages exist (the registry's page:false → true), served from the real nav.js.
async function allPagesExist(target) {
  await target.route("**/assets/nav.js", async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace(/page: false/g, "page: true") });
  });
}
// A NEW visit: a fresh tab has its own sessionStorage but shares the signed-in session (localStorage).
async function newVisit(context, rpc) {
  const p = await context.newPage();
  const stub = await stubBackend(p, { rpc });
  return { p, calls: stub.calls };
}

for (const [name, prefs] of [["key missing", undefined], ["{}", {}]]) {
  test(`no prefs (${name}): today's bar; Courts (R4c) and Pets (R5b-1) show now their pages exist; The Community never without its page`, async ({ page }) => {
    const b = shellBackend({ prefs, modules: { events: { enabled: true }, bookings: { enabled: true }, pets: { enabled: true } } });
    await stubBackend(page, { rpc: b.rpc });
    await signIn(page);
    await expect.poll(() => bar(page)).toEqual(["commons", "events", "bookings", "pets", "home"]);
    await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "commons");
    await page.goto("home/");
    await expect.poll(() => bar(page)).toEqual(["commons", "events", "bookings", "pets", "home"]);
    await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "home");
  });
}

test("Settings: hide, reorder, start page → exact merged jc_prefs_set → bar updates and survives reload", async ({ page }) => {
  // a Courts-scope admin (module admin): Organizer Tools is offered; an unrelated prefs key must survive
  const b = shellBackend({ prefs: { x: 1 }, extra: { admin_scopes: ["bookings"] } });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openSettings(page);
  await expect.poll(() => settings(page)).toEqual(["commons", "events", "admin"]);     // available destinations only
  await expect(page.locator("#shellSec li.fixed")).toContainText("My Home");
  await expect(page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]')).toHaveAttribute("aria-checked", "false");
  await page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]').click();
  await page.locator('#shellSec li[data-dest="commons"] [data-act="toggle"]').click();
  await page.locator('#shellSec li[data-dest="admin"] [data-act="up"]').click();
  await expect(page.locator('#shellSec li[data-dest="admin"] [data-act="up"]')).toBeFocused();   // focus stays on the row
  await page.locator('#shellSec li[data-dest="admin"] [data-act="up"]').click();
  await expect.poll(() => settings(page)).toEqual(["admin", "commons", "events"]);
  await expect(page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]')).toBeFocused();  // "up" is now disabled
  await page.locator("#start-events").check();
  const before = calls.length;
  await page.locator("#saveShell").click();
  await expect(page.locator("#shellMsg")).toHaveText("Saved. Your bar is updated.");
  const sent = calls.slice(before).filter((c) => c.kind === "rpc").map((c) => c.name);
  expect(sent).toEqual(["jc_me_get", "jc_prefs_set"]);                       // read fresh, then write
  expect(calls.find((c) => c.name === "jc_prefs_set").args).toEqual({ p_prefs: {
    x: 1, shell: { v: 1, tabs: ["admin", "events"], start: "events", known: ["commons", "events", "admin"] } } });
  await expect.poll(() => bar(page)).toEqual(["admin", "events", "home"]);              // at once, no reload
  await page.reload();
  await expect.poll(() => bar(page)).toEqual(["admin", "events", "home"]);
  await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "home");
  await expect(page.locator("#start-events")).toBeChecked();
  await page.goto("events/");
  await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "events");
  await expect(page.locator('#tabbar a[data-tab="admin"]')).toHaveAttribute("href", "../admin/");
  await expect(page.locator('#tabbar a[data-tab="home"]')).toHaveText("My Home");
  await expect(page.locator("#tabbar a").last()).toHaveAttribute("data-tab", "home");
});

test("at most 4 middle buttons: a 5th can't be switched on", async ({ page }) => {
  const b = shellBackend({ extra: { is_owner: true } });
  // pretend more pages exist so 5 destinations are on offer
  await allPagesExist(page);
  b.st.modules = { events: { enabled: true }, bookings: { enabled: true }, pets: { enabled: true } };
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => bar(page)).toEqual(["commons", "events", "bookings", "pets", "home"]);   // default: 4 + My Home
  await openSettings(page);
  await expect.poll(() => settings(page)).toEqual(["commons", "events", "bookings", "pets", "community", "admin"]);
  await expect(page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]')).toBeDisabled();
  await expect(page.locator("#shellFull")).toBeVisible();
  await page.locator('#shellSec li[data-dest="pets"] [data-act="toggle"]').click();
  await expect(page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]')).toBeEnabled();
});

test("Organizer Tools: never for a plain member; shown for a module admin and an event admin", async ({ page }) => {
  const prefs = { shell: { v: 1, tabs: ["admin", "events"], start: "admin", known: ["commons", "events", "admin"] } };
  const member = shellBackend({ prefs });
  await stubBackend(page, { rpc: member.rpc });
  await signIn(page);
  await expect.poll(() => bar(page)).toEqual(["events", "home"]);
  await openSettings(page);
  await expect.poll(() => settings(page)).toEqual(["events", "commons"]);
  await expect(page.locator("#start-admin")).toHaveCount(0);
  for (const extra of [{ admin_scopes: ["bookings"] }, { admin_events: ["44444444-4444-4444-8444-444444444444"] }]) {
    member.st.me = Object.assign({}, member.st.me, { admin_scopes: [], admin_events: [] }, extra);
    await page.goto("home/");
    await expect.poll(() => bar(page)).toEqual(["admin", "events", "home"]);
  }
});

test("module off drops a saved button and the start page; switched back on, they return (and a save keeps them)", async ({ context, page }) => {
  const b = shellBackend({ prefs: { shell: { v: 1, tabs: ["events"], start: "events", known: ["commons", "events"] } } });
  b.st.modules = { events: { enabled: false }, bookings: { enabled: false }, pets: { enabled: false } };
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => bar(page)).toEqual(["home"]);                                 // every module off: still a bar with My Home
  await openSettings(page);
  await expect.poll(() => settings(page)).toEqual(["commons"]);
  await expect(page.locator("#start-commons")).toBeChecked();
  await page.locator('#shellSec li[data-dest="commons"] [data-act="toggle"]').click();
  await page.locator("#saveShell").click();
  await expect(page.locator("#shellMsg")).toHaveText("Saved. Your bar is updated.");
  // the switched-off module's choice is kept (R4 C3) and the start page too
  expect(calls.find((c) => c.name === "jc_prefs_set").args.p_prefs.shell).toEqual(
    { v: 1, tabs: ["events", "commons"], start: "events", known: ["commons", "events"] });   // in its old place
  const v1 = await newVisit(context, b.rpc);
  await v1.p.goto("./");
  await expect(v1.p.locator("#hub")).toBeVisible();                          // start page unavailable → the hub
  await expect.poll(() => bar(v1.p)).toEqual(["commons", "home"]);
  b.st.modules = EVENTS_ON;
  const v2 = await newVisit(context, b.rpc);
  await v2.p.goto("./");
  await expect(v2.p).toHaveURL(/\/commons\/events\/$/);                      // start page back with its module
  await expect.poll(() => bar(v2.p)).toEqual(["events", "commons", "home"]);
});

test("a full bar keeps a switched-off button in its place; tapping the checked Commons clears a switched-off start page", async ({ context, page }) => {
  // pretend every page exists so 4 other destinations are on offer while Events is off
  await allPagesExist(context);
  const all = ["commons", "events", "bookings", "pets", "community", "admin"];
  const b = shellBackend({ extra: { is_owner: true },
    prefs: { shell: { v: 1, tabs: ["events", "commons", "bookings", "pets"], start: "events", known: all } } });
  b.st.modules = { events: { enabled: false }, bookings: { enabled: true }, pets: { enabled: true } };
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openSettings(page);
  await expect(page.locator("#start-commons")).toBeChecked();
  await page.locator('#shellSec li[data-dest="admin"] [data-act="toggle"]').click();
  await page.locator("#start-commons").click();                             // already checked: still a choice
  await page.locator("#saveShell").click();
  await expect(page.locator("#shellMsg")).toHaveText("Saved. Your bar is updated.");
  await expect(page.locator("#saveShell")).toBeFocused();                   // the reader keeps their place
  expect(calls.find((c) => c.name === "jc_prefs_set").args.p_prefs.shell).toEqual(
    { v: 1, tabs: ["events", "commons", "bookings", "pets", "admin"], start: "commons",
      known: ["commons", "bookings", "pets", "community", "admin", "events"] });
  b.st.modules = { events: { enabled: true }, bookings: { enabled: true }, pets: { enabled: true } };
  const v = await newVisit(context, b.rpc);
  await v.p.goto("./");
  await expect(v.p.locator("#hub")).toBeVisible();                          // no stale start page
  await expect.poll(() => bar(v.p)).toEqual(["events", "commons", "bookings", "pets", "home"]);
});

test("a destination switched on after a save is added to a customised bar (known)", async ({ page }) => {
  const b = shellBackend({ prefs: { shell: { v: 1, tabs: ["commons"], start: "commons", known: ["commons"] } } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => bar(page)).toEqual(["commons", "events", "home"]);
  // but one the resident hid on purpose stays hidden
  b.st.me.account.prefs.shell.known = ["commons", "events"];
  await page.reload();
  await expect.poll(() => bar(page)).toEqual(["commons", "home"]);
});

test("junk prefs → the default bar and no start page", async ({ context, page }) => {
  const junk = [
    { shell: "events" }, { shell: [] }, { shell: { v: 2, tabs: ["events"], start: "events" } },
    { shell: { v: 1, tabs: "x", start: "events" } },
    { shell: { v: 1, tabs: Array(50).fill("events"), start: "events" } },
    { shell: { v: 1, tabs: ["nope", "constructor", "__proto__", "home", 7, null, "events", "events"], start: "javascript:alert(1)", known: "x" } },
  ];
  const b = shellBackend({ prefs: junk[0] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  for (const prefs of junk) {
    b.st.me.account = Object.assign({}, b.st.me.account, { prefs });
    const v = await newVisit(context, b.rpc);
    await v.p.goto("./");
    await expect(v.p.locator("#hub")).toBeVisible();
    // the last one keeps its one valid key (events, once) and gets the newly available commons
    await expect.poll(() => bar(v.p)).toEqual(prefs.shell.known === "x" ? ["events", "commons", "home"] : ["commons", "events", "home"]);
    await v.p.close();
  }
});

test("BAD_PREFS: error text, bar unchanged", async ({ page }) => {
  const b = shellBackend();
  b.st.badPrefs = true;
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openSettings(page);
  await page.locator('#shellSec li[data-dest="commons"] [data-act="toggle"]').click();
  await page.locator("#saveShell").click();
  await expect(page.locator("#shellMsg")).toHaveText("Your settings couldn't be saved. Reload the page and try again.");
  await expect.poll(() => bar(page)).toEqual(["commons", "events", "home"]);
  await expect(page.locator("#saveShell")).toBeEnabled();
});

test("start page: first page of a visit only; never on a second Commons tap, a deep link, a sign-in return or without a home", async ({ context, page }) => {
  const b = shellBackend({ prefs: { shell: { v: 1, tabs: ["events", "commons"], start: "events", known: ["commons", "events"] } } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);                                                        // sign-in return → the hub
  await expect(page.locator("#hub")).toBeVisible();
  const v = await newVisit(context, b.rpc);
  await v.p.goto("./");
  await expect(v.p).toHaveURL(/\/commons\/events\/$/);
  expect(v.calls.filter((c) => c.name === "jc_hit").map((c) => c.args.p_page)).toContain("landing");   // the app open still counts
  await v.p.locator('#tabbar a[data-tab="commons"]').click();
  await expect(v.p).toHaveURL(/\/commons\/$/);
  await expect(v.p.locator("#hub")).toBeVisible();                           // Commons always shows the hub
  await v.p.reload();
  await expect(v.p.locator("#hub")).toBeVisible();
  await expect(v.p).toHaveURL(/\/commons\/$/);
  // a ?community= link is still a plain open; anything else is a deep link
  const v2 = await newVisit(context, b.rpc);
  await v2.p.goto("./?community=jubail");
  await expect(v2.p).toHaveURL(/\/commons\/events\/$/);
  for (const deep of ["home/?tab=account", "./?ref=whatsapp", "./#feedback"]) {
    const d = await newVisit(context, b.rpc);
    await d.p.goto(deep);
    await d.p.waitForLoadState("networkidle");
    expect(new URL(d.p.url()).pathname).toBe(deep.startsWith("home") ? "/commons/home/" : "/commons/");
    await d.p.close();
  }
  // a member without a home: the existing redirect to home/ wins
  b.st.me = Object.assign({}, MEMBER_NO_HOME, { account: b.st.me.account });
  const n = await newVisit(context, b.rpc);
  await n.p.goto("./");
  await expect(n.p).toHaveURL(/\/commons\/home\/$/);
});

test("unsaved choices survive a tab switch and a language toggle; a deploy shows the banner, no reload", async ({ page }) => {
  await page.addInitScript(() => { window.JC_UPDATE_MS = 300; });
  const b = shellBackend();
  await stubBackend(page, { rpc: b.rpc });
  let deployed = false;
  await page.route("**/home/home.js", (route) => {
    if (route.request().method() !== "HEAD") return route.continue();
    return route.fulfill({ status: 200, headers: { etag: deployed ? '"v2"' : '"v1"' }, body: "" });
  });
  await signIn(page);
  await openSettings(page);
  await expect(page.locator("#shellSec")).not.toHaveAttribute("data-no-autoreload", "");
  await page.locator('#shellSec li[data-dest="events"] [data-act="up"]').click();
  await page.locator("#start-events").check();
  await page.locator("#dname").fill("Draft");
  await page.locator("#mh-home").click();
  await page.locator("#mh-account").click();
  await page.locator("#langBtn").click();
  await expect.poll(() => settings(page)).toEqual(["events", "commons"]);
  await expect(page.locator("#start-events")).toBeChecked();
  await expect(page.locator("#dname")).toHaveValue("Draft");
  await page.locator("#langBtn").click();
  await page.locator("#dname").fill("");                                    // only the Settings change is unsaved now
  await page.locator("#dname").blur();
  await expect(page.locator("#shellSec")).toHaveAttribute("data-no-autoreload", "");
  await page.evaluate(() => { window.__before = true; });
  await page.waitForTimeout(800);
  deployed = true;
  await expect(page.locator("#jcUpdate")).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => window.__before)).toBe(true);
});

test("Arabic: Settings, install help and the bar in Arabic, right to left", async ({ page }) => {
  const b = shellBackend({ extra: { admin_events: ["44444444-4444-4444-8444-444444444444"] } });
  await stubBackend(page, { rpc: b.rpc });
  await page.addInitScript(() => { try { localStorage.setItem("jc_lang", "ar"); } catch (e) {} });
  await signIn(page);
  await openSettings(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#shellSec h2")).toHaveText("الشريط السفلي وصفحة البداية");
  await expect(page.locator('#shellSec li[data-dest="admin"] .nm')).toHaveText("التنظيم");
  await expect(page.locator('#shellSec li[data-dest="events"] [data-act="toggle"]')).toHaveText("ظاهر");
  await expect(page.locator('#shellSec li[data-dest="events"] [data-act="up"]')).toHaveAttribute("aria-label", "انقل الفعاليات إلى الأعلى");
  await expect(page.locator("#saveShell")).toHaveText("احفظ الشريط وصفحة البداية");
  await page.locator("#install summary").click();
  await expect(page.locator("#install li").first()).toContainText("آيفون");
  await expect(page.locator("#tabbar a").last()).toHaveText("منزلي");
  // every new string has both languages
  const missing = await page.evaluate(() => Object.keys(JC_STRINGS.en).filter((k) => /^(set_|inst_|tab_admin|forgot_standalone|err_BAD_PREFS)/.test(k) && !JC_STRINGS.ar[k]));
  expect(missing).toEqual([]);
});

test("installed app: the reset screen says to reset from the browser; not shown in a browser", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/");
  await page.locator("#toForgot").click();
  await expect(page.locator("h1")).toHaveText("Reset Your Password");
  await expect(page.locator("#standaloneNote")).toHaveCount(0);
  await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true, configurable: true }); });
  await page.reload();
  await page.locator("#toForgot").click();
  await expect(page.locator("#standaloneNote")).toContainText("Reset links open in your browser");
  await page.locator("#langBtn").click();
  await expect(page.locator("#standaloneNote")).toContainText("سفاري");
});
