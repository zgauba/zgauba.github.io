// T5.2 PR 6 — App health (community admins): jc_admin_report in plain words + open notices.
// The rule under test: a missing / odd value is "couldn't check" — never a green tick.
const { test, expect } = require("@playwright/test");
const { stubBackend, raise } = require("./stub");
const { adminBackend, signIn, healthReport } = require("./backends");

async function openHealth(page, opts = {}) {
  const ab = adminBackend(Object.assign({ scopes: ["community"], owner: true }, opts));   // the owner sees every row
  const sb = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#healthOpen").click();
  await expect(page.locator("h1")).toHaveText("App Health");
  await expect(page.locator(".hsum")).toBeVisible();
  return { ab, calls: sb.calls };
}
const row = (page, label) => page.locator(".hrow", { hasText: label });

test("all healthy: one ✅ summary, every check in words, notices listed by home label", async ({ page }) => {
  await openHealth(page);
  await expect(page.locator(".hsum")).toHaveText("✅ All good.");
  await expect(row(page, "Hourly backup copy")).toContainText("Last copy 12 min ago.");
  await expect(row(page, "Hourly backup copy")).toHaveClass(/\bok\b/);
  await expect(row(page, "Backup schedule")).toContainText("Last ran 12 min ago.");
  await expect(row(page, "unused accounts")).toContainText("Last ran 10 h ago · 0 removed.");
  await expect(row(page, "expired photos")).toContainText("2 removed");
  await expect(row(page, "Storage (whole platform)")).toContainText(/3\.2 MB\u2069? of \u2066?1 GB\u2069? used \(0\.3%\)\./);
  await expect(row(page, "Page views")).toContainText("412 page views.");
  await expect(row(page, "Locked out right now")).toContainText("Nobody.");
  await expect(row(page, "Wrong codes (whole platform)")).toContainText("3 wrong organizer codes · 7 wrong join codes since");
  await expect(row(page, "Activity")).toContainText("14 switch flips · 3 neighbor reports · 2 sign-up changes");
  await expect(page.locator(".hrow")).toHaveCount(9);
  // notices: the home's label + village, never the account stored in `detail`
  await expect(page.locator("h2", { hasText: "Notices" })).toHaveText("Notices (2)");
  await expect(page.locator(".fblist li").nth(0)).toContainText("Villa 7 · Ain Al Maha");
  await expect(page.locator(".fblist li").nth(0)).toContainText("A household left");
  await expect(page.locator(".fblist li").nth(1)).toContainText("Seef Al Jubail");
  await expect(page.locator(".fblist li").nth(1)).toContainText("pin looks far");
  await expect(page.locator("#view")).not.toContainText("u-secret-123");
});

test("problems are named, not hidden: stale backup, failed job, storage near full, broken counter, lockouts", async ({ page }) => {
  const r = healthReport();
  r.snapshot = { last_at: new Date(Date.now() - 300 * 60000).toISOString(), age_minutes: 300, stale: true };
  r.cron = Object.assign({}, r.cron, { last_status: "failed", last_failure: { at: r.cron.last_run_at, message: "ERROR: permission denied <b>x</b>" } });
  r.maintenance.photo_purge = { last_at: r.maintenance.photo_purge.last_at, affected: 0, error: "bucket missing", stale: false, never_run: false };
  r.storage = Object.assign({}, r.storage, { bytes: 900 * 1048576, alert: true });
  r.traffic = { hits_24h: 0, counter_suspect: true };
  r.rate_limited_now = { admin_unlock: 1, join_pre_membership: 2 };
  await openHealth(page, { report: r });
  await expect(page.locator(".hsum")).toHaveText("⚠️ 6 thing(s) need a look.");
  await expect(row(page, "Hourly backup copy")).toHaveClass(/\bbad\b/);
  await expect(row(page, "Hourly backup copy")).toContainText("Last copy 5 h ago — it should be hourly.");
  await expect(row(page, "Backup schedule")).toHaveClass(/\bbad\b/);
  await expect(row(page, "Backup schedule").locator("small")).toHaveText("ERROR: permission denied <b>x</b>");   // text, not HTML
  await expect(row(page, "expired photos")).toHaveClass(/\bbad\b/);
  await expect(row(page, "expired photos").locator("small")).toHaveText("bucket missing");
  await expect(row(page, "Storage")).toHaveClass(/\bwarn\b/);
  await expect(row(page, "Page views")).toContainText("the counter may be broken");
  await expect(row(page, "Locked out")).toContainText("1 here after wrong organizer codes · 2 on the platform");
});

test("missing or odd values are 'couldn't check', never ✅", async ({ page }) => {
  const r = healthReport();
  r.snapshot = { last_at: "garbage", age_minutes: "x", stale: "no" };
  r.cron = { job_present: true, active: "yes", last_status: "succeeded", last_run_at: "garbage" };
  r.maintenance = { orphan_users: { last_at: "not a date", stale: false } };
  r.storage = { bytes: "lots", limit_bytes: 1073741824 };
  r.traffic = null;
  r.rate_limited_now = { admin_unlock: 0 };
  await openHealth(page, { report: r });
  for (const label of ["Hourly backup copy", "Backup schedule", "unused accounts", "expired photos", "Storage", "Page views", "Locked out"]) {
    await expect(row(page, label)).toHaveClass(/\bunknown\b/);
    await expect(row(page, label)).toContainText("Couldn't check this one.");
    await expect(row(page, label).locator(".hic")).toHaveAttribute("aria-label", "Couldn't check");
  }
  await expect(page.locator(".hsum")).toHaveText("⚠️ 7 thing(s) need a look.");
});

