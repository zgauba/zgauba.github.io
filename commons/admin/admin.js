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
var scopes = [];          /* unlocked scopes: jc_me_get.admin_scopes / jc_admin_unlock */
var events = [];          /* last jc_admin_events_list */
var closing = null;       /* id of the event whose close form is open */
var newCode = null;       /* {scope, code} — shown once: any later re-render drops it */
var ed = null;            /* editor state: { ev (original or null), qs, locked, slugTouched } */

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

/* ---------- helpers ---------- */
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){ var m = el("msg"); if (!m) return; m.className = "msg err"; m.textContent = jcErrText({ code: code }); }
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
  if (e.code === "NOT_ADMIN") { scopes = []; show("lock"); }
  showErr(e.code);
}

function show(name){
  current = name;
  newCode = null;         /* only rotate() draws the code, once (review PR #26) */
  VIEWS[name]();
}

/* ---------- views ---------- */
var VIEWS = {
  lock: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("adm_title")) + '</h1><p class="sub">' + esc(jcT("adm_lock_help")) + '</p>' +
      '<form class="panel" id="form" novalidate><label>' + esc(jcT("adm_code")) +
        '<input id="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>' +
        msgBox() + '<button class="btn" id="go" type="submit">' + esc(jcT("adm_unlock")) + '</button></form>';
    el("form").addEventListener("submit", function(ev){
      ev.preventDefault();
      var code = el("code").value.trim();
      if (!code) return showErr("BAD_ADMIN");
      busy("go", true);
      /* wrong code = HTTP 200 + {error: BAD_ADMIN}; rpc() rejects it (T3 contract) */
      rpc("jc_admin_unlock", { p_code: code }).then(function(s){
        scopes = s || [];
        if (!isOrganizer()) { busy("go", false); return showErr("NOT_ORGANIZER"); }
        loadHome();
      }, function(e){ busy("go", false); showErr(e.code); });
    });
  },

  home: function(){
    var html =
      '<h1>' + esc(jcT("adm_title")) + '</h1>' +
      '<p class="sub">' + esc(jcFmt("adm_scopes", { s: scopes.map(function(s){ return jcT("scope_" + s); }).join(" · ") })) + '</p>' +
      msgBox() +
      '<div class="row"><button class="btn" type="button" id="newEv">' + esc(jcT("adm_new")) + '</button></div>' +
      '<h2 class="group">' + esc(jcT("adm_events")) + '</h2>' +
      (events.length ? '<ul class="aevents">' + events.map(eventRow).join("") + '</ul>'
                     : '<p class="help">' + esc(jcT("adm_none")) + '</p>');
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
    html += '<div class="section"><div class="panel"><button class="btn ghost" type="button" id="exit">' + esc(jcT("adm_exit")) + '</button>' +
      '<p class="help">' + esc(jcT("adm_exit_help")) + '</p></div></div>';
    el("view").innerHTML = html;

    on("newEv", function(){ openEditor(null); });
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
    on("exit", function(){
      busy("exit", true);
      rpc("jc_admin_exit").then(function(){ scopes = []; events = []; show("lock"); },
                                function(e){ busy("exit", false); fail(e); });
    });
    var closeForm = el("closeForm");
    if (closeForm) closeForm.addEventListener("submit", function(e2){ e2.preventDefault(); closeEvent(); });
  },

  editor: function(){
    var ev = ed.ev || {};
    var draft = !ed.ev || ev.status === "draft";
    var schemaLocked = ed.locked;
    el("view").innerHTML =
      '<h1>' + esc(jcT(ed.ev ? "ed_edit" : "ed_new")) + '</h1>' +
      '<form class="panel" id="form" novalidate data-no-autoreload>' +
        '<label>' + esc(jcT("ed_title_en")) + '<input id="title_en" type="text" maxlength="120" required></label>' +
        '<label>' + esc(jcT("ed_title_ar")) + '<input id="title_ar" type="text" maxlength="120" dir="rtl"></label>' +
        '<label>' + esc(jcT("ed_slug")) + '<input id="slug" type="text" maxlength="41" autocapitalize="none" spellcheck="false"' +
          (draft ? '' : ' disabled') + '></label>' +
        '<p class="help">' + esc(jcT("ed_slug_help")) + '</p>' +
        '<label>' + esc(jcT("ed_desc_en")) + '<textarea id="description_en" maxlength="2000"></textarea></label>' +
        '<label>' + esc(jcT("ed_desc_ar")) + '<textarea id="description_ar" maxlength="2000" dir="rtl"></textarea></label>' +
        '<div class="dates"><label>' + esc(jcT("ed_starts")) + '<input id="starts_at" type="datetime-local"></label>' +
          '<label>' + esc(jcT("ed_ends")) + '<input id="ends_at" type="datetime-local"></label></div>' +
        '<p class="help">' + esc(jcT("ed_time_help")) + '</p>' +
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
    el("starts_at").value = el("starts_at").defaultValue = toLocalInput(ev.starts_at);
    el("ends_at").value = el("ends_at").defaultValue = toLocalInput(ev.ends_at);
    FEATURES.forEach(function(f){ el("f_" + f).checked = !!(ev.features && ev.features[f]); });
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
  }
};

