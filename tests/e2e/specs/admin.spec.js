// T5.2 PR 2 — Organizer tools: unlock / exit, events list, create / edit (only changed
// fields), Halloween template, publish, sign-ups, close (type the short name), codes.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, MEMBER } = require("./stub");
const { adminBackend, signIn, ADMIN_DRAFT_ID: DRAFT_ID, ADMIN_LIVE_ID: LIVE_ID, ADMIN_PAST_ID: PAST_ID } = require("./backends");

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
  await expect(page.locator("h1")).toHaveText("Organizer Tools");
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
  await page.locator('[data-tpl="halloween"]').click();                           // T5.2 2c: start from a template
  await expect(page.locator("#form")).toHaveAttribute("data-no-autoreload", "");   // auto-update never reloads mid-edit
  await page.locator("#title_en").fill("Halloween 2027!");
  await expect(page.locator("#slug")).toHaveValue("halloween-2027");
  // the template opens as editable cards (PR 2b)
  await expect(page.locator(".qcard")).toHaveCount(3);
  await expect(page.locator('.qcard[data-q="2"] [data-q-label="en"]')).toHaveValue("Kids should come to…");
  await expect(page.locator('.qcard[data-q="2"] [data-c-f="en"]').first()).toHaveValue("Front gate");
  await expect(page.locator('.qcard[data-q="2"] [data-q-pin]')).toHaveValue("ring");
  await expect(page.locator('.qcard[data-q="0"] [data-c-f="glyph"]').first()).toHaveValue("🍬");
  await expect(page.locator("#f_giant_switch")).toBeChecked();
  await expect(page.locator("#f_supply")).toBeChecked();
  await expect(page.locator("#f_crowd_reports")).toBeChecked();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const f = lastCall(calls, "jc_admin_event_save").args;
  expect(f.p_event).toBeNull();
  expect(Object.keys(f.p_fields).sort()).toEqual(["features", "look", "payload_schema", "slug", "title_en"]);  // empty fields + default kind not sent
  expect(f.p_fields.look).toBe("halloween");
  expect(f.p_fields.features).toEqual({ giant_switch: true, supply: true, crowd_reports: true });   // R2a (F1): all three
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
  await page.locator('[data-tpl="blank"]').click();
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
  await page.goto("admin/?tab=community");                                 // codes live under Community (2026-11-06)
  await expect(page.locator("[data-rotate]")).toHaveCount(3);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-rotate="join"]').click();
  await expect(page.locator("#newCode")).toHaveText("NEWCODEJOIN");
  expect(lastCall(calls, "jc_admin_code_rotate").args).toEqual({ p_scope: "join" });
  // any later action drops it (review PR #26): pausing sign-ups re-renders the page
  await page.locator("#atab-events").click();
  await page.locator('li[data-event="test-event"] [data-act="pause"]').click();
  await expect(page.locator("#msg")).toHaveText("Sign-ups are paused.");
  await page.locator("#atab-community").click();
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
  await page.goto("admin/?tab=community");
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
  await page.goto("home/?tab=account");
  await expect(page.locator("#toAdmin")).toHaveAttribute("href", "../admin/");
});

test("copying a new code that the browser blocks says so (never a silent failure)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("blocked")) } }); });
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-rotate="events"]').click();
  await page.locator("#copyCode").click();
  await expect(page.locator("#msg")).toHaveText("Couldn't copy — select the code and copy it by hand.");
  await expect(page.locator("#newCode")).toHaveText("NEWCODEEVENTS");
});

test("signing in from the organizer page comes back to it", async ({ page }) => {
  await stubBackend(page);
  await page.goto("./");
  expect(await page.evaluate(() => jcSafeNext("../admin/"))).toBe("../admin/");
});

// ---- T5.2 PR 2b: writing your own questions ----

async function openNewDraft(page, title) {
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await page.locator("#title_en").fill(title);
}
async function addQ(page) {
  await page.locator("#addQ").click();
  return page.locator(".qcard").last();
}

