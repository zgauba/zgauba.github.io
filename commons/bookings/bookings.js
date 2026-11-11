/* Courts page (R4c) — residents book a community court. Plan: docs/plans/R4c-residents-book.md.
   Views: list (My bookings + the courts, a small pin map) · court (?court=<uuid>: a day strip over the court's
   window, then the slots). Server: jc_facilities_list, jc_facility_day, jc_booking_book, jc_booking_cancel,
   jc_booking_privacy_set, jc_my_bookings (S3 + R4a).
   PRIVACY (R4a Q7): another home's booking shows its home label ONLY when the server sends one (it never does for a
   Private booking or a home hidden from the directory) — this page renders what arrives and nothing else. A booking
   always sends p_private true/false from the checkbox, never omitted (the server fails closed on null anyway).
   TIME: every day and time is the community's (cfg.tz, api.js jcTzToday / jcClock), never the phone's. */

var params = new URLSearchParams(location.search);
var COURT = params.get("court");
if (COURT && !/^[0-9a-f-]{36}$/i.test(COURT)) COURT = null;

var state = null, cfg = null, current = null, map = null;
var courts = null, mine = null, listErr = null, listLoading = false;
var day = null;          /* { f, date, slots [] | null, err, loading, pick: slot index | null, priv: bool } */
var bkBusy = false, daySeq = 0, listSeq = 0, mineSeq = 0;
var past = null, pastErr = null, pastLoading = false, pastSeq = 0;   /* R4d: My Bookings → Past (null = not read yet) */
var mineStale = false;    /* My bookings changed elsewhere and the re-read hasn't landed (code review M1) */
var deepLink = null;
/* Zee 2026-11-09: sub-tabs List · Map · My bookings (?tab=), the map like the event map (full screen, Find Me) */
var TABS = ["list", "map", "mine"];
var tab = TABS.indexOf(params.get("tab")) >= 0 ? params.get("tab") : "list";
var layer = "sat", mapFull = false, userPos = null;      /* ?court= waiting for the list (kept for Try Again, review L2) */

/* ---------- helpers ---------- */
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){ var m = el("msg"); if (!m) return; m.className = "msg err"; m.textContent = jcErrText({ code: code }); }
function showOk(text){
  var m = el("msg"); if (!m) return;
  m.className = "msg ok"; m.textContent = text;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });           /* a write far down the list (review M3) */
}
function bkMsg(code){
  var t = jcT("bk_err_" + code);
  if (t === "bk_err_" + code) return showErr(code);
  var m = el("msg"); if (!m) return;
  m.className = "msg err"; m.textContent = t;
  if (m.scrollIntoView) m.scrollIntoView({ block: "nearest" });
}
function on(id, fn){ var n = el(id); if (n) n.addEventListener("click", fn); }
function each(sel, fn, ev){
  Array.prototype.forEach.call(document.querySelectorAll(sel), function(b){ b.addEventListener(ev || "click", function(){ fn(b); }); });
}
function ar(){ return jcLang() === "ar"; }
function hObj(x){ return x && typeof x === "object" && !Array.isArray(x) ? x : null; }
function hasHome(){ return !!(state && state.me && state.me.home); }
function courtName(f){ return ar() && f.name_ar ? f.name_ar : (f.name_en || ""); }
function hm(t){ return typeof t === "string" ? t.slice(0, 5) : ""; }
function kindText(f){ return jcT("ct_kind_" + (f.kind === "basketball" ? "basketball" : "tennis")); }
function hasPos(f){ return !!f && Number.isFinite(f.lat) && Number.isFinite(f.lng); }
function moduleOn(){ var m = cfg && cfg.modules && cfg.modules.bookings; return !!(m && m.enabled === true); }
/* the household limits as the server reads them (jc_booking_quota / jc_booking_active_cap) */
function rule(k, dflt){
  var v = cfg && cfg.modules && cfg.modules.bookings && cfg.modules.bookings[k];
  return /^[1-9][0-9]?$/.test(String(v)) ? +v : dflt;
}
function slotsOf(a){
  return Array.isArray(a) ? a.filter(function(s){
    return hObj(s) && typeof s.starts_at === "string" && typeof s.ends_at === "string" && !isNaN(Date.parse(s.starts_at)) && !isNaN(Date.parse(s.ends_at));
  }) : null;
}
function over(s){ return Date.parse(s.ends_at) <= Date.now(); }
function when(b){ return jcDayText(jcDateOf(b.starts_at, cfg)) + " · ⁦" + jcClock(b.starts_at, cfg) + "–" + jcClock(b.ends_at, cfg) + "⁩"; }
function courtById(id){ return (courts || []).filter(function(f){ return f.id === id; })[0]; }
function setUrl(q){ try { history.replaceState(null, "", q ? "?" + q : location.pathname); } catch(e){} }

