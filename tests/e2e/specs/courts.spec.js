// R4c — residents book a court (server S3 + R4a). Plan: docs/plans/R4c-residents-book.md.
// The phone runs in London; the community is Asia/Dubai (+4). PRIVACY: another home's Private booking arrives with
// no home from the server, and the page must show exactly "Booked" for it.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_HOME } = require("./stub");
const { signIn } = require("./backends");

test.use({ timezoneId: "Europe/London" });

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const at = (day, h) => new Date(Date.parse(day + "T00:00:00Z") + (h - 4) * 3600e3).toISOString();
const D = "2026-11-10";
const T_MORNING = Date.parse("2026-11-10T06:30:00Z");   // 10:30 in Dubai
const T_NIGHT = Date.parse("2026-11-09T22:30:00Z");     // 02:30 on the 10th in Dubai; the 9th in London
const C1 = "11111111-aaaa-4aaa-8aaa-000000000001";
const C2 = "11111111-aaaa-4aaa-8aaa-000000000002";
const COURT = (o) => Object.assign({ id: C1, kind: "tennis", name_en: "Court 1", name_ar: "ملعب ١", location_note: "By the beach park",
  lat: 24.5301, lng: 54.4312, open_time: "07:00:00", close_time: "22:00:00", slot_minutes: 60, window_days: 7, walk_on: false }, o);
const V40 = { village: "seef-al-jubail", type: "villa", building: null, number: "40" };

function backend(opts = {}) {
  const now = opts.now || T_MORNING;
  const st = {
    enabled: opts.enabled !== false,
    me: opts.me || MEMBER,
    courts: opts.courts || [COURT(), COURT({ id: C2, name_en: "Hoops", name_ar: null, kind: "basketball", walk_on: true, lat: null, lng: null, location_note: null })],
    // other homes' bookings: { starts, home | null (private / hidden), court }
    others: (opts.others || []).map((x) => Object.assign({ court: C1 }, x)),
    blocks: (opts.blocks || []).map((x) => Object.assign({ court: C1 }, x)),
    mine: (opts.mine || []).map((x) => Object.assign({ court: C1, status: "booked", is_private: false, cancel_reason: null }, x)),
  };
  let n = 0;
  const myList = () => st.mine.filter((b) => b.status === "booked" || b.cancel_reason).map((b) => ({
    id: b.id, facility_id: b.court, facility: "Court 1", facility_ar: "ملعب ١", starts_at: b.starts,
    ends_at: new Date(Date.parse(b.starts) + 3600e3).toISOString(), status: b.status, is_private: b.is_private, cancel_reason: b.cancel_reason }));
  const day = (court, date) => {
    const out = [];
    for (let h = 7; h < 22; h++) {
      const s = at(date, h), e = at(date, h + 1);
      const bl = st.blocks.find((x) => x.court === court && x.starts < e && x.ends > s);
      const m = st.mine.find((x) => x.court === court && x.starts === s && x.status === "booked");
      const o = st.others.find((x) => x.court === court && x.starts === s);
      out.push({ starts_at: s, ends_at: e,
        state: bl ? "blocked" : m ? "mine" : o ? "booked" : Date.parse(s) <= now ? "past" : "free",
        booking_id: m ? m.id : null, home: o && !bl ? o.home : null, is_private: m ? m.is_private : null,
        block_id: null, block_reason: bl ? bl.reason : null });
    }
    return out;
  };
  const off = () => (st.enabled ? null : raise("MODULE_OFF"));
  const rpc = {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { tz: "Asia/Dubai",
      modules: { events: { enabled: false }, bookings: { enabled: st.enabled }, pets: { enabled: false } } })),
    jc_me_get: (a, c) => (c.signedIn ? ok(st.me) : raise("NOT_SIGNED_IN")),
    jc_facilities_list: () => off() || ok(st.courts.map((c) => Object.assign({}, c))),
    jc_my_bookings: () => off() || ok(st.me.home ? myList() : []),
    jc_facility_day: (a) => {
      if (off()) return off();
      if (!st.me.home) return raise("NO_HOME");
      const c = st.courts.find((x) => x.id === a.p_facility);
      if (!c) return raise("NOT_FOUND");
      if (c.walk_on) return raise("WALK_ON");
      if (opts.dayError) return raise(opts.dayError);
      return ok({ facility_id: a.p_facility, date: a.p_date, slots: day(a.p_facility, a.p_date) });
    },
    jc_booking_book: (a) => {
      if (opts.bookError) return raise(opts.bookError);
      if (typeof a.p_private !== "boolean") return raise("BAD_FIELDS");
      n += 1;
      st.mine.push({ id: "new-" + n, court: a.p_facility, starts: a.p_starts, status: "booked", is_private: a.p_private, cancel_reason: null });
      const date = new Date(Date.parse(a.p_starts) + 4 * 3600e3).toISOString().slice(0, 10);
      return ok({ booking_id: "new-" + n, starts_at: a.p_starts, ends_at: new Date(Date.parse(a.p_starts) + 3600e3).toISOString(),
                  day: day(a.p_facility, date) });
    },
    jc_booking_cancel: (a) => {
      const b = st.mine.find((x) => x.id === a.p_booking && x.status === "booked");
      if (!b) return raise("NOT_FOUND");
      b.status = "cancelled";
      return ok(myList());
    },
    jc_booking_privacy_set: (a) => {
      const b = st.mine.find((x) => x.id === a.p_booking && x.status === "booked");
      if (!b) return raise("NOT_FOUND");
      b.is_private = a.p_private;
      return ok(myList());
    },
  };
  return { st, rpc };
}

