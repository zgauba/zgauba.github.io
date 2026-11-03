/* Account page: sign in · join (code → account → jc_join) · forgot · recover.
   UC-A1–A3. The join code is asked FIRST and held in memory only (never stored);
   jc_join checks it server-side after the account exists. A wrong code leaves a
   signed-in, not-yet-member account — retrying with the same account works (T3),
   and never-joined accounts are purged after 30 days (T4c). */

/* From api.js's pre-client capture — the client may already have cleared the URL.
   PKCE: a reset link returns as ?code=…; the client exchanges it only if this
   browser requested the reset, then announces PASSWORD_RECOVERY. */
var HAS_CODE = /[?&]code=/.test(JC_URL_SEARCH);
var LINK_ERROR = /error_code=/.test(JC_URL_HASH + JC_URL_SEARCH);
var RECOVERING = false;
var params = new URLSearchParams(location.search);
var NEXT = jcSafeNext(params.get("next"));

var joinCode = "";      /* code step → account step; memory only */
var state = null;       /* last jcState() */

/* Supabase Auth errors → our codes (err_* strings). Codes first, messages as a
   fallback for servers that predate error codes. */
function authCode(err){
  if (!err) return "UNKNOWN";
  var c = err.code || "", m = String(err.message || "");
  /* before the /password should be/ fallback: GoTrue's same_password message
     ("New password should be different…") would otherwise read as WEAK_PASSWORD */
  if (c === "same_password") return "SAME_PASSWORD";
  if (c === "session_not_found" || err.name === "AuthSessionMissingError") return "LINK_EXPIRED";
  if (c === "user_already_exists" || c === "email_exists" || /already registered/i.test(m)) return "EMAIL_TAKEN";
  if (c === "invalid_credentials" || /invalid login/i.test(m)) return "BAD_LOGIN";
  if (c === "weak_password" || /password should be/i.test(m)) return "WEAK_PASSWORD";
  if (c === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(m)) return "BAD_EMAIL";
  if (c === "over_request_rate_limit" || c === "over_email_send_rate_limit" || err.status === 429) return "AUTH_LIMIT";
  if (c === "email_not_confirmed") return "CONFIRM_REQUIRED";
  if (err.name === "AuthRetryableFetchError" || err.status === 0 || /fetch/i.test(m)) return "NETWORK";
  return "UNKNOWN";
}

function field(id, labelKey, type, autocomplete){
  return '<label>' + esc(jcT(labelKey)) +
    '<input id="' + id + '" type="' + type + '" autocomplete="' + autocomplete + '" required></label>';
}
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){ var m = el("msg"); m.className = "msg err"; m.textContent = jcErrText({ code: code }); }
function showOk(text){ var m = el("msg"); m.className = "msg ok"; m.textContent = text; }
function busy(btnId, on){
  var b = el(btnId);
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = jcT("working"); b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}
function linkBtn(id, key){ return '<button type="button" id="' + id + '">' + esc(jcT(key)) + '</button>'; }
function on(id, fn){ var n = el(id); if (n) n.addEventListener("click", fn); }
function onSubmit(fn){ el("form").addEventListener("submit", function(ev){ ev.preventDefault(); fn(); }); }

