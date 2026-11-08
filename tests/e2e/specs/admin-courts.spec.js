// R4b-1b — Organizer tools → Courts (server S3 + R4a): who sees the tab, the list (status, upcoming, walk-on),
// add / edit (only changed fields; the grid locked while bookings exist), Publish / Unpublish / Retire with the
// bookings they cancel. Plan: docs/plans/R4b-1-admins-courts.md + docs/plans/R4-courts.md (R4b-1 row).
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, raise } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const COURT = (o) => Object.assign({ id: "c1", kind: "tennis", name_en: "Court 1", name_ar: null, location_note: null,
  lat: 24.5301, lng: 54.4312, status: "draft", open_time: "07:00:00", close_time: "22:00:00", slot_minutes: 60,
  window_days: 7, sort: 0, walk_on: false, upcoming: 0 }, o);

// adminBackend + the courts admin RPCs (jc_assert_admin('bookings') = bookings or community)
function backend(opts = {}) {
  const ab = adminBackend({ scopes: opts.scopes || ["community"] });
  const st = ab.st;
  st.courts = (opts.courts || []).map((c) => Object.assign({}, c));
  let n = 0;
  const allowed = () => st.scopes.includes("bookings") || st.scopes.includes("community");
  const list = () => ok(st.courts.map((c) => Object.assign({}, c)));
  const rpc = Object.assign({}, ab.rpc, {
    jc_admin_facilities_list: () => (opts.listFails ? raise("NETWORK_X") : allowed() ? list() : raise("NOT_ADMIN")),
    jc_admin_booking_rules: () => (allowed() ? ok({ enabled: !!opts.enabled, per_home_per_day: 1, per_home_active: 2,
      configured: {}, retention_days: 90, defaults: { window_days: 7, slot_minutes: 60 } }) : raise("NOT_ADMIN")),
    jc_admin_facility_save: (a) => {
      if (!allowed()) return raise("NOT_ADMIN");
      if (opts.saveError) return raise(opts.saveError);
      if (a.p_facility === null) {
        n += 1;
        st.courts.push(COURT(Object.assign({ id: "new-" + n }, a.p_fields)));
      } else Object.assign(st.courts.find((c) => c.id === a.p_facility), a.p_fields);
      return list();
    },
    jc_admin_facility_status: (a) => {
      if (!allowed()) return raise("NOT_ADMIN");
      const c = st.courts.find((x) => x.id === a.p_facility);
      if (!c) return raise("NOT_FOUND");
      const okMove = (c.status === "draft" && ["published", "retired"].includes(a.p_status)) ||
                     (c.status === "published" && ["draft", "retired"].includes(a.p_status));
      if (!okMove) return raise("BAD_STATE");
      c.status = a.p_status;
      if (a.p_status !== "published") c.upcoming = 0;
      return list();
    },
  });
  return { st, rpc };
}

async function openCourts(page) {
  await page.goto("admin/?tab=courts");
  await expect(page.locator("#ctNew")).toBeVisible();
}

