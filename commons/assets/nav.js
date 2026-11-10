/* Bottom tab bar (wireframe v4.1 band 04; R3a: the resident chooses it, docs/plans/R3-app-shell.md).
   A REGISTRY of destinations; each is offered only while available, re-checked on EVERY render
   against the live config the page just loaded (a module flag is the compliance kill switch):
   - a module destination needs its flag on AND its page to exist (page: false = not built yet;
     bookings/ shipped in R4c);
   - Organizer Tools needs some admin role (any admin scope, an event, or owner). Display only:
     every admin RPC is still gated by the server.
   My Home is never stored and never filtered: it is always the last button. */
var JC_DEST = [
  { key: "commons",   path: "",           icon: "mark",      label: "tab_home",         auto: true },
  { key: "events",    path: "events/",    icon: "events",    label: "module_events",    auto: true, module: "events",   page: true },
  { key: "bookings",  path: "bookings/",  icon: "bookings",  label: "module_bookings",  auto: true, module: "bookings", page: true },
  { key: "pets",      path: "pets/",      icon: "pets",      label: "feat_pets",        auto: true, module: "pets",     page: false },
  { key: "community", path: "community/", icon: "community", label: "module_community", auto: true,                     page: false },
  { key: "admin",     path: "admin/",     icon: "tools",     label: "tab_admin",        admin: true }
];
var JC_HOME_DEST = { key: "home", path: "home/", icon: "house", label: "tab_my_home" };
var JC_BAR_MAX = 4;                         /* middle buttons; + My Home = 5 (44 px targets) */

function jcDest(key){
  if (key === "home") return JC_HOME_DEST;
  for (var i = 0; i < JC_DEST.length; i++) if (JC_DEST[i].key === key) return JC_DEST[i];
  return null;
}
/* A destination's label: a module (and The Community) shows the community's own section name (RM). */
function jcDestLabel(d){
  return Object.prototype.hasOwnProperty.call(JC_MOD_NAME, d.key) ? jcModName(d.key) : jcT(d.label);   /* RM-ok */
}
function jcIsAdmin(me){
  me = me || {};
  return (Array.isArray(me.admin_scopes) && me.admin_scopes.length > 0) ||
         (Array.isArray(me.admin_events) && me.admin_events.length > 0) || me.is_owner === true;
}
function jcDestOk(key, me, cfg){
  var d = jcDest(key);
  if (!d) return false;
  if (key === "home") return true;
  if (d.admin) return jcIsAdmin(me);
  if (d.page === false) return false;
  if (d.module) {
    var mods = (cfg && cfg.modules) || {};
    var m = Object.prototype.hasOwnProperty.call(mods, d.module) ? mods[d.module] : null;
    return !!(m && m.enabled === true);
  }
  return true;
}

/* The saved choices, strictly read (prefs is stored JSON: never trusted, never rendered —
   only matched against the registry). Shape: account.prefs.shell =
   { v: 1, tabs: [key…], start: key, known: [key…] }. Anything unexpected → null (= the default
   bar). Unknown keys inside tabs/known are dropped one by one (a newer client may know more). */
function jcShellSaved(me){
  var p = me && me.account && me.account.prefs;
  if (!p || typeof p !== "object" || Array.isArray(p) || !Object.prototype.hasOwnProperty.call(p, "shell")) return null;
  var s = p.shell;
  if (!s || typeof s !== "object" || Array.isArray(s) || s.v !== 1) return null;
  function keys(a){
    if (!Array.isArray(a) || a.length > 12) return null;
    var out = [];
    a.forEach(function(k){ if (typeof k === "string" && k !== "home" && jcDest(k) && out.indexOf(k) < 0) out.push(k); });
    return out;
  }
  var tabs = keys(s.tabs);
  if (!tabs) return null;
  return { tabs: tabs, known: keys(s.known) || [],
           start: typeof s.start === "string" && jcDest(s.start) ? s.start : "commons" };
}

/* What to draw now: { tabs: middle keys in order (≤ 4), start: a key available now, saved }.
   No saved choice = Commons · live modules (today's bar). Saved: the chosen ones still available,
   plus any destination that became available since the save (not in `known`) while there is room,
   so a customised bar never hides a module switched on later. A saved Courts while Courts is off
   stays saved and comes back with the module. */
function jcShell(me, cfg){
  var saved = jcShellSaved(me);
  var ok = function(k){ return jcDestOk(k, me, cfg); };
  var tabs;
  if (!saved) tabs = JC_DEST.filter(function(d){ return d.auto && ok(d.key); }).map(function(d){ return d.key; });
  else {
    tabs = saved.tabs.filter(ok);
    JC_DEST.forEach(function(d){
      if (d.auto && ok(d.key) && saved.known.indexOf(d.key) < 0 && tabs.indexOf(d.key) < 0) tabs.push(d.key);
    });
  }
  return { tabs: tabs.slice(0, JC_BAR_MAX), start: saved && ok(saved.start) ? saved.start : "commons", saved: saved };
}

