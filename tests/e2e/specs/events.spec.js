// T5.1 — Events: list, detail (map/list), schema-driven signup, withdraw, stats, "Our Year".
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_PIN, HOME_V12 } = require("./stub");
const { eventsBackend, adminBackend, signIn, LIVE_ID, PAST_ID, SCHEMA, LIVE, PAST, ENTRIES, STATS } = require("./backends");

// Find Me pans the map, and a tap by screen position can land where the pin was, or on a button / the tab bar
// now over it (CI WebKit flakes). Wait until the pin stops moving, then send the tap to the pin itself, once
// (a second tap closes the popup again).
async function tapWhenStill(page, loc) {
  let last = null;
  await expect.poll(async () => {
    const b = await loc.boundingBox();
    const k = b && Math.round(b.x) + "," + Math.round(b.y);
    const still = k !== null && k === last;
    last = k;
    return still;
  }, { intervals: [250], timeout: 10000 }).toBe(true);
  await loc.dispatchEvent("click");
}

test("list: live events with View + Sign up (no status pill), then Past with 'see the numbers'", async ({ page }) => {
  const eb = eventsBackend();
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator("h1")).toHaveText("Events");
  const live = page.locator('[data-event="national-day-2026"]');
  await expect(live).toContainText("National Day Gathering");
  await expect(live).toContainText("37 homes in");
  await expect(live.locator(".pill")).toHaveCount(0);                     // the button says it
  await expect(live.locator(".evacts a")).toHaveText(["View", "Sign Up"]);
  await expect(live.locator(".evacts a").first()).toHaveAttribute("href", "?id=" + LIVE_ID);
  await expect(live.locator(".evacts a").last()).toHaveAttribute("href", "?id=" + LIVE_ID + "&tab=mine");
  await expect(live.locator(".badge")).toHaveCount(0);                    // residents: no Admin badge
  await expect(page.locator("h2.group")).toHaveText("Past");
  await expect(page.locator('[data-event="halloween-2026"] a')).toContainText("see the numbers");
  await expect(page.locator('[data-event="halloween-2026"] .evacts')).toHaveCount(0);
  expect(calls.filter((c) => c.name === "jc_hit").map((c) => c.args.p_page)).toContain("events");
});

test("list: upcoming soonest first (undated last); no Sign up when closed or already in", async ({ page }) => {
  const ev = (slug, starts, extra) => Object.assign({}, LIVE, { id: slug, slug: slug, title_en: slug, starts_at: starts,
    homes_in: 0, my_status: null }, extra || {});
  await stubBackend(page, { rpc: { jc_events_list: () => ok([          // server order: newest first
    ev("late", "2026-12-20T14:00:00Z"),
    ev("undated", null),
    ev("closed", "2026-12-10T14:00:00Z", { signups_open: false }),
    ev("joined", "2026-11-20T14:00:00Z", { my_status: "in" }),
  ]) } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator(".evlist li")).toHaveCount(4);
  expect(await page.locator(".evlist li").evaluateAll((ls) => ls.map((l) => l.dataset.event)))
    .toEqual(["joined", "closed", "late", "undated"]);
  await expect(page.locator('[data-event="closed"]')).toContainText("sign-ups closed");
  await expect(page.locator('[data-event="closed"] .evacts a')).toHaveText(["View"]);
  await expect(page.locator('[data-event="joined"] .evacts a')).toHaveText(["View"]);
  await expect(page.locator('[data-event="late"] .evacts a')).toHaveText(["View", "Sign Up"]);
});

for (const scope of ["events", "community"]) test(`organizers (${scope} scope) see an Admin badge that opens that event's editor`, async ({ page }) => {
  const eb = eventsBackend();
  const ab = adminBackend({ scopes: [scope] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, eb.rpc, {
    jc_admin_events_list: () => ok([Object.assign({}, LIVE, { entries: 0 })]) }) });
  await signIn(page);
  await page.goto("events/");
  const badge = page.locator('[data-event="national-day-2026"] .badge');
  await expect(badge).toHaveText("Admin");
  await expect(badge).toHaveAttribute("href", "../admin/?event=" + LIVE_ID);
  await badge.click();
  await expect(page).toHaveURL(new RegExp("/commons/admin/\\?event=" + LIVE_ID));
  await expect(page.locator("#title_en")).toHaveValue("National Day Gathering");   // straight into the editor
});

test("module off → explained, no blank page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_events_list: () => raise("MODULE_OFF") } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator("#msg")).toHaveText("This section isn't open yet in your community.");   // RM Q1: name-free
});

test("detail: map pins only pinned homes; list groups by village, search, unpinned flagged", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("h1")).toHaveText("National Day Gathering");
  await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(1);   // e2 has no pin
  await page.locator("#tab-list").click();
  await expect(page.locator("h2.group")).toHaveText(["Ain Al Maha · 1", "Seef Al Jubail · 1"]);  // alphabetical, with counts
  await expect(page.locator(".entries li").filter({ hasText: "Townhouse 40" })).toContainText("Not on the map yet");
  await expect(page.locator(".entries li").filter({ hasText: "Villa 3" })).toContainText("Ring twice");
  await page.locator("#q").fill("40");
  await expect(page.locator(".entries li")).toHaveCount(1);
});

test("signup: required answers enforced; full payload + note sent; 'Villa 12 is in'", async ({ page }) => {
  const eb = eventsBackend();
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await page.locator("#tab-mine").click();
  await expect(page.locator("#map")).toHaveCount(0);                     // no map beside sign-up
  await expect(page.locator(".pinline")).toContainText("Villa 12 is pinned on the map.");
  await page.locator("#toSignup").click();
  await expect(page.locator("h2.formtitle")).toHaveText("Sign Up Villa 12");
  await page.locator('[data-field="treats"][data-value=\'"candy"\']').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Please answer the required questions.");
  expect(calls.some((c) => c.name === "jc_event_signup")).toBe(false);
  await page.locator('[data-field="handout"][data-value=\'"door"\']').click();
  await page.locator('[data-field="pets_ok"][data-value="true"]').click();
  await page.locator("#note").fill("Candy at the gate");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 is in.");
  expect(calls.find((c) => c.name === "jc_event_signup").args).toEqual(
    { p_event: LIVE_ID, p_payload: { treats: "candy", handout: "door", pets_ok: true, note: "Candy at the gate" } });
});