/* every write: one at a time; bkBusy always comes back down */
function bkWrite(b, call, done, fail){
  if (bkBusy) return;
  bkBusy = true; if (b) b.disabled = true;
  var view = current;
  Promise.resolve().then(call).then(function(d){
    bkBusy = false;
    if (current !== view) return;
    return done(d);
  }).catch(function(e){
    bkBusy = false; if (b) b.disabled = false;
    if (current !== view) return;
    var code = (e && e.code) || "UNKNOWN";
    if (code === "MODULE_OFF") return show("off");
    if (fail && fail(code) === true) return;
    bkMsg(code);
  });
}

/* ---------- data ---------- */
function loadList(then){
  var seq = ++listSeq;
  listLoading = true; listErr = null;
  Promise.all([rpc("jc_facilities_list"), rpc("jc_my_bookings")]).then(function(r){
    if (seq !== listSeq) return;
    listLoading = false;
    courts = Array.isArray(r[0]) ? r[0].filter(function(f){ return hObj(f) && typeof f.id === "string"; }) : [];
    mine = Array.isArray(r[1]) ? r[1].filter(function(b){ return hObj(b) && typeof b.id === "string" && typeof b.starts_at === "string"; }) : [];
    mineStale = false;
    if (current === "list") show("list");
    if (then) then();
  }, function(e){
    if (seq !== listSeq) return;
    listLoading = false;
    if (e.code === "MODULE_OFF") return show("off");
    listErr = e.code || "UNKNOWN";
    if (current === "list") show("list");
  });
}
/* My bookings only (after a book / cancel / privacy change elsewhere) */
function setMine(d){
  if (!Array.isArray(d)) return;
  mineSeq++;                                         /* any later answer wins over an older re-read (review M1) */
  mine = d.filter(function(b){ return hObj(b) && typeof b.id === "string" && typeof b.starts_at === "string"; });
  mineStale = false;
}
/* after a booking: re-read My bookings; until it lands the list is re-read on the way back */
function refreshMine(){
  var seq = ++mineSeq;
  mineStale = true;
  rpc("jc_my_bookings").then(function(d){
    if (seq !== mineSeq) return;
    setMine(d);
    if (current === "list" && el("bkMineBox")) drawMine();   /* never rebuild the Map / List tab under the resident (review M) */
  }, function(){});
}
/* only the My bookings block: no map rebuild, no jump (review M3); focus back on what was used (M2) */
function drawMine(focusId){
  var box = el("bkMineBox");
  if (!box) return show("list");
  box.innerHTML = mineHtml();
  wireMine();
  var f = focusId && el(focusId);
  if (f) f.focus(); else if (focusId) { var h = el("bkMineHead"); if (h) h.focus(); }
}

function openCourt(f, date){
  day = { f: f, date: date || jcTzToday(cfg), slots: null, err: null, loading: false, pick: null, priv: false };
  setUrl("court=" + encodeURIComponent(f.id) + (tab === "list" ? "" : "&tab=" + tab));   /* a reload, then Back, keeps the tab */
  show("court");
}
function loadDay(then){
  var mine_ = day, seq = ++daySeq;
  mine_.slots = null; mine_.err = null; mine_.loading = true; mine_.pick = null;
  if (current === "court") draw();
  rpc("jc_facility_day", { p_facility: mine_.f.id, p_date: mine_.date }).then(function(d){
    if (day !== mine_ || seq !== daySeq) return;
    mine_.loading = false;
    var s = slotsOf(hObj(d) && d.slots);
    if (s) mine_.slots = s; else mine_.err = "UNKNOWN";
    if (current === "court") { draw(); if (then && s) then(); }
  }, function(e){
    if (day !== mine_ || seq !== daySeq) return;
    mine_.loading = false;
    if (current !== "court") return;
    var code = e.code || "UNKNOWN";
    if (code === "MODULE_OFF") return show("off");
    if (code === "OUT_OF_WINDOW" && mine_.date !== jcTzToday(cfg)) { mine_.date = jcTzToday(cfg); return loadDay(then); }  /* midnight passed (review L1) */
    if (code === "NOT_FOUND" || code === "WALK_ON" || code === "NO_HOME") return backToList(code);
    mine_.err = code; draw();
  });
}
function backToList(code){
  day = null; courts = null; setUrl(null);
  loadList(function(){ bkMsg(code); });              /* one load, not two (review L3) */
  show("list");
}
function openDeepLink(){
  if (!deepLink || current !== "list") return;
  var f = courtById(deepLink);
  deepLink = null;
  if (f && !f.walk_on) return openCourt(f);
  setUrl(null); bkMsg(f ? "WALK_ON" : "NOT_FOUND");   /* never a silent dead link (review L2) */
}
function draw(){ var r = jcFocusKeep(); VIEWS[current](); r(); }

