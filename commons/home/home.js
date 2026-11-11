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
var MH_TABS = ["home", "household", "account"];
var mhTab = MH_TABS.indexOf(params.get("tab")) >= 0 ? params.get("tab") : "home";
var draftName = null;   /* display name typed but not saved, kept while switching tabs */
var NEXT = params.get("next");
if (NEXT && jcSafeNext(NEXT) !== NEXT) NEXT = null;   /* only our own pages, never off-site */

var state = null;       /* jcState() result; state.me = jc_me_get */
var cfg = null;         /* the member's community config (villages, map) */
var current = null;
var map = null;         /* live Leaflet map while the pin view is open */
var claimSel = { village: null, type: null };

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
  if (map) { keepCenter = name === "pin" ? map.getCenter() : null; jcMapRemove(map); map = null; }
  else keepCenter = null;
  current = name;
  var refocus = jcFocusKeep();
  VIEWS[name](arg);
  refocus();
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
        '<span class="row"><input type="text" id="coords" dir="ltr" inputmode="decimal" autocomplete="off" placeholder="24.5301, 54.4312">' +
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
    var tiles = L.tileLayer(jcTiles.sat.url, jcTiles.sat.opts).addTo(map);
    on("layerBtn", function(){
      layer = layer === "sat" ? "street" : "sat";
      map.removeLayer(tiles);
      tiles = L.tileLayer(jcTiles[layer].url, jcTiles[layer].opts).addTo(map);
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
      var p = jcParseLatLng(el("coords").value);
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

  /* Sub-menu (Zee, T5.2 polish): Home · Household · Account instead of one long
     scroll. The tab survives re-renders (save, language) and lives in ?tab=. */
  myhome: function(){
    var h = home(), m = me(), members = h.members || [];
    var acct = m.account || {};
    var body;
    if (mhTab === "household") {
      body =
        '<div class="panel">' +
          '<ul class="members">' + members.map(function(x){
            return '<li><span>' + esc(x.name) + '</span>' + (x.you ? '<span class="tag">' + esc(jcT("mh_you")) + '</span>' : '') + '</li>';
          }).join("") + '</ul>' +
          '<div id="inviteOut"></div>' +
          '<button class="btn" type="button" id="invite">' + esc(jcT("mh_invite")) + '</button>' +
        '</div>';
    } else if (mhTab === "account") {
      /* organizers: their own button above the account box; anyone else: a quiet link at the
         bottom, so a newly given code still has a way in (Zee, 2026-11-06) */
      /* the same rule as Organizer Tools' own door (admin.js canEnter): a pets-only code doesn't open it (review R1) */
      var sc = m.admin_scopes || [];
      var organizer = sc.indexOf("events") >= 0 || sc.indexOf("community") >= 0 || (m.admin_events || []).length > 0 || m.is_owner === true;
      body =
        (organizer ? '<a class="btn" id="toAdmin" href="../admin/">' + esc(jcT("mh_organizer")) + '</a>' : '') +
        '<div class="panel">' +
          '<p class="who"><b>' + esc(acct.email || state.email || "") + '</b></p>' +
          '<label>' + esc(jcT("mh_name")) +
            '<input id="dname" type="text" maxlength="40" autocomplete="nickname"></label>' +
          '<p class="help">' + esc(jcT("mh_name_help")) + '</p>' +
          '<button class="btn ghost" type="button" id="saveName">' + esc(jcT("mh_save")) + '</button>' +
          '<button class="btn ghost" type="button" id="signOut">' + esc(jcT("acct_sign_out")) + '</button>' +
        '</div>' +
        shellHtml() +
        /* T5.3 feedback: goes to the person who runs Commons, with this home (said up front) */
        '<div class="section" id="feedback"><h2>' + esc(jcT("fb_title")) + '</h2><form class="panel" id="fbForm" novalidate>' +
          '<div class="opts" role="group" aria-label="' + esc(jcT("fb_kind")) + '">' + ["idea", "problem", "other"].map(function(k){
            return '<button type="button" data-fbkind="' + k + '" aria-pressed="' + (fbKind === k) + '">' + esc(jcT("fb_kind_" + k)) + '</button>';
          }).join("") + '</div>' +
          '<textarea id="fbBody" maxlength="1000" dir="auto" aria-label="' + esc(jcT("fb_title")) + '" placeholder="' + esc(jcT("fb_placeholder")) + '"></textarea>' +
          '<p class="help">' + esc(jcFmt("fb_disclosure", { h: homeTitle() })) + '</p>' +
          '<button class="btn" type="submit" id="fbSend">' + esc(jcT("fb_send")) + '</button>' +
        '</form></div>' +
        '<div class="section"><div class="panel">' +
          '<button class="btn ghost danger" type="button" id="leave">' + esc(jcT("mh_leave")) + '</button>' +
          '<p class="help">' + esc(jcT("mh_delete_help")) + '</p>' +
          '<input id="delConfirm" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="DELETE">' +
          '<button class="btn ghost danger" type="button" id="delete">' + esc(jcT("mh_delete_btn")) + '</button>' +
        '</div></div>' +
        (organizer ? '' : '<p class="help orglink"><a id="toAdmin" href="../admin/">' + esc(jcT("mh_have_code")) + '</a></p>');
    } else {
      body =
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
          /* R5b-1 (Zee Q7): the home's pets, one tap from My Home — only while Pets is open here */
          (jcDestOk("pets", m, cfg) ? '<div class="row"><a class="btn ghost" id="toPets" href="../pets/?tab=mine">' +
            jcIcon("pets", 18) + '<span dir="auto">' + esc(jcT("mh_my_pets")) + '</span>'  + '</a></div>' : '') +
        '</div>' +
        '<div class="section" id="historySec" hidden><h2>' + esc(jcT("mh_history")) + '</h2><div class="panel" id="history"></div></div>';
    }
    el("view").innerHTML =
      '<h1 class="sr-only">' + esc(jcT("mh_title")) + '</h1>' +     /* the screen's name for screen readers */
      jcTabsHtml("mh-", MH_TABS, mhTab, function(t){ return jcT("mh_tab_" + t); }, jcT("mh_title"), "mhPanel") +
      msgBox() + '<div ' + jcTabPanel("mh-", mhTab, "mhPanel") + '>' + body + '</div>';
    jcTabsWire("mh-", MH_TABS, function(t){
      if (el("dname")) draftName = el("dname").value;   /* an unsaved name survives a tab switch */
      mhTab = t;
      try { history.replaceState(null, "", t === "home" ? location.pathname : "?tab=" + t); } catch(e){}
      show("myhome");
    });

    /* defaultValue too: a prefilled field is not "being typed in" (update.js busy()) */
    if (el("dname")) {
      el("dname").value = el("dname").defaultValue = acct.display_name || "";
      if (draftName !== null) { el("dname").value = draftName; draftName = null; }
    }
    if (el("history")) loadHistory();
    on("toPin", function(){ show("pin"); });
    on("toEdit", function(){ show("edit"); });
    on("invite", doInvite);
    on("saveName", function(){
      busy("saveName", true);
      rpc("jc_display_name_set", { p_name: el("dname").value }).then(function(m2){
        state.me = m2; show("myhome"); showOk(jcT("mh_saved"));
      }, function(e){ busy("saveName", false); showErr(e.code); });
    });
    wireFeedback();
    wireShell();
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

/* ---------- R3a: bottom bar + start page (Account tab) ----------
   The draft lives here, not in the DOM: the switches are buttons, so unsaved choices must survive a
   tab switch and a language toggle by hand (like draftName). While unsaved, the section carries
   data-no-autoreload, so an update shows the banner instead of reloading. */
var shellDraft = null;   /* { order: [keys], on: [keys], start: key } */
function shellOffered(m){ return JC_DEST.filter(function(d){ return jcDestOk(d.key, m, cfg); }).map(function(d){ return d.key; }); }
function shellFromSaved(){
  var sh = jcShell(me(), cfg), order = sh.tabs.slice();
  shellOffered(me()).forEach(function(k){ if (order.indexOf(k) < 0) order.push(k); });
  /* a saved start page that's unavailable right now is kept (it comes back with its module) */
  return { order: order, on: sh.tabs.slice(), start: sh.saved ? sh.saved.start : "commons" };
}
function shellPicked(d){ return { tabs: d.order.filter(function(k){ return d.on.indexOf(k) >= 0; }), start: d.start }; }
function shellDirty(){ return !!shellDraft && JSON.stringify(shellPicked(shellDraft)) !== JSON.stringify(shellPicked(shellFromSaved())); }
function shellLi(k, i, d){
  var dest = jcDest(k), name = jcDestLabel(dest), on = d.on.indexOf(k) >= 0;
  return '<li data-dest="' + esc(k) + '"><span class="nm">' + jcIcon(dest.icon, 20) + '<span dir="auto">' + esc(name) + '</span></span>' +
    '<button type="button" class="sw" role="switch" data-act="toggle" aria-checked="' + on + '" aria-label="' +
      esc(jcFmt("set_show", { x: name })) + '"' + (!on && d.on.length >= JC_BAR_MAX ? ' disabled' : '') + '>' +
      esc(jcT(on ? "set_on" : "set_off")) + '</button>' +
    '<button type="button" class="mv" data-act="up" aria-label="' + esc(jcFmt("set_up", { x: name })) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
    '<button type="button" class="mv" data-act="down" aria-label="' + esc(jcFmt("set_down", { x: name })) + '"' + (i === d.order.length - 1 ? ' disabled' : '') + '>↓</button></li>';
}
function shellHtml(){
  if (!shellDraft) shellDraft = shellFromSaved();
  var d = shellDraft, starts = shellOffered(me()).concat("home");
  var checked = jcDestOk(d.start, me(), cfg) ? d.start : "commons";
  var bold = function(k){ return esc(jcT(k)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); };
  return '<div class="section" id="shellSec"' + (shellDirty() ? ' data-no-autoreload' : '') + '><h2>' + esc(jcT("set_title")) + '</h2>' +
    '<div class="panel"><p class="help">' + esc(jcT("set_help")) + '</p>' +
      '<ol class="shellrows">' + d.order.map(function(k, i){ return shellLi(k, i, d); }).join("") +
        '<li class="fixed"><span class="nm">' + jcIcon("house", 20) + '<span>' + esc(jcT("tab_my_home")) + '</span></span>' +
          '<span class="help">' + esc(jcT("set_home_fixed")) + '</span></li></ol>' +
      (d.on.length >= JC_BAR_MAX ? '<p class="help" id="shellFull">' + esc(jcT("set_full")) + '</p>' : '') +
      '<fieldset class="starts"><legend>' + esc(jcT("set_start")) + '</legend>' + starts.map(function(k){
        return '<label class="radio"><input type="radio" name="startPage" id="start-' + esc(k) + '" value="' + esc(k) + '"' +
          (k === checked ? ' checked' : '') + '><span dir="auto">' + esc(jcDestLabel(jcDest(k))) + '</span></label>';
      }).join("") + '</fieldset>' +
      '<p class="help">' + esc(jcT("set_start_help")) + '</p>' +
      '<p class="msg" id="shellMsg" role="alert"></p>' +
      '<button class="btn" type="button" id="saveShell">' + esc(jcT("set_save")) + '</button>' +
      '<details class="install" id="install"><summary>' + esc(jcT("inst_title")) + '</summary><ul class="helplist">' +
        ["inst_iphone", "inst_android", "inst_signin", "inst_reset"].map(function(k){ return '<li>' + bold(k) + '</li>'; }).join("") +
      '</ul></details>' +
    '</div></div>';
}
function shellMsg(ok, text){ var m = el("shellMsg"); if (m) { m.className = "msg " + (ok ? "ok" : "err"); m.textContent = text; } }
function wireShell(){
  var sec = el("shellSec");
  if (!sec) return;
  sec.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!b || b.disabled) return;
    var d = shellDraft, k = b.closest("li").dataset.dest, act = b.dataset.act, i = d.order.indexOf(k), j;
    if (act === "toggle") {
      j = d.on.indexOf(k);
      if (j >= 0) d.on.splice(j, 1); else if (d.on.length < JC_BAR_MAX) d.on.push(k);
    } else {
      j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= d.order.length) return;
      d.order[i] = d.order[j]; d.order[j] = k;
    }
    var open = el("install") && el("install").open;
    sec.outerHTML = shellHtml();             /* only this section: typed text elsewhere is untouched */
    if (open) el("install").open = true;
    wireShell();
    var again = document.querySelector('#shellSec li[data-dest="' + k + '"] [data-act="' + act + '"]');
    if (again && again.disabled) again = document.querySelector('#shellSec li[data-dest="' + k + '"] [data-act="toggle"]');
    if (again) again.focus();                /* keyboard and screen-reader users stay on the row */
  });
  Array.prototype.forEach.call(sec.querySelectorAll('input[name="startPage"]'), function(r){
    /* click as well as change: a saved start page that's switched off shows Commons checked, and
       tapping the already-checked Commons fires no change — it must still clear it (review) */
    var pick = function(){
      shellDraft.start = r.value;
      if (shellDirty()) sec.setAttribute("data-no-autoreload", ""); else sec.removeAttribute("data-no-autoreload");
    };
    r.addEventListener("change", pick);
    r.addEventListener("click", pick);
  });
  on("saveShell", saveShell);
}
/* jc_prefs_set replaces the WHOLE prefs object: read it fresh, change only `shell`, keep every
   other key as it is (premortem #1). Saved choices that aren't offered right now (a module
   switched off) stay saved and come back with the module (R4 C3). */
