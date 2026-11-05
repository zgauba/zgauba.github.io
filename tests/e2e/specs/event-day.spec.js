// T5.2 PR 5b — event day: the household's two-sided switch + supply levels (every choice visible,
// never a cycling button), neighbors' "they're out" reports + the household's banner, and the
// 2-minute refresh (here shortened) — all only from 2 h before the start until the end.
const { test, expect } = require("@playwright/test");
const { stubBackend } = require("./stub");
const { dayBackend, signIn, DAY_ID } = require("./backends");

async function openDay(page, opts = {}, tab = "mine") {
  if (opts.refreshMs) await page.addInitScript((ms) => { window.JC_REFRESH_MS = ms; }, opts.refreshMs);
  const db = dayBackend(opts);
  const sb = await stubBackend(page, { rpc: db.rpc });
  await signIn(page);
  await page.goto("events/?id=" + DAY_ID + "&tab=" + tab);
  await expect(page.locator("#evsub")).toBeVisible();
  return { db, calls: sb.calls };
}
const rpcCalls = (calls, name) => calls.filter((c) => c.kind === "rpc" && c.name === name);
const myPin = (page) => page.locator("#map .leaflet-marker-icon .pin.mine");

test("event day: the switch shows both sides, the current one pressed; supply shows all four levels", async ({ page }) => {
  await openDay(page);
  const tog = page.locator("#live .tog button");
  await expect(tog).toHaveText(["🎃 Handing Out", "✕ Out of Treats"]);
  await expect(tog.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tog.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#live .seg4 button")).toHaveText(["Plenty", "Some left", "Running low", "Almost out"]);
  await expect(page.locator("#live .seg4 [aria-pressed=true]")).toHaveCount(0);   // not set yet
  await expect(page.locator("#upd")).toHaveText(/^Updated \d{1,2}:\d{2}\s?[AP]M · refreshes every 2 minutes$/);
});

test("Out of Treats: one call with the state only, the pressed side moves, supply hides, the pin turns ✕", async ({ page }) => {
  const { calls } = await openDay(page);
  await page.locator("#live [data-live=done]").click();
  await expect(page.locator("#live [data-live=done]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#live [data-live=active]")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#live .seg4")).toHaveCount(0);
  expect(rpcCalls(calls, "jc_entry_live_set").map((c) => c.args))
    .toEqual([{ p_event: DAY_ID, p_state: "done", p_supply: null }]);
  // tapping the side that's already on sends nothing
  await page.locator("#live [data-live=done]").click();
  await page.waitForTimeout(200);
  expect(rpcCalls(calls, "jc_entry_live_set")).toHaveLength(1);
  // and back
  await page.locator("#live [data-live=active]").click();
  await expect(page.locator("#live [data-live=active]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#tab-map").click();
  await expect(myPin(page)).not.toHaveClass(/\bdone\b/);
  await page.locator("#tab-mine").click();
  await page.locator("#live [data-live=done]").click();
  await expect(page.locator("#live [data-live=done]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#tab-map").click();
  await expect(myPin(page)).toHaveClass(/\bdone\b/);
  await expect(myPin(page)).toHaveText("✕");
});

test("supply: one tap sets the level (supply only, never the state) and neighbors see it in the popup", async ({ page }) => {
  const { calls } = await openDay(page);
  await page.locator("#live [data-supply='1']").click();
  await expect(page.locator("#live [data-supply='1']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#live [data-supply='3']")).toHaveAttribute("aria-pressed", "false");
  expect(rpcCalls(calls, "jc_entry_live_set").map((c) => c.args))
    .toEqual([{ p_event: DAY_ID, p_state: null, p_supply: 1 }]);
  await page.locator("#tab-list").click();
  await expect(page.locator(".entries li.mine .supply")).toHaveText("Supply: Running low");
});

test("other events say Open | Done; the controls follow the organizer's feature switches", async ({ page }) => {
  await openDay(page, { event: { look: "yard_sale", features: { giant_switch: true } } });
  await expect(page.locator("#live .tog button")).toHaveText(["🏷️ Open", "✕ Done"]);
  await expect(page.locator("#live .seg4")).toHaveCount(0);                     // supply off
});

test("supply on, switch off → only the levels; everything off → no controls at all", async ({ page, browser }) => {
  await openDay(page, { event: { features: { supply: true } } });
  await expect(page.locator("#live .seg4 button")).toHaveCount(4);
  await expect(page.locator("#live .tog")).toHaveCount(0);
  const p2 = await browser.newPage({ ...test.info().project.use });
  await openDay(p2, { event: { features: {} } });
  await expect(p2.locator(".cta .status.ok")).toBeVisible();
  await expect(p2.locator("#live")).toHaveCount(0);
  await p2.close();
});

test("outside the event-day window: no controls, no stamp, no refreshing", async ({ page }) => {
  const { calls } = await openDay(page, { startsIn: 5 * 3600e3, refreshMs: 300 });   // starts in 5 h (> 2 h lead)
  await expect(page.locator(".cta .status.ok")).toBeVisible();
  await expect(page.locator("#live")).toHaveCount(0);
  await expect(page.locator("#upd")).toBeHidden();
  await page.waitForTimeout(1200);
  expect(rpcCalls(calls, "jc_event_get")).toHaveLength(1);
});

test("2 h before the start the controls appear (the lead-in)", async ({ page }) => {
  await openDay(page, { startsIn: 90 * 60e3 });
  await expect(page.locator("#live .tog")).toBeVisible();
});

test("report a neighbor: asks first, one call, the button becomes a thank-you; never on your own or a done home", async ({ page }) => {
  const { calls } = await openDay(page, {}, "map");
  const pins = page.locator("#map .leaflet-marker-icon");
  // dismissing the question sends nothing
  page.once("dialog", (d) => d.dismiss());
  await pins.nth(0).dispatchEvent("click");
  await page.locator(".leaflet-popup .rep").click();
  await page.waitForTimeout(200);
  expect(rpcCalls(calls, "jc_entry_report")).toHaveLength(0);
  page.once("dialog", (d) => { expect(d.message()).toContain("Villa 1"); d.accept(); });
  await page.locator(".leaflet-popup .rep").click();
  await expect(page.locator(".leaflet-popup")).toContainText("You reported this home");
  await expect(page.locator(".leaflet-popup .rep")).toHaveCount(0);
  await expect(page.locator("#msg")).toHaveText("Thanks — Villa 1 has been told.");
  expect(rpcCalls(calls, "jc_entry_report").map((c) => c.args)).toEqual([{ p_entry: "a" }]);
  // done home (index 2) and your own home: no button
  await page.locator(".leaflet-popup-close-button").click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await pins.nth(2).dispatchEvent("click");
  await expect(page.locator(".leaflet-popup")).toContainText("Out of treats");
  await expect(page.locator(".leaflet-popup .rep")).toHaveCount(0);
  await page.locator(".leaflet-popup-close-button").click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await myPin(page).dispatchEvent("click");
  await expect(page.locator(".leaflet-popup")).toContainText("Villa 12");
  await expect(page.locator(".leaflet-popup .rep")).toHaveCount(0);
});

test("a refused report says why and keeps the button", async ({ page }) => {
  await openDay(page, { reportError: "REPORTS_LOCKED" }, "map");
  page.on("dialog", (d) => d.accept());
  await page.locator("#map .leaflet-marker-icon").nth(0).dispatchEvent("click");
  await page.locator(".leaflet-popup .rep").click();
  await expect(page.locator("#msg")).toHaveText(/just confirmed they're still going/);
  await expect(page.locator(".leaflet-popup .rep")).toBeEnabled();
});

test("reported household: banner on every tab; We're Not Out clears it", async ({ page }) => {
  const { calls } = await openDay(page, { reportsOpen: 1 }, "map");
  const banner = page.locator("#banner .alert");
  await expect(banner).toContainText("A neighbor thinks Villa 12 is out of treats. Still going?");
  await page.locator("#tab-list").click();
  await expect(banner).toBeVisible();
  await page.locator("#notOut").click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator("#msg")).toHaveText(/reports cleared/);
  expect(rpcCalls(calls, "jc_entry_reports_clear").map((c) => c.args)).toEqual([{ p_event: DAY_ID }]);
});

test("reported household: Yes, We're Out sets done and the banner goes", async ({ page }) => {
  const { calls } = await openDay(page, { reportsOpen: 2 }, "mine");
  await page.locator("#yesOut").click();
  await expect(page.locator("#banner .alert")).toHaveCount(0);
  await expect(page.locator("#live [data-live=done]")).toHaveAttribute("aria-pressed", "true");
  expect(rpcCalls(calls, "jc_entry_live_set").map((c) => c.args))
    .toEqual([{ p_event: DAY_ID, p_state: "done", p_supply: null }]);
});

test("refresh: a neighbor going out shows up without moving the map", async ({ page }) => {
  const { db, calls } = await openDay(page, { refreshMs: 400 }, "map");
  await page.evaluate(() => {});
  const pin0 = page.locator("#map .leaflet-marker-icon .pin").nth(0);
  await expect(pin0).not.toHaveClass(/\bdone\b/);
  const before = await page.locator("#map .leaflet-map-pane").getAttribute("style");
  db.st.others[0].live_state = "done";
  await expect(pin0).toHaveClass(/\bdone\b/);
  expect(rpcCalls(calls, "jc_event_get").length).toBeGreaterThan(1);
  expect(await page.locator("#map .leaflet-map-pane").getAttribute("style")).toBe(before);   // same pan / zoom
});

test("refresh waits while a popup is open, then redraws when it closes", async ({ page }) => {
  const { db } = await openDay(page, { refreshMs: 300 }, "map");
  await page.locator("#map .leaflet-marker-icon").nth(0).dispatchEvent("click");
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  db.st.others[1].live_state = "done";
  await page.waitForTimeout(900);
  await expect(page.locator(".leaflet-popup")).toBeVisible();                      // not yanked away
  await expect(page.locator("#map .leaflet-marker-icon .pin").nth(1)).not.toHaveClass(/\bdone\b/);
  await page.locator(".leaflet-popup-close-button").click();
  await expect(page.locator("#map .leaflet-marker-icon .pin").nth(1)).toHaveClass(/\bdone\b/);
});

test("refresh never touches an open sign-up form, and a failed refresh says how old the screen is", async ({ page }) => {
  const { db, calls } = await openDay(page, { refreshMs: 300 }, "mine");
  await page.locator("#toSignup").click();
  await expect(page.locator("#form")).toBeVisible();
  const n = rpcCalls(calls, "jc_event_get").length;
  await page.waitForTimeout(1000);
  expect(rpcCalls(calls, "jc_event_get")).toHaveLength(n);
  await page.locator("#cancel").click();
  db.st.getFails = true;
  await expect(page.locator("#upd")).toHaveText(/^Couldn't refresh — showing/);
  await expect(page.locator("#upd")).toHaveClass(/\bstale\b/);
  await expect(page.locator("#live .tog")).toBeVisible();                         // what was there stays
  db.st.getFails = false;
  await expect(page.locator("#upd")).toHaveText(/^Updated /);
});

test("Arabic: the switch, levels and banner are translated", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jc_lang", "ar"));
  await openDay(page, { reportsOpen: 1 });
  await expect(page.locator("#live .tog button").nth(0)).toContainText("نوزّع الحلوى");
  await expect(page.locator("#live .tog button").nth(1)).toContainText("نفدت الحلوى");
  await expect(page.locator("#live .seg4 button").nth(0)).toHaveText("كثير");
  await expect(page.locator("#notOut")).toHaveText("لم تنفد بعد");
});
