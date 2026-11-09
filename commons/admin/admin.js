/* Organizer tools — T5.2 PR 2 (plan docs/plans/T5-2-plan.md). UC-A4 unlock / exit;
   UC-F1–F4 event setup: list (drafts included), create / edit, publish, sign-ups
   open / paused, close (type the short name); community admins also change codes
   (the new code is shown once, never stored). Views: lock · home · editor.
   The server enforces every permission (jc_assert_admin) — this page only hides what
   a scope can't do. Editing sends ONLY the fields that changed (plan premortem #1:
   two organizers editing one event must not overwrite each other's untouched fields).
   Questions (PR 2b): a builder over a plain list (ed.qs) — pick one / yes-no / short
   answer, choices with optional Arabic + map icon, one question may drive the pin ring
   and one the pin icon. Mirrors the server's jc_schema_check limits; locked once homes
   have signed up (the server enforces that too). */

var state = null, cfg = null, current = null;
/* ?event=<id> — the events list's Admin badge: open that event's editor once loaded */
var OPEN_EVENT = new URLSearchParams(location.search).get("event");
/* ?eventadmin=<token> — a community admin's grant link (T5.2 PR B): asked, never auto-accepted */
var GRANT = new URLSearchParams(location.search).get("eventadmin");
if (GRANT && !/^[A-Za-z0-9_-]{16,64}$/.test(GRANT)) GRANT = null;
/* #admininvite=<token> — R4b-1a: an invite to an admin level (R4a-3). The token rides in the fragment (never
   sent to the server: no access log, no Referer — R4a-2 review S9), is dropped from the URL at once, and is kept
   for this tab only (sessionStorage, ≤ 1 h, forgotten on sign-out — api.js) across sign-in / joining.
   The link carries NO role: anyone could edit one (security review M1), so the question never names a level —
   the server's answer does, right after accepting. */
