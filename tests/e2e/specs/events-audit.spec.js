// R2a — Events audit fixes (docs/qa/events-qa-2026-11-06.md): an ended event sits in Past with no sign-up or
// withdraw (D2), event day follows the server's end (ends_effective), a hidden household is told (U1),
// treat-night templates run all three tools (F1), publishing a homes event needs its date (F2), App Health
// shows the "ended — closes automatically" notice (D2), organizers can tie the banner to an event (U3).
const { test, expect } = require("@playwright/test");
const { stubBackend, ok } = require("./stub");
const { eventsBackend, adminBackend, dayBackend, signIn, LIVE, LIVE_ID, DAY_ID, ADMIN_DRAFT_ID, ADMIN_LIVE_ID } = require("./backends");

const lastCall = (calls, name) => calls.filter((c) => c.name === name).slice(-1)[0];
const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();

test("list: an ended event leads Past, says 'ended', and offers no Sign Up", async ({ page }) => {
  const ended = Object.assign({}, LIVE, { id: "ended-1", slug: "fireworks", title_en: "Fireworks", starts_at: hourAgo(),
    ended: true, ends_effective: hourAgo(), homes_in: 12, my_status: null });
  const upcoming = Object.assign({}, LIVE, { ended: false, homes_in: 3, my_status: null });
  await stubBackend(page, { rpc: { jc_events_list: () => ok([ended, upcoming]) } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator(".evlist").first().locator("li")).toHaveCount(1);
  await expect(page.locator(".evlist").first()).toContainText("National Day Gathering");
  await expect(page.locator("h2.group")).toHaveText("Past");
  const card = page.locator('[data-event="fireworks"]');
  await expect(card).toContainText("ended");
  await expect(card.locator(".evacts a")).toHaveText(["View"]);   // no Sign Up after the end
});

test("event page: after the end a signed-up household sees 'ended' — no Update, no Withdraw", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null } });
  const base = eb.rpc.jc_event_get;
  const { calls } = await stubBackend(page, { rpc: Object.assign({}, eb.rpc, {
    jc_event_get: async (a) => {
      const r = await base(a);
      r.body.event = Object.assign({}, r.body.event, { ended: true, ends_effective: hourAgo() });
      return r;
    } }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#evsub")).toContainText("ended");
  await expect(page.locator("#cta")).toContainText("This event has ended — sign-ups are closed.");
  await expect(page.locator("#withdraw")).toHaveCount(0);
  await expect(page.locator("#toSignup")).toHaveCount(0);
  expect(calls.some((c) => c.name === "jc_entry_withdraw")).toBe(false);
});

test("event day ends when the server says the event ended, even if ends_at says later", async ({ page }) => {
  const db = dayBackend({ event: { ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
    ends_effective: new Date(Date.now() - 60e3).toISOString(), ended: true } });
  await stubBackend(page, { rpc: db.rpc });
  await signIn(page);
  await page.goto("events/?id=" + DAY_ID + "&tab=mine");
  await expect(page.locator("#evsub")).toContainText("ended");
  await expect(page.locator("#live")).toHaveCount(0);           // no switch / supply after the end
});

for (const [flag, what] of [["hidden", "an organizer hid the sign-up"], ["home_hidden", "the home is hidden from the directory"]]) {
  test(`My Sign-Up tells the household its home isn't on the map (${what})`, async ({ page }) => {
    const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null,
      hidden: flag === "hidden", home_hidden: flag === "home_hidden" } });
    await stubBackend(page, { rpc: eb.rpc });
    await signIn(page);
    await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
    await expect(page.locator("#cta .notshown")).toHaveText("Your home isn't shown on the map, so neighbors won't see it.");
  });
}

test("My Sign-Up: a household on the map sees no 'not shown' line", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null,
    hidden: false, home_hidden: false } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#withdraw")).toBeVisible();
  await expect(page.locator("#cta .notshown")).toHaveCount(0);
});

test("Arabic: the ended line and the not-shown line are translated; the page is RTL", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null, hidden: true } });
  const base = eb.rpc.jc_event_get;
  await stubBackend(page, { rpc: Object.assign({}, eb.rpc, {
    jc_event_get: async (a) => { const r = await base(a); r.body.event = Object.assign({}, r.body.event, { ended: true }); return r; } }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#cta .notshown")).toBeVisible();
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#cta")).toContainText("انتهت هذه الفعالية — التسجيل مغلق.");
  await expect(page.locator("#cta .notshown")).toHaveText("منزلك غير ظاهر على الخريطة، لذا لن يراه الجيران.");
});

for (const tpl of ["halloween", "haq_al_laila"]) test(`the ${tpl} template ticks the switch, supply and crowd reports`, async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator(`[data-tpl="${tpl}"]`).click();
  for (const f of ["giant_switch", "supply", "crowd_reports"]) await expect(page.locator("#f_" + f)).toBeChecked();
});

test("'Use the Halloween questions' also ticks all three event-day tools", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await page.locator("#useHalloween").click();
  for (const f of ["giant_switch", "supply", "crowd_reports"]) await expect(page.locator("#f_" + f)).toBeChecked();
});

