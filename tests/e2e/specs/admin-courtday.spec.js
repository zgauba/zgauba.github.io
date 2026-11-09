// R4b-2 — Organizer tools → Courts → Day view (server S3 + R4a / R4a-2): one court, one community-time day; slot
// states with the home (admins), cancel a booking with a reason, block a range (one day or until another day's
// closing time), remove a block. Plan: docs/plans/R4b-2-courts-day-grid.md.
// The phone runs in London; the community is Asia/Dubai (+4): a wrong time zone shows wrong days and times.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, raise } = require("./stub");
const { adminBackend, signIn } = require("./backends");

test.use({ timezoneId: "Europe/London" });

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const COURT = (o) => Object.assign({ id: "c1", kind: "tennis", name_en: "Court 1", name_ar: null, location_note: null,
  lat: 24.5301, lng: 54.4312, status: "published", open_time: "07:00:00", close_time: "22:00:00", slot_minutes: 60,
  window_days: 7, sort: 0, walk_on: false, upcoming: 2 }, o);
// Dubai wall time on a day → the instant (Dubai is UTC+4, no DST)
const at = (day, h) => new Date(Date.parse(day + "T00:00:00Z") + (h - 4) * 3600e3).toISOString();
const D = "2026-11-10";
const T_MORNING = Date.parse("2026-11-10T06:30:00Z");   // 10:30 in Dubai; 06:30 in London
const T_NIGHT = Date.parse("2026-11-09T22:30:00Z");     // 02:30 on the 10th in Dubai; still the 9th in London
const VILLA = { id: "h1", village: "ain-al-maha", type: "villa", building: null, number: "12" };

function backend(opts = {}) {
  const ab = adminBackend({ scopes: ["community"] });
  const st = ab.st;
  const now = opts.now || T_MORNING;
  st.courts = (opts.courts || [COURT(), COURT({ id: "c2", name_en: "Hoops", kind: "basketball", walk_on: true })]);
  st.bookings = (opts.bookings || []).map((b) => Object.assign({}, b));
  st.blocks = (opts.blocks || []).map((b) => Object.assign({}, b));
  let n = 0;
  const list = () => ok(st.courts.map((c) => Object.assign({}, c)));
  const day = (date) => {
    const out = [];
    for (let h = 7; h < 22; h++) {
      const s = at(date, h), e = at(date, h + 1);
      const bl = st.blocks.find((x) => x.starts < e && x.ends > s);
      const bk = st.bookings.find((x) => x.starts === s);
      out.push({ starts_at: s, ends_at: e,
        state: bl ? "blocked" : bk ? "booked" : Date.parse(s) <= now ? "past" : "free",
        booking_id: bk ? bk.id : null, home: bk && !bl ? bk.home : null, is_private: bk ? !!bk.is_private : null,
        block_id: bl ? bl.id : null, block_reason: bl ? bl.reason : null });
    }
    return out;
  };
  const rpc = Object.assign({}, ab.rpc, {
    jc_admin_facilities_list: () => list(),
    jc_admin_booking_rules: () => ok({ enabled: true, per_home_per_day: 1, per_home_active: 2, configured: {},
      retention_days: 90, defaults: { window_days: 7, slot_minutes: 60 } }),
    jc_admin_facility_day: (a) => (st.courts.some((c) => c.id === a.p_facility)
      ? ok({ facility_id: a.p_facility, date: a.p_date, slots: opts.emptyDay === a.p_date ? [] : day(a.p_date) }) : raise("NOT_FOUND")),
    jc_admin_booking_cancel: (a) => {
      if (opts.cancelError) return raise(opts.cancelError);
      const i = st.bookings.findIndex((b) => b.id === a.p_booking);
      if (i < 0) return raise("NOT_FOUND");
      st.bookings.splice(i, 1);
      st.courts[0].upcoming -= 1;
      return list();
    },
    jc_admin_block_create: (a) => {
      n += 1;
      st.blocks.push({ id: "bl" + n, starts: a.p_starts, ends: a.p_ends, reason: a.p_reason });
      const gone = st.bookings.filter((b) => b.starts < a.p_ends && Date.parse(b.starts) + 3600e3 > Date.parse(a.p_starts) &&
                                             Date.parse(b.starts) + 3600e3 > now);
      st.bookings = st.bookings.filter((b) => !gone.includes(b));
      return ok({ block_id: "bl" + n, bookings_cancelled: gone.length });
    },
    jc_admin_block_remove: (a) => {
      const i = st.blocks.findIndex((b) => b.id === a.p_block);
      if (i < 0) return raise("NOT_FOUND");
      st.blocks.splice(i, 1);
      return ok({ block_id: a.p_block, removed: true });
    },
  });
  return { st, rpc };
}

