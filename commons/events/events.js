/* Events page — UC-C1 browse & sign up, UC-C2 archive stats (wireframe v4.1 bands
   05 + 07). Views: list · detail (map/list) · signup · stats.
   ?id=<event uuid> → detail (archived events → stats); ?id=…&view=stats → stats.
   CONTRACT (plan premortem #1): jc_event_signup REPLACES the home's payload + note,
   so the form always sends the full set, prefilled from `mine`. Event-day live
   controls (giant switch, supply, crowd reports) are T5.2. */

var params = new URLSearchParams(location.search);
var EVENT_ID = params.get("id");
if (EVENT_ID && !/^[0-9a-f-]{36}$/i.test(EVENT_ID)) EVENT_ID = null;

var state = null, cfg = null, current = null, map = null;
var data = null;          /* last jc_event_get */
var mode = "map";         /* detail: map | list */

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
function desc(ev){ return ar() && ev.description_ar ? ev.description_ar : (ev.description_en || ""); }
function myHome(){ return state && state.me && state.me.home; }
function myLabel(){ return jcHomeLabel(myHome()); }
function fmtDate(iso){
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(ar() ? "ar-AE-u-nu-latn" : "en-GB",
    { day: "numeric", month: "short", timeZone: (cfg && cfg.tz) || "Asia/Dubai" });
}
/* "non_food" → "Non food"; a schema may carry per-language labels:
   {label_en, label_ar, labels_en: {value: label}, labels_ar: {…}} */
