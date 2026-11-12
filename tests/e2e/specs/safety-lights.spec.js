// R2b-2 — the event's safety box (community security line + lost-child meeting point, behind the event's
// `safety` switch), the holiday lights look + template, and what the editor sends (docs/plans/R2b-2-safety-lights.md).
const { test, expect } = require("@playwright/test");
const { stubBackend, ok } = require("./stub");
const { eventsBackend, adminBackend, signIn, LIVE_ID, ADMIN_LIVE_ID, LIGHTS_ID, LIGHTS_EVENT, LIGHTS_SAFETY } = require("./backends");

const lastCall = (calls, name) => calls.filter((c) => c.name === name).slice(-1)[0];
const saves = (calls) => calls.filter((c) => c.name === "jc_admin_event_save").length;

// the holiday lights event with its event / safety overridden
async function openLights(page, over) {
  const ev = Object.assign({}, LIGHTS_EVENT, { event: Object.assign({}, LIGHTS_EVENT.event, over || {}) });
  const eb = eventsBackend({ rpc: { jc_event_get: (a) => (a.p_event === LIGHTS_ID ? ok(ev) : ok(null)) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIGHTS_ID);
  await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(ev.entries.length);
}

// ---------- event page ----------

test("event page: the safety box shows the security line as a call link and the meeting point", async ({ page }) => {
  await openLights(page);
  const box = page.locator(".evhead #safety");
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("role", "note");
  const call = box.locator('a[href^="tel:"]');
  await expect(call).toHaveText("+971 2 555 0100");
  await expect(call).toHaveAttribute("href", "tel:+97125550100");               // numerals and + only
  await expect(box).toContainText("Security: +971 2 555 0100");
  await expect(box).toContainText("Lost child? Meet at: The clubhouse gate");
});

test("event page in Arabic: the box is translated, shows the Arabic meeting point, and the page is RTL", async ({ page }) => {
  await openLights(page);
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const box = page.locator("#safety");
  await expect(box).toContainText("الأمن");
  await expect(box).toContainText("طفل تائه؟ نلتقي عند: بوابة النادي");
  await expect(box.locator('a[href="tel:+97125550100"]')).toHaveAttribute("dir", "ltr");   // the number reads left to right
});

test("event page: only the meeting point in the other language — it falls back rather than hiding", async ({ page }) => {
  await openLights(page, { safety: { meeting_ar: "بوابة النادي" } });
  await expect(page.locator("#safety")).toContainText("Lost child? Meet at: بوابة النادي");
  await expect(page.locator("#safety b")).toHaveAttribute("lang", "ar");          // marked as the other language
  await expect(page.locator('#safety a[href^="tel:"]')).toHaveCount(0);
});

test("event page: switch off → no box, even with values stored", async ({ page }) => {
  await openLights(page, { features: { giant_switch: true } });
  await expect(page.locator(".evtitle h1")).toContainText("Holiday Lights");
  await expect(page.locator("#safety")).toHaveCount(0);
});

test("event page: switch on with nothing stored → no box", async ({ page }) => {
  await openLights(page, { safety: {} });
  await expect(page.locator(".evtitle h1")).toContainText("Holiday Lights");
  await expect(page.locator("#safety")).toHaveCount(0);
});

test("event page: a hostile stored value is text — never a link, never markup", async ({ page }) => {
  await openLights(page, { safety: { phone: "javascript:alert(1)", meeting_en: '<img src=x onerror="window.__pwned=1">Gate' } });
  const box = page.locator("#safety");
  await expect(box.locator("a")).toHaveCount(0);
  await expect(box.locator("img")).toHaveCount(0);
  await expect(box).toContainText("javascript:alert(1)");
  await expect(box).toContainText('<img src=x onerror="window.__pwned=1">Gate');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test("holiday lights: the page wears the look and its mark; pins carry the ring + icon questions", async ({ page }) => {
  await openLights(page);
  await expect(page.locator("html")).toHaveAttribute("data-look", "holiday_lights");
  await expect(page.locator(".evtitle h1 .mark")).toHaveText("✨");
  await expect(page.locator(".evtitle h1")).toContainText("Holiday Lights");
  const pin = (i) => page.locator("#map .leaflet-marker-icon .pin").nth(i);
  await expect(pin(0)).toHaveText("💡");                                      // warm white = the icon question
  await expect(pin(0)).toHaveClass(/\br0\b/);                                // the street = first ring colour
  await expect(pin(1)).toHaveText("🌈");
  await expect(pin(1)).toHaveClass(/\br1\b/);                                // the garden
  // the fill is the look's string-light gold
  expect(await pin(0).evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgb(255, 207, 102)");
});

test("holiday lights: the events list card wears the look", async ({ page }) => {
  const eb = eventsBackend({ rpc: { jc_events_list: () => ok([Object.assign({}, LIGHTS_EVENT.event, { homes_in: 6, my_status: null })]) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  const card = page.locator('[data-event="holiday-lights-2026"]');
  await expect(card).toHaveAttribute("data-look", "holiday_lights");
  await expect(card).toContainText("✨");
});

test("Arabic: an event with no Arabic title (stored null) shows the English one", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("jc_lang", "ar"); } catch (e) {} });
  await openLights(page, { title_ar: null, description_ar: null });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".evtitle h1")).toContainText("Holiday Lights");
  await expect(page.locator("#desc")).toContainText("Walk the lit streets");
});

// ---------- editor ----------

test("Holiday Lights template: a homes event, the switch only, three questions, safety not pre-ticked; saved as such", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await expect(page.locator('[data-tpl="holiday_lights"]')).toContainText("Holiday Lights");
  await page.locator('[data-tpl="holiday_lights"]').click();
  await expect(page.locator('input[name="kind"][value="homes"]')).toBeChecked();
  await expect(page.locator("#look")).toHaveValue("holiday_lights");
  await expect(page.locator("#f_giant_switch")).toBeChecked();
  await expect(page.locator("#f_supply")).not.toBeChecked();
  await expect(page.locator("#f_crowd_reports")).not.toBeChecked();
  await expect(page.locator("#f_safety")).not.toBeChecked();
  await expect(page.locator(".qcard")).toHaveCount(3);
  await page.locator("#title_en").fill("Holiday Lights 2026");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved as a draft. Residents can't see it until you publish it.");
  const f = lastCall(calls, "jc_admin_event_save").args;
  expect(f.p_event).toBeNull();
  expect(Object.keys(f.p_fields).sort()).toEqual(["features", "look", "payload_schema", "slug", "title_en"]);   // no safety sent
  expect(f.p_fields.look).toBe("holiday_lights");
  expect(f.p_fields.features).toEqual({ giant_switch: true });
  expect(Object.keys(f.p_fields.payload_schema.fields)).toEqual(["view", "lights", "until"]);
  expect(f.p_fields.payload_schema.fields.view).toMatchObject({ pin: "ring", ring_split: ["both"] });
  expect(f.p_fields.payload_schema.fields.lights).toMatchObject({ pin: "glyph", glyphs: { warm: "💡", colour: "🌈", music: "🎶" } });
});

test("editor: ticking the safety box and filling it sends the switch and the tidied block — exact payload", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await expect(page.locator("#f_safety")).not.toBeChecked();
  await page.locator("#f_safety").check();
  await page.locator("#safety_phone").fill("  ٠٢ 555   0100 ");                    // Arabic-Indic numerals, extra spaces
  await page.locator("#safety_meeting_en").fill("  The clubhouse gate ");
  await page.locator("#safety_meeting_ar").fill("بوابة النادي");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args).toEqual({ p_event: ADMIN_LIVE_ID, p_fields: {
    features: { giant_switch: true, safety: true },
    safety: { phone: "02 555 0100", meeting_en: "The clubhouse gate", meeting_ar: "بوابة النادي" } } });
});

