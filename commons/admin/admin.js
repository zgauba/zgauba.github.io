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

/* Halloween 2026, as residents knew it (jubail-halloween/): friendly wording and the
   pin hints PR 5 draws (ring = which gate, icon = what's handed out). Arabic: DRAFT. */
var HALLOWEEN = { fields: {
  treats: { type: "enum", values: ["candy", "non_food", "both"], required: true, pin: "glyph",
    label_en: "What will you hand out?", label_ar: "ماذا ستوزّع؟",
    labels_en: { candy: "Candy only", non_food: "Non-food treats only (allergy-friendly)", both: "Both — candy and non-food" },
    labels_ar: { candy: "حلوى فقط", non_food: "هدايا غير غذائية فقط (مناسبة لمن لديهم حساسية)", both: "الاثنان — حلوى وهدايا غير غذائية" },
    glyphs: { candy: "🍬", non_food: "🎃", both: "🍬🎃" } },
  handout: { type: "enum", values: ["door", "self_serve"], required: true,
    label_en: "On the night, treats are…", label_ar: "في تلك الليلة، توزَّع الحلوى…",
    labels_en: { door: "Handed out in person", self_serve: "Self-serve — left out for visitors" },
    labels_ar: { door: "باليد", self_serve: "خدمة ذاتية — تُترك للزوار" } },
  entrance: { type: "enum", values: ["front", "garden", "both"], required: true, pin: "ring",
    label_en: "Kids should come to…", label_ar: "على الأطفال القدوم إلى…",
    labels_en: { front: "Front gate", garden: "Garden gate (park side)", both: "Both gates" },
    labels_ar: { front: "البوابة الأمامية", garden: "بوابة الحديقة (جهة المنتزه)", both: "البوابتان" } }
} };
var FEATURES = ["giant_switch", "supply", "crowd_reports"];
var REQ = '<span class="req" aria-hidden="true">*</span>';   /* needed before publishing */

/* T5.2 2c — "New event" starts from a template (plan amendment A5). A template only
   pre-fills: kind, look, questions, switches, spots — the organizer changes anything.
   Arabic wording: DRAFT, pending review. */
