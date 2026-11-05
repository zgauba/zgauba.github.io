// T5.2 PR 5a — event looks + Halloween-parity pins (fill = availability, ring = the "ring"
// question, icon = the "glyph" question, teal icon = allergy-friendly), the map key, and the
// organizer's "allergy-friendly" tick.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok } = require("./stub");
const { eventsBackend, adminBackend, signIn, LIVE_ID, LIVE, home, pinEvent } = require("./backends");

async function openEvent(page, ev) {
  const eb = eventsBackend({ rpc: { jc_event_get: () => ok(ev) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/?id=" + LIVE_ID);
  await expect(page.locator("#map .leaflet-marker-icon")).toHaveCount(ev.entries.length);
}
const pin = (page, i) => page.locator("#map .leaflet-marker-icon .pin").nth(i);

test("pins: icon from the glyph question, ring from the ring question, ✕ done, ? reported, your own pin larger", async ({ page }) => {
  await openEvent(page, pinEvent());
  await expect(pin(page, 0)).toHaveText("🍬");
  await expect(pin(page, 0)).toHaveClass(/\br0\b/);                       // front gate = first ring colour
  await expect(pin(page, 1)).toHaveClass(/\br1\b/);                       // garden gate
  await expect(pin(page, 1).locator(".gl.teal")).toHaveText("🎃");        // allergy-friendly → teal pumpkin
  await expect(pin(page, 0).locator(".gl.teal")).toHaveCount(0);          // candy is not
  await expect(pin(page, 2)).toHaveText("✕");                             // done: grey + ✕, not colour alone
  await expect(pin(page, 2)).toHaveClass(/\bdone\b/);
  await expect(pin(page, 3)).toHaveText("?");                            // 3+ neighbor reports
  await expect(pin(page, 3)).toHaveClass(/\breported\b/);
  await expect(pin(page, 4)).toHaveClass(/\bmine\b/);
  const box = async (i) => (await pin(page, i).boundingBox()).width;
  expect(await box(4)).toBeGreaterThan(await box(0));
  // fill = availability: the three states really differ in colour
  const bg = async (i) => pin(page, i).evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(new Set([await bg(0), await bg(2), await bg(3)]).size).toBe(3);
});

test("map key names every icon and ring choice, plus Done / Reported only when the event uses them", async ({ page }) => {
  await openEvent(page, pinEvent());
  const key = page.locator("#mapAfter .legend .chip");
  await expect(key).toHaveText(["🍬 Candy only", "🎃 Non-food", "🍬🎃 Both", "Front gate", "Garden gate", "Both gates", "✕Done", "?Reported out"]);
  await expect(page.locator("#mapAfter .legend .gl.teal")).toHaveText("🎃");
});

test("map key: switches off → no Done / Reported chips", async ({ page }) => {
  await openEvent(page, pinEvent({ features: {} }));
  await expect(page.locator(".legend .chip")).toHaveCount(6);
});

test("no pin questions and no switches: plain pins, no key", async ({ page }) => {
  await openEvent(page, pinEvent({ features: {}, payload_schema: { fields: {} } }));
  await expect(page.locator(".legend")).toHaveCount(0);
  await expect(pin(page, 0)).toHaveText("");
  await expect(pin(page, 0)).not.toHaveClass(/\br\d\b/);
});

test("popup + list say 'Done for the night' / 'Neighbors say they're out'", async ({ page }) => {
  await openEvent(page, pinEvent());
  await page.locator("#map .leaflet-marker-icon").nth(2).dispatchEvent("click");   // the pin itself, even mid-zoom
  await expect(page.locator(".leaflet-popup-content")).toContainText("Done for the night");
  await page.locator("#tab-list").click();
  await expect(page.locator(".entries li").filter({ hasText: "Villa 4" })).toContainText("Neighbors say they're out");
  await expect(page.locator(".entries li").filter({ hasText: "Villa 2" }).locator(".gl.teal")).toHaveText("🎃");
});

test("organizer-typed icons are text, never HTML (pin, key, popup, list)", async ({ page }) => {
  let fired = false;
  page.on("dialog", (d) => { fired = true; d.dismiss(); });
  const evil = '<img src=x onerror=alert(1)>';
  const schema = { fields: { treats: { type: "enum", values: ["x"], pin: "glyph", labels_en: { x: "X" }, glyphs: { x: evil } } } };
  await openEvent(page, pinEvent({ payload_schema: schema }, [home("a", "1", 24.521, { treats: "x" })]));
  await expect(page.locator("#map img:not(.leaflet-tile)")).toHaveCount(0);
  await expect(pin(page, 0)).toContainText("<img");
  await expect(page.locator(".legend")).toContainText("<img");
  await page.locator("#map .leaflet-marker-icon").first().dispatchEvent("click");   // the pin itself, even mid-zoom
  await expect(page.locator(".leaflet-popup-content")).toContainText("<img");
  await page.locator("#tab-list").click();
  await expect(page.locator(".entries")).toContainText("<img");
  await expect(page.locator("main img")).toHaveCount(0);
  expect(fired).toBe(false);
});

test("looks: the event page wears its look (colours + mark); Haq al Laila leads with its Arabic tagline", async ({ page }) => {
  await openEvent(page, pinEvent());
  await expect(page.locator("html")).toHaveAttribute("data-look", "halloween");
  await expect(page.locator(".evhead h1 .mark")).toHaveText("🎃");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--jc-accent").trim());
  expect(accent).toBe("#f28c28");
  // the four safety signals never change with a look
  const warn = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--jc-warn").trim());
  expect(warn).toBe("#f2b33c");
});

test("Haq al Laila: navy + gold, Arabic tagline above the English title", async ({ page }) => {
  await openEvent(page, pinEvent({ look: "haq_al_laila" }));
  await expect(page.locator("html")).toHaveAttribute("data-look", "haq_al_laila");
  await expect(page.locator(".evhead .tagline")).toHaveText("عطونا الله يعطيكم");
  await expect(page.locator(".evhead .tagline")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".evhead h1 .mark")).toHaveText("🏮");
  // fill = availability must survive the gold look: "reported" can't be gold-ish amber
  const rgb = (i) => pin(page, i).evaluate((n) => getComputedStyle(n).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
  const [a, r] = [await rgb(0), await rgb(3)];
  expect(Math.abs(a[0] - r[0]) + Math.abs(a[1] - r[1]) + Math.abs(a[2] - r[2])).toBeGreaterThan(120);
});

test("an unknown or plain look changes nothing", async ({ page }) => {
  await openEvent(page, pinEvent({ look: "neon_future" }));
  await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);
  await expect(page.locator(".evhead .mark")).toHaveCount(0);
});

test("events list: each card wears its event's look; plain cards don't", async ({ page }) => {
  const eb = eventsBackend({ rpc: { jc_events_list: () => ok([
    Object.assign({}, LIVE, { id: "h", slug: "spooky", look: "halloween", homes_in: 3 }),
    Object.assign({}, LIVE, { id: "p", slug: "plain-one", look: "plain", homes_in: 1 }),
  ]) } });
  await stubBackend(page, { rpc: eb.rpc });
  await signIn(page);
  await page.goto("events/");
  await expect(page.locator('[data-event="spooky"]')).toHaveAttribute("data-look", "halloween");
  await expect(page.locator('[data-event="spooky"] b .mark')).toHaveText("🎃");
  await expect(page.locator('[data-event="plain-one"]')).not.toHaveAttribute("data-look", /.*/);
  await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);   // the list page itself stays plain
});

// ---- organizer side: the allergy-friendly tick ----
test("templates pre-tick the allergy-friendly choice (teal pumpkin / nut-free)", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  for (const [tpl, want] of [["halloween", ["non_food"]], ["haq_al_laila", ["nut_free"]]]) {
    await page.goto("admin/");
    await page.locator("#newEv").click();
    await page.locator(`[data-tpl="${tpl}"]`).click();
    await page.locator("#title_en").fill("T " + tpl);
    await expect(page.locator('.qcard[data-q="0"] [data-c-allergy]')).toHaveCount(3);
    await page.locator("#save").click();
    await expect(page.locator("#msg")).toHaveText("Saved.");
    const saves = calls.filter((c) => c.name === "jc_admin_event_save");
    expect(saves[saves.length - 1].args.p_fields.payload_schema.fields.treats.allergy_friendly).toEqual(want);
  }
});

