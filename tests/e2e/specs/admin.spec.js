// T5.2 PR 2 — Organizer tools: unlock / exit, events list, create / edit (only changed
// fields), Halloween template, publish, sign-ups, close (type the short name), codes.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, MEMBER } = require("./stub");

const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_ID = "44444444-4444-4444-8444-444444444444";
const PAST_ID = "55555555-5555-4555-8555-555555555555";

function adminBackend(opts = {}) {
  const st = {
    scopes: opts.scopes || [],
    events: [
      { id: DRAFT_ID, slug: "national-day-2026", title_en: "National Day", title_ar: null, description_en: null, description_ar: null,
        starts_at: null, ends_at: null, status: "draft", signups_open: true, features: {}, theme: {},
        payload_schema: { fields: {} }, safety: {}, entries: 0 },
      { id: LIVE_ID, slug: "test-event", title_en: opts.liveTitle || "Test Event", title_ar: null, description_en: "Practice", description_ar: null,
        starts_at: "2026-11-04T04:40:00Z", ends_at: "2026-12-04T04:40:00Z", status: "live", signups_open: true,
        features: { giant_switch: true }, theme: {}, payload_schema: { fields: { treats: { type: "enum", values: ["candy"], required: true } } },
        safety: {}, entries: 3 },
      { id: PAST_ID, slug: "halloween-2026", title_en: "Halloween 2026", status: "archived", signups_open: false,
        starts_at: "2026-10-31T00:00:00Z", features: { giant_switch: true }, payload_schema: { fields: {} }, entries: 124 },
    ],
  };
  const admin = () => st.scopes.includes("events") || st.scopes.includes("community");
  const guard = (fn) => (a) => (admin() ? fn(a) : raise("NOT_ADMIN"));
  const find = (id) => st.events.find((e) => e.id === id);
  return {
    st,
    rpc: Object.assign({
      jc_me_get: (a, c) => (c.signedIn ? ok(Object.assign({}, MEMBER, { admin_scopes: st.scopes })) : raise("NOT_SIGNED_IN")),
      jc_admin_unlock: (a) => {
        const map = { "EVENTS-CODE-1": ["events"], "COMMUNITY-1": ["community"], "PETS-1": ["pets"] };
        if (!map[a.p_code]) return ok({ error: "BAD_ADMIN" });   // T3: wrong code is a 200 with an error body
        st.scopes = map[a.p_code];
        return ok(st.scopes);
      },
      jc_admin_exit: () => { st.scopes = []; return ok(null); },
      jc_admin_events_list: guard(() => ok(st.events)),
      jc_admin_event_save: guard((a) => {
        if (a.p_event === null) {
          st.events.unshift(Object.assign({ id: "66666666-6666-4666-8666-666666666666", status: "draft", signups_open: true,
            features: {}, payload_schema: { fields: {} }, entries: 0 }, a.p_fields));
        } else Object.assign(find(a.p_event), a.p_fields);
        return ok(st.events);
      }),
      jc_admin_event_publish: guard((a) => { find(a.p_event).status = "live"; return ok(st.events); }),
      jc_admin_event_signups: guard((a) => { find(a.p_event).signups_open = a.p_open; return ok(st.events); }),
      jc_event_close: guard((a) => {
        const e = find(a.p_event);
        if (a.p_confirm !== e.slug) return raise("CONFIRM_REQUIRED");
        e.status = "archived"; return ok({ homes: e.entries });
      }),
      jc_admin_code_rotate: (a) => (st.scopes.includes("community")
        ? ok({ scope: a.p_scope, code: "NEWCODE" + a.p_scope.toUpperCase(), version: 2 }) : raise("NOT_ADMIN")),
    }, opts.rpc || {}),
  };
}

async function signIn(page) {
  await page.goto("account/");
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/commons\/$/);
}
async function unlock(page, code) {
  await page.locator("#code").fill(code);
  await page.locator("#go").click();
}
const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();

