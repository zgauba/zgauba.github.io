/* Jubail Commons — shared client. Load after assets/vendor/supabase-*.js and
   assets/strings.js. One Supabase client per page.

   CONTRACT — every RPC goes through rpc(), which rejects on BOTH failure shapes:
   - a PostgREST error: the message is the RAISE code (MODULE_OFF, NOT_MEMBER, …)
   - an HTTP 200 whose top-level body has an "error" key (T3: BAD_CODE, BAD_ADMIN
     return instead of raise so the failure counter commits) — still a failure.
   Callers never see a "successful" failure. (Nested "error" keys, e.g. inside
   jc_admin_report's cleanup jobs, are data.) */

var JC_URL = "https://qrpxfssdeeuzmsmlbtbu.supabase.co";
var JC_KEY = "sb_publishable_cQKcp9tzYzeyrIO0Hzz6ZQ_jaxoq7QU"; /* publishable by design */

/* ?community=<slug> selects another community for this tab (the e2e smoke-test
   community). Harmless by design: the server derives a resident's community from
   their membership, never from client input; this only picks which join code and
   config the screens ask for. */
function jcCommunity(){
  var q = new URLSearchParams(location.search).get("community");
  try {
    if (q && /^[a-z][a-z0-9-]{1,30}$/.test(q)) sessionStorage.setItem("jc_community", q);
    return sessionStorage.getItem("jc_community") || "jubail";
  } catch(e){ return (q && /^[a-z][a-z0-9-]{1,30}$/.test(q)) ? q : "jubail"; }
}

/* Captured BEFORE createClient: the client consumes and clears auth fragments
   (#access_token…&type=recovery, #error_code=…) as soon as it is created, so a page
   reading location.hash afterwards would never know it was opened from a reset link. */
var JC_URL_HASH = location.hash;

var jcDb = supabase.createClient(JC_URL, JC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

function jcErr(code, detail){
  var e = new Error(code);
  e.code = code;
  e.detail = detail;
  return e;
}

/* Server codes are UPPER_SNAKE; anything else (network failure, JWT trouble,
   a Postgres message) is surfaced as NETWORK/UNKNOWN with the raw text kept. */
function jcCode(msg){
  msg = String(msg || "");
  if (/^[A-Z][A-Z0-9_]+$/.test(msg)) return msg;
  if (/fetch|network|load failed/i.test(msg)) return "NETWORK";
  return "UNKNOWN";
}

function rpc(name, args){
  return jcDb.rpc(name, args || {}).then(function(res){
    if (res.error) throw jcErr(jcCode(res.error.message), res.error);
    var d = res.data;
    if (d && typeof d === "object" && !Array.isArray(d) && d.error != null) {
      throw jcErr(jcCode(d.error), d);
    }
    return d;
  });
}

/* Human copy for an error: err_<CODE> from the strings dictionary, else generic. */
function jcErrText(e){
  var code = (e && e.code) || "UNKNOWN";
  var t = jcT("err_" + code);
  return t === "err_" + code ? jcT("err_UNKNOWN") : t;
}

/* Who is this device? Routing for every page:
   signed_out → account page; not_member → join code; member → me (home may be null). */
function jcState(){
  return jcDb.auth.getSession().then(function(r){
    var session = r.data && r.data.session;
    if (!session) return { status: "signed_out" };
    var email = session.user && session.user.email;
    return rpc("jc_me_get").then(function(me){
      return { status: "member", email: email, me: me };
    }, function(e){
      if (e.code === "NOT_MEMBER") return { status: "not_member", email: email };
      if (e.code === "NOT_SIGNED_IN") return { status: "signed_out" };
      throw e;
    });
  });
}

/* Post-sign-in destination: relative Commons paths only (never an open redirect). */
function jcSafeNext(next){
  return (typeof next === "string" && /^\.\.?\/[a-z0-9\/_-]*$/.test(next)) ? next : "../";
}

/* Anon-only RPCs (jc_config_get, jc_hit) skip the auth client on purpose: a broken
   stored session must never take down the public landing or silence the counter. */
function jcAnon(name, args, keepalive){
  return fetch(JC_URL + "/rest/v1/rpc/" + name, {
    method: "POST", keepalive: !!keepalive,
    headers: { "apikey": JC_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args || {})
  }).then(function(r){
    if (!r.ok) throw jcErr("NETWORK", "HTTP " + r.status);
    return r.text().then(function(t){ return t ? JSON.parse(t) : null; });  /* void RPCs: 204 / empty */
  });
}

/* First-party visit counter: page × hour totals only — no cookies, no IPs.
   Fire-and-forget: a failed count must never affect the page. A counter that
   stops is caught by the admin report (accounts > 0 but no hits in 24 h). */
function jcHit(page){
  try { jcAnon("jc_hit", { p_community: jcCommunity(), p_page: page }, true).catch(function(){}); } catch(e){}
}
