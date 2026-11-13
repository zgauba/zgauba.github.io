/* Jubail Commons — shared client. Load after assets/vendor/supabase-*.js and
   assets/strings.js. One Supabase client per page.

   CONTRACT — every RPC goes through rpc(), which rejects on BOTH failure shapes:
   - a PostgREST error: the message is the RAISE code (MODULE_OFF, NOT_MEMBER, …)
   - an HTTP 200 whose top-level body has an "error" key (T3: BAD_CODE, BAD_ADMIN
     return instead of raise so the failure counter commits) — still a failure.
   Callers never see a "successful" failure. (Nested "error" keys, e.g. inside
   jc_admin_report's cleanup jobs, are data.) */

var JC_URL = "https://qrpxfssdeeuzmsmlbtbu.supabase.co";
var JC_KEY = "sb_publishable_cQKcp9tzYzeyrIO0Hzz6ZQ_jaxoq7QU"; /* publishable by design */

/* ?community=<slug> selects another community for this tab (the e2e smoke-test
   community). Harmless by design: the server derives a resident's community from
   their membership, never from client input; this only picks which join code and
   config the screens ask for. */
function jcCommunity(){
  var q = new URLSearchParams(location.search).get("community");
  try {
    if (q && /^[a-z][a-z0-9-]{1,30}$/.test(q)) sessionStorage.setItem("jc_community", q);
    return sessionStorage.getItem("jc_community") || "jubail";
  } catch(e){ return (q && /^[a-z][a-z0-9-]{1,30}$/.test(q)) ? q : "jubail"; }
}

/* Header name. The real one comes from the community's config; until it loads, the last name this
   browser saw (pages used to flash "Jubail Commons" before e.g. "E2E Test Commons" — Zee 2026-11-05),
   else the neutral platform name. `id`, when known, keeps another community's saved name out. */
function jcCommunityName(cfg, id){
  jcLabelsSet(cfg, id);                     /* RM: the section names come from the same config, same moment */
  var n = cfg && cfg.name_en ? { id: id || null, en: cfg.name_en, ar: cfg.name_ar || "" } : null;
  try {
    if (n) localStorage.setItem("jc_name", JSON.stringify(n));
    else {
      n = JSON.parse(localStorage.getItem("jc_name") || "null");
      if (n && (typeof n.en !== "string" || (id && n.id && n.id !== id))) n = null;
    }
  } catch(e){}
  if (!n || !n.en) return jcT("platform_brand");
  return jcLang() === "ar" && n.ar ? n.ar : n.en;
}

/* RM — section names (renamable modules; docs/plans/RM-renamable-modules.md). A community admin may set a
   NAME (bar, tabs, Settings) and a TITLE (page heading, hub card) per module, EN + AR (jc_config_get 'labels',
   written by jc_admin_module_label_set). Nothing set = the built-in strings below. Like jcCommunityName: a
   loaded config replaces the cache; until one loads (or if it fails), the last names this browser saw for
   this community. Display text only — callers esc() it, and give its element dir="auto". */
var JC_MOD_NAME  = { events: "module_events", bookings: "module_bookings", pets: "feat_pets",   community: "module_community" };
var JC_MOD_TITLE = { events: "ev_title",      bookings: "module_bookings", pets: "module_pets", community: "module_community" };
var JC_LABELS;                              /* undefined = not read yet; null = none */
function jcLabelsSet(cfg, id){
  if (cfg && typeof cfg === "object" && Object.prototype.hasOwnProperty.call(cfg, "labels")) {
    var l = cfg.labels && typeof cfg.labels === "object" && !Array.isArray(cfg.labels) ? cfg.labels : {};
    JC_LABELS = { id: id || cfg.id || null, labels: l };
    try { localStorage.setItem("jc_labels", JSON.stringify(JC_LABELS)); } catch(e){}
    return;
  }
  if (JC_LABELS !== undefined && !(JC_LABELS && id && JC_LABELS.id && JC_LABELS.id !== id)) return;
  var c = null;
  try { c = JSON.parse(localStorage.getItem("jc_labels") || "null"); } catch(e){}
  if (!c || typeof c !== "object" || !c.labels || typeof c.labels !== "object" || (id && c.id && c.id !== id)) c = null;
  JC_LABELS = c;
}
/* one stored string, or null: the server caps names at 14/18 and titles at 40; anything odd is ignored */
function jcLabel(key, part){
  if (JC_LABELS === undefined) jcLabelsSet(null, null);
  var e = JC_LABELS && Object.prototype.hasOwnProperty.call(JC_LABELS.labels, key) ? JC_LABELS.labels[key] : null;
  var p = e && typeof e === "object" ? e[part] : null;
  var v = p && typeof p === "object" ? p[jcLang() === "ar" ? "ar" : "en"] : null;
  return typeof v === "string" && v.trim() && v.length <= 40 ? v : null;
}
function jcModName(key){ return jcLabel(key, "name") || jcT(JC_MOD_NAME[key] || key); }
function jcModTitle(key){ return jcLabel(key, "title") || jcLabel(key, "name") || jcT(JC_MOD_TITLE[key] || key); }

