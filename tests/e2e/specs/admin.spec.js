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
  // the template opens as editable cards (PR 2b)
  await expect(page.locator(".qcard")).toHaveCount(3);
  await expect(page.locator('.qcard[data-q="2"] [data-q-label="en"]')).toHaveValue("Kids should come to…");
  await expect(page.locator('.qcard[data-q="2"] [data-c-f="en"]').first()).toHaveValue("Front gate");
  await expect(page.locator('.qcard[data-q="2"] [data-q-pin]')).toHaveValue("ring");
  await expect(page.locator('.qcard[data-q="0"] [data-c-f="glyph"]').first()).toHaveValue("🍬");
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
  // any later action drops it (review PR #26): pausing sign-ups re-renders the page
  await page.locator('li[data-event="test-event"] [data-act="pause"]').click();
  await expect(page.locator("#msg")).toHaveText("Sign-ups are paused.");
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
  await page.goto("home/?tab=account");
  await expect(page.locator("#toAdmin")).toHaveAttribute("href", "../admin/");
});

test("copying a new code that the browser blocks says so (never a silent failure)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
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
  await expect(page.locator("fieldset").filter({ hasText: "Sign-up questions" }))
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