async function open(page, b, opts = {}) {
  await page.clock.install({ time: opts.now || T_MORNING });
  if (opts.lang) await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, opts.lang);
  const stub = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("bookings/" + (opts.q || ""));
  return stub;
}
const row = (page, h) => page.locator("#bkSlots li", { has: page.locator(".time", { hasText: String(h).padStart(2, "0") + ":00–" }) });

test("list: the precedence line, my bookings, courts with hours; walk-on has no times; the tab is there", async ({ page }) => {
  const b = backend({ mine: [{ id: "m1", starts: at("2026-11-11", 18) }],
    others: [], blocks: [] });
  await open(page, b);
  await expect(page.locator("#bkPrecedence")).toHaveText("Official community-management bookings take precedence.");
  await expect(page.locator("#bkMine li")).toHaveCount(1);
  await expect(page.locator("#bkMine li")).toContainText("Court 1");
  await expect(page.locator("#bkMine li")).toContainText("Wed 11 Nov · ⁦18:00–19:00⁩");
  const c1 = page.locator(`[data-court="${C1}"]`);
  await expect(c1).toContainText("Tennis · ⁦07:00–22:00⁩");
  await expect(c1).toContainText("By the beach park");
  await expect(c1.locator("[data-open]")).toHaveText("See times");
  const c2 = page.locator(`[data-court="${C2}"]`);
  await expect(c2).toContainText("Walk-on: no booking needed.");
  await expect(c2.locator("[data-open]")).toHaveCount(0);
  await expect(page.locator("#bkmap")).toHaveCount(1);                              // one court has a pin
  await expect(page.locator('#tabbar a[data-tab="bookings"]')).toHaveAttribute("aria-current", "page");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/bk-list.png", fullPage: true });
});

test("a court's day: today in community time (phone still on yesterday), the window's days, times on the community clock", async ({ page }) => {
  const b = backend({ now: T_NIGHT });
  const { calls } = await open(page, b, { now: T_NIGHT });
  await page.locator(`[data-open="${C1}"]`).click();
  await expect(page.locator("#bkSlots")).toBeVisible();
  expect(lastCall(calls, "jc_facility_day").args).toEqual({ p_facility: C1, p_date: D });
  await expect(page.locator("#bkDays button")).toHaveCount(7);
  await expect(page.locator("#bkDays button").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bkDays button").first()).toHaveAttribute("aria-label", "Tuesday 10 November");
  await expect(page.locator("#bkDays button").last()).toHaveAttribute("data-day", "2026-11-16");
  await expect(page.locator("#bkSlots .time").first()).toHaveText("⁦07:00–08:00⁩");
  await page.locator('[data-day="2026-11-12"]').click();
  await expect.poll(() => lastCall(calls, "jc_facility_day").args.p_date).toBe("2026-11-12");
  await expect(page.locator('[data-day="2026-11-12"]')).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).toContain("?court=" + C1);
});

