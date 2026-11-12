// T5.0b — claim a home, pin it, My Home (household, invites, account), tab bar, hub.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_HOME, MEMBER_NO_PIN, HOME_V12 } = require("./stub");

async function signIn(page, landing) {
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(landing || /\/commons\/$/);
}

// A resident whose home state the test controls; RPCs mutate it like the server would.
function homeBackend(start) {
  const st = { me: JSON.parse(JSON.stringify(start)) };
  const withHome = (h) => { st.me = Object.assign({}, st.me, { home: h }); return ok(st.me); };
  return {
    st,
    rpc: {
      jc_me_get: (a, ctx) => (ctx.signedIn ? ok(st.me) : raise("NOT_SIGNED_IN")),
      jc_home_claim: (a) => withHome({ id: "h9", village: a.p_village, type: a.p_type, building: a.p_building,
        number: a.p_number, lat: null, lng: null, pin_set_at: null,
        members: [{ you: true, name: "a***@example.com", joined_at: "2026-11-03T00:00:00Z" }] }),
      jc_home_edit: (a) => withHome(Object.assign({}, st.me.home, { village: a.p_village, type: a.p_type,
        building: a.p_building, number: a.p_number })),
      jc_home_pin_set: (a) => withHome(Object.assign({}, st.me.home, { lat: a.p_lat, lng: a.p_lng, pin_set_at: "2026-11-03T10:00:00Z" })),
      jc_home_leave: () => withHome(null),
      jc_display_name_set: (a) => { st.me = Object.assign({}, st.me, { account: Object.assign({}, st.me.account, { display_name: a.p_name }) }); return ok(st.me); },
      jc_invite_create: () => ok({ token: "TOKEN_abcdefghijklmnop", expires_at: "2026-11-06T10:00:00Z" }),
      jc_account_delete: () => ({ status: 204, body: null }),
    },
  };
}

test("new member: landing sends them to claim; claim → pin (no skip) → My Home", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await expect(page.locator("h1")).toHaveText("Your Home");
  // upcoming villages can't be chosen
  await expect(page.locator('[data-village="bada-al-jubail"]')).toBeDisabled();
  await expect(page.locator('[data-village="bada-al-jubail"] small')).toHaveText("Coming Late 2027");
  await page.locator('[data-village="ain-al-maha"]').click();
  await page.locator('[data-type="villa"]').click();
  await expect(page.locator("#bldWrap")).toBeHidden();
  await page.locator("#number").fill("12");
  await page.locator("#go").click();
  await expect(page.locator("h1")).toHaveText("Pin Your Home");
  expect(calls.find((c) => c.name === "jc_home_claim").args).toEqual(
    { p_village: "ain-al-maha", p_type: "villa", p_building: null, p_number: "12" });
  // the pin is required: no skip, no cancel on a first pin
  await expect(page.locator("#skipPin, #cancelPin")).toHaveCount(0);
  await page.locator("#savePin").click();
  await expect(page.locator(".homehead b")).toHaveText("Villa 12");
  await expect(page.locator(".homehead span")).toHaveText("Ain Al Maha");
  await expect(page.locator(".status.ok")).toContainText("Pinned");
});

test("apartment: building field appears and is sent; label adapts", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.locator('[data-village="seef-al-jubail"]').click();
  await page.locator('[data-type="apartment"]').click();
  await expect(page.locator("#numLabel")).toHaveText("Apartment number");
  await page.locator("#building").fill("B2");
  await page.locator("#number").fill("304");
  await page.locator("#go").click();
  await page.locator("#savePin").click();
  await expect(page.locator(".homehead b")).toHaveText("Apt 304, B2");
  expect(calls.find((c) => c.name === "jc_home_claim").args.p_building).toBe("B2");
});