test("lock: a wrong code says so; an events code opens the list (drafts included, no Codes)", async ({ page }) => {
  const ab = adminBackend();
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("h1")).toHaveText("Organizer tools");
  await unlock(page, "nope");
  await expect(page.locator("#msg")).toHaveText("That code didn't work.");
  await unlock(page, "EVENTS-CODE-1");
  await expect(page.locator(".sub")).toHaveText("Unlocked: Events");
  await expect(page.locator('li[data-event="national-day-2026"] small')).toContainText("Draft — only organizers can see it");
  await expect(page.locator('li[data-event="test-event"] small')).toContainText("Live · sign-ups open");
  await expect(page.locator('li[data-event="halloween-2026"] small')).toContainText("Closed");
  await expect(page.locator("[data-rotate]")).toHaveCount(0);                 // only community admins change codes
  expect(calls.filter((c) => c.name === "jc_hit").map((c) => c.args.p_page)).toContain("admin");
});

test("a code for another module (pets) doesn't open the event tools", async ({ page }) => {
  const ab = adminBackend();
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await unlock(page, "PETS-1");
  await expect(page.locator("#msg")).toHaveText("That code doesn't open the event tools.");
  await expect(page.locator("#newEv")).toHaveCount(0);
});

test("new event from the Halloween template: short name follows the title; questions + pin hints + switch saved", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await expect(page.locator("#form")).toHaveAttribute("data-no-autoreload", "");   // auto-update never reloads mid-edit
  await page.locator("#title_en").fill("Halloween 2027!");
  await expect(page.locator("#slug")).toHaveValue("halloween-2027");
  await page.locator("#useHalloween").click();
  await expect(page.locator(".qlist > li")).toHaveCount(3);
  await expect(page.locator(".qlist")).toContainText("Kids should come to…");
  await expect(page.locator(".qlist")).toContainText("Front gate");
  await expect(page.locator(".qlist")).toContainText("shown as the pin's ring");
  await expect(page.locator("#f_giant_switch")).toBeChecked();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const f = lastCall(calls, "jc_admin_event_save").args;
  expect(f.p_event).toBeNull();
  expect(Object.keys(f.p_fields).sort()).toEqual(["features", "payload_schema", "slug", "title_en"]);  // empty fields not sent
  expect(f.p_fields.features).toEqual({ giant_switch: true });
  expect(f.p_fields.payload_schema.fields.entrance).toMatchObject({ pin: "ring", label_en: "Kids should come to…",
    labels_en: { front: "Front gate", garden: "Garden gate (park side)", both: "Both gates" } });
  expect(f.p_fields.payload_schema.fields.treats).toMatchObject({ pin: "glyph", glyphs: { candy: "🍬", non_food: "🎃", both: "🍬🎃" } });
  await expect(page.locator('li[data-event="halloween-2027"] small')).toContainText("Draft");
});

// Premortem #1: an edit sends ONLY what changed, so two organizers don't overwrite each other.
test("editing a live event sends only the changed field; short name + questions locked", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await expect(page.locator("#slug")).toBeDisabled();
  await expect(page.locator("#useHalloween")).toHaveCount(0);                  // 3 homes signed up
  await expect(page.getByText("Homes have already signed up, so the questions can't change.")).toBeVisible();
  await expect(page.locator("#f_giant_switch")).toBeChecked();
  await page.locator("#description_en").fill("Practice run — not real.");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args).toEqual(
    { p_event: LIVE_ID, p_fields: { description_en: "Practice run — not real." } });
  // nothing changed → no call at all
  const n = calls.filter((c) => c.name === "jc_admin_event_save").length;
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Nothing changed.");
  expect(calls.filter((c) => c.name === "jc_admin_event_save").length).toBe(n);
});