test("privacy: another home shows its label only when the server sends it; a Private one is exactly \"Booked\"", async ({ page }) => {
  const b = backend({ others: [{ starts: at(D, 14), home: V40 }, { starts: at(D, 15), home: null }],
    blocks: [{ starts: at(D, 18), ends: at(D, 20), reason: "Court blocked: Maintenance" }] });
  await open(page, b, { q: "?court=" + C1 });
  await expect(row(page, 14)).toContainText("Villa 40 · Seef Al Jubail");
  await expect(row(page, 15).locator(".chip")).toHaveText("Booked");
  expect((await row(page, 15).innerText()).replace(/\s+/g, " ").trim()).toBe("⁦15:00–16:00⁩ Booked");
  await expect(row(page, 15).locator("button")).toHaveCount(0);
  await expect(row(page, 18)).toContainText("Unavailable");
  await expect(row(page, 18)).toContainText("Court blocked: Maintenance");
  await expect(row(page, 9)).toContainText("Over");
  await expect(row(page, 9).locator("button")).toHaveCount(0);
  await expect(row(page, 12).locator("[data-bkbook]")).toHaveText("Book");
});

test("book: the sheet says others see the home; p_private is sent false, then true; the day redraws from the answer", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?court=" + C1 });
  await row(page, 12).locator("[data-bkbook]").click();
  await expect(page.locator("#bkSheet")).toContainText("Book Court 1, Tue 10 Nov 12:00–13:00?");
  await expect(page.locator("#bkSheet")).toContainText("Other residents will see your home on this booking unless you tick Private.");
  await expect(page.locator("#bkSheet")).toContainText("Each home can book 1 slot a day and hold 2 upcoming bookings.");
  await expect(page.locator("#bkPrivate")).not.toBeChecked();
  if (process.env.SHOT_DIR) { await page.locator("#bkSheet").scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.SHOT_DIR + "/bk-sheet.png" }); }
  await page.locator("#bkGo").click();
  await expect(page.locator("#msg")).toHaveText("Booked. Other residents see your home on it.");
  expect(lastCall(calls, "jc_booking_book").args).toEqual({ p_facility: C1, p_starts: at(D, 12), p_private: false });
  await expect(row(page, 12)).toContainText("Your booking");
  await expect(row(page, 12).locator("[data-bkcancel]")).toHaveCount(1);
  await row(page, 16).locator("[data-bkbook]").click();
  await page.locator("#bkPrivate").check();
  await page.locator("#bkGo").click();
  await expect(page.locator("#msg")).toHaveText("Booked, privately: others see just \"Booked\".");
  expect(lastCall(calls, "jc_booking_book").args).toEqual({ p_facility: C1, p_starts: at(D, 16), p_private: true });
  await expect(row(page, 16).locator(".chip")).toHaveText(["Your booking", "Private"]);
});

for (const [code, text, reread] of [
  ["SLOT_TAKEN", "Someone just booked that time. This is the day as it is now.", true],
  ["SLOT_BLOCKED", "The organizers just closed that time. This is the day as it is now.", true],
  ["QUOTA_REACHED", "Your home has already booked its slots for that day.", false],
  ["ACTIVE_CAP_REACHED", "Your home already holds the most upcoming bookings allowed. Cancel one, or book again after it's played.", false],
]) {
  test(`a refused booking is explained: ${code}${reread ? " (the day is re-read)" : ""}`, async ({ page }) => {
    const b = backend({ bookError: code });
    const { calls } = await open(page, b, { q: "?court=" + C1 });
    await expect(page.locator("#bkSlots")).toBeVisible();
    const days = calls.filter((c) => c.name === "jc_facility_day").length;
    await row(page, 12).locator("[data-bkbook]").click();
    await page.locator("#bkGo").click();
    await expect(page.locator("#msg")).toHaveText(text);
    expect(calls.filter((c) => c.name === "jc_facility_day").length).toBe(days + (reread ? 1 : 0));
    await expect(page.locator("#bkGo")).toHaveCount(reread ? 0 : 1);                 // a refusal that keeps the sheet lets them try again
    if (!reread) await expect(page.locator("#bkGo")).toBeEnabled();
  });
}

test("cancel from My bookings and from the day; a booking already gone says so", async ({ page }) => {
  const b = backend({ mine: [{ id: "m1", starts: at(D, 18) }, { id: "m2", starts: at("2026-11-11", 9) }] });
  const { calls } = await open(page, b);
  page.once("dialog", (d) => d.dismiss());
  await page.locator('#bkMine [data-bkcancel="m2"]').click();
  expect(calls.some((c) => c.name === "jc_booking_cancel")).toBe(false);
  page.once("dialog", (d) => d.accept());
  await page.locator('#bkMine [data-bkcancel="m2"]').click();
  await expect(page.locator("#msg")).toHaveText("Cancelled.");
  expect(lastCall(calls, "jc_booking_cancel").args).toEqual({ p_booking: "m2" });
  await expect(page.locator("#bkMine li")).toHaveCount(1);
  await page.locator(`[data-open="${C1}"]`).click();
  await expect(row(page, 18)).toContainText("Your booking");
  b.st.mine[0].status = "cancelled";                                               // gone in the meantime
  page.once("dialog", (d) => d.accept());
  await row(page, 18).locator("[data-bkcancel]").click();
  await expect(page.locator("#msg")).toHaveText("That booking has already started or was cancelled.");
  await expect(row(page, 18)).toContainText("Free");
});

