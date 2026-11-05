// T5.3 — feedback: residents send (My Home → Account, linked to the home, said up front);
// only the platform owner reads it (Organizer tools → Feedback inbox).
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const FB = [
  { id: "f1", community: "jubail", community_name: "Jubail Commons", home: "Villa 12 · Ain Al Maha", kind: "idea",
    body: "A dog park near North?\n<b>please</b>", page: "/events/", created_at: "2026-11-04T10:00:00Z", read: false },
  { id: "f2", community: "jubail", community_name: "Jubail Commons", home: null, kind: "problem",
    body: "Map is slow", page: "/", created_at: "2026-11-04T12:00:00Z", read: true },
];

test("resident: the form says it goes with the home; sends kind + text + page; clears; errors shown", async ({ page }) => {
  let fails = 1;
  const { calls } = await stubBackend(page, { rpc: { jc_my_history: () => ok([]),
    jc_feedback_send: (a) => (a.p_body === "spam" && fails-- > 0 ? raise("RATE_LIMITED") : ok({ ok: true })) } });
  await signIn(page);
  await page.goto("home/?tab=account#feedback");
  await expect(page.locator("#feedback h2")).toHaveText("Ideas & Feedback");
  await expect(page.locator("#feedback .help")).toContainText("Sent with your home (Villa 12) so we can follow up. Only the person who runs Commons reads it.");
  await page.locator("#fbSend").click();
  await expect(page.locator("#msg")).toHaveText("Write something first.");
  expect(calls.filter((c) => c.name === "jc_feedback_send")).toHaveLength(0);
  await page.locator('[data-fbkind="problem"]').click();
  await page.locator("#fbBody").fill("  The map is slow on my phone  ");
  await page.locator("#fbSend").click();
  await expect(page.locator("#msg")).toHaveText("Thank you — sent.");
  const a = calls.filter((c) => c.name === "jc_feedback_send").pop().args;
  expect(a).toEqual({ p_kind: "problem", p_body: "The map is slow on my phone", p_page: null });
  await expect(page.locator("#fbBody")).toHaveValue("");
  await page.locator("#fbBody").fill("spam");
  await page.locator("#fbSend").click();
  await expect(page.locator("#msg")).toHaveText("Too many attempts. Try again later.");
  await expect(page.locator("#fbSend")).toBeEnabled();
});

test("resident: a half-typed message survives switching language", async ({ page }) => {
  await stubBackend(page, { rpc: { jc_my_history: () => ok([]) } });
  await signIn(page);
  await page.goto("home/?tab=account");
  await page.locator("#fbBody").fill("Half an idea");
  await page.locator("#langBtn").click();
  await expect(page.locator("#feedback h2")).toHaveText("أفكار وملاحظات");
  await expect(page.locator("#fbBody")).toHaveValue("Half an idea");
});

test("hub footer links members to the feedback form", async ({ page }) => {
  await stubBackend(page, {});
  await signIn(page);
  await expect(page.locator("#fbLink")).toHaveAttribute("href", "home/?tab=account#feedback");
  await expect(page.locator("#fbLink")).toHaveText("Ideas & Feedback");
});

test("owner: inbox shows unread first, text as text, marks read / unread", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"], owner: true, feedback: JSON.parse(JSON.stringify(FB)) });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#fbOpen")).toHaveText("Feedback Inbox · 1 Unread");
  await page.locator("#fbOpen").click();
  await expect(page.locator("h1")).toHaveText("Feedback Inbox");
  await expect(page.locator(".fblist li")).toHaveCount(2);
  await expect(page.locator(".fblist li").first().locator(".fbbody")).toHaveText("A dog park near North?\n<b>please</b>");
  await expect(page.locator(".fblist li b")).toHaveCount(0);                    // resident text never becomes markup
  await expect(page.locator(".fblist li").first().locator("small").first()).toContainText("Villa 12 · Ain Al Maha · Jubail Commons");
  await expect(page.locator(".fblist li").nth(1).locator("small").first()).toContainText("No home yet");
  await page.locator('[data-fb="f1"]').click();
  await expect(page.locator(".sub")).toHaveText("0 unread");
  expect(calls.filter((c) => c.name === "jc_feedback_mark_read").pop().args).toEqual({ p_id: "f1", p_read: true });
  await page.locator('[data-fb="f1"]').click();
  await expect(page.locator(".sub")).toHaveText("1 unread");
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#fbOpen")).toHaveText("Feedback Inbox · 1 Unread");
});

test("not the owner: no inbox button, even for a community admin", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#newEv")).toBeVisible();
  await expect(page.locator("#fbOpen")).toHaveCount(0);
  expect(calls.filter((c) => c.name === "jc_feedback_list")).toHaveLength(0);
});

test("owner with no organizer code still reaches the inbox — right subtitle, no error", async ({ page }) => {
  const ab = adminBackend({ owner: true, feedback: JSON.parse(JSON.stringify(FB)) });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#fbOpen")).toHaveText("Feedback Inbox · 1 Unread");
  await expect(page.locator("#code")).toHaveCount(0);
  await expect(page.locator(".sub")).toHaveText("You run Commons: feedback from every community comes here.");
  await expect(page.locator("#msg")).toBeEmpty();
});

// ── app review fixes ──
test("the unread count arriving late never wipes a half-typed banner", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], owner: true, feedback: JSON.parse(JSON.stringify(FB)) });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_feedback_list: (a, c) => new Promise((r) => setTimeout(() => r(ab.rpc.jc_feedback_list(a, c)), 800)),
  }) });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#bannerText").fill("Typing before the count lands");
  await expect(page.locator("#fbOpen")).toHaveText("Feedback Inbox · 1 Unread");
  await expect(page.locator("#bannerText")).toHaveValue("Typing before the count lands");
});

test("owner with an organizer code: Exit returns to the home view, not a dead lock screen", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], owner: true, feedback: JSON.parse(JSON.stringify(FB)) });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#exit").click();
  await expect(page.locator("#fbOpen")).toBeVisible();
  await expect(page.locator("#newEv")).toHaveCount(0);                            // the code is locked again
});

test("hub feedback link isn't duplicated by a language switch", async ({ page }) => {
  await stubBackend(page, {});
  await signIn(page);
  await page.locator("#langBtn").click();
  await expect(page.locator("#fbLink")).toHaveText("أفكار وملاحظات");          // redraw done before switching back (CI race)
  await page.locator("#langBtn").click();
  await expect(page.locator("#fbLink")).toHaveCount(1);
  await expect(page.locator("#fbLink")).toHaveText("Ideas & Feedback");
});