// Premortem #1: the server REPLACES payload + note. Changing one answer must resend everything.
test("updating one answer keeps the other answers AND the note", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: "Knock loudly" } });
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator(".status.ok")).toHaveText("Villa 12 is in.");
  await expect(page.locator(".answers")).toContainText("Candy");
  await expect(page.locator(".mynote")).toHaveText("Knock loudly");
  await page.locator("#toSignup").click();
  await expect(page.locator("#note")).toHaveValue("Knock loudly");
  await page.locator('[data-field="treats"][data-value=\'"both"\']').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 is in.");
  expect(calls.filter((c) => c.name === "jc_event_signup").pop().args.p_payload)
    .toEqual({ treats: "both", handout: "door", note: "Knock loudly" });
  expect(eb.st.mine.note).toBe("Knock loudly");
});

test("withdraw (confirmed) → withdrawn, sign-up offered again", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  page.once("dialog", (d) => d.accept());
  await page.locator("#withdraw").click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 has withdrawn.");
  await expect(page.locator("#toSignup")).toHaveText("Sign Up Villa 12");
});

test("sign-ups closed: no sign-up button; a race shows the server's answer", async ({ page }) => {
  const eb = eventsBackend({ signupsOpen: false });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#toSignup")).toHaveCount(0);
  await expect(page.locator("#cta")).toContainText("Sign-ups for this event are closed.");
});

test("no home yet → claim first", async ({ page }) => {
  const eb = eventsBackend();
  const me = Object.assign({}, MEMBER, { home: null });
  await stubBackend(page, { rpc: Object.assign(eb.rpc, { jc_me_get: (a, c) => c.signedIn ? ok(me) : raise("NOT_SIGNED_IN") }) });
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/home\/$/);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#cta a.btn")).toHaveAttribute("href", "../home/");
});

test("archived event → the numbers: totals, villages by name, answers labelled", async ({ page }) => {
  const eb = eventsBackend();
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + PAST_ID);
  await expect(page.locator("h1")).toHaveText("Halloween 2026");
  await expect(page.locator(".big b")).toHaveText(["124", "3", "33"]);
  await expect(page.locator(".bar span").first()).toHaveText("souk-al-jubail");  // not in CONFIG.villages → key shown
  await expect(page.locator(".bar span", { hasText: "Ain Al Maha" })).toHaveCount(1);
  await expect(page.locator(".bar span", { hasText: "Non food" })).toHaveCount(1);
  await expect(page.locator(".help")).toContainText("Hand-recorded");
  expect(calls.filter((c) => c.name === "jc_hit").map((c) => c.args.p_page)).toContain("stats");
});

test("hostile note / house number rendered as text (list + map tooltip)", async ({ page }) => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const eb = eventsBackend();
  ENTRIES.push({ id: "e3", mine: false, village: "ain-al-maha", type: "apartment", building: "<svg onload=alert(1)>",
    number: "1", lat: 24.532, lng: 54.432, payload: {}, note: evil });
  try {
    await stubBackend(page, { rpc: eb.rpc });
    await signIn(page);
    await page.goto("events/?id=" + LIVE_ID);
    await page.locator("#map .leaflet-marker-icon").nth(1).dispatchEvent("click");   // the pin itself, even mid-zoom (flaked under load)
    await expect(page.locator(".leaflet-popup-content")).toContainText("<svg");
    await expect(page.locator(".leaflet-popup-content")).toContainText("<img");
    await page.locator("#tab-list").click();
    await expect(page.locator(".entries .note").filter({ hasText: "<img" })).toHaveCount(1);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#view img, #view svg[onload]").count()).toBe(0);
  } finally { ENTRIES.pop(); }
});

test("My Home 'Our Year' lists joined events; hidden while Events is off", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator("#historySec")).toBeVisible();
  await expect(page.locator("#history a")).toHaveAttribute("href", "../events/?id=" + PAST_ID);
});

test("'Our Year' stays hidden when the module is off", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_my_history: () => raise("MODULE_OFF") } });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator(".homehead b")).toHaveText("Villa 12");
  await page.waitForTimeout(300);
  await expect(page.locator("#historySec")).toBeHidden();
});

test("events page: tab bar marks Events; no CSP violations; Arabic", async ({ page }) => {
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  const eb = eventsBackend();
  await stubBackend(page, { rpc: Object.assign(eb.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, {
    modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } } })) }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "events");
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("اليوم الوطني");
  expect(csp).toEqual([]);
});

// ---- Halloween-site parity (plan audit 2026-11-03) ----

test("tap a pin: answers, note, walking directions + view pin; distance after Find me", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 24.5300, longitude: 54.4300 });
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await page.locator("#locateBtn").click();
  await tapWhenStill(page, page.locator("#map .leaflet-marker-icon").first());
  const pop = page.locator(".leaflet-popup-content");
  await expect(pop).toContainText("Villa 3");
  await expect(pop).toContainText("Candy · Door");
  await expect(pop).toContainText("Ring twice");
  await expect(pop).toContainText(/≈ \d+ m from you/);
  await expect(pop.getByRole("link", { name: "Directions" })).toHaveAttribute("href",
    "https://www.google.com/maps/dir/?api=1&destination=24.531%2C54.431&travelmode=walking");
  await expect(pop.getByRole("link", { name: "Google Maps" })).toHaveAttribute("href", /maps\/search\/\?api=1&query=24\.531%2C54\.431/);
});