test("claim errors: no village chosen (client), HOME_TAKEN (server) → invite advice", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  hb.rpc.jc_home_claim = () => raise("HOME_TAKEN");
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.locator("#number").fill("12");
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("Choose your village.");
  expect(calls.some((c) => c.name === "jc_home_claim")).toBe(false);
  await page.locator('[data-village="ain-al-maha"]').click();
  await page.locator('[data-type="villa"]').click();
  await page.locator("#go").click();
  await expect(page.locator("#msg")).toHaveText("This home already has residents. Ask one of them for an invite.");
});

test("pin: saving sends the map center; My Home shows it pinned", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/");
  await page.locator("#toPin").click();
  await expect(page.locator(".pinmap [data-no-autoreload], .pinmap[data-no-autoreload]")).toHaveCount(1);
  await page.locator("#savePin").click();
  await expect(page.locator(".status.ok")).toHaveText("Pinned on the map");
  const a = calls.find((c) => c.name === "jc_home_pin_set").args;
  expect(Math.abs(a.p_lat - 24.53)).toBeLessThan(0.01);
  expect(Math.abs(a.p_lng - 54.43)).toBeLessThan(0.01);
});

test("My Home: invite link, display name, tab bar (Commons + My Home only while modules are off)", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/");
  // sub-menu, not one long scroll: Home first (the house), then Household, Account
  await expect(page.locator('.subtabs [role="tab"]')).toHaveText(["Home", "Household", "Account"]);
  await expect(page.locator(".homehead b")).toHaveText("Villa 12");
  await expect(page.locator("#invite")).toHaveCount(0);
  await page.locator("#mh-household").click();
  await expect(page).toHaveURL(/\/home\/\?tab=household$/);
  await expect(page.locator(".members li")).toHaveCount(1);
  await expect(page.locator(".members .tag")).toHaveText("you");
  await page.locator("#invite").click();
  await expect(page.locator("#inviteLink")).toHaveText("http://localhost:4173/commons/home/?invite=TOKEN_abcdefghijklmnop");
  await page.locator("#mh-account").click();
  await expect(page.locator("#delete")).toBeVisible();
  await page.locator("#dname").fill("Omar");
  await page.locator("#saveName").click();
  await expect(page.locator("#msg")).toHaveText("Saved");
  await expect(page.locator("#dname")).toHaveValue("Omar");       // still on Account after the save
  await page.reload();
  await expect(page.locator('#mh-account')).toHaveAttribute("aria-selected", "true");   // ?tab= survives a reload
  // an unsaved name survives a tab switch and a language switch (code review, polish PR)
  await page.locator("#dname").fill("Draft");
  await page.locator("#mh-home").click();
  await page.locator("#mh-account").click();
  await expect(page.locator("#dname")).toHaveValue("Draft");
  await page.locator("#langBtn").click();
  await expect(page.locator("#mh-account")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#mh-account")).toHaveText("الحساب");
  await expect(page.locator("#dname")).toHaveValue("Draft");
  await expect(page.locator("#tabbar a")).toHaveCount(2);
  await expect(page.locator('#tabbar a[aria-current="page"]')).toHaveAttribute("data-tab", "home");
});

test("tab bar shows a module only when its flag is on", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: Object.assign(hb.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, {
    modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: true } } })) }) });
  await signIn(page);
  await expect(page.locator("#tabbar a")).toHaveCount(4);                       // Commons · Events · Pets (R5b-1) · My Home
  await expect(page.locator('#tabbar a[data-tab="events"]')).toHaveAttribute("href", "events/");
  await expect(page.locator('#tabbar a[data-tab="pets"]')).toHaveAttribute("href", "pets/");
  await expect(page.locator('#tabbar a[data-tab="bookings"]')).toHaveCount(0);
  await expect(page.locator(".tagline")).toHaveText("Welcome, Villa 12");
});

