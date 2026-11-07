// T5.2 PR 4 — Organizer tab inside an event: sign-ups by village, note, hide / restore (Undo),
// move pin (home everywhere / this event only / back to the home's pin), spots, CSV, banner.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, CONFIG } = require("./stub");
const { adminBackend, signIn, ADMIN_LIVE_ID: LIVE_ID, ADMIN_PAST_ID: PAST_ID, ADMIN_MARKET } = require("./backends");

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const card = (page, n) => page.locator(".sulist li").filter({ has: page.locator("b", { hasText: new RegExp("^(Villa|Townhouse) " + n + "$") }) });

async function openSignups(page, slug) {
  await page.locator(`li[data-event="${slug}"] [data-act="signups"]`).click();
  await expect(page.locator(".sulist").first()).toBeVisible();
}
// config that follows the stub's banner, so a posted banner shows up on the next page load
function withBanner(ab) {
  return Object.assign({}, ab.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, { broadcast: ab.st.broadcast })) });
}

test("sign-ups: grouped by village with counts; withdrawn left out; flags, notes; resident text escaped", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  expect(lastCall(calls, "jc_admin_entries_list").args).toEqual({ p_event: LIVE_ID });
  await expect(page.locator("h1")).toHaveText("Test Event");
  await expect(page.locator(".sub")).toHaveText("3 homes");                       // a4 withdrew
  await expect(page.locator("h2.group")).toHaveText(["Ain Al Maha · 2", "Seef Al Jubail · 1"]);
  await expect(card(page, "12").locator(".flags")).toContainText("2 neighbor reports");
  await expect(card(page, "12").locator(".note")).toHaveText('=HYPERLINK("x")');   // shown as text, never markup
  await expect(card(page, "14").locator(".flags")).toContainText("No pin");
  await expect(card(page, "14").locator(".orgnote")).toContainText("Pin looks off");
  await expect(card(page, "7").locator(".flags")).toContainText("Pin moved for this event");
  await expect(card(page, "12").locator(".meta")).toHaveText(["treats: candy"]);
  await expect(page.locator('[data-su="spot"]')).toHaveCount(0);                  // a homes event has no spots
  await page.locator("#jcBackBtn").click();                                      // back lives in the top bar
  await expect(page.locator("#newEv")).toBeVisible();
});

test("note: save sends only the note; remove sends an empty one", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "12").locator('[data-su="note"]').click();
  await page.locator('[data-form="note"] [data-in]').fill("Please move your pin to the front gate");
  await page.locator('[data-form="note"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Note saved for Villa 12.");
  expect(lastCall(calls, "jc_admin_entry_moderate").args).toEqual({ p_entry: "a1", p_hidden: null, p_org_note: "Please move your pin to the front gate" });
  await expect(card(page, "12").locator(".orgnote")).toContainText("Please move your pin");
  await card(page, "12").locator('[data-su="note"]').click();
  await expect(page.locator('[data-form="note"] [data-in]')).toHaveValue("Please move your pin to the front gate");
  await page.locator('[data-form="note"] [data-clear]').click();
  await expect(page.locator("#msg")).toHaveText("Note removed for Villa 12.");
  expect(lastCall(calls, "jc_admin_entry_moderate").args).toEqual({ p_entry: "a1", p_hidden: null, p_org_note: "" });
  await expect(card(page, "12").locator(".orgnote")).toHaveCount(0);
});

test("hide → still holds its place, Undo shows it again", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "14").locator('[data-su="hide"]').click();
  await expect(page.locator("#msg")).toContainText("Villa 14 is hidden from the map and list. It still holds its place.");
  expect(lastCall(calls, "jc_admin_entry_moderate").args).toEqual({ p_entry: "a2", p_hidden: true, p_org_note: null });
  await expect(page.locator(".sub")).toHaveText("3 homes · 1 hidden");
  await expect(card(page, "14")).toHaveClass(/hidden/);
  await page.locator("#undo").click();
  await expect(page.locator("#msg")).toHaveText("Put back.");
  expect(lastCall(calls, "jc_admin_entry_moderate").args).toEqual({ p_entry: "a2", p_hidden: false, p_org_note: null });
  await expect(card(page, "14").locator('[data-su="hide"]')).toBeVisible();
});