test("list: house numbers in natural order (9 before 10); nearest-first after locating", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 24.5400, longitude: 54.4400 });
  ENTRIES.push(
    { id: "n10", mine: false, village: "seef-al-jubail", type: "villa", building: null, number: "10", lat: 24.5399, lng: 54.4399, payload: {}, note: null },
    { id: "n9", mine: false, village: "seef-al-jubail", type: "villa", building: null, number: "9", lat: 24.520, lng: 54.420, payload: {}, note: null });
  try {
    const eb = eventsBackend();
    await stubBackend(page, { rpc: eb.rpc });
    await signIn(page);
    await page.goto("events/?id=" + LIVE_ID);
    await page.locator("#tab-list").click();
    const seef = page.locator("h2.group:has-text('Seef') + ul.entries li b");
    await expect(seef).toHaveText(["Villa 3", "Villa 9", "Villa 10"]);
    await page.locator("#sortDist").click();
    await expect(page.locator("#sortDist")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("h2.group").first()).toContainText("Seef");               // nearest village first
    await expect(page.locator("h2.group:has-text('Seef') + ul.entries li b").first()).toHaveText("Villa 10");  // ~15 m away
  } finally { ENTRIES.splice(-2, 2); }
});

test("event map: satellite / streets toggle", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#layerBtn")).toHaveText("Street");
  const osm = page.waitForRequest(/^https:\/\/tile\.openstreetmap\.org\//);
  await page.locator("#layerBtn").click();
  await expect(page.locator("#layerBtn")).toHaveText("Satellite");
  // OSM answers 403 "Access blocked" to tile requests with no Referer; the page itself is
  // no-referrer (invite / reset tokens in URLs), so the street layer sends the origin only.
  const referer = (await osm).headers()["referer"] || "";
  expect(referer).toMatch(/^https?:\/\/[^/]+\/$/);
});

test("the organizers' note to my home is shown on the event", async ({ page }) => {
  const eb = eventsBackend({ mine: { id: "m", status: "in", payload: { treats: "candy", handout: "door" }, note: null,
    org_note: "Your pin looks misplaced — tap Pin my home" } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator(".orgnote")).toHaveCount(0);                 // it lives on My home
  await page.locator("#tab-mine").click();
  await expect(page.locator(".orgnote")).toContainText("Message From the Organizers");
  await expect(page.locator(".orgnote")).toContainText("Your pin looks misplaced");
});

test("WhatsApp link: shown when configured, never for a non-WhatsApp URL", async ({ page }) => {
  const eb = eventsBackend();
  let wa = "https://chat.whatsapp.com/AbC123xyz";
  await stubBackend(page, { rpc: Object.assign(eb.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, { links: { whatsapp: wa } })) }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.getByRole("link", { name: "Message the Organizers on WhatsApp" })).toHaveAttribute("href", wa);
  wa = "javascript:alert(1)";
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("h1")).toHaveText("National Day Gathering");
  await expect(page.getByRole("link", { name: "Message the Organizers on WhatsApp" })).toHaveCount(0);
});

// ---- T5.2 PR 1: tabs, no map beside sign-up, pin required → redirect (never refuse) ----

const PIN_NEXT = "../home/?view=pin&next=" + encodeURIComponent("../events/?id=" + LIVE_ID + "&tab=mine");

test("tabs: Map · List · My home; the tab is kept in the URL", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator('.subtabs [role="tab"]')).toHaveText(["Map", "List", "Sign Up"]);
  await expect(page.locator("#tab-map")).toHaveAttribute("aria-selected", "true");
  await page.locator("#tab-list").click();
  await expect(page).toHaveURL(new RegExp("events/\\?id=" + LIVE_ID + "&tab=list$"));
  await expect(page.locator("#map")).toHaveCount(0);
  await page.goto("events/?id=" + LIVE_ID + "&tab=nonsense");               // unknown tab → Map
  await expect(page.locator("#tab-map")).toHaveAttribute("aria-selected", "true");
});

test("no pin: My home sends them to pin first — no form, no sign-up call", async ({ page }) => {
  const eb = eventsBackend();
  const { calls } = await stubBackend(page, { rpc: Object.assign(eb.rpc, {
    jc_me_get: (a, c) => c.signedIn ? ok(MEMBER_NO_PIN) : raise("NOT_SIGNED_IN") }) });
  await signIn(page, /\/commons\/(home\/)?$/);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#cta .help")).toContainText("Before Villa 12 can sign up, pin it on the map");
  await expect(page.locator("#toPin")).toHaveAttribute("href", PIN_NEXT);
  await expect(page.locator("#form, #toSignup")).toHaveCount(0);
  expect(calls.some((c) => c.name === "jc_event_signup")).toBe(false);
});