test("editor checks: short name format, end before start", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  // the date pickers once pushed the page wider than the phone (taps landed on the wrong thing)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#title_en").fill("Fun");
  await page.locator("#slug").fill("1-bad slug");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toContainText("Short name: lowercase letters");
  await page.locator("#slug").fill("fun-day");
  await page.locator("#starts_at").fill("2026-12-02T18:00");
  await page.locator("#ends_at").fill("2026-12-02T17:00");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("The end can't be before the start.");
  expect(calls.some((c) => c.name === "jc_admin_event_save")).toBe(false);
});

test("publish (confirmed), pause sign-ups, close only with the exact short name", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  page.once("dialog", (d) => d.accept());
  await page.locator('li[data-event="national-day-2026"] [data-act="publish"]').click();
  await expect(page.locator("#msg")).toHaveText("Published — residents can see it now.");
  expect(lastCall(calls, "jc_admin_event_publish").args).toEqual({ p_event: DRAFT_ID });
  await page.locator('li[data-event="test-event"] [data-act="pause"]').click();
  await expect(page.locator("#msg")).toHaveText("Sign-ups are paused.");
  expect(lastCall(calls, "jc_admin_event_signups").args).toEqual({ p_event: LIVE_ID, p_open: false });
  await expect(page.locator('li[data-event="test-event"] [data-act="open"]')).toBeVisible();
  await page.locator('li[data-event="test-event"] [data-act="close"]').click();
  await page.locator("#closeSlug").fill("test");
  await page.locator("#closeGo").click();
  await expect(page.locator("#msg")).toHaveText("Type the short name exactly to confirm.");
  expect(calls.some((c) => c.name === "jc_event_close")).toBe(false);
  await page.locator("#closeSlug").fill("test-event");
  await page.locator("#closeGo").click();
  await expect(page.locator("#msg")).toHaveText("Closed. 3 homes took part.");
  expect(lastCall(calls, "jc_event_close").args).toEqual({ p_event: LIVE_ID, p_confirm: "test-event" });
});

test("community admin: change a code — shown once, gone after navigating", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("[data-rotate]")).toHaveCount(3);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-rotate="join"]').click();
  await expect(page.locator("#newCode")).toHaveText("NEWCODEJOIN");
  expect(lastCall(calls, "jc_admin_code_rotate").args).toEqual({ p_scope: "join" });
  await page.locator("#newEv").click();
  await page.locator("#cancel").click();
  await expect(page.locator("#newCode")).toHaveCount(0);
  // declining the confirm sends nothing
  page.once("dialog", (d) => d.dismiss());
  await page.locator('[data-rotate="events"]').click();
  expect(calls.filter((c) => c.name === "jc_admin_code_rotate").length).toBe(1);
});

test("a grant that expired mid-session (NOT_ADMIN) goes back to the lock with a clear message", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#newEv")).toBeVisible();
  ab.st.scopes = [];                                                          // e.g. the code was rotated
  await page.locator('li[data-event="test-event"] [data-act="pause"]').click();
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#msg")).toHaveText("Organizer tools are locked on your account — enter your code again.");
});

test("lock organizer tools: exit ends the unlock", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#exit").click();
  await expect(page.locator("#code")).toBeVisible();
  expect(calls.some((c) => c.name === "jc_admin_exit")).toBe(true);
});

test("hostile event titles are text; no CSP violations; Arabic + RTL", async ({ page }) => {
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  const ab = adminBackend({ scopes: ["events"], liveTitle: '<img src=x onerror="window.__pwned=1">' });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('li[data-event="test-event"] b')).toHaveText('<img src=x onerror="window.__pwned=1">');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("أدوات المنظمين");
  expect(csp).toEqual([]);
});

test("My Home links to the organizer tools; signed-out visitors go to sign in first", async ({ page }) => {
  const ab = adminBackend();
  await stubBackend(page, { rpc: ab.rpc });
  await page.goto("admin/");
  await expect(page).toHaveURL(/\/commons\/account\/\?next=/);
  await signIn(page);
  await page.goto("home/");
  await expect(page.locator("#toAdmin")).toHaveAttribute("href", "../admin/");
});