test("builder: tick / untick allergy-friendly per choice → only the ticked one is saved; only for icon questions", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="blank"]').click();
  await page.locator("#title_en").fill("Bake sale");
  await page.locator("#addQ").click();
  let q = page.locator(".qcard").last();
  await q.locator('[data-q-label="en"]').fill("What's on the table?");
  await expect(q.locator("[data-c-allergy]")).toHaveCount(0);            // no icon question → no tick
  await q.locator("[data-q-pin]").selectOption("glyph");
  q = page.locator(".qcard").last();
  await expect(q.locator(".help")).toContainText("its icon shows teal on the map");
  await q.locator('[data-c-f="glyph"]').nth(0).fill("🧁");
  await q.locator('[data-c-f="en"]').nth(0).fill("Cakes");
  await q.locator('[data-c-f="glyph"]').nth(1).fill("🍎");
  await q.locator('[data-c-f="en"]').nth(1).fill("Fruit");
  await q.locator("[data-c-allergy]").nth(0).check();
  await q.locator("[data-c-allergy]").nth(1).check();
  await q.locator("[data-c-allergy]").nth(0).uncheck();                  // changed their mind: cakes aren't
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);  // still fits a phone
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const saves = calls.filter((c) => c.name === "jc_admin_event_save");
  expect(saves[saves.length - 1].args.p_fields.payload_schema.fields.what_s_on_the_table.allergy_friendly).toEqual(["fruit"]);
});