test("server safety net: NO_PIN on sign-up redirects to the pin screen, not an error", async ({ page }) => {
  const eb = eventsBackend({ rpc: { jc_event_signup: () => raise("NO_PIN") } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await page.locator("#toSignup").click();
  await page.locator('[data-field="treats"][data-value=\'"candy"\']').click();
  await page.locator('[data-field="handout"][data-value=\'"door"\']').click();
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/home\/\?view=pin&next=/);
  await expect(page.locator("h1")).toHaveText("Pin Your Home");
});

// T5.1 review Lows: no selector built from schema keys; no in-band "__missing" sentinel.
test("odd schema keys can't break the form; a field named __missing is just a field", async ({ page }) => {
  const odd = { fields: { 'x"y': { type: "text", required: true }, __missing: { type: "bool", required: true } } };
  const eb = eventsBackend({ rpc: { jc_event_get: () => ok({ event: Object.assign({}, LIVE, { payload_schema: odd }),
    mine: null, stats: null, entries: [] }) } });
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await page.locator("#toSignup").click();
  await page.locator("[data-text]").fill("hello");
  await page.locator('[data-field="__missing"][data-value="true"]').click();   // "true" is what tripped the old sentinel
  await page.locator("#go").click();
  await expect.poll(() => calls.filter((c) => c.name === "jc_event_signup").length).toBe(1);
  expect(calls.find((c) => c.name === "jc_event_signup").args.p_payload).toEqual({ 'x"y': "hello", __missing: true });
  expect(errors).toEqual([]);
});

test("non-numeric coordinates are treated as unpinned (no marker, no crash)", async ({ page }) => {
  ENTRIES.push({ id: "bad", mine: false, village: "seef-al-jubail", type: "villa", building: null, number: "77",
    lat: "24.5", lng: "54.4", payload: {}, note: null });
  try {
    const eb = eventsBackend();
    await stubBackend(page, { rpc: eb.rpc });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await signIn(page);
    await page.goto("events/?id=" + LIVE_ID);
    await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(1);   // only e1
    await page.locator("#tab-list").click();
    await expect(page.locator(".entries li").filter({ hasText: "Villa 77" })).toContainText("Not on the map yet");
    await expect(page.locator(".entries li").filter({ hasText: "Villa 77" }).locator(".popacts")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { ENTRIES.pop(); }
});

// The flaky "_leaflet_pos" (3 CI flakes): Leaflet's 250 ms end-of-zoom timer outlived map.remove() when a tab
// switch landed mid-zoom. Forced here: start a zoom and switch tab in the same tick.
test("a tab switch in the middle of a map zoom throws nothing", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#map .leaflet-marker-icon")).not.toHaveCount(0);
  await page.evaluate(() => { map.setZoom(map.getZoom() - 1); document.getElementById("tab-list").click(); });
  await expect(page.locator("#tab-list")).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(500);                                                    // past Leaflet's 250 ms timer
  expect(errors).toEqual([]);
});

// PR #27 review M2 + L1: partial Arabic falls back per choice to English; a choice stored
// as "constructor" never reads Object's built-ins.
test("partly translated choices: Arabic where given, English for the rest; 'constructor' is just a word", async ({ page }) => {
  const schema = { fields: { fruit: { type: "enum", values: ["apple", "banana", "constructor"], label_en: "Fruit",
    labels_en: { apple: "Apple", banana: "Banana", constructor: "Builder" }, labels_ar: { apple: "تفاح" } } } };
  const eb = eventsBackend({ rpc: { jc_event_get: () => ok({ event: Object.assign({}, LIVE, { payload_schema: schema }),
    mine: null, stats: null, entries: [] }) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await page.locator("#langBtn").click();
  await page.locator("#toSignup").click();
  await expect(page.locator('[data-field="fruit"]')).toHaveText(["تفاح", "Banana", "Builder"]);
  await expect(page.locator("#form")).not.toContainText("native code");
});

test("event admins get the Admin badge only on the events they run", async ({ page }) => {
  const other = Object.assign({}, LIVE, { id: "99999999-9999-4999-8999-999999999999", slug: "other-live", title_en: "Other" });
  await stubBackend(page, { rpc: {
    jc_me_get: (a, c) => (c.signedIn ? ok(Object.assign({}, MEMBER, { admin_events: [LIVE_ID] })) : raise("NOT_SIGNED_IN")),
    jc_events_list: () => ok([Object.assign({}, LIVE, { homes_in: 1, my_status: null }), Object.assign({}, other, { homes_in: 0, my_status: null })]),
  } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator('[data-event="national-day-2026"] .badge')).toHaveAttribute("href", "../admin/?event=" + LIVE_ID);
  await expect(page.locator('[data-event="other-live"] .badge')).toHaveCount(0);
});

// ── Zee 2026-11-04: event page above the fold ──
test("event page: back lives in the top bar (left of the logo), not a '‹ Events' line; none on the list", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  const back = page.locator(".topbar #jcBackBtn");
  await expect(back).toHaveAttribute("href", "./");
  await expect(back).toHaveAttribute("aria-label", "Events");
  const [b, logo] = [await back.boundingBox(), await page.locator(".topbar a.home").boundingBox()];
  expect(b.x + b.width).toBeLessThanOrEqual(logo.x + 1);                       // left of the logo
  await expect(page.locator("#view .links")).toHaveCount(0);
  await back.click();
  await expect(page.locator("h1")).toHaveText("Events");
  await expect(page.locator("#jcBackBtn")).toHaveCount(0);
});

test("event page: the whole map fits between the tabs and the tab bar — no scrolling", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  const map = page.locator("#map");
  await expect(map).toBeVisible();
  const bar = await page.locator("#tabbar").boundingBox();
  // the stub has an unpinned home, so the "not on the map yet" line sits under the map: it fits too
  const last = await page.locator("#mapAfter").boundingBox();
  const m = await map.boundingBox();
  expect(m.y + m.height).toBeLessThan(last.y);
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);                      // nothing hidden behind the tab bar
  expect(bar.y - (last.y + last.height)).toBeLessThan(24);                      // and no wasted space under it
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThan(30);
});

test("event page: a long description shows two lines and More / Less; the RTL back arrow is mirrored", async ({ page }) => {
  const long = Array(12).fill("Bring a lantern, meet neighbors, share sweets.").join(" ");
  const eb = eventsBackend({ rpc: { jc_event_get: () => ok({ event: Object.assign({}, LIVE, { description_en: long }),
    mine: null, stats: null, entries: ENTRIES }) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  const desc = page.locator("#desc");
  const h2 = (await desc.boundingBox()).height;
  expect(h2).toBeLessThan(60);                                                 // ~2 lines at 15px/1.6
  await page.locator("#descMore").click();
  await expect(page.locator("#descMore")).toHaveText("Less");
  expect((await desc.boundingBox()).height).toBeGreaterThan(h2 * 2);
  await page.locator("#langBtn").click();
  const t = await page.locator("#jcBackBtn svg").evaluate((s) => getComputedStyle(s).transform);
  expect(t).toBe("matrix(-1, 0, 0, 1, 0, 0)");
});

test("event page: a short description has no More button", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#desc")).toHaveText("Flags up, doors open.");
  await expect(page.locator("#descMore")).toBeHidden();
});

test("Arabic map: Streets / Satellite never sits on top of the zoom buttons", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const z = await page.locator(".leaflet-control-zoom").boundingBox();
  const l = await page.locator("#layerBtn").boundingBox();
  expect(l.x).toBeGreaterThan(z.x + z.width);                                   // apart, not overlapping
});

test("back label follows the language, even where the view doesn't re-render (load error)", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_event_get: () => raise("NOT_FOUND") } });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#jcBackBtn")).toHaveAttribute("aria-label", "Events");
  await page.locator("#langBtn").click();
  await expect(page.locator("#jcBackBtn")).toHaveAttribute("aria-label", "الفعاليات");
  const b = await page.locator("#jcBackBtn").boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(44);                                     // Apple's tap-target minimum
});