/* Captured BEFORE createClient: the client consumes and clears auth parameters
   (?code=…, #error_code=…) as soon as it is created, so a page reading the URL
   afterwards would never know it was opened from a reset link. */
var JC_URL_HASH = location.hash;
var JC_URL_SEARCH = location.search;

/* R3a start page: true only on the first Commons page of this browser tab / app launch
   (sessionStorage is per tab and per launch). Set on every page, so a reload, a tap on
   Commons, a sign-in return or an auto-update reload is never "first". No storage → false
   (never redirect). */
var JC_FIRST_PAGE = (function(){
  try { var f = !sessionStorage.getItem("jc_seen"); sessionStorage.setItem("jc_seen", "1"); return f; }
  catch(e){ return false; }
})();
/* The last jc_me_get this page saw (jcState, or a write that returns it). The bar reads its
   saved choices from here, so its callers never pass them in. */
var JC_ME = null;

/* Running as the app saved to the Home Screen (R3b): iPhone (navigator.standalone) or a
   standalone display mode. */
function jcStandalone(){
  try { return navigator.standalone === true || !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches); }
  catch(e){ return false; }
}

/* flowType 'pkce' (PR #18 review): the default implicit flow adopts ANY session
   handed to it in a URL fragment — a crafted link could silently swap a resident's
   session for an attacker's (login CSRF). PKCE only exchanges a ?code= when THIS
   browser holds the matching verifier, i.e. it requested the email itself.
   Cost: a reset link must be opened in the browser that asked for it. */
var jcDb = supabase.createClient(JC_URL, JC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
});
/* R4b-1a (security review L3): an admin invite kept for this tab (admin.js) never outlives the session
   that opened it — on a shared phone the next person must not be asked to accept it */
jcDb.auth.onAuthStateChange(function(ev){
  if (ev === "SIGNED_OUT") { try { sessionStorage.removeItem("jc_admin_invite"); } catch(e){} }
});

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

function jcErr(code, detail){
  var e = new Error(code);
  e.code = code;
  e.detail = detail;
  return e;
}

/* Server codes are UPPER_SNAKE; anything else (network failure, JWT trouble,
   a Postgres message) is surfaced as NETWORK/UNKNOWN with the raw text kept. */
function jcCode(msg){
  msg = String(msg || "");
  if (/^[A-Z][A-Z0-9_]+$/.test(msg)) return msg;
  if (/fetch|network|load failed/i.test(msg)) return "NETWORK";
  return "UNKNOWN";
}

function rpc(name, args){
  return jcDb.rpc(name, args || {}).then(function(res){
    if (res.error) throw jcErr(jcCode(res.error.message), res.error);
    var d = res.data;
    if (d && typeof d === "object" && !Array.isArray(d) && d.error != null) {
      throw jcErr(jcCode(d.error), d);
    }
    return d;
  });
}

/* Human copy for an error: err_<CODE> from the strings dictionary, else generic. */
function jcErrText(e){
  var code = (e && e.code) || "UNKNOWN";
  var t = jcT("err_" + code);
  return t === "err_" + code ? jcT("err_UNKNOWN") : t;
}

/* Who is this device? Routing for every page:
   signed_out → account page; not_member → join code; member → me (home may be null). */
function jcState(){
  return jcDb.auth.getSession().then(function(r){
    var session = r.data && r.data.session;
    if (!session) return { status: "signed_out" };
    var email = session.user && session.user.email;
    return rpc("jc_me_get").then(function(me){
      JC_ME = me;
      return { status: "member", email: email, me: me };
    }, function(e){
      if (e.code === "NOT_MEMBER") return { status: "not_member", email: email };
      if (e.code === "NOT_SIGNED_IN") return { status: "signed_out" };
      throw e;
    });
  });
}

/* Post-sign-in / post-pin destination: relative Commons paths only (never an open
   redirect). Two queries are allowed: a household invite token, so an invitee who must
   first sign in or join lands back on the invite (T5.0b); and an event + tab, so a
   resident sent to pin their home lands back on the event's sign-up (T5.2). */
function jcSafeNext(next){
  return (typeof next === "string" &&
          (/^\.\.?\/[a-z0-9\/_-]*(\?invite=[A-Za-z0-9_-]{16,64})?$/.test(next) ||
           /* T5.2 PR B: back to an event-admin grant link after signing in / joining */
           /^\.\.\/admin\/\?eventadmin=[A-Za-z0-9_-]{16,64}$/.test(next) ||
           /* T5.2: back to an event's tab after pinning the home */
           /^\.\.\/events\/\?id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}&tab=(map|list|mine)$/.test(next) ||
           /* R5b-1: a shared pet link (WhatsApp) opened before signing in / joining lands on that pet */
           /^\.\.\/pets\/\?pet=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(next)))
         ? next : "../";
}

/* A string stored under key k in an admin-authored map, or null. Own keys only: a choice
   stored as "constructor" must never read Object's built-ins (PR #27 review). */