test("the Private switch on My bookings sends the choice; an organizer cancel shows its reason", async ({ page }) => {
  const b = backend({ mine: [{ id: "m1", starts: at(D, 18) },
    { id: "m3", starts: at("2026-11-12", 9), status: "cancelled", cancel_reason: "Court blocked: Resurfacing" }] });
  const { calls } = await open(page, b);
  await expect(page.locator('#bkMine li[data-bk="m3"]')).toContainText("Cancelled by the organizers: Court blocked: Resurfacing");
  await expect(page.locator('#bkMine li[data-bk="m3"] button, #bkMine li[data-bk="m3"] input')).toHaveCount(0);
  await page.locator('[data-bkpriv="m1"]').check();
  await expect(page.locator("#msg")).toHaveText("Now private: others see just \"Booked\".");
  expect(lastCall(calls, "jc_booking_privacy_set").args).toEqual({ p_booking: "m1", p_private: true });
  await expect(page.locator('#bkMine li[data-bk="m1"] .chip')).toHaveText("Private");
  await page.locator('[data-bkpriv="m1"]').uncheck();
  await expect(page.locator("#msg")).toHaveText("Others now see your home on this booking.");
  expect(lastCall(calls, "jc_booking_privacy_set").args).toEqual({ p_booking: "m1", p_private: false });
});

test("a free slot that starts while the page is open turns Over on the next redraw (no Book on it)", async ({ page }) => {
  await open(page, backend(), { q: "?court=" + C1 });
  await expect(row(page, 11).locator("[data-bkbook]")).toHaveCount(1);
  await page.clock.fastForward("01:40:00");                                          // 10:30 → 12:10 in Dubai
  await row(page, 13).locator("[data-bkbook]").click();                              // any redraw
  await expect(row(page, 11)).toContainText("Over");
  await expect(row(page, 11).locator("[data-bkbook]")).toHaveCount(0);
  await expect(row(page, 12)).toContainText("Over");                                 // started 10 minutes ago: the server would refuse it
  await expect(row(page, 12).locator("[data-bkbook]")).toHaveCount(0);
});

test("a booking being played now: no Private switch, no Cancel (the server would refuse both)", async ({ page }) => {
  await open(page, backend({ mine: [{ id: "m0", starts: at(D, 10) }, { id: "m1", starts: at(D, 18) }] }));
  await expect(page.locator('#bkMine li[data-bk="m0"] input, #bkMine li[data-bk="m0"] button')).toHaveCount(0);
  await expect(page.locator('#bkMine li[data-bk="m1"] [data-bkcancel]')).toHaveCount(1);
});

test("a failed Private switch puts the tick back and says why", async ({ page }) => {
  const b = backend({ mine: [{ id: "m1", starts: at(D, 18) }] });
  b.rpc.jc_booking_privacy_set = () => raise("NETWORK_X");
  await open(page, b);
  await page.locator('[data-bkpriv="m1"]').check();
  await expect(page.locator("#msg")).toHaveClass(/err/);
  await expect(page.locator('[data-bkpriv="m1"]')).not.toBeChecked();
  await expect(page.locator('[data-bkpriv="m1"]')).toBeEnabled();
});

test("a slow day that lands after a newer one is dropped", async ({ page }) => {
  const b = backend({ others: [{ starts: at("2026-11-11", 9), home: V40 }] });      // only the 11th has a booking
  let release;
  const gate = new Promise((r) => { release = r; });
  const day = b.rpc.jc_facility_day;
  b.rpc.jc_facility_day = async (a, c) => { if (a.p_date === "2026-11-11") await gate; return day(a, c); };
  const { calls } = await open(page, b, { q: "?court=" + C1 });
  await expect(page.locator("#bkSlots")).toBeVisible();
  await page.locator('[data-day="2026-11-11"]').click();
  await expect.poll(() => calls.filter((c) => c.name === "jc_facility_day").length).toBe(2);
  await page.locator('[data-day="2026-11-12"]').click();
  await expect(page.locator("#bkSlots")).toBeVisible();
  release();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-day="2026-11-12"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bkSlots li.s-booked")).toHaveCount(0);
});