test("write questions from scratch: pick-one with icons, yes/no, short answer → exact stored shape", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Garage Sale");
  await expect(page.locator("fieldset").filter({ hasText: "Sign-Up Questions" }))
    .toContainText("Avoid names, phone numbers or children's ages");
  let q = await addQ(page);
  await q.locator('[data-q-label="en"]').fill("What are you selling?");
  await q.locator('[data-q-label="ar"]').fill("ماذا تبيع؟");
  await q.locator("[data-q-req]").check();
  await q.locator("[data-q-pin]").selectOption("glyph");
  q = page.locator(".qcard").last();                                     // re-rendered with icon boxes
  await q.locator('[data-c-f="glyph"]').nth(0).fill("👕");
  await q.locator('[data-c-f="en"]').nth(0).fill("Clothes");
  await q.locator('[data-c-f="en"]').nth(1).fill("Toys & games");
  await q.locator('[data-qact="addc"]').click();
  await page.locator(".qcard").last().locator('[data-c-f="en"]').nth(2).fill("Furniture");
  // the busiest row (icon + English + Arabic + remove) still fits a phone screen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  q = await addQ(page);
  await q.locator('[data-q-label="en"]').fill("Cash only?");
  await q.locator("[data-q-type]").selectOption("bool");
  q = await addQ(page);
  await q.locator('[data-q-label="en"]').fill("Anything else?");
  await q.locator("[data-q-type]").selectOption("text");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args.p_fields.payload_schema).toEqual({ fields: {
    what_are_you_selling: { type: "enum", required: true, label_en: "What are you selling?", label_ar: "ماذا تبيع؟",
      values: ["clothes", "toys_games", "furniture"],
      labels_en: { clothes: "Clothes", toys_games: "Toys & games", furniture: "Furniture" },
      pin: "glyph", glyphs: { clothes: "👕" } },
    cash_only: { type: "bool", label_en: "Cash only?" },
    anything_else: { type: "text", label_en: "Anything else?" },
  } });
});

test("one question drives the ring and one the icon: picking ring elsewhere moves it", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Ring test");
  await page.locator("#useHalloween").click();
  await expect(page.locator('.qcard[data-q="2"] [data-q-pin]')).toHaveValue("ring");
  await page.locator('.qcard[data-q="1"] [data-q-pin]').selectOption("ring");
  await expect(page.locator('.qcard[data-q="1"] [data-q-pin]')).toHaveValue("ring");
  await expect(page.locator("#msg")).toHaveText("Pin ring colour now comes from question 2 — only one question can set it.");
  await expect(page.locator('.qcard[data-q="2"] [data-q-pin]')).toHaveValue("");
});

test("builder checks: wording required, two choices minimum, choice wording required — nothing sent", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Checks");
  const q = await addQ(page);
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Every question needs English wording.");
  await q.locator('[data-q-label="en"]').fill("Pick");
  await q.locator('[data-c-f="en"]').nth(0).fill("A");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("A pick-one question needs at least two choices.");
  await page.locator(".qcard").last().locator('[data-c-f="ar"]').nth(1).fill("ب");     // Arabic but no English
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Every choice needs English wording.");
  expect(calls.some((c) => c.name === "jc_admin_event_save")).toBe(false);
});

test("reorder and remove questions; keys of existing questions never change", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Reorder");
  await page.locator("#useHalloween").click();
  await page.locator('.qcard[data-q="2"] [data-qact="up"]').click();                   // entrance before handout
  await page.locator('.qcard[data-q="0"] [data-q-label="en"]').fill("What's on offer?");  // reword treats
  page.once("dialog", (d) => d.accept());
  await page.locator('.qcard[data-q="2"] [data-qact="del"]').click();                  // drop handout
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const fields = lastCall(calls, "jc_admin_event_save").args.p_fields.payload_schema.fields;
  expect(Object.keys(fields)).toEqual(["treats", "entrance"]);                          // keys kept, order kept
  expect(fields.treats.label_en).toBe("What's on offer?");
});

test("reopening a draft and saving untouched questions sends nothing", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Untouched");
  await page.locator("#useHalloween").click();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const n = calls.filter((c) => c.name === "jc_admin_event_save").length;
  await page.locator('li[data-event="untouched"] [data-act="edit"]').click();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Nothing changed.");
  expect(calls.filter((c) => c.name === "jc_admin_event_save").length).toBe(n);
});

test("hostile question wording stays text in the builder and on the resident form", async ({ page }) => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await openNewDraft(page, "Evil");
  const q = await addQ(page);
  await q.locator('[data-q-label="en"]').fill(evil);
  await q.locator('[data-c-f="en"]').nth(0).fill(evil);
  await q.locator('[data-qact="up"]').count();
  await page.locator("#addQ").click();                                                  // re-render with the values
  await expect(page.locator('.qcard[data-q="0"] [data-q-label="en"]')).toHaveValue(evil);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator("#qs img").count()).toBe(0);
});

