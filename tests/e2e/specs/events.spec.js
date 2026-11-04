// T5.1 — Events: list, detail (map/list), schema-driven signup, withdraw, stats, "Our year".
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_PIN, HOME_V12 } = require("./stub");

const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const PAST_ID = "22222222-2222-4222-8222-222222222222";
const SCHEMA = { fields: {
  treats: { type: "enum", values: ["candy", "non_food", "both"], required: true },
  handout: { type: "enum", values: ["door", "self_serve"], required: true },
  pets_ok: { type: "bool" },
} };
const LIVE = { id: LIVE_ID, slug: "national-day-2026", title_en: "National Day Gathering", title_ar: "اليوم الوطني",
  description_en: "Flags up, doors open.", starts_at: "2026-12-02T14:00:00Z", status: "live", signups_open: true,
  features: {}, theme: {}, payload_schema: SCHEMA, safety: {} };
const PAST = { id: PAST_ID, slug: "halloween-2026", title_en: "Halloween 2026", starts_at: "2026-10-30T20:00:00Z",
  ends_at: "2026-10-31T19:59:00Z", status: "archived", signups_open: false, features: { giant_switch: true },
  payload_schema: { fields: { treats: { type: "enum", values: ["candy", "non_food", "both"], required: true } } } };
const ENTRIES = [
  { id: "e1", mine: false, village: "seef-al-jubail", type: "villa", building: null, number: "3", lat: 24.531, lng: 54.431,
    payload: { treats: "candy", handout: "door" }, note: "Ring twice" },
  { id: "e2", mine: false, village: "ain-al-maha", type: "townhouse", building: null, number: "40", lat: null, lng: null,
    payload: { treats: "both", handout: "self_serve" }, note: null },
];
const STATS = { homes: 124, done: 33, by_village: { "souk-al-jubail": 44, "ain-al-maha": 21, "seef-al-jubail": 26 },
  by_type: { villa: 96, townhouse: 28 }, payload: { treats: { candy: 102, both: 19, non_food: 3 } },
  legacy: { source: "hand-recorded" } };

// A server that keeps the home's entry like jc_event_signup does: payload + note REPLACED wholesale.
function eventsBackend(opts = {}) {
  const st = { mine: opts.mine || null, signupsOpen: opts.signupsOpen !== false };
  const get = () => {
    const entries = ENTRIES.slice();
    if (st.mine && st.mine.status === "in") {
      entries.push({ id: "m", mine: true, village: "ain-al-maha", type: "villa", building: null, number: "12",
        lat: null, lng: null, payload: st.mine.payload, note: st.mine.note });
    }
    return { event: Object.assign({}, LIVE, { signups_open: st.signupsOpen }), mine: st.mine, stats: null, entries };
  };
  return {
    st,
    rpc: Object.assign({
      jc_events_list: () => ok([
        Object.assign({}, LIVE, { homes_in: 37, my_status: st.mine ? st.mine.status : null }),
        Object.assign({}, PAST, { homes_in: 124, my_status: "in" }),
      ]),
      jc_event_get: (a) => a.p_event === PAST_ID
        ? ok({ event: PAST, mine: null, stats: STATS, entries: null })
        : a.p_event === LIVE_ID ? ok(get()) : raise("NOT_FOUND"),
      jc_event_signup: (a) => {
        if (!st.signupsOpen) return raise("SIGNUPS_CLOSED");
        const p = Object.assign({}, a.p_payload); const note = p.note || null; delete p.note;
        st.mine = { id: "m", status: "in", payload: p, note };
        return ok(get());
      },
      jc_entry_withdraw: () => { st.mine = Object.assign({}, st.mine, { status: "withdrawn" }); return ok(get()); },
      jc_my_history: () => ok([{ event_id: PAST_ID, slug: "halloween-2026", title_en: "Halloween 2026",
        starts_at: "2026-10-30T20:00:00Z", event_status: "archived" }]),
    }, opts.rpc || {}),
  };
}

async function signIn(page) {
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
}

