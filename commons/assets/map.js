/* Shared map bits for every Commons page that draws a Leaflet map (home pin, events map,
   organizer venue pin). Load after leaflet.js, before the page script. */

var jcTiles = {
  sat: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
         opts: { maxNativeZoom: 19, maxZoom: 20, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" } },
  street: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            /* OSM blocks tile requests with no Referer (403 "Access blocked"). The page is
               no-referrer (tokens in URLs), so this layer alone sends the bare origin. */
            opts: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", referrerPolicy: "strict-origin" } }
};

/* ---------- the map kit (R5b-2a): one copy of what Events, Courts, the home pin and the organizer pin
   each repeated. Load after leaflet.js; the jcT / getElementById calls run later, at draw time. ---------- */

/* map colours from the tokens (pins take the accent; the "you are here" dot is --jc-me; warn / muted for
   state-coloured pins such as the Strays map — colour only for real states) */
function jcMapColors(){
  var s = getComputedStyle(document.documentElement);
  return { accent: s.getPropertyValue("--jc-accent").trim() || "#3e9b76",
           ink: s.getPropertyValue("--jc-ink").trim() || "#f6f2e9",
           me: s.getPropertyValue("--jc-me").trim() || "#3a86ff",
           warn: s.getPropertyValue("--jc-warn").trim() || "#f2b33c",
           muted: s.getPropertyValue("--jc-muted").trim() || "#a9a294" };
}

/* a phone-sized popup the map pans clear of the edges: room for the zoom buttons on one side, and
   below for "Find Me" (Zee, 2026-11-06: the popup hid its own close button) */
var JC_POPUP = { maxWidth: 250, minWidth: 180, autoPanPaddingTopLeft: [12, 24], autoPanPaddingBottomRight: [12, 24] };

/* walking directions in Google Maps */
function jcDirectionsUrl(lat, lng){
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(lat + "," + lng) + "&travelmode=walking";
}

/* Street / Satellite: put the tiles on map m and wire the toggle button (it names the OTHER layer).
   onChange(layer) lets a page remember the choice across redraws. */
function jcMapLayers(m, btnId, start, onChange){
  var layer = start === "street" ? "street" : "sat";
  var tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(m);
  var b = document.getElementById(btnId);
  if (b) b.addEventListener("click", function(){
    layer = layer === "sat" ? "street" : "sat";
    m.removeLayer(tiles);
    tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(m);
    b.textContent = jcT(layer === "sat" ? "pin_street" : "pin_sat");
    if (onChange) onChange(layer);
  });
}

/* The phone's position, for "Find Me". It only moves the map / sorts on the phone — never sent or stored.
   ok(lat, lng); fail("LOCATE_DENIED" | "LOCATE_FAILED"). fresh: no cached fix — the Pets sighting pin ("where I am now", never an old fix). */
function jcLocate(ok, fail, fresh){
  if (!navigator.geolocation) { fail("LOCATE_FAILED"); return; }
  navigator.geolocation.getCurrentPosition(function(p){ ok(p.coords.latitude, p.coords.longitude); },
    function(err){ fail(err && err.code === 1 ? "LOCATE_DENIED" : "LOCATE_FAILED"); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 60000 });
}

/* the blue "you are here" dot: moved if it exists, else added. Returns the dot. */
function jcMeDot(m, latlng, dot){
  if (dot) { dot.setLatLng(latlng); return dot; }
  return L.circleMarker(latlng, { radius: 6, weight: 3, color: "#fff", fillColor: jcMapColors().me, fillOpacity: 1 }).addTo(m);
}

/* The full map's buttons (Events, Courts): Street (+ any extra buttons before it) top right, Find Me bottom
   right, Full Screen bottom left. mapId: the Leaflet box; attrs: extra attributes on it (role, label).
   attrs and opts.before are raw HTML — the caller escapes anything that isn't a literal. */
function jcMapHtml(mapId, layer, opts){
  opts = opts || {};
  return '<div class="evmapwrap"><div class="evmap" id="' + mapId + '"' + (opts.attrs || '') + '></div>' +
    '<div class="mapbtns">' + (opts.before || '') +
      '<button type="button" class="lang" id="layerBtn">' + esc(jcT(layer === "sat" ? "pin_street" : "pin_sat")) + '</button></div>' +
    '<button type="button" class="lang maplocate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button>' +
    /* bottom left, clear of the zoom (top left), Street / Map Labels (top right) and Find Me (bottom right) */
    '<button type="button" class="lang mapfull" id="fullBtn" aria-pressed="false">' + esc(jcT("ev_map_full")) + '</button></div>';
}

/* The map, bigger (Zee, 2026-11-07): the map box fills the screen above everything; one button both opens
   and closes it (Escape too). A CSS expand, so it works in iOS Safari, which has no element Fullscreen API;
   Leaflet re-measures once the box has its new size. getMap() → the page's live map (or null);
   onExit() → re-fit the in-page box. Use: var full = jcMapFull(...); full.on; full.set(true|false); full.reset(). */
function jcMapFull(getMap, onExit){
  var ctl = {
    on: false,
    set: function(on){
      var w = document.querySelector(".evmapwrap"), b = document.getElementById("fullBtn");
      ctl.on = !!on && !!w;
      if (w) w.classList.toggle("full", ctl.on);
      document.body.classList.toggle("mapfull", ctl.on);
      if (b) { b.textContent = jcT(ctl.on ? "ev_map_close" : "ev_map_full"); b.setAttribute("aria-pressed", String(ctl.on)); }
      if (!ctl.on && onExit) onExit();
      requestAnimationFrame(function(){ var m = getMap(); if (m) m.invalidateSize(); });
    },
    /* a redrawn or removed map starts in the page */
    reset: function(){ ctl.on = false; document.body.classList.remove("mapfull"); }
  };
  document.addEventListener("keydown", function(e){
    /* an open window (Map Labels) takes its own Escape — one press closes only that (code review L5) */
    if (e.key === "Escape" && ctl.on && !document.querySelector("dialog[open]")) ctl.set(false);
  });
  return ctl;
}

/* Popups on a full map (Events, Courts, Pets): while one is open the map's buttons step aside (.popopen on the wrap);
   a [data-popopen] button inside it calls onOpen(its value). hooks: { open(pe), close() } — a page's own extras
   (Events: the "They're Out" button, the repaint held back while a popup is open). */
function jcMapPopups(m, onOpen, hooks){
  var wrap = document.querySelector(".evmapwrap");
  hooks = hooks || {};
  m.on("popupopen", function(pe){
    if (wrap) wrap.classList.add("popopen");
    var b = pe.popup.getElement() && pe.popup.getElement().querySelector("[data-popopen]");
    if (b && onOpen) b.addEventListener("click", function(){ onOpen(b.dataset.popopen); });
    if (hooks.open) hooks.open(pe);
  });
  m.on("popupclose", function(){ if (wrap) wrap.classList.remove("popopen"); if (hooks.close) hooks.close(); });
}

/* ---------- the full map (SA-2): one copy of what Events, Courts and Pets each set up ---------- */
var JC_LABEL_ZOOM = 17;                    /* Find Me zooms in to here; pin names show from here in (the Strays map); one pin sits here */
var JC_MAP_HOME = { lat: 24.53, lng: 54.43, zoom: 14 };   /* when the community has no map centre set */

/* The map in jcMapHtml's box: community centre, Street / Satellite, the Full Screen button.
   o: { cfg, layer, onLayer(layer), full — the page's jcMapFull }. Returns the map. */
function jcBigMap(mapId, o){
  var c = (o.cfg && o.cfg.map) || {};
  var m = L.map(mapId, { zoomControl: true }).setView([c.lat || JC_MAP_HOME.lat, c.lng || JC_MAP_HOME.lng], c.zoom || JC_MAP_HOME.zoom);
  jcMapLayers(m, "layerBtn", o.layer, o.onLayer);
  var fb = document.getElementById("fullBtn");
  if (fb && o.full) fb.addEventListener("click", function(){ o.full.set(!o.full.on); });
  return m;
}

/* Find Me on a full map: the blue dot, and the map zooms in to JC_LABEL_ZOOM (never out).
   o: { alive() — false once the page has drawn another map or left; onPos(lat, lng) — the page keeps the position
   (Events: distances); onError(code) }. Neither the dot nor an error lands on a map that has gone. */
function jcFindMe(m, o){
  var b = document.getElementById("locateBtn"), dot = null;
  if (!b) return;
  b.addEventListener("click", function(){
    jcLocate(function(lat, lng){
      jcHere = { lat: lat, lng: lng };      /* the lists sort from it too, this visit (NF-2) */
      if (o.onPos) o.onPos(lat, lng);
      if (o.alive && !o.alive()) return;
      dot = jcMeDot(m, [lat, lng], dot);
      m.setView([lat, lng], Math.max(m.getZoom(), JC_LABEL_ZOOM));
    }, function(code){
      if (o.alive && !o.alive()) return;
      if (o.onError) o.onError(code);
    });
  });
}

/* ---------- nearest first (NF-2, docs/plans/nearest-first.md): one distance rule for every resident list ---------- */
/* This visit's phone position, from Find Me (any full map) or Use Where I Am (any list). Memory only: never sent or
   stored, gone when the page is left, never re-asked on a redraw. Use My Home clears it. */
var jcHere = null;

/* metres between two { lat, lng } (haversine; no Leaflet needed) */
function jcDist(a, b){
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* "≈ 300 m" / "≈ 1.2 km" — the ≈ is the caller's (string keys); Latin digits in both languages */
function jcFmtDist(m){ return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km"; }

/* the household pin, when the home has one (claimed before T5.2 or test data: maybe not) */
function jcHomePin(){
  var h = JC_ME && JC_ME.home;
  return h && h.pin_set_at && jcHasPos(h) ? { lat: h.lat, lng: h.lng } : null;
}
/* where "nearest" is measured from: the phone (this visit, once asked) or the household pin; null = neither */
function jcOrigin(){
  if (jcHere) return { lat: jcHere.lat, lng: jcHere.lng, from: "here" };
  var p = jcHomePin();
  return p ? { lat: p.lat, lng: p.lng, from: "home" } : null;
}
/* distance from the origin to an item's spot (posOf(item) → { lat, lng } or null), or null */
function jcDistOf(origin, pos){ return origin && jcHasPos(pos) ? jcDist(origin, pos) : null; }
/* a new array, nearest first; items with no spot keep their order, last. Stable (ties keep the given order). */
function jcNear(items, origin, posOf){
  return items.map(function(x, i){ return { x: x, i: i, d: jcDistOf(origin, posOf(x)) }; })
    .sort(function(a, b){
      if (a.d === null || b.d === null) return (a.d === null) - (b.d === null) || a.i - b.i;
      return a.d - b.d || a.i - b.i;
    }).map(function(o){ return o.x; });
}

/* The "Sorted by" line, the same on every list (o.id: the line's id; o.fallback: the string key when there's no origin
   — "Sorted by: name…"; o.noButton: Pets' owned pets, whose homes never reach the phone). The button:
   Use Where I Am (from the home pin, or no origin) / Use My Home (from the phone, when there's a home pin). */
function jcSortedHtml(o){
  var home = !!jcHomePin(), org = o.noButton ? (home ? { from: "home" } : null) : jcOrigin();   /* noButton: the server's home order */
  var text = !org ? o.fallback : org.from === "here" ? "sort_near_here" : "sort_near_home";
  var btn = o.noButton ? "" : !org || org.from === "home" ? "sort_use_here" : home ? "sort_use_home" : "";
  return '<div class="sortedby"><p class="help" id="' + esc(o.id) + '">' + esc(jcT(text)) + '</p>' +
    (btn ? '<button type="button" class="lang" id="sortHereBtn" data-to="' + (btn === "sort_use_here" ? "here" : "home") + '">' +
      esc(jcT(btn)) + '</button>' : '') + '</div>';
}
/* Wire the button: onChange() redraws the list; onError(code) shows LOCATE_DENIED / LOCATE_FAILED; alive() — false once
   the page has moved on (a late fix still keeps the position, but nothing is redrawn or shown); late() — run instead of
   onChange when a fix lands after a redraw replaced this button (Events' event-night refresh), so the tap isn't lost. */
function jcSortedWire(o){
  var b = document.getElementById("sortHereBtn");
  if (!b) return;
  b.addEventListener("click", function(){
    if (b.dataset.to === "home") { jcHere = null; o.onChange(); return; }
    jcBusy("sortHereBtn", true);
    jcLocate(function(lat, lng){
      jcHere = { lat: lat, lng: lng };
      if (o.alive && !o.alive()) { if (o.late) o.late(); return; }
      o.onChange();
    }, function(code){
      if (o.alive && !o.alive()) return;
      jcBusy("sortHereBtn", false);
      if (o.onError) o.onError(code);
    });
  });
}

/* All the pins in view; one pin at oneZoom (default JC_LABEL_ZOOM); no pins: the map stays where it is. */
function jcFitPins(m, pts, oneZoom){
  if (pts.length > 1) m.fitBounds(pts, { padding: [40, 40], maxZoom: 18 });
  else if (pts.length === 1) m.setView(pts[0], oneZoom || JC_LABEL_ZOOM);
}

/* Walking directions as a link — always opener- and referrer-free (the page's URL can carry tokens) */
function jcDirLink(lat, lng){
  return '<a target="_blank" rel="noopener noreferrer" href="' + esc(jcDirectionsUrl(lat, lng)) + '">' + esc(jcT("ev_directions")) + '</a>';
}

/* A pin's popup. o: { head — the bold first line, body — the lines under it, acts — extra actions after Directions,
   after — under the actions (all trusted HTML: the caller escapes), headAuto — dir="auto" on the head (typed names),
   open: { id, label } — the button that opens the item (jcMapPopups' onOpen), lat/lng — the Directions link }. */
function jcPopHtml(o){
  var acts = (o.open ? '<button class="mini" type="button" data-popopen="' + esc(o.open.id) + '">' + esc(o.open.label) + '</button>' : '') +
    (o.lat != null && o.lng != null ? jcDirLink(o.lat, o.lng) : '') + (o.acts || '');
  return '<div class="pop"><b' + (o.headAuto ? ' dir="auto"' : '') + '>' + o.head + '</b>' + (o.body || '') +
    (acts ? '<div class="popacts">' + acts + '</div>' : '') + (o.after || '') + '</div>';
}

/* The full map fills what's left of the screen above the tab bar, so it's all visible without scrolling (Zee,
   2026-11-04); never below 260px; recomputed on resize, rotation and Safari's toolbar growing / shrinking.
   o: { box — the map box id, getMap(), isFull(), afterId — what sits under the map (Events: the key), onFit(fits),
   before() — run first on a delayed fit }. Returns { fit, soon }. Call once per page. */
function jcMapFit(o){
  var timer = null;
  function fit(){
    var box = document.getElementById(o.box), m = o.getMap();
    if (!box) return;
    if (o.isFull()) { if (m) m.invalidateSize(); return; }   /* full screen: CSS sizes it */
    /* innerHeight follows Safari's toolbar; visualViewport would also shrink on pinch-zoom (review) */
    var bar = document.getElementById("tabbar"), barH = bar ? bar.getBoundingClientRect().height : 0;
    var aft = o.afterId && document.getElementById(o.afterId), ah = aft ? aft.getBoundingClientRect().height : 0;
    var top = box.getBoundingClientRect().top + window.scrollY;
    var want = Math.floor(window.innerHeight - top - barH - (ah ? ah + 8 : 0) - 12);
    if (o.onFit) o.onFit(want >= 260);
    var h = Math.max(260, want);
    if (Math.abs(box.offsetHeight - h) < 2) return;
    box.style.height = h + "px";
    if (m) m.invalidateSize();
  }
  function soon(){ clearTimeout(timer); timer = setTimeout(function(){ if (o.before) o.before(); fit(); }, 120); }
  window.addEventListener("resize", soon);
  window.addEventListener("orientationchange", soon);
  return { fit: fit, soon: soon };
}

/* "Map Labels" (Events, Pets): the map's key in a window, not under the map (Zee: "looks very messy").
   jcKeySheetHtml(id) goes next to the map; jcKeySheet(id, html) opens it — html is trusted markup (escaped by
   the caller). Close button, Escape (native <dialog>), and a tap on the dimmed backdrop all close it. */
function jcKeySheetHtml(id){ return '<dialog class="sheet" id="' + id + '" aria-label="' + esc(jcT("ev_labels")) + '"></dialog>'; }
function jcKeySheetClose(d){ if (!d) return; if (d.close) d.close(); else d.removeAttribute("open"); }   /* no <dialog>: opened with [open] (review F1) */
function jcKeySheet(id, html){
  var d = document.getElementById(id);
  if (!d) return;
  d.innerHTML = '<div class="sheethead"><h2>' + esc(jcT("ev_labels")) + '</h2>' +
    '<button type="button" class="lang" id="' + id + 'Close">' + esc(jcT("ev_labels_close")) + '</button></div>' + html;
  document.getElementById(id + "Close").addEventListener("click", function(){ jcKeySheetClose(d); });
  if (!d.dataset.wired) {
    d.dataset.wired = "1";
    d.addEventListener("click", function(e){
      if (e.target !== d) return;
      var r = d.getBoundingClientRect();   /* the window's own padding also reports the dialog: outside only (F2) */
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) jcKeySheetClose(d);
    });
  }
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
}

/* A small still map with one dot (Pets sightings, R5b-2b-2b): no dragging, zoom or buttons — the link beside it opens
   a real map. Not focusable and no links inside (no "Leaflet" credit link), so the box can be one role="img".
   Returns the map; the page takes it down with jcMapRemove when it redraws. */
function jcMiniMap(node, latlng){
  var m = L.map(node, { zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
                        boxZoom: false, keyboard: false, tap: false }).setView(latlng, 17);
  m.attributionControl.setPrefix(false);
  L.tileLayer(jcTiles.sat.url, jcTiles.sat.opts).addTo(m);
  var c = jcMapColors();
  L.circleMarker(latlng, { radius: 8, weight: 3, color: c.ink, fillColor: c.accent, fillOpacity: .95, interactive: false }).addTo(m);
  return m;
}

/* ---------- pin picker: the map pans under a fixed centre ring; the page reads map.getCenter() on Save ---------- */
/* markup for jcPinPicker; cls: an extra class on the box (the organizer's shorter "vpin"); attrs: e.g. data-no-autoreload.
   cls and attrs are raw HTML — literals only, or escaped by the caller. */
function jcPinPickerHtml(mapId, cls, attrs){
  return '<div class="pinmap' + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '><div class="map" id="' + mapId + '"></div><div class="ring" aria-hidden="true"></div>' +
    '<div class="layers"><button type="button" class="lang" id="layerBtn">' + esc(jcT("pin_street")) + '</button></div>' +
    '<button type="button" class="lang locate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button></div>';
}
/* Wire it: satellite first, Street toggle, Find Me (the phone's location only moves the map — the person
   still confirms the spot under the ring). o: { center: [lat,lng], zoom, locateZoom,
   onError(code), onBusy(on) — Find Me waiting, alive() — false once the page has moved on }. Returns the map. */
function jcPinPicker(mapId, o){
  var m = L.map(mapId, { zoomControl: true }).setView(o.center, o.zoom);
  jcMapLayers(m, "layerBtn", "sat");
  var b = document.getElementById("locateBtn");
  if (b) b.addEventListener("click", function(){
    if (o.onBusy) o.onBusy(true);
    jcLocate(function(lat, lng){
      if (o.onBusy) o.onBusy(false);
      if (!o.alive || o.alive()) m.setView([lat, lng], o.locateZoom);
    }, function(code){ if (o.onBusy) o.onBusy(false); if (o.onError) o.onError(code); });
  });
  return m;
}