var INVITE_KEY = "jc_admin_invite";
var INVITE_ROLES = { community: "y", events: "y", bookings: "y", pets: "y" };   /* scopes the answer may name */
var INVITE = (function(){
  var h = JC_URL_HASH || "";
  var m = /^#admininvite=([A-Za-z0-9_-]{16,64})$/.exec(h);
  if (/^#admininvite=/.test(h)) { try { history.replaceState(null, "", location.pathname + location.search); } catch(e){} }
  var v = m ? { token: m[1], at: Date.now() } : null;
  try {
    if (v) sessionStorage.setItem(INVITE_KEY, JSON.stringify(v));
    else {
      var s = JSON.parse(sessionStorage.getItem(INVITE_KEY) || "null");
      if (s && typeof s.token === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(s.token) &&
          typeof s.at === "number" && Date.now() - s.at < 3600e3) v = { token: s.token, at: s.at };
      else sessionStorage.removeItem(INVITE_KEY);
    }
  } catch(e){}
  return v;
})();
function inviteForget(){ try { sessionStorage.removeItem(INVITE_KEY); } catch(e){} }
/* the levels on the Admins screen; pets stays off until pets has admin screens (R4b-1 plan Q1) */
var AD_SCOPES = ["community", "events", "bookings"];
var ad = null;            /* R4b-1a: { <scope>: { admins, links } } from jc_module_admins_list | null */
var adLinks = {};         /* scope → url: new invite links, shown until the person leaves the Admins screen
                             (code review M1: another level's Remove / Make never wipes one) */
var adErr = null;         /* the lists couldn't be read (not NOT_ADMIN): shown with Try Again */
var adBusy = false;       /* one admins write at a time */
/* R4b-1b — the Courts tab (scope bookings or community; the server enforces jc_assert_admin('bookings')) */
var ct = null;            /* { list (jc_admin_facilities_list), rules (jc_admin_booking_rules) } | { err } | null */
var ctLoading = false;
var ctNote = null;        /* an error code to show once the re-read list is drawn (a stale change) */
var ctBusy = false;       /* a status change is in flight */
var cd = null;            /* R4b-2 court day view: { f (court row), date "YYYY-MM-DD" (community time), slots [] | null, err, loading,
                             form null | {kind:"block"} | {kind:"cancel", id}, draft (form values across a language switch) } */
var cdBusy = false, cdSeq = 0;
var ctEd = null;          /* court editor: { f (original row) | null, draft (form values across a language switch) | null, pin {lat,lng} | null } */
var adminEvents = [];     /* jc_me_get.admin_events — events this person runs (no code needed) */
var admining = null;      /* id of the event whose Admins panel is open */
var adminsData = null;    /* jc_event_admins_list for it */
var newLink = null;       /* {event, url} — shown once, like newCode */
var addingCode = false;
var accErr = null;        /* accept view: an error survives a language switch */   /* lock view opened from "Enter another code" (already in) */
var scopes = [];          /* unlocked scopes: jc_me_get.admin_scopes / jc_admin_unlock */
var events = [];          /* last jc_admin_events_list */
var closing = null;       /* id of the event whose close form is open */
var newCode = null;       /* {scope, code} — shown once: any later re-render drops it */
var ed = null;            /* editor state: { ev (original or null), qs, locked, slugTouched,
                             kind, look, venue {lat,lng}|null, tpl (new events) } */
var vmap = null;          /* Leaflet map: the venue pin (editor) or a pin move (pinmove view) */
var su = null;            /* sign-ups view (T5.2 PR 4): { ev, list (jc_admin_entries_list) | null, open: {id, what} | null } */
var pm = null;            /* pin move: { x (an entry of su.list) } */
var owner = false;        /* jc_me_get.is_owner — the platform owner reads feedback (T5.3) */
var fb = null;            /* jc_feedback_list: { unread, items } */
var resolving = false;    /* a Mark Resolved is in flight */
/* the organizer home's sub-menu (?tab=); which tabs a person sees: adminTabs() */
var admTab = new URLSearchParams(location.search).get("tab") || "events";
var bannerDraft = null;   /* the banner text being typed when the person switched tabs */
/* ONE entry per tab (R3c; R4 coordination C5): key = the ?tab= value and strings adm_tab_<key>;
   show = who sees it; html = its panel. Wiring stays in VIEWS.home (on() skips ids that aren't drawn).
   A new tab (R4b-1 Courts) is one more entry here + its adm_tab_ strings. */
var ADM_TABS = [
  { key: "events",    show: function(){ return isOrganizer() || isEventAdmin(); }, html: admEventsHtml },
  { key: "banner",    show: function(){ return isOrganizer() || events.some(function(e){ return e.status === "live"; }); },
    html: admBannerHtml },
  { key: "courts",    show: isCourtsAdmin, html: admCourtsHtml },
  { key: "community", show: function(){ return true; }, html: admCommunityHtml }
];
function adminTabs(){
  return ADM_TABS.filter(function(t){ return t.show(); }).map(function(t){ return t.key; });
}
var health = null;        /* T5.2 PR 6: { report | null, reportErr, notices | null, noticesErr, at } */
var hh = null;            /* R1 households: { data (jc_admin_homes_list) | null, open: {id, what, m (member index)} | null, focus: home id | null } */
var hlog = null;          /* R1: jc_admin_log_list rows */
var hhBusy = false;       /* R1: a households write is in flight — one at a time (as H6) */
var hhPin = null;         /* R1.1: { id (home) } — the households pin fix (hhpin view) */

/* Halloween 2026, as residents knew it (jubail-halloween/): friendly wording and the
   pin hints PR 5 draws (ring = which gate, icon = what's handed out). Arabic: DRAFT. */
var HALLOWEEN = { fields: {
  treats: { type: "enum", values: ["candy", "non_food", "both"], required: true, pin: "glyph",
    label_en: "What will you hand out?", label_ar: "ماذا ستوزّع؟",
    labels_en: { candy: "Candy only", non_food: "Non-food treats only (allergy-friendly)", both: "Both — candy and non-food" },
    labels_ar: { candy: "حلوى فقط", non_food: "هدايا غير غذائية فقط (مناسبة لمن لديهم حساسية)", both: "الاثنان — حلوى وهدايا غير غذائية" },
    glyphs: { candy: "🍬", non_food: "🎃", both: "🍬🎃" }, allergy_friendly: ["non_food"] },   /* the teal pumpkin */
  handout: { type: "enum", values: ["door", "self_serve"], required: true,
    label_en: "On the night, treats are…", label_ar: "في تلك الليلة، توزَّع الحلوى…",
    labels_en: { door: "Handed out in person", self_serve: "Self-serve — left out for visitors" },
    labels_ar: { door: "باليد", self_serve: "خدمة ذاتية — تُترك للزوار" } },
  entrance: { type: "enum", values: ["front", "garden", "both"], required: true, pin: "ring",
    label_en: "Kids should come to…", label_ar: "على الأطفال القدوم إلى…",
    labels_en: { front: "Front gate", garden: "Garden gate (park side)", both: "Both gates" },
    labels_ar: { front: "البوابة الأمامية", garden: "بوابة الحديقة (جهة المنتزه)", both: "البوابتان" },
    ring_split: ["both"] }   /* half front, half garden — the Halloween split ring */
} };
var FEATURES = ["giant_switch", "supply", "crowd_reports"];
var REQ = '<span class="req" aria-hidden="true">*</span>';   /* needed before publishing */

/* T5.2 2c — "New event" starts from a template (plan amendment A5). A template only
   pre-fills: kind, look, questions, switches, spots — the organizer changes anything.
   Arabic wording: DRAFT, pending review. */
var LOOKS = ["plain", "halloween", "haq_al_laila", "gathering", "market", "yard_sale", "holiday_lights"];
var ENTRANCE = HALLOWEEN.fields.entrance;
/* treat nights run all three event-day tools (R2a, Events audit F1) */
var TREAT_NIGHT = { giant_switch: true, supply: true, crowd_reports: true };
var TEMPLATES = [
  { id: "halloween", kind: "homes", look: "halloween", features: TREAT_NIGHT, schema: HALLOWEEN },
  { id: "haq_al_laila", kind: "homes", look: "haq_al_laila", features: TREAT_NIGHT, schema: { fields: {
    /* from Zee's Haq al Laila concept (Oct 2026): the choice that matters is nut-free —
       allergy-friendly homes stand out on the map */
    treats: { type: "enum", values: ["mix", "nut_free", "both"], required: true, pin: "glyph",
      label_en: "What will you hand out?", label_ar: "ماذا ستوزّع؟",
      labels_en: { mix: "Sweets & nuts — the traditional mix", nut_free: "Nut-free only — safe for kids with allergies",
                   both: "Both — a nut-free option alongside the mix" },
      labels_ar: { mix: "حلويات ومكسرات — الخلطة التقليدية", nut_free: "خالٍ من المكسرات فقط — آمن للأطفال المصابين بالحساسية",
                   both: "الاثنان — خيار خالٍ من المكسرات مع الخلطة" },
      glyphs: { mix: "🥜", nut_free: "🧡", both: "🥜🧡" }, allergy_friendly: ["nut_free"] },   /* 🧡 tints to a clean teal heart (🍬 barely changes) */
    handout: { type: "enum", values: ["door", "self_serve"], required: true,
      label_en: "On the night, treats are…", label_ar: "في تلك الليلة، توزَّع الحلوى…",
      labels_en: { door: "Handed out at the door", self_serve: "Self-serve — help yourselves" },
      labels_ar: { door: "توزيع شخصي عند الباب", self_serve: "خدمة ذاتية — تفضلوا" } },
    entrance: ENTRANCE } } },
  { id: "gathering", kind: "venue", look: "gathering", schema: { fields: {
    people: { type: "enum", values: ["one", "two", "three", "four", "five_plus"], required: true,
      label_en: "How many from your household?", label_ar: "كم شخصًا من أهل منزلك؟",
      labels_en: { one: "1", two: "2", three: "3", four: "4", five_plus: "5 or more" },
      labels_ar: { one: "١", two: "٢", three: "٣", four: "٤", five_plus: "٥ أو أكثر" } },
    bringing: { type: "bool", label_en: "Bringing something to share?", label_ar: "هل ستحضر شيئًا للمشاركة؟" } } } },
  { id: "market", kind: "venue", look: "market", spots: true, schema: { fields: {
    selling: { type: "enum", values: ["toys_books", "clothes", "food", "crafts", "other"], required: true,
      label_en: "What will you sell?", label_ar: "ماذا ستبيع؟",
      labels_en: { toys_books: "Toys & books", clothes: "Clothes", food: "Food & treats", crafts: "Crafts", other: "Something else" },
      labels_ar: { toys_books: "ألعاب وكتب", clothes: "ملابس", food: "طعام وحلويات", crafts: "مشغولات يدوية", other: "شيء آخر" } },
    table: { type: "bool", label_en: "Do you need a table?", label_ar: "هل تحتاج إلى طاولة؟" } } } },
  { id: "yard_sale", kind: "homes", look: "yard_sale", schema: { fields: {
    items: { type: "enum", values: ["furniture", "clothes", "toys", "mixed"], required: true, pin: "glyph",
      label_en: "What's on sale?", label_ar: "ماذا تعرض للبيع؟",
      labels_en: { furniture: "Furniture", clothes: "Clothes", toys: "Toys & books", mixed: "A bit of everything" },
      labels_ar: { furniture: "أثاث", clothes: "ملابس", toys: "ألعاب وكتب", mixed: "القليل من كل شيء" },
      glyphs: { furniture: "🛋️", clothes: "👕", toys: "🧸", mixed: "📦" } } } } },
  /* R2b-2 (Zee 2026-11-06: "just another event template"): each decorated home is a stop. The switch lets a
     home say it's done for the night; nothing runs out, so no supply level or neighbor reports. */
  { id: "holiday_lights", kind: "homes", look: "holiday_lights", features: { giant_switch: true }, schema: { fields: {
    view: { type: "enum", values: ["street", "garden", "both"], required: true, pin: "ring",
      label_en: "Best seen from…", label_ar: "أفضل مشاهدة من…",
      labels_en: { street: "The street", garden: "The garden (park side)", both: "Both" },
      labels_ar: { street: "الشارع", garden: "الحديقة (جهة المنتزه)", both: "الاثنان" },
      ring_split: ["both"] },
    lights: { type: "enum", values: ["warm", "colour", "music"], required: true, pin: "glyph",
      label_en: "What kind of lights?", label_ar: "ما نوع الأضواء؟",
      labels_en: { warm: "Warm white", colour: "Colourful", music: "Lights and music" },
      labels_ar: { warm: "أبيض دافئ", colour: "ملوّنة", music: "أضواء وموسيقى" },
      glyphs: { warm: "💡", colour: "🌈", music: "🎶" } },
    until: { type: "enum", values: ["h21", "h22", "h23", "late"],
      label_en: "Lights on until…", label_ar: "الأضواء مضاءة حتى…",
      labels_en: { h21: "9 pm", h22: "10 pm", h23: "11 pm", late: "Midnight or later" },
      labels_ar: { h21: "9 مساءً", h22: "10 مساءً", h23: "11 مساءً", late: "منتصف الليل أو بعده" } } } } },
  { id: "blank", kind: "homes", look: "plain", schema: { fields: {} } }
];

/* ---------- helpers ---------- */
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = jcErrText({ code: code });
  /* the message sits at the top: on a long list the tap that failed may be far below (review PR 4) */
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
function showOk(text){ var m = el("msg"); if (!m) return; m.className = "msg ok"; m.textContent = text; }
function on(id, fn){ var n = el(id); if (n) n.addEventListener("click", fn); }
function busy(id, onoff){
  var b = el(id);
  if (!b) return;
  if (onoff) { b.dataset.label = b.textContent; b.textContent = jcT("working"); b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}
function ar(){ return jcLang() === "ar"; }
function title(ev){ return ar() && ev.title_ar ? ev.title_ar : ev.title_en; }
function has(s){ return scopes.indexOf(s) >= 0; }
function isOrganizer(){ return has("events") || has("community"); }
function isEventAdmin(){ return adminEvents.length > 0; }
function isCourtsAdmin(){ return has("bookings") || has("community"); }
/* R4b-1a: a courts (bookings) admin gets in too — Community tab now, the Courts tab in R4b-1b */
function canEnter(){ return isOrganizer() || isEventAdmin() || owner || has("bookings"); }
function byId(id){ return events.filter(function(e){ return e.id === id; })[0]; }
function fmtDate(iso){
  if (!iso) return "";
  return new Date(iso).toLocaleString(ar() ? "ar-AE-u-nu-latn" : "en-GB",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: (cfg && cfg.tz) || "Asia/Dubai" });
}
/* datetime-local works in the phone's own time zone — the help text says so */
function toLocalInput(iso){
  if (!iso) return "";
  var d = new Date(iso);
  function p(n){ return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
/* Zee 2026-11-09: picking a start moves an empty or earlier end to it, so the end's picker opens on the right day.
   An end already after the start stays. Same-format values ("YYYY-MM-DDTHH:MM", or select indexes) compare as text / numbers. */
function followStart(a, z, num){
  if (!a || !z) return;
  a.addEventListener("change", function(){
    if (!a.value) return;
    if (num ? +z.value < +a.value : (!z.value || z.value < a.value)) z.value = a.value;
  });
}
function fromLocalInput(v){ return v ? new Date(v).toISOString() : null; }
function slugify(t){
  var s = String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "");
  return s.slice(0, 41).replace(/-+$/, "");
}
/* Any admin RPC: an expired / rotated grant comes back NOT_ADMIN → back to the lock. */
function fail(e){
  if (e.code !== "NOT_ADMIN") return showErr(e.code);
  /* one event closing or one grant ending must not drop the others (code review PR B):
     re-read who this is, then land wherever they still belong */
  admining = null; adminsData = null; closing = null; su = null; pm = null; ad = null; adBusy = false;
  hh = null; hlog = null; health = null; ct = null; ctEd = null; ctBusy = false; cd = null; cdBusy = false;   /* a right that ended must not leave its data cached (security L5) */
  rpc("jc_me_get").then(function(me){
    scopes = me.admin_scopes || []; adminEvents = me.admin_events || []; owner = !!me.is_owner;
    if (!canEnter()) { show("lock"); return showErr("NOT_ADMIN"); }
    return loadHome().then(function(){ if (!owner || isOrganizer() || isEventAdmin()) showErr("NOT_ADMIN"); });
  }, function(){ scopes = []; adminEvents = []; show("lock"); showErr("NOT_ADMIN"); });
}

function show(name){
  current = name;
  newCode = null;         /* only rotate() draws the code, once (review PR #26) */
  newLink = null;         /* same for a grant link */
  adLinks = {}; adErr = null;   /* and admin invite links (leaving the Admins screen) */
  if (vmap) { jcMapRemove(vmap); vmap = null; }
  /* back, in the top bar: sign-ups → the events list; pin move → the sign-ups */
  jcBack(name === "signups" ? leaveSignups
       : name === "pinmove" ? function(){ pm = null; show("signups"); }
       : name === "feedback" || name === "health" || name === "households" || name === "admins" ? function(){ show("home"); }
       : name === "adminlog" ? function(){ show("households"); }
       : name === "court" ? function(){ ctEd = null; show("home"); }
       : name === "courtday" ? function(){ cd = null; admTab = "courts"; show("home"); }
       : name === "hhpin" ? function(){ if (hhBusy) return; hhPin = null; show("households"); } : null, "back");
  jcHelp(name === "lock" ? null : "admin");
  var refocus = jcFocusKeep();
  VIEWS[name]();
  refocus();
}

/* ---------- App health (T5.2 PR 6) ---------- */
var HEALTH_ICON = { ok: "✅", warn: "⚠️", bad: "❌", unknown: "❔", info: "📊" };
/* known keys → string key (jcOwn: own string values only) */
var NOTICE_KINDS = { departure: "y", pin_flag: "y", over_cap: "y", event_ended: "y", autoclose_failed: "y" };
/* R2a (D2): event notices name the event, not a home */
var EVENT_NOTICES = { event_ended: "y", autoclose_failed: "y" };
function noticeHead(n){
  if (!jcOwn(EVENT_NOTICES, n.kind)) return noticeHome(n.home);
  var d = hObj(n.detail) || {};
  return typeof d.title === "string" && d.title ? d.title : typeof d.slug === "string" ? d.slug : jcT("adm_h_n_event");
}
function noticeBody(n){
  var d = hObj(n.detail) || {};
  if (n.kind === "event_ended") return jcFmt("adm_h_n_event_ended", { t: fmtDate(d.closes_at) });
  return jcT(jcOwn(NOTICE_KINDS, n.kind) ? "adm_h_n_" + n.kind : "adm_h_n_other");
}
/* the state log's fields, in words; anything new shows as its own name */
var CHANGE_KEYS = { signup: "y", live_state: "y", supply_level: "y", report: "y", reports_cleared: "y", status: "y", starts_at: "y",
  booking: "y", booking_cancel: "y", missing: "y", pet_missing: "y", pet_archive: "y" };

function loadHealth(){
  function settle(p){ return p.then(function(d){ return { d: d }; }, function(e){ return { e: e }; }); }
  return Promise.all([settle(rpc("jc_admin_report")), settle(rpc("jc_admin_notices_list"))]).then(function(x){
    var denied = [x[0].e, x[1].e].filter(function(e){ return e && e.code === "NOT_ADMIN"; })[0];
    if (denied) return fail(denied);
    var rep = x[0].d && typeof x[0].d === "object" && !Array.isArray(x[0].d) ? x[0].d : null;
    health = { report: rep, reportErr: x[0].e ? (x[0].e.code || "UNKNOWN") : rep ? null : "UNKNOWN",
               /* well-formed rows only (a null row would throw while drawing — H4 / H8) */
               notices: Array.isArray(x[1].d) ? x[1].d.filter(function(n){ return hObj(n) && Number.isSafeInteger(n.id); }) : null, noticesErr: x[1].e ? (x[1].e.code || "UNKNOWN") : Array.isArray(x[1].d) ? null : "UNKNOWN",
               at: new Date() };
    if (current === "health") VIEWS.health();
  }).catch(function(){
    health = { report: null, reportErr: "UNKNOWN", notices: null, noticesErr: "UNKNOWN", at: new Date() };
    if (current === "health") VIEWS.health();
  });
}
function hObj(x){ return x && typeof x === "object" && !Array.isArray(x) ? x : null; }
function hNum(x){ return typeof x === "number" && isFinite(x); }
/* "12 min ago" / "3 h ago" / "2 days ago" from an ISO time, measured against the server's own
   clock (generated_at) so a phone with the wrong time can't make it look fresh; "" if it isn't a
   time, or is more than 5 min in the future (review H7) */
var hNow = 0;
function hAgo(iso){
  var t = Date.parse(iso);
  if (!isFinite(t)) return "";
  var m = Math.round(((hNow || Date.now()) - t) / 60000);
  if (m < -5) return "";
  m = Math.max(0, m);
  return m < 60 ? jcFmt("adm_h_min", { n: m }) : m < 2880 ? jcFmt("adm_h_hours", { n: Math.round(m / 60) }) : jcFmt("adm_h_days", { n: Math.round(m / 1440) });
}
/* "3.2 MB": isolated left-to-right so Arabic text doesn't flip it into "MB 3.2" */
function hDate(iso){ return isFinite(Date.parse(iso)) ? fmtDate(iso) : "?"; }   /* never "Invalid Date" (H11) */
function hMB(b){ return "\u2066" + (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB" : (b / 1048576).toFixed(1) + " MB") + "\u2069"; }

/* jc_admin_report → rows of { st: ok | warn | bad | unknown | info, label, text, note } */
function healthChecks(r){
  var rows = [];
  hNow = isFinite(Date.parse(r.generated_at)) ? Date.parse(r.generated_at) : 0;
  function row(label, st, text, note){ rows.push({ label: jcT(label), st: st, text: text, note: note || "" }); }
  function unknown(label){ row(label, "unknown", jcT("adm_h_unknown")); }

  var s = hObj(r.snapshot);
  if (!s) unknown("adm_h_backup");
  else if (s.last_at === null && s.stale === true) row("adm_h_backup", "bad", jcT("adm_h_backup_none"));
  else if (s.stale === true && hAgo(s.last_at)) row("adm_h_backup", "bad", jcFmt("adm_h_backup_stale", { t: hAgo(s.last_at) }));
  else if (s.stale === false && hAgo(s.last_at)) row("adm_h_backup", "ok", jcFmt("adm_h_backup_ok", { t: hAgo(s.last_at) }));
  else unknown("adm_h_backup");

  var c = hObj(r.cron), lf = c && hObj(c.last_failure);
  var oldFail = lf && hAgo(lf.at) ? jcFmt("adm_h_cron_last_fail", { t: hAgo(lf.at) }) : "";
  if (!c) unknown("adm_h_cron");
  else if (c.job_present === false) row("adm_h_cron", "bad", jcT("adm_h_cron_missing"));
  else if (c.active === false) row("adm_h_cron", "bad", jcT("adm_h_cron_paused"));
  else if (c.job_present !== true || c.active !== true) unknown("adm_h_cron");
  else if (c.last_status === "failed") row("adm_h_cron", "bad", jcFmt("adm_h_cron_failed", { t: hAgo(c.last_run_at) || "?" }),
    lf && typeof lf.message === "string" ? lf.message : "");
  else if (c.last_status === "succeeded" && hAgo(c.last_run_at))   /* hourly: over 3 h since the last run is late (H12) */
    row("adm_h_cron", (hNow || Date.now()) - Date.parse(c.last_run_at) > 3 * 3600e3 ? "warn" : "ok",
      jcFmt("adm_h_cron_ok", { t: hAgo(c.last_run_at) }), oldFail);
  else if (c.last_status === "running" || c.last_status === "starting") row("adm_h_cron", "ok", jcT("adm_h_cron_running"), oldFail);
  else if (c.last_status == null) row("adm_h_cron", "warn", jcT("adm_h_cron_never"));
  else unknown("adm_h_cron");

  var m = hObj(r.maintenance);
  ["orphan_users", "photo_purge"].forEach(function(job){
    var j = m && hObj(m[job]), label = "adm_h_job_" + job;
    if (!j) unknown(label);
    else if (!owner) {                       /* reduced for non-owners (server, T5.2 hardening): ran / stale / failed */
      if (j.failed === true) row(label, "bad", jcFmt("adm_h_job_failed", { t: hAgo(j.last_at) || "?" }));
      else if (j.never_run === true) row(label, "warn", jcT("adm_h_job_never"));
      else if (j.stale === true) row(label, "bad", jcFmt("adm_h_job_stale", { t: hAgo(j.last_at) || "?" }));
      else if (j.failed === false && j.stale === false && hAgo(j.last_at)) row(label, "ok", jcFmt("adm_h_cron_ok", { t: hAgo(j.last_at) }));
      else unknown(label);
    }
    else if (j.error) row(label, "bad", jcFmt("adm_h_job_failed", { t: hAgo(j.last_at) || "?" }), String(j.error));
    else if (j.never_run === true) row(label, "warn", jcT("adm_h_job_never"));
    else if (j.stale === true) row(label, "bad", jcFmt("adm_h_job_stale", { t: hAgo(j.last_at) || "?" }));
    else if (j.stale === false && j.error === null && hNum(j.affected) && hAgo(j.last_at))   /* every field as the server sends it (H2) */
      row(label, "ok", jcFmt("adm_h_job_ok", { t: hAgo(j.last_at), n: j.affected }));
    else unknown(label);
  });

  /* whole-platform numbers (storage, wrong codes, join lockouts): the platform owner only (Zee, 2026-11-06);
     the server still sends them to any community admin until the per-community split */
  var st = owner ? hObj(r.storage) : "skip";
  if (st === "skip") {}
  else if (!st || !hNum(st.bytes) || !hNum(st.limit_bytes) || st.limit_bytes <= 0) unknown("adm_h_storage");
  else {
    var pct = Math.round(st.bytes * 1000 / st.limit_bytes) / 10;
    row("adm_h_storage", pct >= 100 ? "bad" : st.alert === true || pct >= 80 ? "warn" : "ok",
      jcFmt("adm_h_storage_text", { u: hMB(st.bytes), l: hMB(st.limit_bytes), p: pct }));
  }

  var t = hObj(r.traffic);
  if (!t || !hNum(t.hits_24h)) unknown("adm_h_traffic");
  else if (t.counter_suspect === true) row("adm_h_traffic", "warn", jcT("adm_h_traffic_suspect"));
  else if (t.counter_suspect === false) row("adm_h_traffic", "ok", jcFmt("adm_h_traffic_text", { n: t.hits_24h }));
  else unknown("adm_h_traffic");   /* the broken-counter flag missing is not "fine" (H1) */

  var rl = hObj(r.rate_limited_now);
  var joins = owner ? rl && rl.join_pre_membership : 0;
  if (!rl || !hNum(rl.admin_unlock) || !hNum(joins)) unknown("adm_h_locked");
  else if (rl.admin_unlock + joins > 0)
    row("adm_h_locked", "warn", owner ? jcFmt("adm_h_locked_text", { a: rl.admin_unlock, j: joins })
                                      : jcFmt("adm_h_locked_here", { a: rl.admin_unlock }));
  else row("adm_h_locked", "ok", jcT("adm_h_locked_none"));

  var f = hObj(r.failures_since_baseline);
  if (!owner) {}
  else if (!f || !hNum(f.admin_codes) || !hNum(f.join_codes)) unknown("adm_h_wrong");
  else row("adm_h_wrong", "info", jcFmt("adm_h_wrong_text", { a: f.admin_codes, j: f.join_codes, d: hDate(f.baseline_at) }));

  var sc = hObj(r.state_changes_24h);
  var scKeys = sc ? Object.keys(sc) : [];
  if (!sc || (scKeys.length && !scKeys.some(function(k){ return hNum(sc[k]); }))) unknown("adm_h_activity");   /* H9 */
  else {
    var bits = Object.keys(sc).filter(function(k){ return hNum(sc[k]) && sc[k] > 0; })
      .sort(function(a, b){ return sc[b] - sc[a]; })
      .map(function(k){ return jcFmt(jcOwn(CHANGE_KEYS, k) ? "adm_h_ch_" + k : "adm_h_ch_other", { n: sc[k], k: k }); });
    row("adm_h_activity", "info", bits.length ? bits.join(" · ") : jcT("adm_h_activity_none"));
  }
  return rows;
}
/* "Villa 12 · Ain Al Maha" — the label only, never the account behind a notice */
function noticeHome(h){
  h = hObj(h);
  if (!h || h.number == null) return jcT("adm_h_no_home");
  return jcHomeLabel({ type: h.building ? "apartment" : "villa", number: h.number, building: h.building }) +
    (h.village ? " · " + jcVillageName(cfg, h.village) : "");
}

/* ---------- Organizer Tools home: one panel per tab (ADM_TABS) ---------- */
/* creating events is the community's step (T5.2 D2) */
function admEventsHtml(){
  return (isOrganizer() ? '<div class="row"><button class="btn" type="button" id="newEv">' + esc(jcT("adm_new")) + '</button></div>' : '') +
    '<h2 class="group">' + esc(jcT("adm_events")) + '</h2>' +
    (events.length ? '<ul class="aevents">' + events.map(eventRow).join("") + '</ul>'
                   : '<p class="help">' + esc(jcT("adm_none")) + '</p>');
}
/* the banner (T5.2 PR 4): organizers any time; an event admin while an event they run is live */
function admBannerHtml(){
  return '<form class="panel" id="bannerForm" novalidate><p class="help">' + esc(jcT("adm_banner_help")) + '</p>' +
    '<textarea id="bannerText" maxlength="280" dir="auto" aria-label="' + esc(jcT("adm_banner")) + '"></textarea>' +
    bannerTieHtml() +
    '<div class="row"><button class="btn" id="bannerSave" type="submit">' + esc(jcT("adm_banner_post")) + '</button>' +
    '<button class="btn ghost" id="bannerClear" type="button">' + esc(jcT("adm_banner_clear")) + '</button></div></form>';
}
/* community: health + notices, the owner's feedback inbox, codes, add another code / lock */
function admCommunityHtml(){
  var h =
    (has("community") ? '<div class="panel fbentry"><button class="btn ghost" type="button" id="adOpen">' +
      esc(jcT("adm_ad_open")) + '</button></div>' +
      '<div class="panel fbentry"><button class="btn ghost" type="button" id="healthOpen">' +
      esc(jcT("adm_h_open")) + '</button></div>' +
      '<div class="panel fbentry"><button class="btn ghost" type="button" id="hhOpen">' +
      esc(jcT("adm_hh_open")) + '</button></div>' : '') +
    (owner ? '<div class="panel fbentry"><button class="btn' + (fb && fb.unread ? '' : ' ghost') + '" type="button" id="fbOpen">' +
      esc(fb ? jcFmt("adm_fb_open", { n: fb.unread }) : jcT("adm_fb_title")) + '</button></div>' : '');
  if (has("community")) {
    h += '<h2 class="group">' + esc(jcT("adm_codes")) + '</h2><div class="panel"><p class="help">' + esc(jcT("adm_codes_help")) + '</p>' +
      ["join", "community", "events"].map(function(s){
        return '<div class="coderow"><span>' + esc(jcT("adm_code_" + s)) + '</span>' +
          '<button class="btn ghost" type="button" data-rotate="' + s + '">' + esc(jcT("adm_rotate")) + '</button></div>' +
          (newCode && newCode.scope === s
            ? '<div class="codebox" role="status"><span>' + esc(jcFmt("adm_new_code", { s: jcT("adm_code_" + s) })) + '</span>' +
              '<b id="newCode">' + esc(newCode.code) + '</b>' +
              '<button class="btn ghost" type="button" id="copyCode">' + esc(jcT("adm_copy")) + '</button></div>' : '');
      }).join("") + '</div>';
  }
  /* lock = drop CODE unlocks; event-admin grants are named and stay (a community admin removes them) */
  return h + '<div class="section"><div class="panel">' +
    '<button class="btn ghost" type="button" id="addCode">' + esc(jcT("adm_add_code")) + '</button>' +
    (scopes.length ? '<button class="btn ghost" type="button" id="exit">' + esc(jcT("adm_exit")) + '</button>' +
      '<p class="help">' + esc(jcT("adm_exit_help")) + '</p>' : '') +
    '</div></div>';
}

/* ---------- views ---------- */
var VIEWS = {
  lock: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("adm_title")) + '</h1><p class="sub">' + esc(jcT("adm_lock_help")) + '</p>' +
      '<form class="panel" id="form" novalidate><label>' + esc(jcT("adm_code")) +
        '<input id="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>' +
        msgBox() + '<button class="btn" id="go" type="submit">' + esc(jcT("adm_unlock")) + '</button>' +
        (addingCode && canEnter() ? '<button class="btn ghost" id="back" type="button">' + esc(jcT("acct_back")) + '</button>' : '') +
      '</form>';
    on("back", function(){ addingCode = false; show("home"); });
    el("form").addEventListener("submit", function(ev){
      ev.preventDefault();
      var code = el("code").value.trim();
      if (!code) return showErr("BAD_ADMIN");
      busy("go", true);
      /* wrong code = HTTP 200 + {error: BAD_ADMIN}; rpc() rejects it (T3 contract) */
      rpc("jc_admin_unlock", { p_code: code }).then(function(s){
        scopes = s || [];
        if (!canEnter()) { busy("go", false); return showErr("NOT_ORGANIZER"); }
        addingCode = false;
        loadHome();
      }, function(e){ busy("go", false); showErr(e.code); });
    });
  },

  home: function(){
    /* T5.2 (Zee, 2026-11-06): a sub-menu like My Home — Events · Banner · Community */
    var tabs = adminTabs();
    if (tabs.indexOf(admTab) < 0) admTab = tabs[0];
    var html =
      '<h1>' + esc(jcT("adm_title")) + '</h1>' +
      '<p class="sub">' + esc(scopes.length
        ? jcFmt("adm_scopes", { s: scopes.map(function(s){ return jcT("scope_" + s); }).join(" · ") })
        : isEventAdmin() ? jcT("adm_event_admin_sub") : jcT("adm_owner_sub")) + '</p>' +
      (tabs.length > 1 ? jcTabsHtml("atab-", tabs, admTab, function(t){ return jcT("adm_tab_" + t); }, jcT("adm_title"), "admPanel") : '') +
      msgBox();
    var panel = ADM_TABS.filter(function(x){ return x.key === admTab; })[0].html();
    html += tabs.length > 1 ? '<div ' + jcTabPanel("atab-", admTab, "admPanel") + '>' + panel + '</div>' : panel;
    el("view").innerHTML = html;
    jcTabsWire("atab-", tabs, function(t){
      if (el("bannerText")) bannerDraft = el("bannerText").value;   /* a half-typed banner survives a tab switch */
      admTab = t;
      try { history.replaceState(null, "", "?tab=" + t); } catch(e){}
      show("home");
    });

    on("newEv", function(){ openEditor(null); });
    on("fbOpen", function(){ show("feedback"); });
    on("healthOpen", function(){ health = null; show("health"); });
    on("hhOpen", function(){ hh = null; show("households"); });
    on("adOpen", function(){ ad = null; show("admins"); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-act]"), function(b){
      b.addEventListener("click", function(){ act(b.dataset.act, b.dataset.id, b); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-rotate]"), function(b){
      b.addEventListener("click", function(){ rotate(b.dataset.rotate, b); });
    });
    on("copyCode", function(){
      (navigator.clipboard ? navigator.clipboard.writeText(newCode.code) : Promise.reject())
        .then(function(){ el("copyCode").textContent = jcT("adm_copied"); },
              function(){ showErr("COPY_FAILED"); });   /* never let them think it copied */
    });
    on("addCode", function(){ addingCode = true; show("lock"); });
    on("exit", function(){
      busy("exit", true);
      rpc("jc_admin_exit").then(function(){
        scopes = []; admining = null; adminsData = null; ct = null; ctEd = null; cd = null;   /* nothing of the code's stays cached */
        if (isEventAdmin() || owner) return loadHome();   /* still runs their own events / reads feedback */
        events = []; show("lock");
      }, function(e){ busy("exit", false); fail(e); });
    });
    wireAdmins();
    wireBanner();
    wireCourts();
    var closeForm = el("closeForm");
    if (closeForm) closeForm.addEventListener("submit", function(e2){ e2.preventDefault(); closeEvent(); });
  },

  templates: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("tpl_title")) + '</h1><p class="sub">' + esc(jcT("tpl_sub")) + '</p>' +
      '<div class="tpls">' + TEMPLATES.map(function(t){
        return '<button class="tpl" type="button" data-tpl="' + t.id + '"><b>' + esc(jcT("tpl_" + t.id)) + '</b>' +
          '<small>' + esc(jcT("tpl_" + t.id + "_help")) + '</small></button>';
      }).join("") + '</div>' +
      '<button class="btn ghost" id="cancel" type="button">' + esc(jcT("ev_cancel")) + '</button>';
    Array.prototype.forEach.call(document.querySelectorAll("[data-tpl]"), function(b){
      b.addEventListener("click", function(){
        var t = TEMPLATES.filter(function(x){ return x.id === b.dataset.tpl; })[0];
        ed = { ev: null, qs: fromSchema(t.schema), locked: false, slugTouched: false,
               kind: t.kind, look: t.look, venue: null, tpl: t };
        show("editor");
      });
    });
    on("cancel", function(){ show("home"); });
  },

  editor: function(){
    var ev = ed.ev || {};
    var draft = !ed.ev || ev.status === "draft";
    var schemaLocked = ed.locked;
    el("view").innerHTML =
      '<h1>' + esc(jcT(ed.ev ? "ed_edit" : "ed_new")) + '</h1>' +
      '<form class="panel" id="form" novalidate data-no-autoreload>' +
        '<p class="help">' + REQ + ' ' + esc(jcT("ed_req_note")) + '</p>' +
        '<label><span>' + esc(jcT("ed_title_en")) + REQ + '</span><input id="title_en" type="text" maxlength="120" required aria-required="true" dir="ltr"></label>' +
        '<label>' + esc(jcT("ed_title_ar")) + '<input id="title_ar" type="text" maxlength="120" dir="rtl"></label>' +
        '<label>' + esc(jcT("ed_slug")) + '<input id="slug" type="text" maxlength="41" autocapitalize="none" spellcheck="false"' +
          (draft ? '' : ' disabled') + '></label>' +
        '<p class="help">' + esc(jcT("ed_slug_help")) + '</p>' +
        /* formatting toolbar + preview (rich.js) — the text stays plain, markers only */
        '<label>' + esc(jcT("ed_desc_en")) + '<textarea id="description_en" maxlength="2000" dir="ltr"></textarea></label>' +
        '<div class="richpreview" id="prev_en" dir="ltr" hidden></div>' +
        '<label>' + esc(jcT("ed_desc_ar")) + '<textarea id="description_ar" maxlength="2000" dir="rtl"></textarea></label>' +
        '<div class="richpreview" id="prev_ar" dir="rtl" hidden></div>' +
        '<p class="help">' + esc(jcT("rich_help")) + '</p>' +
        '<div class="dates"><label>' + esc(jcT("ed_starts")) + '<input id="starts_at" type="datetime-local"></label>' +
          '<label>' + esc(jcT("ed_ends")) + '<input id="ends_at" type="datetime-local"></label></div>' +
        '<p class="help">' + esc(jcT("ed_time_help")) + '</p>' +
        /* T5.2 2c: what a sign-up means (fixed once anyone signs up) + the look */
        '<fieldset><legend>' + esc(jcT("ed_kind")) + '</legend>' +
          ["homes", "venue"].map(function(k){
            return '<label class="check"><input type="radio" name="kind" value="' + k + '"' +
              (ed.kind === k ? ' checked' : '') + (ed.locked ? ' disabled' : '') + '> <span><b>' +
              esc(jcT("ed_kind_" + k)) + '</b><small>' + esc(jcT("ed_kind_" + k + "_help")) + '</small></span></label>';
          }).join("") +
          (ed.locked ? '<p class="help">' + esc(jcT("ed_kind_locked")) + '</p>' : '') +
          /* a look this page doesn't know yet stays selected, so saving never rewrites it */
          '<label>' + esc(jcT("ed_look")) + '<select id="look">' + LOOKS.concat(LOOKS.indexOf(ed.look) < 0 ? [ed.look] : []).map(function(l){
            return '<option value="' + l + '"' + (ed.look === l ? ' selected' : '') + '>' + esc(jcT("look_" + l) === "look_" + l ? l : jcT("look_" + l)) + '</option>';
          }).join("") + '</select></label>' +
        '</fieldset>' +
        '<fieldset id="venueBox" hidden><legend>' + esc(jcT("ed_venue")) + '</legend>' +
          '<p class="notice">' + esc(jcT("ed_jicm")) + '</p>' +
          '<label><span>' + esc(jcT("ed_venue_name_en")) + REQ + '</span><input id="venue_name_en" type="text" maxlength="120" aria-required="true" dir="ltr"></label>' +
          '<label>' + esc(jcT("ed_venue_name_ar")) + '<input id="venue_name_ar" type="text" maxlength="120" dir="rtl"></label>' +
          '<p class="help" id="venuePinHelp">' + esc(jcT("ed_venue_pin_label")) + REQ + ' ' + esc(jcT("ed_venue_pin_help")) + '</p>' +
          pinMapHtml() +
          '<div class="row"><button type="button" class="btn ghost" id="setVenue">' + esc(jcT("ed_venue_here")) + '</button></div>' +
          '<p class="help" id="venueState" role="status"></p>' +
          '<label>' + esc(jcT("ed_capacity")) + '<input id="capacity" type="number" inputmode="numeric" min="1" max="5000" step="1"></label>' +
          '<p class="help">' + esc(jcT("ed_capacity_help")) + '</p>' +
          '<label class="check"><input type="checkbox" id="spots"> <span>' + esc(jcT("ed_spots")) + '</span></label>' +
          '<p class="help">' + esc(jcT("ed_spots_help")) + '</p>' +
        '</fieldset>' +
        '<fieldset><legend>' + esc(jcT("ed_features")) + '</legend>' + FEATURES.map(function(f){
          return '<label class="check"><input type="checkbox" id="f_' + f + '"> <span>' + esc(jcT("ed_f_" + f)) + '</span></label>';
        }).join("") + '</fieldset>' +
        /* R2b-2: the event's safety box — the community's security line + the lost-child meeting point */
        '<fieldset id="safetyBox"><legend>' + esc(jcT("ed_safety")) + '</legend>' +
          '<label class="check"><input type="checkbox" id="f_safety"> <span>' + esc(jcT("ed_safety_on")) + '</span></label>' +
          '<label>' + esc(jcT("ed_safety_phone")) + '<input id="safety_phone" type="tel" inputmode="tel" maxlength="24" autocomplete="off" dir="ltr"></label>' +
          '<p class="help">' + esc(jcT("ed_safety_phone_help")) + '</p>' +
          '<label>' + esc(jcT("ed_safety_meet_en")) + '<input id="safety_meeting_en" type="text" maxlength="200" dir="ltr"></label>' +
          '<label>' + esc(jcT("ed_safety_meet_ar")) + '<input id="safety_meeting_ar" type="text" maxlength="200" dir="rtl"></label>' +
          '<p class="help">' + esc(jcT("ed_safety_help")) + '</p>' +
        '</fieldset>' +
        '<fieldset><legend>' + esc(jcT("ed_questions")) + '</legend><div id="qs"></div>' +
          (schemaLocked ? '<p class="help">' + esc(jcT("ed_q_locked")) + '</p>'
            : '<p class="help">' + esc(jcT("ed_q_privacy")) + '</p>' +
              '<button class="btn ghost" type="button" id="addQ">' + esc(jcT("ed_q_add")) + '</button>' +
              '<div class="row"><button class="btn ghost small" type="button" id="useHalloween">' + esc(jcT("ed_q_halloween")) + '</button>' +
              '<button class="btn ghost small" type="button" id="clearQs">' + esc(jcT("ed_q_clear")) + '</button></div>') +
        '</fieldset>' +
        msgBox() +
        '<button class="btn" id="save" type="submit">' + esc(jcT("ed_save")) + '</button>' +
        '<button class="btn ghost" id="cancel" type="button">' + esc(jcT("ev_cancel")) + '</button>' +
      '</form>';
    /* prefill; defaultValue too, so update.js's "mid-form" check sees real edits only */
    ["title_en", "title_ar", "slug", "description_en", "description_ar"].forEach(function(k){
      el(k).value = el(k).defaultValue = ev[k] || "";
    });
    jcRichToolbar(el("description_en"), el("prev_en"));
    jcRichToolbar(el("description_ar"), el("prev_ar"));
    el("starts_at").value = el("starts_at").defaultValue = toLocalInput(ev.starts_at);
    el("ends_at").value = el("ends_at").defaultValue = toLocalInput(ev.ends_at);
    followStart(el("starts_at"), el("ends_at"));
    var feats0 = ed.ev ? ev.features : ed.tpl && ed.tpl.features;      /* a template pre-sets switches */
    FEATURES.forEach(function(f){ el("f_" + f).checked = !!(feats0 && feats0[f]); });
    el("f_safety").checked = el("f_safety").defaultChecked = !!(ed.ev && ev.features && ev.features.safety === true);
    var sf0 = (ed.ev && ev.safety) || {};
    [["safety_phone", "phone"], ["safety_meeting_en", "meeting_en"], ["safety_meeting_ar", "meeting_ar"]].forEach(function(p){
      el(p[0]).value = el(p[0]).defaultValue = typeof sf0[p[1]] === "string" ? sf0[p[1]] : "";
    });
    ["venue_name_en", "venue_name_ar"].forEach(function(k){ el(k).value = el(k).defaultValue = ev[k] || ""; });
    el("capacity").value = el("capacity").defaultValue = ev.capacity != null ? String(ev.capacity) : "";
    el("spots").checked = el("spots").defaultChecked = ed.ev ? !!ev.spots : !!(ed.tpl && ed.tpl.spots);
    drawVenueState();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="kind"]'), function(r){
      r.addEventListener("change", syncKind);
    });
    syncKind();
    drawQuestions();

    el("title_en").addEventListener("input", function(){
      if (draft && !ed.slugTouched) el("slug").value = slugify(el("title_en").value);
    });
    el("slug").addEventListener("input", function(){ ed.slugTouched = true; });
    on("useHalloween", function(){
      if (ed.qs.length && !window.confirm(jcT("ed_q_replace_confirm"))) return;
      ed.qs = fromSchema(HALLOWEEN);
      FEATURES.forEach(function(k){ el("f_" + k).checked = TREAT_NIGHT[k] === true; });
      drawQuestions();
    });
    on("clearQs", function(){
      if (ed.qs.length && !window.confirm(jcT("ed_q_clear_confirm"))) return;
      ed.qs = []; drawQuestions();
    });
    on("addQ", function(){
      if (ed.qs.length >= 12) return showErr("Q_TOO_MANY");
      ed.qs.push({ key: null, label_en: "", label_ar: "", type: "enum", required: false, pin: "",
                   choices: [newChoice(), newChoice()] });
      drawQuestions();
      var inputs = document.querySelectorAll("#qs [data-q-label]");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    on("cancel", function(){ ed = null; show("home"); });
    el("form").addEventListener("submit", function(e2){ e2.preventDefault(); saveEvent(); });
  },

  /* T5.2 PR 4 — one event's sign-ups, by village. A closed event is read-only (the server's
     5-day window decides how long it can be read at all). */
  signups: function(){
    var e = su.ev, venue = e.kind === "venue", ro = e.status !== "live";
    var head = '<h1>' + esc(title(e)) + '</h1>';
    if (!su.list) {
      el("view").innerHTML = head + msgBox() + (su.failed
        ? '<button class="btn" type="button" id="suRetry">' + esc(jcT("adm_retry")) + '</button>'
        : '<p class="help">' + esc(jcT("working")) + '</p>');
      on("suRetry", function(){ openSignups(su.ev); });
      if (su.failed) showErr(su.failed);
      return;
    }
    var ins = su.list.filter(function(x){ return x.status === "in"; });
    var hidden = ins.filter(function(x){ return x.hidden; }).length;
    var line = [jcFmt(venue ? "adm_households" : "adm_homes", { n: ins.length }),
                e.capacity ? jcFmt("adm_su_cap", { c: e.capacity }) : null,
                hidden ? jcFmt("adm_su_hidden_n", { n: hidden }) : null].filter(Boolean).join(" · ");
    var groups = {};
    ins.forEach(function(x){ (groups[x.village] = groups[x.village] || []).push(x); });   /* server order: building, number */
    var villages = Object.keys(groups).sort(function(a, b){ return jcVillageName(cfg, a).localeCompare(jcVillageName(cfg, b), jcLang()); });
    el("view").innerHTML = head + '<p class="sub">' + esc(line) + '</p>' +
      (ro ? '<p class="notice">' + esc(jcT("adm_su_readonly")) + '</p>' : '') +
      msgBox() +
      '<div class="panel"><button class="btn ghost" type="button" id="csv"' + (su.list.length ? '' : ' disabled') + '>' +
        esc(jcT("adm_csv")) + '</button><p class="help">' + esc(jcT("adm_csv_help")) + '</p></div>' +
      (ins.length ? villages.map(function(v){
        return '<h2 class="group">' + esc(jcVillageName(cfg, v)) + ' · ' + esc(groups[v].length) + '</h2>' +
          '<ul class="sulist">' + groups[v].map(function(x){ return entryCard(x, ro); }).join("") + '</ul>';
      }).join("") : '<p class="help">' + esc(jcT("adm_su_none")) + '</p>');
    on("csv", downloadCsv);
    wireEntries();
  },

  /* T5.3 — feedback inbox (platform owner only; the server refuses anyone else) */
  feedback: function(){
    var html = '<h1>' + esc(jcT("adm_fb_title")) + '</h1>' + msgBox();
    if (!fb) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      return rpc("jc_feedback_list").then(function(d){ fb = d; if (current === "feedback") VIEWS.feedback(); }, fail);
    }
    html += '<p class="sub">' + esc(jcFmt("adm_fb_unread", { n: fb.unread })) + '</p>' +
      (fb.items.length ? '<ul class="fblist">' + fb.items.map(function(f){
        return '<li class="' + (f.read ? 'read' : '') + '"><div class="fbhead"><span class="fbkind">' + esc(jcT("fb_kind_" + f.kind)) + '</span>' +
          '<small>' + esc([f.home || jcT("adm_fb_no_home"), f.community_name, fmtDate(f.created_at)].filter(Boolean).join(" · ")) + '</small></div>' +
          '<p class="fbbody" dir="auto">' + esc(f.body) + '</p>' +
          (f.page ? '<small class="fbpage" dir="ltr">' + esc(f.page) + '</small>' : '') +
          '<button class="mini" type="button" data-fb="' + esc(f.id) + '" data-read="' + (f.read ? '0' : '1') + '">' +
            esc(jcT(f.read ? "adm_fb_mark_unread" : "adm_fb_mark_read")) + '</button></li>';
      }).join("") + '</ul>' : '<p class="help">' + esc(jcT("adm_fb_none")) + '</p>');
    el("view").innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll("[data-fb]"), function(b){
      b.addEventListener("click", function(){
        b.disabled = true;
        rpc("jc_feedback_mark_read", { p_id: b.dataset.fb, p_read: b.dataset.read === "1" }).then(function(d){
          fb = d; if (current === "feedback") VIEWS.feedback();
        }, function(err){ b.disabled = false; fail(err); });
      });
    });
  },

  /* T5.2 PR 6 — App health: jc_admin_report in plain words, then the open notices.
     Every check starts as "couldn't check": a missing or unexpected value never shows ✅. */
  health: function(){
    var html = '<h1>' + esc(jcT("adm_h_title")) + '</h1>' + msgBox();
    if (!health) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      return loadHealth();
    }
    var rows = health.report ? healthChecks(health.report) : [];
    var issues = rows.filter(function(r){ return r.st === "bad" || r.st === "warn" || r.st === "unknown"; }).length +
      (health.noticesErr ? 1 : 0);   /* notices that didn't load are unchecked, not fine (H3) */
    var when = health.report && isFinite(Date.parse(health.report.generated_at)) ? fmtDate(health.report.generated_at) : fmtDate(health.at.toISOString());
    html += health.reportErr
      ? '<p class="hsum bad" role="status">' + esc(jcT("adm_h_failed")) + ' ' + esc(jcErrText({ code: health.reportErr })) + '</p>'
      : '<p class="hsum ' + (issues ? 'warn' : 'ok') + '" role="status">' + esc(issues ? jcFmt("adm_h_issues", { n: issues }) : jcT("adm_h_all_good")) + '</p>';
    html += '<p class="sub">' + esc(jcFmt("adm_h_checked", { t: when })) + '</p>' +
      '<div class="row"><button class="btn ghost" type="button" id="healthRefresh">' + esc(jcT("adm_h_again")) + '</button></div>';
    if (rows.length) html += '<ul class="hlist">' + rows.map(function(r){
      return '<li class="hrow ' + r.st + '"><span class="hic" role="img" aria-label="' + esc(jcT("adm_h_st_" + r.st)) + '">' + HEALTH_ICON[r.st] + '</span>' +
        '<div><b>' + esc(r.label) + '</b><span>' + esc(r.text) + '</span>' +
        (r.note ? '<small dir="auto">' + esc(r.note) + '</small>' : '') + '</div></li>';
    }).join("") + '</ul>';
    /* notices: departures (rotate the code?), pins far from their village, invites over the cap */
    var ns = health.notices;
    html += '<h2 class="group">' + esc(jcFmt("adm_h_notices", { n: ns ? ns.length : "?" })) + '</h2>' +
      (health.noticesErr ? '<p class="help">' + esc(jcT("adm_h_notices_failed")) + ' ' + esc(jcErrText({ code: health.noticesErr })) + '</p>'
       : !ns.length ? '<p class="help">' + esc(jcT("adm_h_notices_none")) + '</p>'
       : '<ul class="fblist">' + ns.map(function(n){
          return '<li class="read"><div class="fbhead"><span class="fbkind" dir="auto">' + esc(noticeHead(n)) + '</span>' +
            '<small>' + esc(fmtDate(n.created_at)) + '</small></div>' +
            '<p class="fbbody">' + esc(noticeBody(n)) + '</p>' +
            '<div class="acts">' +
            (hObj(n.home) && n.home.id ? '<button class="mini" type="button" data-nhome="' + esc(n.home.id) + '">' + esc(jcT("adm_hh_open_home")) + '</button>' : '') +
            '<button class="mini" type="button" data-notice="' + esc(n.id) + '">' + esc(jcT("adm_h_resolve")) + '</button></div></li>';
        }).join("") + '</ul>');
    el("view").innerHTML = html;
    on("healthRefresh", function(){ if (resolving) return; health = null; VIEWS.health(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-nhome]"), function(b){
      b.addEventListener("click", function(){ hh = { data: null, open: null, focus: b.dataset.nhome }; show("households"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-notice]"), function(b){
      b.addEventListener("click", function(){
        if (resolving) return;               /* one at a time: answers can't arrive out of order (H6) */
        resolving = true; b.disabled = true;
        var h = health;                      /* "Check Again" can't pull it out from under us (H5) */
        rpc("jc_admin_notice_resolve", { p_id: Number(b.dataset.notice) }).then(function(d){
          if (!Array.isArray(d)) throw { code: "UNKNOWN" };
          h.notices = d.filter(function(n){ return hObj(n) && Number.isSafeInteger(n.id); });
          if (current === "health" && health === h) { VIEWS.health(); showOk(jcT("adm_h_resolved")); }
        }).catch(function(err){
          b.disabled = false;
          if (err && err.code === "NOT_FOUND" && current === "health") {   /* already resolved elsewhere: reload */
            health = null; VIEWS.health(); return;
          }
          fail(err);
        }).finally(function(){ resolving = false; });
      });
    });
  },

  /* R1 — Households (community admins): invites over a household's limit, then every home by
     village with its members. Names are what the server sends (display name or masked email). */
  /* R4b-1a — admins at every level: named people, one-time invite links, one-tap Remove (community admins only;
     the server enforces it) */
  admins: function(){
    var html = '<h1>' + esc(jcT("adm_ad_title")) + '</h1><p class="sub">' + esc(jcT("adm_ad_sub")) + '</p>' + msgBox();
    if (adErr) {
      el("view").innerHTML = html + '<div class="row"><button class="btn ghost" type="button" id="adRetry">' +
        esc(jcT("adm_ad_retry")) + '</button></div>';
      showErr(adErr);
      return wireAdminsView();
    }
    if (!ad) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      return loadAdmins();
    }
    /* code unlocks are ephemeral (R4a-3 review D3): the durable floor is two people added by invite */
    var invited = ad.community.admins.filter(function(a){ return a.via.indexOf("invite") >= 0; }).length;
    if (invited < 2) html += '<div class="panel adwarn" id="adWarn" role="note">' + esc(jcT("adm_ad_warn_two")) + '</div>';
    el("view").innerHTML = html + AD_SCOPES.map(adScopeHtml).join("");
    wireAdminsView();
  },

  /* R4b-1b — add / edit one court */
  court: function(){
    var f = ctEd.f, locked = !!(f && f.upcoming > 0);
    var v = ctEd.draft || courtValues(f);
    el("view").innerHTML =
      '<h1>' + esc(jcT(f ? "ct_edit" : "ct_new")) + '</h1>' +
      '<form class="panel" id="ctForm" novalidate data-no-autoreload>' +
        '<p class="help">' + REQ + ' ' + esc(jcT("ct_req_note")) + '</p>' +
        '<label><span>' + esc(jcT("ct_name_en")) + REQ + '</span><input id="ct_name_en" type="text" maxlength="60" required aria-required="true" dir="ltr"></label>' +
        '<label>' + esc(jcT("ct_name_ar")) + '<input id="ct_name_ar" type="text" maxlength="60" dir="rtl"></label>' +
        '<fieldset id="ctKind"><legend>' + esc(jcT("ct_kind")) + REQ + '</legend>' +
          ["tennis", "basketball"].map(function(k){
            return '<label class="check"><input type="radio" name="ct_kind" value="' + k + '"> <span>' + esc(jcT("ct_kind_" + k)) + '</span></label>';
          }).join("") + '</fieldset>' +
        '<label>' + esc(jcT("ct_note")) + '<textarea id="ct_note" maxlength="200" dir="auto"></textarea></label>' +
        '<p class="help">' + esc(jcT("ct_note_help")) + '</p>' +
        '<fieldset><legend>' + esc(jcT("ct_pin")) + '</legend>' +
          '<p class="help">' + esc(jcT("ct_pin_help")) + '</p>' + pinMapHtml() +
          '<div class="row"><button type="button" class="btn ghost" id="ctPinHere">' + esc(jcT("ct_pin_here")) + '</button></div>' +
          '<p class="help" id="ctPinState" role="status"></p></fieldset>' +
        '<fieldset><legend>' + esc(jcT("ct_hours")) + '</legend>' +
          (locked ? '<p class="notice" id="ctLocked">' + esc(jcFmt("ct_locked", { n: f.upcoming })) + '</p>' : '') +
          '<label class="check"><input type="checkbox" id="ct_walk_on"' + (locked && !v.walk_on ? ' disabled' : '') + '> <span>' +
            esc(jcT("ct_walk_on")) + '</span></label>' +
          '<p class="help">' + esc(jcT("ct_walk_on_help")) + '</p>' +
          '<span class="row"><label>' + esc(jcT("ct_open")) + '<input id="ct_open" type="time" step="60"' + (locked ? ' disabled' : '') + '></label>' +
          '<label>' + esc(jcT("ct_close")) + '<input id="ct_close" type="time" step="60"' + (locked ? ' disabled' : '') + '></label></span>' +
          '<div id="ctGrid"><label>' + esc(jcT("ct_slot")) + '<select id="ct_slot"' + (locked ? ' disabled' : '') + '>' +
            [30, 45, 60, 90, 120].map(function(m){ return '<option value="' + m + '">' + esc(jcFmt("ct_slot_n", { n: m })) + '</option>'; }).join("") +
          '</select></label>' +
          '<label>' + esc(jcT("ct_window")) + '<input id="ct_window" type="number" inputmode="numeric" min="1" max="30" step="1"></label>' +
          '<p class="help">' + esc(jcT("ct_window_help")) + '</p></div></fieldset>' +
        msgBox() +
        '<div class="row"><button class="btn" id="ctSave" type="submit">' + esc(jcT("ct_save")) + '</button>' +
        '<button class="btn ghost" id="ctCancel" type="button">' + esc(jcT("ct_cancel")) + '</button></div>' +
      '</form>';
    el("ct_name_en").value = v.name_en; el("ct_name_ar").value = v.name_ar; el("ct_note").value = v.location_note;
    var kr = v.kind === "tennis" || v.kind === "basketball" ? document.querySelector('input[name="ct_kind"][value="' + v.kind + '"]') : null;
    if (kr) kr.checked = true;
    el("ct_walk_on").checked = v.walk_on; el("ct_open").value = v.open_time; el("ct_close").value = v.close_time;
    el("ct_slot").value = String(v.slot_minutes); el("ct_window").value = v.window_days == null ? "" : String(v.window_days);
    if (!ctEd.draft) ctEd.pin = f && f.lat != null ? { lat: f.lat, lng: f.lng } : null;
    ctEd.draft = null;
    function syncWalk(){ el("ctGrid").hidden = el("ct_walk_on").checked; }
    el("ct_walk_on").addEventListener("change", syncWalk); syncWalk();
    drawCourtPin();
    vmap = initPinMap(ctEd.pin ? [ctEd.pin.lat, ctEd.pin.lng] : null);
    on("ctPinHere", function(){ if (vmap) { ctEd.pin = centerOf(vmap); drawCourtPin(); } });
    on("ctCancel", function(){ ctEd = null; show("home"); });
    el("ctForm").addEventListener("submit", function(e){ e.preventDefault(); saveCourt(); });
  },

  /* R4b-2 — one court, one day */
  courtday: function(){
    if (!cd) return show("home");
    var name = ar() && cd.f.name_ar ? cd.f.name_ar : cd.f.name_en, today = cdToday(), max = cdAdd(today, CD_AHEAD);
    var html = '<h1 dir="auto">' + esc(name) + '</h1>' +
      '<p class="help">' + esc(jcT("cd_help")) + '</p>' +
      '<div class="cdbar"><button class="btn ghost small cdstep" type="button" id="cdPrev" aria-label="' + esc(jcT("cd_prev")) + '"' + (cd.date <= today ? ' disabled' : '') + '><span aria-hidden="true">‹</span></button>' +
      '<label class="cddate"><span class="cdpill" id="cdDay" aria-hidden="true">' + esc(cdDayText(cd.date)) + '</span><span class="sr-only">' + esc(jcT("cd_date")) + '</span>' +
      '<input id="cdDate" type="date" min="' + today + '" max="' + max + '" value="' + esc(cd.date) + '"></label>' +
      '<button class="btn ghost small cdstep" type="button" id="cdNext" aria-label="' + esc(jcT("cd_next")) + '"' + (cd.date >= max ? ' disabled' : '') + '><span aria-hidden="true">›</span></button></div>' +
      msgBox();
    if (cd.err) {
      el("view").innerHTML = html + '<div class="row"><button class="btn ghost" type="button" id="cdRetry">' + esc(jcT("adm_ad_retry")) + '</button></div>';
      showErr(cd.err);
      return cdWire();
    }
    if (!cd.slots) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      cdWire();
      if (!cd.loading) loadDay();
      return;
    }
    var open = cd.slots.map(function(s, i){ return Object.assign({ i: i }, s); }).filter(function(s){ return !cdOver(s); });
    if (cd.form && cd.form.kind === "block" && !open.length) cd.form = null;
    html += (cd.form && cd.form.kind === "block" ? cdBlockHtml(open)
             : open.length ? '<div class="row"><button class="btn" type="button" id="cdBlock">' + esc(jcT("cd_block")) + '</button></div>' : '') +
      (cd.slots.length ? '<ul class="sulist cdlist">' + cdRows(cd.slots).map(cdRowHtml).join("") + '</ul>'
                       : '<p class="help">' + esc(jcT("cd_none")) + '</p>');
    el("view").innerHTML = html;
    var dr = cd.draft; cd.draft = null;
    if (dr) {
      ["cdFrom", "cdTo", "cdLast", "cdWhy", "cdCancelWhy"].forEach(function(id){ if (el(id) && dr[id] != null) el(id).value = dr[id]; });
      var u = dr.until && document.querySelector('input[name="cdUntil"][value="' + (dr.until === "days" ? "days" : "day") + '"]');
      if (u) u.checked = true;
    }
    cdWire();
  },

  households: function(){
    var html = '<h1>' + esc(jcT("adm_hh_title")) + '</h1>' + msgBox();
    if (!hh || !hh.data) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      return loadHouseholds();
    }
    var d = hh.data;
    html += '<p class="sub">' + esc(jcFmt("adm_hh_sub", { h: d.homes.length, m: d.homes.reduce(function(n, h){ return n + h.members.length; }, 0) })) + '</p>' +
      '<div class="row"><button class="btn ghost" type="button" id="logOpen">' + esc(jcT("adm_log_open")) + '</button></div>';
    if (d.pending.length) html += '<h2 class="group">' + esc(jcFmt("adm_hh_pending", { n: d.pending.length })) + '</h2>' +
      '<p class="help">' + esc(jcT("adm_hh_pending_help")) + '</p>' +
      '<ul class="sulist">' + d.pending.map(function(p){
        var h = hhHome(p.home_id);
        return '<li data-invite="' + esc(p.invite_id) + '"><b dir="auto">' + esc(p.requester) + '</b>' +
          '<div class="meta">' + esc(jcFmt("adm_hh_wants", { h: h ? hhLabel(h) : jcT("adm_h_no_home"), t: hDate(p.created_at) })) + '</div>' +
          '<div class="acts"><button class="mini" type="button" data-inv="' + esc(p.invite_id) + '" data-yes="1">' + esc(jcT("adm_hh_approve")) + '</button>' +
          '<button class="mini danger" type="button" data-inv="' + esc(p.invite_id) + '" data-yes="0">' + esc(jcT("adm_hh_decline")) + '</button></div></li>';
      }).join("") + '</ul>';
    /* villages in the community's order; a home in a village the config doesn't list still shows */
    var keys = ((cfg && cfg.villages) || []).map(function(v){ return v.key; });
    d.homes.forEach(function(h){ if (keys.indexOf(h.village) < 0) keys.push(h.village); });
    html += keys.map(function(k){
      var hs = d.homes.filter(function(h){ return h.village === k; });
      if (!hs.length) return '';
      var pinned = hs.filter(function(h){ return h.lat != null; }).length;
      var people = hs.reduce(function(n, h){ return n + h.members.length; }, 0);
      return '<h2 class="group">' + esc(jcVillageName(cfg, k)) + '</h2>' +
        '<p class="help">' + esc(jcFmt("adm_hh_counts", { h: hs.length, p: pinned, m: people })) + '</p>' +
        '<ul class="sulist">' + hs.map(homeCard).join("") + '</ul>';
    }).join("") || '<p class="help">' + esc(jcT("adm_hh_none")) + '</p>';
    el("view").innerHTML = html;
    on("logOpen", function(){ hlog = null; show("adminlog"); });
    wireHouseholds();
    if (hh.focus) {                          /* opened from a notice: that home, once */
      var li = document.querySelector('[data-home="' + CSS.escape(hh.focus) + '"]');
      hh.focus = null;
      if (li) {
        li.classList.add("focus");
        if (li.scrollIntoView) li.scrollIntoView({ block: "center" });
        /* a pin notice lands one tap from the fix (R1.1) */
        var pb = li.querySelector('[data-hh="pin"]');
        if (pb && pinFlagged(hhHome(li.dataset.home))) pb.focus();
      }
      else showErr("HOME_GONE");
    }
  },

  /* R1.1 — fix a home's own pin from Households (the sign-ups pin move's map, ring and confirm) */
  hhpin: function(){
    var h = hhHome(hhPin && hhPin.id);
    if (!h) { hhPin = null; return show("households"); }
    var flags = pinFlags(h);
    el("view").innerHTML =
      '<h1>' + esc(jcT(h.lat != null ? "adm_hh_pin_fix" : "adm_hh_pin_set")) + '</h1>' +
      '<p class="sub">' + esc(hhLabel(h)) + '</p>' +
      '<div class="panel"><p class="help">' + esc(jcT(h.lat != null ? "adm_pm_now_home" : "adm_pm_now_none")) + ' ' +
        esc(jcT("adm_hh_pin_help")) + '</p>' +
        (flags.length ? '<div class="flags">' + flags.map(function(t){ return '<span>' + esc(t) + '</span>'; }).join("") + '</div>' : '') +
        pinMapHtml() +
        msgBox() +
        '<button class="btn" type="button" id="hhPinGo">' + esc(jcT("adm_hh_pin_go")) + '</button>' +
        '<button class="btn ghost" type="button" id="hhPinCancel">' + esc(jcT("ev_cancel")) + '</button>' +
      '</div>';
    vmap = initPinMap(h.lat != null && h.lng != null ? [h.lat, h.lng] : null);
    on("hhPinGo", hhPinSave);
    on("hhPinCancel", function(){ if (hhBusy) return; hhPin = null; show("households"); });
    if (hhBusy) ["hhPinGo", "hhPinCancel"].forEach(function(b){ el(b).disabled = true; });   /* redrawn mid-save (language) */
  },

  /* R1 — the admin log: who did what, newest 100. The stored target holds ids: only a home
     label is ever drawn from it. No actor = a scheduled job (R2a's auto-close). */
  adminlog: function(){
    var html = '<h1>' + esc(jcT("adm_log_title")) + '</h1>' + msgBox();
    if (!hlog) {
      el("view").innerHTML = html + '<p class="help">' + esc(jcT("working")) + '</p>';
      return rpc("jc_admin_log_list").then(function(d){
        hlog = Array.isArray(d) ? d.filter(hObj) : [];
        if (current === "adminlog") VIEWS.adminlog();
      }, fail);
    }
    html += '<p class="sub">' + esc(jcT("adm_log_sub")) + '</p>' +
      (hlog.length ? '<ul class="fblist">' + hlog.map(function(l){
        var t = hObj(l.target) || {}, h = typeof t.home_id === "string" ? hhHome(t.home_id) : null;
        var what = jcOwn(LOG_KEYS, l.action) ? jcT("adm_log_" + l.action) : jcFmt("adm_log_other", { k: String(l.action) });
        var who = typeof l.actor === "string" && l.actor ? l.actor : jcT("adm_log_auto");
        return '<li class="read"><div class="fbhead"><span class="fbkind">' + esc(what) + '</span>' +
          '<small>' + esc(hDate(l.at)) + '</small></div>' +
          '<p class="fbbody" dir="auto">' + esc([who, h ? hhLabel(h) : ""].filter(Boolean).join(" · ")) + '</p></li>';
      }).join("") + '</ul>' : '<p class="help">' + esc(jcT("adm_log_none")) + '</p>');
    el("view").innerHTML = html;
  },

  /* T5.2 PR 4 — move one sign-up's pin: the home's own pin (everywhere) or this event only */
  pinmove: function(){
    var x = pm.x;
    var where = x.event_lat != null ? "adm_pm_now_event" : x.home_lat != null ? "adm_pm_now_home" : "adm_pm_now_none";
    el("view").innerHTML =
      '<h1>' + esc(jcT("adm_pm_title")) + '</h1>' +
      '<p class="sub">' + esc(jcHomeLabel(x) + " · " + jcVillageName(cfg, x.village)) + '</p>' +
      '<div class="panel"><p class="help">' + esc(jcT(where)) + ' ' + esc(jcT("adm_pm_help")) + '</p>' +
        pinMapHtml() +
        msgBox() +
        '<button class="btn" type="button" id="pmHome">' + esc(jcT("adm_pm_home")) + '</button>' +
        '<button class="btn ghost" type="button" id="pmEvent">' + esc(jcT("adm_pm_event")) + '</button>' +
        (x.event_lat != null ? '<button class="btn ghost" type="button" id="pmReset">' + esc(jcT("adm_pm_reset")) + '</button>' : '') +
      '</div>';
    var lat = x.event_lat != null ? x.event_lat : x.home_lat, lng = x.event_lat != null ? x.event_lng : x.home_lng;
    vmap = initPinMap(lat != null ? [lat, lng] : null);
    on("pmHome", function(){ movePin("home"); });
    on("pmEvent", function(){ movePin("event"); });
    on("pmReset", function(){ movePin("reset"); });
  }
};

