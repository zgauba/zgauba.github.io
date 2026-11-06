// R2b-1 — organizer event-night actions (docs/plans/R2b-1-organizer-acts.md): an organizer / the event's admin
// marks a home out, sets or clears its supply, or removes a no-show's sign-up (no Undo: the confirm names the home);
// the household sees "Adjusted by an organizer · time" / "An organizer removed your sign-up" — never who — and can
// clear its own supply by tapping the pressed level again.
const { test, expect } = require("@playwright/test");
const { stubBackend } = require("./stub");
const { dayBackend, adminBackend, signIn, DAY_ID } = require("./backends");

const rpcCalls = (calls, name) => calls.filter((c) => c.kind === "rpc" && c.name === name);
const lastCall = (calls, name) => rpcCalls(calls, name).pop();
const card = (page, n) => page.locator(".sulist li").filter({ has: page.locator("b", { hasText: new RegExp("^(Villa|Townhouse) " + n + "$") }) });

async function openDay(page, opts = {}, wrap) {
  const db = dayBackend(opts);
  if (wrap) wrap(db);
  const sb = await stubBackend(page, { rpc: db.rpc });
  await signIn(page);
  await page.goto("events/?id=" + DAY_ID + "&tab=mine");
  await expect(page.locator("#evsub")).toBeVisible();
  return { db, calls: sb.calls };
}
async function openSignups(page, opts) {
  const ab = adminBackend(Object.assign({ scopes: ["events"] }, opts || {}));
  const sb = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="signups"]').click();
  await expect(page.locator(".sulist").first()).toBeVisible();
  return { ab, calls: sb.calls };
}

// ── the household ──
test("supply: tapping the pressed level clears it (jc_entry_supply_clear, exact args); another level still sets", async ({ page }) => {
  const { calls } = await openDay(page, { supply: 2 });
  await expect(page.locator("#live [data-supply='2']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#live")).toContainText("Tap the selected level again to clear it.");
  await page.locator("#live [data-supply='2']").click();
  await expect(page.locator("#live .seg4 [aria-pressed=true]")).toHaveCount(0);
  expect(rpcCalls(calls, "jc_entry_supply_clear").map((c) => c.args)).toEqual([{ p_event: DAY_ID }]);
  expect(rpcCalls(calls, "jc_entry_live_set")).toHaveLength(0);                  // never "set it to null"
  await expect(page.locator("#live")).not.toContainText("Tap the selected level again");
  await page.locator("#live [data-supply='1']").click();
  await expect(page.locator("#live [data-supply='1']")).toHaveAttribute("aria-pressed", "true");
  expect(rpcCalls(calls, "jc_entry_live_set").map((c) => c.args)).toEqual([{ p_event: DAY_ID, p_state: null, p_supply: 1 }]);
  expect(rpcCalls(calls, "jc_entry_supply_clear")).toHaveLength(1);
});

test("adjusted by an organizer: the time, never who; the household's own tap clears it", async ({ page }) => {
  const { calls } = await openDay(page, { orgAdjusted: new Date().toISOString() }, (db) => {
    const get = db.rpc.jc_event_get;   // a stray organizer field must never reach the screen
    db.rpc.jc_event_get = async (a) => { const r = await get(a); r.body.mine.org_by = "organizer-secret-id"; return r; };
  });
  const line = page.locator(".cta .orgline");
  await expect(line).toHaveText(/^Adjusted by an organizer · \d{1,2}:\d{2}\s?[AP]M$/);
  await expect(line).toHaveAttribute("role", "note");
  expect(await page.content()).not.toContain("organizer-secret-id");
  await page.locator("#live [data-live=done]").click();
  await expect(page.locator("#live [data-live=done]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cta .orgline")).toHaveCount(0);
  expect(rpcCalls(calls, "jc_entry_live_set")).toHaveLength(1);
});

test("an older change shows its date too", async ({ page }) => {
  await openDay(page, { orgAdjusted: new Date(Date.now() - 3 * 86400e3).toISOString() });
  await expect(page.locator(".cta .orgline")).toHaveText(/^Adjusted by an organizer · \d{1,2} [A-Z][a-z]{2} \d{1,2}:\d{2}\s?[AP]M$/);
});

test("removed by an organizer: said, and Sign Up again is offered while open", async ({ page }) => {
  await openDay(page, { status: "withdrawn", orgWithdrawn: new Date().toISOString(), orgAdjusted: new Date().toISOString() });
  await expect(page.locator(".cta .orgline")).toHaveText(["An organizer removed your sign-up."]);   // the removal only
  await expect(page.locator("#toSignup")).toBeVisible();
  await expect(page.locator("#tab-mine")).toHaveText("Sign Up");
  await expect(page.locator("#live")).toHaveCount(0);
});

test("a household's own withdrawal says nothing about organizers", async ({ page }) => {
  await openDay(page, { status: "withdrawn" });
  await expect(page.locator(".cta .orgline")).toHaveCount(0);
  await expect(page.locator("#toSignup")).toBeVisible();
});

test("old server (no new keys): My Sign-Up renders, no organizer line", async ({ page }) => {
  await openDay(page, { oldServer: true, supply: 3 });
  await expect(page.locator(".cta .status.ok")).toBeVisible();
  await expect(page.locator("#live .seg4 button")).toHaveCount(4);
  await expect(page.locator(".orgline")).toHaveCount(0);
});

test("Arabic: the organizer lines and the clear hint, right to left", async ({ page }) => {
  await openDay(page, { orgAdjusted: new Date().toISOString(), supply: 1 });
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".cta .orgline")).toHaveText(/^عدّل أحد المنظمين هذا التسجيل \(.+\)$/);
  await expect(page.locator("#live")).toContainText("اضغط على المستوى المختار مرة أخرى لمسحه.");
});