/* ---------- views ---------- */
var VIEWS = {
  signin: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("acct_signin_title")) + '</h1>' +
      '<form class="panel" id="form" novalidate>' +
        field("email", "acct_email", "email", "email") +
        field("password", "acct_password", "password", "current-password") +
        msgBox() +
        '<button class="btn" id="go" type="submit">' + esc(jcT("acct_signin_btn")) + '</button>' +
      '</form>' +
      '<div class="links">' + linkBtn("toForgot", "acct_forgot") + linkBtn("toJoin", "acct_join_prompt") + '</div>';
    on("toForgot", function(){ show("forgot"); });
    on("toJoin", function(){ show("code"); });
    onSubmit(doSignIn);
  },

  code: function(){
    var signedIn = state && state.status === "not_member";
    el("view").innerHTML =
      '<h1>' + esc(jcT("join_title")) + '</h1>' +
      (signedIn ? '<p class="who">' + esc(jcT("acct_signed_in_as")) + ' <b>' + esc(state.email) + '</b></p>' : '') +
      /* ?community= override (e2e smoke test): never let it be silent */
      (jcCommunity() !== "jubail" ? '<p class="who">' + esc(jcT("join_community")) + ' <b>' + esc(jcCommunity()) + '</b></p>' : '') +
      '<form class="panel" id="form" novalidate>' +
        '<label>' + esc(jcT("join_code_label")) +
          '<input id="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>' +
        '<p class="help">' + esc(jcT("join_code_help")) + '</p>' +
        msgBox() +
        '<button class="btn" id="go" type="submit">' + esc(jcT("join_continue")) + '</button>' +
      '</form>' +
      '<div class="links">' +
        (signedIn ? linkBtn("signOut", "acct_sign_out") : linkBtn("toSignin", "acct_have_account")) +
      '</div>';
    el("code").value = joinCode;
    on("toSignin", function(){ show("signin"); });
    on("signOut", doSignOut);
    onSubmit(function(){
      joinCode = el("code").value.trim();
      if (!joinCode) return showErr("CODE_MISSING");
      if (signedIn) return doJoin("go");
      show("account");
    });
  },

  account: function(){
    if (!joinCode) return show("code");
    el("view").innerHTML =
      '<h1>' + esc(jcT("join_account_title")) + '</h1>' +
      '<form class="panel" id="form" novalidate>' +
        field("email", "acct_email", "email", "email") +
        field("password", "acct_password_new", "password", "new-password") +
        '<p class="help" id="privacy">' + esc(jcT("join_privacy")) + '</p>' +
        msgBox() +
        '<button class="btn" id="go" type="submit">' + esc(jcT("join_create_btn")) + '</button>' +
      '</form>' +
      '<div class="links">' + linkBtn("back", "acct_back") + '</div>';
    on("back", function(){ show("code"); });
    onSubmit(doSignUp);
  },

  forgot: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("forgot_title")) + '</h1>' +
      '<form class="panel" id="form" novalidate>' +
        field("email", "acct_email", "email", "email") +
        msgBox() +
        '<button class="btn" id="go" type="submit">' + esc(jcT("forgot_btn")) + '</button>' +
      '</form>' +
      '<div class="links">' + linkBtn("toSignin", "acct_back") + '</div>';
    on("toSignin", function(){ show("signin"); });
    onSubmit(doForgot);
  },

  recover: function(){
    el("view").innerHTML =
      '<h1>' + esc(jcT("recover_title")) + '</h1>' +
      '<form class="panel" id="form" novalidate>' +
        field("password", "acct_password_new", "password", "new-password") +
        msgBox() +
        '<button class="btn" id="go" type="submit">' + esc(jcT("recover_btn")) + '</button>' +
      '</form>' +
      '<div class="links">' + linkBtn("toForgot", "acct_forgot") + '</div>';
    on("toForgot", function(){ show("forgot"); });
    onSubmit(doRecover);
  },

  member: function(){
    var home = state.me && state.me.home;
    el("view").innerHTML =
      '<div class="panel">' +
        '<p class="who">' + esc(jcT("acct_signed_in_as")) + ' <b>' + esc(state.email) + '</b></p>' +
        (home ? '' : '<p class="help">' + esc(jcT("acct_no_home")) + '</p>') +
        '<a class="btn" href="' + esc(NEXT) + '">' + esc(jcT("acct_continue")) + '</a>' +
        '<button class="btn ghost" type="button" id="signOut">' + esc(jcT("acct_sign_out")) + '</button>' +
      '</div>';
    on("signOut", doSignOut);
  }
};

var current = "signin";
function show(name){ current = name; VIEWS[name](); var f = document.querySelector("#view input"); if (f) f.focus(); }

/* ---------- actions ---------- */
function val(id){ return el(id).value.trim(); }

function afterAuth(){
  return jcState().then(function(s){
    state = s;
    if (s.status === "member") { location.href = NEXT; return; }
    if (s.status === "not_member") { show("code"); return; }
    show("signin");
  });
}

function doSignIn(){
  busy("go", true);
  jcDb.auth.signInWithPassword({ email: val("email"), password: el("password").value })
    .then(function(r){
      if (r.error) throw jcErr(authCode(r.error), r.error);
      return afterAuth();
    })
    .catch(function(e){ busy("go", false); showErr(e.code || "UNKNOWN"); });
}

function doSignUp(){
  var pw = el("password").value;
  if (pw.length < 8) return showErr("WEAK_PASSWORD");
  busy("go", true);
  jcDb.auth.signUp({ email: val("email"), password: pw })
    .then(function(r){
      if (r.error) throw jcErr(authCode(r.error), r.error);
      /* Email confirmation is OFF by decision (manifest, Auth layer). No session
         here means the dashboard drifted — say so instead of failing silently. */
      if (!r.data || !r.data.session) throw jcErr("CONFIRM_REQUIRED");
      return doJoin("go");
    })
    .catch(function(e){ busy("go", false); showErr(e.code || "UNKNOWN"); });
}

