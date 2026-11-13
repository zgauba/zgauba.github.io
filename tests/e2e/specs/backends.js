// Shared stub backends for the events and organizer screens — used by the specs and by
// shots/ (the /shot screenshot harness), so both see the same fake data.
const { expect } = require("@playwright/test");
const { ok, raise, MEMBER, CONFIG } = require("./stub");

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

// ── T5.2 PR 5a: pins + looks ──
// Halloween-parity pins: icon question (teal = allergy-friendly), ring question, done / reported homes.
const PIN_SCHEMA = { fields: {
  treats: { type: "enum", values: ["candy", "non_food", "both"], required: true, pin: "glyph",
    labels_en: { candy: "Candy only", non_food: "Non-food", both: "Both" },
    glyphs: { candy: "🍬", non_food: "🎃", both: "🍬🎃" }, allergy_friendly: ["non_food"] },
  entrance: { type: "enum", values: ["front", "garden", "both"], required: true, pin: "ring",
    labels_en: { front: "Front gate", garden: "Garden gate", both: "Both gates" }, ring_split: ["both"] },
} };
const home = (id, n, lat, payload, extra) => Object.assign({ id, mine: false, village: "seef-al-jubail", type: "villa",
  building: null, number: n, lat, lng: 54.431, payload, note: null, live_state: "active", supply_level: null, reported_out: false }, extra || {});
const PIN_ENTRIES = [
  home("a", "1", 24.521, { treats: "candy", entrance: "front" }),
  home("b", "2", 24.526, { treats: "non_food", entrance: "garden" }),
  home("c", "3", 24.531, { treats: "both", entrance: "both" }, { live_state: "done" }),
  home("d", "4", 24.536, { treats: "candy", entrance: "front" }, { reported_out: true }),
  home("m", "12", 24.541, { treats: "candy", entrance: "garden" }, { mine: true }),
  home("e", "5", 24.546, { treats: "both", entrance: "both" }),
];
function pinEvent(extra, entries) {
  return { event: Object.assign({}, LIVE, { kind: "homes", look: "halloween", payload_schema: PIN_SCHEMA,
    features: { giant_switch: true, crowd_reports: true } }, extra || {}), mine: null, stats: null, entries: entries || PIN_ENTRIES };
}
// Haq al Laila: nut-free is the allergy-friendly choice, so 🧡 shows teal
const HAQ_SCHEMA = { fields: {
  treats: { type: "enum", values: ["mix", "nut_free", "both"], required: true, pin: "glyph",
    labels_en: { mix: "Sweets & nuts", nut_free: "Nut-free", both: "Both" },
    glyphs: { mix: "🥜", nut_free: "🧡", both: "🥜🧡" }, allergy_friendly: ["nut_free"] },
  entrance: PIN_SCHEMA.fields.entrance,
} };
const HAQ_ENTRIES = PIN_ENTRIES.map((e, i) => Object.assign({}, e,
  { payload: Object.assign({}, e.payload, { treats: ["mix", "nut_free", "both", "nut_free", "mix", "both"][i] }) }));
const PINS_ID = "88888888-8888-4888-8888-888888888888";
const HAQ_ID = "99999999-9999-4999-8999-999999999999";
const PINS_EVENT = pinEvent({ id: PINS_ID, slug: "halloween-2027", title_en: "Halloween 2027" });
const HAQ_EVENT = pinEvent({ id: HAQ_ID, slug: "haq-al-laila-2027", title_en: "Haq al Laila", title_ar: "حق الليلة",
  look: "haq_al_laila", payload_schema: HAQ_SCHEMA }, HAQ_ENTRIES);

// ── R2b-2: holiday lights (a homes event, each decorated home a stop) with its safety box on ──
const LIGHTS_SCHEMA = { fields: {
  view: { type: "enum", values: ["street", "garden", "both"], required: true, pin: "ring",
    labels_en: { street: "The street", garden: "The garden", both: "Both" }, ring_split: ["both"] },
  lights: { type: "enum", values: ["warm", "colour", "music"], required: true, pin: "glyph",
    labels_en: { warm: "Warm white", colour: "Colourful", music: "Lights and music" },
    glyphs: { warm: "💡", colour: "🌈", music: "🎶" } },
} };
const LIGHTS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIGHTS_SAFETY = { phone: "+971 2 555 0100", meeting_en: "The clubhouse gate", meeting_ar: "بوابة النادي" };
const LIGHTS_ENTRIES = PIN_ENTRIES.map((e, i) => Object.assign({}, e, {
  payload: { view: ["street", "garden", "both", "street", "garden", "both"][i], lights: ["warm", "colour", "music", "warm", "music", "colour"][i] } }));
const LIGHTS_EVENT = pinEvent({ id: LIGHTS_ID, slug: "holiday-lights-2026", title_en: "Holiday Lights", title_ar: "أضواء الزينة",
  description_en: "Walk the lit streets — every pin is a decorated home.", description_ar: "تجوّلوا في الشوارع المضاءة — كل دبوس منزل مزيَّن.",
  look: "holiday_lights", payload_schema: LIGHTS_SCHEMA, features: { giant_switch: true, safety: true }, safety: LIGHTS_SAFETY }, LIGHTS_ENTRIES);