/* ---------- views ---------- */
function show(name){
  current = name;
  if (map) { jcMapRemove(map); map = null; }
  jcBack(name === "court" ? function(){ if (bkBusy) return; day = null; setUrl(tab === "list" ? null : "tab=" + tab); show("list"); } : null, "back");
  if (name !== "list") { mapFull = false; document.body.classList.remove("mapfull"); }
  jcHelp(name === "court" ? "court" : name === "list" ? "courts" : null);   /* the ? button, as on Events / My Home / Organizer */
  var refocus = jcFocusKeep();
  VIEWS[name]();
  refocus();
}

function mineHtml(){
  if (!hasHome()) {
    return '<p class="notice" id="bkNoHome">' + esc(jcT("bk_no_home")) + '</p>' +
      '<div class="row"><a class="btn ghost" href="../home/">' + esc(jcT("bk_go_home")) + '</a></div>';
  }
  var rows = (mine || []).map(function(b){
    var name = ar() && b.facility_ar ? b.facility_ar : (b.facility || "");
    if (b.status !== "booked") {
      return '<li class="cancelled" data-bk="' + esc(b.id) + '"><b dir="auto">' + esc(name) + '</b>' +
        '<div class="meta">' + esc(when(b)) + '</div>' +
        '<div class="meta" dir="auto">' + esc(jcFmt("bk_cancelled_by_org", { r: b.cancel_reason || "" })) + '</div></li>';
    }
    var started = Date.parse(b.starts_at) <= Date.now();
    return '<li class="slot slot-mine s-mine" data-bk="' + esc(b.id) + '"><div class="head"><b dir="auto">' + esc(name) + '</b>' +
      (b.is_private === true ? '<span class="chip">' + esc(jcT("bk_private_chip")) + '</span>' : '') + '</div>' +
      '<div class="meta">' + esc(when(b)) + '</div>' +
      (started ? '' :
        '<div class="acts"><label class="check"><input type="checkbox" id="bkPriv-' + esc(b.id) + '" data-bkpriv="' + esc(b.id) + '"' + (b.is_private === true ? ' checked' : '') +
        ' aria-label="' + esc(jcT("bk_private") + " " + when(b)) + '"> <span>' + esc(jcT("bk_private")) + '</span></label>' +
        '<button class="mini danger" type="button" id="bkCancel-' + esc(b.id) + '" data-bkcancel="' + esc(b.id) + '" aria-label="' + esc(jcT("bk_cancel") + " " + when(b)) + '">' +
        esc(jcT("bk_cancel")) + '</button></div>') + '</li>';
  });
  return '<h2 class="group" id="bkMineHead" tabindex="-1">' + esc(jcT("bk_upcoming")) + '</h2>' +
    (rows.length ? '<ul class="bklist" id="bkMine">' + rows.join("") + '</ul>' : '<p class="help" id="bkMine">' + esc(jcT("bk_mine_none")) + '</p>');
}
/* R4d: Past — the home's ended bookings (made since you joined, last 90 days), read each time My Bookings opens.
   Its own request: a failure here never hides Upcoming. Only this block redraws when it lands. */