test("who sees Courts: community + courts admins; an events organizer doesn't", async ({ page }) => {
  const b = backend({ scopes: ["events"] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('[role="tab"]')).toHaveText(["Events", "Banner", "Community"]);
  b.st.scopes = ["bookings"];
  await page.goto("admin/?tab=courts");
  await expect(page.locator('[role="tab"]')).toHaveText(["Courts", "Community"]);
  await expect(page.locator("#ctOff")).toContainText("Courts are switched off for residents");
  await expect(page.locator("#ctRules")).toHaveText("Each home can book 1 slot a day and hold 2 upcoming bookings. Bookings are kept 90 days, then only hourly totals remain.");
  b.st.scopes = ["community"];
  await page.goto("admin/?tab=courts");
  await expect(page.locator('[role="tab"]')).toHaveText(["Events", "Banner", "Courts", "Community"]);
});

test("list: status, pin, hours, upcoming; walk-on shows no grid; retired apart with no actions", async ({ page }) => {
  const b = backend({ enabled: true, courts: [
    COURT({ status: "published", upcoming: 3 }),
    COURT({ id: "c2", name_en: "Hoops", kind: "basketball", walk_on: true, lat: null, lng: null }),
    COURT({ id: "c3", name_en: "Old", status: "retired" }) ] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await expect(page.locator("#ctOff")).toHaveCount(0);
  const c1 = page.locator('[data-court="c1"]');
  await expect(c1).toContainText("Published");
  await expect(c1).toContainText("Tennis · ⁦07:00–22:00⁩ · 60-minute slots · 7 days ahead");
  await expect(c1).toContainText("Upcoming bookings: 3");
  await expect(c1.locator("[data-ct]")).toHaveText(["Edit", "Unpublish", "Retire"]);
  const c2 = page.locator('[data-court="c2"]');
  await expect(c2).toContainText("Walk-on");
  await expect(c2).toContainText("No pin");
  await expect(c2).not.toContainText("Upcoming bookings");
  await expect(c2.locator("[data-ct]")).toHaveText(["Edit", "Publish", "Retire"]);
  await expect(page.locator("h2.group")).toHaveText(["Courts", "Retired"]);
  await expect(page.locator('[data-court="c3"] [data-ct]')).toHaveCount(0);
  if (process.env.SHOT_DIR) {                     // /shot-style look (no courts stubs in the shot harness yet)
    await page.screenshot({ path: process.env.SHOT_DIR + "/courts-list.png", fullPage: true });
    await page.locator('[data-ct="edit"][data-id="c1"]').click();
    await expect(page.locator("#ctLocked")).toBeVisible();
    await page.screenshot({ path: process.env.SHOT_DIR + "/courts-editor.png", fullPage: true });
  }
});

test("new court: checks first (nothing sent), then the exact fields incl. the pin; back on the list", async ({ page }) => {
  const b = backend();
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator("#ctNew").click();
  await expect(page.locator("h1")).toHaveText("New Court");
  await expect(page.locator("#ctPinState")).toHaveText("Not pinned yet — residents won't see it on the map.");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Give the court an English name.");
  await page.locator("#ct_name_en").fill("  Court 2 ");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Choose the kind of court.");
  await page.locator('input[name="ct_kind"][value="basketball"]').check();
  await page.locator("#ct_open").fill("21:30");
  await page.locator("#ct_close").fill("22:00");
  await page.locator("#ct_slot").selectOption("60");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Closing has to be after opening, with room for at least one slot.");
  await page.locator("#ct_open").fill("08:00");
  await page.locator("#ct_window").fill("31");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Days ahead: a whole number from 1 to 30.");
  expect(calls.some((c) => c.name === "jc_admin_facility_save")).toBe(false);
  await page.locator("#ct_window").fill("14");
  await page.locator("#ct_note").fill("Behind the clubhouse");
  await page.locator("#ctPinHere").click();
  await expect(page.locator("#ctPinState")).toHaveText("Court pinned.");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const sent = lastCall(calls, "jc_admin_facility_save").args;
  expect(sent.p_facility).toBeNull();
  expect(Object.keys(sent.p_fields).sort()).toEqual(["close_time", "kind", "lat", "lng", "location_note", "name_ar", "name_en",
    "open_time", "slot_minutes", "walk_on", "window_days"]);
  expect(sent.p_fields).toMatchObject({ name_en: "Court 2", kind: "basketball", location_note: "Behind the clubhouse",
    open_time: "08:00", close_time: "22:00", slot_minutes: 60, window_days: 14, walk_on: false });
  expect(typeof sent.p_fields.lat).toBe("number");
  expect(new URL(page.url()).search).toBe("?tab=courts");
  await expect(page.locator('[data-court="new-1"]')).toContainText("Draft");
});

test("edit sends only what changed; saving untouched sends nothing", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await expect(page.locator("#ct_name_en")).toHaveValue("Court 1");
  await expect(page.locator("#ct_open")).toHaveValue("07:00");
  await expect(page.locator("#ctPinState")).toHaveText("Court pinned.");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(calls.some((c) => c.name === "jc_admin_facility_save")).toBe(false);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await page.locator("#ct_name_ar").fill("ملعب ١");
  await page.locator("#ct_window").fill("10");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_facility_save").args).toEqual({ p_facility: "c1", p_fields: { name_ar: "ملعب ١", window_days: 10 } });
});

test("upcoming bookings lock the grid and walk-on (server RULES_LOCKED explained too)", async ({ page }) => {
  const b = backend({ courts: [COURT({ status: "published", upcoming: 3 })], saveError: "RULES_LOCKED" });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await expect(page.locator("#ctLocked")).toHaveText("3 upcoming bookings: the hours, slot length and walk-on can't change until they're over or cancelled.");
  for (const id of ["#ct_open", "#ct_close", "#ct_slot", "#ct_walk_on"]) await expect(page.locator(id)).toBeDisabled();
  await page.locator("#ct_name_en").fill("Court One");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("This court has upcoming bookings, so its hours, slot length and walk-on can't change yet.");
});

test("walk-on hides the slot length and days ahead", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await expect(page.locator("#ct_slot")).toBeVisible();
  await page.locator("#ct_walk_on").check();
  await expect(page.locator("#ct_slot")).toBeHidden();
  await expect(page.locator("#ct_window")).toBeHidden();
});

test("publish / unpublish / retire ask first and say what bookings they cancel", async ({ page }) => {
  const b = backend({ courts: [COURT(), COURT({ id: "c2", name_en: "Court 2", status: "published", upcoming: 4 })] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('[data-ct="published"][data-id="c1"]').click();
  await expect.poll(() => asked).toBe("Publish Court 1? Residents will see it and can book it.");
  expect(calls.some((c) => c.name === "jc_admin_facility_status")).toBe(false);   // dismissed = nothing sent

  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator('[data-ct="draft"][data-id="c2"]').click();
  await expect(page.locator("#msg")).toHaveText("Back to draft.");
  expect(asked).toBe("Unpublish Court 2? It goes back to draft and residents stop seeing it. Its 4 upcoming bookings, and any slot being played right now, will be cancelled; those homes will see \"Court temporarily unavailable\".");
  expect(lastCall(calls, "jc_admin_facility_status").args).toEqual({ p_facility: "c2", p_status: "draft" });

  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator('[data-ct="retired"][data-id="c1"]').click();
  await expect(page.locator("#msg")).toHaveText("Retired.");
  expect(asked).toBe("Retire Court 1? This can't be undone.");
  await expect(page.locator('[data-court="c1"] [data-ct]')).toHaveCount(0);
});

test("a stale status change (BAD_STATE) re-reads the list and says so", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  b.st.courts[0].status = "published";                                    // changed elsewhere
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-ct="published"][data-id="c1"]').click();
  await expect(page.locator("#msg")).toHaveText("That court changed in the meantime. The list is up to date.");
  await expect(page.locator('[data-court="c1"]')).toContainText("Published");
  expect(calls.filter((c) => c.name === "jc_admin_facilities_list").length).toBe(2);
});

test("the form survives a language switch", async ({ page }) => {
  const b = backend();
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator("#ctNew").click();
  await page.locator("#ct_name_en").fill("Court 9");
  await page.locator('input[name="ct_kind"][value="tennis"]').check();
  await page.locator("#ct_walk_on").check();
  await page.locator("#ctPinHere").click();
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("ملعب جديد");
  await expect(page.locator("#ct_name_en")).toHaveValue("Court 9");
  await expect(page.locator('input[name="ct_kind"][value="tennis"]')).toBeChecked();
  await expect(page.locator("#ct_walk_on")).toBeChecked();
  await expect(page.locator("#ctPinState")).toHaveText("تم تثبيت الملعب.");
});

test("a list that can't be read says so, with Try Again", async ({ page }) => {
  const b = backend({ listFails: true });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await expect(page.locator("#ctRetry")).toBeVisible();
  await expect(page.locator("#msg")).toHaveText("Something went wrong. Try again in a moment.");
});

test("hostile court names stay text", async ({ page }) => {
  const b = backend({ courts: [COURT({ name_en: '<img src=x onerror="window.__x=1">' })] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await expect(page.locator('[data-court="c1"] b')).toHaveText('<img src=x onerror="window.__x=1">');
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: the Courts tab and the court editor`, async ({ page }) => {
    const b = backend({ courts: [COURT({ status: "published", upcoming: 2 })] });
    await stubBackend(page, { rpc: b.rpc });
    await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, lang);
    await signIn(page);
    await openCourts(page);
    const clean = async () => {
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((x) => x.target.join(" ")).join(" | ")}`);
    };
    expect(await clean()).toEqual([]);
    await page.locator('[data-ct="edit"][data-id="c1"]').click();
    await expect(page.locator("#ct_name_en")).toBeVisible();
    expect(await clean()).toEqual([]);
  });
}