test("Arabic: removed by an organizer", async ({ page }) => {
  await openDay(page, { status: "withdrawn", orgWithdrawn: new Date().toISOString() });
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".cta .orgline")).toHaveText("أزال أحد المنظمين تسجيلك.");
});

// ── the organizer ──
test("mark done / open: exact args, the card says so, the button flips", async ({ page }) => {
  const { calls } = await openSignups(page);
  await expect(card(page, "12").locator('[data-su="done"]')).toHaveText("Mark Done");
  await card(page, "12").locator('[data-su="done"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 is marked done. The household is told an organizer changed it.");
  expect(lastCall(calls, "jc_admin_entry_live_set").args).toEqual({ p_entry: "a1", p_state: "done", p_supply: null, p_supply_clear: false });
  await expect(card(page, "12").locator(".flags")).toContainText("Done for the night");
  await expect(card(page, "12").locator(".flags")).toContainText("Adjusted by an organizer");
  await expect(page.locator("#undo")).toHaveCount(0);                            // self-reversing: the button flips
  await card(page, "12").locator('[data-su="open"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 12 is marked open again.");
  expect(lastCall(calls, "jc_admin_entry_live_set").args).toEqual({ p_entry: "a1", p_state: "active", p_supply: null, p_supply_clear: false });
  await expect(card(page, "12").locator('[data-su="done"]')).toBeVisible();
});

test("treat nights say Out of Treats; no switch feature = no switch button", async ({ page, browser }) => {
  await openSignups(page, { liveLook: "halloween" });
  await expect(card(page, "12").locator('[data-su="done"]')).toHaveText("Mark Out of Treats");
  await expect(page.locator('[data-su="supply"]')).toHaveCount(0);                // supply is off on this event
  const p2 = await browser.newPage({ ...test.info().project.use });
  await openSignups(p2, { liveFeatures: {} });
  await expect(p2.locator('[data-su="done"], [data-su="supply"]')).toHaveCount(0);
  await expect(card(p2, "12").locator('[data-su="withdraw"]')).toBeVisible();     // removing a no-show needs no feature
  await p2.close();
});

test("supply: set a level, then Clear Supply (exact args); the pressed level sends nothing", async ({ page }) => {
  const { calls } = await openSignups(page, { liveFeatures: { giant_switch: true, supply: true } });
  await card(page, "12").locator('[data-su="supply"]').click();
  const panel = page.locator("[data-supply-panel]");
  await expect(panel.locator("[data-level]")).toHaveText(["Plenty", "Some left", "Running low", "Almost out"]);
  await expect(panel.locator("[data-supclear]")).toHaveCount(0);                  // nothing to clear yet
  await panel.locator('[data-level="2"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 12: Some left.");
  expect(lastCall(calls, "jc_admin_entry_live_set").args).toEqual({ p_entry: "a1", p_state: null, p_supply: 2, p_supply_clear: false });
  await expect(card(page, "12").locator(".flags")).toContainText("Supply: Some left");
  await card(page, "12").locator('[data-su="supply"]').click();
  await expect(panel.locator('[data-level="2"]')).toHaveAttribute("aria-pressed", "true");
  await panel.locator('[data-level="2"]').click();
  await page.waitForTimeout(200);
  expect(rpcCalls(calls, "jc_admin_entry_live_set")).toHaveLength(1);
  await panel.locator("[data-supclear]").click();
  await expect(page.locator("#msg")).toHaveText("Villa 12's supply level is cleared.");
  expect(lastCall(calls, "jc_admin_entry_live_set").args).toEqual({ p_entry: "a1", p_state: null, p_supply: null, p_supply_clear: true });
  await expect(card(page, "12").locator(".flags")).not.toContainText("Supply:");
});

test("remove a sign-up: the confirm names the home, dismissing sends nothing, no Undo", async ({ page }) => {
  const { calls } = await openSignups(page);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await card(page, "12").locator('[data-su="withdraw"]').click();
  await page.waitForTimeout(200);
  expect(asked).toContain("Villa 12");
  expect(rpcCalls(calls, "jc_admin_entry_withdraw")).toHaveLength(0);
  await expect(card(page, "12")).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await card(page, "12").locator('[data-su="withdraw"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 12's sign-up is removed. Its place is free.");
  expect(rpcCalls(calls, "jc_admin_entry_withdraw").map((c) => c.args)).toEqual([{ p_entry: "a1" }]);
  await expect(card(page, "12")).toHaveCount(0);
  await expect(page.locator(".sub")).toHaveText("2 homes");
  await expect(page.locator("#undo")).toHaveCount(0);
});

test("before the night (more than 2 h to the start): no switch or supply, Remove still there", async ({ page }) => {
  await openSignups(page, { liveStartsAt: new Date(Date.now() + 5 * 3600e3).toISOString(), liveFeatures: { giant_switch: true, supply: true } });
  await expect(page.locator('[data-su="done"], [data-su="supply"]')).toHaveCount(0);
  await expect(card(page, "12").locator('[data-su="withdraw"]')).toBeVisible();
});

test("Arabic: the organizer's buttons and supply panel", async ({ page }) => {
  await openSignups(page, { liveFeatures: { giant_switch: true, supply: true } });
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".sulist li").first().locator('[data-su="done"]')).toHaveText("علّمه: انتهى");
  await expect(page.locator(".sulist li").first().locator('[data-su="withdraw"]')).toHaveText("أزل التسجيل");
  await page.locator(".sulist li").first().locator('[data-su="supply"]').click();
  await expect(page.locator("[data-supply-panel] [data-level]")).toHaveText(["كثير", "بقي بعضها", "قليل", "أوشك على النفاد"]);
});