test("code review M1: book, go straight back — My bookings shows the new booking even before the re-read lands", async ({ page }) => {
  const b = backend();
  let release;
  const gate = new Promise((r) => { release = r; });
  const my = b.rpc.jc_my_bookings;
  let slow = false;
  b.rpc.jc_my_bookings = async (a, c) => { if (slow) await gate; return my(a, c); };
  await open(page, b);
  await page.locator(`[data-open="${C1}"]`).click();
  slow = true;
  await row(page, 12).locator("[data-bkbook]").click();
  await page.locator("#bkGo").click();
  await expect(page.locator("#msg")).toContainText("Booked");
  slow = false;                                                                      // the list's own re-read is quick
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#bkMine li")).toHaveCount(1);
  await expect(page.locator("#bkMine li")).toContainText("⁦12:00–13:00⁩");
  release();
});

test("a deep link to a court that's gone says so and drops the link", async ({ page }) => {
  await open(page, backend(), { q: "?court=99999999-aaaa-4aaa-8aaa-000000000009" });
  await expect(page.locator("#msg")).toHaveText("That court isn't available any more.");
  expect(page.url()).not.toContain("court=");
});

test("no home: told to claim it first, no Book buttons, nothing asked of the day", async ({ page }) => {
  const b = backend({ me: MEMBER_NO_HOME });
  const { calls } = await open(page, b);
  await expect(page.locator("#bkNoHome")).toHaveText("Claim your home first to book a court.");
  await expect(page.locator('#view a[href="../home/"]')).toBeVisible();
  await page.locator(`[data-open="${C1}"]`).click();
  await expect(page.locator("#msg")).toHaveText("Claim your home first to book a court.");     // the server's NO_HOME, back on the list
  expect(calls.some((c) => c.name === "jc_booking_book")).toBe(false);
});

test("Courts switched off: a plain page, nothing asked of the server", async ({ page }) => {
  const b = backend({ enabled: false });
  const { calls } = await open(page, b);
  await expect(page.locator("#bkOff")).toHaveText("Courts aren't open yet in your community.");
  await expect(page.locator('#tabbar a[data-tab="bookings"]')).toHaveCount(0);           // flag off (Jubail today): no Courts tab
  expect(calls.some((c) => /^jc_(facilit|my_book|booking)/.test(c.name))).toBe(false);
});

test("a language switch keeps the open sheet and its Private tick", async ({ page }) => {
  await open(page, backend(), { q: "?court=" + C1 });
  await row(page, 12).locator("[data-bkbook]").click();
  await page.locator("#bkPrivate").check();
  await page.locator("#langBtn").click();
  await expect(page.locator("#bkPrivate")).toBeChecked();
  await expect(page.locator("#bkGo")).toHaveText("تأكيد الحجز");
  await expect(page.locator("h1")).toHaveText("ملعب ١");
});

test("hostile court names, notes, reasons and home numbers stay text", async ({ page }) => {
  const evil = '<img src=x onerror="window.__x=1">';
  const b = backend({ courts: [COURT({ name_en: evil, name_ar: null, location_note: evil })],
    others: [{ starts: at(D, 14), home: Object.assign({}, V40, { number: evil }) }],
    blocks: [{ starts: at(D, 18), ends: at(D, 19), reason: evil }] });
  await open(page, b);
  await expect(page.locator(`[data-court="${C1}"]`)).toContainText(evil);
  await page.locator(`[data-open="${C1}"]`).click();
  await expect(row(page, 14)).toContainText(evil);
  await expect(row(page, 18)).toContainText(evil);
  await expect(page.locator("#view img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: the list, then a day with the booking sheet open`, async ({ page }) => {
    await open(page, backend({ mine: [{ id: "m1", starts: at(D, 18) }], others: [{ starts: at(D, 14), home: V40 }] }), { lang });
    await expect(page.locator("#bkCourts")).toBeVisible();
    const axe = async () => {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" "))).toEqual([]);
    };
    await axe();
    await page.locator(`[data-open="${C1}"]`).click();
    await row(page, 12).locator("[data-bkbook]").click();
    await expect(page.locator("#bkSheet")).toBeVisible();
    await axe();
  });
}