// ── T5.2 PR 4b: one-place events (kind "venue") ──
const VENUE_ID = "88888888-8888-4888-8888-888888888888";
const VENUE = Object.assign({}, LIVE, { id: VENUE_ID, slug: "kids-market", title_en: "Kids Market", kind: "venue", look: "market",
  venue_name_en: "Central Park", venue_name_ar: "الحديقة المركزية", venue_lat: 24.531, venue_lng: 54.432,
  capacity: 10, spots: true, households_in: 7, places_left: 3,
  payload_schema: { fields: { selling: { type: "enum", values: ["toys", "food"], required: true, label_en: "What will you sell?",
    labels_en: { toys: "Toys", food: "Food" } } } } });
function venueBackend(over = {}) {
  const st = { mine: over.mine || null, ev: Object.assign({}, VENUE, over.ev || {}) };
  const get = () => ({ event: st.ev, mine: st.mine, stats: null, entries: [] });     // venue: never which homes
  return { st, rpc: {
    jc_events_list: () => ok([Object.assign({}, st.ev, { homes_in: st.ev.households_in, full: st.ev.places_left === 0,
      my_status: st.mine ? st.mine.status : null })]),
    jc_event_get: () => ok(get()),
    jc_event_signup: (a) => {
      if (over.fullOnSignup) { st.ev = Object.assign({}, st.ev, { households_in: 10, places_left: 0 }); return raise("FULL"); }
      const p = Object.assign({}, a.p_payload); delete p.note;
      st.mine = { id: "m", status: "in", payload: p, note: a.p_payload.note || null, spot: null };
      st.ev = Object.assign({}, st.ev, { households_in: st.ev.households_in + 1, places_left: st.ev.places_left - 1 });
      return ok(get());
    },
    jc_entry_withdraw: () => { st.mine = Object.assign({}, st.mine, { status: "withdrawn" }); return ok(get()); },
  } };
}

test("one-place: list says households coming + where; map is the place with Directions; no List tab", async ({ page }) => {
  const vb = venueBackend();
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator('[data-event="kids-market"] small')).toContainText("at Central Park · 7 households coming");
  await page.goto("events/?id=" + VENUE_ID + "&tab=list");                       // List doesn't exist here → Map
  await expect(page.locator(".subtabs button")).toHaveText(["Map", "Sign Up"]);
  await expect(page.locator(".evhead .sub")).toContainText("7 households coming · 3 places left");
  await expect(page.locator(".venueline")).toContainText("Central Park");
  await expect(page.locator(".venueline a")).toHaveAttribute("href", /destination=24\.531%2C54\.432/);
  await expect(page.locator(".leaflet-tooltip")).toHaveText("Central Park");
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(1);          // one pin: the place
});

test("one-place: no home pin needed — sign up, 'is coming', spot pending then shown", async ({ page }) => {
  const vb = venueBackend();
  const { calls } = await stubBackend(page, { rpc: Object.assign({}, vb.rpc,
    { jc_me_get: (a, c) => (c.signedIn ? ok(MEMBER_NO_PIN) : raise("NOT_SIGNED_IN")) }) });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID + "&tab=mine");
  await page.locator("#toSignup").click();                                        // straight to the form, not the pin screen
  await expect(page).toHaveURL(/events\//);
  await page.locator('[data-field="selling"][data-value="\\"food\\""]').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 is coming.");
  expect(calls.filter((c) => c.name === "jc_event_signup")).toHaveLength(1);
  await expect(page.locator(".spot")).toHaveText("The organizers will give you a spot number.");
  await expect(page.locator(".pinline")).toHaveCount(0);
  await expect(page.locator(".evhead .sub")).toContainText("8 households coming · 2 places left");
  vb.st.mine.spot = "B2";
  await page.reload();
  await expect(page.locator(".spot")).toHaveText("Your spot: B2");
});

test("one-place full: no Sign up anywhere, says Full", async ({ page }) => {
  const vb = venueBackend({ ev: { households_in: 10, places_left: 0 } });
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator('[data-event="kids-market"] small')).toContainText("Full");
  await expect(page.locator('[data-event="kids-market"] .evacts a')).toHaveText(["View"]);
  await page.goto("events/?id=" + VENUE_ID + "&tab=mine");
  await expect(page.locator(".evhead .sub")).toContainText("Full");
  await expect(page.locator("#toSignup")).toHaveCount(0);
  await expect(page.locator("#cta")).toContainText("This event is full.");
});

test("one-place: the last place goes while the form is open → FULL, fresh count", async ({ page }) => {
  const vb = venueBackend({ fullOnSignup: true });
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID + "&tab=mine");
  await page.locator("#toSignup").click();
  await page.locator('[data-field="selling"][data-value="\\"toys\\""]').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("This event is full.");
  await expect(page.locator(".evhead .sub")).toContainText("Full");
  await expect(page.locator("#form")).toHaveCount(0);
});

test("one-place in Arabic: place name, counts, tabs", async ({ page }) => {
  const vb = venueBackend();
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID);
  await page.locator("#langBtn").click();
  await expect(page.locator(".evhead .sub")).toContainText("المنازل الحاضرة: 7 · الأماكن المتبقية: 3");   // number-safe Arabic
  await expect(page.locator(".venueline")).toContainText("الحديقة المركزية");
  await expect(page.locator(".subtabs button")).toHaveText(["الخريطة", "التسجيل"]);
});