/* root = relative path to the Commons root from the current page ("" or "../"). */
function jcTabBar(root, active, cfg){
  var items = jcShell(JC_ME, cfg).tabs.map(jcDest);
  items.push(JC_HOME_DEST);                  /* outside every filter: the bar is never empty */

  var nav = el("tabbar");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "tabbar";
    nav.className = "tabbar";
    document.body.appendChild(nav);
    document.body.classList.add("has-tabbar");
  }
  nav.setAttribute("aria-label", jcT("tab_bar_label"));   /* not "Commons": that is its first button (P2) */
  nav.innerHTML = items.map(function(it){
    return '<a href="' + esc((root + it.path) || "./") + '" data-tab="' + esc(it.key) + '"' +
      (it.key === active ? ' aria-current="page"' : '') + '>' +
      jcIcon(it.icon, 20) + '<span dir="auto">' + esc(jcDestLabel(it)) + '</span></a>';
  }).join("");
  /* RM: a renamed section may take two lines — the page keeps clear of the bar's real height, re-measured
     whenever the bar changes size (fonts loading, rotation, text zoom) (review M3) */
  var fit = function(){ document.body.style.paddingBottom = Math.max(nav.offsetHeight, 60) + "px"; };
  fit();
  if (!nav.jcFit && window.ResizeObserver) { nav.jcFit = new ResizeObserver(fit); nav.jcFit.observe(nav); }
  jcBanner(cfg);
  var back = el("jcBackBtn");                 /* language switch: the back label follows (review) */
  if (back) back.setAttribute("aria-label", jcT(back.dataset.key));
}

/* Sub-tab rows (R3c, WAI-ARIA tabs): event Map · List · Sign-Up, My Home, Organizer Tools.
   jcTabsHtml → the row; the page wraps its content in jcTabPanel(...) and calls jcTabsWire after
   setting innerHTML. Selecting a tab re-renders the page (pick), then focus goes back to the new
   selected tab. Keys: ←/→ (mirrored in right-to-left), Home/End; selection follows focus. One tab
   is in the Tab order (roving tabindex). prefix + key = each tab's id. */
function jcTabsHtml(prefix, keys, selected, labelOf, name, panelId){
  return '<div class="subtabs" role="tablist" aria-label="' + esc(name) + '">' + keys.map(function(k){
    var on = k === selected;
    return '<button type="button" role="tab" id="' + esc(prefix + k) + '" aria-selected="' + on + '"' +
      ' aria-controls="' + esc(panelId) + '" tabindex="' + (on ? 0 : -1) + '">' + esc(labelOf(k)) + '</button>';
  }).join("") + '</div>';
}
function jcTabPanel(prefix, selected, panelId){
  return 'id="' + esc(panelId) + '" role="tabpanel" aria-labelledby="' + esc(prefix + selected) + '"';
}
function jcTabsWire(prefix, keys, pick){
  function go(k){
    pick(k);                                       /* a click on the selected tab still redraws (as before) */
    if (el(prefix + k)) el(prefix + k).focus();   /* the row was redrawn: keyboard focus stays on the tab */
  }
  keys.forEach(function(k, i){
    var b = el(prefix + k);
    if (!b) return;
    b.addEventListener("click", function(){ go(k); });
    b.addEventListener("keydown", function(e){
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   /* Alt/Cmd+← is the browser's Back */
      var rtl = document.documentElement.getAttribute("dir") === "rtl";
      var n = keys.length, j = null;
      if (e.key === "ArrowRight") j = rtl ? i - 1 : i + 1;
      else if (e.key === "ArrowLeft") j = rtl ? i + 1 : i - 1;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = n - 1;
      if (j === null) return;
      e.preventDefault();
      j = (j + n) % n;
      if (j !== i) go(keys[j]);
    });
  });
}

/* P5 (R3c): a whole-view redraw (innerHTML) drops keyboard / screen-reader focus to <body>.
   var done = jcFocusKeep(); …redraw…; done(): if nothing in the new view took focus, put it back on
   the same control (by id) when it still exists, else on the selected tab or the view's heading.
   Does nothing when focus wasn't in use (a page load, a tap in Safari long ago). */
