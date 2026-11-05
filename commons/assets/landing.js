/* Landing — two modes (wireframe v4.1 band 01):
   - signed out (or not yet a member): PLATFORM ENTRY — what Commons is, then
     "choose your community" with Sign in / Join per community.
   - signed-in member: the community HUB (module cards; T5.0b rebuilds it with
     the tab bar).
   Config comes from each community's row (DB is the only source of truth); the
   defaults render instantly and are kept, with a visible notice, if the fetch fails. */

/* SHORTCUT (approved 2026-11-03): the picker's community list is written here, not
   fetched — there is no public "list communities" RPC yet, and listing must never
   show the `e2e` test community. Replace with an anon list RPC + a `listed` flag
   when a second community arrives (UC-I1: new community = config row, no code). */
var LISTED = ["jubail"];
/* A community named in the link (?community=e2e — the smoke-test community) gets a
   card for THIS visitor only; it is never listed publicly. */
if (LISTED.indexOf(jcCommunity()) === -1) LISTED.push(jcCommunity());

var DEFAULT_CFG = {
  name_en: "Jubail Commons", name_ar: "كومنز الجبيل",
  modules: { events:{enabled:false}, bookings:{enabled:false}, pets:{enabled:false} },
  links: { halloween_archive: "https://zgauba.github.io/jubail-halloween/" },
  broadcast: ""
};

var cfgs = {};          /* community id → loaded config */
var mode = null;        /* null (deciding) | "picker" | "hub" */
var hubCommunity = null;
var authStatus = "signed_out";
var configFailed = false;

function cfgFor(id){ return cfgs[id] || (id === "jubail" ? DEFAULT_CFG : { name_en: id, modules: {} }); }
function nameOf(cfg){ return jcLang() === "ar" ? (cfg.name_ar || cfg.name_en) : cfg.name_en; }

/* A stored session exists → wait for jcState before choosing a mode (no flash of
   the picker for residents). None → the picker renders immediately, no network. */
function hasStoredSession(){
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (/-auth-token$/.test(localStorage.key(i) || "")) return true;
    }
  } catch(e){}
  return false;
}

function moduleCard(key, enabled){
  return '<div class="card">' + jcIcon(key, 26) + '<h2>' + esc(jcT("module_" + key)) + '</h2>' +
    '<p>' + esc(jcT("module_" + key + "_desc")) + '</p>' +
    (enabled ? '<a class="go" href="' + esc(key) + '/">' + esc(jcT("cta_" + key)) + '</a>'
             : '<span class="pill">' + esc(jcT("coming_soon")) + '</span>') + '</div>';
}

/* OVERRIDE GUARDRAIL (see tokens.css): a config row may re-skin brand tokens,
   but the four semantic signals are locked — a community that restyles a
   safety color breaks it for its residents. Drop, never trust. */
