/* Landing (moved out of index.html for the CSP's script-src 'self').
   Config comes from the community's row in the Commons backend (DB is the only
   source of truth). These defaults render instantly and are overwritten — or
   kept, with a visible notice — if the fetch fails. */
var DEFAULT_CFG = {
  name_en: "Jubail Commons", name_ar: "كومنز الجبيل",
  modules: { events:{enabled:false}, bookings:{enabled:false}, pets:{enabled:false} },
  links: { halloween_archive: "https://zgauba.github.io/jubail-halloween/" },
  broadcast: ""
};

function moduleCard(key, enabled){
  return '<div class="card"><h2>' + esc(jcT("module_" + key)) + '</h2>' +
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

/* signed_out → "Sign in"; not_member → "Finish joining"; member → "Account".
   Unknown (network) → "Sign in": the account page sorts it out. */
var authStatus = "signed_out";
function renderAuth(){
  var label = authStatus === "member" ? "nav_account"
            : authStatus === "not_member" ? "nav_finish_join" : "nav_sign_in";
  el("authLink").textContent = jcT(label);
}

function render(cfg){
  var lang = jcLang();
  document.title = lang === "ar" ? cfg.name_ar || cfg.name_en : cfg.name_en;
  el("brand").textContent = lang === "ar" ? (cfg.name_ar || cfg.name_en) : cfg.name_en;
  el("tagline").textContent = jcT("tagline");
  el("langBtn").textContent = jcT("toggle_label");
  el("privacy").textContent = jcT("privacy_line");
  el("credit").textContent = jcT("footer_credit");
  renderAuth();
  var mods = cfg.modules || {};
  var html = "";
  ["events","bookings","pets"].forEach(function(k){
    html += moduleCard(k, !!(mods[k] && mods[k].enabled));
  });
  /* config-sourced links must be https — blocks javascript:/data: schemes if a
     config row were ever compromised (this page shares the github.io origin) */
  var archiveUrl = (cfg.links && cfg.links.halloween_archive) || "";
  if (!/^https:\/\//.test(archiveUrl)) archiveUrl = DEFAULT_CFG.links.halloween_archive;
  html += '<div class="card"><h2>' + esc(jcT("archive_halloween")) + '</h2>' +
    '<p>' + esc(jcT("archive_halloween_desc")) + '</p>' +
    '<a class="go" target="_blank" rel="noopener" href="' + esc(archiveUrl) + '">' + esc(jcT("archive_open")) + '</a></div>';
  el("cards").innerHTML = html;
  var b = (cfg.broadcast || "").trim();
  el("bcast").textContent = b ? "⚠️ " + b : "";
  el("bcast").style.display = b ? "block" : "none";
}

var currentCfg = DEFAULT_CFG;

function loadConfig(){
  return jcAnon("jc_config_get", { p_community: jcCommunity() }).then(function(cfg){
    if (!cfg) throw new Error("empty");
    currentCfg = cfg;
    applyBrandTokens(cfg.tokens);
    el("errbar").style.display = "none";
    render(currentCfg);
  }).catch(function(){
    /* explicit failure state — never a silently blank page */
    el("errbar").textContent = jcT("error_config");
    el("errbar").style.display = "block";
    render(currentCfg);
  });
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(jcLang() === "ar" ? "en" : "ar");
  render(currentCfg);
});

jcSetLang(jcLang());
render(DEFAULT_CFG);
loadConfig();
jcHit("landing");
jcState().then(function(s){ authStatus = s.status; renderAuth(); }, function(){});