test("invite: signed-out invitee is sent to Join and comes back to the invite", async ({ page }) => {
  await stubBackend(page);
  await page.goto("home/?invite=TOKEN_abcdefghijklmnop");
  await expect(page).toHaveURL(/account\/\?view=join&next=/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toBe("../home/?invite=TOKEN_abcdefghijklmnop");
  const safe = await page.evaluate((n) => [jcSafeNext(n), jcSafeNext("../home/?invite=x"), jcSafeNext("../home/?evil=1")], next);
  expect(safe).toEqual(["../home/?invite=TOKEN_abcdefghijklmnop", "../", "../"]);
});

test("invite: member without a home accepts → joined; token removed from the URL", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  hb.rpc.jc_invite_accept = (a) => {
    hb.st.me = Object.assign({}, hb.st.me, { home: Object.assign({}, HOME_V12, {
      members: [{ you: false, name: "Sara", joined_at: "x" }, { you: true, name: "a***@example.com", joined_at: "y" }] }) });
    return a.p_token === "TOKEN_abcdefghijklmnop" ? ok({ status: "joined", me: hb.st.me }) : raise("BAD_INVITE");
  };
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.goto("home/?invite=TOKEN_abcdefghijklmnop");
  // asks first — nothing is accepted on page load (security review PR #21)
  await expect(page.locator("#inviteYes")).toBeVisible();
  expect(calls.some((c) => c.name === "jc_invite_accept")).toBe(false);
  await page.locator("#inviteYes").click();
  await expect(page.locator("#msg")).toHaveText("You've joined Villa 12.");
  await expect(page.locator(".members li")).toHaveCount(2);
  await expect(page.locator("#mh-household")).toHaveAttribute("aria-selected", "true");   // lands on Household
  expect(new URL(page.url()).search).toBe("?tab=household");                                // token gone, tab kept
  expect(calls.filter((c) => c.name === "jc_invite_accept").length).toBe(1);
});

test("invite outcomes: over the cap → pending; dead link → explained", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  let n = 0;
  hb.rpc.jc_invite_accept = () => (++n === 1 ? ok({ status: "pending_approval" }) : raise("BAD_INVITE"));
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.goto("home/?invite=TOKEN_abcdefghijklmnop");
  await page.locator("#inviteYes").click();
  await expect(page.locator("#msg")).toContainText("a community admin has to approve you");
  await page.goto("home/?invite=TOKEN_zzzzzzzzzzzzzzzz");
  await page.locator("#inviteYes").click();
  await expect(page.locator("#msg")).toHaveText("This invite link isn't valid anymore. Ask for a new one.");
});

test("leave this home (confirmed) → back to claim", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?tab=account");
  page.once("dialog", (d) => d.accept());
  await page.locator("#leave").click();
  await expect(page.locator("h1")).toHaveText("Your Home");
});

test("delete account needs DELETE typed; then signs out to the public landing", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?tab=account");
  await page.locator("#delete").click();
  await expect(page.locator("#msg")).toHaveText("Type DELETE to confirm.");
  expect(calls.some((c) => c.name === "jc_account_delete")).toBe(false);
  await page.locator("#delConfirm").fill("DELETE");
  await page.locator("#delete").click();
  await expect(page).toHaveURL(/\/commons\/$/);
  await expect(page.locator("#brand")).toHaveText("Commons");
  expect(calls.find((c) => c.name === "jc_account_delete").args).toEqual({ p_confirm: "DELETE" });
  expect(calls.some((c) => c.name === "logout")).toBe(true);
});