test("the report failing says so (no rows, no ✅); the notices still load", async ({ page }) => {
  await openHealth(page, { rpc: { jc_admin_report: () => raise("UNKNOWN") } });
  await expect(page.locator(".hsum")).toHaveClass(/\bbad\b/);
  await expect(page.locator(".hsum")).toContainText("Couldn't run the checks.");
  await expect(page.locator(".hrow")).toHaveCount(0);
  await expect(page.locator(".fblist li")).toHaveCount(2);
});

test("Mark Resolved removes the notice; Check Again re-runs the report", async ({ page }) => {
  const { ab, calls } = await openHealth(page);
  await page.locator("[data-notice='11']").click();
  await expect(page.locator(".fblist li")).toHaveCount(1);
  await expect(page.locator("h2", { hasText: "Notices" })).toHaveText("Notices (1)");
  await expect(page.locator("#msg")).toHaveText("Marked resolved.");
  expect(calls.filter((c) => c.name === "jc_admin_notice_resolve").map((c) => c.args)).toEqual([{ p_id: 11 }]);
  const n = calls.filter((c) => c.name === "jc_admin_report").length;
  ab.st.report = healthReport({ traffic: { hits_24h: 0, counter_suspect: true } });   // something changed meanwhile
  await page.locator("#healthRefresh").click();
  await expect.poll(() => calls.filter((c) => c.name === "jc_admin_report").length).toBe(n + 1);
  await expect(page.locator(".hsum")).toHaveText("⚠️ 1 thing(s) need a look.");
});

test("a flag the server always sends, missing, is 'couldn't check' — not ✅ (broken counter, job error)", async ({ page }) => {
  const r = healthReport({ traffic: { hits_24h: 0 } });
  r.maintenance.orphan_users = { last_at: r.maintenance.orphan_users.last_at, affected: 0, stale: false, never_run: false };   // no `error`
  await openHealth(page, { report: r });
  await expect(row(page, "Page views")).toHaveClass(/\bunknown\b/);
  await expect(row(page, "unused accounts")).toHaveClass(/\bunknown\b/);
});

test("an empty report: nine 'couldn't check', no ✅ anywhere", async ({ page }) => {
  await openHealth(page, { report: {} });
  await expect(page.locator(".hrow.unknown")).toHaveCount(9);
  await expect(page.locator(".hsum")).toHaveText("⚠️ 9 thing(s) need a look.");
  await expect(page.locator(".hrow.ok")).toHaveCount(0);
});

test("a time in the future (wrong clock somewhere) is not 'fresh'", async ({ page }) => {
  const r = healthReport();
  r.snapshot = { last_at: new Date(Date.now() + 3 * 3600e3).toISOString(), age_minutes: 0, stale: false };
  await openHealth(page, { report: r });
  await expect(row(page, "Hourly backup copy")).toHaveClass(/\bunknown\b/);
});

test("notices that fail to load: the summary is not 'All good'", async ({ page }) => {
  await openHealth(page, { rpc: { jc_admin_notices_list: () => raise("UNKNOWN") } });
  await expect(page.locator(".hsum")).toHaveText("⚠️ 1 thing(s) need a look.");
  await expect(page.locator("#view")).toContainText("Couldn't load the notices.");
});

test("a bad row in the notices is skipped, the screen still draws", async ({ page }) => {
  const { NOTICES } = require("./backends");
  await openHealth(page, { notices: [null, { kind: "departure" }, NOTICES[0]] });
  await expect(page.locator(".fblist li")).toHaveCount(1);
  await expect(page.locator(".hsum")).toHaveText("✅ All good.");
});

test("resolving a notice someone else already resolved reloads the list", async ({ page }) => {
  const { ab, calls } = await openHealth(page);
  ab.st.notices = ab.st.notices.filter((n) => n.id !== 11);   // another admin got there first
  await page.locator("[data-notice='11']").click();
  await expect(page.locator(".fblist li")).toHaveCount(1);
  await expect(page.locator("h2", { hasText: "Notices" })).toHaveText("Notices (1)");
  expect(calls.filter((c) => c.name === "jc_admin_notices_list").length).toBeGreaterThan(1);
});

test("the grant expired meanwhile (NOT_ADMIN): back to the lock, nothing half-drawn", async ({ page }) => {
  const ab = adminBackend({ scopes: ["community"] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_report: () => { ab.st.scopes = []; return raise("NOT_ADMIN"); } }) });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#healthOpen").click();
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator(".hrow")).toHaveCount(0);
});

test("only community admins get the button; back returns to Organizer Tools", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#newEv")).toBeVisible();
  await expect(page.locator("#healthOpen")).toHaveCount(0);
});

test("back from App Health returns to Organizer Tools; Arabic labels", async ({ page }) => {
  await openHealth(page);
  await page.locator("#langBtn").click();
  await expect(page.locator("h1")).toHaveText("صحة التطبيق");
  await expect(row(page, "نسخة احتياطية كل ساعة")).toBeVisible();
  await page.locator("#langBtn").click();
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("h1")).toHaveText("Organizer Tools");
});

test("a community admin who isn't the platform owner: no whole-platform rows; lockouts count only this community", async ({ page }) => {
  const r = healthReport({ rate_limited_now: { admin_unlock: 1, join_pre_membership: 5 } });
  await openHealth(page, { owner: false, report: r });
  await expect(page.locator(".hrow")).toHaveCount(7);
  await expect(row(page, "Storage")).toHaveCount(0);
  await expect(row(page, "Wrong codes")).toHaveCount(0);
  await expect(row(page, "Locked out")).toContainText("1 after wrong organizer codes.");
  await expect(page.locator("#view")).not.toContainText("on the platform");
});
