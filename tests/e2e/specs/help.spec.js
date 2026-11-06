// Page help (2026-11-06): a "?" in the top bar opens a window explaining the page, in the current language.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok } = require("./stub");
const { eventsBackend, adminBackend, signIn, LIVE_ID } = require("./backends");

async function openHelp(page) {
  await page.locator("#jcHelpBtn").click();
  await expect(page.locator("#jcHelp")).toBeVisible();
  return page.locator("#jcHelp");
}

test("events list and an event page each explain themselves; bold names render as bold, not asterisks", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  let h = await openHelp(page);
  await expect(h.locator("h2")).toHaveText("Events");
  await expect(h.locator("li")).toHaveCount(3);
  await expect(h.locator("li b").first()).toHaveText("Sign Up");
  await expect(h).not.toContainText("**");
  await h.locator("#jcHelpClose").click();
  await expect(h).toBeHidden();
  await page.goto("events/?id=" + LIVE_ID);
  h = await openHelp(page);
  await expect(h.locator("h2")).toHaveText("This event");
  await expect(h).toContainText("tap its pin and click They're Out of Treats");
  await page.mouse.click(5, 5);                                            // tap outside closes
  await expect(h).toBeHidden();
});

test("My Home help covers the account too (no sign-out line); Arabic when the page is Arabic", async ({ page }) => {
  const eb = eventsBackend();
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("home/");
  let h = await openHelp(page);
  await expect(h.locator("h2")).toHaveText("My Home");
  await expect(h).toContainText("never your name or phone");
  await expect(h).not.toContainText("Signing out");
  await h.locator("#jcHelpClose").click();
  await page.locator("#langBtn").click();
  h = await openHelp(page);
  await expect(h.locator("h2")).toHaveText("منزلي");
});

test("Organizer Tools help mentions who sees the platform numbers; none on the lock screen", async ({ page }) => {
  const ab = adminBackend();
  await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await expect(page.locator("#code")).toBeVisible();
  await expect(page.locator("#jcHelpBtn")).toHaveCount(0);
  await page.locator("#code").fill("EVENTS-CODE-1");
  await page.locator("#go").click();
  const h = await openHelp(page);
  await expect(h.locator("h2")).toHaveText("Organizer Tools");
  await expect(h).toContainText("Platform-wide numbers show only to the person who runs Commons.");
});
