/* Bottom tab bar (wireframe v4.1 band 04). Commons first and My Home last are
   fixed anchors; the middle holds live modules — default Events + Courts (the
   user-chosen slots setting arrives with account prefs later). A module whose flag
   is off drops out for everyone (the flag is the compliance kill switch).
   root = relative path to the Commons root from the current page ("" or "../"). */
function jcTabBar(root, active, cfg){
  var mods = (cfg && cfg.modules) || {};
  var items = [{ key: "commons", href: root || "./", icon: "mark", label: jcT("tab_home") }];
  ["events", "bookings"].forEach(function(k){
    if (mods[k] && mods[k].enabled) items.push({ key: k, href: root + k + "/", icon: k, label: jcT("module_" + k) });
  });
  items.push({ key: "home", href: root + "home/", icon: "house", label: jcT("tab_my_home") });

  var nav = el("tabbar");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "tabbar";
    nav.className = "tabbar";
    document.body.appendChild(nav);
    document.body.classList.add("has-tabbar");
  }
  nav.setAttribute("aria-label", jcT("tab_home"));
  nav.innerHTML = items.map(function(it){
    return '<a href="' + esc(it.href) + '" data-tab="' + esc(it.key) + '"' +
      (it.key === active ? ' aria-current="page"' : '') + '>' +
      jcIcon(it.icon, 20) + '<span>' + esc(it.label) + '</span></a>';
  }).join("");
  jcBanner(cfg);
  var back = el("jcBackBtn");                 /* language switch: the back label follows (review) */
  if (back) back.setAttribute("aria-label", jcT(back.dataset.key));
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
  d.setAttribute("aria-label", jcT("help_" + key + "_title"));
  d.innerHTML = '<div class="sheethead"><h2>' + esc(jcT("help_" + key + "_title")) + '</h2>' +
    '<button type="button" class="lang" id="jcHelpClose">' + esc(jcT("ev_labels_close")) + '</button></div>' +
    '<ul class="helplist">' + items.join("") + '</ul>';
  el("jcHelpClose").addEventListener("click", function(){ jcHelpClose(d); });
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
}
function jcHelpClose(d){ if (d.close) d.close(); else d.removeAttribute("open"); }
