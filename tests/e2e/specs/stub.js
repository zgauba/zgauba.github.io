// Stub backend for the Commons Supabase project: PostgREST RPCs + Supabase Auth.
// Every request to the project host is intercepted; an RPC without a handler
// fails loudly (404 NO_STUB) so a test can never pass by silently hitting nothing.
// A request that escapes to any other host fails the test (see `escaped`).
const SB = "https://qrpxfssdeeuzmsmlbtbu.supabase.co";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

// Unsigned but well-formed JWT: the client only decodes it, the stub only compares it.
function fakeJwt(email) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: "00000000-0000-4000-8000-000000000001", email, role: "authenticated",
             aud: "authenticated", iat: now, exp: now + 3600 }),
    "sig",
  ].join(".");
}

function user(email) {
  return { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
           email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-11-03T00:00:00Z" };
}

function session(email) {
  return { access_token: fakeJwt(email), token_type: "bearer", expires_in: 3600,
           expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "rt-" + email,
           user: user(email) };
}

const ok = (body) => ({ status: 200, body });
const raise = (code) => ({ status: 400, body: { code: "P0001", message: code, details: null, hint: null } });

const MEMBER_NO_HOME = { community: "jubail", account: { email: "a@example.com", display_name: null }, home: null, admin_scopes: [] };
const HOME_V12 = { id: "h1", village: "ain-al-maha", type: "villa", building: null, number: "12",
                   lat: null, lng: null, pin_set_at: null,
                   members: [{ you: true, name: "a***@example.com", joined_at: "2026-11-03T00:00:00Z" }] };
const MEMBER = Object.assign({}, MEMBER_NO_HOME, { home: HOME_V12 });

const CONFIG = {
  id: "jubail", name_en: "Jubail Commons", name_ar: "كومنز الجبيل",
  modules: { events: { enabled: false }, bookings: { enabled: false }, pets: { enabled: false } },
  links: { halloween_archive: "https://zgauba.github.io/jubail-halloween/" }, broadcast: "",
  map: { lat: 24.53, lng: 54.43, zoom: 15 },
  villages: [
    { key: "ain-al-maha", en: "Ain Al Maha", ar: "عين المها", status: "delivered", delivery: null, parent: null },
    { key: "bada-al-jubail", en: "Bada Al Jubail", ar: null, status: "upcoming", delivery: "Late 2027", parent: null },
    { key: "seef-al-jubail", en: "Seef Al Jubail", ar: null, status: "delivered", delivery: null, parent: null },
  ],
};

/**
 * stubBackend(page, { rpc: {name: (args, ctx) => {status, body}}, auth: {...overrides} })
 * ctx.signedIn — the request carried a user access token.
 * Returns { calls } — every intercepted request as { kind, name, args, signedIn }.
 */
async function stubBackend(page, opts = {}) {
  const calls = [];
  const escaped = [];
  const rpcHandlers = Object.assign({
    jc_config_get: () => ok(CONFIG),
    jc_hit: () => ({ status: 204, body: null }),
    jc_me_get: (args, ctx) => (ctx.signedIn ? ok(MEMBER) : raise("NOT_SIGNED_IN")),
  }, opts.rpc || {});
  const authHandlers = Object.assign({
    signup: (b) => ok(session(b.email)),
    password: (b) => (b.password === "correct-horse" ? ok(session(b.email))
      : { status: 400, body: { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" } }),
    recover: () => ok({}),
    getUser: (email) => ok(user(email || "a@example.com")),
    putUser: (b, email) => ok(user(email || "a@example.com")),
    logout: () => ({ status: 204, body: null }),
  }, opts.auth || {});

  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route) => {
    const req = route.request();
    // map tiles (Esri / OSM): answered empty, never fetched, not counted as escapes
    if (/^https:\/\/(server\.arcgisonline\.com|tile\.openstreetmap\.org)\//.test(req.url())) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (!req.url().startsWith(SB)) {
      escaped.push(req.url());
      return route.abort();
    }
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const authz = req.headers()["authorization"] || "";
    const token = authz.replace(/^Bearer\s+/i, "");
    const signedIn = token.split(".").length === 3;
    const tokenEmail = signedIn ? JSON.parse(Buffer.from(token.split(".")[1], "base64url")).email : null;
    let args = {};
    try { args = req.postDataJSON() || {}; } catch (e) { args = {}; }

    let res;
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").pop();
      calls.push({ kind: "rpc", name, args, signedIn });
      const h = rpcHandlers[name];
      res = h ? h(args, { signedIn }) : { status: 404, body: { message: "NO_STUB " + name } };
    } else if (url.pathname === "/auth/v1/signup") {
      calls.push({ kind: "auth", name: "signup", args, signedIn });
      res = authHandlers.signup(args);
    } else if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      calls.push({ kind: "auth", name: "token:" + grant, args, signedIn });
      res = grant === "password" ? authHandlers.password(args) : ok(session(tokenEmail || "a@example.com"));
    } else if (url.pathname === "/auth/v1/recover") {
      calls.push({ kind: "auth", name: "recover", args, signedIn, redirect: url.searchParams.get("redirect_to") });
      res = authHandlers.recover(args);
    } else if (url.pathname === "/auth/v1/user") {
      calls.push({ kind: "auth", name: req.method() === "PUT" ? "putUser" : "getUser", args, signedIn });
      res = req.method() === "PUT" ? authHandlers.putUser(args, tokenEmail) : authHandlers.getUser(tokenEmail);
    } else if (url.pathname === "/auth/v1/logout") {
      calls.push({ kind: "auth", name: "logout", args, signedIn });
      res = authHandlers.logout();
    } else {
      calls.push({ kind: "unknown", name: url.pathname, args, signedIn });
      res = { status: 404, body: { message: "NO_STUB " + url.pathname } };
    }
    return route.fulfill({
      status: res.status,
      headers: Object.assign({ "content-type": "application/json" }, CORS),
      body: res.body == null ? "" : JSON.stringify(res.body),
    });
  });
  return { calls, escaped };
}

module.exports = { stubBackend, ok, raise, session, fakeJwt, CONFIG, MEMBER_NO_HOME, MEMBER, HOME_V12 };
