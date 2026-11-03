// REAL-BACKEND smoke test (plan D6) — no stubs. Hits the live JubailCommons project
// in the dedicated `e2e` community, never `jubail`. Run deliberately, not in CI:
//   E2E_JOIN_CODE=<code> E2E_EMAIL=<real mailbox> npx playwright test -c playwright.smoke.config.js
// The e2e join code comes from jc_code_bootstrap('e2e','join') — never commit it.
// Side effects: one auth user (deleted at the end via jc_account_delete, even on
// failure) and ONE deliberate BAD_CODE, which advances jc_join_fail_count by 1 —
// that is the price of proving the 200+{"error"} contract against the real server.
const { test, expect } = require("@playwright/test");

const CODE = process.env.E2E_JOIN_CODE;
// Supabase Auth rejects reserved domains (example.com → email_address_invalid), so
// use a plus-address on a real mailbox: E2E_EMAIL=you@gmail.com → you+commons-smoke-<ts>@gmail.com.
// Nothing is sent (email confirmation is off) and the account deletes itself.
const BASE = process.env.E2E_EMAIL || "";
const EMAIL = BASE.replace("@", "+commons-smoke-" + Date.now() + "@");
const PASSWORD = "smoke-" + Date.now() + "-pw";

test("join (wrong code, then right) → member → sign out/in → delete account", async ({ page }) => {
  test.skip(!CODE || !BASE.includes("@"), "set E2E_JOIN_CODE and E2E_EMAIL");
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  let failed = null;
  try {
    await page.goto("account/?view=join&community=e2e");
    await expect(page.locator(".who")).toContainText("e2e");

    // wrong code: the real server answers HTTP 200 + {"error":"BAD_CODE"}
    await page.locator("#code").fill("WRONGCODE1");
    await page.locator("#go").click();
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#go").click();
    await expect(page.locator("#msg")).toHaveText(/That code didn't work/, { timeout: 15000 });
    await expect(page.locator(".who").first()).toContainText(EMAIL);

    // right code, same account
    await page.locator("#code").fill(CODE);
    await page.locator("#go").click();
    await expect(page).toHaveURL(/\/commons\/$/, { timeout: 15000 });
    await expect(page.locator("#brand")).toHaveText("E2E Test Commons");
    await expect(page.locator("#authLink")).toHaveText("Account");

    // real jc_me_get shape
    const me = await page.evaluate(() => rpc("jc_me_get"));
    expect(me.community).toBe("e2e");
    expect(me.home).toBeNull();

    // sign out, sign back in
    await page.goto("account/");
    await expect(page.locator(".who")).toContainText(EMAIL);
    await page.locator("#signOut").click();
    await expect(page.locator("h1")).toHaveText("Sign in");
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#go").click();
    await expect(page).toHaveURL(/\/commons\/$/, { timeout: 15000 });

    // wrong password against the real Auth API
    await page.goto("account/");
    await page.locator("#signOut").click();
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill("not-the-password");
    await page.locator("#go").click();
    await expect(page.locator("#msg")).toHaveText("Email or password is incorrect.", { timeout: 15000 });
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#go").click();
    await expect(page).toHaveURL(/\/commons\/$/, { timeout: 15000 });
  } catch (e) {
    failed = e;
  } finally {
    // cleanup — the offboarding path itself (UC-H1/H3); verify the identity is gone
    const out = await page.evaluate(async () => {
      try {
        const s = await jcDb.auth.getSession();
        if (!s.data.session) return "no-session";
        await rpc("jc_account_delete", { p_confirm: "DELETE" });
        await jcDb.auth.signOut().catch(() => {});
        return "deleted";
      } catch (e) { return "cleanup-failed:" + (e.code || e.message); }
    });
    console.log("CLEANUP", out, EMAIL);
    // the first failure is the one worth reading — never mask it with the cleanup's
    if (failed) throw failed;
    expect(out).toBe("deleted");
  }
});
