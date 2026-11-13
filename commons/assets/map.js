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
   ok(lat, lng); fail("LOCATE_DENIED" | "LOCATE_FAILED"). fresh: no cached fix — for the Pets sighting pin (R5b-2b-2, next); unused until then. */
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