// PR #27 review M1: the server's 8 KB cap is measured on Postgres's jsonb text (": ", ", "),
// which is longer than JSON.stringify. Grow one question a byte at a time: the first size the
// page refuses must still be UNDER 8 KB as plain JSON — i.e. the old check would have let it
// through and the server would have rejected it.
test("question size cap counts bytes the way the database stores them", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#newEv")).toBeVisible();
  const r = await page.evaluate(() => {
    const qs = (n) => [{ key: "a", label_en: "q" + "x".repeat(n), label_ar: "", type: "enum", required: false, pin: "",
      choices: Array.from({ length: 20 }, (_, j) => ({ value: "v" + j, en: "y".repeat(300), ar: "", glyph: "" })) }];
    const real = pgJsonBytes;
    for (let n = 0; n < 9000; n++) {
      if (toSchema(qs(n)).err !== "Q_TOO_BIG") continue;
      pgJsonBytes = () => 0;                        // build the same schema without the cap
      const schema = toSchema(qs(n)).schema;
      pgJsonBytes = real;
      return { n, plain: new TextEncoder().encode(JSON.stringify(schema)).length, stored: real(schema),
               previousFits: !toSchema(qs(n - 1)).err };
    }
    return null;
  });
  expect(r).not.toBeNull();
  expect(r.previousFits).toBe(true);
  expect(r.stored).toBe(8193);                       // refused exactly when the stored text passes 8 KB…
  expect(r.plain).toBeLessThanOrEqual(8192);         // …while plain JSON still looked fine
});

// ---- T5.2 PR B: per-event admins ----

const GRANT = "TOKEN_grantlink_abcdefgh";

test("event admin (no code): straight to their events — no New event, Publish, Codes or Lock", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [LIVE_ID] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#code")).toHaveCount(0);                   // no lock screen
  await expect(page.locator(".sub")).toHaveText("You help run these events.");
  await expect(page.locator(".aevents li")).toHaveCount(1);
  await expect(page.locator(".aevents li")).toContainText("Test Event");
  await expect(page.locator("#newEv")).toHaveCount(0);
  await expect(page.locator('[data-act="admins"]')).toHaveCount(0);     // appointing is the community's
  await expect(page.locator("#exit")).toHaveCount(0);                   // nothing to lock: no code
  await expect(page.locator("h2.group").filter({ hasText: /codes/i })).toHaveCount(0);
  await page.locator("#atab-community").click();
  await expect(page.locator("#addCode")).toBeVisible();
  await expect(page.locator("#exit, [data-rotate], #healthOpen")).toHaveCount(0);
  await page.locator("#atab-events").click();
  await page.locator('[data-act="pause"]').click();                    // runs their own event
  await expect(page.locator("#msg")).toHaveText(/paused/i);
  expect(lastCall(calls, "jc_admin_event_signups").args).toEqual({ p_event: LIVE_ID, p_open: false });
});

test("event admin of a draft sees Edit and 'a community admin publishes it' — no Publish", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [DRAFT_ID] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  const row = page.locator('[data-event="national-day-2026"]');
  await expect(row.locator('[data-act="publish"]')).toHaveCount(0);
  await expect(row).toContainText("A community admin publishes it.");
  await expect(row.locator('[data-act="edit"]')).toBeVisible();
});

test("community admin: Admins panel — make a link (shown once), see holders, remove, cancel a link", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"],
    admins: [{ user_id: "u-7", name: "Omar", village: "ain-al-maha", type: "villa", building: null, number: "7" }] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  const row = page.locator('[data-event="test-event"]');
  await row.locator('[data-act="admins"]').click();
  await expect(row.locator(".adminlist li")).toHaveCount(1);
  await expect(row.locator(".adminlist li").first()).toContainText("Omar");
  await expect(row.locator(".adminlist li").first()).toContainText("Villa 7");
  await row.locator("#makeLink").click();
  await expect(page.locator("#newLink")).toHaveText("http://localhost:4173/commons/admin/?eventadmin=TOKEN_eventadmin_1abcdef");
  expect(lastCall(calls, "jc_event_admin_link_create").args).toEqual({ p_event: LIVE_ID });
  await expect(row.locator(".adminlist li")).toHaveCount(2);               // + the unused link
  await expect(row.locator(".adminlist li").last()).toContainText("Unused link");
  await page.locator('[data-act="pause"]').click();                       // any other action drops the shown link
  await expect(page.locator("#newLink")).toHaveCount(0);
  await expect(row.locator(".adminlist li")).toHaveCount(2);              // the panel itself stays open
  page.once("dialog", (d) => d.accept());
  await row.locator('[data-unadmin="u-7"]').click();
  await expect(page.locator("#msg")).toHaveText("Removed.");
  await expect(page.locator("#newLink")).toHaveCount(0);                   // the link is shown once
  expect(lastCall(calls, "jc_event_admin_revoke").args).toEqual({ p_event: LIVE_ID, p_user: "u-7", p_link: null });
  await row.locator('[data-unlink="link-1"]').click();
  await expect(row.locator(".adminlist li")).toHaveCount(0);
  await expect(row).toContainText("No one yet.");
  expect(lastCall(calls, "jc_event_admin_revoke").args).toEqual({ p_event: LIVE_ID, p_user: null, p_link: "link-1" });
});

