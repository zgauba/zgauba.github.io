// RM-b — renamable modules (server RM-a: jc_config_get 'labels', jc_admin_module_label_set).
// Plan: docs/plans/RM-renamable-modules.md. A NAME shows in the bar / tabs / Settings / Organizer Tools / Admins,
// a TITLE on the page heading, hub card and browser title (falls back to the name, then the built-in string).
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG, MEMBER } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const ON = { events: { enabled: true }, bookings: { enabled: true }, pets: { enabled: false } };
const SPORTS = {
  bookings: { name: { en: "Sports", ar: "الرياضة" }, title: { en: "Island Sports" } },
  events: { title: { en: "What's On", ar: "ما الجديد" } },
  pets: { title: { en: "Pets of Jubail", ar: "حيوانات الجبيل الأليفة" } },
};

// Premortem 2 (silent zero-output): a screen that prints a built-in module name directly would never show a
// rename. Only api.js (the fallback inside jcModName / jcModTitle) may read these keys.
test("no screen reads a built-in section name except through jcModName / jcModTitle", async () => {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "../../../commons");
  const files = [];
  (function walk(d){ for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "vendor") walk(p); }
    else if (p.endsWith(".js") && !/assets\/(api|strings)\.js$/.test(p)) files.push(p);
  } })(root);
  const bad = /jcT\("(module_(events|bookings|pets|community)|ev_title|feat_pets|adm_tab_(events|courts)|scope_(events|bookings|pets)|adm_ad_scope_(bookings|pets)|help_(events|courts)_title)"\)/;
  const hits = files.flatMap((p) => fs.readFileSync(p, "utf8").split("\n")
    .map((l, i) => (bad.test(l) ? path.relative(root, p) + ":" + (i + 1) : null)).filter(Boolean));
  expect(hits).toEqual([]);
});

function residentBackend(opts = {}) {
  const st = { labels: opts.labels || {}, configFails: false, modules: opts.modules || ON };
  const rpc = {
    jc_config_get: () => (st.configFails ? raise("NETWORK_X") : ok(Object.assign({}, CONFIG, { modules: st.modules, labels: st.labels }))),
    jc_me_get: (a, c) => (c.signedIn ? ok(MEMBER) : raise("NOT_SIGNED_IN")),
    jc_events_list: () => ok([]),
    jc_my_history: () => ok([]),
    jc_facilities_list: () => ok([]),
    jc_my_bookings: () => ok([]),
  };
  return { st, rpc };
}
const barLabels = (page) => page.locator("#tabbar a span").allTextContents();

test("nothing renamed: today's labels everywhere; Pets is generic", async ({ page }) => {
  const b = residentBackend({ modules: Object.assign({}, ON, { pets: { enabled: true } }) });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => barLabels(page)).toEqual(["Commons", "Events", "Courts", "My Home"]);
  await expect(page.locator("#cards h2")).toHaveText(["Events", "Courts", "Pets", "The Community"]);
});

test("renamed: bar, hub card, page heading, browser title — EN and AR, title falls back to the name", async ({ page }) => {
  const b = residentBackend({ labels: SPORTS });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => barLabels(page)).toEqual(["Commons", "Events", "Sports", "My Home"]);
  await expect(page.locator("#tabbar a[data-tab=bookings] span")).toHaveAttribute("dir", "auto");
  await expect(page.locator("#cards h2")).toHaveText(["What's On", "Island Sports", "Pets of Jubail", "The Community"]);

  await page.goto("bookings/");
  await expect(page.locator("h1")).toHaveText("Island Sports");
  await expect(page).toHaveTitle(/^Island Sports — /);
  await expect(page.locator(".subtabs")).toHaveAttribute("aria-label", "Sports");

  await page.goto("events/");
  await expect(page.locator("h1")).toHaveText("What's On");
  await expect(page).toHaveTitle(/^What's On — /);

  await page.locator("#langBtn").click();                       // Arabic: no AR title for Sports → its AR name
  await expect.poll(() => barLabels(page)).toEqual(["كومنز", "الفعاليات", "الرياضة", "منزلي"]);
  await expect(page.locator("h1")).toHaveText("ما الجديد");
  await page.goto("bookings/");
  await expect(page.locator("h1")).toHaveText("الرياضة");
});