// ── T5.2 PR 5b: event day ──
// A treat night happening NOW (started 1 h ago, ends in 3 h), this home signed up, every feature on.
// Keeps state like the real RPCs: the switch + supply on this home's entry, reports (going "done"
// clears them), and the household's "we're not out". opts.startsIn moves the start (ms from now).
const DAY_ID = "66666666-6666-4666-8666-666666666666";
function dayBackend(opts = {}) {
  const now = Date.now(), startsIn = opts.startsIn != null ? opts.startsIn : -3600e3;
  const st = { live: "active", supply: opts.supply != null ? opts.supply : null, reportsOpen: opts.reportsOpen || 0, gets: 0,
    status: opts.status || "in", orgAdjusted: opts.orgAdjusted || null, orgWithdrawn: opts.orgWithdrawn || null,   // R2b-1
    others: PIN_ENTRIES.filter((e) => !e.mine).map((e) => Object.assign({}, e)) };
  const event = pinEvent(Object.assign({ id: DAY_ID, slug: "halloween-tonight", title_en: "Halloween Tonight",
    starts_at: new Date(now + startsIn).toISOString(), ends_at: new Date(now + startsIn + 4 * 3600e3).toISOString(),
    features: { giant_switch: true, supply: true, crowd_reports: true } }, opts.event || {})).event;
  const mineEntry = PIN_ENTRIES.find((e) => e.mine);
  const get = () => ({
    event, stats: null,
    mine: Object.assign({ id: "m", status: st.status, payload: mineEntry.payload, note: null, live_state: st.live, supply_level: st.supply,
            org_note: null, hidden: false, reports_locked_until: null, spot: null, reports_open: st.reportsOpen },
            // R2b-1 keys; opts.oldServer = a server from before R2b-1 (no keys at all)
            opts.oldServer ? {} : { org_adjusted_at: st.orgAdjusted, org_withdrawn_at: st.orgWithdrawn }),
    entries: st.others.concat(st.status === "in" ? [Object.assign({}, mineEntry, { live_state: st.live, supply_level: st.supply })] : []),
  });
  const feat = (k) => event.features[k] === true;
  return {
    st, event,
    rpc: Object.assign({
      // the reply is what the server held when the request ARRIVED; st.hold (a Promise) answers it late
      jc_event_get: async () => {
        st.gets++;
        const reply = st.getFails ? raise("UNKNOWN") : ok(get()), hold = st.hold;
        if (hold) await hold;
        return reply;
      },
      jc_entry_live_set: (a) => {
        if (a.p_state != null && !feat("giant_switch")) return raise("FEATURE_OFF");
        if (a.p_supply != null && !feat("supply")) return raise("FEATURE_OFF");
        if (a.p_state != null) st.live = a.p_state;
        if (a.p_supply != null) st.supply = a.p_supply;
        if (a.p_state === "done") st.reportsOpen = 0;
        st.orgAdjusted = null;                  // R2b-1: the household acted
        return ok(get());
      },
      // R2b-1: tap the pressed level again
      jc_entry_supply_clear: () => {
        if (!feat("supply")) return raise("FEATURE_OFF");
        st.supply = null; st.orgAdjusted = null;
        return ok(get());
      },
      jc_entry_reports_clear: () => { st.reportsOpen = 0; return ok(get()); },
      jc_entry_report: (a) => {
        if (a.p_entry === "m") return raise("OWN_ENTRY");
        const e = st.others.find((x) => x.id === a.p_entry);
        if (!e) return raise("NOT_FOUND");
        if (e.live_state === "done") return raise("ALREADY_DONE");
        if (opts.reportError) return raise(opts.reportError);
        return ok({ reported: true });
      },
    }, opts.rpc || {}),
  };
}