test("signed out on My Home → sign-in, with the way back", async ({ page }) => {
  await stubBackend(page);
  await page.goto("home/");
  await expect(page).toHaveURL(/account\/\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("../home/");
});

test("My Home page: no CSP violations, Arabic + RTL", async ({ page }) => {
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  const hb = homeBackend(MEMBER);
  const { escaped } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/");
  await page.locator("#toPin").click();
  await expect(page.locator("#map .leaflet-tile-pane")).toHaveCount(1);
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("حدّد منزلك على الخريطة");
  expect(csp).toEqual([]);
  expect(escaped).toEqual([]);
});

test("Find me: centers the map on the phone's location; saving pins that spot", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 24.5555, longitude: 54.4444 });
  const hb = homeBackend(MEMBER);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin");
  await page.locator("#locateBtn").click();
  await page.waitForTimeout(300);
  // the phone's location only moves the map — nothing is sent until Save
  expect(calls.some((c) => c.name === "jc_home_pin_set")).toBe(false);
  await page.locator("#savePin").click();
  await expect(page.locator(".status.ok")).toHaveText("Pinned on the map");
  const a = calls.find((c) => c.name === "jc_home_pin_set").args;
  expect(Math.abs(a.p_lat - 24.5555)).toBeLessThan(0.0005);
  expect(Math.abs(a.p_lng - 54.4444)).toBeLessThan(0.0005);
});

test("Find me with location refused → explains, map stays usable", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin");
  await page.locator("#locateBtn").click();
  await expect(page.locator("#msg")).toContainText(/Location is off|Couldn't find your location/);
  await expect(page.locator("#savePin")).toBeEnabled();
});

test("My Home header: the mark + community name, like the hub", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator(".topbar a.home svg")).toHaveCount(1);
  await expect(page.locator("#homeLink")).toHaveText("Jubail Commons");
  expect(await page.locator(".topbar a.home").evaluate((n) => getComputedStyle(n).fontSize)).toBe("22px");
});

test("invite: 'Not Now' declines without calling the server", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  hb.rpc.jc_invite_accept = () => ok({ status: "joined", me: MEMBER });
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.goto("home/?invite=TOKEN_abcdefghijklmnop");
  await page.locator("#inviteNo").click();
  await expect(page.locator("h1")).toHaveText("Your Home");
  expect(calls.some((c) => c.name === "jc_invite_accept")).toBe(false);
});

test("invite: already in a home → explained", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  hb.rpc.jc_invite_accept = () => raise("ALREADY_HAS_HOME");
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?invite=TOKEN_abcdefghijklmnop");
  await page.locator("#inviteYes").click();
  await expect(page.locator("#msg")).toHaveText("You already belong to a home. Leave it first in My Home.");
});

test("malformed invite tokens are ignored (no server call, normal My Home)", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  for (const bad of ["short", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "TOKEN_abcdefghijklmnop%26x%3D1"]) {
    await page.goto("home/?invite=" + bad);
    await expect(page.locator(".homehead b")).toHaveText("Villa 12");
  }
  expect(calls.some((c) => c.name === "jc_invite_accept")).toBe(false);
});

test("jcSafeNext rejects every off-site or extra-param form", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  const T = "TOKEN_abcdefghijklmnop";
  const r = await page.evaluate((T) => [
    "//evil.com", "https://evil.com/", "../x?invite=" + T + "&y=1", "../?invite=" + T + "#x",
    "../a.b/", "..\\evil", "../%2F%2Fevil", "javascript:alert(1)", "",
  ].map(jcSafeNext), T);
  expect(r.every((x) => x === "../")).toBe(true);
});

test("hostile names are shown as text, never run (esc everywhere)", async ({ page }) => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const start = JSON.parse(JSON.stringify(MEMBER));
  start.home.members = [{ you: false, name: evil, joined_at: "x" }, { you: true, name: "a***@example.com", joined_at: "y" }];
  start.account.display_name = evil;
  const hb = homeBackend(start);
  await stubBackend(page, { rpc: Object.assign(hb.rpc, { jc_config_get: () => ok(Object.assign({}, CONFIG, {
    villages: [{ key: "ain-al-maha", en: evil, ar: null, status: "delivered", delivery: null, parent: null }] })) }) });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator(".homehead span")).toHaveText(evil);
  await page.locator("#mh-household").click();
  await expect(page.locator(".members li").first()).toContainText("<img");
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator("#view img").count()).toBe(0);
});