test("editor: the stored block is filled in; unticking sends only the switch (the text is kept); untouched sends nothing", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], liveFeatures: { giant_switch: true, safety: true }, liveSafety: LIGHTS_SAFETY });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await expect(page.locator("#f_safety")).toBeChecked();
  await expect(page.locator("#safety_phone")).toHaveValue("+971 2 555 0100");
  await expect(page.locator("#safety_meeting_en")).toHaveValue("The clubhouse gate");
  await expect(page.locator("#safety_meeting_ar")).toHaveValue("بوابة النادي");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Nothing changed.");
  expect(saves(calls)).toBe(0);
  await page.locator("#f_safety").uncheck();                                     // still in the editor
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args).toEqual({ p_event: ADMIN_LIVE_ID, p_fields: { features: { giant_switch: true } } });
});

test("editor: clearing a field sends the block without it", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"], liveFeatures: { giant_switch: true, safety: true }, liveSafety: LIGHTS_SAFETY });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#safety_meeting_ar").fill("");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args).toEqual({ p_event: ADMIN_LIVE_ID, p_fields: {
    safety: { phone: "+971 2 555 0100", meeting_en: "The clubhouse gate" } } });
});

test("editor: a pasted number with direction marks, dashes and brackets saves as numerals and spaces", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#safety_phone").fill("\u202A+971 (2) 555-0100\u202C\u200E");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_admin_event_save").args).toEqual({ p_event: ADMIN_LIVE_ID, p_fields: { safety: { phone: "+971 2 555 0100" } } });
});

test("editor: ticked with nothing filled in, or a number that isn't one, says so and sends nothing", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#f_safety").check();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Add the security number or the meeting point, or untick the safety box.");
  for (const bad of ["050-123-456x", "12", "tel:999", "+971 50 1234 5678 901"]) {
    await page.locator("#safety_phone").fill(bad);
    await page.locator("#save").click();
    await expect(page.locator("#msg")).toHaveText("Security number: digits and spaces only, with an optional + at the start (3 to 15 digits).");
  }
  await expect(page.locator("#safety_phone")).toBeFocused();
  expect(saves(calls)).toBe(0);
});

test("editor: the server's BAD_PHONE is said in words (Arabic too)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  await stubBackend(page, { rpc: Object.assign({}, ab.rpc, {
    jc_admin_event_save: () => ({ status: 400, body: { code: "P0001", message: "BAD_PHONE" } }) }) });
  await signIn(page);
  await page.goto("admin/");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await page.locator("#safety_phone").fill("999");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Security number: digits and spaces only, with an optional + at the start (3 to 15 digits).");
  await page.evaluate(() => localStorage.setItem("jc_lang", "ar"));
  await page.goto("admin/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator('li[data-event="test-event"] [data-act="edit"]').click();
  await expect(page.locator("#safetyBox legend")).toHaveText("السلامة");
  await page.locator("#safety_phone").fill("999");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("رقم الأمن: أرقام ومسافات فقط، مع علامة + اختيارية في البداية (من 3 إلى 15 رقمًا).");
});
