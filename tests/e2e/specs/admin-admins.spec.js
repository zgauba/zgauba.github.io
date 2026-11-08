// R4b-1a — Admins at every level (server R4a-2 / R4a-3): the Admins screen (named people, Invited / Code / idle
// chips, one-time invite links, Remove, LAST_ADMIN), the invite landing (#admininvite=… fragment, dropped from the
// URL, kept per tab across sign-in), and a courts-only admin getting in. Plan: docs/plans/R4b-1-admins-courts.md.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const TOKEN = "INVITEtoken_abcdefghij12";
const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const OMAR = { user_id: "u-7", name: "Omar", village: "ain-al-maha", type: "villa", building: null, number: "7",
               granted_at: "2026-11-01T10:00:00Z", last_used_at: "2026-11-07T10:00:00Z", via: ["invite"], idle: false };
const ME = { user_id: "u-me", name: "a***@example.com", village: "ain-al-maha", type: "villa", building: null, number: "12",
             granted_at: "2026-11-02T10:00:00Z", last_used_at: "2026-11-08T10:00:00Z", via: ["code"], idle: false };
const SARA = { user_id: "u-9", name: "Sara", village: "ain-al-maha", type: "villa", building: null, number: "9",
               granted_at: "2026-06-01T10:00:00Z", last_used_at: "2026-07-01T10:00:00Z", via: ["code", "invite"], idle: true };

// adminBackend + the R4a-3 admin RPCs, shaped like jc_admins_payload. Who holds what lives in st.lists.
function backend(opts = {}) {
  const ab = adminBackend({ scopes: opts.scopes || ["community"] });
  const st = ab.st;
  st.lists = Object.assign({ community: [ME], events: [OMAR], bookings: [], pets: [] }, opts.lists || {});
  st.mlinks = { community: [], events: [], bookings: [], pets: [] };
  st.acceptable = opts.acceptable || {};          // token → scope
  let n = 0;
  const community = () => st.scopes.includes("community");
  const payload = (s) => ok({ scope: s, admins: st.lists[s], links: st.mlinks[s].map((l) => ({ id: l.id, created_at: "2026-11-08T09:00:00Z", expires_at: l.expires_at })) });
  const rpc = Object.assign({}, ab.rpc, {
    jc_module_admins_list: (a) => (opts.listFails && opts.listFails(a) ? raise("NETWORK_X")
      : community() ? payload(a.p_scope) : raise("NOT_ADMIN")),
    jc_module_admin_link_create: (a) => {
      if (!community()) return raise("NOT_ADMIN");
      if (opts.tooMany) return raise("TOO_MANY_LINKS");
      n += 1;
      const l = { id: "link-" + n, expires_at: a.p_scope === "community" ? "2026-11-09T10:00:00Z" : "2026-11-11T10:00:00Z" };
      st.mlinks[a.p_scope].push(l);
      return ok({ token: "TOKEN_" + a.p_scope + "_" + n + "abcdefghijklm", scope: a.p_scope, expires_at: l.expires_at });
    },
    jc_module_admin_revoke: (a) => {
      if (!community()) return raise("NOT_ADMIN");
      const s = a.p_scope;
      if (a.p_user) {
        if (opts.gone) return raise("NOT_FOUND");
        if (!st.lists[s].some((x) => x.user_id === a.p_user)) return raise("NOT_FOUND");
        if (s === "community" && st.lists.community.length === 1) return raise("LAST_ADMIN");
        st.lists[s] = st.lists[s].filter((x) => x.user_id !== a.p_user);
        if (s === "community" && a.p_user === "u-me") st.scopes = st.scopes.filter((x) => x !== "community");
      } else {
        const before = st.mlinks[s].length;
        st.mlinks[s] = st.mlinks[s].filter((l) => l.id !== a.p_link);
        if (st.mlinks[s].length === before) return raise("NOT_FOUND");
      }
      return payload(s);
    },
    jc_module_admin_accept: (a) => {
      const s = st.acceptable[a.p_token];
      if (!s) return raise("BAD_LINK");
      if (st.scopes.includes(s)) return raise("ALREADY_ADMIN");
      delete st.acceptable[a.p_token];
      st.scopes = st.scopes.concat([s]);
      return ok({ scope: s });
    },
  });
  return { st, rpc };
}