test("one-place archive: households total only, no villages", async ({ page }) => {
  const ev = Object.assign({}, VENUE, { status: "archived" });
  await stubBackend(page, { rpc: { jc_event_get: () => ok({ event: ev, mine: null, entries: null,
    stats: { homes: 23, done: 0, by_village: {}, by_type: {}, payload: { selling: { toys: 15, food: 8 } } } }) } });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID);
  await expect(page.locator(".big b")).toHaveText(["23"]);
  await expect(page.locator(".big span")).toHaveText(["households"]);
  await expect(page.getByText("By village")).toHaveCount(0);
  await expect(page.locator("h2.group")).toHaveText(["What will you sell?"]);
});

// ── PR 4b review fixes ──
test("one-place: an organizer-typed place name is shown as text, never run as HTML (map label + line)", async ({ page }) => {
  const vb = venueBackend({ ev: { venue_name_en: '<img src=x onerror="window.__xss=1"><b>Park</b>' } });
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID);
  await expect(page.locator(".leaflet-tooltip")).toHaveText('<img src=x onerror="window.__xss=1"><b>Park</b>');
  await expect(page.locator(".leaflet-tooltip img, .leaflet-tooltip b, .venueline img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("one-place: no usable location → name without Directions, no broken pin", async ({ page }) => {
  const vb = venueBackend({ ev: { venue_lng: null } });
  await stubBackend(page, { rpc: vb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID);
  await expect(page.locator(".venueline")).toHaveText("📍 Central Park");
  await expect(page.locator(".venueline a")).toHaveCount(0);
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(0);
});

test("one-place: list counts every household like the event page (households_in), singular wording", async ({ page }) => {
  const vb = venueBackend({ ev: { households_in: 1, places_left: 1, capacity: 2 } });
  await stubBackend(page, { rpc: Object.assign({}, vb.rpc, {
    jc_events_list: () => ok([Object.assign({}, vb.st.ev, { homes_in: 0, households_in: 1, full: false, my_status: null })]),   // the 1 is hidden
  }) });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator('[data-event="kids-market"] small')).toContainText("1 household coming");
  await page.goto("events/?id=" + VENUE_ID);
  await expect(page.locator(".evhead .sub")).toContainText("1 household coming · 1 place left");
});

test("one-place: FULL and then the refresh fails → form closed anyway, says Full", async ({ page }) => {
  const vb = venueBackend({ fullOnSignup: true });
  let gets = 0;
  await stubBackend(page, { rpc: Object.assign({}, vb.rpc, {
    jc_event_get: (a, c) => (++gets > 1 ? raise("NETWORK") : vb.rpc.jc_event_get(a, c)),
  }) });
  await signIn(page);
  await page.goto("events/?id=" + VENUE_ID + "&tab=mine");
  await page.locator("#toSignup").click();
  await page.locator('[data-field="selling"][data-value="\\"toys\\""]').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("This event is full.");
  await expect(page.locator("#form")).toHaveCount(0);
});

// ── Zee 2026-11-05: tab label, formatted descriptions ──
test("own-entry tab: 'Sign Up' until this home is in, then 'My Sign-Up'", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("#tab-mine")).toHaveText("Sign Up");
  await page.locator("#toSignup").click();
  await page.locator('[data-field="treats"][data-value="\\"candy\\""]').click();
  await page.locator('[data-field="handout"][data-value="\\"door\\""]').click();
  await page.locator("#go").click();
  await expect(page.locator("#tab-mine")).toHaveText("My Sign-Up");
});

test("description: heading, bold, underline, bullets, numbers render; anything else stays text", async ({ page }) => {
  const d = "## Bring a lantern\n**Free** sweets for __everyone__\n- nut-free table\n- face paint\n1. Meet at 7\n2. Walk together\n<img src=x onerror=\"window.__x=1\"> & <b>not bold</b>";
  const eb = eventsBackend({ rpc: { jc_event_get: () => ok({ event: Object.assign({}, LIVE, { description_en: d }), mine: null, stats: null, entries: ENTRIES }) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await page.locator("#descMore").click();
  const desc = page.locator("#desc");
  await expect(desc.locator("h3")).toHaveText("Bring a lantern");
  await expect(desc.locator("strong")).toHaveText("Free");
  await expect(desc.locator("u")).toHaveText("everyone");
  await expect(desc.locator("ul li")).toHaveText(["nut-free table", "face paint"]);
  await expect(desc.locator("ol li")).toHaveText(["Meet at 7", "Walk together"]);
  await expect(desc.locator("img, b")).toHaveCount(0);                          // typed tags are text
  await expect(desc).toContainText('<img src=x onerror="window.__x=1"> & <b>not bold</b>');
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

// ── T5.4 coming soon (residents) ──
test("coming soon: badge on the list, no Sign Up; the event page says sign-ups open soon", async ({ page }) => {
  const soon = Object.assign({}, LIVE, { signups_open: false, coming_soon: true });
  await stubBackend(page, { rpc: {
    jc_events_list: () => ok([Object.assign({}, soon, { homes_in: 0, my_status: null })]),
    jc_event_get: () => ok({ event: soon, mine: null, stats: null, entries: [] }),
  } });
  await signIn(page);
  await page.goto("events/");
  const card = page.locator('[data-event="national-day-2026"]');
  await expect(card.locator(".soon")).toHaveText("Coming Soon");
  await expect(card.locator("small")).not.toContainText("coming soon");            // said once, by the badge
  await expect(card.locator("small")).not.toContainText("homes in");               // no count before sign-ups open
  await expect(card.locator(".evacts a")).toHaveText(["View"]);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator(".evhead .sub")).toContainText("coming soon");
  await expect(page.locator(".evhead .sub")).not.toContainText("homes in");
  await expect(page.locator("#cta")).toContainText("Sign-ups open soon — check back here.");
  await expect(page.locator("#toSignup")).toHaveCount(0);
});

test("coming soon vs paused: a paused event has no badge and says sign-ups closed", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_events_list: () => ok([Object.assign({}, LIVE, { signups_open: false, coming_soon: false, homes_in: 4, my_status: null })]) } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator(".soon")).toHaveCount(0);
  await expect(page.locator('[data-event="national-day-2026"] small')).toContainText("4 homes in · sign-ups closed");
});

test("coming soon one-place event without its place: the map says it'll be announced", async ({ page }) => {
  const soon = Object.assign({}, LIVE, { kind: "venue", venue_name_en: null, venue_lat: null, venue_lng: null,
    signups_open: false, coming_soon: true, households_in: 0, places_left: null, capacity: null });
  await stubBackend(page, { rpc: { jc_event_get: () => ok({ event: soon, mine: null, stats: null, entries: [] }) } });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator(".venueline")).toHaveText("📍 The place will be announced soon.");
  await expect(page.locator(".venueline a")).toHaveCount(0);
});

