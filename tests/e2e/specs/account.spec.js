// Account page: sign in, join (code-first), T3 error contract, reset/recover.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, fakeJwt, MEMBER_NO_HOME } = require("./stub");

const joined = { member: false };
// jc_me_get answers NOT_MEMBER until jc_join succeeds — the real server's behaviour.
function joinFlowRpc(joinHandler) {
  joined.member = false;
  return {
    jc_me_get: (a, ctx) => (!ctx.signedIn ? raise("NOT_SIGNED_IN")
      : joined.member ? ok(MEMBER_NO_HOME) : raise("NOT_MEMBER")),
    jc_join: (a, ctx) => {
      const r = joinHandler(a, ctx);
      if (r.status === 200 && !(r.body && r.body.error)) joined.member = true;
      return r;
    },
  };
}

async function signIn(page, password) {
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill(password);
  await page.locator("#go").click();
}

test("sign in → member → lands on Commons", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await page.goto("account/");
  await signIn(page, "correct-horse");
  await expect(page).toHaveURL(/\/commons\/$/);
  expect(calls.some((c) => c.name === "token:password")).toBe(true);
});

test("wrong password shows a friendly error, stays on sign-in", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/");
  await signIn(page, "nope");
  await expect(page.locator("#msg")).toHaveText("Email or password is incorrect.");
  await expect(page.locator("#go")).toBeEnabled();
});

test("join: code first → account → jc_join with community + code → in", async ({ page }) => {
  const { calls } = await stubBackend(page, { rpc: joinFlowRpc(() => ok(MEMBER_NO_HOME)) });
  await page.goto("account/?view=join");
  await page.locator("#code").fill("ABCD-EFGH-JK");
  await page.locator("#go").click();
  await expect(page.locator("#privacy")).toContainText("no third parties");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("long-enough-pw");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  const join = calls.find((c) => c.name === "jc_join");
  expect(join.args).toEqual({ p_community: "jubail", p_code: "ABCD-EFGH-JK" });
  expect(join.signedIn).toBe(true);
});

// T3 contract: a wrong code is HTTP 200 + {"error":"BAD_CODE"}. Treating it as
// success would route a non-member into the app — this test fails if rpc() does.
test("BAD_CODE (200 + error body) is a failure; retry with the same account works", async ({ page }) => {
  let attempt = 0;
  const { calls } = await stubBackend(page, { rpc: joinFlowRpc(() =>
    (++attempt === 1 ? ok({ error: "BAD_CODE" }) : ok(MEMBER_NO_HOME))) });
  await page.goto("account/?view=join");
  await page.locator("#code").fill("WRONG");
  await page.locator("#go").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("long-enough-pw");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText(/That code didn't work/);
  await expect(page).toHaveURL(/account\//);
  await expect(page.locator(".who")).toContainText("a@example.com");
  await page.locator("#code").fill("RIGHT-CODE");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  expect(calls.filter((c) => c.name === "signup").length).toBe(1);
  expect(calls.filter((c) => c.name === "jc_join").length).toBe(2);
});

test("RATE_LIMITED (raised) shows try-later copy", async ({ page }) => {
  await stubBackend(page, { rpc: joinFlowRpc(() => raise("RATE_LIMITED")) });
  await page.goto("account/?view=join");
  await page.locator("#code").fill("ANY");
  await page.locator("#go").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("long-enough-pw");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Too many attempts. Try again later.");
});

test("email already registered → offer sign-in", async ({ page }) => {
  await stubBackend(page, { auth: { signup: () => ({ status: 422, body: {
    code: "user_already_exists", error_code: "user_already_exists", msg: "User already registered" } }) } });
  await page.goto("account/?view=join");
  await page.locator("#code").fill("ANY");
  await page.locator("#go").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("long-enough-pw");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("That email already has an account. Sign in instead.");
});

test("sign-up without a session (confirmation drifted ON) is said out loud", async ({ page }) => {
  const { calls } = await stubBackend(page, { auth: { signup: (b) => ok({ id: "x", email: b.email, aud: "authenticated" }) } });
  await page.goto("account/?view=join");
  await page.locator("#code").fill("ANY");
  await page.locator("#go").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("long-enough-pw");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText(/confirm your account/);
  expect(calls.some((c) => c.name === "jc_join")).toBe(false);
});

test("short password is refused client-side before any request", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await page.goto("account/?view=join");
  await page.locator("#code").fill("ANY");
  await page.locator("#go").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("short");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText(/at least 8 characters/);
  expect(calls.some((c) => c.name === "signup")).toBe(false);
});

test("signed in but not a member → straight to the code step", async ({ page }) => {
  await stubBackend(page, { rpc: joinFlowRpc(() => ok(MEMBER_NO_HOME)) });
  await page.goto("account/");
  await signIn(page, "correct-horse");
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator(".who")).toContainText("a@example.com");
});