// 08:00 ended (booked, no cancel); 10:00 being played now (cancellable); 15:00 later today, private; 18–20 blocked
const DAY = {
  bookings: [
    { id: "b8", starts: at(D, 8), home: VILLA },
    { id: "b10", starts: at(D, 10), home: VILLA },
    { id: "b15", starts: at(D, 15), home: Object.assign({}, VILLA, { id: "h2", number: "40" }), is_private: true },
  ],
  blocks: [{ id: "blx", starts: at(D, 18), ends: at(D, 20), reason: "Maintenance" }],
};

async function openDay(page, b, now) {
  await page.clock.install({ time: now || T_MORNING });
  const stub = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await page.locator('[data-ct="day"][data-id="c1"]').click();
  await expect(page.locator(".cdlist")).toBeVisible();
  return stub;
}
const row = (page, h) => page.locator(".cdlist li", { has: page.locator(".cdtime", { hasText: String(h).padStart(2, "0") + ":00–" }) });

test("Day view sits on bookable courts only (not walk-on, not retired)", async ({ page }) => {
  const b = backend({ courts: [COURT(), COURT({ id: "c2", walk_on: true }), COURT({ id: "c3", status: "retired" })] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await expect(page.locator('[data-court="c1"] [data-ct]')).toHaveText(["Day view", "Edit", "Unpublish", "Retire"]);
  await expect(page.locator('[data-court="c2"] [data-ct="day"]')).toHaveCount(0);
  await expect(page.locator('[data-court="c3"] [data-ct]')).toHaveCount(0);
});

test("opens on today in community time (phone in London, still yesterday there); times are community time", async ({ page }) => {
  const b = backend({ now: T_NIGHT });
  const { calls } = await openDay(page, b, T_NIGHT);
  await expect(page.locator("#cdDate")).toHaveValue(D);
  await expect(page.locator("#cdDay")).toHaveText("Tue 10 Nov");
  expect(lastCall(calls, "jc_admin_facility_day").args).toEqual({ p_facility: "c1", p_date: D });
  await expect(page.locator(".cdlist .cdtime").first()).toHaveText("⁦07:00–08:00⁩");
  await expect(page.locator(".cdlist li")).toHaveCount(15);
  await expect(page.locator("#cdPrev")).toBeDisabled();
  await expect(page.locator("#cdDate")).toHaveAttribute("min", D);
  await expect(page.locator("#cdDate")).toHaveAttribute("max", "2027-02-08");       // 90 days ahead
  await page.locator("#cdNext").click();
  await expect(page.locator("#cdDay")).toHaveText("Wed 11 Nov");
  await expect.poll(() => lastCall(calls, "jc_admin_facility_day").args.p_date).toBe("2026-11-11");
  await expect(page.locator("#cdPrev")).toBeEnabled();
  await page.locator("#cdDate").fill("2027-03-01");                                  // past the 90 days: refused
  await page.locator("#cdDate").dispatchEvent("change");
  await expect(page.locator("#cdDate")).toHaveValue("2026-11-11");
});

test("slot states: over, booked with the home (and Private), being played now still cancellable, one row per block", async ({ page }) => {
  await openDay(page, backend(DAY));
  await expect(row(page, 7)).toContainText("Over");
  await expect(row(page, 8)).toContainText("Booked");
  await expect(row(page, 8)).toContainText("Villa 12 · Ain Al Maha");
  await expect(row(page, 8).locator("[data-cdcancel]")).toHaveCount(0);              // ended: the server would say NOT_FOUND
  await expect(row(page, 10).locator("[data-cdcancel]")).toHaveCount(1);             // being played now
  await expect(row(page, 15)).toContainText("Private");
  await expect(row(page, 15)).toContainText("Villa 40");
  await expect(row(page, 12)).toContainText("Free");
  const blk = page.locator(".cdlist li.cd-blocked");
  await expect(blk).toHaveCount(1);
  await expect(blk.locator(".cdtime")).toHaveText("⁦18:00–20:00⁩");
  await expect(blk).toContainText("Maintenance");
  await expect(page.locator(".cdlist li")).toHaveCount(14);
  if (process.env.SHOT_DIR) {                     // /shot-style look
    await page.screenshot({ path: process.env.SHOT_DIR + "/courtday.png", fullPage: true });
    await page.locator("#cdBlock").click();
    await page.locator('input[name="cdUntil"][value="days"]').check();
    await page.screenshot({ path: process.env.SHOT_DIR + "/courtday-block.png" });
  }
});

test("cancel a booking: a reason first (nothing sent), then the exact args; the day re-reads", async ({ page }) => {
  const b = backend(DAY);
  const { calls } = await openDay(page, b);
  await row(page, 15).locator("[data-cdcancel]").click();
  await page.locator("#cdCancelWhy").fill("ab");
  await page.locator("#cdCancelGo").click();
  await expect(page.locator("#msg")).toHaveText("Write a reason of at least 3 characters.");
  expect(calls.some((c) => c.name === "jc_admin_booking_cancel")).toBe(false);
  await expect(page.locator("#cdCancelWhy")).toHaveAttribute("maxlength", "200");
  await page.locator("#cdCancelWhy").fill("  Court resurfacing  ");
  await page.locator("#cdCancelGo").click();
  await expect(page.locator("#msg")).toHaveText("Cancelled. The household will see your reason.");
  expect(lastCall(calls, "jc_admin_booking_cancel").args).toEqual({ p_booking: "b15", p_reason: "Court resurfacing" });
  await expect(row(page, 15)).toContainText("Free");
  await page.locator("#jcBackBtn").click();                                          // the list's count came back with it
  await expect(page.locator('[data-court="c1"]')).toContainText("Upcoming bookings: 1");
});

test("Keep it closes the cancel form; a booking gone in the meantime re-reads the day and says so", async ({ page }) => {
  const b = backend(DAY);
  await openDay(page, b);
  await row(page, 10).locator("[data-cdcancel]").click();
  await page.locator("#cdCancelKeep").click();
  await expect(page.locator("#cdCancelWhy")).toHaveCount(0);
  await row(page, 10).locator("[data-cdcancel]").click();
  b.st.bookings = b.st.bookings.filter((x) => x.id !== "b10");                        // the household cancelled it
  await page.locator("#cdCancelWhy").fill("Tournament");
  await page.locator("#cdCancelGo").click();
  await expect(page.locator("#msg")).toHaveText("That changed in the meantime. This is the day as it is now.");
  await expect(row(page, 10)).not.toContainText("Booked");
});

test("block one day: a start moves an earlier end to it; preset reason; the confirm counts; the server's count shown", async ({ page }) => {
  const b = backend(DAY);
  const { calls } = await openDay(page, b);
  await page.locator("#cdBlock").click();
  await expect(page.locator("#cdFrom option")).toHaveCount(12);                    // 10:00 (being played) … 21:00
  await expect(page.locator("#cdFrom option").first()).toHaveText("10:00");
  await expect(page.locator("#cdWhy")).toHaveAttribute("maxlength", "185");
  await expect(page.locator("#cdLastWrap")).toBeHidden();
  await page.locator("#cdFrom").selectOption({ label: "14:00" });
  await expect(page.locator("#cdTo")).toHaveValue(await page.locator("#cdFrom").inputValue());   // jumped to 15:00 (the end of 14:00)
  await expect(page.locator("#cdTo option:checked")).toHaveText("15:00");
  await page.locator("#cdTo").selectOption({ label: "16:00" });
  await page.locator("#cdFrom").selectOption({ label: "13:00" });                   // an end already later stays
  await expect(page.locator("#cdTo option:checked")).toHaveText("16:00");
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("Write a reason of at least 3 characters.");
  await page.locator('[data-cdpre="official"]').click();
  await expect(page.locator("#cdWhy")).toHaveValue("Official booking");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator("#cdBlockGo").click();
  await expect.poll(() => asked).toBe("Block Court 1, ⁦Tue 10 Nov 13:00–16:00⁩? 1 bookings in that time will be cancelled, and those households will see your reason.");
  expect(calls.some((c) => c.name === "jc_admin_block_create")).toBe(false);
  page.once("dialog", (d) => d.accept());
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("Blocked. 1 bookings cancelled.");
  expect(lastCall(calls, "jc_admin_block_create").args).toEqual(
    { p_facility: "c1", p_starts: at(D, 13), p_ends: at(D, 16), p_reason: "Official booking" });
  await expect(page.locator("#cdBlockForm")).toHaveCount(0);
  await expect(page.locator(".cdlist li.cd-blocked .cdtime")).toHaveText(["⁦13:00–16:00⁩", "⁦18:00–20:00⁩"]);
});

test("Whole day takes every slot still to come; Other clears the reason", async ({ page }) => {
  const b = backend({});
  const { calls } = await openDay(page, b);
  await page.locator("#cdBlock").click();
  await page.locator('[data-cdpre="maintenance"]').click();
  await page.locator('[data-cdpre="other"]').click();
  await expect(page.locator("#cdWhy")).toHaveValue("");
  await page.locator("#cdWhy").fill("Floodlights out");
  await page.locator("#cdWhole").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("Blocked.");
  expect(lastCall(calls, "jc_admin_block_create").args).toEqual(
    { p_facility: "c1", p_starts: at(D, 10), p_ends: at(D, 22), p_reason: "Floodlights out" });
});

test("block several days: ends at that day's closing time as the server lays it out; at most 30 days", async ({ page }) => {
  const b = backend(Object.assign({ emptyDay: "2026-11-20" }, DAY));
  const { calls } = await openDay(page, b);
  await page.locator("#cdBlock").click();
  await page.locator("#cdFrom").selectOption({ label: "12:00" });
  await page.locator('input[name="cdUntil"][value="days"]').check();
  await expect(page.locator("#cdToWrap")).toBeHidden();
  await expect(page.locator("#cdLast")).toHaveValue("2026-11-11");                  // starts on the next day
  await expect(page.locator("#cdLast")).toHaveAttribute("max", "2026-12-10");
  await page.locator("#cdWhy").fill("Fixing a cracked court");
  await page.locator("#cdLast").fill("2026-12-11");
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("Pick a last day after this one, up to 30 days ahead.");
  await page.locator("#cdLast").fill("2026-11-20");                                 // a day with no slots
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("The court has no slots on that last day. Pick another day.");
  await expect(page.locator("#cdBlockGo")).toBeEnabled();
  await page.locator("#cdLast").fill("2026-11-12");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator("#cdBlockGo").click();
  await expect.poll(() => asked).toBe("Block Court 1, ⁦Tue 10 Nov 12:00 – Thu 12 Nov 22:00⁩? Every booking in that time will be cancelled, and those households will see your reason.");
  expect(lastCall(calls, "jc_admin_facility_day").args).toEqual({ p_facility: "c1", p_date: "2026-11-12" });
  await expect(page.locator("#cdBlockGo")).toBeEnabled();                            // dismissed: nothing sent, can try again
  expect(calls.some((c) => c.name === "jc_admin_block_create")).toBe(false);
  page.once("dialog", (d) => d.accept());
  await page.locator("#cdBlockGo").click();
  await expect(page.locator("#msg")).toHaveText("Blocked. 1 bookings cancelled.");
  expect(lastCall(calls, "jc_admin_block_create").args).toEqual(
    { p_facility: "c1", p_starts: at(D, 12), p_ends: at("2026-11-12", 22), p_reason: "Fixing a cracked court" });
});

test("remove a block: asks first (and says cancelled bookings stay cancelled)", async ({ page }) => {
  const b = backend(DAY);
  const { calls } = await openDay(page, b);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('[data-cdunblock="blx"]').click();
  await expect.poll(() => asked).toContain("Bookings it cancelled stay cancelled.");
  expect(calls.some((c) => c.name === "jc_admin_block_remove")).toBe(false);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-cdunblock="blx"]').click();
  await expect(page.locator("#msg")).toHaveText("Block removed. Bookings it cancelled stay cancelled.");
  expect(lastCall(calls, "jc_admin_block_remove").args).toEqual({ p_block: "blx" });
  await expect(page.locator(".cdlist li.cd-blocked")).toHaveCount(0);
});

test("an answer that lands after leaving changes nothing on screen; the list is re-read", async ({ page }) => {
  const b = backend(DAY);
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_admin_block_create: async (a, c) => { await gate; return b.rpc.jc_admin_block_create(a, c); } });
  const { calls } = await (async () => {
    await page.clock.install({ time: T_MORNING });
    const s = await stubBackend(page, { rpc });
    await signIn(page);
    await page.goto("admin/?tab=courts");
    await page.locator('[data-ct="day"][data-id="c1"]').click();
    await expect(page.locator(".cdlist")).toBeVisible();
    return s;
  })();
  await page.locator("#cdBlock").click();
  await page.locator("#cdWhy").fill("Maintenance");
  page.once("dialog", (d) => d.accept());
  await page.locator("#cdBlockGo").click();
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#ctNew")).toBeVisible();
  const lists = calls.filter((c) => c.name === "jc_admin_facilities_list").length;
  await page.locator('[data-ct="day"][data-id="c1"]').click();                      // back in before the answer: a new day view
  await expect(page.locator(".cdlist li.cd-blocked")).toHaveCount(1);
  const days = calls.filter((c) => c.name === "jc_admin_facility_day").length;
  release();
  await expect.poll(() => calls.filter((c) => c.name === "jc_admin_block_create").length).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator("#msg")).not.toContainText("Blocked");                    // the old screen's answer touches nothing
  expect(calls.filter((c) => c.name === "jc_admin_facility_day").length).toBe(days);
  await page.locator("#cdNext").click();
  await page.locator("#cdPrev").click();                                             // a fresh read shows the new block
  await expect(page.locator(".cdlist li.cd-blocked")).toHaveCount(2);
  await page.locator("#jcBackBtn").click();
  await expect.poll(() => calls.filter((c) => c.name === "jc_admin_facilities_list").length).toBeGreaterThan(lists);
});