function jcOwn(m, k){
  return m && typeof m === "object" && Object.prototype.hasOwnProperty.call(m, k) && typeof m[k] === "string" ? m[k] : null;
}

/* R2b-2: an event's security number — the server's rule (jc_admin_event_save): an optional leading +, then
   numerals with single spaces, 3–15 numerals, ≤ 24 characters. The event page links it (tel:) only if it passes. */
function jcSafetyPhoneOk(p){
  return typeof p === "string" && p.length <= 24 && /^\+?[0-9]( ?[0-9])*$/.test(p) &&
         p.replace(/[^0-9]/g, "").length >= 3 && p.replace(/[^0-9]/g, "").length <= 15;
}

/* "Villa 12" / "Townhouse 7" / "Apt 304, B2" — from a jc_me_get home object. */
function jcHomeLabel(h){
  if (!h) return "";
  var key = h.type === "apartment" ? "home_apartment" : h.type === "townhouse" ? "home_townhouse" : "home_villa";
  return jcFmt(key, { n: h.number, b: h.building });
}

/* Community-time dates (R4b-2 / R4c). A court's day is a date in the COMMUNITY's zone (cfg.tz), never the phone's:
   a resident abroad, or an admin with a travelling phone, must see the community's today and its clock times. */
function jcTz(cfg){ return (cfg && typeof cfg.tz === "string" && cfg.tz) || "Asia/Dubai"; }
function jcTzToday(cfg){
  try {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: jcTz(cfg), year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  } catch(e){ return new Date().toISOString().slice(0, 10); }
}
/* calendar arithmetic on "YYYY-MM-DD" (no zone involved) */
function jcDateAdd(d, n){ var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function jcIsDate(d){ return typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && jcDateAdd(d, 0) === d; }
function jcLocale(){ return jcLang() === "ar" ? "ar-AE-u-nu-latn" : "en-GB"; }
/* "Tue 10 Nov" for a community date */
function jcDayText(d, opts){
  return new Date(d + "T12:00:00Z").toLocaleDateString(jcLocale(), Object.assign({ weekday: "short", day: "numeric", month: "short" }, opts || {}, { timeZone: "UTC" }));
}
/* Take a Leaflet map down safely. Leaflet 1.9.4 leaves a 250 ms "zoom finished" timer running after
   remove(); a tab switch inside that window threw "_leaflet_pos" of undefined (the flaky map tests,
   and a real phone tapping fast). Clearing the animating flag makes that late timer a no-op. */
/* "12 min ago" / "3 h ago" / "2 days ago"; "" for a bad or future time. now: ms (a page's own clock), else Date.now() */
function jcAgo(iso, now){
  var t = Date.parse(iso);
  if (!isFinite(t)) return "";
  var m = Math.round(((now || Date.now()) - t) / 60000);
  if (m < -5) return "";
  m = Math.max(0, m);
  return m < 60 ? jcFmt("adm_h_min", { n: m }) : m < 2880 ? jcFmt("adm_h_hours", { n: Math.round(m / 60) }) : jcFmt("adm_h_days", { n: Math.round(m / 1440) });
}
function jcMapRemove(m){
  if (!m) return;
  try { m.stop(); } catch(e){}
  m._animatingZoom = false;
  m.remove();
}
/* "18:00" for an instant, on the community's clock */
function jcClock(iso, cfg){ return new Date(iso).toLocaleTimeString(jcLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: jcTz(cfg) }); }
/* the community date an instant falls on */
function jcDateOf(iso, cfg){
  try {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: jcTz(cfg), year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(iso)).forEach(function(x){ p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  } catch(e){ return String(iso).slice(0, 10); }
}

/* Village display name from a jc_config_get config (falls back to the key). */
function jcVillageName(cfg, key){
  var v = ((cfg && cfg.villages) || []).filter(function(x){ return x.key === key; })[0];
  if (!v) return key || "";
  return (jcLang() === "ar" && v.ar) ? v.ar : v.en;
}

/* Anon-only RPCs (jc_config_get, jc_hit) skip the auth client on purpose: a broken
   stored session must never take down the public landing or silence the counter. */
function jcAnon(name, args, keepalive){
  return fetch(JC_URL + "/rest/v1/rpc/" + name, {
    method: "POST", keepalive: !!keepalive,
    headers: { "apikey": JC_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args || {})
  }).then(function(r){
    if (!r.ok) throw jcErr("NETWORK", "HTTP " + r.status);
    return r.text().then(function(t){ return t ? JSON.parse(t) : null; });  /* void RPCs: 204 / empty */
  });
}

/* First-party visit counter: page × hour totals only — no cookies, no IPs.
   Fire-and-forget: a failed count must never affect the page. A counter that
   stops is caught by the admin report (accounts > 0 but no hits in 24 h). */
function jcHit(page){
  try { jcAnon("jc_hit", { p_community: jcCommunity(), p_page: page }, true).catch(function(){}); } catch(e){}
}