var LOOKS = ["plain", "halloween", "haq_al_laila", "gathering", "market", "yard_sale"];
var ENTRANCE = HALLOWEEN.fields.entrance;
var TEMPLATES = [
  { id: "halloween", kind: "homes", look: "halloween", features: { giant_switch: true }, schema: HALLOWEEN },
  { id: "haq_al_laila", kind: "homes", look: "haq_al_laila", features: { giant_switch: true }, schema: { fields: {
    /* from Zee's Haq al Laila concept (Oct 2026): the choice that matters is nut-free —
       allergy-friendly homes stand out on the map */
    treats: { type: "enum", values: ["mix", "nut_free", "both"], required: true, pin: "glyph",
      label_en: "What will you hand out?", label_ar: "ماذا ستوزّع؟",
      labels_en: { mix: "Sweets & nuts — the traditional mix", nut_free: "Nut-free only — safe for kids with allergies",
                   both: "Both — a nut-free option alongside the mix" },
      labels_ar: { mix: "حلويات ومكسرات — الخلطة التقليدية", nut_free: "خالٍ من المكسرات فقط — آمن للأطفال المصابين بالحساسية",
                   both: "الاثنان — خيار خالٍ من المكسرات مع الخلطة" },
      glyphs: { mix: "🥜", nut_free: "🍬", both: "🥜🍬" } },
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
function canEnter(){ return isOrganizer() || isEventAdmin() || owner; }
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
  admining = null; adminsData = null; closing = null; su = null; pm = null;
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
  if (vmap) { vmap.remove(); vmap = null; }
  /* back, in the top bar: sign-ups → the events list; pin move → the sign-ups */
  jcBack(name === "signups" ? leaveSignups
       : name === "pinmove" ? function(){ pm = null; show("signups"); }
       : name === "feedback" ? function(){ show("home"); } : null, "back");
  VIEWS[name]();
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
    var html =
      '<h1>' + esc(jcT("adm_title")) + '</h1>' +
      '<p class="sub">' + esc(scopes.length
        ? jcFmt("adm_scopes", { s: scopes.map(function(s){ return jcT("scope_" + s); }).join(" · ") })
        : isEventAdmin() ? jcT("adm_event_admin_sub") : jcT("adm_owner_sub")) + '</p>' +
      msgBox() +
      /* T5.3: the platform owner's feedback inbox */
      (owner ? '<div class="panel fbentry"><button class="btn' + (fb && fb.unread ? '' : ' ghost') + '" type="button" id="fbOpen">' +
        esc(fb ? jcFmt("adm_fb_open", { n: fb.unread }) : jcT("adm_fb_title")) + '</button></div>' : '') +
      /* creating events is the community's step (T5.2 D2) */
      (isOrganizer() ? '<div class="row"><button class="btn" type="button" id="newEv">' + esc(jcT("adm_new")) + '</button></div>' : '') +
      '<h2 class="group">' + esc(jcT("adm_events")) + '</h2>' +
      (events.length ? '<ul class="aevents">' + events.map(eventRow).join("") + '</ul>'
                     : '<p class="help">' + esc(jcT("adm_none")) + '</p>');
    /* the banner (T5.2 PR 4): organizers any time; an event admin while an event they run is live */
    if (isOrganizer() || events.some(function(e){ return e.status === "live"; })) {
      html += '<h2 class="group">' + esc(jcT("adm_banner")) + '</h2>' +
        '<form class="panel" id="bannerForm" novalidate><p class="help">' + esc(jcT("adm_banner_help")) + '</p>' +
        '<textarea id="bannerText" maxlength="280" dir="auto" aria-label="' + esc(jcT("adm_banner")) + '"></textarea>' +
        '<div class="row"><button class="btn" id="bannerSave" type="submit">' + esc(jcT("adm_banner_post")) + '</button>' +
        '<button class="btn ghost" id="bannerClear" type="button">' + esc(jcT("adm_banner_clear")) + '</button></div></form>';
    }
    if (has("community")) {
      html += '<h2 class="group">' + esc(jcT("adm_codes")) + '</h2><div class="panel"><p class="help">' + esc(jcT("adm_codes_help")) + '</p>' +
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
    html += '<div class="section"><div class="panel">' +
      '<button class="btn ghost" type="button" id="addCode">' + esc(jcT("adm_add_code")) + '</button>' +
      (scopes.length ? '<button class="btn ghost" type="button" id="exit">' + esc(jcT("adm_exit")) + '</button>' +
        '<p class="help">' + esc(jcT("adm_exit_help")) + '</p>' : '') +
      '</div></div>';
    el("view").innerHTML = html;

    on("newEv", function(){ openEditor(null); });
    on("fbOpen", function(){ show("feedback"); });
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
        scopes = []; admining = null; adminsData = null;
        if (isEventAdmin() || owner) return loadHome();   /* still runs their own events / reads feedback */
        events = []; show("lock");
      }, function(e){ busy("exit", false); fail(e); });
    });
    wireAdmins();
    wireBanner();
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
    var feats0 = ed.ev ? ev.features : ed.tpl && ed.tpl.features;      /* a template pre-sets switches */
    FEATURES.forEach(function(f){ el("f_" + f).checked = !!(feats0 && feats0[f]); });
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
      el("f_giant_switch").checked = true;
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

function eventRow(e){
  var status = e.status === "draft" ? "adm_status_draft" : e.status === "archived" ? "adm_status_archived"
    : e.coming_soon ? "adm_status_soon" : e.signups_open ? "adm_status_open" : "adm_status_paused";   /* T5.4 */
  var place = e.kind === "venue"                                     /* T5.2 2c */
    ? (e.venue_name_en ? jcFmt("adm_at", { v: ar() && e.venue_name_ar ? e.venue_name_ar : e.venue_name_en }) : jcT("adm_no_venue"))
    : null;
  var line = [jcT(status), place, fmtDate(e.starts_at),
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
  if (a === "publish" && !window.confirm(jcFmt("adm_publish_confirm", { t: title(e) }))) return;
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

function entryCard(x, ro){
  var e = su.ev, venue = e.kind === "venue";
  var flags = [];
  if (x.hidden) flags.push(jcT("adm_su_hidden"));
  if (x.spot) flags.push(jcFmt("adm_su_spot", { s: x.spot }));
  if (!venue) flags.push(jcT(x.event_lat != null ? "adm_su_event_pin" : x.home_lat != null ? "adm_su_home_pin" : "adm_su_no_pin"));
  if (x.reports_open) flags.push(jcFmt("adm_su_reports", { n: x.reports_open }));
  var open = su.open && su.open.id === x.id ? su.open.what : null;
  function b(a, label, cls){
    return '<button class="mini' + (cls ? ' ' + cls : '') + '" type="button" data-su="' + a + '" data-id="' + esc(x.id) + '">' + esc(label) + '</button>';
  }
  var acts = ro ? '' : '<div class="acts">' +
    b("note", jcT(x.org_note ? "adm_su_note_edit" : "adm_su_note")) +
    (x.hidden ? b("show", jcT("adm_su_restore")) : b("hide", jcT("adm_su_hide"), "danger")) +
    (venue ? '' : b("pin", jcT("adm_su_move_pin"))) +
    (venue && e.spots ? b("spot", jcT(x.spot ? "adm_su_spot_change" : "adm_su_spot_set")) : '') + '</div>';
  var form = '';
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
/* a write that returns the whole list (moderate / spot / event pin) → redraw, then say so */
function suWrite(name, args, okText, undo){
  var id = su.ev.id, from = screenKey();
  return rpc(name, args).then(function(list){
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
  fail(err);
}
/* the ok message, with an Undo button when the change can be put back */
function okUndo(text, undo){
  showOk(text);
  if (!undo) return;
  var u = document.createElement("button");
  u.type = "button"; u.className = "mini"; u.id = "undo"; u.textContent = jcT("adm_undo");
  u.style.marginInlineStart = "10px";
  u.addEventListener("click", function(){ u.disabled = true; undo(); });
  el("msg").appendChild(u);
}

function wireEntries(){
  Array.prototype.forEach.call(document.querySelectorAll("[data-su]"), function(b){
    b.addEventListener("click", function(){
      var x = byEntry(b.dataset.id), a = b.dataset.su;
      if (!x) return;
      if (a === "note" || a === "spot") {
        su.open = su.open && su.open.id === x.id && su.open.what === a ? null : { id: x.id, what: a };
        show("signups");
        var f = document.querySelector('[data-form] [data-in]');
        if (f) { f.value = f.defaultValue = (a === "note" ? x.org_note : x.spot) || ""; f.focus(); }
        return;
      }
      if (a === "pin") { pm = { x: x }; return show("pinmove"); }
      b.disabled = true;
      var hide = a === "hide";
      suWrite("jc_admin_entry_moderate", { p_entry: x.id, p_hidden: hide, p_org_note: null },
        jcFmt(hide ? "adm_su_hidden_ok" : "adm_su_restored_ok", { h: jcHomeLabel(x) }),
        function(){ suWrite("jc_admin_entry_moderate", { p_entry: x.id, p_hidden: !hide, p_org_note: null }, jcT("adm_undone")); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-form]"), function(f){
    var x = byEntry(f.dataset.id), what = f.dataset.form, inp = f.querySelector("[data-in]");
    function send(v){
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
    .concat([jcT("csv_note"), jcT("csv_org_note"), jcT("csv_reports"), jcT("csv_signed_up"), jcT("csv_updated")]);
  var rows = su.list.map(function(x){
    var evPin = x.event_lat != null;
    return [jcVillageName(cfg, x.village), jcHomeLabel(x), jcT("csv_st_" + x.status) === "csv_st_" + x.status ? x.status : jcT("csv_st_" + x.status),
            x.hidden ? jcT("ev_yes") : ""]
      .concat(e.spots ? [x.spot || ""] : [])
      .concat(e.kind === "venue" ? [] : [jcT(evPin ? "csv_pin_event" : x.home_lat != null ? "csv_pin_home" : "csv_pin_none"),
        evPin ? x.event_lat : x.home_lat, evPin ? x.event_lng : x.home_lng])
      .concat(keys.map(function(k){ var p = x.payload || {}; return k in p ? answerText(fields[k], p[k]) : ""; }))
      .concat([x.note || "", x.org_note || "", x.reports_open || 0, x.created_at || "", x.updated_at || ""]);
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
function wireBanner(){
  var f = el("bannerForm");
  if (!f) return;
  var t = el("bannerText");
  t.value = t.defaultValue = (cfg && cfg.broadcast) || "";
  function post(text){
    if (text && !window.confirm(jcT("adm_banner_confirm"))) return;
    busy(text ? "bannerSave" : "bannerClear", true);
    rpc("jc_admin_broadcast_set", { p_text: text }).then(function(r){
      cfg = Object.assign({}, cfg || {}, { broadcast: (r && r.broadcast) || "" });
      paint(); show("home");
      showOk(jcT(cfg.broadcast ? "adm_banner_posted" : "adm_banner_cleared"));
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
function newChoice(){ return { value: null, en: "", ar: "", glyph: "" }; }
function fromSchema(schema){
  var fields = (schema && schema.fields) || {};
  return Object.keys(fields).map(function(k){
    var f = fields[k] || {};
    var len = f.labels_en || {}, lar = f.labels_ar || {}, gl = f.glyphs || {};
    return {
      key: k, label_en: f.label_en || "", label_ar: f.label_ar || "",
      type: f.type === "bool" || f.type === "text" ? f.type : "enum",
      required: !!f.required, pin: f.pin === "ring" || f.pin === "glyph" ? f.pin : "", max: f.max,
      choices: (f.values || []).map(function(v){ return { value: v, en: jcOwn(len, v) || "", ar: jcOwn(lar, v) || "", glyph: jcOwn(gl, v) || "" }; })
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
      var len = {}, lar = {}, gl = {}, anyAr = false, anyGl = false;
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        if (!c.en.trim()) return { err: "Q_CHOICE_LABEL" };
        if (!c.value) { c.value = keyFrom(c.en, vals, "choice_" + (j + 1), 40); vals.push(c.value); }
        len[c.value] = c.en.trim();
        if (c.ar.trim()) { lar[c.value] = c.ar.trim(); anyAr = true; }
        if (q.pin === "glyph" && c.glyph.trim()) { gl[c.value] = c.glyph.trim(); anyGl = true; }
      }
      f.values = cs.map(function(c){ return c.value; });
      f.labels_en = len;
      if (anyAr) f.labels_ar = lar;
      if (q.pin) f.pin = q.pin;
      if (anyGl) f.glyphs = gl;
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
              '<button type="button" class="mini" data-cact="del" aria-label="' + esc(jcT("ed_q_remove_choice")) + '">✕</button></div>';
          }).join("") +
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
  if (s && en && new Date(en) < new Date(s)) return showErr("BAD_DATES");
  /* features: the three switches, keeping any other flag an event already carries */
  var feats = Object.assign({}, orig.features || {});
  FEATURES.forEach(function(k){ if (el("f_" + k).checked) feats[k] = true; else delete feats[k]; });
  if (JSON.stringify(feats) !== JSON.stringify(orig.features || {})) f.features = feats;
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
      if (e.code === "NOT_ADMIN" && owner) { events = []; return show("home"); }   /* owner without an organizer code */
      if (e.code === "NOT_ADMIN") { scopes = []; adminEvents = []; show("lock"); showErr(e.code); } else { show("lock"); showErr(e.code); } });
}

/* ---------- boot ---------- */
function paint(){
  var name = cfg ? (ar() ? (cfg.name_ar || cfg.name_en) : cfg.name_en) : jcT("brand");
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
    if (canEnter()) return loadHome();
    show("lock");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