test("referrer policy: pages that can carry a token never send it to other sites", async ({ page }) => {
  await stubBackend(page);
  for (const p of ["home/", "account/"]) {
    await page.goto(p);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  }
});

test("language toggle keeps what you typed", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_HOME);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page, /\/commons\/home\/$/);
  await page.locator("#number").fill("42");
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("منزلك");
  await expect(page.locator("#number")).toHaveValue("42");
});

test("pin: set on the map only — no coordinates box; the spot under the ring is what's saved", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#coords, #coordsGo")).toHaveCount(0);           // Zee 2026-11-12: map only
  await expect(page.locator("body")).not.toContainText("coordinates");
  await page.evaluate(() => map.setView([24.5512, 54.4123], 19));          // the resident pans the map
  const saves = () => calls.filter((c) => c.name === "jc_home_pin_set").length;
  await page.locator("#savePin").click();
  await expect.poll(saves).toBe(1);
  const a = calls.filter((c) => c.name === "jc_home_pin_set").pop().args;
  expect(Math.abs(a.p_lat - 24.5512)).toBeLessThan(0.0002);
  expect(Math.abs(a.p_lng - 54.4123)).toBeLessThan(0.0002);
});

// ---- T5.2 PR 1: the pin is required; the pin screen can return to an event ----

const EV = "11111111-1111-4111-8111-111111111111";
const EV_NEXT = "../events/?id=" + EV + "&tab=mine";

test("a home without a pin always opens on the pin screen (no skip)", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_PIN);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator("h1")).toHaveText("Pin Your Home");
  await expect(page.locator("#skipPin, #cancelPin")).toHaveCount(0);
});

test("pin from an event: saving returns to the event's My home tab", async ({ page }) => {
  const hb = homeBackend(MEMBER_NO_PIN);
  const { calls } = await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin&next=" + encodeURIComponent(EV_NEXT));
  await page.locator("#savePin").click();
  await expect(page).toHaveURL(new RegExp("/commons/events/\\?id=" + EV + "&tab=mine$"));
  expect(calls.some((c) => c.name === "jc_home_pin_set")).toBe(true);
});

test("changing a pin from an event: Cancel goes back to the event", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin&next=" + encodeURIComponent(EV_NEXT));
  await page.locator("#cancelPin").click();
  await expect(page).toHaveURL(new RegExp("/commons/events/\\?id=" + EV + "&tab=mine$"));
});

test("a hostile next is ignored: saving the pin stays on My Home", async ({ page }) => {
  const hb = homeBackend(MEMBER);
  await stubBackend(page, { rpc: hb.rpc });
  await signIn(page);
  await page.goto("home/?view=pin&next=" + encodeURIComponent("https://evil.com/"));
  await page.locator("#savePin").click();
  await expect(page.locator(".homehead b")).toHaveText("Villa 12");
  await expect(page).toHaveURL(/\/commons\/home\//);
});

test("jcSafeNext admits exactly an event + known tab", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  const r = await page.evaluate((EV) => [
    "../events/?id=" + EV + "&tab=mine", "../events/?id=" + EV + "&tab=list",
    "../events/?id=" + EV + "&tab=evil", "../events/?id=" + EV, "../events/?id=" + EV + "&tab=mine&x=1",
    "../events/?id=not-a-uuid&tab=mine", "../events/?id=ABCDEF01-1111-4111-8111-111111111111&tab=mine",
    "//evil.com/events/?id=" + EV + "&tab=mine", "../home/?id=" + EV + "&tab=mine",
  ].map(jcSafeNext), EV);
  expect(r.slice(0, 2)).toEqual(["../events/?id=" + EV + "&tab=mine", "../events/?id=" + EV + "&tab=list"]);
  expect(r.slice(2).every((x) => x === "../")).toBe(true);
});