function saveShell(){
  var d = shellDraft;
  busy("saveShell", true);
  rpc("jc_me_get").then(function(fresh){
    var prefs = fresh && fresh.account && fresh.account.prefs, next = {};
    if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) Object.keys(prefs).forEach(function(k){
      if (k !== "__proto__") next[k] = prefs[k];        /* an own "__proto__" key would re-prototype `next` (security review) */
    });
    var old = jcShellSaved(fresh), offered = shellOffered(fresh), tabs = shellPicked(d).tabs, known = offered.slice();
    if (old) {
      /* back in its old place, so a full bar doesn't push it off the end when it returns (review) */
      old.tabs.forEach(function(k, i){ if (offered.indexOf(k) < 0 && tabs.indexOf(k) < 0) tabs.splice(Math.min(i, tabs.length), 0, k); });
      old.known.forEach(function(k){ if (known.indexOf(k) < 0) known.push(k); });
    }
    next.shell = { v: 1, tabs: tabs, start: d.start, known: known };
    return rpc("jc_prefs_set", { p_prefs: next });
  }).then(function(m){
    state.me = JC_ME = m;
    shellDraft = null;
    paint();                                  /* the bar, redrawn from what was saved */
    var sec = el("shellSec");
    if (!sec) return;
    sec.outerHTML = shellHtml();              /* only this section: the reader keeps their place (review) */
    wireShell();
    shellMsg(true, jcT("set_saved"));
    el("saveShell").focus();
  }, function(e){ busy("saveShell", false); shellMsg(false, jcErrText(e)); });
}

