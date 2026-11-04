/* Events page — UC-C1 browse & sign up, UC-C2 archive stats (wireframe v4.1 bands
   05 + 07). Views: list · detail (tabs: Map · List · My home) · stats.
   ?id=<event uuid>[&tab=map|list|mine] → detail (archived events → stats);
   ?id=…&view=stats → stats.
   CONTRACT (plan premortem #1): jc_event_signup REPLACES the home's payload + note,
   so the form always sends the full set, prefilled from `mine`.
   The event uses the HOME's pin — there is no per-event pin to set here. A home with
   no pin is sent to the pin screen and straight back to this tab (T5.2 plan Q4).
   Event-day live controls (giant switch, supply, crowd reports) are T5.2 PR 5. */

var params = new URLSearchParams(location.search);
var EVENT_ID = params.get("id");
if (EVENT_ID && !/^[0-9a-f-]{36}$/i.test(EVENT_ID)) EVENT_ID = null;
var TABS = ["map", "list", "mine"];

var state = null, cfg = null, current = null, map = null;
var data = null;          /* last jc_event_get */
var tab = TABS.indexOf(params.get("tab")) >= 0 ? params.get("tab") : "map";
var editing = false;      /* My home tab: the sign-up form is open */

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
/* Usable coordinates only (T5.1 review): anything else is "not on the map yet". */
function hasPos(e){ return !!e && Number.isFinite(e.lat) && Number.isFinite(e.lng); }
function eventUrl(t){ return "../events/?id=" + data.event.id + "&tab=" + t; }
/* the pin screen, coming back to this event's My home tab when the pin is saved */
function pinUrl4Me(){ return "../home/?view=pin&next=" + encodeURIComponent(eventUrl("mine")); }
function goPin(){ location.href = pinUrl4Me(); }
/* The community's WhatsApp group (config links.whatsapp). Config is admin data, but a
   link must still be a real WhatsApp address — never javascript:/data:/elsewhere. */