/* ---------- Households (R1) ---------- */
/* admin-log actions in words; anything else shows its own name */
var LOG_KEYS = { home_edit: "y", home_pin_set: "y", home_suppress: "y", member_remove: "y", invite_approve: "y",
  invite_decline: "y", code_rotate: "y", broadcast_set: "y", notice_resolve: "y", event_save: "y", event_publish: "y",
  event_signups: "y", event_announce: "y", event_close: "y", event_autoclose: "y", entry_moderate: "y", entry_pin_set: "y",
  entry_spot_set: "y", event_admin_link: "y", event_admin_accept: "y", event_admin_revoke: "y",
  broadcast_tie: "y",
  /* R4b-2: courts + per-module admins (R4a / R4a-2) */
  facility_save: "y", facility_status: "y", block_create: "y", block_remove: "y", booking_cancel: "y",
  module_admin_link: "y", module_admin_accept: "y", module_admin_revoke: "y" };
/* the homes list, well-formed rows only (a null row would throw while drawing) */
function hhShape(d){
  if (!hObj(d) || !Array.isArray(d.homes) || !Array.isArray(d.pending)) return null;
  return { homes: d.homes.filter(function(h){ return hObj(h) && h.id; }).map(function(h){
             return Object.assign({}, h, { members: Array.isArray(h.members) ? h.members.filter(hObj) : [] });
           }),
           pending: d.pending.filter(function(p){ return hObj(p) && p.invite_id; }) };
}
function hhHome(id){ return ((hh && hh.data && hh.data.homes) || []).filter(function(h){ return h.id === id; })[0]; }
function hhLabel(h){ return jcHomeLabel(h) + " · " + jcVillageName(cfg, h.village); }
function loadHouseholds(){
  if (!hh) hh = { data: null, open: null, focus: null };
  var mine = hh;
  return rpc("jc_admin_homes_list").then(function(d){
    d = hhShape(d);
    if (!d) throw { code: "UNKNOWN" };
    if (hh !== mine) return;
    hh.data = d;
    if (current === "households") VIEWS.households();
  }).catch(function(err){ if (hh === mine && current === "households") fail(err && err.code ? err : { code: "UNKNOWN" }); });
}
/* the pin's own flags, in words (the card and the pin fix show the same ones) */
function pinFlags(h){
  var f = hObj(h.flags) || {}, flags = [];
  if (h.lat == null) flags.push(jcT("adm_hh_no_pin"));
  if (f.pin_far) flags.push(jcT("adm_hh_pin_far"));
  if (f.pin_near) flags.push(jcT("adm_hh_pin_near"));
  return flags;
}
function pinFlagged(h){ return !!h && pinFlags(h).length > 0; }
function homeCard(h){
  var flags = pinFlags(h);
  if (h.suppressed) flags.push(jcT("adm_hh_suppressed"));
  if (!h.members.length) flags.push(jcT("adm_hh_empty"));
  var open = hh.open && hh.open.id === h.id ? hh.open : null;
  function b(a, label, cls, m){
    return '<button class="mini' + (cls ? ' ' + cls : '') + '" type="button" data-hh="' + a + '" data-id="' + esc(h.id) + '"' +
      (m != null ? ' data-m="' + m + '"' : '') + '>' + esc(label) + '</button>';
  }
  /* a member is addressed by position in this list: no account id goes into the page */
  var members = h.members.length ? '<ul class="adminlist">' + h.members.map(function(m, i){
    return '<li><span dir="auto">' + esc(m.name) + '<small>' + esc(jcFmt("adm_hh_joined", { t: hDate(m.joined_at) })) + '</small></span>' +
      b("remove", jcT("adm_hh_remove"), "danger", i) + '</li>';
  }).join("") + '</ul>' : '';
  var acts = '<div class="acts">' + b("edit", jcT("adm_hh_edit")) +
    b("pin", jcT(h.lat != null ? "adm_hh_pin_fix" : "adm_hh_pin_set")) +
    (h.suppressed ? b("show", jcT("adm_hh_show")) : b("hide", jcT("adm_hh_hide"))) + '</div>';
  var form = '';
  if (open && open.what === "edit") {
    var vs = ((cfg && cfg.villages) || []).filter(function(v){ return v.status === "delivered" || v.key === h.village; });
    form = '<form class="suform" data-form="edit" data-id="' + esc(h.id) + '" novalidate>' +
      '<label>' + esc(jcT("claim_village")) + '<select id="hhVillage" data-in>' + vs.map(function(v){
        return '<option value="' + esc(v.key) + '"' + (v.key === h.village ? ' selected' : '') + '>' + esc(jcVillageName(cfg, v.key)) + '</option>';
      }).join("") + '</select></label>' +
      '<label>' + esc(jcT("claim_type")) + '<select id="hhType" data-in>' + ["villa", "townhouse", "apartment"].map(function(t){
        return '<option value="' + t + '"' + (t === h.type ? ' selected' : '') + '>' + esc(jcT("type_" + t)) + '</option>';
      }).join("") + '</select></label>' +
      '<label id="hhBldWrap"' + (h.type === "apartment" ? '' : ' hidden') + '>' + esc(jcT("claim_building")) +
        '<input id="hhBuilding" type="text" maxlength="20" autocomplete="off" dir="auto" data-in></label>' +
      '<label>' + esc(jcT("adm_hh_number")) + '<input id="hhNumber" type="text" maxlength="12" autocomplete="off" dir="auto" data-in></label>' +
      '<div class="row"><button class="btn small" type="submit">' + esc(jcT("ed_save")) + '</button>' +
      '<button class="btn ghost small" type="button" data-cancel>' + esc(jcT("ev_cancel")) + '</button></div></form>';
  }
  if (open && open.what === "remove" && h.members[open.m]) {
    form = '<form class="suform" data-form="remove" data-id="' + esc(h.id) + '" novalidate>' +
      '<p class="help">' + esc(jcFmt("adm_hh_remove_q", { n: h.members[open.m].name, h: jcHomeLabel(h) })) + '</p>' +
      '<label class="check"><input type="checkbox" id="hhDelete"> <span><b>' + esc(jcT("adm_hh_delete")) + '</b>' +
        '<small>' + esc(jcT("adm_hh_delete_help")) + '</small></span></label>' +
      '<div class="row"><button class="btn small danger" type="submit">' + esc(jcT("adm_hh_remove_go")) + '</button>' +
      '<button class="btn ghost small" type="button" data-cancel>' + esc(jcT("ev_cancel")) + '</button></div></form>';
  }
  return '<li data-home="' + esc(h.id) + '"><b>' + esc(jcHomeLabel(h)) + '</b>' +
    (flags.length ? '<div class="flags">' + flags.map(function(t){ return '<span>' + esc(t) + '</span>'; }).join("") + '</div>' : '') +
    members + acts + form + '</li>';
}
/* every write returns the whole homes list → redraw, then say so. One write at a time: a second
   tap waits (review PR #63). A late answer keeps the data but never pulls the person off another
   screen. A list that changed under us (already decided, already in a home) is read again. */