/* ---------- feedback (T5.3) ---------- */
var fbKind = "idea", fbDraft = "";
function wireFeedback(){
  var f = el("fbForm");
  if (!f) return;
  var t = el("fbBody");
  t.value = fbDraft;                       /* survives a language switch / tab change */
  t.addEventListener("input", function(){ fbDraft = t.value; });
  Array.prototype.forEach.call(f.querySelectorAll("[data-fbkind]"), function(b){
    b.addEventListener("click", function(){
      fbKind = b.dataset.fbkind;
      Array.prototype.forEach.call(f.querySelectorAll("[data-fbkind]"), function(x){ x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  if (location.hash === "#feedback") {
    el("feedback").scrollIntoView(); t.focus();
    try { history.replaceState(null, "", location.pathname + location.search); } catch(e){}   /* once, not on every redraw */
  }
  f.addEventListener("submit", function(e){
    e.preventDefault();
    var body = t.value.trim();
    if (!body) return showErr("FB_EMPTY");
    busy("fbSend", true);
    var sent = t.value;
    rpc("jc_feedback_send", { p_kind: fbKind, p_body: body, p_page: null })
      .then(function(){
        var t2 = el("fbBody");                 /* the form may have been redrawn meanwhile */
        if (t2 && t2.value === sent) { t2.value = ""; fbDraft = ""; }   /* keep anything typed while sending */
        busy("fbSend", false); showOk(jcT("fb_sent"));
      }, function(err){ busy("fbSend", false); showErr(err.code); });
  });
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
      mhTab = "household";
      try { history.replaceState(null, "", "?tab=household"); } catch(e){}
      show("myhome");
      showOk(jcFmt("invite_joined", { h: homeTitle() }));
    } else {
      show("notice", { text: jcT("invite_pending") });
    }
  }, function(e){ show("notice", { code: e.code }); });
}

/* ---------- boot ---------- */
function paint(){
  var name = jcCommunityName(cfg, state && state.me && state.me.community);
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcT("mh_title") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "home", cfg);
  jcHelp("home");                          /* also while claiming a home — that's what it explains (R3) */
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