test("list: live events, then Past with 'see the numbers'", async ({ page }) => {
  const eb = eventsBackend();
  const { calls } = await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator("h1")).toHaveText("Events");
  const live = page.locator('a[data-event="national-day-2026"]');
  await expect(live).toContainText("National Day Gathering");
  await expect(live).toContainText("37 homes in");
  await expect(live.locator(".pill")).toHaveText("sign-ups open");
  await expect(page.locator("h2.group")).toHaveText("Past");
  await expect(page.locator('a[data-event="halloween-2026"]')).toContainText("see the numbers");
  expect(calls.filter((c) => c.name === "jc_hit").map((c) => c.args.p_page)).toContain("events");
});

test("module off → explained, no blank page", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_events_list: () => raise("MODULE_OFF") } });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator("#msg")).toHaveText("Events aren't open yet in your community.");
});

test("detail: map pins only pinned homes; list groups by village, search, unpinned flagged", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("h1")).toHaveText("National Day Gathering");
  await expect(page.locator("#map path.leaflet-interactive")).toHaveCount(1);   // e2 has no pin
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
  await expect(page.locator("h2.formtitle")).toHaveText("Sign Villa 12 up");
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
  await expect(page.locator("#toSignup")).toHaveText("Sign Villa 12 up");
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
    await page.locator("#map path.leaflet-interactive").nth(1).click();
    await expect(page.locator(".leaflet-popup-content")).toContainText("<svg");
    await expect(page.locator(".leaflet-popup-content")).toContainText("<img");
    await page.locator("#tab-list").click();
    await expect(page.locator(".entries .note").filter({ hasText: "<img" })).toHaveCount(1);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#view img, #view svg[onload]").count()).toBe(0);
  } finally { ENTRIES.pop(); }
});

test("My Home 'Our year' lists joined events; hidden while Events is off", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator("#historySec")).toBeVisible();
  await expect(page.locator("#history a")).toHaveAttribute("href", "../events/?id=" + PAST_ID);
});

test("'Our year' stays hidden when the module is off", async ({ page }) => {
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
  await page.waitForTimeout(300);
  await page.locator("#map path.leaflet-interactive").first().click({ force: true });
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
  await expect(page.locator(".orgnote")).toContainText("Message from the organizers");
  await expect(page.locator(".orgnote")).toContainText("Your pin looks misplaced");
});

test("WhatsApp link: shown when configured, never for a non-WhatsApp URL", async ({ page }) => {
  const eb = eventsBackend();
  let wa = "https://chat.whatsapp.com/AbC123xyz";
  await stubBackend(page, { rpc: Object.assign(eb.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, { links: { whatsapp: wa } })) }) });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.getByRole("link", { name: "Message the organizers on WhatsApp" })).toHaveAttribute("href", wa);
  wa = "javascript:alert(1)";
  await page.goto("events/?id=" + LIVE_ID + "&tab=mine");
  await expect(page.locator("h1")).toHaveText("National Day Gathering");
  await expect(page.getByRole("link", { name: "Message the organizers on WhatsApp" })).toHaveCount(0);
});

// ---- T5.2 PR 1: tabs, no map beside sign-up, pin required → redirect (never refuse) ----

const PIN_NEXT = "../home/?view=pin&next=" + encodeURIComponent("../events/?id=" + LIVE_ID + "&tab=mine");

test("tabs: Map · List · My home; the tab is kept in the URL", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator('.evtabs [role="tab"]')).toHaveText(["Map", "List", "My home"]);
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
  await expect(page.locator("h1")).toHaveText("Pin your home");
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
    await expect(page.locator("#map path.leaflet-interactive")).toHaveCount(1);   // only e1
    await page.locator("#tab-list").click();
    await expect(page.locator(".entries li").filter({ hasText: "Villa 77" })).toContainText("Not on the map yet");
    await expect(page.locator(".entries li").filter({ hasText: "Villa 77" }).locator(".popacts")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { ENTRIES.pop(); }
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