function whatsappUrl(){
  var u = cfg && cfg.links && cfg.links.whatsapp;
  return (typeof u === "string" && /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/[A-Za-z0-9_\/+-]+$/.test(u)) ? u : null;
}

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

  /* Halloween-site layout: the event header, then tabs. My home holds everything about
     MY home's sign-up — no map there: the event uses the home's pin. */
  detail: function(){
    var ev = data.event, entries = data.entries || [];
    el("view").innerHTML =
      '<div class="links" style="margin:0 0 10px"><a href="./">‹ ' + esc(jcT("ev_back")) + '</a></div>' +
      '<div class="evhead"><h1>' + esc(title(ev)) + '</h1>' +
        '<p class="sub">' + esc([fmtDate(ev.starts_at), jcT(ev.signups_open ? "ev_open" : "ev_closed"),
                                 jcFmt("ev_homes_in", { n: entries.length })].join(" · ")) + '</p>' +
        (desc(ev) ? '<p>' + esc(desc(ev)) + '</p>' : '') + '</div>' +
      '<div class="evtabs" role="tablist">' + TABS.map(function(t){
        return '<button type="button" role="tab" id="tab-' + t + '" aria-selected="' + (tab === t) + '">' +
          esc(jcT("ev_tab_" + t)) + '</button>';
      }).join("") + '</div>' +
      msgBox() +
      '<div id="body"></div>';
    TABS.forEach(function(t){
      on("tab-" + t, function(){
        tab = t; editing = false;
        try { history.replaceState(null, "", "?id=" + ev.id + "&tab=" + t); } catch(e){}
        show("detail");
      });
    });
    if (tab === "map") renderMap(entries);
    else if (tab === "list") renderList(entries, "");
    else if (editing) renderForm();
    else renderMine();
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

/* ---------- My home tab: my sign-up, or the form ---------- */
function renderMine(){
  var ev = data.event, mine = data.mine, h = myHome();
  var isIn = mine && mine.status === "in";
  var html = "";
  /* the organizers' note to MY home (Halloween parity: "your pin looks misplaced…") */
  if (mine && mine.org_note) {
    html += '<div class="orgnote" role="note"><b>' + esc(jcT("ev_org_note")) + '</b><p>' + esc(mine.org_note) + '</p></div>';
  }
  if (!h) {
    html += '<p class="help">' + esc(jcT("ev_no_home")) + '</p><a class="btn" href="../home/">' + esc(jcT("ev_claim")) + '</a>';
  } else if (isIn) {
    var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
    var rows = Object.keys(fields).filter(function(k){ return mine.payload && mine.payload[k] !== undefined; }).map(function(k){
      var v = mine.payload[k];
      return '<li><span>' + esc(fieldLabel(k, fields[k])) + '</span><b>' +
        esc(fields[k].type === "text" ? String(v) : valueLabel(fields[k], v)) + '</b></li>';
    });
    html += '<p class="status ok">' + esc(jcFmt("ev_signed_up", { h: myLabel() })) + '</p>' +
      (rows.length ? '<ul class="answers">' + rows.join("") + '</ul>' : '') +
      (mine.note ? '<p class="mynote">' + esc(mine.note) + '</p>' : '') +
      pinLine(h) +
      (ev.signups_open ? '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_update_btn", { h: myLabel() })) + '</button>' : '') +
      '<button class="btn ghost" type="button" id="withdraw">' + esc(jcFmt("ev_withdraw", { h: myLabel() })) + '</button>';
  } else if (!ev.signups_open) {
    html += '<p class="help">' + esc(jcT("err_SIGNUPS_CLOSED")) + '</p>';
  } else if (!hasPos(h)) {
    /* no pin → the pin screen, then straight back here (never a refusal) */
    html += '<p class="help">' + esc(jcFmt("ev_pin_first", { h: myLabel() })) + '</p>' +
      '<a class="btn" id="toPin" href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_first_btn")) + '</a>';
  } else {
    html += pinLine(h) +
      '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_signup_btn", { h: myLabel() })) + '</button>';
  }
  var wa = whatsappUrl();
  if (wa) html += '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(wa) + '">' + esc(jcT("ev_whatsapp")) + '</a>';
  el("body").innerHTML = '<div class="cta" id="cta">' + html + '</div>';
  on("toSignup", function(){
    if (!hasPos(myHome())) return goPin();
    editing = true; show("detail");
  });
  on("withdraw", function(){
    if (!window.confirm(jcFmt("ev_withdraw_confirm", { h: myLabel() }))) return;
    busy("withdraw", true);
    rpc("jc_entry_withdraw", { p_event: ev.id }).then(function(d){
      data = d; show("detail"); showOk(jcFmt("ev_withdrawn", { h: myLabel() }));
    }, function(e){ busy("withdraw", false); showErr(e.code); });
  });
}

/* "📍 Villa 12's pin is on the map — Change": the home's pin, edited on My Home */
function pinLine(h){
  return hasPos(h)
    ? '<p class="help pinline">' + esc(jcFmt("ev_pin_line", { h: myLabel() })) + ' <a href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_change")) + '</a></p>'
    : '<p class="help pinline">' + esc(jcT("ev_no_pin_nudge")) + ' <a href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_it")) + '</a></p>';
}

function renderForm(){
  var ev = data.event, mine = data.mine || {};
  var prev = mine.status === "in" ? (mine.payload || {}) : {};
  var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
  var chosen = {};
  Object.keys(prev).forEach(function(k){ chosen[k] = prev[k]; });
  var html = '<h2 class="formtitle">' + esc(jcFmt(mine.status === "in" ? "ev_update_btn" : "ev_signup_btn", { h: myLabel() })) + '</h2>' +
    '<form class="panel" id="form" novalidate>';
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
    '<p class="help">' + esc(jcT("ev_note_help")) + '</p>' +
    '<button class="btn" id="go" type="submit">' + esc(jcT("ev_save")) + '</button>' +
    '<button class="btn ghost" id="cancel" type="button">' + esc(jcT("ev_cancel")) + '</button></form>';
  el("body").innerHTML = html;
  /* no selectors built from schema keys (T5.1 review): match on dataset values instead */
  var texts = Array.prototype.slice.call(document.querySelectorAll("#form [data-text]"));
  var opts = Array.prototype.slice.call(document.querySelectorAll("#form [data-field]"));
  texts.forEach(function(i){
    i.value = i.defaultValue = prev[i.dataset.text] != null ? String(prev[i.dataset.text]) : "";
  });
  el("note").value = el("note").defaultValue = mine.status === "in" ? (mine.note || "") : "";
  opts.forEach(function(b){
    b.addEventListener("click", function(){
      var k = b.dataset.field;
      chosen[k] = JSON.parse(b.dataset.value);
      opts.forEach(function(x){ if (x.dataset.field === k) x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  on("cancel", function(){ editing = false; show("detail"); });
  el("form").addEventListener("submit", function(ev2){
    ev2.preventDefault();
    /* the FULL payload — every answer + the note — never a partial update */
    var payload = {}, missing = false;
    Object.keys(fields).forEach(function(k){
      var spec = fields[k] || {};
      if (spec.type === "text") {
        var input = texts.filter(function(i){ return i.dataset.text === k; })[0];
        var t = input ? input.value.trim() : "";
        if (t) payload[k] = t;
      } else if (chosen[k] !== undefined) {
        payload[k] = chosen[k];
      }
      if (spec.required && payload[k] === undefined) missing = true;
    });
    if (missing) return showErr("PAYLOAD_INCOMPLETE");
    var note = el("note").value.trim();
    if (note) payload.note = note;
    busy("go", true);
    rpc("jc_event_signup", { p_event: ev.id, p_payload: payload }).then(function(d){
      data = d; editing = false; show("detail"); showOk(jcFmt("ev_signed_up", { h: myLabel() }));
    }, function(e){
      if (e.code === "NO_PIN") return goPin();   /* server safety net (T5.2 PR 3): same redirect */
      busy("go", false); showErr(e.code);
    });
  });
}

/* ---------- map + list (Halloween-site parity, plan audit 2026-11-03) ---------- */
var TILES = {
  sat: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
         opts: { maxNativeZoom: 19, maxZoom: 20, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" } },
  street: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            /* OSM blocks tile requests with no Referer (403 "Access blocked"). The page is
               no-referrer (tokens in URLs), so this layer alone sends the bare origin. */
            opts: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", referrerPolicy: "strict-origin" } }
};
var layer = "sat";
var listSort = "number";   /* number | distance */
/* The visitor's own position — held in memory only, never sent or stored. Used for
   "≈ 120 m from you" and sort-by-distance, exactly as the Halloween site did. */
var userPos = null;

function locate(done){
  if (!navigator.geolocation) return showErr("LOCATE_FAILED");
  navigator.geolocation.getCurrentPosition(function(p){
    userPos = L.latLng(p.coords.latitude, p.coords.longitude);
    done();
  }, function(err){ showErr(err && err.code === 1 ? "LOCATE_DENIED" : "LOCATE_FAILED"); },
  { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function dist(e){ return userPos && hasPos(e) ? userPos.distanceTo(L.latLng(e.lat, e.lng)) : null; }
function fmtDist(m){ return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km"; }
/* house-number order: building, then the number's digits numerically (9 before 10), then the rest */
function byNumber(a, b){
  var ba = String(a.building || ""), bb = String(b.building || "");
  if (ba !== bb) return ba.localeCompare(bb, "en", { numeric: true });
  return String(a.number).localeCompare(String(b.number), "en", { numeric: true, sensitivity: "base" });
}
function directionsUrl(e){
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(e.lat + "," + e.lng) + "&travelmode=walking";
}
function pinUrl(e){ return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(e.lat + "," + e.lng); }
function answers(e){
  var bits = [];
  Object.keys(e.payload || {}).forEach(function(k){
    var spec = ((data.event.payload_schema || {}).fields || {})[k];
    if (spec && spec.type !== "text") bits.push(valueLabel(spec, e.payload[k]));
  });
  return bits;
}
/* Popup = HTML, so EVERYTHING resident-typed is escaped (numbers, buildings, notes). */
function popupHtml(e){
  var d = dist(e);
  return '<div class="pop"><b>' + esc(jcHomeLabel(e)) + '</b><div class="meta">' + esc(jcVillageName(cfg, e.village)) + '</div>' +
    (answers(e).length ? '<div>' + esc(answers(e).join(" · ")) + '</div>' : '') +
    (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
    (d !== null ? '<div class="meta">' + esc(jcFmt("ev_dist_from_you", { d: fmtDist(d) })) + '</div>' : '') +
    '<div class="popacts"><a target="_blank" rel="noopener" href="' + esc(directionsUrl(e)) + '">' + esc(jcT("ev_directions")) + '</a>' +
    '<a target="_blank" rel="noopener" href="' + esc(pinUrl(e)) + '">' + esc(jcT("ev_view_pin")) + '</a></div></div>';
}

function renderMap(entries){
  var unpinned = entries.filter(function(e){ return !hasPos(e); }).length;
  el("body").innerHTML =
    '<div class="evmapwrap"><div class="evmap" id="map"></div>' +
      '<button type="button" class="lang maplayer" id="layerBtn">' + esc(jcT(layer === "sat" ? "pin_street" : "pin_sat")) + '</button>' +
      '<button type="button" class="lang maplocate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button></div>' +
    (unpinned ? '<p class="help" style="margin-top:8px">' + esc(unpinned) + ' · ' + esc(jcT("ev_unpinned")) +
      ' — <a href="#" id="seeList">' + esc(jcT("ev_list")) + '</a></p>' : '');
  on("seeList", function(e){ e.preventDefault(); el("tab-list").click(); });
  var c = (cfg && cfg.map) || {};
  map = L.map("map", { zoomControl: true }).setView([c.lat || 24.53, c.lng || 54.43], c.zoom || 14);
  var tiles = L.tileLayer(TILES[layer].url, TILES[layer].opts).addTo(map);
  on("layerBtn", function(){
    layer = layer === "sat" ? "street" : "sat";
    map.removeLayer(tiles);
    tiles = L.tileLayer(TILES[layer].url, TILES[layer].opts).addTo(map);
    el("layerBtn").textContent = jcT(layer === "sat" ? "pin_street" : "pin_sat");
  });
  var styles = getComputedStyle(document.documentElement);
  var accent = styles.getPropertyValue("--jc-accent").trim() || "#3e9b76";
  var ink = styles.getPropertyValue("--jc-ink").trim() || "#f6f2e9";
  var markers = [], pts = [], me = null;
  entries.forEach(function(e){
    if (!hasPos(e)) return;
    pts.push([e.lat, e.lng]);
    var m = L.circleMarker([e.lat, e.lng], {
      radius: e.mine ? 10 : 7, weight: e.mine ? 3 : 2, color: e.mine ? ink : accent, fillColor: accent, fillOpacity: .85
    }).addTo(map).bindPopup(function(){ return popupHtml(e); });   /* rebuilt on open: distance stays current */
    markers.push(m);
  });
  on("locateBtn", function(){
    locate(function(){
      if (!map) return;
      if (me) me.setLatLng(userPos);
      else me = L.circleMarker(userPos, { radius: 6, weight: 3, color: "#fff", fillColor: "#3a86ff", fillOpacity: 1 }).addTo(map);
      map.setView(userPos, Math.max(map.getZoom(), 17));
    });
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
  else if (pts.length === 1) map.setView(pts[0], 18);
}

function renderList(entries, q){
  el("body").innerHTML =
    '<label class="field"><input type="text" id="q" placeholder="' + esc(jcT("ev_search")) + '" autocomplete="off"></label>' +
    '<div class="seg2" role="group">' +
      '<button type="button" id="sortNum" aria-pressed="' + (listSort === "number") + '">' + esc(jcT("ev_sort_number")) + '</button>' +
      '<button type="button" id="sortDist" aria-pressed="' + (listSort === "distance") + '">' + esc(jcT("ev_sort_distance")) + '</button></div>' +
    '<div id="groups"></div>';
  var input = el("q");
  input.value = input.defaultValue = q || "";
  on("sortNum", function(){ listSort = "number"; renderList(entries, input.value); });
  on("sortDist", function(){ locate(function(){ listSort = "distance"; renderList(entries, input.value); }); });
  function draw(){
    var needle = input.value.trim().toLowerCase();
    var groups = {};
    entries.forEach(function(e){
      var label = jcHomeLabel(e);
      if (needle && label.toLowerCase().indexOf(needle) === -1 && String(e.number).toLowerCase().indexOf(needle) === -1) return;
      (groups[e.village] = groups[e.village] || []).push(e);
    });
    var byDist = listSort === "distance" && userPos;
    function nearest(v){ return Math.min.apply(null, groups[v].map(function(e){ var d = dist(e); return d === null ? Infinity : d; })); }
    var villages = Object.keys(groups).sort(function(a, b){
      return byDist ? nearest(a) - nearest(b) : jcVillageName(cfg, a).localeCompare(jcVillageName(cfg, b));
    });
    el("groups").innerHTML = villages.map(function(v){
      var list = groups[v].slice().sort(byDist
        ? function(a, b){ var da = dist(a), db = dist(b); return (da === null ? Infinity : da) - (db === null ? Infinity : db); }
        : byNumber);
      return '<h2 class="group">' + esc(jcVillageName(cfg, v)) + ' · ' + esc(list.length) + '</h2><ul class="entries">' + list.map(function(e){
        var bits = answers(e);
        if (!hasPos(e)) bits.push(jcT("ev_unpinned"));
        var d = dist(e);
        return '<li class="' + (e.mine ? "mine" : "") + '"><b>' + esc(jcHomeLabel(e)) + '</b>' +
          (e.mine ? ' <span class="meta">· ' + esc(jcT("ev_mine")) + '</span>' : '') +
          (d !== null ? ' <span class="meta">· ' + esc(fmtDist(d)) + '</span>' : '') +
          (bits.length ? '<div class="meta">' + esc(bits.join(" · ")) + '</div>' : '') +
          (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
          (hasPos(e) ? '<div class="popacts"><a target="_blank" rel="noopener" href="' + esc(directionsUrl(e)) + '">' +
            esc(jcT("ev_directions")) + '</a></div>' : '') + '</li>';
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
  if (editing) return;                     /* don't throw away a half-filled form */
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