function loadPast(){
  var seq = ++pastSeq;
  pastLoading = true; pastErr = null;
  rpc("jc_my_bookings_past").then(function(d){
    if (seq !== pastSeq) return;
    pastLoading = false;
    past = Array.isArray(d) ? d.filter(function(b){ return hObj(b) && typeof b.id === "string" && typeof b.starts_at === "string" && typeof b.ends_at === "string"; }) : [];   /* review L3 */
    drawPast();
  }, function(e){
    if (seq !== pastSeq) return;
    pastLoading = false;
    if (e && e.code === "MODULE_OFF") return show("off");
    pastErr = (e && e.code) || "UNKNOWN";
    drawPast();
  });
}
function drawPast(){
  var box = el("bkPastBox");
  if (!box) return;
  box.innerHTML = pastHtml();
  on("bkPastRetry", function(){ loadPast(); drawPast(); var h = el("bkPastHead"); if (h) h.focus(); });   /* focus not lost (review L1) */
}
function pastHtml(){
  var h = '<h2 class="group" id="bkPastHead" tabindex="-1">' + esc(jcT("bk_past")) + '</h2>';
  if (pastErr) return h + '<p class="help">' + esc(jcT("bk_past_err")) + '</p>' +
    '<div class="row"><button class="btn ghost small" type="button" id="bkPastRetry">' + esc(jcT("adm_ad_retry")) + '</button></div>';
  if (!past) return h + '<p class="help">' + esc(jcT("working")) + '</p>';
  if (!past.length) return h + '<p class="help" id="bkPast">' + esc(jcT("bk_past_none")) + '</p>';
  return h + '<ul class="bklist" id="bkPast">' + past.map(function(b){
    var name = ar() && b.facility_ar ? b.facility_ar : (b.facility || "");
    var done = b.status === "booked";
    return '<li class="slot slot-past" data-past="' + esc(b.id) + '"><div class="head"><b dir="auto">' + esc(name) + '</b>' +
      '<span class="chip slotchip">' + esc(jcT(done ? "bk_done" : "bk_cancelled")) + '</span></div>' +
      '<div class="meta">' + esc(when(b)) + '</div>' +
      (done ? '' : '<div class="meta" dir="auto">' + esc(jcFmt("bk_cancelled_by_org", { r: b.cancel_reason || "" })) + '</div>') + '</li>';
  }).join("") + '</ul><p class="help">' + esc(jcT("bk_past_kept")) + '</p>';
}
/* courts admins (community / bookings scope): an Admin way into Organizer Tools, as on event cards */
function canAdmin(){
  var sc = (state && state.me && state.me.admin_scopes) || [];
  return sc.indexOf("community") >= 0 || sc.indexOf("bookings") >= 0;
}
function adminHref(f){ return "../admin/?tab=courts&court=" + encodeURIComponent(f.id); }
function courtCard(f){
  var meta = [kindText(f), "⁦" + hm(f.open_time) + "–" + hm(f.close_time) + "⁩"];
  return '<li data-court="' + esc(f.id) + '"><div class="evtop"><b dir="auto">' + esc(courtName(f)) + '</b>' +
    (canAdmin() ? '<a class="badge" href="' + adminHref(f) + '" aria-label="' + esc(jcT("ev_admin") + ": " + courtName(f)) + '">' + esc(jcT("ev_admin")) + '</a>' : '') + '</div>' +
    '<div class="meta">' + esc(meta.join(" · ")) + '</div>' +
    (f.location_note ? '<div class="meta" dir="auto">' + esc(f.location_note) + '</div>' : '') +
    (f.walk_on ? '<div class="meta">' + esc(jcT("bk_walk_on")) + '</div>'
      : '<div class="acts"><button class="btn small" type="button" data-open="' + esc(f.id) + '">' + esc(jcT("bk_see_times")) + '</button></div>') +
    '</li>';
}
/* ---------- the Map tab: like the event map (keep in step with events.js renderMap / setMapFull) ---------- */
function popHtml(f){
  return '<div class="pop"><b dir="auto">' + esc(courtName(f)) + '</b>' +
    '<div class="meta">' + esc(kindText(f) + " · ⁦" + hm(f.open_time) + "–" + hm(f.close_time) + "⁩") + '</div>' +
    (f.location_note ? '<div class="meta" dir="auto">' + esc(f.location_note) + '</div>' : '') +
    (f.walk_on ? '<div class="meta">' + esc(jcT("bk_walk_on")) + '</div>' : '') +
    '<div class="popacts">' + (f.walk_on ? '' : '<button class="mini" type="button" data-popopen="' + esc(f.id) + '">' + esc(jcT("bk_see_times")) + '</button>') +
    /* as on the event map */
    '<a target="_blank" rel="noopener" href="' + esc("https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(f.lat + "," + f.lng) + "&travelmode=walking") + '">' +
    esc(jcT("ev_directions")) + '</a></div></div>';
}
function fitMap(){
  var m = el("bkmap");
  if (!m) return;
  if (mapFull) { if (map) map.invalidateSize(); return; }
  var bar = el("tabbar") ? el("tabbar").getBoundingClientRect().height : 0;
  var top = m.getBoundingClientRect().top + window.scrollY;
  var h = Math.max(260, Math.floor(window.innerHeight - top - bar - 12));
  if (Math.abs(m.offsetHeight - h) < 2) return;
  m.style.height = h + "px";
  if (map) map.invalidateSize();
}
var fitTimer = null;
function fitSoon(){ clearTimeout(fitTimer); fitTimer = setTimeout(fitMap, 120); }
window.addEventListener("resize", fitSoon);
window.addEventListener("orientationchange", fitSoon);
function setMapFull(on){
  var w = document.querySelector(".evmapwrap"), b = el("fullBtn");
  mapFull = !!on && !!w;
  if (w) w.classList.toggle("full", mapFull);
  document.body.classList.toggle("mapfull", mapFull);
  if (b) { b.textContent = jcT(mapFull ? "ev_map_close" : "ev_map_full"); b.setAttribute("aria-pressed", String(mapFull)); }
  if (!mapFull) fitMap();
  requestAnimationFrame(function(){ if (map) map.invalidateSize(); });
}
document.addEventListener("keydown", function(e){ if (e.key === "Escape" && mapFull) setMapFull(false); });
function locate(done){
  if (!navigator.geolocation) return showErr("LOCATE_FAILED");
  navigator.geolocation.getCurrentPosition(function(p){ userPos = [p.coords.latitude, p.coords.longitude]; done(); },
    function(err){ setMapFull(false); showErr(err && err.code === 1 ? "LOCATE_DENIED" : "LOCATE_FAILED"); },   /* visible, not behind the full map */
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function mapHtml(pinned){
  if (typeof L === "undefined") return '<p class="help" id="bkNoPins">' + esc(jcT("err_NETWORK")) + '</p>';   /* no dead buttons (review L) */
  if (!pinned.length) return '<p class="help" id="bkNoPins">' + esc(jcT("bk_no_pins")) + '</p>';
  return '<div class="evmapwrap"><div class="evmap" id="bkmap" role="region" aria-label="' + esc(jcT("bk_map_label")) + '"></div>' +
    '<div class="mapbtns"><button type="button" class="lang" id="layerBtn">' + esc(jcT(layer === "sat" ? "pin_street" : "pin_sat")) + '</button></div>' +
    '<button type="button" class="lang maplocate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button>' +
    '<button type="button" class="lang mapfull" id="fullBtn" aria-pressed="false">' + esc(jcT("ev_map_full")) + '</button></div>';
}
function drawMap(list){
  mapFull = false; document.body.classList.remove("mapfull");
  if (typeof L === "undefined" || !el("bkmap")) return;
  fitMap();
  requestAnimationFrame(fitSoon);
  var c = (cfg && cfg.map) || {};
  map = L.map("bkmap", { zoomControl: true }).setView([c.lat || 24.53, c.lng || 54.43], c.zoom || 14);
  var tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(map);
  on("layerBtn", function(){
    layer = layer === "sat" ? "street" : "sat";
    map.removeLayer(tiles);
    tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(map);
    el("layerBtn").textContent = jcT(layer === "sat" ? "pin_street" : "pin_sat");
  });
  on("fullBtn", function(){ setMapFull(!mapFull); });
  var me = null;
  on("locateBtn", function(){
    locate(function(){
      if (!map) return;
      if (me) me.setLatLng(userPos);
      else me = L.circleMarker(userPos, { radius: 6, weight: 3, color: "#fff", fillColor: "#3a86ff", fillOpacity: 1 }).addTo(map);
      map.setView(userPos, Math.max(map.getZoom(), 17));
    });
  });
  var styles = getComputedStyle(document.documentElement);
  var accent = styles.getPropertyValue("--jc-accent").trim() || "#3e9b76";
  var ink = styles.getPropertyValue("--jc-ink").trim() || "#f6f2e9";
  var pts = [];
  list.forEach(function(f){
    pts.push([f.lat, f.lng]);
    /* the court's name sits on its pin (Zee); Leaflet sets string content as HTML, so admin text is escaped */
    L.circleMarker([f.lat, f.lng], { radius: 11, weight: 3, color: ink, fillColor: accent, fillOpacity: .95 }).addTo(map)
      .bindTooltip('<span dir="auto">' + esc(courtName(f)) + '</span>', { permanent: true, direction: "top", offset: [0, -12], className: "bklabel" })
      .bindPopup(popHtml(f), { maxWidth: 250, minWidth: 180, autoPanPaddingTopLeft: [12, 24], autoPanPaddingBottomRight: [12, 24] });
  });
  var wrap = document.querySelector(".evmapwrap");
  map.on("popupopen", function(pe){
    if (wrap) wrap.classList.add("popopen");
    var b = pe.popup.getElement() && pe.popup.getElement().querySelector("[data-popopen]");
    if (b) b.addEventListener("click", function(){ var f = courtById(b.dataset.popopen); if (f) { setMapFull(false); openCourt(f); } });
  });
  map.on("popupclose", function(){ if (wrap) wrap.classList.remove("popopen"); });
  if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 18 });
  else if (pts.length) map.setView(pts[0], 17);
}

var VIEWS = {
  off: function(){
    el("view").innerHTML = '<h1 dir="auto">' + esc(jcModTitle("bookings")) + '</h1><p class="notice" id="bkOff">' + esc(jcT("bk_off")) + '</p>';
  },

  list: function(){
    var html = '<h1 dir="auto">' + esc(jcModTitle("bookings")) + '</h1>' +
      '<p class="notice" id="bkPrecedence">' + esc(jcT("bk_precedence")) + '</p>' +
      jcTabsHtml("bktab-", TABS, tab, function(t){ return jcT("bk_tab_" + t); }, jcModName("bookings"), "bkBody") + msgBox();
    function wireTabs(){
      jcTabsWire("bktab-", TABS, function(t){
        if (t === "mine" && tab !== "mine") { past = null; pastErr = null; pastSeq++; pastLoading = false; }   /* fresh each visit */
        tab = t; setUrl(t === "list" ? null : "tab=" + t); show("list");
      });
    }
    if (listErr) {
      el("view").innerHTML = html + '<div ' + jcTabPanel("bktab-", tab, "bkBody") + '><div class="row"><button class="btn ghost" type="button" id="bkRetry">' +
        esc(jcT("adm_ad_retry")) + '</button></div></div>';
      showErr(listErr); wireTabs();
      return on("bkRetry", function(){ loadList(openDeepLink); show("list"); });
    }
    if (!courts || (mineStale && !listLoading)) {
      el("view").innerHTML = html + '<div ' + jcTabPanel("bktab-", tab, "bkBody") + '><p class="help" role="status">' + esc(jcT("working")) + '</p></div>';
      wireTabs();
      if (!listLoading) loadList();
      return;
    }
    var pinned = courts.filter(hasPos), body;
    if (tab === "map") body = mapHtml(pinned);
    else if (tab === "mine") body = '<div id="bkMineBox">' + mineHtml() + '</div>' + (hasHome() ? '<section id="bkPastBox" aria-live="polite">' + pastHtml() + '</section>' : '');
    else body = (hasHome() ? '' : '<p class="notice" id="bkNoHome">' + esc(jcT("bk_no_home")) + '</p>' +
                   '<div class="row"><a class="btn ghost" href="../home/">' + esc(jcT("bk_go_home")) + '</a></div>') +
                (courts.length ? '<ul class="bklist" id="bkCourts">' + courts.map(courtCard).join("") + '</ul>'
                               : '<p class="help" id="bkCourts">' + esc(jcT("bk_none")) + '</p>');
    el("view").innerHTML = html + '<div ' + jcTabPanel("bktab-", tab, "bkBody") + '>' + body + '</div>';
    wireTabs();
    if (tab === "map") drawMap(pinned);
    each("[data-open]", function(b){ var f = courtById(b.dataset.open); if (f) openCourt(f); });
    if (tab === "mine") { wireMine(); if (hasHome() && !past && !pastLoading && !pastErr) loadPast(); else drawPast(); }
  },

  court: function(){
    if (!day) return show("list");
    var f = day.f, today = jcTzToday(cfg), n = Math.min(Math.max(+f.window_days || 1, 1), 30);
    var days = [];
    for (var i = 0; i < n; i++) days.push(jcDateAdd(today, i));
    if (days.indexOf(day.date) < 0 && !day.loading) { day.date = today; day.slots = null; day.err = null; }   /* midnight passed on screen (review L1) */
    var html = '<div class="bkhead"><div class="evtitle"><h1 dir="auto">' + esc(courtName(f)) + '</h1>' +
      (canAdmin() ? '<a class="lang adminbtn" id="bkAdmin" href="' + adminHref(f) + '">' + esc(jcT("ev_admin")) + '</a>' : '') + '</div>' +
      '<p class="meta">' + esc(kindText(f) + " · ⁦" + hm(f.open_time) + "–" + hm(f.close_time) + "⁩") + '</p>' +
      (f.location_note ? '<p class="meta" dir="auto">' + esc(f.location_note) + '</p>' : '') + '</div>' +
      '<p class="notice">' + esc(jcT("bk_precedence")) + '</p>' +
      '<div class="strip" id="bkDays" role="group" aria-label="' + esc(jcT("bk_days")) + '">' + days.map(function(d){
        return '<button type="button" id="bkDay-' + d + '" data-day="' + d + '" aria-pressed="' + (d === day.date) + '" aria-label="' + esc(jcDayText(d, { weekday: "long", month: "long" })) + '">' +
          esc(jcDayText(d, { day: undefined, month: undefined })) + '<b>' + esc(String(+d.slice(8))) + '</b></button>';
      }).join("") + '</div>' + msgBox();
    if (day.err) {
      el("view").innerHTML = html + '<div class="row"><button class="btn ghost" type="button" id="bkDayRetry">' + esc(jcT("adm_ad_retry")) + '</button></div>';
      showErr(day.err);
      return wireCourt();
    }
    if (!day.slots) {
      el("view").innerHTML = html + '<p class="help" role="status">' + esc(jcT("working")) + '</p>';
      wireCourt();
      if (!day.loading) loadDay();
      return;
    }
    html += day.slots.length ? '<ul class="bklist" id="bkSlots">' + day.slots.map(slotRow).join("") + '</ul>'
                             : '<p class="help">' + esc(jcT("bk_day_none")) + '</p>';
    el("view").innerHTML = html;
    wireCourt();
  }
};

function slotRow(s, i){
  var st = s.state === "mine" || s.state === "booked" || s.state === "blocked" || s.state === "free" ? s.state : "past";
  if (st === "free" && Date.parse(s.starts_at) <= Date.now()) st = "past";    /* started: the server refuses a past start */
  var h = '<li class="slot slot-' + st + ' s-' + st + '" data-slot="' + i + '"><div class="head"><b class="time">⁦' + esc(jcClock(s.starts_at, cfg) + "–" + jcClock(s.ends_at, cfg)) + '⁩</b>' +
    '<span class="chip slotchip">' + esc(jcT("bk_st_" + st)) + '</span>' +
    (st === "mine" && s.is_private === true ? '<span class="chip">' + esc(jcT("bk_private_chip")) + '</span>' : '') + '</div>';
  /* another home: its label only if the server sent one (never for Private / hidden homes) */
  if (st === "booked" && hObj(s.home)) {
    var who = [jcHomeLabel(s.home), s.home.village ? jcVillageName(cfg, s.home.village) : ""].filter(Boolean).join(" · ");
    if (who) h += '<div class="meta" dir="auto">' + esc(who) + '</div>';
  }
  if (st === "blocked" && s.block_reason) h += '<div class="meta" dir="auto">' + esc(s.block_reason) + '</div>';
  if (st === "mine" && s.booking_id && Date.parse(s.starts_at) > Date.now()) {
    h += '<div class="acts"><label class="check"><input type="checkbox" id="bkPriv-' + esc(s.booking_id) + '" data-bkpriv="' + esc(s.booking_id) + '"' +
      (s.is_private === true ? ' checked' : '') + ' aria-label="' + esc(jcT("bk_private") + " " + jcClock(s.starts_at, cfg)) + '"> <span>' + esc(jcT("bk_private")) + '</span></label>' +
      '<button class="mini danger" type="button" id="bkCancel-' + esc(s.booking_id) + '" data-bkcancel="' + esc(s.booking_id) + '" aria-label="' +
      esc(jcT("bk_cancel") + " " + jcClock(s.starts_at, cfg)) + '">' + esc(jcT("bk_cancel")) + '</button></div>';
  }
  if (st === "free") {
    if (day.pick === i) {
      h += '<div class="sheet-in" id="bkSheet">' +
        '<p>' + esc(jcFmt("bk_confirm", { c: courtName(day.f), d: jcDayText(day.date), t: jcClock(s.starts_at, cfg) + "–" + jcClock(s.ends_at, cfg) })) + '</p>' +
        '<label class="check"><input type="checkbox" id="bkPrivate"' + (day.priv ? ' checked' : '') + (bkBusy ? ' disabled' : '') + '> <span>' + esc(jcT("bk_private")) + '</span></label>' +
        '<p class="help">' + esc(jcT("bk_private_help")) + '</p>' +
        '<p class="help">' + esc(jcFmt("bk_rules", { d: rule("per_home_per_day", 1), a: rule("per_home_active", 2) })) + '</p>' +
        '<div class="acts"><button class="btn small" type="button" id="bkGo"' + (bkBusy ? ' disabled' : '') + '>' + esc(jcT("bk_book_go")) + '</button>' +
        '<button class="btn ghost small" type="button" id="bkKeep">' + esc(jcT("ct_cancel")) + '</button></div></div>';
    } else if (hasHome()) {
      h += '<div class="acts"><button class="mini" type="button" id="bkBook-' + i + '" data-bkbook="' + i + '" aria-label="' +
        esc(jcT("bk_book") + " " + jcClock(s.starts_at, cfg)) + '">' + esc(jcT("bk_book")) + '</button></div>';
    }
  }
  return h + '</li>';
}

/* ---------- wiring ---------- */
function cancelBooking(b){
  if (!window.confirm(jcT("bk_confirm_cancel"))) return;
  var id = b.dataset.bkcancel, d0 = day;
  bkWrite(b, function(){ return rpc("jc_booking_cancel", { p_booking: id }); }, function(d){
    setMine(d);
    if (current === "court") { if (day === d0) loadDay(function(){ showOk(jcT("bk_done_cancel")); }); return; }   /* review L4 */
    drawMine("bkMineHead"); showOk(jcT("bk_done_cancel"));
  }, function(code){
    if (code !== "NOT_FOUND") return false;
    mineStale = true;
    if (current === "court") loadDay(function(){ bkMsg("CANCEL_GONE"); });
    else loadList(function(){ bkMsg("CANCEL_GONE"); });
    return true;
  });
}
function wireMine(){
  each("[data-bkcancel]", cancelBooking);
  each("[data-bkpriv]", privacyToggle, "change");
}
/* the Private switch: on My bookings and on my own slot in a court's day (Zee 2026-11-09) */
function privacyToggle(c){
    var want = c.checked;
    if (bkBusy) { c.checked = !want; return; }
    bkWrite(c, function(){ return rpc("jc_booking_privacy_set", { p_booking: c.dataset.bkpriv, p_private: want }); }, function(d){
      setMine(d);
      var fid = "bkPriv-" + c.dataset.bkpriv;
      if (current === "court" && day) {
        day.slots.forEach(function(s){ if (s.booking_id === c.dataset.bkpriv) s.is_private = want; });
        draw(); if (el(fid)) el(fid).focus();
      } else drawMine(fid);
      showOk(jcT(want ? "bk_done_private" : "bk_done_public"));
    }, function(code){
      c.checked = !want;
      if (code === "NOT_FOUND") {
        mineStale = true;                              /* My Bookings re-read on the way back (review L) */
        if (current === "court") loadDay(function(){ bkMsg("CANCEL_GONE"); });
        else loadList(function(){ bkMsg("CANCEL_GONE"); });
        return true;
      }
      return false;
    });
}
function wireCourt(){
  on("bkDayRetry", function(){ loadDay(); });
  each("[data-day]", function(b){
    if (bkBusy || b.dataset.day === day.date || !jcIsDate(b.dataset.day)) return;
    day.date = b.dataset.day; loadDay();
    var f = el("bkDay-" + day.date); if (f) f.focus();                                  /* review M2 */
  });
  each("[data-bkcancel]", cancelBooking);
  each("[data-bkpriv]", privacyToggle, "change");
  each("[data-bkbook]", function(b){
    if (bkBusy) return;
    day.pick = +b.dataset.bkbook; day.priv = false; draw();
    var p = el("bkPrivate"); if (p) p.focus();
  });
  on("bkKeep", function(){ var i = day.pick; day.pick = null; draw(); var b = document.querySelector('[data-bkbook="' + i + '"]'); if (b) b.focus(); });
  var p = el("bkPrivate");
  if (p) p.addEventListener("change", function(){ day.priv = p.checked; });
  on("bkGo", function(){
    var s = day.slots && day.slots[day.pick];
    if (!s) return;
    var priv = el("bkPrivate").checked === true, mine_ = day;
    el("bkPrivate").disabled = true;                   /* what's ticked is what's sent (review L5) */
    bkWrite(el("bkGo"), function(){
      return rpc("jc_booking_book", { p_facility: mine_.f.id, p_starts: s.starts_at, p_private: priv });
    }, function(r){
      if (day !== mine_) return;
      var sl = slotsOf(hObj(r) && r.day);
      day.pick = null;
      if (sl) { day.slots = sl; draw(); } else loadDay();
      showOk(jcT(priv ? "bk_done_book_private" : "bk_done_book"));
      refreshMine();
    }, function(code){
      if (code === "SLOT_TAKEN" || code === "SLOT_BLOCKED" || code === "OUT_OF_WINDOW" || code === "BAD_SLOT") {
        loadDay(function(){ bkMsg(code); }); return true;
      }
      if (code === "NOT_FOUND" || code === "WALK_ON" || code === "NO_HOME") { backToList(code); return true; }
      if (el("bkPrivate")) el("bkPrivate").disabled = false;
      return false;
    });
  });
}

/* ---------- boot ---------- */
function paint(){
  var name = jcCommunityName(cfg, state && state.me && state.me.community);
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcModTitle("bookings") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "bookings", cfg);
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(ar() ? "en" : "ar");
  paint();
  if (current) show(current);              /* an open booking sheet stays open (day.pick / day.priv) */
});

jcSetLang(jcLang());
paint();
jcState().then(function(s){
  state = s;
  var back = "../bookings/";
  if (s.status === "signed_out") { location.replace("../account/?next=" + encodeURIComponent(back)); return; }
  if (s.status === "not_member") { location.replace("../account/?view=join&next=" + encodeURIComponent(back)); return; }
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (cfg && !moduleOn()) return show("off");   /* the kill switch: nothing asked of the server */
    jcHit("bookings");
    current = "list";
    deepLink = COURT;
    loadList(openDeepLink);
    show("list");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