// A server that keeps the home's entry like jc_event_signup does: payload + note REPLACED wholesale.
function eventsBackend(opts = {}) {
  const st = { mine: opts.mine || null, signupsOpen: opts.signupsOpen !== false };
  const day = dayBackend({ reportsOpen: 1 });
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
        : a.p_event === LIVE_ID ? ok(get())
        : a.p_event === PINS_ID ? ok(PINS_EVENT) : a.p_event === HAQ_ID ? ok(HAQ_EVENT)
        : a.p_event === LIGHTS_ID ? ok(LIGHTS_EVENT)                                   // R2b-2
        : a.p_event === DAY_ID ? day.rpc.jc_event_get() : raise("NOT_FOUND"),
      // event day (5b) — /shot can open events/?id=6666… and tap the switch
      jc_entry_live_set: (a) => day.rpc.jc_entry_live_set(a),
      jc_entry_reports_clear: (a) => day.rpc.jc_entry_reports_clear(a),
      jc_entry_report: (a) => day.rpc.jc_entry_report(a),
      jc_entry_supply_clear: (a) => day.rpc.jc_entry_supply_clear(a),
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
const ADMIN_MARKET_ID = "77777777-7777-4777-8777-777777777777";
// a one-place event with numbered spots (T5.2 3b) — pass as opts.extraEvents
const ADMIN_MARKET = { id: ADMIN_MARKET_ID, slug: "kids-market", title_en: "Kids Market", title_ar: null, description_en: null,
  description_ar: null, starts_at: "2026-11-20T12:00:00Z", ends_at: "2026-11-20T15:00:00Z", status: "live", signups_open: true,
  features: {}, theme: {}, safety: {}, kind: "venue", look: "market", venue_name_en: "Central Park", venue_name_ar: null,
  venue_lat: 24.531, venue_lng: 54.432, capacity: 30, spots: true, entries: 2,
  payload_schema: { fields: { selling: { type: "enum", values: ["toys_books", "food"], required: true,
    label_en: "What will you sell?", labels_en: { toys_books: "Toys & books", food: "Food & treats" } } } } };
// jc_admin_entries_list rows (T5.2 3b shape), per event
function adminEntries() {
  const base = { type: "villa", building: null, payload: {}, note: null, live_state: null, supply_level: null,
    hidden: false, org_note: null, spot: null, reports_open: 0, status: "in", event_lat: null, event_lng: null,
    created_at: "2026-11-04T08:00:00Z", updated_at: "2026-11-04T08:00:00Z" };
  return {
    [ADMIN_LIVE_ID]: [
      Object.assign({}, base, { id: "a1", home_id: "h-a1", village: "ain-al-maha", number: "12", home_lat: 24.5302, home_lng: 54.4322,
        payload: { treats: "candy" }, note: "=HYPERLINK(\"x\")", reports_open: 2 }),
      Object.assign({}, base, { id: "a2", home_id: "h-a2", village: "ain-al-maha", number: "14", home_lat: null, home_lng: null,
        payload: { treats: "candy" }, org_note: "Pin looks off" }),
      Object.assign({}, base, { id: "a3", home_id: "h-a3", village: "seef-al-jubail", type: "townhouse", number: "7",
        home_lat: 24.53, home_lng: 54.43, event_lat: 24.5311, event_lng: 54.4311, payload: { treats: "candy" }, note: " @SUM(1)" }),
      Object.assign({}, base, { id: "a4", home_id: "h-a4", village: "seef-al-jubail", number: "9", status: "withdrawn",
        home_lat: 24.53, home_lng: 54.43 }),
    ],
    [ADMIN_MARKET_ID]: [
      Object.assign({}, base, { id: "m1", home_id: "h-m1", village: "ain-al-maha", number: "3", home_lat: 24.53, home_lng: 54.43,
        payload: { selling: "food" }, spot: "A1" }),
      Object.assign({}, base, { id: "m2", home_id: "h-m2", village: "seef-al-jubail", number: "5", home_lat: 24.53, home_lng: 54.43,
        payload: { selling: "toys_books" } }),
    ],
    [ADMIN_PAST_ID]: [
      Object.assign({}, base, { id: "p1", home_id: "h-p1", village: "ain-al-maha", number: "1", home_lat: 24.53, home_lng: 54.43 }),
    ],
  };
}

// ── T5.2 PR 6: jc_admin_report, shaped like the live function (2026-11-05); minutes are relative to now ──
function healthReport(over = {}) {
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  return Object.assign({
    generated_at: ago(0),
    snapshot: { last_at: ago(12), age_minutes: 12, stale: false },
    cron: { job_present: true, active: true, last_status: "succeeded", last_run_at: ago(12), last_failure: null },
    failures_since_baseline: { admin_codes: 3, join_codes: 7, baseline_at: "2026-11-04T00:00:00Z", scope: "all communities" },
    rate_limited_now: { admin_unlock: 0, join_pre_membership: 0 },
    state_changes_24h: { live_state: 14, report: 3, signup: 2 },
    notices_open: 2,
    traffic: { hits_24h: 412, counter_suspect: false },
    storage: { bytes: 3355443, limit_bytes: 1073741824, pct: 0.3, alert: false, scope: "whole project" },
    maintenance: {
      orphan_users: { last_at: ago(600), affected: 0, error: null, stale: false, never_run: false },
      photo_purge: { last_at: ago(580), affected: 2, error: null, stale: false, never_run: false },
    },
  }, over);
}
const NOTICES = [
  { id: 11, kind: "departure", detail: { vacant: true, self_serve: true }, created_at: "2026-11-05T08:00:00Z",
    home: { id: "h7", village: "ain-al-maha", building: null, number: "7" } },
  { id: 12, kind: "pin_flag", detail: { user_id: "u-secret-123" }, created_at: "2026-11-04T08:00:00Z",
    home: { id: "h9", village: "seef-al-jubail", building: "B2", number: "304" } },
];

function adminBackend(opts = {}) {
  const st = {
    scopes: opts.scopes || [],
    adminEvents: opts.adminEvents || [],      // T5.2 PR A: events this person runs (jc_me_get.admin_events)
    admins: opts.admins || [],                // community admin's view of one event's admins
    links: [],                                // open grant links: { id, token, event }
    entries: adminEntries(),                  // T5.2 PR 4: jc_admin_entries_list per event
    broadcast: opts.broadcast || "",
    owner: !!opts.owner,                      // T5.3: jc_me_get.is_owner — the feedback inbox
    feedback: opts.feedback || [],
    report: opts.report || healthReport(),     // T5.2 PR 6
    notices: (opts.notices || NOTICES).map((n) => Object.assign({}, n)),
    events: [
      { id: ADMIN_DRAFT_ID, slug: "national-day-2026", title_en: "National Day", title_ar: null, description_en: null, description_ar: null,
        starts_at: opts.draftUndated ? null : "2026-12-02T14:00:00Z", ends_at: null, status: "draft", signups_open: true,
        features: {}, theme: {}, payload_schema: { fields: {} }, safety: {}, entries: 0 },   // R2a: publishing needs the date
      { id: ADMIN_LIVE_ID, slug: "test-event", title_en: opts.liveTitle || "Test Event", title_ar: null, description_en: "Practice", description_ar: null,
        starts_at: opts.liveStartsAt || "2026-11-04T04:40:00Z", ends_at: "2026-12-04T04:40:00Z", status: "live", signups_open: true,
        features: opts.liveFeatures || { giant_switch: true }, theme: {}, payload_schema: { fields: { treats: { type: "enum", values: ["candy"], required: true } } },
        safety: opts.liveSafety || {}, entries: 3, ...(opts.liveLook ? { look: opts.liveLook } : {}) },
      ...(opts.extraEvents || []),
      { id: ADMIN_PAST_ID, slug: "halloween-2026", title_en: "Halloween 2026", status: "archived", signups_open: false,
        starts_at: "2026-10-31T00:00:00Z", features: { giant_switch: true }, payload_schema: { fields: {} }, entries: 124 },
    ].map((e) => Object.assign({ kind: "homes", look: "plain", venue_name_en: null, venue_name_ar: null,   // as jc_admin_events_list (T5.2 3b)
      venue_lat: null, venue_lng: null, capacity: null, spots: false }, e)),
  };
  const admin = () => st.scopes.includes("events") || st.scopes.includes("community");
  const community = () => st.scopes.includes("community");
  // like jc_assert_event_admin: organizers any event; event admins only theirs (open events)
  const mine = (id) => st.adminEvents.includes(id) && (st.events.find((e) => e.id === id) || {}).status !== "archived";
  const guard = (fn) => (a) => (admin() ? fn(a) : raise("NOT_ADMIN"));
  const guardEv = (fn) => (a) => (admin() || mine(a.p_event) ? fn(a) : raise("NOT_ADMIN"));
  const visible = () => (admin() ? st.events : st.events.filter((e) => st.adminEvents.includes(e.id)));
  const adminsList = () => ok({ admins: st.admins, links: st.links.map((l) => ({ id: l.id, expires_at: "2026-11-07T10:00:00Z" })) });
  const find = (id) => st.events.find((e) => e.id === id);
  const fbList = () => ({ unread: st.feedback.filter((f) => !f.read).length,
    items: st.feedback.slice().sort((a, b) => (a.read - b.read) || (a.created_at < b.created_at ? 1 : -1)) });
  // an entry write: the entry's own event decides; returns that event's list (like the server)
  const entryWrite = (id, fn) => {
    const ev = Object.keys(st.entries).find((k) => st.entries[k].some((x) => x.id === id));
    if (!ev) return raise("NOT_FOUND");
    if (!(admin() || mine(ev))) return raise("NOT_ADMIN");
    if ((find(ev) || {}).status !== "live") return raise("EVENT_ARCHIVED");
    const x = st.entries[ev].find((o) => o.id === id);
    const err = fn(x, st.entries[ev]);
    return err ? raise(err) : ok(st.entries[ev]);
  };
  return {
    st,
    rpc: Object.assign({
      jc_me_get: (a, c) => (c.signedIn ? ok(Object.assign({}, MEMBER, { admin_scopes: st.scopes, admin_events: st.adminEvents, is_owner: st.owner })) : raise("NOT_SIGNED_IN")),
      // T5.3 — the owner's inbox (as the server: unread first, then newest)
      jc_feedback_list: () => (st.owner ? ok(fbList()) : raise("NOT_OWNER")),
      jc_feedback_mark_read: (a) => {
        if (!st.owner) return raise("NOT_OWNER");
        const f = st.feedback.find((x) => x.id === a.p_id);
        if (!f) return raise("NOT_FOUND");
        f.read = a.p_read !== false;
        return ok(fbList());
      },
      jc_admin_unlock: (a) => {
        const map = { "EVENTS-CODE-1": ["events"], "COMMUNITY-1": ["community"], "PETS-1": ["pets"] };
        if (!map[a.p_code]) return ok({ error: "BAD_ADMIN" });   // T3: wrong code is a 200 with an error body
        st.scopes = map[a.p_code];
        return ok(st.scopes);
      },
      jc_admin_exit: () => { st.scopes = []; return ok(null); },
      // R4b-1b: the Courts tab (community or bookings); admin-courts.spec.js has the full courts backend
      jc_admin_facilities_list: () => (st.scopes.includes("community") || st.scopes.includes("bookings") ? ok([]) : raise("NOT_ADMIN")),
      jc_admin_booking_rules: () => (st.scopes.includes("community") || st.scopes.includes("bookings")
        ? ok({ enabled: false, per_home_per_day: 1, per_home_active: 2, configured: {}, retention_days: 90, defaults: { window_days: 7, slot_minutes: 60 } })
        : raise("NOT_ADMIN")),
      jc_admin_events_list: () => (admin() || st.adminEvents.length ? ok(visible()) : raise("NOT_ADMIN")),
      // create: organizers only; edit: organizers or that event's admins (jc_assert_event_admin)
      jc_admin_event_save: (a) => {
        if (a.p_event === null ? !admin() : !(admin() || mine(a.p_event))) return raise("NOT_ADMIN");
        if (a.p_event === null) {
          st.events.unshift(Object.assign({ id: "66666666-6666-4666-8666-666666666666", status: "draft", signups_open: true,
            features: {}, payload_schema: { fields: {} }, entries: 0 }, a.p_fields));
        } else Object.assign(find(a.p_event), a.p_fields);
        return ok(visible());
      },
      jc_admin_event_publish: guard((a) => {
        const e = find(a.p_event);
        if (e.kind === "venue" && !(e.venue_name_en && e.venue_lat != null)) return raise("NO_VENUE");   // as T5.2 3b
        e.status = "live"; return ok(st.events);
      }),
      jc_admin_event_signups: guardEv((a) => {
        const e = find(a.p_event);
        if (a.p_open && e.kind === "venue" && !(e.venue_name_en && e.venue_lat != null)) return raise("NO_VENUE");   // as T5.4
        e.signups_open = a.p_open; if (a.p_open) e.coming_soon = false;
        return ok(visible());
      }),
      // T5.4: draft → coming soon (live, sign-ups closed) — organizers only, no place needed
      jc_admin_event_announce: guard((a) => {
        const e = find(a.p_event);
        if (e.status !== "draft" && e.status !== "live") return raise("BAD_STATE");
        if (e.status === "live" && e.entries) return raise("HAS_SIGNUPS");   // T5.4b
        Object.assign(e, { status: "live", signups_open: false, coming_soon: true });
        return ok(st.events);
      }),
      jc_event_close: guardEv((a) => {
        const e = find(a.p_event);
        if (a.p_confirm !== e.slug) return raise("CONFIRM_REQUIRED");
        e.status = "archived"; return ok({ homes: e.entries });
      }),
      // T5.2 PR A — grant links (community admin) + accept (any member)
      jc_event_admin_link_create: (a) => {
        if (!community()) return raise("NOT_ADMIN");
        const token = "TOKEN_eventadmin_" + (st.links.length + 1) + "abcdef";
        st.links.push({ id: "link-" + (st.links.length + 1), token, event: a.p_event });
        return ok({ token, expires_at: "2026-11-07T10:00:00Z" });
      },
      jc_event_admins_list: () => (community() ? adminsList() : raise("NOT_ADMIN")),
      jc_event_admin_revoke: (a) => {
        if (!community()) return raise("NOT_ADMIN");
        if (a.p_user) st.admins = st.admins.filter((x) => x.user_id !== a.p_user);
        else st.links = st.links.filter((l) => l.id !== a.p_link);
        return adminsList();
      },
      jc_event_admin_accept: (a) => {
        const l = (opts.acceptable || []).includes(a.p_token) ? { event: ADMIN_LIVE_ID } : null;
        if (!l) return raise("BAD_LINK");
        opts.acceptable = opts.acceptable.filter((t) => t !== a.p_token);   // single use
        if (!st.adminEvents.includes(l.event)) st.adminEvents.push(l.event);
        const e = find(l.event);
        return ok({ event_id: e.id, title_en: e.title_en, title_ar: e.title_ar });
      },
      // T5.2 PR 4 — sign-ups tab (as jc_assert_event_admin: organizers, or that event's admins)
      jc_admin_entries_list: (a) => (admin() || mine(a.p_event) ? ok(st.entries[a.p_event] || []) : raise("NOT_ADMIN")),
      jc_admin_entry_moderate: (a) => entryWrite(a.p_entry, (x) => {
        if (a.p_hidden !== null) x.hidden = a.p_hidden;
        if (a.p_org_note !== null) x.org_note = a.p_org_note.trim() || null;
      }),
      jc_admin_entry_spot_set: (a) => entryWrite(a.p_entry, (x, list) => {
        const v = (a.p_spot || "").trim().toUpperCase() || null;
        if (v && !/^[A-Z0-9][A-Z0-9 -]{0,11}$/.test(v)) return "BAD_SPOT";
        if (v && list.some((o) => o !== x && o.status === "in" && o.spot === v)) return "SPOT_TAKEN";
        x.spot = v;
      }),
      jc_admin_entry_pin_set: (a) => entryWrite(a.p_entry, (x) => { x.event_lat = a.p_lat; x.event_lng = a.p_lng; x.org_adjusted_at = new Date().toISOString(); }),
      // R2b-1 — as the server: one of state / supply / clear; supply + clear together is BAD_SUPPLY; 'in' only
      jc_admin_entry_live_set: (a) => entryWrite(a.p_entry, (x) => {
        const clear = a.p_supply_clear === true, f = (find(Object.keys(st.entries).find((k) => st.entries[k].includes(x))) || {}).features || {};
        if (a.p_state == null && a.p_supply == null && !clear) return "BAD_STATE";
        if (a.p_supply != null && clear) return "BAD_SUPPLY";
        if (a.p_state != null && f.giant_switch !== true) return "FEATURE_OFF";
        if ((a.p_supply != null || clear) && f.supply !== true) return "FEATURE_OFF";
        if (x.status !== "in") return "NOT_FOUND";
        if (a.p_state != null) x.live_state = a.p_state;
        if (a.p_supply != null) x.supply_level = a.p_supply;
        if (clear) x.supply_level = null;
        x.org_adjusted_at = new Date().toISOString();
      }),
      jc_admin_entry_withdraw: (a) => entryWrite(a.p_entry, (x) => {
        if (x.status !== "in") return "NOT_FOUND";
        x.status = "withdrawn"; x.spot = null; x.reports_open = 0; x.org_withdrawn_at = new Date().toISOString();
      }),
      jc_admin_home_pin_set: (a) => {
        if (!admin() && !st.adminEvents.length) return raise("NOT_ADMIN");
        let from = null;
        Object.values(st.entries).flat().filter((x) => x.home_id === a.p_home).forEach((x) => {
          from = x.home_lat == null ? null : [x.home_lat, x.home_lng];
          x.home_lat = a.p_lat; x.home_lng = a.p_lng;
        });
        return ok({ home_id: a.p_home, lat: a.p_lat, lng: a.p_lng, from });
      },
      jc_admin_broadcast_set: (a) => {
        if (!admin() && !st.adminEvents.length) return raise("NOT_ADMIN");
        st.broadcast = (a.p_text || "").trim();
        return ok({ broadcast: st.broadcast });
      },
      // R2a (U3): organizers tie the banner to a live event — its close takes it down
      jc_admin_broadcast_set_event: (a) => {
        if (!admin()) return raise("NOT_ADMIN");
        if (a.p_event && !st.events.some((e) => e.id === a.p_event && e.status === "live")) return raise("NOT_FOUND");
        st.broadcast = (a.p_text || "").trim();
        st.broadcastEvent = st.broadcast ? a.p_event : null;
        return ok({ broadcast: st.broadcast });
      },
      // T5.2 PR 6 — community admins only (jc_assert_admin('community'))
      jc_admin_report: () => (community() ? ok(st.report) : raise("NOT_ADMIN")),
      jc_admin_notices_list: () => (community() ? ok(st.notices) : raise("NOT_ADMIN")),
      jc_admin_notice_resolve: (a) => {
        if (!community()) return raise("NOT_ADMIN");
        if (!st.notices.some((n) => n.id === a.p_id)) return raise("NOT_FOUND");
        st.notices = st.notices.filter((n) => n.id !== a.p_id);
        return ok(st.notices);
      },
      jc_admin_code_rotate: (a) => (st.scopes.includes("community")
        ? ok({ scope: a.p_scope, code: "NEWCODE" + a.p_scope.toUpperCase(), version: 2 }) : raise("NOT_ADMIN")),
    }, opts.rpc || {}),
  };
}

async function signIn(page, opts = {}) {
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  // the hub settles first: either its member view is drawn, or (no home yet) it has gone on to My Home. A goto before
  // that races the hub's own location.replace ("navigation interrupted" — the WebKit flake, 2026-11-13).
  // opts.settle === false: a test that holds the config on purpose (the hub can't settle until it's released)
  if (opts.settle === false) return;
  await expect(async () => {
    if (/\/commons\/home\/$/.test(page.url())) return;
    await expect(page.locator("#hub")).toBeVisible({ timeout: 250 });
  }).toPass({ timeout: 10000 });
}

// ── Pets (R5b-1 / R5c) — moved from pets.spec.js so /shot can show Pets screens too ──
const PET_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PET_GROUP = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12";
const petId = (n) => "22222222-bbbb-4bbb-8bbb-00000000000" + n;
const PET_MY_HOME = "h1";                                      // stub.js MEMBER: Villa 12 · Ain Al Maha
const PET_V40 = { id: "h40", village: "seef-al-jubail", building: null, number: "40" };
const PET_MINE_HOME = { id: PET_MY_HOME, village: "ain-al-maha", building: null, number: "12" };

// a map pin moves while Leaflet animates: tap it once it has stood still (Courts, Strays maps)
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

function petsBackend(opts = {}) {
  const st = {
    enabled: opts.enabled !== false,
    me: opts.me || MEMBER,
    admin: !!opts.admin,
    group: opts.group === undefined ? PET_GROUP : opts.group,
    pets: (opts.pets || [
      { id: petId(1), kind: "owned", species: "dog", name: "Rex", home: PET_V40, missing: false },
      { id: petId(2), kind: "owned", species: "cat", name: "Luna", home: PET_V40, missing: true, missing_since: "2026-11-10T15:00:00Z",
        last_seen_note: "Near the beach park", sightings: [] },
      { id: petId(3), kind: "stray", species: "cat", name: "Ginger", care_state: "under_care", territory: "Behind the mosque",
        care: { sterilized: { s: "done", d: "2026-10-01", n: "Clinic A" }, vaccination: { s: "due", d: null, n: null } },
        care_log: [{ kind: "fed", note: "Morning round", at: "2026-11-10T05:00:00Z" }],
        sightings: [{ id: 7, note: "By the bins", lat: 24.531, lng: 54.432, seen_at: "2026-11-10T18:00:00Z", by_me: false },
                    { id: 8, note: null, lat: null, lng: null, seen_at: "2026-11-09T18:00:00Z", by_me: true },
                    // older than 24 h: the nightly job erased the reporter, so by_me is NULL (reporter = me → null), not false
                    { id: 9, note: "Sleeping in the shade", lat: null, lng: null, seen_at: "2026-11-08T12:00:00Z", by_me: null }] },
      { id: petId(4), kind: "stray", species: "dog", name: "Sandy", care_state: "known_fine", territory: "The marina" },
      { id: petId(5), kind: "stray", species: "cat", name: "Biscuit", care_state: "rehomed" },
      { id: petId(6), kind: "owned", species: "cat", name: "Mochi", home: PET_MINE_HOME, missing: false, wanderer: true },
    ].concat(opts.extra || [])).map((p) => Object.assign({ description: null, wanderer: false, microchipped: false, missing: false,
      missing_since: null, last_seen_note: null, care_state: null, photo_path: null, territory: null, territory_lat: null, territory_lng: null,
      care: p.kind === "stray" ? {} : null, care_log: [], sightings: [], status: "active" }, p)),
  };
  let n = 0;
  const homeOf = (p) => p.home;
  const card = (p) => {
    const h = homeOf(p), mine = !!(st.me.home && h && h.id === PET_MY_HOME);
    return { id: p.id, kind: p.kind, species: p.species, name: p.name, description: p.description, wanderer: p.wanderer,
      microchipped: p.microchipped, missing: p.missing, missing_since: p.missing_since, last_seen_note: p.last_seen_note,
      care_state: p.care_state, photo_path: p.photo_path, mine,
      home: h && !h.noHome ? { village: h.village, type: h.type, building: h.building, number: h.number } : null,   // type: R5b-1b server (absent = older server)
      territory: p.territory, territory_lat: p.territory_lat, territory_lng: p.territory_lng, care: p.kind === "stray" ? p.care : null,
      // R5b-2b-0: the server decides who gets these (jc_pet_sight_from); a test sets them per pet as that viewer would get them
      last_seen: p.last_seen || null, last_seen_at: p.last_seen_at || null };
  };
  const find = (id) => st.pets.find((p) => p.id === id && p.status === "active");
  const off = () => (st.enabled ? null : raise("MODULE_OFF"));
  // st.hold[name] = a Promise: that RPC answers only once it resolves (a slow network, on demand)
  st.hold = {};
  const held = (name, f) => (a, c) => (st.hold[name] ? st.hold[name].then(() => f(a, c)) : f(a, c));
  const manage = (id) => { const p = find(id); return p && p.kind === "owned" && card(p).mine ? p : null; };
  const rpc = {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { tz: "Asia/Dubai", labels: opts.labels,
      modules: { events: { enabled: false }, bookings: { enabled: false }, pets: { enabled: st.enabled } } })),
    jc_me_get: (a, c) => (c.signedIn ? ok(st.me) : raise("NOT_SIGNED_IN")),
    jc_pets_list: (a) => off() || (a.p_filter !== "all" ? raise("BAD_FILTER")
      // the server orders missing → nearest the viewer's home pin → name; opts.serverOrder = keep the fixture order (as "nearest")
      : ok(st.pets.filter((p) => p.status === "active").sort((x, y) => (y.missing - x.missing) || (opts.serverOrder ? 0 : x.name.localeCompare(y.name))).map(card))),
    jc_pets_alerts: () => off() || ok(opts.alerts || { missing: st.pets.filter((p) => p.status === "active" && p.missing).map((p) => ({ id: p.id, name: p.name })), seen_out: [] }),
    jc_pet_get: (a) => {
      if (off()) return off();
      if (opts.getError) return raise(opts.getError);
      const p = find(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      const c = card(p);
      const see = p.kind === "stray" || c.mine || st.admin;
      return ok(Object.assign(c, { sightings: see ? p.sightings : null, care_log: p.kind === "stray" ? p.care_log : null }));
    },
    jc_pet_save: (a) => {
      if (off()) return off();
      if (!st.me.home) return raise("NO_HOME");
      const f = a.p_fields;
      if (a.p_pet === null) {
        n += 1;
        const p = { id: "33333333-cccc-4ccc-8ccc-00000000000" + n, kind: "owned", home: PET_MINE_HOME, missing: false, missing_since: null, last_seen_note: null, care_state: null,
          photo_path: null, territory: null, territory_lat: null, territory_lng: null, care: null, care_log: [], sightings: [],
          status: "active", description: null, wanderer: false, microchipped: false };
        Object.assign(p, f);
        st.pets.push(p);
        return ok(card(p));
      }
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      Object.assign(p, f);
      return ok(card(p));
    },
    jc_pet_archive: (a) => { const p = manage(a.p_pet); if (!p) return raise("NOT_FOUND"); p.status = "archived"; return ok({ pet_id: p.id, archived: true }); },
    jc_pet_missing_set: (a) => {
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      p.missing = a.p_missing;
      p.missing_since = a.p_missing ? (p.missing_since || "2026-11-11T06:00:00Z") : null;
      p.last_seen_note = a.p_missing ? a.p_note : null;
      return ok(card(p));
    },
    jc_pet_sighting_add: (a) => {
      if (opts.sightError) return raise(opts.sightError);
      const p = find(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      if (!(p.missing || (p.kind === "stray" && p.care_state !== "rehomed"))) return raise("SIGHTINGS_CLOSED");
      if ((a.p_lat === null) !== (a.p_lng === null)) return raise("BAD_FIELDS");
      p.sightings.unshift({ id: 100, note: a.p_note, lat: a.p_lat, lng: a.p_lng, seen_at: "2026-11-11T06:30:00Z", by_me: true });
      return ok({ pet_id: p.id, logged: true });
    },
    jc_pets_group_get: () => off() || ok({ link: st.group }),
    // R5c: the server picks the path; commit only once that exact object arrived (jc_pet_photo_begin / _commit)
    jc_pet_photo_begin: (a) => {
      if (off()) return off();
      if (opts.beginError) return raise(opts.beginError);
      if (!["jpg", "png", "webp"].includes(a.p_ext)) return raise("BAD_FIELDS");
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      n += 1;
      p.pending = "jubail/" + p.id + "/r" + n + "." + a.p_ext;
      return ok({ bucket: "pet-photos", path: p.pending, expires_in_seconds: 900 });
    },
    jc_pet_photo_remove: (a) => {                                       // R5c-2
      if (off()) return off();
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      if (!p.photo_path) return raise("NO_PHOTO");
      p.photo_path = null;
      return ok(card(p));
    },
    jc_pet_photo_commit: (a) => {
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      if (!p.pending) return raise("NO_PENDING_PHOTO");
      if (!st.objects[p.pending]) return raise("PHOTO_MISSING");
      p.photo_path = p.pending; p.pending = null;
      return ok(card(p));
    },
  };
  for (const k of ["jc_pets_list", "jc_pet_save", "jc_pet_get", "jc_pet_missing_set"]) rpc[k] = held(k, rpc[k]);
  st.objects = {};
  const storage = {
    // write-once at the pending path only (storage policy pet_photo_can_write)
    upload: (a) => {
      if (opts.uploadFail) return { status: 500, body: { statusCode: "500", error: "internal", message: "boom" } };
      if (a.bucket !== "pet-photos" || !st.pets.some((p) => p.pending === a.path) || st.objects[a.path])
        return { status: 403, body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } };
      st.objects[a.path] = a;
      return ok({ Key: "pet-photos/" + a.path, Id: "obj" });
    },
    // readable only while it is a pet's current photo (pet_photo_can_read); opts.broken = paths that fail to load
    image: (path) => (st.pets.some((p) => p.photo_path === path) && !(opts.broken || []).includes(path) ? PET_PNG : null),
  };
  return { st, rpc, storage };
}
module.exports = { tapWhenStill, petsBackend, PET_GROUP, petId, PET_MY_HOME, PET_V40, PET_MINE_HOME, PET_PNG, eventsBackend, adminBackend, signIn, LIVE_ID, PAST_ID, SCHEMA, LIVE, PAST, ENTRIES, STATS,
  PIN_SCHEMA, home, pinEvent, PINS_ID, HAQ_ID, DAY_ID, LIGHTS_ID, LIGHTS_EVENT, LIGHTS_SAFETY, dayBackend, healthReport, NOTICES,
  ADMIN_DRAFT_ID, ADMIN_LIVE_ID, ADMIN_PAST_ID, ADMIN_MARKET_ID, ADMIN_MARKET };