test("forgot password: same answer either way, redirect back to this page", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await page.goto("account/");
  await page.locator("#toForgot").click();
  await page.locator("#email").fill("someone@example.com");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText(/reset link is on its way/);
  const rec = calls.find((c) => c.name === "recover");
  expect(rec.redirect).toBe("http://localhost:4173/commons/account/");
});

// PKCE (PR #18 review): the reset link comes back as ?code=, exchanged only in the
// browser that asked for it (it holds the verifier stored by resetPasswordForEmail).
async function requestReset(page) {
  await page.goto("account/");
  await page.locator("#toForgot").click();
  await page.locator("#email").fill("a@example.com");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText(/reset link is on its way/);
}

test("recovery link (same browser) → new password → saved → in", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await requestReset(page);
  expect(calls.find((c) => c.name === "recover").args.code_challenge).toBeTruthy();
  await page.goto("account/?code=reset-code-1");
  await expect(page.locator("h1")).toHaveText("Choose a new password");
  const exch = calls.find((c) => c.name === "token:pkce");
  expect(exch.args.auth_code).toBe("reset-code-1");
  expect(exch.args.code_verifier).toBeTruthy();
  await page.locator("#password").fill("brand-new-pw");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  expect(calls.find((c) => c.name === "putUser").args.password).toBe("brand-new-pw");
});

test("reset code opened in a browser that didn't request it → refused, explained", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await page.goto("account/?code=someone-elses-code");
  await expect(page.locator("h1")).toHaveText("Reset your password");
  await expect(page.locator("#msg")).toHaveText(/opened in a different browser/);
  expect(calls.some((c) => c.name === "token:pkce")).toBe(false);
});

// Login CSRF: under the implicit flow, a link carrying an attacker's tokens in the
// fragment would be adopted as the visitor's session. PKCE must ignore it.
test("a crafted link with someone else's session is NOT adopted", async ({ page }) => {
  const { calls } = await stubBackend(page);
  const now = Math.floor(Date.now() / 1000);
  await page.goto("./#access_token=" + fakeJwt("attacker@example.com") +
    "&expires_in=3600&expires_at=" + (now + 3600) + "&refresh_token=rt&token_type=bearer");
  await expect(page.locator("#brand")).toHaveText("Commons");  // signed-out platform entry
  await page.waitForTimeout(300);
  await expect(page.locator("#authLink")).toBeHidden();  // still signed out — an adopted session would show Account/Finish joining
  expect(calls.some((c) => c.name === "getUser")).toBe(false);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token$/.test(k)));
  expect(stored).toEqual([]);
});

test("reusing the current password says so (not 'too short')", async ({ page }) => {
  await stubBackend(page, { auth: { putUser: () => ({ status: 422, body: {
    code: "same_password", error_code: "same_password",
    msg: "New password should be different from the old password." } }) } });
  await requestReset(page);
  await page.goto("account/?code=reset-code-2");
  await page.locator("#password").fill("my-current-pw");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("That's your current password. Choose a different one.");
});

test("expired reset link → forgot view with an explanation", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page.locator("h1")).toHaveText("Reset your password");
  await expect(page.locator("#msg")).toHaveText(/expired/);
});

test("?community= override is shown on the join step, never silent", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/?view=join&community=e2e");
  await expect(page.locator(".who")).toContainText("e2e");
});

test("?next= only accepts relative Commons paths (no open redirect)", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/?next=https://evil.example/");
  await signIn(page, "correct-horse");
  await expect(page).toHaveURL(/localhost:4173\/commons\/$/);
});

test("sign out returns to sign-in", async ({ page }) => {
  const { calls } = await stubBackend(page);
  await page.goto("account/");
  await signIn(page, "correct-horse");
  await expect(page).toHaveURL(/\/commons\/$/);  // let the post-sign-in redirect land first
  await page.goto("account/");
  await page.locator("#signOut").click();
  await expect(page.locator("h1")).toHaveText("Sign in");
  expect(calls.some((c) => c.name === "logout")).toBe(true);
});

test("account page in Arabic is RTL", async ({ page }) => {
  await stubBackend(page);
  await page.goto("account/");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("تسجيل الدخول");
});
