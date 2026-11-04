// Shared stub backends for the events and organizer screens — used by the specs and by
// shots/ (the /shot screenshot harness), so both see the same fake data.
const { expect } = require("@playwright/test");
const { ok, raise, MEMBER } = require("./stub");

// ── Events (T5.1) ──
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

// ── Organizer tools (T5.2) ──
const ADMIN_DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_LIVE_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_PAST_ID = "55555555-5555-4555-8555-555555555555";

function adminBackend(opts = {}) {
  const st = {
    scopes: opts.scopes || [],
    events: [
      { id: ADMIN_DRAFT_ID, slug: "national-day-2026", title_en: "National Day", title_ar: null, description_en: null, description_ar: null,
        starts_at: null, ends_at: null, status: "draft", signups_open: true, features: {}, theme: {},
        payload_schema: { fields: {} }, safety: {}, entries: 0 },
      { id: ADMIN_LIVE_ID, slug: "test-event", title_en: opts.liveTitle || "Test Event", title_ar: null, description_en: "Practice", description_ar: null,
        starts_at: "2026-11-04T04:40:00Z", ends_at: "2026-12-04T04:40:00Z", status: "live", signups_open: true,
        features: { giant_switch: true }, theme: {}, payload_schema: { fields: { treats: { type: "enum", values: ["candy"], required: true } } },
        safety: {}, entries: 3 },
      { id: ADMIN_PAST_ID, slug: "halloween-2026", title_en: "Halloween 2026", status: "archived", signups_open: false,
        starts_at: "2026-10-31T00:00:00Z", features: { giant_switch: true }, payload_schema: { fields: {} }, entries: 124 },
    ],
  };
  const admin = () => st.scopes.includes("events") || st.scopes.includes("community");
  const guard = (fn) => (a) => (admin() ? fn(a) : raise("NOT_ADMIN"));
  const find = (id) => st.events.find((e) => e.id === id);
  return {
    st,
    rpc: Object.assign({
      jc_me_get: (a, c) => (c.signedIn ? ok(Object.assign({}, MEMBER, { admin_scopes: st.scopes })) : raise("NOT_SIGNED_IN")),
      jc_admin_unlock: (a) => {
        const map = { "EVENTS-CODE-1": ["events"], "COMMUNITY-1": ["community"], "PETS-1": ["pets"] };
        if (!map[a.p_code]) return ok({ error: "BAD_ADMIN" });   // T3: wrong code is a 200 with an error body
        st.scopes = map[a.p_code];
        return ok(st.scopes);
      },
      jc_admin_exit: () => { st.scopes = []; return ok(null); },
      jc_admin_events_list: guard(() => ok(st.events)),
      jc_admin_event_save: guard((a) => {
        if (a.p_event === null) {
          st.events.unshift(Object.assign({ id: "66666666-6666-4666-8666-666666666666", status: "draft", signups_open: true,
            features: {}, payload_schema: { fields: {} }, entries: 0 }, a.p_fields));
        } else Object.assign(find(a.p_event), a.p_fields);
        return ok(st.events);
      }),
      jc_admin_event_publish: guard((a) => { find(a.p_event).status = "live"; return ok(st.events); }),
      jc_admin_event_signups: guard((a) => { find(a.p_event).signups_open = a.p_open; return ok(st.events); }),
      jc_event_close: guard((a) => {
        const e = find(a.p_event);
        if (a.p_confirm !== e.slug) return raise("CONFIRM_REQUIRED");
        e.status = "archived"; return ok({ homes: e.entries });
      }),
      jc_admin_code_rotate: (a) => (st.scopes.includes("community")
        ? ok({ scope: a.p_scope, code: "NEWCODE" + a.p_scope.toUpperCase(), version: 2 }) : raise("NOT_ADMIN")),
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

module.exports = { eventsBackend, adminBackend, signIn, LIVE_ID, PAST_ID, SCHEMA, LIVE, PAST, ENTRIES, STATS,
  ADMIN_DRAFT_ID, ADMIN_LIVE_ID, ADMIN_PAST_ID };