function hhMsg(text){
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = text;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
function hhWrite(name, args, okText){
  if (hhBusy) return;
  hhBusy = true;
  var from = current;
  function onErr(err){
    hhBusy = false;
    Array.prototype.forEach.call(document.querySelectorAll("#view button"), function(n){ n.disabled = false; });
    err = err && err.code ? err : { code: "UNKNOWN" };
    /* some resident-worded errors would mislead here ("ask one of them for an invite") */
    var k = "adm_hh_err_" + err.code;
    if (err.code === "NOT_ADMIN" || jcT(k) === k) return fail(err);
    if ((err.code === "NOT_FOUND" || err.code === "ALREADY_HAS_HOME") && hh && current === "households") {
      hh.data = null; hh.open = null;
      return loadHouseholds().then(function(){ if (current === "households") hhMsg(jcT(k)); });
    }
    hhMsg(jcT(k));
  }
  return rpc(name, args).then(function(d){
    d = hhShape(d);
    if (!d) return onErr({ code: "UNKNOWN" });
    hhBusy = false;
    if (!hh) return;
    hh.data = d;
    if (current !== from) return;
    hh.open = null;
    show("households");
    showOk(okText);
  }, onErr);
}
function wireHouseholds(){
  Array.prototype.forEach.call(document.querySelectorAll("[data-inv]"), function(b){
    b.addEventListener("click", function(){
      if (hhBusy) return;
      var yes = b.dataset.yes === "1";
      Array.prototype.forEach.call(document.querySelectorAll('[data-inv="' + CSS.escape(b.dataset.inv) + '"]'), function(n){ n.disabled = true; });
      hhWrite("jc_admin_invite_decide", { p_invite: b.dataset.inv, p_approve: yes }, jcT(yes ? "adm_hh_approved" : "adm_hh_declined"));
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-hh]"), function(b){
    b.addEventListener("click", function(){
      var h = hhHome(b.dataset.id), a = b.dataset.hh;
      if (!h || hhBusy) return;
      if (a === "pin") { hh.open = null; hhPin = { id: h.id }; return show("hhpin"); }
      if (a === "edit" || a === "remove") {
        var m = a === "remove" ? Number(b.dataset.m) : null;
        var same = hh.open && hh.open.id === h.id && hh.open.what === a && hh.open.m === m;
        hh.open = same ? null : { id: h.id, what: a, m: m };
        show("households");
        if (!same && a === "edit") {
          el("hhBuilding").value = el("hhBuilding").defaultValue = h.building || "";
          el("hhNumber").value = el("hhNumber").defaultValue = h.number || "";
          el("hhNumber").focus();
        }
        return;
      }
      b.disabled = true;
      hhWrite("jc_admin_home_suppress", { p_home: h.id, p_on: a === "hide" },
        jcFmt(a === "hide" ? "adm_hh_hidden_ok" : "adm_hh_shown_ok", { h: jcHomeLabel(h) }));
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-cancel]"), function(b){
    b.addEventListener("click", function(){ if (hhBusy) return; hh.open = null; show("households"); });
  });
  var t = el("hhType");
  if (t) t.addEventListener("change", function(){ el("hhBldWrap").hidden = t.value !== "apartment"; });
  Array.prototype.forEach.call(document.querySelectorAll("[data-form]"), function(f){
    f.addEventListener("submit", function(ev){
      ev.preventDefault();
      var h = hhHome(f.dataset.id);
      if (!h || hhBusy) return;
      var go = f.querySelector('button[type="submit"]');
      if (f.dataset.form === "edit") {
        var type = el("hhType").value;
        go.disabled = true;
        return hhWrite("jc_admin_home_edit", { p_home: h.id, p_village: el("hhVillage").value, p_type: type,
          p_building: type === "apartment" ? el("hhBuilding").value.trim() : null, p_number: el("hhNumber").value.trim() },
          jcT("adm_hh_saved"));
      }
      var m = h.members[hh.open && hh.open.m];
      if (!m || !m.user_id) return;
      var del = el("hhDelete").checked;
      /* deleting the account can't be undone: asked twice, by name */
      if (del && !window.confirm(jcFmt("adm_hh_delete_confirm", { n: m.name }))) return;
      go.disabled = true;
      hhWrite("jc_admin_member_remove", { p_user: m.user_id, p_delete_account: del },
        jcFmt(del ? "adm_hh_removed_deleted" : "adm_hh_removed", { n: m.name }));
    });
  });
}

/* R2a (D2): the hourly job closes an event 24 h after its end */
function closesAt(e){
  return e.closes_at || (e.ends_effective ? new Date(Date.parse(e.ends_effective) + 864e5).toISOString() : null);
}
/* R2a (D-M4): a start with no end means "sign-ups stop 6 h after the start, it closes a day later" — say so */
function noEndWarn(start, end){ return start && !end ? "\n\n" + jcT("adm_no_end_warn") : ""; }

/* R1.1 — the pin fix. The write answers with the pin (not the homes list): the list is read again,
   then Households shows the result. Undo puts the old spot back — a home with no pin before has none
   to put back. A refused spot (BAD_PIN: outside the community) keeps the map open. hhBusy stays on
   until the list is read again: a tap in between would be thrown away by the redraw. */
function hhReread(then){
  return rpc("jc_admin_homes_list").then(function(d){
    d = hhShape(d);
    if (d && hh) { hh.data = d; hh.open = null; }
  }, function(){}).then(function(){             /* the pin DID move: say so even if the re-read fails */
    hhBusy = false;
    if (current !== "hhpin" && current !== "households") return;   /* never pull them off another screen */
    hhPin = null; show("households"); then();
  });
}
function hhAfterPin(text, undo){ return hhReread(function(){ okUndo(text, undo); }); }
/* Undo is on Households (no map): undo=true words a refused old spot for that, other failures plainly */
function hhPinErr(err, undo){
  err = err && err.code ? err : { code: "UNKNOWN" };
  var k = "adm_hh_err_" + err.code;
  if (err.code === "NOT_FOUND" && hh) return hhReread(function(){ hhMsg(jcT(k)); });   /* the home went away */
  hhBusy = false;
  Array.prototype.forEach.call(document.querySelectorAll("#view button"), function(n){ n.disabled = false; });
  if (err.code === "NOT_ADMIN") return fail(err);
  if (undo) return hhMsg(jcT(err.code === "BAD_PIN" ? "adm_hh_pin_undo_bad" : "err_UNKNOWN"));
  if (jcT(k) === k) return fail(err);
  hhMsg(jcT(k));
}
function hhPinSave(){
  var h = hhHome(hhPin && hhPin.id);
  if (!h || hhBusy) return;
  if (!vmap) return hhMsg(jcT("adm_hh_pin_nomap"));          /* no map (Leaflet didn't load) = no new spot */
  var p = centerOf(vmap), label = jcHomeLabel(h), id = h.id;
  if (!window.confirm(jcFmt("adm_hh_pin_confirm", { h: label }))) return;
  hhBusy = true;
  ["hhPinGo", "hhPinCancel"].forEach(function(b){ if (el(b)) el(b).disabled = true; });
  rpc("jc_admin_home_pin_set", { p_home: id, p_lat: p.lat, p_lng: p.lng }).then(function(r){
    var from = r && Array.isArray(r.from) && r.from.length === 2 ? r.from : null;
    var undo = from ? function(){
      if (hhBusy) return false;                  /* okUndo keeps the button live */
      hhBusy = true;
      rpc("jc_admin_home_pin_set", { p_home: id, p_lat: from[0], p_lng: from[1] }).then(function(){
        return hhAfterPin(jcT("adm_undone"), null);
      }, function(err){ hhPinErr(err, true); });
    } : null;
    return hhAfterPin(jcFmt(from ? "adm_hh_pin_ok" : "adm_hh_pin_ok_new", { h: label }), undo);
  }, function(err){ hhPinErr(err, false); });
}

function eventRow(e){
  var status = e.status === "draft" ? "adm_status_draft" : e.status === "archived" ? "adm_status_archived"
    : e.ended === true ? null                                                                          /* R2a (D2) */
    : e.coming_soon ? "adm_status_soon" : e.signups_open ? "adm_status_open" : "adm_status_paused";   /* T5.4 */
  var place = e.kind === "venue"                                     /* T5.2 2c */
    ? (e.venue_name_en ? jcFmt("adm_at", { v: ar() && e.venue_name_ar ? e.venue_name_ar : e.venue_name_en }) : jcT("adm_no_venue"))
    : null;
  var line = [status ? jcT(status) : jcFmt("adm_status_ended", { t: fmtDate(closesAt(e)) }), place, fmtDate(e.starts_at),
              jcFmt(e.kind === "venue" ? "adm_households" : "adm_homes", { n: e.entries || 0 })].filter(Boolean).join(" · ");
  var acts = "";
  function btn(a, label, ghost){
    return '<button class="btn' + (ghost ? ' ghost' : '') + ' small" type="button" data-act="' + a + '" data-id="' + esc(e.id) + '">' + esc(label) + '</button>';
  }
  if (e.status === "draft") acts = btn("edit", jcT("adm_edit"), true) +
    /* T5.4: two ways out of a draft — on the list as "coming soon" (title only), or open for sign-ups */
    (isOrganizer() ? btn("announce", jcT("adm_announce"), true) + btn("publish", jcT("adm_publish_open"))
                   : '<span class="help">' + esc(jcT("adm_publish_note")) + '</span>');
  if (e.status === "live") {
    acts = btn("edit", jcT("adm_edit"), true) +
      btn(e.signups_open ? "pause" : "open", jcT(e.signups_open ? "adm_pause_signups" : "adm_open_signups"), true) +
      btn("close", jcT("adm_close"), true) +
      /* T5.4b: back to coming soon — organizers, while nobody has signed up (the server checks too) */
      (isOrganizer() && !e.coming_soon && !e.entries ? btn("announce", jcT("adm_back_to_soon"), true) : '') +
      '<a class="btn ghost small" href="../events/?id=' + esc(e.id) + '">' + esc(jcT("adm_view")) + '</a>';
  }
  if (e.status === "archived") acts = '<a class="btn ghost small" href="../events/?id=' + esc(e.id) + '">' + esc(jcT("adm_numbers")) + '</a>';
  if (e.status !== "draft") acts = btn("signups", jcT("adm_signups")) + acts;      /* T5.2 PR 4 */
  if (e.status !== "archived" && has("community")) acts += btn("admins", jcT("adm_admins"), true);
  return '<li data-event="' + esc(e.slug) + '"><div><b>' + esc(title(e)) + '</b><small>' + esc(line) + '</small></div>' +
    '<div class="acts">' + acts + '</div>' +
    (closing === e.id
      ? '<form class="closeform" id="closeForm" novalidate><p class="help">' + esc(jcFmt("adm_close_help", { slug: e.slug })) + '</p>' +
        '<input id="closeSlug" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="' + esc(e.slug) + '">' +
        '<button class="btn danger" id="closeGo" type="submit">' + esc(jcT("adm_close_go")) + '</button></form>'
      : '') +
    (admining === e.id ? adminsPanel(e) : '') + '</li>';
}

function act(a, id, b){
  var e = byId(id);
  if (!e) return;
  if (a === "edit") return openEditor(e);
  if (a === "signups") return openSignups(e);
  if (a === "admins") return toggleAdmins(id);
  if (a === "close") { closing = closing === id ? null : id; admining = null; adminsData = null; show("home"); if (el("closeSlug")) el("closeSlug").focus(); return; }
  if ((a === "publish" || a === "open") && e.kind === "venue" && (!e.venue_name_en || e.venue_lat == null)) {
    /* say what's missing before asking the server (which refuses with NO_VENUE anyway) */
    var miss = [!e.venue_name_en ? jcT("ed_venue_name_en") : null, e.venue_lat == null ? jcT("ed_venue_pin_label") : null].filter(Boolean);
    var m = el("msg"); m.className = "msg err";
    m.textContent = jcFmt(a === "open" ? "adm_open_missing" : "adm_publish_missing", { list: miss.join(", ") });
    return m.scrollIntoView({ block: "nearest" });
  }
  /* R2a (F2): a homes event needs its date to go live (opening a coming-soon one is its publish) */
  if ((a === "publish" || (a === "open" && e.coming_soon)) && e.kind !== "venue" && !e.starts_at) {
    var md = el("msg"); md.className = "msg err";
    md.textContent = jcFmt(a === "open" ? "adm_open_missing" : "adm_publish_missing", { list: jcT("ed_starts") });
    return md.scrollIntoView({ block: "nearest" });
  }
  if (a === "publish" && !window.confirm(jcFmt("adm_publish_confirm", { t: title(e) }) + noEndWarn(e.starts_at, e.ends_at))) return;
  if (a === "open" && e.coming_soon && e.starts_at && !e.ends_at && !window.confirm(jcT("adm_no_end_warn"))) return;
  if (a === "announce" && !window.confirm(jcFmt(e.status === "live" ? "adm_back_soon_confirm" : "adm_announce_confirm", { t: title(e) }))) return;
  var call = a === "publish" ? rpc("jc_admin_event_publish", { p_event: id })
    : a === "announce" ? rpc("jc_admin_event_announce", { p_event: id })
    : rpc("jc_admin_event_signups", { p_event: id, p_open: a === "open" });
  b.disabled = true;
  call.then(function(list){
    events = list; show("home");
    showOk(jcT(a === "publish" ? "adm_published" : a === "announce" ? "adm_announced" : a === "open" ? "adm_opened" : "adm_paused"));
  }, function(err){ b.disabled = false; fail(err); });
}

function closeEvent(){
  var e = byId(closing);
  if (!e) return;
  if (el("closeSlug").value.trim() !== e.slug) return showErr("CLOSE_CONFIRM");
  busy("closeGo", true);
  rpc("jc_event_close", { p_event: e.id, p_confirm: e.slug }).then(function(snap){
    closing = null;
    return rpc("jc_admin_events_list").then(function(list){
      events = list; show("home");
      showOk(jcFmt("adm_closed_ok", { n: (snap && snap.homes) || 0 }));
    });
  }, function(err){ busy("closeGo", false); fail(err); });
}

function rotate(scope, b){
  if (!window.confirm(jcFmt("adm_rotate_confirm", { s: jcT("adm_code_" + scope) }))) return;
  b.disabled = true;
  rpc("jc_admin_code_rotate", { p_scope: scope }).then(function(r){
    current = "home";
    newCode = { scope: r.scope, code: r.code };   /* drawn once; the next show() drops it */
    VIEWS.home();
  }, function(err){ b.disabled = false; fail(err); });
}

/* ---------- event admins (T5.2 PR B; community admin only — the server enforces it) ---------- */
function adminsPanel(e){
  if (!adminsData) return '<div class="adminsbox"><p class="help">' + esc(jcT("working")) + '</p></div>';
  var rows = adminsData.admins.map(function(a){
    var home = a.number ? jcHomeLabel(a) : "";
    return '<li><span><b>' + esc(a.name) + '</b>' + (home ? '<small>' + esc(home) + '</small>' : '') + '</span>' +
      '<button class="mini danger" type="button" data-unadmin="' + esc(a.user_id) + '" data-name="' + esc(a.name) + '">' +
      esc(jcT("adm_admins_remove")) + '</button></li>';
  }).concat(adminsData.links.map(function(l){
    return '<li><span><small>' + esc(jcFmt("adm_admins_pending", { d: fmtDate(l.expires_at) })) + '</small></span>' +
      '<button class="mini" type="button" data-unlink="' + esc(l.id) + '">' + esc(jcT("adm_admins_cancel_link")) + '</button></li>';
  }));
  return '<div class="adminsbox"><b>' + esc(jcT("adm_admins_title")) + '</b>' +
    (rows.length ? '<ul class="adminlist">' + rows.join("") + '</ul>' : '<p class="help">' + esc(jcT("adm_admins_none")) + '</p>') +
    (newLink && newLink.event === e.id
      ? '<div class="codebox" role="status"><span>' + esc(jcT("adm_admins_link_help")) + '</span>' +
        '<b class="linkbox" id="newLink">' + esc(newLink.url) + '</b>' +
        '<button class="btn ghost small" type="button" id="copyLink">' + esc(jcT("adm_copy")) + '</button>' +
        (navigator.share ? '<button class="btn ghost small" type="button" id="shareLink">' + esc(jcT("mh_share")) + '</button>' : '') +
        '</div>'
      : '<button class="btn small" type="button" id="makeLink">' + esc(jcT("adm_admins_link")) + '</button>') +
    '</div>';
}

function toggleAdmins(id){
  closing = null;
  if (admining === id) { admining = null; adminsData = null; return show("home"); }
  admining = id; adminsData = null; show("home");
  rpc("jc_event_admins_list", { p_event: id }).then(function(d){
    if (admining !== id) return;
    adminsData = d; show("home");
  }, fail);
}

function wireAdmins(){
  if (!admining) return;
  var keepLink = newLink;
  var id = admining;                       /* results belong to the panel they were asked from */
  function draw(link){ if (admining !== id) return; current = "home"; newLink = link; VIEWS.home(); }
  on("makeLink", function(){
    busy("makeLink", true);
    rpc("jc_event_admin_link_create", { p_event: id }).then(function(r){
      /* drawn once; the next show() drops it — and shown even if the list refresh fails,
         because the token can never be shown again */
      var link = { event: id, url: location.origin + location.pathname + "?eventadmin=" + encodeURIComponent(r.token) };
      return rpc("jc_event_admins_list", { p_event: id }).then(function(d){
        if (admining === id) adminsData = d;
        draw(link);
      }, function(){ draw(link); });
    }, function(err){ busy("makeLink", false); fail(err); });
  });
  on("copyLink", function(){
    (navigator.clipboard ? navigator.clipboard.writeText(keepLink.url) : Promise.reject())
      .then(function(){ el("copyLink").textContent = jcT("adm_copied"); },
            function(){ showErr("COPY_FAILED"); });
  });
  on("shareLink", function(){ navigator.share({ url: keepLink.url }).catch(function(){}); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-unadmin], [data-unlink]"), function(b){
    b.addEventListener("click", function(){
      if (b.dataset.unadmin && !window.confirm(jcFmt("adm_admins_remove_confirm", { n: b.dataset.name }))) return;
      b.disabled = true;
      rpc("jc_event_admin_revoke", { p_event: id, p_user: b.dataset.unadmin || null, p_link: b.dataset.unlink || null })
        .then(function(d){ if (admining !== id) return; adminsData = d; show("home"); showOk(jcT("adm_admins_removed")); },
              function(err){ b.disabled = false; fail(err); });
    });
  });
}

/* ---------- courts (R4b-1b; server S3 + R4a) ---------- */
function loadCourts(){
  if (ctLoading) return;
  ctLoading = true;
  Promise.all([rpc("jc_admin_facilities_list"), rpc("jc_admin_booking_rules")]).then(function(r){
    ctLoading = false;
    if (!isCourtsAdmin()) return;                     /* the right ended while it was on its way (review L2 / L4) */
    ct = { list: Array.isArray(r[0]) ? r[0].filter(hObj) : [], rules: hObj(r[1]) || {} };
    var note = ctNote; ctNote = null;
    if (current === "home" && admTab === "courts") {
      /* the list lands after the page: a message already on screen ("Done…", "Saved.") must survive the redraw */
      var m = el("msg"), keep = m && m.textContent ? { c: m.className, t: m.textContent } : null;
      show("home");
      if (note) ctMsg(note);
      else if (keep && el("msg")) { el("msg").className = keep.c; el("msg").textContent = keep.t; }
    }
  }, function(e){
    ctLoading = false;
    if (e.code === "NOT_ADMIN") return fail(e);
    ct = { err: e.code || "UNKNOWN" };
    if (current === "home" && admTab === "courts") { show("home"); showErr(ct.err); }
  });
}
function hm(t){ return typeof t === "string" ? t.slice(0, 5) : ""; }
function courtStatus(f){ return f.status === "published" || f.status === "retired" ? f.status : "draft"; }
function courtRow(f){
  var st = courtStatus(f), n = f.upcoming || 0;
  var name = ar() && f.name_ar ? f.name_ar : f.name_en;
  var meta = [jcT("ct_kind_" + (f.kind === "basketball" ? "basketball" : "tennis")),
              "⁦" + hm(f.open_time) + "–" + hm(f.close_time) + "⁩",
              f.walk_on ? jcT("ct_walk_on_short") : jcFmt("ct_slot_n", { n: f.slot_minutes }) + " · " + jcFmt("ct_window_n", { n: f.window_days })];
  var acts = st === "retired" ? [] : (f.walk_on ? [] : [["day", "ct_act_day"]]).concat([["edit", "ct_act_edit"]])
    .concat(st === "draft" ? [["published", "ct_act_publish"]] : st === "published" ? [["draft", "ct_act_unpublish"]] : [])
    .concat([["retired", "ct_act_retire"]]);
  return '<li data-court="' + esc(f.id) + '" class="' + st + '"><b dir="auto">' + esc(name) + '</b>' +
    '<div class="ctchips"><span class="chip">' + esc(jcT("ct_st_" + st)) + '</span>' +
    (f.lat == null && st !== "retired" ? '<span class="chip">' + esc(jcT("ct_no_pin")) + '</span>' : '') + '</div>' +
    '<div class="meta">' + esc(meta.join(" · ")) + '</div>' +
    (st !== "retired" && !f.walk_on ? '<div class="meta">' + esc(jcFmt("ct_upcoming", { n: n })) + '</div>' : '') +
    (acts.length ? '<div class="acts">' + acts.map(function(a){
      return '<button class="mini' + (a[0] === "retired" ? ' danger' : '') + '" type="button" data-ct="' + a[0] + '" data-id="' + esc(f.id) + '">' +
        esc(jcT(a[1])) + '</button>';
    }).join("") + '</div>' : '') + '</li>';
}
function admCourtsHtml(){
  if (!ct) { loadCourts(); return '<p class="help">' + esc(jcT("working")) + '</p>'; }
  if (ct.err) return '<div class="row"><button class="btn ghost" type="button" id="ctRetry">' + esc(jcT("adm_ad_retry")) + '</button></div>';
  var r = ct.rules;
  var live = ct.list.filter(function(f){ return courtStatus(f) !== "retired"; });
  var gone = ct.list.filter(function(f){ return courtStatus(f) === "retired"; });
  return (r.enabled === true ? '' : '<p class="notice" id="ctOff">' + esc(jcT("ct_module_off")) + '</p>') +
    '<p class="help" id="ctRules">' + esc(jcFmt("ct_rules", { d: r.per_home_per_day, a: r.per_home_active, k: r.retention_days || 90 })) + '</p>' +
    '<div class="row"><button class="btn" type="button" id="ctNew">' + esc(jcT("ct_new")) + '</button></div>' +
    '<h2 class="group">' + esc(jcT("ct_list")) + '</h2>' +
    (live.length ? '<ul class="sulist ctlist">' + live.map(courtRow).join("") + '</ul>' : '<p class="help">' + esc(jcT("ct_none")) + '</p>') +
    (gone.length ? '<h2 class="group">' + esc(jcT("ct_retired")) + '</h2><ul class="sulist ctlist">' + gone.map(courtRow).join("") + '</ul>' : '');
}
function courtById(id){ return ((ct && ct.list) || []).filter(function(f){ return f.id === id; })[0]; }
function wireCourts(){
  on("ctRetry", function(){ ct = null; show("home"); });
  on("ctNew", function(){ ctEd = { f: null, draft: null, pin: null }; show("court"); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-ct]"), function(b){
    b.addEventListener("click", function(){
      var f = courtById(b.dataset.id);
      if (!f) return showErr("NOT_FOUND");
      var to = b.dataset.ct;
      if (to === "edit") { ctEd = { f: f, draft: null, pin: null }; return show("court"); }
      if (to === "day") { cd = { f: f, date: cdToday(), slots: null, err: null, loading: false, form: null, draft: null }; return show("courtday"); }
      if (ctBusy) return;
      var name = ar() && f.name_ar ? f.name_ar : f.name_en, n = f.upcoming || 0;
      /* the server cancels every booking not yet over — a slot being played now too (security review L3) */
      var why = to === "draft" ? "ct_confirm_cancels_draft" : "ct_confirm_cancels_retire";
      var ask = to === "published" ? jcFmt("ct_confirm_publish", { c: name })
        : jcFmt(to === "draft" ? "ct_confirm_unpublish" : "ct_confirm_retire", { c: name }) +
          (f.walk_on || (n === 0 && courtStatus(f) !== "published") ? "" : " " + jcFmt(n > 0 ? why : why + "_now", { n: n }));
      if (!window.confirm(ask)) return;
      ctBusy = true; b.disabled = true;
      rpc("jc_admin_facility_status", { p_facility: f.id, p_status: to }).then(function(list){
        ctBusy = false;
        if (ct && Array.isArray(list)) ct.list = list.filter(hObj);
        if (current !== "home") return;
        show("home");
        showOk(jcT(to === "published" ? "ct_done_publish" : to === "draft" ? "ct_done_unpublish" : "ct_done_retire"));
      }, function(e){
        ctBusy = false; b.disabled = false;
        if (e.code === "NOT_ADMIN") return fail(e);
        if (e.code === "BAD_STATE" || e.code === "NOT_FOUND") { ct = null; ctNote = e.code; return show("home"); }
        ctMsg(e.code);
      });
    });
  });
}
function ctMsg(code){
  var t = jcT("ct_err_" + code);
  if (t === "ct_err_" + code) return showErr(code);
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = t;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
/* the form's starting values: the court as stored, or the server's defaults for a new one */
function courtValues(f){
  f = f || {};
  return { name_en: f.name_en || "", name_ar: f.name_ar || "", kind: f.kind || "", location_note: f.location_note || "",
           walk_on: f.walk_on === true, open_time: hm(f.open_time) || "07:00", close_time: hm(f.close_time) || "22:00",
           slot_minutes: f.slot_minutes || 60, window_days: f.window_days || 7 };
}
function courtForm(){
  var k = document.querySelector('input[name="ct_kind"]:checked');
  return { name_en: el("ct_name_en").value.trim(), name_ar: el("ct_name_ar").value.trim(), kind: k ? k.value : "",
           location_note: el("ct_note").value.trim(), walk_on: el("ct_walk_on").checked,
           open_time: el("ct_open").value, close_time: el("ct_close").value,
           slot_minutes: parseInt(el("ct_slot").value, 10),
           window_days: el("ct_window").value.trim() === "" ? null : Number(el("ct_window").value) };
}
function drawCourtPin(){
  var n = el("ctPinState");
  if (n) n.textContent = jcT(ctEd.pin ? "ct_pin_set" : "ct_pin_unset");
}
function minutes(t){ var m = /^(\d\d):(\d\d)$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; }
/* Mirrors the table's checks (S3): name 1–60, whole-minute same-day hours with room for one slot, window 1–30.
   An edit sends ONLY what changed — an untouched grid never trips RULES_LOCKED. */
function saveCourt(){
  var v = courtForm(), f = ctEd.f;
  if (!v.name_en) return ctMsg("NO_NAME");
  if (!v.kind) return ctMsg("NO_KIND");
  var o = minutes(v.open_time), c = minutes(v.close_time);
  var was = courtValues(f), fields = {};
  if (v.walk_on) {
    /* slot + days ahead are hidden for a walk-on court (review M2): keep what's stored, but the table still needs
       the hours to hold one slot — a short day takes the shortest slot instead of failing on a field nobody sees */
    if (o == null || c == null || c - o < 30) return ctMsg("BAD_HOURS_WALK");
    if (!(Number.isInteger(v.window_days) && v.window_days >= 1 && v.window_days <= 30)) v.window_days = was.window_days;
    if (c - o < v.slot_minutes) v.slot_minutes = 30;
  } else {
    if (o == null || c == null || c - o < v.slot_minutes) return ctMsg("BAD_HOURS");
    if (!(Number.isInteger(v.window_days) && v.window_days >= 1 && v.window_days <= 30)) return ctMsg("BAD_WINDOW");
  }
  ["name_en", "name_ar", "kind", "location_note", "walk_on", "open_time", "close_time", "slot_minutes", "window_days"].forEach(function(k){
    if (!f || v[k] !== was[k]) fields[k] = v[k];
  });
  var pinWas = f && f.lat != null ? f.lat + "," + f.lng : null, pinNow = ctEd.pin ? ctEd.pin.lat + "," + ctEd.pin.lng : null;
  if (ctEd.pin && (!f || pinNow !== pinWas)) { fields.lat = ctEd.pin.lat; fields.lng = ctEd.pin.lng; }
  if (f && !Object.keys(fields).length) { ctEd = null; show("home"); return showOk(jcT("ct_saved")); }
  busy("ctSave", true);
  var mine = ctEd;
  rpc("jc_admin_facility_save", { p_facility: f ? f.id : null, p_fields: fields }).then(function(list){
    /* the save landed: the list is right even if they already left the editor (review M1) */
    if (ct && Array.isArray(list)) ct.list = list.filter(hObj); else ct = null;
    if (current !== "court" || ctEd !== mine) { if (current === "home" && admTab === "courts") show("home"); return; }
    ctEd = null; admTab = "courts";
    try { history.replaceState(null, "", "?tab=courts"); } catch(e){}
    show("home"); showOk(jcT("ct_saved"));
  }, function(e){
    busy("ctSave", false);
    if (e.code === "NOT_ADMIN") return fail(e);
    ctMsg(e.code);
  });
}

/* ---------- court day view (R4b-2; server S3 + R4a / R4a-2) ---------- */
/* Days are community-time dates (jc_admin_facility_day takes a date in cfg.tz) and every time shown is in cfg.tz,
   never the phone's zone. A block's ends come from the slots the server returned, so no time arithmetic here. */
var CD_AHEAD = 90;     /* Zee 2026-11-09: today → 90 days ahead; past days hidden */
var CD_SPAN = 30;      /* a multi-day block ends at most 30 days after its first day (server: ≤ 31 days) */
var CD_PRESETS = ["maintenance", "event", "official", "other"];
/* the shared community-time helpers live in api.js (R4c reuses them) */
function cdToday(){ return jcTzToday(cfg); }
function cdAdd(d, n){ return jcDateAdd(d, n); }
function cdIsDate(d){ return jcIsDate(d); }
function cdDayText(d){ return jcDayText(d); }
function cdTime(iso){ return jcClock(iso, cfg); }
function cdOver(s){ return Date.parse(s.ends_at) <= Date.now(); }
function cdBooked(s){ return (s.state === "booked" || s.state === "mine") && !!s.booking_id; }
function cdSlots(d){
  return hObj(d) && Array.isArray(d.slots) ? d.slots.filter(function(s){
    return hObj(s) && typeof s.starts_at === "string" && typeof s.ends_at === "string" && !isNaN(Date.parse(s.starts_at)) && !isNaN(Date.parse(s.ends_at));
  }) : null;
}
/* then() runs after the redraw, so a message it draws survives */
function loadDay(then){
  var mine = cd, seq = ++cdSeq;
  mine.slots = null; mine.err = null; mine.loading = true;
  if (current === "courtday") cdDraw();                /* the old day's forms go at once (review M1) */
  rpc("jc_admin_facility_day", { p_facility: mine.f.id, p_date: mine.date }).then(function(d){
    if (cd !== mine || seq !== cdSeq) return;
    mine.loading = false;
    if (!isCourtsAdmin()) { cd = null; return; }               /* the right ended on the way (review L3) */
    if (current !== "courtday") return;
    var s = cdSlots(d);
    if (s) mine.slots = s; else mine.err = "UNKNOWN";
    cdDraw();
    if (then && s) then();
  }, function(e){
    if (cd !== mine || seq !== cdSeq) return;
    mine.loading = false;
    if (current !== "courtday") return;
    if (e.code === "NOT_ADMIN") return fail(e);
    if (e.code === "NOT_FOUND") { cd = null; ct = null; ctNote = "NOT_FOUND"; admTab = "courts"; return show("home"); }
    mine.err = e.code || "UNKNOWN"; cdDraw();
  });
}
/* an in-place redraw keeps focus where it was (review L1) */
function cdDraw(){ var r = jcFocusKeep(); VIEWS.courtday(); r(); }
function cdMsg(code){
  var t = jcT("cd_err_" + code);
  if (t === "cd_err_" + code) return showErr(code);
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = t;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
/* one block's run of slots is one row */
function cdRows(slots){
  var out = [];
  slots.forEach(function(s, i){
    var last = out[out.length - 1];
    if (s.state === "blocked" && s.block_id && last && last.state === "blocked" && last.block_id === s.block_id) { last.ends_at = s.ends_at; return; }
    out.push(Object.assign({}, s, { i: i }));
  });
  return out;
}
function cdRowHtml(r){
  var st = r.state === "mine" ? "booked" : r.state === "free" || r.state === "booked" || r.state === "blocked" ? r.state : "past";
  var over = cdOver(r);
  var h = '<li data-slot="' + r.i + '" class="slot slot-' + st + ' cd-' + st + '"><div class="cdhead"><b class="cdtime">⁦' + esc(cdTime(r.starts_at) + "–" + cdTime(r.ends_at)) + '⁩</b>' +
    '<span class="chip slotchip">' + esc(jcT("cd_st_" + st)) + '</span>' +
    (st === "booked" && r.is_private === true ? '<span class="chip">' + esc(jcT("cd_private")) + '</span>' : '') + '</div>';
  if (st === "booked") {
    var hm_ = hObj(r.home);
    var who = hm_ ? [jcHomeLabel(hm_), hm_.village ? jcVillageName(cfg, hm_.village) : ""].filter(Boolean).join(" · ") : "";
    if (who) h += '<div class="meta" dir="auto">' + esc(who) + '</div>';
    if (!over && r.booking_id) {
      if (cd.form && cd.form.kind === "cancel" && cd.form.id === r.booking_id) {
        h += '<div class="cdform"><label>' + esc(jcT("cd_cancel_reason")) +
          '<input id="cdCancelWhy" type="text" maxlength="200" dir="auto" autocomplete="off"></label>' +
          '<div class="acts"><button class="mini danger" type="button" id="cdCancelGo">' + esc(jcT("cd_cancel_go")) + '</button>' +
          '<button class="mini" type="button" id="cdCancelKeep">' + esc(jcT("cd_keep")) + '</button></div></div>';
      } else {
        h += '<div class="acts"><button class="mini danger" type="button" data-cdcancel="' + esc(r.booking_id) + '" aria-label="' +
          esc(jcT("cd_cancel") + " " + cdTime(r.starts_at)) + '">' + esc(jcT("cd_cancel")) + '</button></div>';
      }
    }
  }
  if (st === "blocked") {
    if (r.block_reason) h += '<div class="meta" dir="auto">' + esc(r.block_reason) + '</div>';
    if (r.block_id) h += '<div class="acts"><button class="mini" type="button" data-cdunblock="' + esc(r.block_id) + '" aria-label="' +
      esc(jcT("cd_remove") + " " + cdTime(r.starts_at)) + '">' + esc(jcT("cd_remove")) + '</button></div>';
  }
  return h + '</li>';
}
function cdBlockHtml(open){
  return '<form class="panel" id="cdBlockForm" novalidate data-no-autoreload>' +
    '<h2 class="group">' + esc(jcT("cd_block")) + '</h2>' +
    '<label>' + esc(jcT("cd_from")) + '<select id="cdFrom">' + open.map(function(s){
      return '<option value="' + s.i + '">' + esc(cdTime(s.starts_at)) + '</option>'; }).join("") + '</select></label>' +
    '<fieldset><legend>' + esc(jcT("cd_until")) + '</legend>' +
      '<label class="check"><input type="radio" name="cdUntil" value="day" checked> <span>' + esc(jcT("cd_until_day")) + '</span></label>' +
      '<label class="check"><input type="radio" name="cdUntil" value="days"> <span>' + esc(jcT("cd_until_days")) + '</span></label>' +
    '</fieldset>' +
    '<label id="cdToWrap">' + esc(jcT("cd_to")) + '<select id="cdTo">' + open.map(function(s){
      return '<option value="' + s.i + '">' + esc(cdTime(s.ends_at)) + '</option>'; }).join("") + '</select></label>' +
    '<label id="cdLastWrap">' + esc(jcT("cd_last")) + '<input id="cdLast" type="date" min="' + cdAdd(cd.date, 1) + '" max="' + cdAdd(cd.date, CD_SPAN) + '"></label>' +
    '<p class="help" id="cdLastHelp">' + esc(jcT("cd_last_help")) + '</p>' +
    '<div class="row"><button class="btn ghost small" type="button" id="cdWhole">' + esc(jcT("cd_whole")) + '</button></div>' +
    '<div class="ctchips" role="group" aria-label="' + esc(jcT("cd_presets")) + '">' + CD_PRESETS.map(function(k){
      return '<button class="mini" type="button" data-cdpre="' + k + '">' + esc(jcT("cd_pre_" + k)) + '</button>'; }).join("") + '</div>' +
    '<label>' + esc(jcT("cd_reason")) + '<input id="cdWhy" type="text" maxlength="185" dir="auto" autocomplete="off"></label>' +
    '<p class="help">' + esc(jcT("cd_reason_help")) + '</p>' +
    '<div class="row"><button class="btn" type="submit" id="cdBlockGo">' + esc(jcT("cd_block_go")) + '</button>' +
    '<button class="btn ghost" type="button" id="cdBlockKeep">' + esc(jcT("ct_cancel")) + '</button></div></form>';
}
/* what's typed in an open form, kept across a language switch */
function cdDraft(){
  if (!cd || !cd.form) return null;
  var d = {};
  ["cdFrom", "cdTo", "cdLast", "cdWhy", "cdCancelWhy"].forEach(function(id){ var n = el(id); if (n) d[id] = n.value; });
  var u = document.querySelector('input[name="cdUntil"]:checked');
  if (u) d.until = u.value;
  return d;
}
function cdWire(){
  var today = cdToday();
  function go(d){ if (cdBusy || !cdIsDate(d) || d < today || d > cdAdd(today, CD_AHEAD)) return false; cd.date = d; cd.form = null; loadDay(); return true; }
  on("cdPrev", function(){ go(cdAdd(cd.date, -1)); });
  on("cdNext", function(){ go(cdAdd(cd.date, 1)); });
  var di = el("cdDate");
  if (di) di.addEventListener("change", function(){ if (!go(di.value)) di.value = cd.date; });
  /* a mouse click on the invisible picker lands on a date part, not the calendar: open the calendar (a tap on iOS already does) */
  if (di && di.showPicker) di.addEventListener("click", function(){ if (!(window.matchMedia && matchMedia("(pointer: coarse)").matches)) try { di.showPicker(); } catch(e){} });
  on("cdRetry", function(){ loadDay(); });
  on("cdBlock", function(){ if (cdBusy || !cd.slots) return; cd.form = { kind: "block" }; VIEWS.courtday(); var n = el("cdFrom"); if (n) n.focus(); });
  on("cdBlockKeep", function(){ cd.form = null; cdDraw(); if (el("cdBlock")) el("cdBlock").focus(); });
  on("cdCancelKeep", function(){ var id = cd.form && cd.form.id; cd.form = null; cdDraw();
    var b = id && document.querySelector('[data-cdcancel="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (b) b.focus(); });
  each("[data-cdcancel]", function(b){
    if (cdBusy) return;
    cd.form = { kind: "cancel", id: b.dataset.cdcancel }; VIEWS.courtday();
    var n = el("cdCancelWhy"); if (n) n.focus();
  });
  on("cdCancelGo", function(){
    var b = el("cdCancelGo"), why = el("cdCancelWhy").value.trim(), id = cd.form && cd.form.id;
    if (!id || !cd.slots || cdBusy) return;            /* a day reload on its way (review M1) */
    if (why.length < 3) return cdMsg("REASON");
    cdWrite(b, function(){
      return rpc("jc_admin_booking_cancel", { p_booking: id, p_reason: why }).then(function(list){
        if (ct && Array.isArray(list)) ct.list = list.filter(hObj);    /* the counts are right even if they left */
        return true;
      });
    }, function(){ cd.form = null; loadDay(function(){ showOk(jcT("cd_done_cancel")); }); });
  });
  each("[data-cdunblock]", function(b){
    if (!window.confirm(jcT("cd_confirm_remove"))) return;
    var id = b.dataset.cdunblock;
    cdWrite(b, function(){ return rpc("jc_admin_block_remove", { p_block: id }); },
      function(){ loadDay(function(){ showOk(jcT("cd_done_remove")); }); });
  });
  var form = el("cdBlockForm");
  if (!form) return;
  function syncUntil(){
    var days = document.querySelector('input[name="cdUntil"]:checked').value === "days";
    el("cdToWrap").hidden = days; el("cdLastWrap").hidden = !days; el("cdLastHelp").hidden = !days;
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="cdUntil"]'), function(n){ n.addEventListener("change", syncUntil); });
  syncUntil();
  followStart(el("cdFrom"), el("cdTo"), true);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="cdUntil"]'), function(n){
    n.addEventListener("change", function(){ if (n.value === "days" && !el("cdLast").value) el("cdLast").value = cdAdd(cd.date, 1); });
  });
  on("cdWhole", function(){
    var f = el("cdFrom"), t = el("cdTo");
    f.selectedIndex = 0; t.selectedIndex = t.options.length - 1;
    document.querySelector('input[name="cdUntil"][value="day"]').checked = true; syncUntil();
  });
  each("[data-cdpre]", function(b){
    var w = el("cdWhy");
    w.value = b.dataset.cdpre === "other" ? "" : jcT("cd_pre_" + b.dataset.cdpre);
    w.focus();
  });
  form.addEventListener("submit", function(e){ e.preventDefault(); cdBlockSubmit(); });
}
function cdBlockSubmit(){
  if (!cd || !cd.slots || cdBusy) return;            /* a day reload / a write on its way (review M1 / L4) */
  var why = el("cdWhy").value.trim();
  if (why.length < 3) return cdMsg("REASON");
  var a = cd.slots[+el("cdFrom").value];
  if (!a) return cdMsg("RANGE");
  var name = ar() && cd.f.name_ar ? cd.f.name_ar : cd.f.name_en;
  var days = document.querySelector('input[name="cdUntil"]:checked').value === "days";
  var b = el("cdBlockGo");
  if (!days) {
    var zi = +el("cdTo").value, z = cd.slots[zi];
    if (!z || zi < +el("cdFrom").value) return cdMsg("RANGE");
    var n = cd.slots.slice(+el("cdFrom").value, zi + 1).filter(function(s){ return cdBooked(s) && !cdOver(s); }).length;
    var ask = jcFmt("cd_confirm_block", { c: name, r: "⁦" + cdDayText(cd.date) + " " + cdTime(a.starts_at) + "–" + cdTime(z.ends_at) + "⁩" }) +
      (n > 0 ? " " + jcFmt("cd_confirm_block_n", { n: n }) : "");
    if (!window.confirm(ask)) return;
    return cdBlockSend(b, a.starts_at, z.ends_at, why);
  }
  var last = el("cdLast").value;
  if (!cdIsDate(last) || last <= cd.date || last > cdAdd(cd.date, CD_SPAN)) return cdMsg("RANGE_DAYS");
  /* the end is the last slot of that day, as the server lays it out (community time, its own hours) */
  cdWrite(b, function(){
    return rpc("jc_admin_facility_day", { p_facility: cd.f.id, p_date: last }).then(function(d){
      var s = cdSlots(d);
      if (!s || !s.length) throw jcErr("NO_SLOTS");
      return s[s.length - 1].ends_at;
    });
  }, function(end){
    var ask = jcFmt("cd_confirm_block", { c: name, r: "⁦" + cdDayText(cd.date) + " " + cdTime(a.starts_at) + " – " + cdDayText(last) + " " + cdTime(end) + "⁩" }) +
      " " + jcT("cd_confirm_block_days");
    if (!window.confirm(ask)) { if (el("cdBlockGo")) el("cdBlockGo").disabled = false; return; }
    cdBlockSend(el("cdBlockGo"), a.starts_at, end, why);
  });
}
function cdBlockSend(b, from, to, why){
  cdWrite(b, function(){
    return rpc("jc_admin_block_create", { p_facility: cd.f.id, p_starts: from, p_ends: to, p_reason: why }).then(function(r){
      loadCourts();                                /* upcoming counts changed: re-read now (never null a list that may be on screen) */
      return hObj(r) || {};
    });
  }, function(r){
    var n = typeof r.bookings_cancelled === "number" ? r.bookings_cancelled : 0;
    cd.form = null;
    loadDay(function(){ showOk(n > 0 ? jcFmt("cd_done_block", { n: n }) : jcT("cd_done_block_0")); });
  });
}
/* every write: one at a time; cdBusy always comes back down; an answer after leaving changes nothing on screen */
function cdWrite(b, call, done){
  if (cdBusy) return;
  var mine = cd;
  cdBusy = true; if (b) b.disabled = true;
  Promise.resolve().then(call).then(function(d){
    cdBusy = false;
    if (cd !== mine || current !== "courtday") return;
    return done(d);
  }).catch(function(e){
    cdBusy = false; if (b) b.disabled = false;
    if (cd !== mine || current !== "courtday") return;
    if (e && e.code === "NOT_ADMIN") return fail(e);
    if (e && e.code === "NOT_FOUND") { cd.form = null; return loadDay(function(){ cdMsg("NOT_FOUND"); }); }
    cdMsg((e && e.code) || "UNKNOWN");
  });
}

/* ---------- admins at every level (R4b-1a; server R4a-2 / R4a-3) ---------- */
function adShape(d){
  d = hObj(d) || {};
  return {
    admins: (Array.isArray(d.admins) ? d.admins : []).filter(hObj).map(function(a){
      return Object.assign({}, a, { via: Array.isArray(a.via) ? a.via : [] });
    }),
    links: (Array.isArray(d.links) ? d.links : []).filter(hObj)
  };
}
/* every level's list in one go. keep: the links on screen survive the reload (a NOT_FOUND re-read);
   then() runs after the redraw, so a message it draws survives */
function loadAdmins(then, keep){
  adErr = null;
  return Promise.all(AD_SCOPES.map(function(s){ return rpc("jc_module_admins_list", { p_scope: s }); })).then(function(r){
    if (current !== "admins") return;
    ad = {};
    AD_SCOPES.forEach(function(s, i){ ad[s] = adShape(r[i]); });
    adLinks = keep || {}; VIEWS.admins();
    if (then) then();
  }, function(e){
    if (current !== "admins") return;
    if (e.code === "NOT_ADMIN") return fail(e);
    adErr = e.code || "UNKNOWN"; VIEWS.admins();           /* never a "Working…" that stays (code review L1) */
  });
}
function adMsg(code){
  var t = jcT("adm_ad_err_" + code);
  if (t === "adm_ad_err_" + code) return showErr(code);
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = t;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
function adScopeHtml(s){
  var d = ad[s];
  var rows = d.admins.map(function(a){
    var home = a.number ? jcHomeLabel(a) : "";
    var chips = [a.via.indexOf("invite") >= 0 ? jcT("adm_ad_via_invite") : null,
                 a.via.indexOf("code") >= 0 ? jcT("adm_ad_via_code") : null,
                 a.idle === true ? jcT("adm_ad_idle") : null].filter(Boolean);
    return '<li data-admin="' + esc(a.user_id) + '"><span><b dir="auto">' + esc(a.name) + '</b>' +
      (home ? '<small>' + esc(home) + '</small>' : '') +
      (chips.length ? '<small class="chips">' + chips.map(function(t){ return '<span class="chip">' + esc(t) + '</span>'; }).join("") + '</small>' : '') +
      '</span><button class="mini danger" type="button" data-adrm="' + s + '" data-user="' + esc(a.user_id) +
      '" data-name="' + esc(a.name) + '">' + esc(jcT("adm_admins_remove")) + '</button></li>';
  }).concat(d.links.map(function(l){
    return '<li><span><small>' + esc(jcFmt("adm_admins_pending", { d: hDate(l.expires_at) })) + '</small></span>' +
      '<button class="mini" type="button" data-adcancel="' + s + '" data-link="' + esc(l.id) + '">' +
      esc(jcT("adm_admins_cancel_link")) + '</button></li>';
  }));
  var url = jcOwn(adLinks, s);
  return '<h2 class="group">' + esc(jcT("adm_ad_scope_" + s)) + '</h2>' +
    '<div class="panel adminsbox" data-scope="' + s + '"><p class="help">' + esc(jcT("adm_ad_can_" + s)) + '</p>' +
    (rows.length ? '<ul class="adminlist">' + rows.join("") + '</ul>' : '<p class="help">' + esc(jcT("adm_ad_none")) + '</p>') +
    (url
      ? '<div class="codebox" role="status"><span>' + esc(jcT(s === "community" ? "adm_ad_link_help_community" : "adm_ad_link_help")) + '</span>' +
        '<b class="linkbox" data-adurl="' + s + '">' + esc(url) + '</b>' +
        '<button class="btn ghost small" type="button" data-adcopy="' + s + '">' + esc(jcT("adm_copy")) + '</button>' +
        (navigator.share ? '<button class="btn ghost small" type="button" data-adshare="' + s + '">' + esc(jcT("mh_share")) + '</button>' : '') +
        '</div>'
      : '<button class="btn small" type="button" data-admake="' + s + '">' + esc(jcT("adm_ad_make")) + '</button>') +
    '</div>';
}
function wireAdminsView(){
  function draw(okText){
    if (current !== "admins") return;
    VIEWS.admins();                                   /* not show(): the links on screen stay (review M1) */
    if (okText) showOk(okText);
  }
  /* every write: one at a time; adBusy always comes back down, even on a malformed answer (review M2) */
  function write(b, call, done){
    if (adBusy) return;
    adBusy = true; b.disabled = true;
    call().then(function(d){ adBusy = false; return done(d); }).catch(function(e){
      adBusy = false; b.disabled = false;
      if (current !== "admins") return;
      if (e && e.code === "NOT_ADMIN") return fail(e);
      if (e && e.code === "NOT_FOUND") { ad = null; return loadAdmins(function(){ adMsg("NOT_FOUND"); }, adLinks); }
      adMsg((e && e.code) || "UNKNOWN");
    });
  }
  each("[data-admake]", function(b){
    var s = b.dataset.admake;
    write(b, function(){
      return rpc("jc_module_admin_link_create", { p_scope: s }).then(function(r){
        if (!r || typeof r.token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(r.token)) throw { code: "UNKNOWN" };
        /* shown even if the list refresh fails: the token can never be shown again */
        adLinks[s] = location.origin + location.pathname + "#admininvite=" + r.token;
        return rpc("jc_module_admins_list", { p_scope: s }).then(function(d){ if (ad) ad[s] = adShape(d); }, function(){});
      });
    }, function(){ draw(); });
  });
  each("[data-adcopy]", function(b){
    var url = jcOwn(adLinks, b.dataset.adcopy);
    (navigator.clipboard && url ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(function(){ b.textContent = jcT("adm_copied"); }, function(){ showErr("COPY_FAILED"); });
  });
  each("[data-adshare]", function(b){
    var url = jcOwn(adLinks, b.dataset.adshare);
    if (url) navigator.share({ url: url }).catch(function(){});
  });
  each("[data-adrm]", function(b){
    var s = b.dataset.adrm;
    if (adBusy) return;
    var ask = s === "community" ? jcFmt("adm_ad_remove_confirm_community", { n: b.dataset.name })
                                : jcFmt("adm_ad_remove_confirm", { n: b.dataset.name, r: jcT("adm_ad_scope_" + s) });
    if (!window.confirm(ask)) return;
    write(b, function(){
      return rpc("jc_module_admin_revoke", { p_scope: s, p_user: b.dataset.user, p_link: null }).then(function(d){
        if (ad) ad[s] = adShape(d);
        if (s !== "community") return "removed";
        /* maybe they removed themselves (allowed while another community admin remains): re-read who this is */
        return rpc("jc_me_get").then(function(me){
          scopes = me.admin_scopes || []; adminEvents = me.admin_events || []; owner = !!me.is_owner;
          return has("community") ? "reload" : "self";
        }, function(){ return "removed"; });
      });
    }, function(what){
      if (current !== "admins") return;
      /* a community admin's removal also cancelled every link they made, at every level: re-read them all */
      if (what === "reload") { ad = null; return loadAdmins(function(){ showOk(jcT("adm_admins_removed")); }, adLinks); }
      if (what !== "self") return draw(jcT("adm_admins_removed"));
      ad = null; hh = null; hlog = null; health = null; fb = null; ct = null; ctEd = null; cd = null;   /* nothing of theirs stays cached (security L5) */
      if (!canEnter()) { events = []; show("lock"); return showOk(jcT("adm_ad_self_removed")); }
      return loadHome().then(function(){ showOk(jcT("adm_ad_self_removed")); });
    });
  });
  each("[data-adcancel]", function(b){
    var s = b.dataset.adcancel;
    write(b, function(){
      return rpc("jc_module_admin_revoke", { p_scope: s, p_user: null, p_link: b.dataset.link });
    }, function(d){ if (ad) ad[s] = adShape(d); draw(); });
  });
  on("adRetry", function(){ ad = null; adErr = null; VIEWS.admins(); });
}
function each(sel, fn){
  Array.prototype.forEach.call(document.querySelectorAll(sel), function(b){
    b.addEventListener("click", function(){ fn(b); });
  });
}

/* The invite's landing (R4b-1a): ask first, accept once (server-checked). The link names no level (anyone could
   edit that — security review M1): the question says so, and the answer names the level the server granted.
   A link that's used / expired / cancelled, or a role already held, ends the question — the invite is forgotten. */
function inviteView(){
  current = "invite";
  el("view").innerHTML =
    '<h1>' + esc(jcT("inv_title")) + '</h1>' +
    '<div class="panel"><p>' + esc(jcT("inv_body")) + '</p>' +
      '<ul class="acclist"><li>' + esc(jcT("inv_level")) + '</li>' +
        '<li>' + esc(jcT("inv_see")) + '</li><li>' + esc(jcT("inv_ends")) + '</li></ul>' +
      msgBox() +
      (INVITE.dead ? '' : '<button class="btn" type="button" id="invYes">' + esc(jcT("acc_yes")) + '</button>') +
      '<button class="btn ghost" type="button" id="invNo">' + esc(jcT(INVITE.dead ? "acct_back" : "acc_no")) + '</button></div>';
  on("invNo", function(){
    INVITE = null; inviteForget();
    if (canEnter()) loadHome(); else location.href = "../";
  });
  on("invYes", function(){
    var inv = INVITE;
    busy("invYes", true);
    if (el("invNo")) el("invNo").disabled = true;            /* no "No Thanks" while the answer is on its way (review L2) */
    rpc("jc_module_admin_accept", { p_token: inv.token }).then(function(res){
      INVITE = null; inviteForget();
      var role = jcOwn(INVITE_ROLES, res && res.scope) ? res.scope : null;
      var done = role ? jcFmt("inv_done", { r: jcT("adm_ad_scope_" + role) }) : jcT("inv_done_any");
      return rpc("jc_me_get").then(function(me){
        scopes = me.admin_scopes || []; adminEvents = me.admin_events || []; owner = !!me.is_owner;
        if (canEnter()) return loadHome().then(function(){ showOk(done); });
        /* a level with no screens here yet (pets): say it worked, and the way out (review L3) */
        current = "invited";
        el("view").innerHTML = '<h1>' + esc(jcT("inv_title")) + '</h1>' + msgBox() +
          '<p><a class="btn ghost" href="../">' + esc(jcT("acct_back")) + '</a></p>';
        showOk(done);
      }, function(){ location.replace(location.pathname); });   /* accepted; a fresh load reads the new role */
    }, function(e){
      busy("invYes", false);
      if (el("invNo")) el("invNo").disabled = false;
      if (e.code === "BAD_LINK" || e.code === "ALREADY_ADMIN") { inv.dead = e.code; inviteForget(); return inviteView(); }
      showErr(e.code);
    });
  });
  if (INVITE.dead) showErr(INVITE.dead);
}

/* The grant link's landing: say what the role is, ask, then accept (single use, server-checked). */
function acceptView(token){
  current = "accept";
  try { history.replaceState(null, "", location.pathname); } catch(e){}   /* single use: drop it from the URL */
  el("view").innerHTML =
    '<h1>' + esc(jcT("acc_title")) + '</h1>' +
    '<div class="panel"><p>' + esc(jcT("acc_body")) + '</p>' +
      '<ul class="acclist"><li>' + esc(jcT("acc_can")) + '</li><li>' + esc(jcT("acc_see")) + '</li><li>' + esc(jcT("acc_ends")) + '</li></ul>' +
      msgBox() +
      '<button class="btn" type="button" id="accYes">' + esc(jcT("acc_yes")) + '</button>' +
      '<button class="btn ghost" type="button" id="accNo">' + esc(jcT("acc_no")) + '</button></div>';
  on("accNo", function(){ GRANT = null; if (canEnter()) loadHome(); else location.href = "../"; });
  on("accYes", function(){
    busy("accYes", true);
    rpc("jc_event_admin_accept", { p_token: token }).then(function(r){
      GRANT = null;
      if (adminEvents.indexOf(r.event_id) < 0) adminEvents.push(r.event_id);
      OPEN_EVENT = null;
      return loadHome().then(function(){
        showOk(jcFmt("acc_done", { t: ar() && r.title_ar ? r.title_ar : r.title_en }));
      });
    }, function(err){ busy("accYes", false); accErr = err.code; showErr(err.code); });
  });
  if (accErr) showErr(accErr);
}

function openEditor(ev){
  closing = null;
  if (!ev) return show("templates");        /* a new event starts from a template (2c) */
  ed = { ev: ev, qs: fromSchema(ev.payload_schema), locked: ev.entries > 0, slugTouched: true,
         kind: ev.kind || "homes", look: ev.look || "plain",
         venue: ev.venue_lat != null ? { lat: ev.venue_lat, lng: ev.venue_lng } : null };
  show("editor");
}

/* ---------- kind + venue (T5.2 2c) ---------- */
function kindNow(){ var r = document.querySelector('input[name="kind"]:checked'); return r ? r.value : ed.kind; }
function syncKind(){
  var venue = kindNow() === "venue";
  el("venueBox").hidden = !venue;
  if (venue && !vmap) initVenueMap();       /* Leaflet needs a visible box to size itself */
  else if (venue) vmap.invalidateSize();    /* shown again: the box may have changed size meanwhile */
}
function drawVenueState(){
  var n = el("venueState");
  if (n) n.textContent = ed.venue ? jcT("ed_venue_set") : jcT("ed_venue_unset");
}
/* Same pin drop as a home: pan the map until the place is under the ring, then
   "The place is here". Nothing is taken from the map until that tap. */
function initVenueMap(){
  vmap = initPinMap(ed.venue ? [ed.venue.lat, ed.venue.lng] : null);
  if (!vmap) return;
  on("setVenue", function(){
    var p = vmap.getCenter();
    ed.venue = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
    drawVenueState();
  });
}

/* The markup initPinMap wires up: map + ring, Streets / Satellite, Find me, paste coordinates */
function pinMapHtml(){
  return '<div class="pinmap vpin"><div class="map" id="vmap"></div><div class="ring" aria-hidden="true"></div>' +
      '<div class="layers"><button type="button" class="lang" id="layerBtn">' + esc(jcT("pin_street")) + '</button></div>' +
      '<button type="button" class="lang locate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button></div>' +
    '<span class="row"><input type="text" id="coords" dir="ltr" inputmode="decimal" autocomplete="off" placeholder="24.5301, 54.4312" aria-label="' + esc(jcT("pin_paste")) + '">' +
      '<button type="button" class="btn ghost" id="coordsGo" style="flex:0 0 auto">' + esc(jcT("pin_paste_go")) + '</button></span>';
}
/* The pin-drop map in #vmap (venue pin, pin move): Streets / Satellite, Find me, paste
   coordinates. center = [lat, lng] or null for the community's own view. */
function initPinMap(center){
  if (typeof L === "undefined") return null;
  var c = (cfg && cfg.map) || {};
  var m = L.map("vmap", { zoomControl: true })
    .setView(center || [c.lat || 24.53, c.lng || 54.43], center ? 18 : Math.max(c.zoom || 15, 16));
  var layer = "sat";
  var tiles = L.tileLayer(jcTiles.sat.url, jcTiles.sat.opts).addTo(m);
  on("layerBtn", function(){
    layer = layer === "sat" ? "street" : "sat";
    m.removeLayer(tiles);
    tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(m);
    el("layerBtn").textContent = jcT(layer === "sat" ? "pin_street" : "pin_sat");
  });
  on("locateBtn", function(){
    if (!navigator.geolocation) return showErr("LOCATE_FAILED");
    navigator.geolocation.getCurrentPosition(function(pos){
      if (vmap === m) m.setView([pos.coords.latitude, pos.coords.longitude], 18);
    }, function(err){ showErr(err && err.code === 1 ? "LOCATE_DENIED" : "LOCATE_FAILED"); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
  on("coordsGo", function(){
    var p = jcParseLatLng(el("coords").value);
    if (!p) return showErr("BAD_COORDS");
    m.setView(p, 18);
  });
  /* the box may sit inside a form: Enter means "Go", never "save the event" (review) */
  el("coords").addEventListener("keydown", function(e){
    if (e.key === "Enter") { e.preventDefault(); el("coordsGo").click(); }
  });
  return m;
}
function centerOf(m){
  var p = m.getCenter();
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

/* ---------- sign-ups (T5.2 PR 4) ---------- */
function openSignups(e){
  closing = null; admining = null; adminsData = null;
  su = { ev: e, list: null, open: null, failed: null };
  show("signups");
  rpc("jc_admin_entries_list", { p_event: e.id }).then(function(list){
    if (!su || su.ev.id !== e.id) return;
    su.list = list || []; show("signups");
  }, function(err){
    if (err.code === "NOT_ADMIN" || !su || su.ev.id !== e.id) return fail(err);
    su.failed = err.code; show("signups");          /* not "Working…" forever: say why, offer Retry */
  });
}
function refreshList(id){
  return rpc("jc_admin_entries_list", { p_event: id }).then(function(list){
    if (su && su.ev.id === id) su.list = list || [];
  });
}
function leaveSignups(){ su = null; pm = null; show("home"); }

function fieldsOf(e){ return ((e && e.payload_schema) || {}).fields || {}; }
function answerText(spec, v){
  if (typeof v === "boolean") return jcT(v ? "ev_yes" : "ev_no");
  return (spec && (jcOwn(spec["labels_" + jcLang()], v) || jcOwn(spec.labels_en, v))) || String(v);
}
function questionText(k, spec){ return (spec && (spec["label_" + jcLang()] || spec.label_en)) || k; }
/* "Kids should come to…: Front gate" — every answer, short answers included (organizers only) */
function answersOf(x){
  var fields = fieldsOf(su.ev);
  return Object.keys(x.payload || {}).map(function(k){
    return questionText(k, fields[k]) + ": " + answerText(fields[k], x.payload[k]);
  });
}

/* R2b-1: event-night actions on one sign-up. Treat nights say "out of treats" (as the household's own switch). */
var TREAT_LOOKS = { halloween: true, haq_al_laila: true };
function treatK(e, k){ return TREAT_LOOKS[e.look] === true ? k + "_treats" : k; }
function evFeat(e, k){ return !!(e && e.features && e.features[k] === true); }
/* the switch + supply: from 2 h before the start (when the household gets its own) until the close —
   organizers may still correct the night after it ends (Zee, 2026-11-06) */
function nightOn(e){ return e.status === "live" && !!e.starts_at && Date.now() >= Date.parse(e.starts_at) - 2 * 3600e3; }
var SU_LEVELS = [3, 2, 1, 0];       /* Plenty · Some left · Running low · Almost out — the household's order */

function entryCard(x, ro){
  var e = su.ev, venue = e.kind === "venue";
  var flags = [];
  if (x.live_state === "done") flags.push(jcT(TREAT_LOOKS[e.look] === true ? "ev_out_treats" : "ev_pin_done"));
  else if (evFeat(e, "supply") && SU_LEVELS.indexOf(x.supply_level) >= 0) flags.push(jcFmt("ev_supply_line", { s: jcT("ev_supply_" + x.supply_level) }));
  if (x.org_adjusted_at) flags.push(jcT("adm_su_adjusted"));
  if (x.hidden) flags.push(jcT("adm_su_hidden"));
  if (x.spot) flags.push(jcFmt("adm_su_spot", { s: x.spot }));
  if (!venue) flags.push(jcT(x.event_lat != null ? "adm_su_event_pin" : x.home_lat != null ? "adm_su_home_pin" : "adm_su_no_pin"));
  if (x.reports_open) flags.push(jcFmt("adm_su_reports", { n: x.reports_open }));
  var open = su.open && su.open.id === x.id ? su.open.what : null;
  function b(a, label, cls){
    return '<button class="mini' + (cls ? ' ' + cls : '') + '" type="button" data-su="' + a + '" data-id="' + esc(x.id) + '">' + esc(label) + '</button>';
  }
  var night = !venue && nightOn(e), done = x.live_state === "done";
  var acts = ro ? '' : '<div class="acts">' +
    /* R2b-1: the household's switch and supply, set for them (a no-show, a mistake) */
    (night && evFeat(e, "giant_switch")
      ? (done ? b("open", jcT(treatK(e, "adm_su_mark_open"))) : b("done", jcT(treatK(e, "adm_su_mark_done")))) : '') +
    (night && evFeat(e, "supply") && !done ? b("supply", jcT("adm_su_supply")) : '') +
    b("note", jcT(x.org_note ? "adm_su_note_edit" : "adm_su_note")) +
    (x.hidden ? b("show", jcT("adm_su_restore")) : b("hide", jcT("adm_su_hide"), "danger")) +
    (venue ? '' : b("pin", jcT("adm_su_move_pin"))) +
    (venue && e.spots ? b("spot", jcT(x.spot ? "adm_su_spot_change" : "adm_su_spot_set")) : '') +
    b("withdraw", jcT("adm_su_withdraw"), "danger") + '</div>';
  var form = '';
  /* R2b-1: the four levels, the current one pressed, and Clear */
  if (open === "supply") form = '<div class="suform" data-supply-panel data-id="' + esc(x.id) + '">' +
    '<p class="help">' + esc(jcFmt("adm_su_supply_label", { h: jcHomeLabel(x) })) + '</p>' +
    '<div class="seg4" role="group" aria-label="' + esc(jcFmt("adm_su_supply_label", { h: jcHomeLabel(x) })) + '">' + SU_LEVELS.map(function(n){
      return '<button type="button" class="mini" data-level="' + n + '" aria-pressed="' + (x.supply_level === n) + '">' + esc(jcT("ev_supply_" + n)) + '</button>';
    }).join("") + '</div>' +
    '<div class="row">' + (SU_LEVELS.indexOf(x.supply_level) >= 0 ? '<button class="btn ghost small" type="button" data-supclear>' + esc(jcT("adm_su_supply_clear")) + '</button>' : '') +
    '<button class="btn ghost small" type="button" data-cancel>' + esc(jcT("ev_cancel")) + '</button></div></div>';
  if (open === "note") form = '<form class="suform" data-form="note" data-id="' + esc(x.id) + '" novalidate>' +
    '<label>' + esc(jcT("adm_su_note_label")) + '<textarea maxlength="280" dir="auto" data-in></textarea></label>' +
    '<p class="help">' + esc(jcT("adm_su_note_help")) + '</p>' +
    '<div class="row"><button class="btn small" type="submit">' + esc(jcT("ed_save")) + '</button>' +
    (x.org_note ? '<button class="btn ghost small" type="button" data-clear>' + esc(jcT("adm_su_note_clear")) + '</button>' : '') +
    '<button class="btn ghost small" type="button" data-cancel>' + esc(jcT("ev_cancel")) + '</button></div></form>';
  if (open === "spot") form = '<form class="suform" data-form="spot" data-id="' + esc(x.id) + '" novalidate>' +
    '<label>' + esc(jcT("adm_su_spot_label")) + '<input type="text" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" dir="ltr" data-in></label>' +
    '<div class="row"><button class="btn small" type="submit">' + esc(jcT("ed_save")) + '</button>' +
    (x.spot ? '<button class="btn ghost small" type="button" data-clear>' + esc(jcT("adm_su_spot_clear")) + '</button>' : '') +
    '<button class="btn ghost small" type="button" data-cancel>' + esc(jcT("ev_cancel")) + '</button></div></form>';
  /* everything residents typed is escaped */
  return '<li class="' + (x.hidden ? 'hidden' : '') + '" data-entry="' + esc(x.id) + '"><b>' + esc(jcHomeLabel(x)) + '</b>' +
    (flags.length ? '<div class="flags">' + flags.map(function(f){ return '<span>' + esc(f) + '</span>'; }).join("") + '</div>' : '') +
    answersOf(x).map(function(t){ return '<div class="meta" dir="auto">' + esc(t) + '</div>'; }).join("") +
    /* typed in either language: each line picks its own direction */
    (x.note ? '<div class="note" dir="auto">' + esc(x.note) + '</div>' : '') +
    (x.org_note ? '<div class="orgnote"><small>' + esc(jcT("adm_su_note_label")) + '</small><span dir="auto">' + esc(x.org_note) + '</span></div>' : '') +
    acts + form + '</li>';
}

function byEntry(id){ return ((su && su.list) || []).filter(function(x){ return x.id === id; })[0]; }
/* a write that returns the whole list (moderate / spot / event pin) → redraw, then say so.
   One at a time across every card (code review L6): a second tap while one is in flight is ignored
   (returns false = "not started", which keeps an Undo button usable). */
var suBusy = false;
function suWrite(name, args, okText, undo){
  if (suBusy) return false;
  suBusy = true;
  var id = su.ev.id, from = screenKey();
  return rpc(name, args).finally(function(){ suBusy = false; }).then(function(list){
    if (!su || su.ev.id !== id) return;
    su.list = list || [];
    if (screenKey() !== from) return;       /* a late answer: keep the data, don't pull them off another screen (review) */
    su.open = null; pm = null;
    show("signups");
    okUndo(okText, undo);
  }, suFail);
}
function screenKey(){ return current + (pm ? ":" + pm.x.id : ""); }
/* any failed write: buttons usable again (a re-render would drop what was typed), then say why */
function suFail(err){
  Array.prototype.forEach.call(document.querySelectorAll("#view button"), function(n){ n.disabled = false; });
  /* R2b-1 (db review L3): the sign-up changed meanwhile (a double tap, another organizer, the household) —
     re-read the list and say so, instead of a bare "not available" over a stale card */
  if (err && err.code === "NOT_FOUND" && su && current === "signups") {
    var id = su.ev.id;
    return refreshList(id).then(null, function(){}).then(function(){
      if (!su || su.ev.id !== id || current !== "signups") return;
      su.open = null; show("signups");
      var m = el("msg");
      if (m) { m.className = "msg err"; m.textContent = jcT("adm_su_err_NOT_FOUND"); }
    });
  }
  fail(err);
}
/* the ok message, with an Undo button when the change can be put back */
function okUndo(text, undo){
  showOk(text);
  if (!undo) return;
  var u = document.createElement("button");
  u.type = "button"; u.className = "mini"; u.id = "undo"; u.textContent = jcT("adm_undo");
  u.style.marginInlineStart = "10px";
  u.addEventListener("click", function(){ u.disabled = true; if (undo() === false) u.disabled = false; });   /* false = not started */
  el("msg").appendChild(u);
}

function wireEntries(){
  Array.prototype.forEach.call(document.querySelectorAll("[data-su]"), function(b){
    b.addEventListener("click", function(){
      var x = byEntry(b.dataset.id), a = b.dataset.su;
      if (!x) return;
      if (a === "note" || a === "spot" || a === "supply") {
        su.open = su.open && su.open.id === x.id && su.open.what === a ? null : { id: x.id, what: a };
        show("signups");
        var f = document.querySelector('[data-form] [data-in]');
        if (f) { f.value = f.defaultValue = (a === "note" ? x.org_note : x.spot) || ""; f.focus(); }
        return;
      }
      if (a === "pin") { pm = { x: x }; return show("pinmove"); }
      if (suBusy) return;                     /* another card's write is still in flight */
      var h = jcHomeLabel(x);
      /* R2b-1: no Undo for a removal — the confirm names the home; before the end the household can sign up again */
      if (a === "withdraw") {
        if (!window.confirm(jcFmt("adm_su_withdraw_confirm", { h: h }))) return;
        b.disabled = true;
        return suWrite("jc_admin_entry_withdraw", { p_entry: x.id }, jcFmt("adm_su_withdrawn_ok", { h: h }));
      }
      if (a === "done" || a === "open") {
        b.disabled = true;
        return suWrite("jc_admin_entry_live_set", { p_entry: x.id, p_state: a === "done" ? "done" : "active", p_supply: null, p_supply_clear: false },
          jcFmt(treatK(su.ev, a === "done" ? "adm_su_done_ok" : "adm_su_open_ok"), { h: h }));
      }
      b.disabled = true;
      var hide = a === "hide";
      suWrite("jc_admin_entry_moderate", { p_entry: x.id, p_hidden: hide, p_org_note: null },
        jcFmt(hide ? "adm_su_hidden_ok" : "adm_su_restored_ok", { h: jcHomeLabel(x) }),
        function(){ suWrite("jc_admin_entry_moderate", { p_entry: x.id, p_hidden: !hide, p_org_note: null }, jcT("adm_undone")); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-supply-panel]"), function(p){
    var x = byEntry(p.dataset.id);
    if (!x) return;
    var h = jcHomeLabel(x);
    function send(level){
      if (suBusy) return;
      Array.prototype.forEach.call(p.querySelectorAll("button"), function(n){ n.disabled = true; });
      suWrite("jc_admin_entry_live_set", { p_entry: x.id, p_state: null, p_supply: level, p_supply_clear: level === null },
        level === null ? jcFmt("adm_su_supply_cleared", { h: h }) : jcFmt("adm_su_supply_ok", { h: h, s: jcT("ev_supply_" + level) }));
    }
    Array.prototype.forEach.call(p.querySelectorAll("[data-level]"), function(n){
      n.addEventListener("click", function(){
        if (n.getAttribute("aria-pressed") === "true") return;   /* already that level: Clear Supply removes it */
        send(Number(n.dataset.level));
      });
    });
    var clr = p.querySelector("[data-supclear]");
    if (clr) clr.addEventListener("click", function(){ send(null); });
    p.querySelector("[data-cancel]").addEventListener("click", function(){ su.open = null; show("signups"); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-form]"), function(f){
    var x = byEntry(f.dataset.id), what = f.dataset.form, inp = f.querySelector("[data-in]");
    function send(v){
      if (suBusy) return;
      Array.prototype.forEach.call(f.querySelectorAll("button"), function(n){ n.disabled = true; });
      what === "note"
        ? suWrite("jc_admin_entry_moderate", { p_entry: x.id, p_hidden: null, p_org_note: v },
                  jcFmt(v ? "adm_su_note_ok" : "adm_su_note_cleared", { h: jcHomeLabel(x) }))
        : suWrite("jc_admin_entry_spot_set", { p_entry: x.id, p_spot: v },
                  v ? jcFmt("adm_su_spot_ok", { h: jcHomeLabel(x), s: v.toUpperCase() }) : jcFmt("adm_su_spot_cleared", { h: jcHomeLabel(x) }));
    }
    f.addEventListener("submit", function(e2){
      e2.preventDefault();
      var v = inp.value.trim();
      if (what === "spot" && v && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,11}$/.test(v)) return showErr("BAD_SPOT");
      if (what === "note" && v.length > 280) return showErr("BAD_NOTE");
      send(v);
    });
    var clr = f.querySelector("[data-clear]");
    if (clr) clr.addEventListener("click", function(){ send(""); });
    f.querySelector("[data-cancel]").addEventListener("click", function(){ su.open = null; show("signups"); });
  });
}

/* Pin move (plan Q2): "home" = the home's own pin, everywhere (jc_admin_home_pin_set);
   "event" = this event only (jc_admin_entry_pin_set); "reset" = drop the event-only pin.
   The confirm names the home (premortem #1); Undo puts the old spot back. */
function movePin(how){
  var x = pm.x, h = jcHomeLabel(x);
  if (how !== "reset" && !vmap) return showErr("BAD_PIN");      /* no map (Leaflet didn't load) = no new spot */
  var p = how === "reset" ? null : centerOf(vmap);
  if (!window.confirm(jcFmt("adm_pm_confirm_" + how, { h: h }))) return;
  ["pmHome", "pmEvent", "pmReset"].forEach(function(id){ if (el(id)) el(id).disabled = true; });
  if (how === "home") {
    var id = su.ev.id;
    return rpc("jc_admin_home_pin_set", { p_home: x.home_id, p_lat: p.lat, p_lng: p.lng }).then(function(r){
      var from = r && r.from;
      var undo = from ? function(){
        rpc("jc_admin_home_pin_set", { p_home: x.home_id, p_lat: from[0], p_lng: from[1] }).then(function(){
          return refreshList(id).then(null, function(){});        /* put back either way; the list may lag */
        }).then(function(){
          if (!su || su.ev.id !== id) return;
          show("signups"); showOk(jcT("adm_undone"));
        }, suFail);
      } : null;
      var text = jcFmt(x.event_lat != null ? "adm_pm_home_ok_shadowed" : "adm_pm_home_ok", { h: h });
      /* the pin DID move: say so even if the list refresh fails (review) */
      return refreshList(id).then(null, function(){}).then(function(){
        if (!su || su.ev.id !== id) return;
        pm = null; show("signups"); okUndo(text, undo);
      });
    }, suFail);
  }
  var was = x.event_lat != null ? { lat: x.event_lat, lng: x.event_lng } : null;
  suWrite("jc_admin_entry_pin_set", { p_entry: x.id, p_lat: p ? p.lat : null, p_lng: p ? p.lng : null },
    jcFmt(how === "reset" ? "adm_pm_reset_ok" : "adm_pm_event_ok", { h: h }),
    function(){
      suWrite("jc_admin_entry_pin_set", { p_entry: x.id, p_lat: was ? was.lat : null, p_lng: was ? was.lng : null }, jcT("adm_undone"));
    });
}

/* CSV, built on this phone from what the screen already has (plan Q1) — nothing stored.
   Cells a spreadsheet would read as a formula get a leading ' (resident-typed text). */
function csvCell(v){
  var s = v == null ? "" : String(v);
  /* numbers come from the server (a negative longitude stays a number); text — including
     text that starts with whitespace — is defused (security review PR 4) */
  if (typeof v !== "number" && /^[\s=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCsv(){
  var e = su.ev, fields = fieldsOf(e), keys = Object.keys(fields);
  var head = [jcT("csv_village"), jcT("csv_home"), jcT("csv_status"), jcT("csv_hidden")]
    .concat(e.spots ? [jcT("csv_spot")] : [])
    .concat(e.kind === "venue" ? [] : [jcT("csv_pin"), jcT("csv_lat"), jcT("csv_lng")])
    .concat(keys.map(function(k){ return questionText(k, fields[k]); }))
    .concat([jcT("csv_note"), jcT("csv_org_note"), jcT("csv_reports"), jcT("csv_signed_up"), jcT("csv_updated"),
             jcT("csv_org_adjusted"), jcT("csv_org_withdrawn")]);                                     /* R2b-1 */
  var rows = su.list.map(function(x){
    var evPin = x.event_lat != null;
    return [jcVillageName(cfg, x.village), jcHomeLabel(x), jcT("csv_st_" + x.status) === "csv_st_" + x.status ? x.status : jcT("csv_st_" + x.status),
            x.hidden ? jcT("ev_yes") : ""]
      .concat(e.spots ? [x.spot || ""] : [])
      .concat(e.kind === "venue" ? [] : [jcT(evPin ? "csv_pin_event" : x.home_lat != null ? "csv_pin_home" : "csv_pin_none"),
        evPin ? x.event_lat : x.home_lat, evPin ? x.event_lng : x.home_lng])
      .concat(keys.map(function(k){ var p = x.payload || {}; return k in p ? answerText(fields[k], p[k]) : ""; }))
      .concat([x.note || "", x.org_note || "", x.reports_open || 0, x.created_at || "", x.updated_at || "",
               x.org_adjusted_at || "", x.org_withdrawn_at || ""]);
  });
  /* BOM: Excel reads the file as UTF-8 (Arabic village names, notes) */
  var text = "﻿" + [head].concat(rows).map(function(r){ return r.map(csvCell).join(","); }).join("\r\n");
  var url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  var a = document.createElement("a");
  a.href = url; a.download = e.slug + "-signups.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
}

/* ---------- the banner (T5.2 PR 4) ---------- */
/* R2a (U3): an organizer can tie the banner to a live event — closing that event takes it down */
function tieEvents(){ return events.filter(function(e){ return e.status === "live"; }); }
function bannerTieHtml(){
  if (!isOrganizer() || !tieEvents().length) return '';
  return '<label class="tie">' + esc(jcT("adm_banner_tie")) + '<select id="bannerEvent">' +
    '<option value="">' + esc(jcT("adm_banner_tie_none")) + '</option>' +
    tieEvents().map(function(e){
      return '<option value="' + esc(e.id) + '">' + esc(ar() && e.title_ar ? e.title_ar : e.title_en) + '</option>';
    }).join("") + '</select></label>';
}
function wireBanner(){
  var f = el("bannerForm");
  if (!f) return;
  var t = el("bannerText");
  t.value = t.defaultValue = (cfg && cfg.broadcast) || "";
  if (bannerDraft !== null) { t.value = bannerDraft; bannerDraft = null; }   /* typed before a tab switch */
  function post(text){
    if (text && !window.confirm(jcT("adm_banner_confirm"))) return;
    busy(text ? "bannerSave" : "bannerClear", true);
    var tie = text && el("bannerEvent") ? el("bannerEvent").value : "";
    (tie ? rpc("jc_admin_broadcast_set_event", { p_text: text, p_event: tie })
         : rpc("jc_admin_broadcast_set", { p_text: text })).then(function(r){
      cfg = Object.assign({}, cfg || {}, { broadcast: (r && r.broadcast) || "" });
      paint(); show("home");
      showOk(jcT(!cfg.broadcast ? "adm_banner_cleared" : tie ? "adm_banner_posted_tied" : "adm_banner_posted"));
    }, function(err){ busy(text ? "bannerSave" : "bannerClear", false); fail(err); });
  }
  f.addEventListener("submit", function(e){
    e.preventDefault();
    var v = t.value.trim();
    if (!v) return showErr("BANNER_EMPTY");
    if (v.length > 280) return showErr("TOO_LONG");
    post(v);
  });
  on("bannerClear", function(){ post(""); });
}

/* ---------- questions: schema <-> editable list ---------- */
function newChoice(){ return { value: null, en: "", ar: "", glyph: "", allergy: false, split: false }; }
function fromSchema(schema){
  var fields = (schema && schema.fields) || {};
  return Object.keys(fields).map(function(k){
    var f = fields[k] || {};
    var len = f.labels_en || {}, lar = f.labels_ar || {}, gl = f.glyphs || {};
    return {
      key: k, label_en: f.label_en || "", label_ar: f.label_ar || "",
      type: f.type === "bool" || f.type === "text" ? f.type : "enum",
      required: !!f.required, pin: f.pin === "ring" || f.pin === "glyph" ? f.pin : "", max: f.max,
      choices: (f.values || []).map(function(v){ return { value: v, en: jcOwn(len, v) || "", ar: jcOwn(lar, v) || "", glyph: jcOwn(gl, v) || "",
        allergy: Array.isArray(f.allergy_friendly) && f.allergy_friendly.indexOf(v) >= 0,
        split: Array.isArray(f.ring_split) && f.ring_split.indexOf(v) >= 0 }; })
    };
  });
}
/* "Kids should come to…" → "kids_should_come_to"; server rule: ^[a-z][a-z0-9_]{0,30}$, never "note" */
function keyFrom(text, taken, fallback, max){
  var k = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, max).replace(/_+$/, "");
  if (!k || k === "note") k = fallback;
  var base = k, n = 2;
  while (taken.indexOf(k) >= 0) { k = base.slice(0, max - 3) + "_" + n; n++; }
  return k;
}
/* The list as the server stores it. Keys are kept once given (answers point at them);
   new questions / choices get one from their English wording. Returns {schema} or {err}. */
function toSchema(qs){
  if (qs.length > 12) return { err: "Q_TOO_MANY" };
  var fields = {}, keys = qs.map(function(q){ return q.key; }).filter(Boolean);
  for (var i = 0; i < qs.length; i++) {
    var q = qs[i], en = q.label_en.trim();
    if (!en) return { err: "Q_LABEL" };
    if (!q.key) { q.key = keyFrom(en, keys, "q" + (i + 1), 31); keys.push(q.key); }
    var f = { type: q.type };
    if (q.required) f.required = true;
    f.label_en = en;
    if (q.label_ar.trim()) f.label_ar = q.label_ar.trim();
    if (q.type === "text" && q.max) f.max = q.max;
    if (q.type === "enum") {
      /* blank rows are ignored; a row with anything typed must have English wording */
      var cs = q.choices.filter(function(c){ return c.value || (c.en + c.ar + c.glyph).trim(); });
      if (cs.length < 2) return { err: "Q_CHOICES" };
      if (cs.length > 20) return { err: "Q_CHOICES_MAX" };
      var vals = cs.map(function(c){ return c.value; }).filter(Boolean);
      var len = {}, lar = {}, gl = {}, af = [], rs = [], anyAr = false, anyGl = false;
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        if (!c.en.trim()) return { err: "Q_CHOICE_LABEL" };
        if (!c.value) { c.value = keyFrom(c.en, vals, "choice_" + (j + 1), 40); vals.push(c.value); }
        len[c.value] = c.en.trim();
        if (c.ar.trim()) { lar[c.value] = c.ar.trim(); anyAr = true; }
        if (q.pin === "glyph" && c.glyph.trim()) { gl[c.value] = c.glyph.trim(); anyGl = true; }
        if (q.pin === "glyph" && c.allergy) af.push(c.value);   /* PR 5a: its icon shows teal on the map */
        if (q.pin === "ring" && c.split) rs.push(c.value);      /* 5a.1: "both" = a split ring */
      }
      f.values = cs.map(function(c){ return c.value; });
      f.labels_en = len;
      if (anyAr) f.labels_ar = lar;
      if (q.pin) f.pin = q.pin;
      if (anyGl) f.glyphs = gl;
      if (af.length) f.allergy_friendly = af;
      if (rs.length) f.ring_split = rs;
    }
    fields[q.key] = f;
  }
  var schema = { fields: fields };
  /* the server caps the stored questions at 8 KB of Postgres's jsonb text, which writes
     ": " and ", " — count those spaces too, or a wordy set passes here and fails there */
  if (pgJsonBytes(schema) > 8192) return { err: "Q_TOO_BIG" };
  return { schema: schema };
}

function pgJsonBytes(v){
  var t = JSON.stringify(v).replace(/"(?:[^"\\]|\\.)*"|([:,])/g, function(m, sep){ return sep ? sep + " " : m; });
  return new TextEncoder().encode(t).length;
}

function drawQuestions(){ return ed.locked ? drawPreview() : drawBuilder(); }

/* Editable cards. Typing updates ed.qs in place (no re-render, so focus stays); adding,
   removing, moving or changing a type re-renders from ed.qs. */
function drawBuilder(){
  var host = el("qs");
  if (!ed.qs.length) { host.innerHTML = '<p class="help">' + esc(jcT("ed_q_none")) + '</p>'; return; }
  host.innerHTML = ed.qs.map(function(q, i){
    var types = ["enum", "bool", "text"].map(function(t){
      return '<option value="' + t + '"' + (q.type === t ? ' selected' : '') + '>' + esc(jcT("ed_q_t_" + t)) + '</option>';
    }).join("");
    var pins = ["", "ring", "glyph"].map(function(p){
      return '<option value="' + p + '"' + (q.pin === p ? ' selected' : '') + '>' + esc(jcT("ed_q_pin_" + (p || "none"))) + '</option>';
    }).join("");
    return '<div class="qcard" data-q="' + i + '">' +
      '<div class="qhead"><b>' + esc(jcFmt("ed_q_n", { n: i + 1 })) + '</b><span>' +
        (i > 0 ? '<button type="button" class="mini" data-qact="up" aria-label="' + esc(jcT("ed_q_up")) + '">↑</button>' : '') +
        (i < ed.qs.length - 1 ? '<button type="button" class="mini" data-qact="down" aria-label="' + esc(jcT("ed_q_down")) + '">↓</button>' : '') +
        '<button type="button" class="mini danger" data-qact="del">' + esc(jcT("ed_q_remove")) + '</button></span></div>' +
      '<label>' + esc(jcT("ed_q_label_en")) + '<input type="text" maxlength="200" data-q-label="en" dir="ltr"></label>' +
      '<label>' + esc(jcT("ed_q_label_ar")) + '<input type="text" maxlength="200" dir="rtl" data-q-label="ar"></label>' +
      '<div class="qrow"><label>' + esc(jcT("ed_q_type")) + '<select data-q-type>' + types + '</select></label>' +
        '<label class="check"><input type="checkbox" data-q-req' + (q.required ? ' checked' : '') + '> <span>' + esc(jcT("ed_q_req")) + '</span></label></div>' +
      (q.type === "enum"
        ? '<label>' + esc(jcT("ed_q_pin")) + '<select data-q-pin>' + pins + '</select></label>' +
          '<div class="choices"><span class="clabel">' + esc(jcT("ed_q_choices")) + '</span>' + q.choices.map(function(c, j){
            return '<div class="choice" data-c="' + j + '">' +
              (q.pin === "glyph" ? '<input type="text" class="glyph" maxlength="8" data-c-f="glyph" aria-label="' + esc(jcT("ed_q_glyph_in")) + '">' : '') +
              '<input type="text" maxlength="40" data-c-f="en" dir="ltr" placeholder="' + esc(jcT("ed_q_choice_en")) + '" aria-label="' + esc(jcT("ed_q_choice_en")) + '">' +
              '<input type="text" maxlength="40" dir="rtl" data-c-f="ar" placeholder="' + esc(jcT("ed_q_choice_ar")) + '" aria-label="' + esc(jcT("ed_q_choice_ar")) + '">' +
              (q.pin === "glyph" ? '<label class="check allergy" title="' + esc(jcT("ed_q_allergy")) + '"><input type="checkbox" data-c-allergy' +
                (c.allergy ? ' checked' : '') + ' aria-label="' + esc(jcT("ed_q_allergy")) + '"><span class="tealdot" aria-hidden="true"></span></label>' : '') +
              (q.pin === "ring" ? '<label class="check allergy" title="' + esc(jcT("ed_q_split")) + '"><input type="checkbox" data-c-split' +
                (c.split ? ' checked' : '') + ' aria-label="' + esc(jcT("ed_q_split")) + '"><span class="splitdot" aria-hidden="true"></span></label>' : '') +
              '<button type="button" class="mini" data-cact="del" aria-label="' + esc(jcT("ed_q_remove_choice")) + '">✕</button></div>';
          }).join("") +
          (q.pin === "glyph" ? '<p class="help">' + esc(jcT("ed_q_allergy_help")) + '</p>' : '') +
          (q.pin === "ring" ? '<p class="help">' + esc(jcT("ed_q_split_help")) + '</p>' : '') +
          '<button type="button" class="btn ghost small" data-qact="addc">' + esc(jcT("ed_q_add_choice")) + '</button></div>'
        : '') +
    '</div>';
  }).join("");
  /* values via .value / defaultValue — never through HTML */
  Array.prototype.forEach.call(host.querySelectorAll(".qcard"), function(card){
    var q = ed.qs[+card.dataset.q];
    var lab = card.querySelectorAll("[data-q-label]");
    lab[0].value = lab[0].defaultValue = q.label_en;
    lab[1].value = lab[1].defaultValue = q.label_ar;
    lab[0].addEventListener("input", function(){ q.label_en = lab[0].value; });
    lab[1].addEventListener("input", function(){ q.label_ar = lab[1].value; });
    card.querySelector("[data-q-req]").addEventListener("change", function(e){ q.required = e.target.checked; });
    card.querySelector("[data-q-type]").addEventListener("change", function(e){
      q.type = e.target.value;
      if (q.type !== "enum") q.pin = "";
      if (q.type === "enum" && q.choices.length < 2) while (q.choices.length < 2) q.choices.push(newChoice());
      drawBuilder();
    });
    var pin = card.querySelector("[data-q-pin]");
    if (pin) pin.addEventListener("change", function(){
      /* one question drives the ring, one the icon */
      var moved = false;
      if (pin.value) ed.qs.forEach(function(o){ if (o !== q && o.pin === pin.value) { o.pin = ""; moved = true; } });
      q.pin = pin.value;
      drawBuilder();
      if (moved) showOk(jcFmt("ed_q_pin_moved", { s: jcT("ed_q_pin_" + q.pin), n: ed.qs.indexOf(q) + 1 }));
    });
    Array.prototype.forEach.call(card.querySelectorAll(".choice"), function(row){
      var c = q.choices[+row.dataset.c];
      Array.prototype.forEach.call(row.querySelectorAll("[data-c-f]"), function(inp){
        inp.value = inp.defaultValue = c[inp.dataset.cF] || "";
        inp.addEventListener("input", function(){ c[inp.dataset.cF] = inp.value; });
      });
      var al = row.querySelector("[data-c-allergy]");
      if (al) al.addEventListener("change", function(){ c.allergy = al.checked; });
      var sp = row.querySelector("[data-c-split]");
      if (sp) sp.addEventListener("change", function(){ c.split = sp.checked; });
      row.querySelector('[data-cact="del"]').addEventListener("click", function(){
        q.choices.splice(+row.dataset.c, 1); drawBuilder();
      });
    });
    Array.prototype.forEach.call(card.querySelectorAll("[data-qact]"), function(b){
      b.addEventListener("click", function(){
        var i = +card.dataset.q, a = b.dataset.qact;
        if (a === "del") ed.qs.splice(i, 1);
        if (a === "up") ed.qs.splice(i - 1, 0, ed.qs.splice(i, 1)[0]);
        if (a === "down") ed.qs.splice(i + 1, 0, ed.qs.splice(i, 1)[0]);
        if (a === "addc") {
          if (q.choices.length >= 20) return showErr("Q_CHOICES_MAX");
          q.choices.push(newChoice());
        }
        drawBuilder();
      });
    });
  });
}

/* read-only: the questions as residents will see them (labels from the schema) */
function drawPreview(){
  var fields = ((ed.ev && ed.ev.payload_schema) || {}).fields || {};
  var keys = Object.keys(fields);
  el("qs").innerHTML = keys.length ? '<ol class="qlist">' + keys.map(function(k){
    var f = fields[k] || {};
    var lab = (ar() && f.label_ar) || f.label_en || k;
    var vals = f.type === "bool" ? [jcT("ev_yes"), jcT("ev_no")]
      : (f.values || []).map(function(v){
          var g = jcOwn(f.glyphs, v);
          return (g ? g + " " : "") + ((ar() && jcOwn(f.labels_ar, v)) || jcOwn(f.labels_en, v) || v);
        });
    var notes = [];
    if (f.required) notes.push(jcT("ed_q_required"));
    if (f.pin === "ring") notes.push(jcT("ed_q_ring"));
    if (f.pin === "glyph") notes.push(jcT("ed_q_glyph"));
    if (f.pin === "glyph" && Array.isArray(f.allergy_friendly) && f.allergy_friendly.length) notes.push(jcT("ed_q_allergy_note"));
    return '<li><b>' + esc(lab) + '</b>' + (notes.length ? ' <small>(' + esc(notes.join(" · ")) + ')</small>' : '') +
      (vals.length ? '<div class="qvals">' + vals.map(function(v){ return '<span>' + esc(v) + '</span>'; }).join("") + '</div>' : '') + '</li>';
  }).join("") + '</ol>' : '<p class="help">' + esc(jcT("ed_q_none")) + '</p>';
}

/* What publishing (or opening sign-ups) still needs — the server's rule, said up front (Zee,
   2026-11-05: it saved, and only Publish said something was missing). Draft saves stay allowed. */
function missingForPublish(){
  var miss = [];
  if (kindNow() === "venue") {
    if (!el("venue_name_en").value.trim()) miss.push({ id: "venue_name_en", label: jcT("ed_venue_name_en") });
    if (!ed.venue) miss.push({ id: "venuePinHelp", label: jcT("ed_venue_pin_label") });
  }
  return miss;
}
function markMissing(miss){
  Array.prototype.forEach.call(document.querySelectorAll("#form .missing"), function(n){ n.classList.remove("missing"); n.removeAttribute("aria-invalid"); });
  miss.forEach(function(m){ var n = el(m.id); if (n) { n.classList.add("missing"); n.setAttribute("aria-invalid", "true"); } });
}

/* R2b-2: the safety box as the server stores it: { v: {phone, meeting_en, meeting_ar} (blank = undefined) } or
   { err, at }. Arabic-Indic numerals become 0-9 and whitespace runs one space; the phone rule is the server's. */
function safetyFields(){
  function one(id){ var t = el(id).value.replace(/\s+/g, " ").trim(); return t === "" ? undefined : t; }
  /* a pasted number often carries invisible direction marks, dashes, brackets or dots: marks go, the
     separators become spaces (code review L1) — the server's rule itself is unchanged */
  var phone = one("safety_phone");
  if (phone) phone = phone.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/[-().]/g, " ")
                          .replace(/\s+/g, " ").trim() || undefined;
  if (phone) phone = phone.replace(/[\u0660-\u0669]/g, function(d){ return String(d.charCodeAt(0) - 0x660); })
                          .replace(/[\u06F0-\u06F9]/g, function(d){ return String(d.charCodeAt(0) - 0x6F0); });
  var v = { phone: phone, meeting_en: one("safety_meeting_en"), meeting_ar: one("safety_meeting_ar") };
  if (phone && typeof jcSafetyPhoneOk === "function" && !jcSafetyPhoneOk(phone)) return { err: "BAD_PHONE", at: "safety_phone" };
  if (el("f_safety").checked && !v.phone && !v.meeting_en && !v.meeting_ar) return { err: "SAFETY_EMPTY", at: "safety_phone" };
  return { v: v };
}

/* Only what changed goes to the server (premortem #1); a new event sends what's filled. */
function saveEvent(){
  var ev = ed.ev, orig = ev || {};
  var draft = !ev || ev.status === "draft";
  var f = {};
  var title_en = el("title_en").value.trim();
  markMissing(title_en ? [] : [{ id: "title_en" }]);
  if (!title_en) { el("title_en").focus(); return showErr("TITLE_REQUIRED"); }
  var miss = missingForPublish();
  var missText = miss.map(function(m){ return m.label; }).join(", ");
  markMissing(miss);
  if (miss.length) {
    if (draft || orig.coming_soon) {
      /* a draft (or a coming-soon event, T5.4) may be saved half-done — but never silently */
      if (!window.confirm(jcFmt(orig.coming_soon ? "ed_missing_confirm_soon" : "ed_missing_confirm", { list: missText }))) { el(miss[0].id).scrollIntoView({ block: "center" }); return showErr("MISSING_FOR_PUBLISH"); }
    } else {
      el(miss[0].id).scrollIntoView({ block: "center" });
      return showErr("NO_VENUE");                     /* a live event can't lose its place (server says so too) */
    }
  }
  /* R2a (F2): an open homes event keeps its date (drafts may save without one; Publish asks) */
  if (!draft && !orig.coming_soon && kindNow() !== "venue" && !el("starts_at").value) {
    markMissing([{ id: "starts_at" }]); el("starts_at").scrollIntoView({ block: "center" });
    return showErr("NO_DATE");
  }
  var slug = el("slug").value.trim();
  if (draft && !/^[a-z][a-z0-9-]{1,40}$/.test(slug)) return showErr("BAD_SLUG");
  function text(k){ var v = el(k).value.trim(); return v === "" ? null : v; }
  function put(k, v){
    var was = orig[k] === undefined || orig[k] === "" ? null : orig[k];
    if (!ev ? v !== null : JSON.stringify(v) !== JSON.stringify(was)) f[k] = v;
  }
  put("title_en", title_en);
  put("title_ar", text("title_ar"));
  if (draft) put("slug", slug);
  put("description_en", text("description_en"));
  put("description_ar", text("description_ar"));
  ["starts_at", "ends_at"].forEach(function(k){
    var v = fromLocalInput(el(k).value);
    var was = orig[k] ? new Date(orig[k]).toISOString() : null;
    if (!ev ? v !== null : v !== was) f[k] = v;
  });
  var s = fromLocalInput(el("starts_at").value), en = fromLocalInput(el("ends_at").value);
  /* <=, not <: picking a start moves an empty / earlier end onto it (followStart), so an untouched end equals the start (review M2) */
  if (s && en && new Date(en) <= new Date(s)) return showErr("BAD_DATES");
  /* features: the three switches, keeping any other flag an event already carries */
  var feats = Object.assign({}, orig.features || {});
  FEATURES.forEach(function(k){ if (el("f_" + k).checked) feats[k] = true; else delete feats[k]; });
  /* R2b-2: the safety box — its switch rides in features, its text in safety (the server checks + tidies both) */
  if (el("f_safety").checked) feats.safety = true; else delete feats.safety;
  if (JSON.stringify(feats) !== JSON.stringify(orig.features || {})) f.features = feats;
  var sf = safetyFields();
  if (sf.err) { el(sf.at).scrollIntoView({ block: "center" }); el(sf.at).focus(); return showErr(sf.err); }
  var sfWas = orig.safety || {};
  if (JSON.stringify(sf.v) !== JSON.stringify({ phone: sfWas.phone, meeting_en: sfWas.meeting_en, meeting_ar: sfWas.meeting_ar })) {
    f.safety = JSON.parse(JSON.stringify(sf.v));      /* blank (undefined) keys drop out */
  }
  /* T5.2 2c: kind + look; venue settings only for a one-place event (the server refuses
     them on a homes event, and switching to homes clears them there) */
  var kind = kindNow(), look = el("look").value;
  if (ev) {
    if (kind !== (orig.kind || "homes")) f.kind = kind;
    if (look !== (orig.look || "plain")) f.look = look;
  }
  else { if (kind !== "homes") f.kind = kind; if (look !== "plain") f.look = look; }   /* defaults aren't sent */
  if (kind === "venue") {
    put("venue_name_en", text("venue_name_en"));
    put("venue_name_ar", text("venue_name_ar"));
    put("venue_lat", ed.venue ? ed.venue.lat : null);
    put("venue_lng", ed.venue ? ed.venue.lng : null);
    if (el("capacity").validity.badInput) return showErr("BAD_CAPACITY");   /* "abc" reads as "" — not "no limit" */
    var capRaw = el("capacity").value.trim(), cap = null;
    if (capRaw) {
      cap = Number(capRaw);
      if (!(Number.isInteger(cap) && cap >= 1 && cap <= 5000)) return showErr("BAD_CAPACITY");
    }
    put("capacity", cap);
    var spots = el("spots").checked;
    if (ev ? spots !== !!orig.spots : spots) f.spots = spots;
  }
  /* compare in one canonical shape, so reopening and saving an untouched event sends nothing */
  if (!ed.locked) {
    var built = toSchema(ed.qs);
    if (built.err) return showErr(built.err);
    var was = toSchema(fromSchema(orig.payload_schema)).schema || { fields: {} };
    if (JSON.stringify(built.schema) !== JSON.stringify(was)) f.payload_schema = built.schema;
  }
  if (ev && !Object.keys(f).length) return showOk(jcT("adm_nothing"));
  /* R2a (D-M4): an open event whose dates change to "start, no end" */
  if (!draft && !orig.coming_soon && ("starts_at" in f || "ends_at" in f) && s && !en
      && !window.confirm(jcT("adm_no_end_warn"))) return;
  busy("save", true);
  rpc("jc_admin_event_save", { p_event: ev ? ev.id : null, p_fields: f }).then(function(list){
    events = list; ed = null; show("home");
    showOk(miss.length ? jcFmt(orig.coming_soon ? "adm_saved_soon_missing" : "adm_saved_draft_missing", { list: missText }) : jcT("adm_saved"));
  }, function(err){ busy("save", false); fail(err); });
}

function fbButton(){
  var b = el("fbOpen");
  if (!b || !fb) return;
  b.textContent = jcFmt("adm_fb_open", { n: fb.unread });
  b.classList.toggle("ghost", !fb.unread);
}
function loadHome(){
  /* the count arrives after the page: update the button only — a redraw would wipe drafts (review) */
  if (owner) rpc("jc_feedback_list").then(function(d){ fb = d; fbButton(); }, function(){});
  return rpc("jc_admin_events_list").then(function(list){
    events = list;
    var ev = OPEN_EVENT && events.filter(function(x){ return x.id === OPEN_EVENT; })[0];
    OPEN_EVENT = null;                      /* once: Cancel / Save return to the list */
    if (ev) openEditor(ev); else show("home");
  },
    function(e){
      /* owner without an organizer code; a courts-only admin (R4b-1a) — no events list for either */
      if (e.code === "NOT_ADMIN" && (owner || has("bookings"))) { events = []; return show("home"); }
      if (e.code === "NOT_ADMIN") { scopes = []; adminEvents = []; show("lock"); showErr(e.code); } else { show("lock"); showErr(e.code); } });
}

/* ---------- boot ---------- */
function paint(){
  var name = jcCommunityName(cfg, state && state.me && state.me.community);
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcT("adm_title") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "admin", cfg);
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(ar() ? "en" : "ar");
  paint();
  if (current === "editor") return drawQuestions();   /* never throw away the form */
  if (current === "accept") return acceptView(GRANT);   /* same link, other language */
  if (current === "invite") return inviteView();
  if (current === "court" && ctEd) { ctEd.draft = courtForm(); return show("court"); }   /* never throw away the form */
  if (current === "courtday" && cd) { cd.draft = cdDraft(); return show("courtday"); }   /* same day, same open form */
  if (current === "admins" && ad) return VIEWS.admins();   /* keeps a just-made invite link on screen */
  /* keep what's half-done: the banner draft, an open note / spot, where the pin map was moved */
  var keep = Array.prototype.map.call(document.querySelectorAll("#bannerText, [data-form] [data-in]"), function(n){ return n.value; });
  var view = vmap ? { c: vmap.getCenter(), z: vmap.getZoom() } : null;
  if (current) show(current);
  Array.prototype.forEach.call(document.querySelectorAll("#bannerText, [data-form] [data-in]"), function(n, i){
    if (keep[i] != null) n.value = keep[i];
  });
  if (view && vmap) vmap.setView(view.c, view.z);
});

jcSetLang(jcLang());
paint();
jcHit("admin");
jcState().then(function(s){
  state = s;
  /* a grant link survives sign-in / joining: it comes back here (jcSafeNext allows it) */
  var back = GRANT ? "../admin/?eventadmin=" + GRANT : "../admin/";
  if (s.status === "signed_out") { location.replace("../account/?next=" + encodeURIComponent(back)); return; }
  if (s.status === "not_member") { location.replace("../account/?view=join&next=" + encodeURIComponent(back)); return; }
  scopes = s.me.admin_scopes || [];
  adminEvents = s.me.admin_events || [];
  owner = !!s.me.is_owner;
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (GRANT) return acceptView(GRANT);
    if (INVITE) return inviteView();
    if (canEnter()) return loadHome();
    show("lock");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