test("move pin just for this event: confirm names the home; Undo puts the old pin back", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "12").locator('[data-su="pin"]').click();
  await expect(page.locator("h1")).toHaveText("Move Pin");
  await expect(page.locator(".sub")).toHaveText("Villa 12 · Ain Al Maha");
  await expect(page.locator("#pmReset")).toHaveCount(0);                          // no event pin yet
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator("#pmEvent").click();
  await expect(page.locator("#msg")).toContainText("Villa 12 is pinned here for this event.");
  expect(asked).toContain("Villa 12");
  const a = lastCall(calls, "jc_admin_entry_pin_set").args;
  expect(a.p_entry).toBe("a1");
  expect(a.p_lat).toBeCloseTo(24.5302, 3);                                        // the map opened on the home's pin
  await expect(card(page, "12").locator(".flags")).toContainText("Pin moved for this event");
  await page.locator("#undo").click();
  await expect(page.locator("#msg")).toHaveText("Put back.");
  expect(lastCall(calls, "jc_admin_entry_pin_set").args).toEqual({ p_entry: "a1", p_lat: null, p_lng: null });
});

test("move the home's own pin (everywhere) and back to the home's pin for an event-only one", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "7").locator('[data-su="pin"]').click();
  await expect(page.getByText("This home has a pin just for this event.")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator("#pmHome").click();
  // the event-only pin still wins on this event's map — said, not hidden
  await expect(page.locator("#msg")).toContainText("Townhouse 7's pin moved. This event still uses its own pin for Townhouse 7.");
  const h = lastCall(calls, "jc_admin_home_pin_set").args;
  expect(h.p_home).toBe("h-a3");
  expect(h.p_lat).toBeCloseTo(24.5311, 3);                                        // opened on the effective (event) pin
  await card(page, "7").locator('[data-su="pin"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#pmReset").click();
  await expect(page.locator("#msg")).toContainText("Townhouse 7 uses the home's own pin again.");
  expect(lastCall(calls, "jc_admin_entry_pin_set").args).toEqual({ p_entry: "a3", p_lat: null, p_lng: null });
  await expect(card(page, "7").locator(".flags")).toContainText("Home's own pin");
});

test("declining the pin confirm sends nothing", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "12").locator('[data-su="pin"]').click();
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#pmHome").click();
  await expect(page.locator("h1")).toHaveText("Move Pin");
  expect(calls.filter((c) => c.name === "jc_admin_home_pin_set")).toHaveLength(0);
});

test("one-place event with spots: assign, taken spot refused, free; no pin moves", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], extraEvents: [ADMIN_MARKET] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "kids-market");
  await expect(page.locator(".sub")).toHaveText("2 households · limit 30");
  await expect(page.locator('[data-su="pin"]')).toHaveCount(0);                   // the venue is the pin
  await expect(card(page, "3").locator(".flags")).toHaveText("Spot A1");
  await card(page, "5").locator('[data-su="spot"]').click();
  await page.locator('[data-form="spot"] [data-in]').fill("a1");
  await page.locator('[data-form="spot"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Another household already has that spot.");
  await page.locator('[data-form="spot"] [data-in]').fill("no/slash");
  await page.locator('[data-form="spot"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Spots are letters, numbers, spaces or dashes — up to 12.");
  await page.locator('[data-form="spot"] [data-in]').fill("b2");
  await page.locator('[data-form="spot"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 5 has spot B2.");
  expect(lastCall(calls, "jc_admin_entry_spot_set").args).toEqual({ p_entry: "m2", p_spot: "b2" });
  await expect(card(page, "5").locator(".flags")).toHaveText("Spot B2");
  await card(page, "3").locator('[data-su="spot"]').click();
  await page.locator('[data-form="spot"] [data-clear]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 3's spot is free again.");
  expect(lastCall(calls, "jc_admin_entry_spot_set").args).toEqual({ p_entry: "m1", p_spot: "" });
});

test("CSV: every row incl. withdrawn, answers in words, formula-looking text defused, UTF-8 BOM", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#csv").click()]);
  expect(dl.suggestedFilename()).toBe("test-event-signups.csv");
  const text = require("fs").readFileSync(await dl.path(), "utf8");
  expect(text.charCodeAt(0)).toBe(0xFEFF);
  const lines = text.slice(1).split("\r\n");
  expect(lines[0]).toBe('"Village","Home","Status","Hidden","Pin","Latitude","Longitude","treats","Household note","Organizer note","Open reports","Signed up","Last change","Adjusted by an organizer","Removed by an organizer"');
  expect(lines).toHaveLength(5);                                                  // header + 4 (the withdrawn one too)
  expect(lines[1]).toContain('"Ain Al Maha","Villa 12","Signed up","","Home\'s pin","24.5302","54.4322","candy","\'=HYPERLINK(""x"")"');
  expect(lines[3]).toContain('"This event only","24.5311","54.4311","candy","\' @SUM(1)"');   // whitespace before @ defused too
  expect(lines[4]).toContain('"Villa 9","Withdrew"');
});

test("closed event: read-only (no actions), CSV still there", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "halloween-2026");
  expect(lastCall(calls, "jc_admin_entries_list").args).toEqual({ p_event: PAST_ID });
  await expect(page.locator(".notice")).toContainText("This event is closed");
  await expect(page.locator("[data-su]")).toHaveCount(0);
  await expect(page.locator("#csv")).toBeEnabled();
  await expect(page.locator('li[data-event]')).toHaveCount(0);
});