test("the old shared events code runs events but can't appoint admins", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator(".aevents li")).toHaveCount(3);
  await expect(page.locator('[data-act="admins"]')).toHaveCount(0);
});

test("grant link: asks first (nothing on page load), says what the role sees, accepts once", async ({ page }) => {
  const ab = adminBackend({ acceptable: [GRANT] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?eventadmin=" + GRANT);
  await expect(page.locator("h1")).toHaveText("Help Run an Event");
  await expect(page.locator(".acclist li")).toHaveCount(3);
  await expect(page.locator(".acclist")).toContainText("house number, map pin and answers");
  await expect(page.locator(".acclist")).toContainText("5 days after the event closes");
  expect(new URL(page.url()).search).toBe("");                             // token dropped from the URL
  expect(calls.some((c) => c.name === "jc_event_admin_accept")).toBe(false);
  await page.locator("#accYes").click();
  await expect(page.locator("#msg")).toHaveText("You're now an admin of Test Event.");
  await expect(page.locator(".aevents li")).toHaveCount(1);
  expect(calls.filter((c) => c.name === "jc_event_admin_accept").map((c) => c.args)).toEqual([{ p_token: GRANT }]);
});

test("grant link: used / expired → explained; language switch keeps the question", async ({ page }) => {
  const ab = adminBackend({ acceptable: [] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?eventadmin=" + GRANT);
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("ساعد في إدارة فعالية");
  await page.locator("#langBtn").click();
  await page.locator("#accYes").click();
  await expect(page.locator("#msg")).toHaveText("This link has been used, has expired, or was cancelled — ask for a new one.");
});

test("grant link while signed out: sign in, then straight back to the question", async ({ page }) => {
  const ab = adminBackend({ acceptable: [GRANT] });
  await stubBackend(page, { rpc: ab.rpc });
  await page.goto("admin/?eventadmin=" + GRANT);
  await expect(page).toHaveURL(/\/commons\/account\/\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("../admin/?eventadmin=" + GRANT);
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(new RegExp("/commons/admin/"));
  await expect(page.locator("h1")).toHaveText("Help Run an Event");
});

test("already in: 'Enter Another Code' opens the code box with Back; a community code adds Codes", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [LIVE_ID] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await page.locator("#addCode").click();
  await expect(page.locator("#code")).toBeVisible();
  await page.locator("#back").click();
  await page.locator("#atab-events").click();
  await expect(page.locator(".aevents li")).toHaveCount(1);
  await page.locator("#atab-community").click();
  await page.locator("#addCode").click();
  await unlock(page, "COMMUNITY-1");
  await page.locator("#atab-events").click();
  await expect(page.locator(".aevents li")).toHaveCount(3);                 // community admin: every event
  await page.locator("#atab-community").click();
  await expect(page.locator("h2.group").filter({ hasText: /codes/i })).toBeVisible();
});

test("code holder who is also an event admin: Lock drops the code, keeps their own event", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], adminEvents: [LIVE_ID] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator(".aevents li")).toHaveCount(3);
  await page.locator("#atab-community").click();
  await page.locator("#exit").click();
  await page.locator("#atab-events").click();
  await expect(page.locator(".aevents li")).toHaveCount(1);              // still runs Test Event
  await expect(page.locator(".aevents li")).toContainText("Test Event");
  await expect(page.locator("#exit")).toHaveCount(0);
  await expect(page.locator("#code")).toHaveCount(0);
});

test("one event's NOT_ADMIN (it just closed) keeps the person's other events — no lock-out", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [LIVE_ID, DRAFT_ID] });
  ab.rpc.jc_admin_event_signups = () => { ab.st.adminEvents = [DRAFT_ID]; return raise("NOT_ADMIN"); };
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator(".aevents li")).toHaveCount(2);
  await page.locator('[data-act="pause"]').click();
  await expect(page.locator("#msg")).toHaveText("Organizer tools are locked on your account — enter your code again.");
  await expect(page.locator("#code")).toHaveCount(0);                    // not the lock screen
  await expect(page.locator(".aevents li")).toHaveCount(1);
  await expect(page.locator(".aevents li")).toContainText("National Day");
});

