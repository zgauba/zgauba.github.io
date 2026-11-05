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
    events: [
      { id: ADMIN_DRAFT_ID, slug: "national-day-2026", title_en: "National Day", title_ar: null, description_en: null, description_ar: null,
        starts_at: null, ends_at: null, status: "draft", signups_open: true, features: {}, theme: {},
        payload_schema: { fields: {} }, safety: {}, entries: 0 },
      { id: ADMIN_LIVE_ID, slug: "test-event", title_en: opts.liveTitle || "Test Event", title_ar: null, description_en: "Practice", description_ar: null,
        starts_at: "2026-11-04T04:40:00Z", ends_at: "2026-12-04T04:40:00Z", status: "live", signups_open: true,
        features: { giant_switch: true }, theme: {}, payload_schema: { fields: { treats: { type: "enum", values: ["candy"], required: true } } },
        safety: {}, entries: 3 },
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
      jc_admin_entry_pin_set: (a) => entryWrite(a.p_entry, (x) => { x.event_lat = a.p_lat; x.event_lng = a.p_lng; }),
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
  ADMIN_DRAFT_ID, ADMIN_LIVE_ID, ADMIN_PAST_ID, ADMIN_MARKET_ID, ADMIN_MARKET };