test("coming soon: a closed event never shows the badge", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_events_list: () => ok([Object.assign({}, PAST, { coming_soon: true, homes_in: 3, my_status: null })]) } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator(".soon")).toHaveCount(0);
});

// Zee 2026-11-05: Sign Up label invisible on desktop — `a:visited` (more specific than .btn) painted the
// label accent-on-accent once the link had been opened. Browsers hide :visited from getComputedStyle,
// so check the loaded rules: every :visited color rule must be matched by a.btn:visited / a.btn.ghost:visited.
test("link-buttons keep their label color after the link is visited", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator(".evacts a.btn").first()).toBeVisible();
  const visited = await page.evaluate(() => {
    const out = {};
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (!r.selectorText || !r.style.color) continue;
        r.selectorText.split(",").map((s) => s.trim()).filter((s) => s.includes(":visited"))
          .forEach((s) => { out[s] = r.style.color.trim(); });
      }
    }
    return out;
  });
  expect(visited["a:visited"]).toBeTruthy();                       // the rule that caused it is still there
  expect(visited["a.btn:visited"]).toBe("var(--jc-accent-ink)");
  expect(visited["a.btn.ghost:visited"]).toBe("var(--jc-ink)");
});

// Zee 2026-11-05: every page drew "Jubail Commons" until the config arrived, then the real name
// ("E2E Test Commons") — a flash of the wrong community. Now: last name seen, else neutral "Commons".
test("header never flashes another community's name while the config loads", async ({ page }) => {
  const eb = eventsBackend();
  const E2E = Object.assign({}, CONFIG, { id: "e2e", name_en: "E2E Test Commons", name_ar: "كومنز التجربة" });
  let release, gate;
  const hold = () => { gate = new Promise((r) => { release = r; }); };
  hold();
  await stubBackend(page, { rpc: Object.assign({}, eb.rpc, { jc_config_get: () => gate.then(() => ok(E2E)) }) });
  await signIn(page);
  await page.evaluate(() => localStorage.removeItem("jc_name"));
  hold();
  await page.goto("events/");
  await expect(page.locator("#homeLink")).toHaveText("Commons");                 // nothing saved yet: neutral
  await page.waitForTimeout(300);
  await expect(page.locator("#homeLink")).toHaveText("Commons");                 // …and stays so while loading
  release();
  await expect(page.locator("#homeLink")).toHaveText("E2E Test Commons");
  hold();
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#homeLink")).toHaveText("E2E Test Commons");        // next page: right name at once
  release();
});