function human(s){ s = String(s).replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
function fieldLabel(key, spec){ return (spec && (spec["label_" + jcLang()] || spec.label_en)) || human(key); }
function valueLabel(spec, v){
  var m = spec && (spec["labels_" + jcLang()] || spec.labels_en);
  if (typeof v === "boolean") return jcT(v ? "ev_yes" : "ev_no");
  if (spec && spec.type === "bool" && (v === "true" || v === "false")) return jcT(v === "true" ? "ev_yes" : "ev_no");  /* stats keys are strings */
  return (m && m[v]) || human(v);
}
function goList(){ location.href = "./"; }

function show(name){
  if (map) { map.remove(); map = null; }
  current = name;
  VIEWS[name]();
}

/* ---------- views ---------- */
var VIEWS = {
  list: function(){
    el("view").innerHTML = '<h1>' + esc(jcT("ev_title")) + '</h1><p class="sub">' + esc(jcT("ev_sub")) + '</p>' +
      msgBox() + '<div id="lists"><p class="sub">' + esc(jcT("working")) + '</p></div>';
    rpc("jc_events_list").then(function(evs){
      var live = evs.filter(function(e){ return e.status === "live"; });
      var past = evs.filter(function(e){ return e.status === "archived"; });
      function row(e){
        var pill = e.status === "archived" ? '<span class="pill">' + esc(jcT("ev_archived")) + '</span>'
          : e.signups_open ? '<span class="pill open">' + esc(jcT("ev_open")) + '</span>'
          : '<span class="pill">' + esc(jcT("ev_closed")) + '</span>';
        var line = [fmtDate(e.starts_at), jcFmt("ev_homes_in", { n: e.homes_in || 0 })];
        if (e.status === "archived") line.push(jcT("ev_see_numbers"));
        if (e.my_status === "in") line.push(jcT("ev_mine"));
        return '<li><a href="?id=' + esc(e.id) + '" data-event="' + esc(e.slug) + '"><span><b>' + esc(title(e)) + '</b>' +
          '<small>' + esc(line.filter(Boolean).join(" · ")) + '</small></span>' + pill + '</a></li>';
      }
      el("lists").innerHTML =
        (live.length ? '<ul class="evlist">' + live.map(row).join("") + '</ul>'
                     : '<p class="sub">' + esc(jcT("ev_none")) + '</p>') +
        (past.length ? '<h2 class="group">' + esc(jcT("ev_past")) + '</h2><ul class="evlist">' + past.map(row).join("") + '</ul>' : '');
    }, function(e){
      el("lists").innerHTML = "";
      showErr(e.code);
    });
  },

  detail: function(){
    var ev = data.event, mine = data.mine, entries = data.entries || [];
    var h = myHome();
    var isIn = mine && mine.status === "in";
    el("view").innerHTML =
      '<div class="links" style="margin:0 0 10px"><a href="./">‹ ' + esc(jcT("ev_back")) + '</a></div>' +
      '<div class="evhead"><h1>' + esc(title(ev)) + '</h1>' +
        '<p class="sub">' + esc([fmtDate(ev.starts_at), jcT(ev.signups_open ? "ev_open" : "ev_closed"),
                                 jcFmt("ev_homes_in", { n: entries.length })].join(" · ")) + '</p>' +
        (desc(ev) ? '<p>' + esc(desc(ev)) + '</p>' : '') + '</div>' +
      msgBox() +
      '<div class="cta" id="cta"></div>' +
      '<div class="seg2" role="group">' +
        '<button type="button" id="modeMap" aria-pressed="' + (mode === "map") + '">' + esc(jcT("ev_map")) + '</button>' +
        '<button type="button" id="modeList" aria-pressed="' + (mode === "list") + '">' + esc(jcT("ev_list")) + '</button></div>' +
      '<div id="body"></div>';

    /* the call to action for MY home */
    var cta = "";
    if (!h) {
      cta = '<p class="help">' + esc(jcT("ev_no_home")) + '</p><a class="btn" href="../home/">' + esc(jcT("ev_claim")) + '</a>';
    } else if (isIn) {
      cta = '<p class="status ok">' + esc(jcFmt("ev_signed_up", { h: myLabel() })) + '</p>' +
        (ev.signups_open ? '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_update_btn", { h: myLabel() })) + '</button>' : '') +
        '<button class="btn ghost" type="button" id="withdraw">' + esc(jcFmt("ev_withdraw", { h: myLabel() })) + '</button>' +
        (h.lat == null ? '<p class="help">' + esc(jcT("ev_no_pin_nudge")) + ' <a href="../home/?view=pin">' + esc(jcT("ev_pin_it")) + '</a></p>' : '');
    } else if (ev.signups_open) {
      cta = '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_signup_btn", { h: myLabel() })) + '</button>';
    } else {
      cta = '<p class="help">' + esc(jcT("err_SIGNUPS_CLOSED")) + '</p>';
    }
    el("cta").innerHTML = cta;
    on("toSignup", function(){ show("signup"); });
    on("withdraw", function(){
      if (!window.confirm(jcFmt("ev_withdraw_confirm", { h: myLabel() }))) return;
      busy("withdraw", true);
      rpc("jc_entry_withdraw", { p_event: ev.id }).then(function(d){
        data = d; show("detail"); showOk(jcFmt("ev_withdrawn", { h: myLabel() }));
      }, function(e){ busy("withdraw", false); showErr(e.code); });
    });
    on("modeMap", function(){ mode = "map"; show("detail"); });
    on("modeList", function(){ mode = "list"; show("detail"); });

    if (mode === "map") renderMap(entries); else renderList(entries, "");
  },

  signup: function(){
    var ev = data.event, mine = data.mine || {};
    var prev = mine.status === "in" ? (mine.payload || {}) : {};
    var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
    var chosen = {};
    Object.keys(prev).forEach(function(k){ chosen[k] = prev[k]; });
    var html = '<h1>' + esc(jcFmt(mine.status === "in" ? "ev_update_btn" : "ev_signup_btn", { h: myLabel() })) + '</h1>' +
      '<p class="sub">' + esc(title(ev)) + '</p><form class="panel" id="form" novalidate>';
    Object.keys(fields).forEach(function(k){
      var spec = fields[k] || {};
      var lab = '<legend>' + esc(fieldLabel(k, spec)) + (spec.required ? ' <span class="req">(' + esc(jcT("ev_required")) + ')</span>' : '') + '</legend>';
      if (spec.type === "enum" || spec.type === "bool") {
        var vals = spec.type === "bool" ? [true, false] : (spec.values || []);
        html += '<fieldset class="field">' + lab + '<div class="opts">' + vals.map(function(v){
          return '<button type="button" data-field="' + esc(k) + '" data-value="' + esc(JSON.stringify(v)) + '" aria-pressed="' +
            (chosen[k] === v) + '">' + esc(valueLabel(spec, v)) + '</button>';
        }).join("") + '</div></fieldset>';
      } else {
        html += '<label class="field">' + esc(fieldLabel(k, spec)) +
          (spec.required ? ' <span class="req">(' + esc(jcT("ev_required")) + ')</span>' : '') +
          '<input type="text" data-text="' + esc(k) + '" maxlength="' + esc(spec.max || 200) + '"></label>';
      }
    });
    html += '<label class="field">' + esc(jcT("ev_note")) + '<textarea id="note" maxlength="280"></textarea></label>' +
      '<p class="help">' + esc(jcT("ev_note_help")) + '</p>' + msgBox() +
      '<button class="btn" id="go" type="submit">' + esc(jcT("ev_save")) + '</button>' +
      '<button class="btn ghost" id="cancel" type="button">' + esc(jcT("ev_cancel")) + '</button></form>';
    el("view").innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll("[data-text]"), function(i){
      i.value = i.defaultValue = prev[i.dataset.text] != null ? String(prev[i.dataset.text]) : "";
    });
    el("note").value = el("note").defaultValue = mine.status === "in" ? (mine.note || "") : "";
    Array.prototype.forEach.call(document.querySelectorAll("[data-field]"), function(b){
      b.addEventListener("click", function(){
        var k = b.dataset.field;
        chosen[k] = JSON.parse(b.dataset.value);
        Array.prototype.forEach.call(document.querySelectorAll('[data-field="' + k + '"]'), function(x){
          x.setAttribute("aria-pressed", String(x === b));
        });
      });
    });
    on("cancel", function(){ show("detail"); });
    el("form").addEventListener("submit", function(ev2){
      ev2.preventDefault();
      /* the FULL payload — every answer + the note — never a partial update */
      var payload = {};
      Object.keys(fields).forEach(function(k){
        var spec = fields[k] || {};
        if (spec.type === "text") {
          var t = document.querySelector('[data-text="' + k + '"]').value.trim();
          if (t) payload[k] = t;
        } else if (chosen[k] !== undefined) {
          payload[k] = chosen[k];
        }
        if (spec.required && payload[k] === undefined) payload.__missing = true;
      });
      if (payload.__missing) return showErr("PAYLOAD_INCOMPLETE");
      var note = el("note").value.trim();
      if (note) payload.note = note;
      busy("go", true);
      rpc("jc_event_signup", { p_event: ev.id, p_payload: payload }).then(function(d){
        data = d; show("detail"); showOk(jcFmt("ev_signed_up", { h: myLabel() }));
      }, function(e){ busy("go", false); showErr(e.code); });
    });
  },

  stats: function(){
    var ev = data.event, st = data.stats || {};
    var byVillage = st.by_village || {}, byType = st.by_type || {};
    var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
    function bars(obj, labelOf){
      var keys = Object.keys(obj).sort(function(a, b){ return obj[b] - obj[a]; });
      var max = Math.max.apply(null, keys.map(function(k){ return obj[k]; }).concat([1]));
      return '<div class="bars">' + keys.map(function(k){
        return '<div class="bar"><span>' + esc(labelOf(k)) + '</span><i style="width:' + Math.round(100 * obj[k] / max) + '%"></i><em>' +
          esc(obj[k]) + '</em></div>';
      }).join("") + '</div>';
    }
    var html = '<div class="links" style="margin:0 0 10px"><a href="./">‹ ' + esc(jcT("ev_back")) + '</a></div>' +
      '<h1>' + esc(title(ev)) + '</h1><p class="sub">' + esc(jcT("st_title")) +
        (ev.status === "archived" && ev.ends_at ? ' · ' + esc(fmtDate(ev.ends_at)) : '') + '</p>' + msgBox() +
      '<div class="big"><div><b>' + esc(st.homes || 0) + '</b><span>' + esc(jcT("st_homes")) + '</span></div>' +
        '<div><b>' + esc(Object.keys(byVillage).length) + '</b><span>' + esc(jcT("st_villages")) + '</span></div>' +
        '<div><b>' + esc(st.done || 0) + '</b><span>' + esc(jcT("st_done")) + '</span></div></div>' +
      '<h2 class="group">' + esc(jcT("st_by_village")) + '</h2>' + bars(byVillage, function(k){ return jcVillageName(cfg, k); }) +
      (Object.keys(byType).length ? '<h2 class="group">' + esc(jcT("st_by_type")) + '</h2>' +
        bars(byType, function(k){ return jcT("type_" + k); }) : '');
    Object.keys(st.payload || {}).forEach(function(k){
      html += '<h2 class="group">' + esc(fieldLabel(k, fields[k])) + '</h2>' +
        bars(st.payload[k], function(v){ return valueLabel(fields[k], v); });
    });
    if (st.legacy) html += '<p class="help">' + esc(jcT("st_baseline")) + '</p>';
    el("view").innerHTML = html;
  }
};

function renderMap(entries){
  el("body").innerHTML = '<div class="evmap" id="map"></div>' +
    (entries.some(function(e){ return e.lat == null; })
      ? '<p class="help" style="margin-top:8px">' + esc(entries.filter(function(e){ return e.lat == null; }).length) + ' · ' +
        esc(jcT("ev_unpinned")) + ' — <a href="#" id="seeList">' + esc(jcT("ev_list")) + '</a></p>' : '');
  on("seeList", function(e){ e.preventDefault(); mode = "list"; show("detail"); });
  var c = (cfg && cfg.map) || {};
  map = L.map("map", { zoomControl: true }).setView([c.lat || 24.53, c.lng || 54.43], c.zoom || 14);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxNativeZoom: 19, maxZoom: 20, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }).addTo(map);
  var styles = getComputedStyle(document.documentElement);
  var accent = styles.getPropertyValue("--jc-accent").trim() || "#3e9b76";
  var ink = styles.getPropertyValue("--jc-ink").trim() || "#f6f2e9";
  var pts = [];
  entries.forEach(function(e){
    if (e.lat == null) return;
    pts.push([e.lat, e.lng]);
    L.circleMarker([e.lat, e.lng], {
      radius: e.mine ? 10 : 7, weight: e.mine ? 3 : 2, color: e.mine ? ink : accent,
      fillColor: accent, fillOpacity: .85
    /* Leaflet renders tooltip STRINGS as HTML — house numbers / buildings are
       resident-typed, so escape (a 20-char building name can carry a tag) */
    }).addTo(map).bindTooltip(esc(jcHomeLabel(e) + " · " + jcVillageName(cfg, e.village)));
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
  else if (pts.length === 1) map.setView(pts[0], 18);
}

function renderList(entries, q){
  el("body").innerHTML = '<label class="field"><input type="text" id="q" placeholder="' + esc(jcT("ev_search")) + '" autocomplete="off"></label>' +
    '<div id="groups"></div>';
  var input = el("q");
  input.value = input.defaultValue = q || "";
  function draw(){
    var needle = input.value.trim().toLowerCase();
    var groups = {};
    entries.forEach(function(e){
      var label = jcHomeLabel(e);
      if (needle && label.toLowerCase().indexOf(needle) === -1 && String(e.number).toLowerCase().indexOf(needle) === -1) return;
      (groups[e.village] = groups[e.village] || []).push(e);
    });
    el("groups").innerHTML = Object.keys(groups).map(function(v){
      return '<h2 class="group">' + esc(jcVillageName(cfg, v)) + '</h2><ul class="entries">' + groups[v].map(function(e){
        var bits = [];
        Object.keys(e.payload || {}).forEach(function(k){
          var spec = ((data.event.payload_schema || {}).fields || {})[k];
          if (spec && spec.type !== "text") bits.push(valueLabel(spec, e.payload[k]));
        });
        if (e.lat == null) bits.push(jcT("ev_unpinned"));
        return '<li class="' + (e.mine ? "mine" : "") + '"><b>' + esc(jcHomeLabel(e)) + '</b>' +
          (e.mine ? ' <span class="meta">· ' + esc(jcT("ev_mine")) + '</span>' : '') +
          (bits.length ? '<div class="meta">' + esc(bits.join(" · ")) + '</div>' : '') +
          (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') + '</li>';
      }).join("") + '</ul>';
    }).join("");
  }
  input.addEventListener("input", draw);
  draw();
}

function loadEvent(){
  el("view").innerHTML = '<p class="sub">' + esc(jcT("working")) + '</p>' + msgBox();
  return rpc("jc_event_get", { p_event: EVENT_ID }).then(function(d){
    data = d;
    var wantStats = params.get("view") === "stats" || d.event.status === "archived";
    jcHit(wantStats ? "stats" : "events");
    show(wantStats ? "stats" : "detail");
  }, function(e){
    el("view").innerHTML = '<div class="links" style="margin:0 0 10px"><a href="./">‹ ' + esc(jcT("ev_back")) + '</a></div>' + msgBox();
    showErr(e.code);
  });
}

/* ---------- boot ---------- */
function paint(){
  var name = cfg ? (ar() ? (cfg.name_ar || cfg.name_en) : cfg.name_en) : jcT("brand");
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcT("ev_title") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "events", cfg);
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(ar() ? "en" : "ar");
  paint();
  if (current === "signup") return;        /* don't throw away a half-filled form */
  if (current) show(current);
});

jcSetLang(jcLang());
paint();
jcState().then(function(s){
  state = s;
  if (s.status === "signed_out") { location.replace("../account/?next=" + encodeURIComponent("../events/")); return; }
  if (s.status === "not_member") { location.replace("../account/?view=join&next=" + encodeURIComponent("../events/")); return; }
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (EVENT_ID) return loadEvent();
    jcHit("events");
    show("list");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