// ---- T5.2 PR 2c: templates, kind, look, venue ----

test("New event opens six templates; Cancel goes back; Blank starts empty as a homes event", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await expect(page.locator("[data-tpl]")).toHaveCount(6);
  await page.locator("#cancel").click();
  await expect(page.locator(".aevents li")).toHaveCount(3);
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await expect(page.locator('input[name="kind"][value="homes"]')).toBeChecked();
  await expect(page.locator("#venueBox")).toBeHidden();
  await expect(page.locator("#look")).toHaveValue("plain");
  await expect(page.locator(".qcard")).toHaveCount(0);
});

test("Market template: one place + JICM notice + spots; place pinned from pasted coordinates; saved as a venue", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="market"]').click();
  await expect(page.locator('input[name="kind"][value="venue"]')).toBeChecked();
  await expect(page.locator("#venueBox")).toBeVisible();
  await expect(page.locator("#venueBox .notice")).toContainText("community management (JICM)");
  await expect(page.locator("#spots")).toBeChecked();
  await expect(page.locator("#look")).toHaveValue("market");
  await expect(page.locator(".qcard")).toHaveCount(2);
  await expect(page.locator("#venueState")).toHaveText("No place pinned yet — needed before you publish.");
  await page.locator("#title_en").fill("Kids Market");
  await page.locator("#venue_name_en").fill("Central Park");
  await page.locator("#coords").fill("24.5305, 54.4305");
  await page.locator("#coordsGo").click();
  await page.locator("#setVenue").click();
  await expect(page.locator("#venueState")).toHaveText("Place pinned.");
  await page.locator("#capacity").fill("2.5");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toContainText("a whole number from 1 to 5000");
  expect(calls.filter((c) => c.name === "jc_admin_event_save")).toHaveLength(0);
  await page.locator("#capacity").fill("30");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const f = lastCall(calls, "jc_admin_event_save").args.p_fields;
  expect(f).toMatchObject({ kind: "venue", look: "market", venue_name_en: "Central Park",
    venue_lat: 24.5305, venue_lng: 54.4305, capacity: 30, spots: true });
  expect(f.venue_name_ar).toBeUndefined();                               // blanks aren't sent
  expect(Object.keys(f.payload_schema.fields).sort()).toEqual(["selling", "table"]);
  await expect(page.locator('li[data-event="kids-market"] small')).toContainText("at Central Park");
  await expect(page.locator('li[data-event="kids-market"] small')).toContainText("0 households");
});

test("required fields: * shown; Save without the place asks first; draft saves with a note; Publish says what's missing", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="gathering"]').click();
  await expect(page.locator('label:has(#title_en) .req')).toHaveText("*");
  await expect(page.locator('label:has(#venue_name_en) .req')).toHaveText("*");
  await expect(page.locator("#venuePinHelp .req")).toHaveText("*");
  await page.locator("#title_en").fill("Iftar");
  // 1. Save → asked; Cancel keeps the editor open, fields highlighted, nothing sent
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.locator("#save").click();
  expect(asked).toContain("Still missing: Place name (English), Pin on the map.");
  await expect(page.locator("#msg")).toHaveText("Fill in the highlighted fields — or save as a draft to finish later.");
  await expect(page.locator("#venue_name_en")).toHaveClass(/missing/);
  await expect(page.locator("#venuePinHelp")).toHaveClass(/missing/);
  expect(calls.filter((c) => c.name === "jc_admin_event_save")).toHaveLength(0);
  // 2. Save → OK: a draft, and the list of what publishing still needs
  page.once("dialog", (d) => d.accept());
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved as a draft. Before you can publish, add: Place name (English), Pin on the map.");
  await expect(page.locator('li[data-event="iftar"] small')).toContainText("no place yet");
  // 3. Publish from the list: explained here, the server isn't asked
  await page.locator('li[data-event="iftar"] [data-act="publish"]').click();
  await expect(page.locator("#msg")).toHaveText("Before you can publish, add: Place name (English), Pin on the map. Tap Edit to finish it.");
  expect(calls.filter((c) => c.name === "jc_admin_event_publish")).toHaveLength(0);
});

test("required fields: a homes event with a title saves without any prompt", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="yard_sale"]').click();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Add a title.");
  await expect(page.locator("#title_en")).toHaveClass(/missing/);
  await page.locator("#title_en").fill("Street sale");
  await page.locator("#save").click();                                            // no dialog expected
  await expect(page.locator("#msg")).toHaveText("Saved.");
});