// ── review fixes (docs/qa/R4b-1b-review-2026-11-08.md) ──
test("security L3: a published court with no upcoming bookings still warns about a slot being played now", async ({ page }) => {
  const b = backend({ courts: [COURT({ status: "published", upcoming: 0 })] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('[data-ct="retired"][data-id="c1"]').click();
  await expect.poll(() => asked).toBe("Retire Court 1? This can't be undone. Any slot being played right now will be cancelled too.");
});

test("code review M1: a save that lands after leaving the editor still updates the list", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_admin_facility_save: async (a, c) => { await gate; return b.rpc.jc_admin_facility_save(a, c); } });
  await stubBackend(page, { rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await page.locator("#ct_name_en").fill("Centre Court");
  await page.locator("#ctSave").click();
  await page.locator("#jcBackBtn").click();                               // leave before the answer
  await expect(page.locator('[data-court="c1"] b')).toHaveText("Court 1");
  release();
  await expect(page.locator('[data-court="c1"] b')).toHaveText("Centre Court");
});

test("code review M2: a walk-on court never fails on the hidden slot / days ahead", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await page.locator("#ct_window").fill("");
  await page.locator("#ct_walk_on").check();
  await page.locator("#ct_open").fill("07:00");
  await page.locator("#ct_close").fill("07:20");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Closing has to be at least 30 minutes after opening.");
  await page.locator("#ct_close").fill("07:30");
  await page.locator("#ctSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_facility_save").args.p_fields).toEqual({ walk_on: true, close_time: "07:30", slot_minutes: 30 });
});

test("language switch keeps hours, slot and a blank days-ahead exactly", async ({ page }) => {
  const b = backend({ courts: [COURT()] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openCourts(page);
  await page.locator('[data-ct="edit"][data-id="c1"]').click();
  await page.locator("#ct_open").fill("06:30");
  await page.locator("#ct_slot").selectOption("90");
  await page.locator("#ct_window").fill("");
  await page.locator("#langBtn").click();
  await expect(page.locator("#ct_open")).toHaveValue("06:30");
  await expect(page.locator("#ct_slot")).toHaveValue("90");
  await expect(page.locator("#ct_window")).toHaveValue("");
});