test("drafts have no Sign-ups button", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('li[data-event="national-day-2026"] [data-act="signups"]')).toHaveCount(0);
  await expect(page.locator('li[data-event="test-event"] [data-act="signups"]')).toBeVisible();
});

test("an event admin manages their event's sign-ups (no code)", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [LIVE_ID] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "12").locator('[data-su="hide"]').click();
  await expect(page.locator("#msg")).toContainText("Villa 12 is hidden");
  expect(lastCall(calls, "jc_admin_entry_moderate").args.p_entry).toBe("a1");
});

test("NOT_ADMIN mid-way (grant removed) leaves the tab for the lock screen", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [LIVE_ID] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  ab.st.adminEvents = [];                                                         // a community admin removed them
  await card(page, "12").locator('[data-su="hide"]').click();
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#msg")).toHaveText("Organizer tools are locked on your account — enter your code again.");
});

test("Arabic: the tab, flags and buttons in Arabic, right to left", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#jcBackBtn")).toHaveAttribute("aria-label", "رجوع");
  await expect(page.locator("h2.group")).toContainText(["عين المها · 2"]);    // Seef has no Arabic name yet
  await expect(page.locator('[data-su="hide"]').first()).toHaveText("إخفاء");
  await expect(page.locator(".flags").filter({ hasText: "بلاغات من الجيران" })).toHaveCount(1);
});

test("banner: organizer posts after a confirm; it shows on admin, events and My Home; remove clears it", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: withBanner(ab) });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerText").fill("  Road closed near Seef — use the north gate  ");
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#bannerSave").click();
  expect(calls.filter((c) => c.name === "jc_admin_broadcast_set")).toHaveLength(0);
  page.once("dialog", (d) => d.accept());
  await page.locator("#bannerSave").click();
  await expect(page.locator("#msg")).toHaveText("Banner posted.");
  expect(lastCall(calls, "jc_admin_broadcast_set").args).toEqual({ p_text: "Road closed near Seef — use the north gate" });
  await expect(page.locator("#jcBanner")).toHaveText("⚠️ Road closed near Seef — use the north gate");
  await expect(page.locator("#bannerText")).toHaveValue("Road closed near Seef — use the north gate");
  for (const path of ["home/", "events/"]) {
    await page.goto(path);
    await expect(page.locator("#jcBanner")).toHaveText("⚠️ Road closed near Seef — use the north gate");
  }
  await page.goto("./");                                                          // the hub keeps its own banner, no second one
  await expect(page.locator("#bcast")).toHaveText("⚠️ Road closed near Seef — use the north gate");
  await expect(page.locator("#jcBanner")).toHaveCount(0);
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerClear").click();
  await expect(page.locator("#msg")).toHaveText("Banner removed.");
  expect(lastCall(calls, "jc_admin_broadcast_set").args).toEqual({ p_text: "" });
  await expect(page.locator("#jcBanner")).toHaveCount(0);
});