test("Help sheet and Settings use the section name", async ({ page }) => {
  const b = residentBackend({ labels: SPORTS });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("bookings/");
  await page.locator("#jcHelpBtn").click();
  await expect(page.locator("#jcHelp h2")).toHaveText("Sports");
  await page.goto("home/?tab=account");
  await expect(page.locator('#shellSec li[data-dest="bookings"] .nm')).toHaveText("Sports");
  await expect(page.locator('label[for="start-bookings"], #shellSec .starts label').filter({ hasText: "Sports" })).toHaveCount(1);
});

test("module off: the page says so without naming the section", async ({ page }) => {
  const b = residentBackend({ labels: SPORTS, modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("bookings/");
  await expect(page.locator("h1")).toHaveText("Island Sports");
  await expect(page.locator("#bkOff")).toHaveText("This section isn't open yet in your community.");
});

test("config fails on a later page: the last names this browser saw, never the old ones", async ({ page }) => {
  const b = residentBackend({ labels: SPORTS });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => barLabels(page)).toContain("Sports");
  b.st.configFails = true;
  await page.goto("bookings/");
  await expect(page).toHaveTitle(/^Island Sports — /);
});

test("a renamed community, then names cleared: the built-in labels come back", async ({ page }) => {
  const b = residentBackend({ labels: SPORTS });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await expect.poll(() => barLabels(page)).toContain("Sports");
  b.st.labels = {};
  await page.reload();
  await expect.poll(() => barLabels(page)).toEqual(["Commons", "Events", "Courts", "My Home"]);
});

// The caps (EN 14 / AR 18) must fit a full 5-button bar on a 360 px phone: no label cut off or spilling out of
// its button, at most two lines. Worst cases: two long words, and one long word with no place to break.
for (const [lang, names] of [
  ["en", { events: "Island Happens", bookings: "Racquet Sports" }],
  ["en", { events: "Neighbourhoods", bookings: "Sportsfacility" }],
  ["ar", { events: "فعاليات جبيل كلها", bookings: "ملاعب الجبيل الأول" }],
]) {
  test(`longest names fit the bar at 360 px (${lang}: ${names.events} / ${names.bookings})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const labels = {
      events: { name: { en: lang === "en" ? names.events : "Events2", ar: lang === "ar" ? names.events : "فعاليات" } },
      bookings: { name: { en: lang === "en" ? names.bookings : "Courts2", ar: lang === "ar" ? names.bookings : "ملاعب" } },
    };
    const me = Object.assign({}, MEMBER, { admin_scopes: ["community"],
      account: Object.assign({}, MEMBER.account, { prefs: { shell: { v: 1, tabs: ["commons", "events", "bookings", "admin"], start: "commons", known: ["commons", "events", "bookings", "admin", "pets", "community"] } } }) });
    const b = residentBackend({ labels });
    b.rpc.jc_me_get = (a, c) => (c.signedIn ? ok(me) : raise("NOT_SIGNED_IN"));
    await stubBackend(page, { rpc: b.rpc });
    if (lang === "ar") await page.addInitScript(() => localStorage.setItem("jc_lang", "ar"));
    await signIn(page);
    await expect(page.locator("#tabbar a")).toHaveCount(5);
    const m = await page.locator("#tabbar a").evaluateAll((as) => as.map((a) => {
      const s = a.querySelector("span"), r = s.getBoundingClientRect(), ar = a.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(s).lineHeight) || 13.2;
      return { t: s.textContent, lines: Math.round(r.height / lh),
               spill: r.left < ar.left - 0.5 || r.right > ar.right + 0.5 || s.scrollWidth > s.clientWidth + 1,
               off: ar.left < -0.5 || ar.right > 360.5 };   // pushed off a 360 px screen (innerWidth grows with the overflow)
    }));
    const pad = await page.evaluate(() => [parseFloat(getComputedStyle(document.body).paddingBottom), document.getElementById("tabbar").offsetHeight]);
    expect(pad[0], "the page keeps clear of the bar").toBeGreaterThanOrEqual(pad[1]);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/bar-${lang}-${names.bookings.length}-${names.events.replace(/\W/g, "")}.png` });
    for (const x of m) {
      expect(x.spill, `"${x.t}" spills out of its button`).toBe(false);
      expect(x.off, `"${x.t}" is pushed off the screen`).toBe(false);
      expect(x.lines, `"${x.t}" takes ${x.lines} lines`).toBeLessThanOrEqual(2);
    }
  });
}