test("a court gone in the meantime goes back to the list and says so; a day that can't be read has Try Again", async ({ page }) => {
  const b = backend(DAY);
  let fails = 1;
  const rpc = Object.assign({}, b.rpc, { jc_admin_facility_day: (a, c) => (a.p_date === "2026-11-11" && fails-- > 0 ? raise("NETWORK_X") : b.rpc.jc_admin_facility_day(a, c)) });
  await page.clock.install({ time: T_MORNING });
  await stubBackend(page, { rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await page.locator('[data-ct="day"][data-id="c1"]').click();
  await page.locator("#cdNext").click();
  await expect(page.locator("#cdRetry")).toBeVisible();
  await page.locator("#cdRetry").click();
  await expect(page.locator(".cdlist")).toBeVisible();
  b.st.courts = b.st.courts.filter((c) => c.id !== "c1");
  await page.locator("#cdPrev").click();
  await expect(page.locator("#ctNew")).toBeVisible();
  await expect(page.locator("#msg")).toHaveText("That court is no longer listed.");
});

test("code review M1: while another day loads, the old forms are gone (nothing to submit against no slots)", async ({ page }) => {
  const b = backend(DAY);
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_admin_facility_day: async (a, c) => { if (a.p_date === "2026-11-11") await gate; return b.rpc.jc_admin_facility_day(a, c); } });
  await page.clock.install({ time: T_MORNING });
  const { calls } = await stubBackend(page, { rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await page.locator('[data-ct="day"][data-id="c1"]').click();
  await page.locator("#cdBlock").click();
  await page.locator("#cdWhy").fill("Maintenance");
  await page.locator("#cdNext").click();
  await expect(page.locator("#cdBlockForm")).toHaveCount(0);
  await expect(page.locator("#view")).toContainText("One moment…");
  await expect(page.locator("#cdBlock")).toHaveCount(0);
  release();
  await expect(page.locator("#cdDay")).toHaveText("Wed 11 Nov");
  await expect(page.locator("#cdBlock")).toBeVisible();
  expect(calls.some((c) => c.name === "jc_admin_block_create")).toBe(false);
});

test("a slow day that lands after a newer one is dropped", async ({ page }) => {
  const b = backend({ bookings: [{ id: "b11", starts: at("2026-11-11", 9), home: VILLA }] });   // only the 11th has a booking
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_admin_facility_day: async (a, c) => { if (a.p_date === "2026-11-11") await gate; return b.rpc.jc_admin_facility_day(a, c); } });
  await page.clock.install({ time: T_MORNING });
  const { calls } = await stubBackend(page, { rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts");
  await page.locator('[data-ct="day"][data-id="c1"]').click();
  await expect(page.locator(".cdlist")).toBeVisible();
  await page.locator("#cdNext").click();                                             // the 11th: slow
  await expect.poll(() => calls.filter((c) => c.name === "jc_admin_facility_day").length).toBe(2);
  await page.locator("#cdNext").click();                                             // the 12th: fast
  await expect(page.locator(".cdlist")).toBeVisible();
  await expect(page.locator("#cdDay")).toHaveText("Thu 12 Nov");
  release();
  await page.waitForTimeout(300);
  await expect(page.locator("#cdDay")).toHaveText("Thu 12 Nov");
  await expect(page.locator("#cdDate")).toHaveValue("2026-11-12");
  await expect(page.locator(".cdlist li.cd-booked")).toHaveCount(0);                 // the 11th's slots never replace the 12th's
});

test("a language switch keeps the day and what's typed in the block form", async ({ page }) => {
  await openDay(page, backend(DAY));
  await page.locator("#cdNext").click();
  await page.locator("#cdBlock").click();
  await page.locator("#cdFrom").selectOption({ label: "14:00" });
  await page.locator('input[name="cdUntil"][value="days"]').check();
  await page.locator("#cdLast").fill("2026-11-14");
  await page.locator("#cdWhy").fill("Resurfacing");
  await page.locator("#langBtn").click();
  await expect(page.locator("#cdDate")).toHaveValue("2026-11-11");
  await expect(page.locator("#cdFrom option:checked")).toHaveText("14:00");
  await expect(page.locator('input[name="cdUntil"][value="days"]')).toBeChecked();
  await expect(page.locator("#cdToWrap")).toBeHidden();
  await expect(page.locator("#cdLast")).toHaveValue("2026-11-14");
  await expect(page.locator("#cdWhy")).toHaveValue("Resurfacing");
  await expect(page.locator("#cdBlockGo")).toHaveText("إغلاق");
});

test("hostile reasons and home numbers stay text", async ({ page }) => {
  const evil = '<img src=x onerror="window.__x=1">';
  await openDay(page, backend({ bookings: [{ id: "b15", starts: at(D, 15), home: Object.assign({}, VILLA, { number: evil }) }],
    blocks: [{ id: "blx", starts: at(D, 18), ends: at(D, 19), reason: evil }] }));
  await expect(row(page, 15)).toContainText(evil);
  await expect(page.locator(".cdlist li.cd-blocked")).toContainText(evil);
  await expect(page.locator(".cdlist img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: the day view with the block form, then a cancel form, open`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem("jc_lang", l), lang);
    await openDay(page, backend(DAY));
    const axe = async () => {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" "))).toEqual([]);
    };
    await page.locator("#cdBlock").click();
    await page.locator('input[name="cdUntil"][value="days"]').check();
    await axe();
    await row(page, 15).locator("[data-cdcancel]").click();
    await expect(page.locator("#cdCancelWhy")).toBeVisible();
    await axe();
  });
}

// Zee 2026-11-09 (consistency): the Admin button on a court in Courts lands on that court's day view.
test("?tab=courts&court= opens that court's day view once; Back is the courts list; an unknown court says so", async ({ page }) => {
  await page.clock.install({ time: T_MORNING });
  const { calls } = await stubBackend(page, { rpc: backend().rpc });
  await signIn(page);
  await page.goto("admin/?tab=courts&court=c1");
  await expect(page.locator(".cdlist")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Court 1");
  expect(lastCall(calls, "jc_admin_facility_day").args).toEqual({ p_facility: "c1", p_date: D });
  await expect(page).toHaveURL(/\?tab=courts$/);                                    // a reload doesn't re-open it
  await page.locator("#jcBackBtn").click();
  await expect(page.locator('[data-ct="day"][data-id="c1"]')).toBeVisible();
  await page.goto("admin/?tab=courts&court=gone");
  await expect(page.locator("#msg")).toHaveText("That court is no longer listed.");
  await expect(page.locator('[data-ct="day"][data-id="c1"]')).toBeVisible();
});