var RESERVED_TOKENS = ["--jc-info", "--jc-danger", "--jc-warn", "--jc-good"];
function applyBrandTokens(tokens){
  if (!tokens || typeof tokens !== "object") return;
  Object.keys(tokens).forEach(function(k){
    if (!/^--jc-[a-z0-9-]+$/.test(k)) return;               /* --jc-* keys only */
    if (RESERVED_TOKENS.indexOf(k) !== -1) return;          /* locked semantics */
    var v = String(tokens[k]);
    if (!/^[#a-zA-Z0-9(),.%\s-]+$/.test(v) || v.length > 64) return; /* colors/sizes only — no url()/javascript: */
    document.documentElement.style.setProperty(k, v);
  });
}

/* Only "Finish joining" (not_member) shows here. Signed out: the community card's
   Sign in / Join say it; member: the My Home tab is the account page. No duplicates. */
function renderAuth(){
  var label = authStatus === "not_member" ? "nav_finish_join" : null;
  el("authLink").hidden = !label;
  if (label) el("authLink").textContent = jcT(label);
}

function renderPicker(){
  document.title = jcT("platform_brand");
  el("brand").textContent = jcT("platform_brand");
  el("tagline").textContent = jcT("platform_lede");
  /* the four things a resident gets — The Community (map + directory) has no module
     flag: every member has it once their home is pinned */
  el("feats").innerHTML = ["events", "bookings", "pets", "community"].map(function(k){
    var title = JC_STRINGS.en["feat_" + k] ? jcT("feat_" + k) : jcT("module_" + k);
    return '<li>' + jcIcon(k, 24) + '<div><b>' + esc(title) + '</b>' + esc(jcT("module_" + k + "_desc")) + '</div></li>';
  }).join("");
  el("chooseTitle").textContent = jcT("choose_community");
  el("communities").innerHTML = LISTED.map(function(id){
    var cfg = cfgFor(id), q = "?community=" + encodeURIComponent(id);
    var other = jcLang() === "ar" ? cfg.name_en : cfg.name_ar;
    return '<div class="community" data-community="' + esc(id) + '">' +
      '<div class="who">' + jcIcon("mark", 34) +
        '<div class="names"><b>' + esc(nameOf(cfg)) + '</b>' + (other ? '<span>' + esc(other) + '</span>' : '') + '</div></div>' +
      '<div class="acts">' +
        '<a class="go" href="account/' + q + '">' + esc(jcT("community_signin")) + '</a>' +
        '<a class="go ghost" href="account/' + q + '&amp;view=join">' + esc(jcT("community_join")) + '</a>' +
      '</div></div>';
  }).join("");
  el("yours").textContent = jcT("your_community");
}

var hubHome = null;      /* the member's home (jc_me_get) — for the greeting */
function renderHub(){
  var cfg = cfgFor(hubCommunity), name = jcCommunityName(cfgs[hubCommunity], hubCommunity);
  document.title = name;
  el("brand").textContent = name;
  el("tagline").textContent = hubHome ? jcFmt("hub_hello", { h: jcHomeLabel(hubHome) }) : jcT("tagline");
  var mods = cfg.modules || {};
  /* The Community (map + directory) has no module flag; it lands later in T5 */
  el("cards").innerHTML = ["events", "bookings", "pets", "community"].map(function(k){
    return moduleCard(k, !!(mods[k] && mods[k].enabled));
  }).join("");
  jcTabBar("", "commons", cfg);
  var b = (cfg.broadcast || "").trim();
  el("bcast").textContent = b ? "⚠️ " + b : "";
  el("bcast").style.display = b ? "block" : "none";
}

function render(){
  el("langBtn").textContent = jcT("toggle_label");
  el("credit").innerHTML = esc(jcT("credit_before")) +
    '<a href="https://zgauba.github.io/" target="_blank" rel="noopener">' + esc(jcT("credit_name")) + '</a>' + esc(jcT("credit_after"));   /* own tab: Commons stays open (Zee) */
  /* T5.3: members can send ideas / feedback (My Home → Account) */
  if (!el("fbLink") && mode === "hub") {
    var fb = document.createElement("div");
    fb.className = "archive";
    fb.innerHTML = '<a id="fbLink" href="home/?tab=account#feedback"></a>';
    el("credit").parentNode.insertBefore(fb, el("credit"));
  }
  if (el("fbLink")) el("fbLink").textContent = jcT("fb_link");
  /* config-sourced links must be https — blocks javascript:/data: schemes if a
     config row were ever compromised */
  var archiveUrl = (cfgFor("jubail").links || {}).halloween_archive || "";
  if (!/^https:\/\//.test(archiveUrl)) archiveUrl = DEFAULT_CFG.links.halloween_archive;
  el("archiveLink").href = archiveUrl;
  el("archiveLink").textContent = jcT("archive_halloween");
  el("errbar").textContent = jcT("error_config");
  el("errbar").style.display = configFailed ? "block" : "none";
  renderAuth();
  el("picker").hidden = mode !== "picker";
  el("hub").hidden = mode !== "hub";
  if (mode === "picker") renderPicker();
  if (mode === "hub") renderHub();
}

function loadConfig(id){
  return jcAnon("jc_config_get", { p_community: id }).then(function(cfg){
    if (!cfg) throw new Error("empty");
    cfgs[id] = cfg;
  }).catch(function(){
    /* explicit failure state — never a silently blank page */
    configFailed = true;
  });
}

function setMode(m){
  mode = m;
  document.body.classList.toggle("mode-picker", m === "picker");
  if (m === "hub") applyBrandTokens(cfgFor(hubCommunity).tokens);
  render();
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(jcLang() === "ar" ? "en" : "ar");
  render();
});

jcSetLang(jcLang());
if (!hasStoredSession()) setMode("picker"); else render();
var listedLoaded = Promise.all(LISTED.map(loadConfig));
listedLoaded.then(function(){ if (mode === "picker") render(); });
jcHit("landing");
jcState().then(function(s){
  authStatus = s.status;
  if (s.status === "member" && s.me && s.me.community) {
    /* onboarding isn't finished until the home is claimed (wireframe band 02) */
    if (!s.me.home) { location.replace("home/"); return; }
    hubCommunity = s.me.community;
    hubHome = s.me.home;
    return (cfgs[hubCommunity] ? Promise.resolve() : loadConfig(hubCommunity))
      .then(function(){ setMode("hub"); });
  }
  return listedLoaded.then(function(){ setMode("picker"); });
}, function(){
  /* can't tell who this is (network) — the public entry is always safe to show */
  listedLoaded.then(function(){ setMode("picker"); });
});