function eventRow(e){
  var status = e.status === "draft" ? "adm_status_draft" : e.status === "archived" ? "adm_status_archived"
    : e.signups_open ? "adm_status_open" : "adm_status_paused";
  var line = [jcT(status), fmtDate(e.starts_at), jcFmt("adm_homes", { n: e.entries || 0 })].filter(Boolean).join(" · ");
  var acts = "";
  function btn(a, label, ghost){
    return '<button class="btn' + (ghost ? ' ghost' : '') + ' small" type="button" data-act="' + a + '" data-id="' + esc(e.id) + '">' + esc(label) + '</button>';
  }
  if (e.status === "draft") acts = btn("edit", jcT("adm_edit"), true) + btn("publish", jcT("adm_publish"));
  if (e.status === "live") {
    acts = btn("edit", jcT("adm_edit"), true) +
      btn(e.signups_open ? "pause" : "open", jcT(e.signups_open ? "adm_pause_signups" : "adm_open_signups"), true) +
      btn("close", jcT("adm_close"), true) +
      '<a class="btn ghost small" href="../events/?id=' + esc(e.id) + '">' + esc(jcT("adm_view")) + '</a>';
  }
  if (e.status === "archived") acts = '<a class="btn ghost small" href="../events/?id=' + esc(e.id) + '">' + esc(jcT("adm_numbers")) + '</a>';
  return '<li data-event="' + esc(e.slug) + '"><div><b>' + esc(title(e)) + '</b><small>' + esc(line) + '</small></div>' +
    '<div class="acts">' + acts + '</div>' +
    (closing === e.id
      ? '<form class="closeform" id="closeForm" novalidate><p class="help">' + esc(jcFmt("adm_close_help", { slug: e.slug })) + '</p>' +
        '<input id="closeSlug" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="' + esc(e.slug) + '">' +
        '<button class="btn danger" id="closeGo" type="submit">' + esc(jcT("adm_close_go")) + '</button></form>'
      : '') + '</li>';
}

function act(a, id, b){
  var e = byId(id);
  if (!e) return;
  if (a === "edit") return openEditor(e);
  if (a === "close") { closing = closing === id ? null : id; show("home"); if (el("closeSlug")) el("closeSlug").focus(); return; }
  if (a === "publish" && !window.confirm(jcFmt("adm_publish_confirm", { t: title(e) }))) return;
  var call = a === "publish" ? rpc("jc_admin_event_publish", { p_event: id })
    : rpc("jc_admin_event_signups", { p_event: id, p_open: a === "open" });
  b.disabled = true;
  call.then(function(list){
    events = list; show("home");
    showOk(jcT(a === "publish" ? "adm_published" : a === "open" ? "adm_opened" : "adm_paused"));
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

function openEditor(ev){
  closing = null;
  ed = { ev: ev, qs: fromSchema(ev && ev.payload_schema), locked: !!ev && ev.entries > 0, slugTouched: !!ev };
  show("editor");
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
      '<label>' + esc(jcT("ed_q_label_en")) + '<input type="text" maxlength="200" data-q-label="en"></label>' +
      '<label>' + esc(jcT("ed_q_label_ar")) + '<input type="text" maxlength="200" dir="rtl" data-q-label="ar"></label>' +
      '<div class="qrow"><label>' + esc(jcT("ed_q_type")) + '<select data-q-type>' + types + '</select></label>' +
        '<label class="check"><input type="checkbox" data-q-req' + (q.required ? ' checked' : '') + '> <span>' + esc(jcT("ed_q_req")) + '</span></label></div>' +
      (q.type === "enum"
        ? '<label>' + esc(jcT("ed_q_pin")) + '<select data-q-pin>' + pins + '</select></label>' +
          '<div class="choices"><span class="clabel">' + esc(jcT("ed_q_choices")) + '</span>' + q.choices.map(function(c, j){
            return '<div class="choice" data-c="' + j + '">' +
              (q.pin === "glyph" ? '<input type="text" class="glyph" maxlength="8" data-c-f="glyph" aria-label="' + esc(jcT("ed_q_glyph_in")) + '">' : '') +
              '<input type="text" maxlength="40" data-c-f="en" placeholder="' + esc(jcT("ed_q_choice_en")) + '" aria-label="' + esc(jcT("ed_q_choice_en")) + '">' +
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

/* Only what changed goes to the server (premortem #1); a new event sends what's filled. */
function saveEvent(){
  var ev = ed.ev, orig = ev || {};
  var draft = !ev || ev.status === "draft";
  var f = {};
  var title_en = el("title_en").value.trim();
  if (!title_en) return showErr("TITLE_REQUIRED");
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
    events = list; ed = null; show("home"); showOk(jcT("adm_saved"));
  }, function(err){ busy("save", false); fail(err); });
}

function loadHome(){
  return rpc("jc_admin_events_list").then(function(list){ events = list; show("home"); },
    function(e){ if (e.code === "NOT_ADMIN") { scopes = []; show("lock"); } else { show("lock"); showErr(e.code); } });
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
  if (current) show(current);
});

jcSetLang(jcLang());
paint();
jcHit("admin");
jcState().then(function(s){
  state = s;
  if (s.status === "signed_out") { location.replace("../account/?next=" + encodeURIComponent("../admin/")); return; }
  if (s.status === "not_member") { location.replace("../account/?view=join&next=" + encodeURIComponent("../admin/")); return; }
  scopes = s.me.admin_scopes || [];
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (isOrganizer()) return loadHome();
    show("lock");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