test("publishing a homes event without a date says what's missing and never asks the server", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], draftUndated: true });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="national-day-2026"] [data-act="publish"]').click();
  await expect(page.locator("#msg")).toHaveText("Before you can publish, add: Starts. Tap Edit to finish it.");
  expect(calls.some((c) => c.name === "jc_admin_event_publish")).toBe(false);
});

test("a live homes event can't lose its date in the editor (NO_DATE, nothing sent)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#starts_at").fill("");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("A homes event needs its start date — event day and its end depend on it.");
  await expect(page.locator("#starts_at")).toHaveAttribute("aria-invalid", "true");
  expect(calls.some((c) => c.name === "jc_admin_event_save")).toBe(false);
});

test("a server NO_DATE (e.g. another organizer cleared it) is said in words", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_event_publish: () => ({ status: 400, body: { code: "P0001", message: "NO_DATE" } }) }) });
  await signIn(page);
  await page.goto("admin/");
  page.once("dialog", (d) => d.accept());
  await page.locator('li[data-event="national-day-2026"] [data-act="publish"]').click();
  await expect(page.locator("#msg")).toHaveText("A homes event needs its start date — event day and its end depend on it.");
});

test("Organizer Tools: an ended event says when it closes automatically", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const ev = ab.st.events.find((e) => e.id === ADMIN_LIVE_ID);
  Object.assign(ev, { ended: true, ends_effective: "2026-11-06T06:50:00Z" });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('li[data-event="test-event"] small')).toContainText("Ended · closes automatically 7 Nov, 10:50");
});

test("App Health: 'ended — closes automatically' and 'couldn't close' notices name the event, not a home", async ({ page }) => {
  const notices = [
    { id: 21, kind: "event_ended", created_at: "2026-11-06T07:25:00Z", home: null,
      detail: { event_id: "e-1", slug: "halloween-test", title: "Halloween <b>Test</b>", closes_at: "2026-11-07T06:50:00Z" } },
    { id: 22, kind: "autoclose_failed", created_at: "2026-11-07T07:25:00Z", home: null,
      detail: { event_id: "e-2", slug: "fireworks", error: "BOOM" } },
  ];
  const ab = adminBackend({ scopes: ["community"], owner: true, notices });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await page.locator("#healthOpen").click();
  const li = page.locator(".fblist li");
  await expect(li.nth(0).locator(".fbkind")).toHaveText("Halloween <b>Test</b>");   // text, never markup
  await expect(li.nth(0)).toContainText("It has ended. It closes automatically 7 Nov, 10:50 and its numbers are saved.");
  await expect(li.nth(0).locator("[data-nhome]")).toHaveCount(0);                     // no home to open
  await expect(li.nth(1).locator(".fbkind")).toHaveText("fireworks");
  await expect(li.nth(1)).toContainText("It couldn't close automatically. Close it from Organizer Tools → Events.");
});

test("banner: an organizer ties it to a live event (one call with the event), or posts it untied", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  // live events only (the draft isn't offered)
  await expect(page.locator("#bannerEvent option")).toHaveText(["No — keep it up until I clear it", "Test Event"]);
  await page.locator("#bannerText").fill("Parking on the north road tonight");
  await page.locator("#bannerEvent").selectOption(ADMIN_LIVE_ID);
  page.once("dialog", (d) => d.accept());
  await page.locator("#bannerSave").click();
  await expect(page.locator("#msg")).toHaveText("Banner posted. It comes down when that event closes.");
  expect(lastCall(calls, "jc_admin_broadcast_set_event").args)
    .toEqual({ p_text: "Parking on the north road tonight", p_event: ADMIN_LIVE_ID });
  expect(calls.some((c) => c.name === "jc_admin_broadcast_set")).toBe(false);
  expect(ab.st.broadcastEvent).toBe(ADMIN_LIVE_ID);
  // untied: the old call, unchanged
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerText").fill("Pool closed Friday");
  page.once("dialog", (d) => d.accept());
  await page.locator("#bannerSave").click();
  await expect(page.locator("#msg")).toHaveText("Banner posted.");
  expect(lastCall(calls, "jc_admin_broadcast_set").args).toEqual({ p_text: "Pool closed Friday" });
});

test("banner: event admins (not organizers) get no tie choice", async ({ page }) => {
  const ab = adminBackend({ scopes: [], adminEvents: [ADMIN_LIVE_ID] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await expect(page.locator("#bannerText")).toBeVisible();
  await expect(page.locator("#bannerEvent")).toHaveCount(0);
});

test("admin log: tying the banner reads in words", async ({ page }) => {
  // the R1 log screen maps actions through LOG_KEYS; broadcast_tie must not fall back to its raw name
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_homes_list: () => ok({ homes: [], pending: [] }),
    jc_admin_log_list: () => ok([{ at: "2026-11-06T08:00:00Z", actor: "Zee", action: "broadcast_tie", target: { event_id: ADMIN_DRAFT_ID } }]) }) });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await page.locator("#hhOpen").click();
  await page.locator("#logOpen").click();
  await expect(page.locator(".fblist li").first()).toContainText("Tied the banner to an event");
});