test("banner: empty post refused on the phone; event admin without a live event gets no banner box", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerSave").click();
  await expect(page.locator("#msg")).toHaveText("Write the banner first — or tap Remove banner.");
  expect(calls.filter((c) => c.name === "jc_admin_broadcast_set")).toHaveLength(0);

  const ab2 = adminBackend({ adminEvents: [PAST_ID] });
  const page2 = await page.context().newPage();
  await stubBackend(page2, { rpc: ab2.rpc });
  await page2.goto("admin/?tab=banner");
  await expect(page2.locator("h1")).toBeVisible();
  await expect(page2.locator("#bannerForm")).toHaveCount(0);
  await expect(page2.locator("#atab-banner")).toHaveCount(0);                     // no Banner tab at all
});

// ── review fixes (PR 4 code review) ──
test("home-pin Undo puts the home's old pin back (a different RPC than the move)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "12").locator('[data-su="pin"]').click();
  await page.locator("#coords").fill("24.5400, 54.4400");
  await page.locator("#coordsGo").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#pmHome").click();
  await expect(page.locator("#msg")).toContainText("Villa 12's pin moved.");
  const moved = lastCall(calls, "jc_admin_home_pin_set").args;
  expect(moved.p_lat).toBeCloseTo(24.54, 4);
  await page.locator("#undo").click();
  await expect(page.locator("#msg")).toHaveText("Put back.");
  expect(lastCall(calls, "jc_admin_home_pin_set").args).toEqual({ p_home: "h-a1", p_lat: 24.5302, p_lng: 54.4322 });
});

test("event-pin Undo over an existing event pin restores that pin, not the home's", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  await card(page, "7").locator('[data-su="pin"]').click();
  await page.locator("#coords").fill("24.5400, 54.4400");
  await page.locator("#coordsGo").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#pmEvent").click();
  await expect(page.locator("#msg")).toContainText("Townhouse 7 is pinned here for this event.");
  expect(lastCall(calls, "jc_admin_entry_pin_set").args.p_lat).toBeCloseTo(24.54, 4);
  await page.locator("#undo").click();
  await expect(page.locator("#msg")).toHaveText("Put back.");
  expect(lastCall(calls, "jc_admin_entry_pin_set").args).toEqual({ p_entry: "a3", p_lat: 24.5311, p_lng: 54.4311 });
});

test("a failed write says why and leaves the buttons usable", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_entry_moderate: () => ({ status: 400, body: { code: "P0001", message: "BAD_STATE" } }),
    jc_admin_entry_pin_set: () => ({ status: 400, body: { code: "P0001", message: "BAD_PIN" } }),
  }) });
  await signIn(page);
  await page.goto("admin/");
  await openSignups(page, "test-event");
  const hide = card(page, "12").locator('[data-su="hide"]');
  await hide.click();
  await expect(page.locator("#msg")).toHaveText("That can't be done right now — reload and try again.");
  await expect(hide).toBeEnabled();
  await card(page, "12").locator('[data-su="pin"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#pmEvent").click();
  await expect(page.locator("#msg")).toHaveText("That spot can't be saved. Try again.");
  await expect(page.locator("#pmEvent")).toBeEnabled();
  await expect(page.locator("#pmHome")).toBeEnabled();
});

test("the list failing to load says why and offers Try again", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  let fails = 1;
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_entries_list: (a, c) => (fails-- > 0 ? { status: 400, body: { code: "P0001", message: "BAD_STATE" } } : ab.rpc.jc_admin_entries_list(a, c)),
  }) });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="signups"]').click();
  await expect(page.locator("#msg")).toHaveText("That can't be done right now — reload and try again.");
  await page.locator("#suRetry").click();
  await expect(page.locator("h2.group")).toHaveText(["Ain Al Maha · 2", "Seef Al Jubail · 1"]);
});

test("switching language keeps a half-typed banner", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerText").fill("Half typed");
  await page.locator("#langBtn").click();
  await expect(page.locator("#bannerText")).toHaveValue("Half typed");
});