test("editing: the kind is locked once homes signed up; an untouched venue sends nothing; one change sends one field", async ({ page }) => {
  const VENUE_ID = "77777777-7777-4777-8777-777777777777";
  const ab = adminBackend({ scopes: ["community"], extraEvents: [{ id: VENUE_ID, slug: "picnic", title_en: "Picnic",
    status: "draft", signups_open: true, features: {}, payload_schema: { fields: {} }, entries: 0,
    kind: "venue", look: "gathering", venue_name_en: "Beach", venue_lat: 24.531, venue_lng: 54.431, capacity: 40, spots: false }] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();      // 3 homes in
  await expect(page.locator('input[name="kind"][value="venue"]')).toBeDisabled();
  await expect(page.locator("#form")).toContainText("Homes have signed up, so the kind can't change.");
  await page.locator("#cancel").click();
  await page.locator('li[data-event="picnic"] [data-act="edit"]').click();
  await expect(page.locator("#venueState")).toHaveText("Place pinned.");
  await expect(page.locator("#capacity")).toHaveValue("40");
  const n = calls.filter((c) => c.name === "jc_admin_event_save").length;
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Nothing changed.");
  expect(calls.filter((c) => c.name === "jc_admin_event_save")).toHaveLength(n);
  await page.locator("#capacity").fill("50");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args.p_fields).toEqual({ capacity: 50 });
  // switching a draft to homes sends only the kind (the server clears the place)
  await page.locator('li[data-event="picnic"] [data-act="edit"]').click();
  await page.locator('input[name="kind"][value="homes"]').check();
  await expect(page.locator("#venueBox")).toBeHidden();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");                          // wait for the call (raced on CI)
  expect(lastCall(calls, "jc_admin_event_save").args.p_fields).toEqual({ kind: "homes" });
});

test("venue editor: Enter in the coordinates box moves the map and never saves; homes → venue sends kind + place", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="national-day-2026"] [data-act="edit"]').click();   // a homes draft
  await page.locator('input[name="kind"][value="venue"]').check();
  await expect(page.locator("#venueBox")).toBeVisible();
  await page.locator("#coords").fill("https://maps.google.com/?q=24.5301,54.4312");
  await page.locator("#coords").press("Enter");
  await expect(page.locator("#form")).toBeVisible();                                    // still editing
  expect(calls.filter((c) => c.name === "jc_admin_event_save")).toHaveLength(0);
  await page.locator("#setVenue").click();
  await page.locator("#venue_name_en").fill("Seef Park");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args.p_fields).toEqual({
    kind: "venue", venue_name_en: "Seef Park", venue_lat: 24.5301, venue_lng: 54.4312 });
});

test("description toolbar: buttons add the markers; the preview shows the formatting; text is stored plain", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await page.locator("#title_en").fill("Clean-up day");
  const t = page.locator("#description_en");
  await t.fill("Join us\nbring gloves");
  await t.evaluate((n) => n.setSelectionRange(0, 7));                            // "Join us"
  await page.locator('label:has(#description_en) ~ .richbar .rich-b, .richbar .rich-b').first().click();
  await expect(t).toHaveValue("**Join us**\nbring gloves");
  await t.evaluate((n) => n.setSelectionRange(12, 24));                          // line 2
  await page.locator(".richbar .rich-ul").first().click();
  await expect(t).toHaveValue("**Join us**\n- bring gloves");
  await expect(page.locator("#prev_en strong")).toHaveText("Join us");
  await expect(page.locator("#prev_en ul li")).toHaveText(["bring gloves"]);
  await page.locator(".richbar .rich-ul").first().click();                       // toggles off
  await expect(t).toHaveValue("**Join us**\nbring gloves");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(calls.filter((c) => c.name === "jc_admin_event_save").pop().args.p_fields.description_en).toBe("**Join us**\nbring gloves");
});

test("description toolbar edge cases: blank lines kept, whole-line selection, toggle off from inside, outside the label", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await expect(page.locator("label .richbar")).toHaveCount(0);                  // not part of the box's name
  const t = page.locator("#description_en");
  const ol = page.locator(".richbar .rich-ol").first();
  // two paragraphs selected → numbered 1, 2; the blank line between stays blank
  await t.fill("first\n\nsecond");
  await t.evaluate((n) => n.setSelectionRange(0, n.value.length));
  await ol.click();
  await expect(t).toHaveValue("1. first\n\n2. second");
  // a whole line selected with its line break doesn't take the next line
  await t.fill("one\ntwo");
  await t.evaluate((n) => n.setSelectionRange(0, 4));                           // "one\n"
  await page.locator(".richbar .rich-h").first().click();
  await expect(t).toHaveValue("## one\ntwo");
  // bold switched off by selecting just the word inside the markers
  await t.fill("a **word** b");
  await t.evaluate((n) => n.setSelectionRange(4, 8));                           // "word"
  await page.locator(".richbar .rich-b").first().click();
  await expect(t).toHaveValue("a word b");
  // a • line is recognised as a bullet and switched off
  await t.fill("• tea");
  await page.locator(".richbar .rich-ul").first().click();
  await expect(t).toHaveValue("tea");
});