var jcFocusLast = null;
document.addEventListener("focusin", function(e){
  if (e.target && e.target !== document.body) jcFocusLast = { id: e.target.id || null, t: Date.now() };
});
/* a tap on blank space means "I left that control": don't pull focus back on the next redraw (review L2) */
document.addEventListener("pointerdown", function(e){
  if (!(e.target && e.target.closest && e.target.closest("button, a, input, textarea, select, summary, [tabindex]"))) jcFocusLast = null;
}, true);
function jcFocusKeep(){
  var a = document.activeElement;
  var had = a && a !== document.body ? { id: a.id || null }
          : jcFocusLast && Date.now() - jcFocusLast.t < 20000 ? jcFocusLast : null;
  return function(){
    var now = document.activeElement;
    if (!had || (now && now !== document.body && document.contains(now))) return;
    var t = had.id && el(had.id);
    if (!t || t.disabled || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !t.offsetParent)
      t = document.querySelector('#view [role="tab"][aria-selected="true"]') || document.querySelector("#view h1, #view h2");
    if (!t) return;
    if (!/^(A|BUTTON)$/.test(t.tagName) && !t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
  };
}

/* The organizers' banner (jc_admin_broadcast_set) on every member page (T5.2 PR 4).
   The hub draws its own #bcast; other pages get one at the top of <main>. */
function jcBanner(cfg){
  if (el("bcast")) return;
  var b = ((cfg && cfg.broadcast) || "").trim();
  var box = el("jcBanner");
  if (!b) { if (box) box.remove(); return; }
  if (!box) {
    var main = document.querySelector("main");
    if (!main) return;
    box = document.createElement("div");
    box.id = "jcBanner";
    box.className = "bcast";
    box.setAttribute("role", "status");
    box.setAttribute("dir", "auto");     /* the banner may be English or Arabic */
    main.insertBefore(box, main.firstChild);
  }
  box.textContent = "⚠️ " + b;
}

/* Back, in the top bar left of the logo (Zee, 2026-11-04 — replaces "‹ Events" lines).
   target = a URL, a function, or null to remove it; labelKey = a strings key (default "back").
   Flipped for right-to-left. */
function jcBack(target, labelKey){
  var bar = document.querySelector(".topbar");
  if (!bar) return;
  var b = el("jcBackBtn");
  if (!target) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement("a");
    b.id = "jcBackBtn";
    b.className = "back";
    b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    bar.insertBefore(b, bar.firstChild);
  }
  b.dataset.key = labelKey || "back";
  b.setAttribute("aria-label", jcT(b.dataset.key));
  if (typeof target === "function") {
    b.href = "#";
    b.onclick = function(e){ e.preventDefault(); target(); };
  } else { b.href = target; b.onclick = null; }
}

/* "?" help in the top bar, next to the language button (Zee, 2026-11-06). key → strings
   help_<key>_title + help_<key>_1…n, built when opened so it follows the language. **x** = bold. */
function jcHelp(key){
  var bar = document.querySelector(".topbar");
  if (!bar) return;
  var b = el("jcHelpBtn");
  if (!key) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement("button");
    b.type = "button"; b.id = "jcHelpBtn"; b.className = "lang help-btn"; b.textContent = "?";
    b.setAttribute("aria-haspopup", "dialog");
    bar.insertBefore(b, el("langBtn"));
    b.addEventListener("click", function(){ jcHelpOpen(b.dataset.key); });
    /* pages can switch language without re-rendering (a half-filled form): keep the label current (R4) */
    var lb = el("langBtn");
    if (lb) lb.addEventListener("click", function(){ setTimeout(function(){ b.setAttribute("aria-label", jcT("help")); }, 0); });
  }
  b.dataset.key = key;
  b.setAttribute("aria-label", jcT("help"));
}
function jcHelpOpen(key){
  var d = el("jcHelp");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "jcHelp"; d.className = "sheet";
    document.body.appendChild(d);
    d.addEventListener("click", function(e){        /* a tap outside the window closes it */
      if (e.target !== d) return;
      var r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) jcHelpClose(d);
    });
  }
  var items = [];
  for (var i = 1; i <= 12; i++) {
    var k = "help_" + key + "_" + i, t = jcT(k);
    if (t === k) break;
    items.push("<li>" + esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") + "</li>");
  }
  /* RM: the Events / Courts sheets are titled with the section's own name */
  var head = key === "events" ? jcModName("events") : key === "courts" ? jcModName("bookings") : jcT("help_" + key + "_title");   /* RM-ok */
  d.setAttribute("aria-label", head);
  d.innerHTML = '<div class="sheethead"><h2 dir="auto">' + esc(head) + '</h2>' +
    '<button type="button" class="lang" id="jcHelpClose">' + esc(jcT("close")) + '</button></div>' +
    '<ul class="helplist">' + items.join("") + '</ul>';
  el("jcHelpClose").addEventListener("click", function(){ jcHelpClose(d); });
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
}
function jcHelpClose(d){ if (d.close) d.close(); else d.removeAttribute("open"); }
