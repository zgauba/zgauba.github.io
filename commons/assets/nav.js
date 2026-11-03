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
      jcIcon(it.icon, 22) + '<span>' + esc(it.label) + '</span></a>';
  }).join("");
}