test("builder: nothing ticked → no allergy_friendly key is stored", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="yard_sale"]').click();                  // icon question, nothing pre-ticked
  await page.locator("#title_en").fill("Yard sale");
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const saves = calls.filter((c) => c.name === "jc_admin_event_save");
  expect(saves[saves.length - 1].args.p_fields.payload_schema.fields.items).not.toHaveProperty("allergy_friendly");
});

// ---- review follow-ups (code + security review, 2026-11-05) ----
test("two-emoji icons (🍬🎃) shrink to fit inside the pin; the teal tint is really applied", async ({ page }) => {
  await openEvent(page, pinEvent({}, [home("a", "1", 24.521, { treats: "both", entrance: "front" }),
                                      home("b", "2", 24.526, { treats: "non_food", entrance: "front" })]));
  const g = pin(page, 0).locator(".gl");
  await expect(g).toHaveClass(/\bmulti\b/);
  const [pb, gb] = [await pin(page, 0).boundingBox(), await g.boundingBox()];
  expect(gb.x).toBeGreaterThanOrEqual(pb.x);                              // not cut off either side
  expect(gb.x + gb.width).toBeLessThanOrEqual(pb.x + pb.width);
  await expect(pin(page, 1).locator(".gl")).not.toHaveClass(/\bmulti\b/);
  expect(await pin(page, 1).locator(".gl").evaluate((n) => getComputedStyle(n).filter)).toContain("hue-rotate");
});

test("hostile choice wording and look name stay text / are ignored; a malformed allergy list breaks nothing", async ({ page }) => {
  let fired = false;
  page.on("dialog", (d) => { fired = true; d.dismiss(); });
  const evil = '<img src=x onerror=alert(1)>';
  const schema = { fields: {
    treats: { type: "enum", values: ["x", "y"], pin: "glyph", labels_en: { x: evil, y: "Y" }, glyphs: { x: "🍬", y: "🎃" },
      allergy_friendly: "y" },                                               // not an array
    gate: { type: "enum", values: ["f"], pin: "ring", labels_en: { f: evil } },
  } };
  await openEvent(page, pinEvent({ payload_schema: schema, look: '"><img src=x onerror=alert(2)>' },
    [home("a", "1", 24.521, { treats: "y", gate: "f" })]));
  await expect(page.locator(".legend")).toContainText("<img");
  await expect(page.locator("main img:not(.leaflet-tile)")).toHaveCount(0);   // map tiles are the only images
  await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);
  await expect(pin(page, 0).locator(".gl.teal")).toHaveCount(0);           // no tint from a non-array
  await expect(pin(page, 0)).toHaveText("🎃");
  expect(fired).toBe(false);
});

test("look '__proto__' is not a look", async ({ page }) => {
  await openEvent(page, pinEvent({ look: "__proto__" }));
  await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);
  await expect(page.locator(".evhead .mark")).toHaveCount(0);
});