test("tab bar is slim (≤ 56px) and each tab is still ≥ 44px to tap", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  const bar = await page.locator("#tabbar").boundingBox();
  expect(bar.height).toBeLessThanOrEqual(56);
  for (const b of await page.locator("#tabbar a").all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test("event page: an Admin button on the title's line for organizers and this event's admins only", async ({ page, browser }) => {
  const { adminBackend: ab0 } = require("./backends");
  const eb = eventsBackend();
  const admin = ab0({ scopes: ["community"] });
  await stubBackend(page, { rpc: Object.assign({}, eb.rpc, { jc_me_get: admin.rpc.jc_me_get }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  const btn = page.locator("#evAdmin");
  await expect(btn).toHaveText("Admin");
  await expect(btn).toHaveAttribute("href", "../admin/?event=" + LIVE_ID);
  const [b, lang, h1] = [await btn.boundingBox(), await page.locator("#langBtn").boundingBox(), await page.locator("h1").boundingBox()];
  // on the title's line (Zee, 2026-11-07): it overlaps the h1 vertically and sits after it
  expect(b.y).toBeLessThan(h1.y + h1.height);
  expect(b.y + b.height).toBeGreaterThan(h1.y);
  expect(b.x).toBeGreaterThanOrEqual(h1.x + h1.width - 1);
  expect(Math.abs((b.x + b.width) - (lang.x + lang.width))).toBeLessThan(4); // right-aligned with the language button
  // a resident: no button — and the title sits exactly where it does for the organizer (no row pushed in)
  const p2 = await browser.newPage({ ...test.info().project.use });
  await stubBackend(p2, { rpc: eventsBackend().rpc });
  await signIn(p2);
  await p2.goto("events/?id=" + LIVE_ID);
  await expect(p2.locator("h1")).toBeVisible();
  await expect(p2.locator("#evAdmin")).toHaveCount(0);
  expect(Math.abs((await p2.locator("h1").boundingBox()).y - h1.y)).toBeLessThan(2);
  await p2.close();
});

for (const [who, opts, shown] of [
  ["this event's own admin", { adminEvents: ["11111111-1111-4111-8111-111111111111"] }, true],
  ["an admin of a different event", { adminEvents: ["44444444-4444-4444-8444-444444444444"] }, false],
  ["an events organizer (code)", { scopes: ["events"] }, true],
  ["the platform owner with no admin scope", { owner: true }, false],
]) {
  test(`event page Admin button: ${who} → ${shown ? "shown" : "hidden"}`, async ({ page }) => {
    const { adminBackend: ab0 } = require("./backends");
    const admin = ab0(opts);
    await stubBackend(page, { rpc: Object.assign({}, eventsBackend().rpc, { jc_me_get: admin.rpc.jc_me_get }) });
    await signIn(page);
    await page.goto("events/?id=" + LIVE_ID);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#evAdmin")).toHaveCount(shown ? 1 : 0);
  });
}

test("event page Admin button sits on the language button's side in Arabic too", async ({ page }) => {
  const { adminBackend: ab0 } = require("./backends");
  await page.addInitScript(() => localStorage.setItem("jc_lang", "ar"));
  await stubBackend(page, { rpc: Object.assign({}, eventsBackend().rpc, { jc_me_get: ab0({ scopes: ["community"] }).rpc.jc_me_get }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  const [b, lang] = [await page.locator("#evAdmin").boundingBox(), await page.locator("#langBtn").boundingBox()];
  expect(Math.abs(b.x - lang.x)).toBeLessThan(4);                           // both on the left in RTL
  const h1 = await page.locator("h1").boundingBox();
  expect(b.y).toBeLessThan(h1.y + h1.height);                               // on the title's line in RTL too
  expect(b.x + b.width).toBeLessThanOrEqual(h1.x + 1);                      // …at its end (the left)
});

// Event-page polish (Zee, 2026-11-07): the map, bigger — a CSS expand (iOS Safari has no element Fullscreen API)
async function openMap(page, lang, id) {
  if (lang) await page.addInitScript((l) => localStorage.setItem("jc_lang", l), lang);
  await stubBackend(page, { rpc: eventsBackend().rpc });
  await signIn(page);
  await page.goto("events/?id=" + (id || LIVE_ID) + "&tab=map");
  await expect(page.locator("#map .leaflet-control-zoom")).toBeVisible();
}
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function controlsDontCollide(page) {
  const boxes = [];
  for (const sel of ["#fullBtn", "#locateBtn", "#layerBtn", ".leaflet-control-zoom"]) boxes.push(await page.locator(sel).boundingBox());
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
}

test("map: Full Screen fills the screen over the tab bar, Leaflet re-measures, Close Map (and Escape) put it back", async ({ page }) => {
  await openMap(page);
  const before = await page.locator("#map").boundingBox();
  await expect(page.locator("#fullBtn")).toHaveText("Full Screen");
  await controlsDontCollide(page);
  await page.locator("#fullBtn").click();
  await expect(page.locator(".evmapwrap")).toHaveClass(/\bfull\b/);
  await expect(page.locator("#fullBtn")).toHaveText("Close Map");
  await expect(page.locator("#fullBtn")).toHaveAttribute("aria-pressed", "true");
  const vp = page.viewportSize();
  const full = await page.locator("#map").boundingBox();
  expect(Math.round(full.width)).toBe(vp.width);
  expect(Math.round(full.height)).toBe(vp.height);
  // over the tab bar: the bottom of the screen is the map
  expect(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight - 5).closest(".evmapwrap"))).toBe(true);
  // Leaflet re-measured (invalidateSize): its own idea of the size is the full box
  await expect.poll(() => page.evaluate(() => {
    const p = document.querySelector("#map .leaflet-control-container .leaflet-bottom.leaflet-right").getBoundingClientRect();
    return Math.round(p.bottom) === innerHeight;
  })).toBe(true);
  await controlsDontCollide(page);
  await page.locator("#fullBtn").click();
  await expect(page.locator(".evmapwrap")).not.toHaveClass(/\bfull\b/);
  await expect(page.locator("#fullBtn")).toHaveText("Full Screen");
  expect(Math.abs((await page.locator("#map").boundingBox()).height - before.height)).toBeLessThan(3);
  expect(await page.evaluate(() => document.body.classList.contains("mapfull"))).toBe(false);
  await page.locator("#fullBtn").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".evmapwrap")).not.toHaveClass(/\bfull\b/);
});

test("map: Full Screen in Arabic — its own words, the controls still apart", async ({ page }) => {
  await openMap(page, "ar");
  await expect(page.locator("#fullBtn")).toHaveText("ملء الشاشة");
  await controlsDontCollide(page);
  await page.locator("#fullBtn").click();
  await expect(page.locator("#fullBtn")).toHaveText("أغلق الخريطة");
  await controlsDontCollide(page);
});

test("map: a redraw while full screen (language) gives the page back", async ({ page }) => {
  await openMap(page);
  await page.locator("#fullBtn").click();
  await expect(page.locator(".evmapwrap")).toHaveClass(/\bfull\b/);
  await page.locator("#langBtn").evaluate((b) => b.click());       // under the map: clicked by script
  await expect(page.locator("#fullBtn")).toHaveText("ملء الشاشة");
  await expect(page.locator(".evmapwrap")).not.toHaveClass(/\bfull\b/);
  expect(await page.evaluate(() => document.body.classList.contains("mapfull"))).toBe(false);
});

test("map: full screen with a pin's popup open — Close Map stays visible (the other overlays step aside)", async ({ page }) => {
  const { PINS_ID } = require("./backends");
  await openMap(page, null, PINS_ID);
  await page.locator("#fullBtn").click();
  await page.locator("#map .leaflet-marker-icon").first().dispatchEvent("click");
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  await expect(page.locator("#layerBtn")).toBeHidden();                           // the popopen rule, unchanged
  await expect(page.locator("#fullBtn")).toBeVisible();
  await page.locator("#fullBtn").click();
  await expect(page.locator(".evmapwrap")).not.toHaveClass(/\bfull\b/);
});

test("map: Escape with Map Labels open closes only the window, the map stays full screen", async ({ page }) => {
  const { PINS_ID } = require("./backends");
  await openMap(page, null, PINS_ID);
  await page.locator("#fullBtn").click();
  await page.locator("#labelsBtn").click();
  await expect(page.locator("#labels")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#labels")).toBeHidden();
  await expect(page.locator(".evmapwrap")).toHaveClass(/\bfull\b/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".evmapwrap")).not.toHaveClass(/\bfull\b/);
});
