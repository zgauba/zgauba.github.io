/* My Home page — UC-B1 claim a home, pin drop, UC-B2 household invites, UC-H1
   leave / delete account. Views: claim · edit · pin · myhome · notice.
   Routing: signed out → account page (sign in / join) and back here; signed in
   but not a member → the join code step; member without a home → claim;
   ?invite=<token> → accept the invite; ?view=pin → the pin drop.
   The pin is REQUIRED (T5.2 plan Q4): a home without one always lands on the pin
   screen, which has no "skip". ?view=pin&next=<event tab> returns there once saved. */

var params = new URLSearchParams(location.search);
var INVITE = params.get("invite");
if (INVITE && !/^[A-Za-z0-9_-]{16,64}$/.test(INVITE)) INVITE = null;
var VIEW = params.get("view");
var NEXT = params.get("next");
if (NEXT && jcSafeNext(NEXT) !== NEXT) NEXT = null;   /* only our own pages, never off-site */

var state = null;       /* jcState() result; state.me = jc_me_get */
var cfg = null;         /* the member's community config (villages, map) */
var current = null;
var map = null;         /* live Leaflet map while the pin view is open */
var claimSel = { village: null, type: null };

var TILES = {
  sat: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
         opts: { maxNativeZoom: 19, maxZoom: 20, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" } },
  street: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            /* OSM blocks tile requests with no Referer (403 "Access blocked"). The page is
               no-referrer (tokens in URLs), so this layer alone sends the bare origin. */
            opts: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", referrerPolicy: "strict-origin" } }
};

/* "24.5301, 54.4312", "24.5301° N, 54.4312° E", or a Google Maps URL with @lat,lng or
   ?q=lat,lng → [lat, lng]; null if it isn't a plausible coordinate pair. */
function parseLatLng(raw){
  raw = String(raw || "");
  var m = raw.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ||               /* …/@lat,lng… or ?q=lat,lng */
          raw.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[NS]?\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (!m) return null;
  var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return [lat, lng];
}

/* ---------- small UI helpers ---------- */
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){ var m = el("msg"); if (!m) return; m.className = "msg err"; m.textContent = jcErrText({ code: code }); }
function showOk(text){ var m = el("msg"); if (!m) return; m.className = "msg ok"; m.textContent = text; }
function busy(id, onoff){
  var b = el(id);
  if (!b) return;
  if (onoff) { b.dataset.label = b.textContent; b.textContent = jcT("working"); b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}
function on(id, fn){ var n = el(id); if (n) n.addEventListener("click", fn); }
function me(){ return (state && state.me) || {}; }
function home(){ return me().home; }
function homeTitle(){ return jcHomeLabel(home()); }
function backTo(rel){ return encodeURIComponent(rel); }

var keepCenter = null;   /* pin view: map position survives a re-render (language toggle) */
function show(name, arg){
  if (map) { keepCenter = name === "pin" ? map.getCenter() : null; map.remove(); map = null; }
  else keepCenter = null;
  current = name;
  VIEWS[name](arg);
}

/* Re-render the current view in the other language without losing typed input. */
function rerender(){
  var vals = {};
  Array.prototype.forEach.call(document.querySelectorAll("#view input[id]"), function(i){ vals[i.id] = i.value; });
  show(current);
  Object.keys(vals).forEach(function(id){ if (el(id)) el(id).value = vals[id]; });
}

/* ---------- views ---------- */
var VIEWS = {
  claim: function(){ claimForm(false); },
  edit: function(){ claimForm(true); },

  pin: function(){
    var h = home() || {};
    el("view").innerHTML =
      '<h1>' + esc(jcT("pin_title")) + '</h1>' +
      (h.pin_set_at ? '' : '<p class="sub">' + esc(jcT("pin_step")) + '</p>') +
      '<p class="sub">' + esc(jcT("pin_help")) + '</p>' +
      '<div class="pinmap" data-no-autoreload><div class="map" id="map"></div><div class="ring" aria-hidden="true"></div>' +
        '<div class="layers"><button type="button" class="lang" id="layerBtn">' + esc(jcT("pin_street")) + '</button></div>' +
        '<button type="button" class="lang locate" id="locateBtn">' + esc(jcT("pin_locate")) + '</button></div>' +
      '<p class="help" style="margin-top:8px">' + esc(jcT("pin_privacy")) + '</p>' +
      '<label class="field" style="margin-top:10px">' + esc(jcT("pin_paste")) +
        '<span class="row"><input type="text" id="coords" inputmode="decimal" autocomplete="off" placeholder="24.5301, 54.4312">' +
        '<button type="button" class="btn ghost" id="coordsGo" style="flex:0 0 auto">' + esc(jcT("pin_paste_go")) + '</button></span></label>' +
      '<p class="help">' + esc(jcT("pin_paste_help")) + '</p>' +
      msgBox() +
      '<div class="row section"><button class="btn" id="savePin" type="button">' + esc(jcT("pin_save")) + '</button>' +
        /* changing an existing pin can be abandoned; a first pin can't be skipped */
        (h.pin_set_at ? '<button class="btn ghost" id="cancelPin" type="button">' + esc(jcT("pin_cancel")) + '</button>' : '') +
      '</div>';
    var c = (cfg && cfg.map) || {};
    var center = h.lat != null ? [h.lat, h.lng] : [c.lat || 24.53, c.lng || 54.43];
    var zoom = h.lat != null ? 19 : Math.max(c.zoom || 15, 16);
    if (keepCenter) { center = [keepCenter.lat, keepCenter.lng]; zoom = 19; }
    map = L.map("map", { zoomControl: true }).setView(center, zoom);
    var layer = "sat";
    var tiles = L.tileLayer(TILES.sat.url, TILES.sat.opts).addTo(map);
    on("layerBtn", function(){
      layer = layer === "sat" ? "street" : "sat";
      map.removeLayer(tiles);
      tiles = L.tileLayer(TILES[layer].url, TILES[layer].opts).addTo(map);
      el("layerBtn").textContent = jcT(layer === "sat" ? "pin_street" : "pin_sat");
    });
    /* "Find me": the phone's location only moves the map — it is never sent or
       stored; the resident still confirms the spot under the ring. */
    on("locateBtn", function(){
      if (!navigator.geolocation) return showErr("LOCATE_FAILED");
      busy("locateBtn", true);
      navigator.geolocation.getCurrentPosition(function(pos){
        busy("locateBtn", false);
        if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 19);
      }, function(err){
        busy("locateBtn", false);
        showErr(err && err.code === 1 ? "LOCATE_DENIED" : "LOCATE_FAILED");
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
    /* Paste from Google Maps (Halloween parity): moves the map only — the resident
       still confirms with "That's my home". */
    on("coordsGo", function(){
      var p = parseLatLng(el("coords").value);
      if (!p) return showErr("BAD_COORDS");
      map.setView(p, 19);
    });
    on("cancelPin", function(){ if (NEXT) location.href = NEXT; else show("myhome"); });
    on("savePin", function(){
      var p = map.getCenter();
      busy("savePin", true);
      rpc("jc_home_pin_set", { p_lat: p.lat, p_lng: p.lng }).then(function(m){
        state.me = m;
        if (NEXT) { location.href = NEXT; return; }   /* back to the event's sign-up */
        show("myhome");
        showOk(jcT("mh_pin_set"));
      }, function(e){ busy("savePin", false); showErr(e.code); });
    });
  },

  myhome: function(){
    var h = home(), m = me(), members = h.members || [];
    var acct = m.account || {};
    el("view").innerHTML =
      '<div class="panel">' +
        '<div class="homehead">' + jcIcon("house", 34) +
          '<div><b>' + esc(homeTitle()) + '</b><span>' + esc(jcVillageName(cfg, h.village)) + '</span></div></div>' +
        (h.pin_set_at
          ? '<p class="status ok">' + esc(jcT("mh_pin_set")) + '</p>'
          : '<p class="status warn">' + esc(jcT("mh_pin_missing")) + '</p>') +
        '<div class="row">' +
          '<button class="btn ghost" type="button" id="toPin">' + esc(jcT(h.pin_set_at ? "mh_pin_btn" : "mh_pin_add")) + '</button>' +
          (members.length <= 1 ? '<button class="btn ghost" type="button" id="toEdit">' + esc(jcT("mh_fix")) + '</button>' : '') +
        '</div>' +
      '</div>' +
      msgBox() +

      '<div class="section"><h2>' + esc(jcT("mh_household")) + '</h2><div class="panel">' +
        '<ul class="members">' + members.map(function(x){
          return '<li><span>' + esc(x.name) + '</span>' + (x.you ? '<span class="tag">' + esc(jcT("mh_you")) + '</span>' : '') + '</li>';
        }).join("") + '</ul>' +
        '<div id="inviteOut"></div>' +
        '<button class="btn" type="button" id="invite">' + esc(jcT("mh_invite")) + '</button>' +
      '</div></div>' +

      '<div class="section" id="historySec" hidden><h2>' + esc(jcT("mh_history")) + '</h2><div class="panel" id="history"></div></div>' +

      '<div class="section"><h2>' + esc(jcT("mh_account")) + '</h2><div class="panel">' +
        '<p class="who"><b>' + esc(acct.email || state.email || "") + '</b></p>' +
        '<label>' + esc(jcT("mh_name")) +
          '<input id="dname" type="text" maxlength="40" autocomplete="nickname"></label>' +
        '<p class="help">' + esc(jcT("mh_name_help")) + '</p>' +
        '<button class="btn ghost" type="button" id="saveName">' + esc(jcT("mh_save")) + '</button>' +
        '<button class="btn ghost" type="button" id="signOut">' + esc(jcT("acct_sign_out")) + '</button>' +
      '</div></div>' +

      '<div class="section"><div class="panel">' +
        '<button class="btn ghost danger" type="button" id="leave">' + esc(jcT("mh_leave")) + '</button>' +
        '<p class="help">' + esc(jcT("mh_delete_help")) + '</p>' +
        '<input id="delConfirm" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="DELETE">' +
        '<button class="btn ghost danger" type="button" id="delete">' + esc(jcT("mh_delete_btn")) + '</button>' +
      '</div></div>';

    /* defaultValue too: a prefilled field is not "being typed in" (update.js busy()) */
    el("dname").value = el("dname").defaultValue = acct.display_name || "";
    loadHistory();
    on("toPin", function(){ show("pin"); });
    on("toEdit", function(){ show("edit"); });
    on("invite", doInvite);
    on("saveName", function(){
      busy("saveName", true);
      rpc("jc_display_name_set", { p_name: el("dname").value }).then(function(m2){
        state.me = m2; show("myhome"); showOk(jcT("mh_saved"));
      }, function(e){ busy("saveName", false); showErr(e.code); });
    });
    on("signOut", function(){ jcDb.auth.signOut().then(function(){ location.href = "../"; }); });
    on("leave", function(){
      if (!window.confirm(jcFmt("mh_leave_confirm", { h: homeTitle() }))) return;
      busy("leave", true);
      rpc("jc_home_leave").then(function(m2){ state.me = m2; show("claim"); },
                                function(e){ busy("leave", false); showErr(e.code); });
    });
    on("delete", function(){
      if (el("delConfirm").value.trim() !== "DELETE") return showErr("CONFIRM_REQUIRED");
      busy("delete", true);
      rpc("jc_account_delete", { p_confirm: "DELETE" })
        .then(function(){ return jcDb.auth.signOut().catch(function(){}); })
        .then(function(){ location.href = "../"; },
              function(e){ busy("delete", false); showErr(e.code); });
    });
  },

  /* one-off outcome screens (invite pending / invite error) */
  notice: function(arg){
    el("view").innerHTML =
      '<div class="panel">' + msgBox() +
        '<a class="btn" href="' + (home() ? "./" : "../") + '">' + esc(jcT(home() ? "mh_title" : "acct_continue")) + '</a></div>';
    if (arg.code) showErr(arg.code); else showOk(arg.text);
  }
};

function claimForm(editing){
  var h = home() || {};
  if (editing) claimSel = { village: h.village, type: h.type };
  var villages = (cfg && cfg.villages) || [];
  el("view").innerHTML =
    '<h1>' + esc(jcT(editing ? "edit_title" : "claim_title")) + '</h1>' +
    (editing ? '' : '<p class="sub">' + esc(jcT("claim_step")) + '</p>') +
    '<form class="panel" id="form" novalidate>' +
      '<fieldset><legend>' + esc(jcT("claim_village")) + '</legend><div class="villages">' +
        villages.map(function(v){
          var name = jcLang() === "ar" && v.ar ? v.ar : v.en;
          var other = jcLang() === "ar" ? v.en : v.ar;
          var open = v.status === "delivered";
          return '<button type="button" class="choice" data-village="' + esc(v.key) + '"' +
            (open ? '' : ' disabled') + ' aria-pressed="' + (claimSel.village === v.key) + '">' + esc(name) +
            '<small>' + esc(open ? (other || "") : jcFmt("claim_upcoming", { d: v.delivery || "" })) + '</small></button>';
        }).join("") +
      '</div></fieldset>' +
      '<fieldset><legend>' + esc(jcT("claim_type")) + '</legend><div class="seg">' +
        ["villa", "townhouse", "apartment"].map(function(t){
          return '<button type="button" class="choice" data-type="' + t + '" aria-pressed="' + (claimSel.type === t) + '">' +
            esc(jcT("type_" + t)) + '</button>';
        }).join("") +
      '</div></fieldset>' +
      '<label id="bldWrap"' + (claimSel.type === "apartment" ? '' : ' hidden') + '>' + esc(jcT("claim_building")) +
        '<input id="building" type="text" maxlength="20" autocomplete="off"></label>' +
      '<label><span id="numLabel">' + esc(jcT(claimSel.type === "apartment" ? "claim_number_apt" : "claim_number")) + '</span>' +
        '<input id="number" type="text" inputmode="text" maxlength="12" autocomplete="off" required></label>' +
      msgBox() +
      '<button class="btn" id="go" type="submit">' + esc(jcT(editing ? "edit_save" : "claim_continue")) + '</button>' +
    '</form>' +
    (editing ? '<div class="links"><button type="button" id="back">' + esc(jcT("acct_back")) + '</button></div>' : '');
  if (editing) {
    el("building").value = el("building").defaultValue = h.building || "";
    el("number").value = el("number").defaultValue = h.number || "";
  }
  /* no villages = the community config didn't load: say so, never an empty form */
  if (!villages.length) showErr("NETWORK");
  on("back", function(){ show("myhome"); });

  Array.prototype.forEach.call(document.querySelectorAll("[data-village]"), function(b){
    b.addEventListener("click", function(){
      claimSel.village = b.dataset.village;
      Array.prototype.forEach.call(document.querySelectorAll("[data-village]"), function(x){
        x.setAttribute("aria-pressed", String(x === b));
      });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-type]"), function(b){
    b.addEventListener("click", function(){
      claimSel.type = b.dataset.type;
      Array.prototype.forEach.call(document.querySelectorAll("[data-type]"), function(x){
        x.setAttribute("aria-pressed", String(x === b));
      });
      el("bldWrap").hidden = claimSel.type !== "apartment";
      el("numLabel").textContent = jcT(claimSel.type === "apartment" ? "claim_number_apt" : "claim_number");
    });
  });

  el("form").addEventListener("submit", function(ev){
    ev.preventDefault();
    if (!claimSel.village) return showErr("BAD_VILLAGE");
    if (!claimSel.type) return showErr("BAD_HOME_TYPE");
    busy("go", true);
    rpc(editing ? "jc_home_edit" : "jc_home_claim", {
      p_village: claimSel.village, p_type: claimSel.type,
      p_building: claimSel.type === "apartment" ? el("building").value : null,
      p_number: el("number").value
    }).then(function(m){
      state.me = m;
      show(editing ? "myhome" : "pin");
    }, function(e){ busy("go", false); showErr(e.code); });
  });
}

/* "Our year" (UC-C3): events this home joined. Needs the Events module — while it
   is off (MODULE_OFF) the section simply stays hidden. */
function loadHistory(){
  rpc("jc_my_history").then(function(rows){
    if (current !== "myhome" || !el("history")) return;
    el("history").innerHTML = rows.length
      ? '<ul class="members">' + rows.map(function(r){
          var t = jcLang() === "ar" && r.title_ar ? r.title_ar : r.title_en;
          return '<li><a href="../events/?id=' + esc(r.event_id) + '">' + esc(t) + '</a><span class="tag">' +
            esc(r.starts_at ? new Date(r.starts_at).getFullYear() : "") + '</span></li>';
        }).join("") + '</ul>'
      : '<p class="help">' + esc(jcT("mh_history_none")) + '</p>';
    el("historySec").hidden = false;
  }, function(){ /* module off or offline: nothing to show */ });
}

function doInvite(){
  busy("invite", true);
  rpc("jc_invite_create").then(function(r){
    busy("invite", false);
    var link = location.origin + location.pathname + "?invite=" + encodeURIComponent(r.token);
    var when = new Date(r.expires_at).toLocaleString(jcLang() === "ar" ? "ar-AE-u-nu-latn" : "en-GB",
                                                     { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    el("inviteOut").innerHTML =
      '<p class="help">' + esc(jcFmt("mh_invite_help", { d: when })) + '</p>' +
      '<p class="invitebox" id="inviteLink">' + esc(link) + '</p>' +
      '<div class="row"><button class="btn ghost" type="button" id="copyLink">' + esc(jcT("mh_copy")) + '</button>' +
        (navigator.share ? '<button class="btn ghost" type="button" id="shareLink">' + esc(jcT("mh_share")) + '</button>' : '') +
      '</div>';
    on("copyLink", function(){
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(function(){ el("copyLink").textContent = jcT("mh_copied"); }, function(){});
    });
    on("shareLink", function(){ navigator.share({ title: homeTitle(), url: link }).catch(function(){}); });
  }, function(e){ busy("invite", false); showErr(e.code); });
}

/* Ask before joining (security review PR #21): one tap on a link must never pull
   someone into a household. The server reveals the home only on accept, so the
   question is generic. */
function acceptInvite(){
  var token = INVITE;
  INVITE = null;
  try { history.replaceState(null, "", location.pathname); } catch(e){}  /* single use: drop it from the URL */
  current = "invite";
  el("view").innerHTML =
    '<h1>' + esc(jcT("invite_title")) + '</h1>' +
    '<div class="panel"><p class="sub">' + esc(jcT("invite_ask")) + '</p>' + msgBox() +
      '<button class="btn" type="button" id="inviteYes">' + esc(jcT("invite_yes")) + '</button>' +
      '<button class="btn ghost" type="button" id="inviteNo">' + esc(jcT("invite_no")) + '</button></div>';
  on("inviteNo", function(){ home() ? show("myhome") : show("claim"); });
  on("inviteYes", function(){ busy("inviteYes", true); doAccept(token); });
}

function doAccept(token){
  return rpc("jc_invite_accept", { p_token: token }).then(function(r){
    if (r && r.status === "joined") {
      state.me = r.me;
      show("myhome");
      showOk(jcFmt("invite_joined", { h: homeTitle() }));
    } else {
      show("notice", { text: jcT("invite_pending") });
    }
  }, function(e){ show("notice", { code: e.code }); });
}

/* ---------- boot ---------- */
function paint(){
  var name = cfg ? (jcLang() === "ar" ? (cfg.name_ar || cfg.name_en) : cfg.name_en) : jcT("brand");
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcT("mh_title") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "home", cfg);
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(jcLang() === "ar" ? "en" : "ar");
  paint();
  if (current && current !== "notice" && current !== "invite") rerender();
});

jcSetLang(jcLang());
paint();
jcHit("home");
jcState().then(function(s){
  state = s;
  var back = INVITE ? "../home/?invite=" + INVITE : "../home/";
  if (s.status === "signed_out") {
    /* invitees are usually new: start them at Join; everyone else at Sign in */
    location.replace("../account/?" + (INVITE ? "view=join&" : "") + "next=" + backTo(back));
    return;
  }
  if (s.status === "not_member") {
    location.replace("../account/?view=join&next=" + backTo(back));
    return;
  }
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (INVITE) return acceptInvite();
    if (!home()) return show("claim");
    show(VIEW === "pin" || !home().pin_set_at ? "pin" : "myhome");
  });
}, function(e){
  el("view").innerHTML = '<div class="panel">' + msgBox() + '</div>';
  showErr(e.code || "UNKNOWN");
});