// ── T5.4 coming soon ──
test("coming soon: a one-place draft with no place goes on the list; opening sign-ups needs the place", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"], extraEvents: [{ id: "99999999-9999-4999-8999-999999999999", slug: "fair",
    title_en: "Spring Fair", status: "draft", signups_open: true, features: {}, payload_schema: { fields: {} }, entries: 0,
    kind: "venue", look: "market" }] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  const row = page.locator('li[data-event="fair"]');
  await expect(row.locator('[data-act="announce"]')).toHaveText("Publish as Coming Soon");
  await expect(row.locator('[data-act="publish"]')).toHaveText("Publish and Open Sign-Ups");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await row.locator('[data-act="announce"]').click();
  expect(asked).toContain("Everything saved so far");
  await expect(page.locator("#msg")).toHaveText("On the list as coming soon. Open sign-ups when it's ready.");
  await expect(row.locator("small")).toContainText("Coming Soon — residents see it, sign-ups not open yet");
  expect(calls.filter((c) => c.name === "jc_admin_event_announce").pop().args).toEqual({ p_event: "99999999-9999-4999-8999-999999999999" });
  await row.locator('[data-act="open"]').click();
  await expect(page.locator("#msg")).toHaveText("Before you can open sign-ups, add: Place name (English), Pin on the map. Tap Edit to finish it.");
  expect(calls.filter((c) => c.name === "jc_admin_event_signups")).toHaveLength(0);
  // editing a coming-soon event without its place: saves as before, with the prompt
  await row.locator('[data-act="edit"]').click();
  await page.locator("#description_en").fill("Stalls, food, games");
  let asked2 = "";
  page.once("dialog", (d) => { asked2 = d.message(); d.accept(); });
  await page.locator("#save").click();
  expect(asked2).toContain("It stays coming soon");
  await expect(page.locator("#msg")).toHaveText("Saved — still coming soon. Before you can open sign-ups, add: Place name (English), Pin on the map.");
  // once the place is there, Open Sign-Ups works and the event is open
  Object.assign(ab.st.events.find((e) => e.slug === "fair"), { venue_name_en: "Central Park", venue_lat: 24.531, venue_lng: 54.432 });
  await page.reload();
  await page.locator('li[data-event="fair"] [data-act="open"]').click();
  await expect(page.locator("#msg")).toHaveText("Sign-ups are open.");
  await expect(page.locator('li[data-event="fair"] small')).toContainText("Live · sign-ups open");
});

test("coming soon: event admins can't announce, but can open sign-ups on an announced event", async ({ page }) => {
  const ab = adminBackend({ adminEvents: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"] });
  Object.assign(ab.st.events.find((e) => e.slug === "test-event"), { signups_open: false, coming_soon: true });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('li[data-event="national-day-2026"] [data-act="announce"]')).toHaveCount(0);
  await expect(page.locator('li[data-event="test-event"] [data-act="open"]')).toHaveCount(1);
  await page.locator('li[data-event="test-event"] [data-act="open"]').click();
  await expect(page.locator("#msg")).toHaveText("Sign-ups are open.");
});

test("back to coming soon: offered on a published event nobody has joined; refused once homes are in", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"], extraEvents: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "quiz",
    title_en: "Quiz Night", status: "live", signups_open: true, features: {}, payload_schema: { fields: {} }, entries: 0 }] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator('li[data-event="test-event"] [data-act="announce"]')).toHaveCount(0);   // 3 homes in
  const row = page.locator('li[data-event="quiz"]');
  await expect(row.locator('[data-act="announce"]')).toHaveText("Move to Coming Soon");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await row.locator('[data-act="announce"]').click();
  expect(asked).toContain("back to coming soon");
  await expect(row.locator("small")).toContainText("Coming Soon — residents see it");
  await expect(row.locator('[data-act="announce"]')).toHaveCount(0);
  await expect(row.locator('[data-act="open"]')).toHaveCount(1);
  // someone joined meanwhile (another organizer's screen): the server says why
  ab.st.events.find((e) => e.slug === "quiz").coming_soon = false;
  ab.st.events.find((e) => e.slug === "quiz").signups_open = true;
  await page.reload();
  await expect(page.locator('li[data-event="quiz"] [data-act="announce"]')).toBeVisible();   // list loaded first
  ab.st.events.find((e) => e.slug === "quiz").entries = 1;
  page.once("dialog", (d) => d.accept());
  await page.locator('li[data-event="quiz"] [data-act="announce"]').click();
  await expect(page.locator("#msg")).toHaveText("Homes have already signed up, so it can't go back to coming soon. Pause sign-ups instead.");
  expect(calls.filter((c) => c.name === "jc_admin_event_announce")).toHaveLength(2);
});