async function openAdmins(page) {
  await page.goto("admin/?tab=community");
  await page.locator("#adOpen").click();
  await expect(page.locator("h1")).toHaveText("Admins");
}

test("community admin: Admins lists every level with chips; no Pets; two-admin warning", async ({ page }) => {
  const b = backend({ lists: { bookings: [SARA] } });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await expect(page.locator("h2.group")).toHaveText(["Community admins", "Event organizers", "Courts admins"]);
  expect(calls.filter((c) => c.name === "jc_module_admins_list").map((c) => c.args.p_scope).sort())
    .toEqual(["bookings", "community", "events"]);                       // never pets
  const community = page.locator('[data-scope="community"]');
  await expect(community.locator('[data-admin="u-me"] .chip')).toHaveText(["Code"]);
  await expect(page.locator('[data-scope="events"] [data-admin="u-7"]')).toContainText("Villa 7");
  await expect(page.locator('[data-scope="events"] [data-admin="u-7"] .chip')).toHaveText(["Invited"]);
  await expect(page.locator('[data-scope="bookings"] [data-admin="u-9"] .chip')).toHaveText(["Invited", "Code", "Unused 90+ days"]);
  await expect(page.locator("#adWarn")).toContainText("Fewer than two community admins were added by invite");
});

test("two community admins added by invite: no warning", async ({ page }) => {
  const b = backend({ lists: { community: [Object.assign({}, ME, { via: ["invite"] }), Object.assign({}, OMAR, { user_id: "u-8" })] } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await expect(page.locator('[data-scope="community"] .adminlist li')).toHaveCount(2);
  await expect(page.locator("#adWarn")).toHaveCount(0);
});

test("one invited community admin (plus a code holder) still warns", async ({ page }) => {
  const b = backend({ lists: { community: [ME, Object.assign({}, OMAR, { user_id: "u-8" })] } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await expect(page.locator('[data-scope="community"] .adminlist li')).toHaveCount(2);
  await expect(page.locator("#adWarn")).toBeVisible();
});

test("community invite link: fragment URL, shown once, says 24 h + full control; survives a language switch", async ({ page }) => {
  const b = backend();
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await page.locator('[data-admake="community"]').click();
  await expect(page.locator('[data-adurl="community"]')).toHaveText("http://localhost:4173/commons/admin/#admininvite=TOKEN_community_1abcdefghijklm");
  expect(lastCall(calls, "jc_module_admin_link_create").args).toEqual({ p_scope: "community" });
  const box = page.locator('[data-scope="community"] .codebox');
  await expect(box).toContainText("24 hours");
  await expect(box).toContainText("full control of the community");
  await expect(page.locator('[data-scope="community"] .adminlist li')).toHaveCount(2);   // + the unused link
  await page.locator("#langBtn").click();
  await expect(page.locator('[data-adurl="community"]')).toContainText("#admininvite=TOKEN_community_1");
  await page.locator("#langBtn").click();
  await page.locator("#jcBackBtn").click();                                   // leaving drops it: it is never shown again
  await page.locator("#adOpen").click();
  await expect(page.locator('[data-scope="community"] .adminlist li')).toHaveCount(2);
  await expect(page.locator("[data-adurl]")).toHaveCount(0);
});

test("an events link says 3 days; shown even when the list refresh fails", async ({ page }) => {
  let made = false;
  const b = backend({ listFails: (a) => made && a.p_scope === "events" });
  const rpc = Object.assign({}, b.rpc, { jc_module_admin_link_create: (a, c) => { made = true; return b.rpc.jc_module_admin_link_create(a, c); } });
  await stubBackend(page, { rpc });
  await signIn(page);
  await openAdmins(page);
  await page.locator('[data-admake="events"]').click();
  await expect(page.locator('[data-adurl="events"]')).toContainText("#admininvite=TOKEN_events_1");
  await expect(page.locator('[data-scope="events"] .codebox')).toContainText("for 3 days");
});

test("remove asks first (names the role), cancels a link, explains LAST_ADMIN and too many links", async ({ page }) => {
  const b = backend();
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator('[data-adrm="events"][data-user="u-7"]').click();
  await expect(page.locator("#msg")).toHaveText("Removed.");
  expect(asked).toBe("Remove Omar from Event organizers?");
  expect(lastCall(calls, "jc_module_admin_revoke").args).toEqual({ p_scope: "events", p_user: "u-7", p_link: null });
  await expect(page.locator('[data-scope="events"]')).toContainText("No one yet.");

  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator('[data-adrm="community"][data-user="u-me"]').click();
  await expect(page.locator("#msg")).toHaveText("That's the last community admin. Invite another one first, then remove this one.");
  expect(asked).toContain("Any invite links they made are cancelled too.");
  await expect(page.locator('[data-scope="community"] [data-admin="u-me"]')).toHaveCount(1);

  await page.locator('[data-admake="bookings"]').click();
  await page.locator('[data-adcancel="bookings"]').click();
  await expect(page.locator('[data-scope="bookings"]')).toContainText("No one yet.");   // UI first: the call has landed
  expect(lastCall(calls, "jc_module_admin_revoke").args).toEqual({ p_scope: "bookings", p_user: null, p_link: "link-1" });
});

test("too many unused links: says so for this role (not 'for this event')", async ({ page }) => {
  const b = backend({ tooMany: true });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await page.locator('[data-admake="community"]').click();
  await expect(page.locator("#msg")).toHaveText("Too many unused links for this role. Cancel one first.");
});

test("someone else changed it: NOT_FOUND re-reads the lists and says so", async ({ page }) => {
  const b = backend({ gone: true });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  const before = calls.filter((c) => c.name === "jc_module_admins_list").length;
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-adrm="events"][data-user="u-7"]').click();
  await expect(page.locator("#msg")).toHaveText("That changed in the meantime. The list below is up to date.");
  expect(calls.filter((c) => c.name === "jc_module_admins_list").length).toBe(before + 3);
});

test("removing yourself while another community admin remains: re-reads who you are and leaves the Admins screen", async ({ page }) => {
  const b = backend({ lists: { community: [ME, Object.assign({}, OMAR, { user_id: "u-8" })] } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-adrm="community"][data-user="u-me"]').click();
  await expect(page.locator("#msg")).toHaveText("You're no longer a community admin.");
  await expect(page.locator("#code")).toBeVisible();                        // no admin right left → the code box
});

test("invite link: token dropped from the URL, asks first (names no level), accepts once and names it; a courts admin gets in", async ({ page }) => {
  const b = backend({ scopes: [], acceptable: { [TOKEN]: "bookings" } });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/#admininvite=" + TOKEN);
  await expect(page.locator("h1")).toHaveText("Help Run Your Community");
  await expect(page.locator(".acclist")).toContainText("You'll see it named as soon as you accept");
  await expect(page.locator(".acclist")).not.toContainText("Courts");
  await expect(page.locator(".acclist li")).toHaveCount(3);
  expect(new URL(page.url()).hash).toBe("");
  expect(calls.some((c) => c.name === "jc_module_admin_accept")).toBe(false);
  await page.locator("#invYes").click();
  await expect(page.locator("#msg")).toHaveText("Done. You've joined the Courts admins.");
  expect(calls.filter((c) => c.name === "jc_module_admin_accept").map((c) => c.args)).toEqual([{ p_token: TOKEN }]);
  await expect(page.locator(".sub")).toContainText("Courts");
  await expect(page.locator("#code")).toHaveCount(0);                       // not sent to the lock
  await expect(page.locator("#newEv")).toHaveCount(0);
  await expect(page.locator("#adOpen")).toHaveCount(0);                     // invites are for community admins
  await page.reload();
  await expect(page.locator("h1")).not.toHaveText("Help Run Your Community");   // the invite is forgotten
});

test("invite link used / expired: explained, no second Accept, forgotten; Arabic keeps the question", async ({ page }) => {
  const b = backend({ scopes: [] });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/#admininvite=" + TOKEN);
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("ساعد في إدارة مجتمعك");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator("#langBtn").click();
  await page.locator("#invYes").click();
  await expect(page.locator("#msg")).toHaveText("This link has been used, has expired, or was cancelled — ask for a new one.");
  await expect(page.locator("#invYes")).toHaveCount(0);
  await page.goto("admin/");
  await expect(page.locator("#code")).toBeVisible();                        // no invite question again
});

test("invite while signed out: the token never reaches the sign-in URL; back to the question after signing in", async ({ page }) => {
  const b = backend({ scopes: [], acceptable: { [TOKEN]: "events" } });
  await stubBackend(page, { rpc: b.rpc });
  await page.goto("admin/#admininvite=" + TOKEN);
  await expect(page).toHaveURL(/\/commons\/account\/\?next=/);
  expect(page.url()).not.toContain(TOKEN);
  expect(new URL(page.url()).searchParams.get("next")).toBe("../admin/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/admin\/$/);
  await expect(page.locator("#invYes")).toBeVisible();
  await page.locator("#invYes").click();
  await expect(page.locator("#msg")).toHaveText("Done. You've joined the Event organizers.");
});

test("a malformed invite fragment (incl. a role hint) is dropped and ignored", async ({ page }) => {
  const b = backend({ scopes: [] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/#admininvite=" + TOKEN + "&role=community");   // the old role hint: not a valid link
  await expect(page.locator("#code")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(calls.some((c) => c.name === "jc_module_admin_accept")).toBe(false);
});

test("changing a code says who loses access and that invited admins keep theirs", async ({ page }) => {
  const b = backend();
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('[data-rotate="events"]').click();
  await expect.poll(() => asked).toContain("everyone who unlocked with it loses access. Admins added by invite keep theirs.");
});

// axe on the two new screens, EN + AR (serious / critical only, as a11y.spec.js)
const AxeBuilder = require("@axe-core/playwright").default;
async function axeClean(page) {
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: Admins (with a new link) and the invite question`, async ({ page }) => {
    const b = backend({ lists: { bookings: [SARA] } });
    await stubBackend(page, { rpc: b.rpc });
    await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, lang);
    await signIn(page);
    await page.goto("admin/?tab=community");
    await page.locator("#adOpen").click();
    await page.locator('[data-admake="community"]').click();
    await expect(page.locator('[data-adurl="community"]')).toBeVisible();
    expect(await axeClean(page)).toEqual([]);
    await page.goto("admin/#admininvite=" + TOKEN);
    await expect(page.locator("#invYes")).toBeVisible();
    expect(await axeClean(page)).toEqual([]);
  });
}

// ── review fixes (docs/qa/R4b-1a-review-2026-11-08.md) ──
test("code review M1: a shown link survives another level's Make and Remove; leaving drops both", async ({ page }) => {
  const b = backend();
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  await page.locator('[data-admake="community"]').click();
  await expect(page.locator('[data-adurl="community"]')).toBeVisible();
  await page.locator('[data-admake="bookings"]').click();
  await expect(page.locator('[data-adurl="bookings"]')).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-adrm="events"][data-user="u-7"]').click();
  await expect(page.locator("#msg")).toHaveText("Removed.");
  await expect(page.locator('[data-adurl="community"]')).toContainText("TOKEN_community_1");
  await expect(page.locator('[data-adurl="bookings"]')).toContainText("TOKEN_bookings_2");
  await page.locator("#jcBackBtn").click();
  await page.locator("#adOpen").click();
  await expect(page.locator('[data-scope="bookings"] .adminlist li')).toHaveCount(1);
  await expect(page.locator("[data-adurl]")).toHaveCount(0);
});

test("a double tap on Make makes one link", async ({ page }) => {
  const b = backend();
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_module_admin_link_create: async (a, c) => { await gate; return b.rpc.jc_module_admin_link_create(a, c); } });
  const { calls } = await stubBackend(page, { rpc });
  await signIn(page);
  await openAdmins(page);
  await page.locator('[data-admake="events"]').dblclick();
  await page.locator('[data-admake="community"]').click({ force: true });   // another level while one is in flight
  release();
  await expect(page.locator('[data-adurl="events"]')).toBeVisible();
  expect(calls.filter((c) => c.name === "jc_module_admin_link_create").length).toBe(1);
});

test("code review L1: lists that can't be read say so, with Try Again", async ({ page }) => {
  let fails = true;
  const b = backend({ listFails: () => fails });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await page.locator("#adOpen").click();
  await expect(page.locator("#adRetry")).toBeVisible();
  await expect(page.locator("#msg")).toHaveText("Something went wrong. Try again in a moment.");
  await expect(page.locator("#view")).not.toContainText("Working");
  fails = false;
  await page.locator("#adRetry").click();
  await expect(page.locator("h2.group")).toHaveCount(3);
});

test("NOT_ADMIN while on Admins goes back through the re-check (no stale screen)", async ({ page }) => {
  const b = backend();
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  b.st.scopes = [];                                                       // the grant ended elsewhere
  await page.locator('[data-admake="events"]').click();
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#msg")).toContainText(/./);
});

test("removing another community admin stays on Admins and re-reads every level", async ({ page }) => {
  const b = backend({ lists: { community: [ME, Object.assign({}, OMAR, { user_id: "u-8" })] } });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await openAdmins(page);
  const before = calls.filter((c) => c.name === "jc_module_admins_list").length;
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-adrm="community"][data-user="u-8"]').click();
  await expect(page.locator("#msg")).toHaveText("Removed.");
  await expect(page.locator("h1")).toHaveText("Admins");
  expect(calls.filter((c) => c.name === "jc_module_admins_list").length).toBe(before + 3);
});

test("code review L3: an accepted level with no screens here yet says it worked and offers the way out", async ({ page }) => {
  const b = backend({ scopes: [], acceptable: { [TOKEN]: "pets" } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/#admininvite=" + TOKEN);
  await page.locator("#invYes").click();
  await expect(page.locator("#msg")).toHaveText("Done. You've joined the Pets admins.");
  await expect(page.locator('#view a[href="../"]')).toBeVisible();
});

test("code review L2: No Thanks is off while the answer is on its way", async ({ page }) => {
  const b = backend({ scopes: [], acceptable: { [TOKEN]: "events" } });
  let release;
  const gate = new Promise((r) => { release = r; });
  const rpc = Object.assign({}, b.rpc, { jc_module_admin_accept: async (a, c) => { await gate; return b.rpc.jc_module_admin_accept(a, c); } });
  await stubBackend(page, { rpc });
  await signIn(page);
  await page.goto("admin/#admininvite=" + TOKEN);
  await page.locator("#invYes").click();
  await expect(page.locator("#invNo")).toBeDisabled();
  release();
  await expect(page.locator("#msg")).toHaveText("Done. You've joined the Event organizers.");
});

test("security L3: a kept invite older than an hour is forgotten; signing out forgets it too", async ({ page }) => {
  const b = backend({ scopes: [], acceptable: { [TOKEN]: "events" } });
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.evaluate((t) => sessionStorage.setItem("jc_admin_invite", JSON.stringify({ token: t, at: Date.now() - 3601e3 })), TOKEN);
  await page.goto("admin/");
  await expect(page.locator("#code")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("jc_admin_invite"))).toBeNull();
  await page.evaluate((t) => sessionStorage.setItem("jc_admin_invite", JSON.stringify({ token: t, at: Date.now() })), TOKEN);
  await page.goto("account/");
  await page.locator("#signOut").click();
  await expect(page.locator("#email")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("jc_admin_invite"))).toBeNull();
});