// ---------- Organizer Tools → Community → Section Names ----------
function namesBackend(opts = {}) {
  const ab = adminBackend({ scopes: opts.scopes || ["community"] });
  const st = Object.assign(ab.st, { labels: opts.labels || {}, fail: null });
  const rpc = Object.assign({}, ab.rpc, {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { modules: ON, labels: st.labels })),
    jc_admin_module_label_set: (a) => {
      if (!st.scopes.includes("community")) return raise("NOT_ADMIN");
      if (st.fail) return raise(st.fail);
      const e = {};
      if (a.p_name_en) e.name = { en: a.p_name_en, ar: a.p_name_ar };
      if (a.p_title_en || a.p_title_ar) e.title = Object.assign({}, a.p_title_en ? { en: a.p_title_en } : {}, a.p_title_ar ? { ar: a.p_title_ar } : {});
      st.labels = Object.assign({}, st.labels);
      if (Object.keys(e).length) st.labels[a.p_module] = e; else delete st.labels[a.p_module];
      return ok(st.labels);
    },
  });
  return { st, rpc };
}
async function openNames(page) {
  await page.goto("admin/?tab=community");
  await page.locator("#mnOpen").click();
  await expect(page.locator("h1")).toHaveText("Section Names");
}

test("community admin renames Courts: exact RPC, bar + tab follow at once, counter, Reset", async ({ page }) => {
  const b = namesBackend();
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openNames(page);
  await expect(page.locator("form[data-mn]")).toHaveCount(4);
  const f = page.locator('form[data-mn="bookings"]');
  await expect(f.locator("[data-mnreset]")).toHaveCount(0);
  await expect(f.locator('[data-f="name_en"]')).toHaveAttribute("maxlength", "14");
  await expect(f.locator('[data-f="name_ar"]')).toHaveAttribute("maxlength", "18");
  await f.locator('[data-f="name_en"]').fill("Sports");
  await expect(f.locator('[data-count="name_en"]')).toHaveText("6/14");
  await f.locator('[data-f="name_ar"]').fill("الرياضة");
  await f.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#msg")).toHaveText("Saved. Everyone sees “Sports” the next time they open Commons.");
  expect(lastCall(calls, "jc_admin_module_label_set").args).toEqual(
    { p_module: "bookings", p_name_en: "Sports", p_name_ar: "الرياضة", p_title_en: "", p_title_ar: "" });
  await expect(page.locator("#tabbar a[data-tab=bookings] span")).toHaveText("Sports");
  await expect(page.locator('form[data-mn="bookings"] [data-f="name_en"]')).toHaveValue("Sports");

  await page.locator('form[data-mn="bookings"] [data-mnreset]').click();
  await expect(page.locator("#tabbar a[data-tab=bookings] span")).toHaveText("Courts");
  expect(lastCall(calls, "jc_admin_module_label_set").args).toEqual(
    { p_module: "bookings", p_name_en: "", p_name_ar: "", p_title_en: "", p_title_ar: "" });
  await expect(page.locator('form[data-mn="bookings"] [data-mnreset]')).toHaveCount(0);
});

test("a refused name says why and keeps what was typed; a language switch keeps it too", async ({ page }) => {
  const b = namesBackend();
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openNames(page);
  b.st.fail = "RESERVED_NAME";
  const f = () => page.locator('form[data-mn="pets"]');
  await f().locator('[data-f="name_en"]').fill("Account");
  await f().locator('[data-f="name_ar"]').fill("حسابي");
  await f().getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#msg")).toHaveText("That name is already used elsewhere in the app. Choose another.");
  await expect(f().locator('[data-f="name_en"]')).toHaveValue("Account");
  await page.locator("#langBtn").click();
  await expect(f().locator('[data-f="name_ar"]')).toHaveValue("حسابي");
  await expect(f().locator('[data-f="name_ar"]')).toHaveAttribute("dir", "rtl");
});

test("renamed sections in Organizer Tools: tab, scope line, Admins heading", async ({ page }) => {
  const b = namesBackend({ labels: SPORTS });
  b.rpc.jc_module_admins_list = (a) => ok({ scope: a.p_scope, admins: [], links: [] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await expect(page.locator("#atab-courts")).toHaveText("Sports");
  await page.locator("#adOpen").click();
  await expect(page.locator("h2.group")).toHaveText(["Community admins", "Event organizers", "Sports admins"]);
});

test("Section Names is for community admins only", async ({ page }) => {
  const b = namesBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await expect(page.locator("#atab-community")).toBeVisible();
  await expect(page.locator("#mnOpen")).toHaveCount(0);
});