/* jc_join: BAD_CODE comes back as HTTP 200 + {"error"} — rpc() rejects it. */
function doJoin(btnId){
  busy(btnId, true);
  return rpc("jc_join", { p_community: jcCommunity(), p_code: joinCode })
    .then(function(){ joinCode = ""; return afterAuth(); })
    .catch(function(e){
      return jcState().catch(function(){ return state; }).then(function(s){
        state = s || state;
        if (current !== "code") show("code");
        busy(btnId, false);
        showErr(e.code || "UNKNOWN");
      });
    });
}

function doForgot(){
  busy("go", true);
  /* Same answer whether or not the email has an account (UC-A2: don't leak). */
  jcDb.auth.resetPasswordForEmail(val("email"), { redirectTo: location.origin + location.pathname })
    .then(function(r){
      busy("go", false);
      if (r.error && authCode(r.error) === "AUTH_LIMIT") return showErr("AUTH_LIMIT");
      if (r.error && authCode(r.error) === "NETWORK") return showErr("NETWORK");
      showOk(jcT("forgot_sent"));
    });
}

function doRecover(){
  var pw = el("password").value;
  if (pw.length < 8) return showErr("WEAK_PASSWORD");
  busy("go", true);
  jcDb.auth.updateUser({ password: pw })
    .then(function(r){
      if (r.error) throw jcErr(authCode(r.error), r.error);
      RECOVERING = false;
      return afterAuth();
    })
    .catch(function(e){ busy("go", false); showErr(e.code || "UNKNOWN"); });
}

function doSignOut(){
  jcDb.auth.signOut().then(function(){ state = { status: "signed_out" }; show("signin"); });
}

/* ---------- boot ---------- */
/* Header = the chosen community's name from its config (falls back to the
   strings brand); the link goes back to the platform entry. */
var communityCfg = null;
function paint(){
  var name = communityCfg
    ? (jcLang() === "ar" ? (communityCfg.name_ar || communityCfg.name_en) : communityCfg.name_en)
    : jcT("brand");
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = name;
}
jcAnon("jc_config_get", { p_community: jcCommunity() })
  .then(function(cfg){ if (cfg) { communityCfg = cfg; paint(); } })
  .catch(function(){});

el("langBtn").addEventListener("click", function(){
  jcSetLang(jcLang() === "ar" ? "en" : "ar");
  paint();
  /* re-render the current view; typed values are lost only on the toggle itself */
  show(current);
});

/* The client may announce recovery more than once (exchange + post-init notify);
   re-rendering would wipe a half-typed password. */
jcDb.auth.onAuthStateChange(function(event){
  if (event === "PASSWORD_RECOVERY") {
    RECOVERING = true;
    if (current !== "recover") show("recover");
  }
});

function routeNormally(){
  return jcState().then(function(s){
    state = s;
    if (s.status === "member") return show("member");
    if (s.status === "not_member") return show("code");
    show(params.get("view") === "join" ? "code" : "signin");
  }, function(e){
    state = { status: "signed_out" };
    show("signin");
    showErr(e.code || "UNKNOWN");
  });
}

/* A reset link: let the client finish the code exchange (getSession awaits its
   init). The only ?code= Commons ever issues is a password reset (no magic links,
   no OAuth), so code + session = recovery — decided here, not by waiting for the
   client's PASSWORD_RECOVERY notice, whose timing varies (it lost the race under
   load: flaky in tests, a stuck screen on a slow phone). If magic links or OAuth
   are ever added, this must learn the redirect type. No session ⇒ the link was
   expired, reused, or opened in another browser (no PKCE verifier there). */
function routeFromLink(){
  el("view").innerHTML = '<p class="sub">' + esc(jcT("working")) + '</p>';
  return jcDb.auth.getSession().then(function(r){
    try { history.replaceState(null, "", location.pathname); } catch(e){}
    if (r.data && r.data.session) {
      RECOVERING = true;
      if (current !== "recover") show("recover");
      return;
    }
    show("forgot");
    showErr("LINK_EXPIRED");
  });
}

jcSetLang(jcLang());
paint();
if (LINK_ERROR) {
  LINK_ERROR = false;
  show("forgot");
  showErr("LINK_EXPIRED");
} else if (HAS_CODE) {
  routeFromLink();
} else {
  routeNormally();
}