test("event editor: the date fields fit the phone screen (no spilling past the right edge)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="halloween"]').click();
  await page.locator("#starts_at").fill("2026-11-05T20:50");
  const vw = page.viewportSize().width;
  for (const id of ["#starts_at", "#ends_at"]) {
    const b = await page.locator(id).boundingBox();
    const panel = await page.locator(id).evaluate((n) => n.closest(".panel, form, main").getBoundingClientRect().right);
    expect(b.x + b.width).toBeLessThanOrEqual(Math.min(vw, panel) + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
});

test("My Home → Account: organizers get their own button above the box; residents a quiet link at the bottom", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("home/?tab=account");
  const btn = page.locator("a#toAdmin.btn");
  await expect(btn).toHaveText("Organizer Tools");
  const [b, panel] = [await btn.boundingBox(), await page.locator(".panel").first().boundingBox()];
  expect(b.y + b.height).toBeLessThanOrEqual(panel.y);                   // above the account box, not inside it
  expect(await page.locator(".panel #toAdmin").count()).toBe(0);
});

test("My Home → Account: a resident sees 'Have an organizer code?' at the bottom, not a big button", async ({ page }) => {
  const ab = adminBackend();
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("home/?tab=account");
  await expect(page.locator("#toAdmin")).toHaveText("Have an organizer code?");
  await expect(page.locator("a#toAdmin.btn")).toHaveCount(0);
});

test("My Home → Account: a pets-only code doesn't get the Organizer Tools button; the platform owner does", async ({ page }) => {
  const ab = adminBackend({ scopes: ["pets"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("home/?tab=account");
  await expect(page.locator("#toAdmin")).toHaveText("Have an organizer code?");
  ab.st.scopes = []; ab.st.owner = true;
  await page.reload();
  await expect(page.locator("a#toAdmin.btn")).toHaveText("Organizer Tools");
});

test("Organizer Tools sub-menu: Events · Banner · Community, each with its own part; ?tab= remembered", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"], owner: true });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator(".subtabs [role=tab]")).toHaveText(["Events", "Banner", "Community"]);
  await expect(page.locator("#newEv")).toBeVisible();
  await expect(page.locator("#bannerForm, [data-rotate], #healthOpen")).toHaveCount(0);
  await page.locator("#atab-banner").click();
  await expect(page.locator("#bannerForm")).toBeVisible();
  await expect(page.locator("#newEv")).toHaveCount(0);
  await page.locator("#atab-community").click();
  await expect(page).toHaveURL(/tab=community/);
  await expect(page.locator("#healthOpen")).toBeVisible();
  await expect(page.locator("#fbOpen")).toBeVisible();
  await expect(page.locator("[data-rotate]")).toHaveCount(3);
  await expect(page.locator("#addCode")).toBeVisible();
  await page.reload();
  await expect(page.locator("#atab-community")).toHaveAttribute("aria-selected", "true");
});

test("Organizer Tools sub-menu: an events organizer gets no codes / health; Community keeps Add code + Lock", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  await expect(page.locator("#healthOpen, [data-rotate], #fbOpen")).toHaveCount(0);
  await expect(page.locator("#addCode")).toBeVisible();
  await expect(page.locator("#exit")).toBeVisible();
});

test("Organizer Tools ?tab=: an unknown or not-allowed tab falls back to one the person has", async ({ page }) => {
  const ab = adminBackend({ adminEvents: [PAST_ID] });                    // event admin, no live event: no Banner tab
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await expect(page.locator("#atab-events")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".aevents")).toBeVisible();
  await page.goto("admin/?tab=zzz");
  await expect(page.locator("#atab-events")).toHaveAttribute("aria-selected", "true");
});

test("Organizer Tools: a half-typed banner survives switching tabs; focus stays on the tapped tab", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=banner");
  await page.locator("#bannerText").fill("Half way through");
  await page.locator("#atab-events").click();
  await expect(page.locator("#atab-events")).toBeFocused();
  await page.locator("#atab-banner").click();
  await expect(page.locator("#bannerText")).toHaveValue("Half way through");
});
