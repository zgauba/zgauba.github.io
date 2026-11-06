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
// the key lives in the "Map Labels" window (5b.2)
async function openKey(page) {
  await page.locator("#labelsBtn").click();
  await expect(page.locator("#labels .legend")).toBeVisible();
}

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
  // your own pin looks exactly like the others (Zee, 2026-11-05) — same size, no extra ring — and sits on top
  const box = async (i) => (await pin(page, i).boundingBox()).width;
  expect(await box(4)).toBe(await box(0));
  const shadow = async (i) => pin(page, i).evaluate((n) => getComputedStyle(n).boxShadow);
  expect(await shadow(4)).toBe(await shadow(0));
  const z = async (i) => page.locator("#map .leaflet-marker-icon").nth(i).evaluate((n) => Number(n.style.zIndex));
  expect(await z(4)).toBeGreaterThan(await z(0));
  // fill = availability: the three states really differ in colour
  const bg = async (i) => pin(page, i).evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(new Set([await bg(0), await bg(2), await bg(3)]).size).toBe(3);
});

test("map key names every icon and ring choice, plus Done / Reported only when the event uses them", async ({ page }) => {
  await openEvent(page, pinEvent());
  await openKey(page);
  const key = page.locator("#labels .legend .chip");
  await expect(key).toHaveText(["🍬 Candy only", "🎃 Non-food", "🍬🎃 Both", "Front gate", "Garden gate", "Both gates", "✕Out of treats", "?Reported out"]);   // treat night wording (5a.1)
  await expect(page.locator("#labels .legend .gl.teal")).toHaveText("🎃");
});

test("map key: switches off → no Done / Reported chips", async ({ page }) => {
  await openEvent(page, pinEvent({ features: {} }));
  await openKey(page);
  await expect(page.locator(".legend .chip")).toHaveCount(6);
});

test("no pin questions and no switches: plain pins, no key", async ({ page }) => {
  await openEvent(page, pinEvent({ features: {}, payload_schema: { fields: {} } }));
  await expect(page.locator(".legend")).toHaveCount(0);
  await expect(page.locator("#labelsBtn")).toHaveCount(0);                 // nothing to explain: no button
  await expect(pin(page, 0)).toHaveText("");
  await expect(pin(page, 0)).not.toHaveClass(/\br\d\b/);
});

test("popup + list say 'Out of treats' (treat night) / 'Neighbors say they're out'", async ({ page }) => {
  await openEvent(page, pinEvent());
  await page.locator("#map .leaflet-marker-icon").nth(2).dispatchEvent("click");   // the pin itself, even mid-zoom
  await expect(page.locator(".leaflet-popup-content")).toContainText("Out of treats");
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
  await openKey(page);
  await expect(page.locator(".legend")).toContainText("<img");
  await page.locator("#labelsClose").click();
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
  await expect(page.locator(".evhead h1 .mark")).toHaveText("🌙");
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
  // both boxes in one go: two separate reads can straddle the map's zoom animation (flaked 2 in 8)
  const [pb, gb] = await pin(page, 0).evaluate((n) => [n.getBoundingClientRect(), n.querySelector(".gl").getBoundingClientRect()]
    .map((r) => ({ x: r.x, width: r.width })));
  expect(gb.x).toBeGreaterThanOrEqual(pb.x - 0.5);                        // not cut off either side
  expect(gb.x + gb.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
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
  await openKey(page);
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

// ---- 5a.1 (Zee 2026-11-05): split ring for "both gates", key in rows, wording, 🌙 ----
const SPLIT = { fields: {
  entrance: { type: "enum", values: ["front", "garden", "both"], pin: "ring",
    labels_en: { front: "Front gate", garden: "Garden gate", both: "Both gates" }, ring_split: ["both"] },
} };
test("'both gates' draws a split ring: half front colour, half garden colour (pin + key)", async ({ page }) => {
  await openEvent(page, pinEvent({ payload_schema: SPLIT }, [home("a", "1", 24.521, { entrance: "both" }),
                                                              home("b", "2", 24.526, { entrance: "garden" })]));
  await expect(pin(page, 0)).toHaveClass(/\brs\b/);
  const sides = (loc) => loc.evaluate((n) => { const c = getComputedStyle(n); return [c.borderTopColor, c.borderRightColor, c.borderBottomColor, c.borderLeftColor]; });
  const [t, r, b, l] = await sides(pin(page, 0));
  expect(t).toBe(l); expect(r).toBe(b); expect(t).not.toBe(r);
  expect(t).toBe("rgb(255, 255, 255)");                                   // front gate = ring 0
  expect((await sides(pin(page, 1)))[0]).toBe(r);                         // garden gate = the other half
  await openKey(page);
  const dot = page.locator(".legend .chip").filter({ hasText: "Both gates" }).locator(".ringdot");
  expect(await sides(dot)).toEqual([t, r, b, l]);
});

test("map key is readable: 14px+ text in the main ink colour, gate / state dots 20px", async ({ page }) => {
  await openEvent(page, pinEvent());
  await openKey(page);
  const chips = page.locator("#labels .legend .chip");
  const st = await chips.evaluateAll((ns) => ns.map((n) => {
    const c = getComputedStyle(n), d = n.querySelector(".ringdot");
    return { fs: parseFloat(c.fontSize), color: c.color, dot: d ? d.getBoundingClientRect().width : null };
  }));
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  for (const c of st) {
    expect(c.fs).toBeGreaterThanOrEqual(14);
    expect(c.color).toBe(ink);
    if (c.dot !== null) expect(c.dot).toBeGreaterThanOrEqual(20);
  }
  expect(st.filter((c) => c.dot !== null)).toHaveLength(5);    // 3 gates + done + reported
});

test("map key: icons, gates and states each get a row; nothing hidden off the side", async ({ page }) => {
  await openEvent(page, pinEvent());
  await openKey(page);
  await expect(page.locator(".legend .row")).toHaveCount(3);
  await expect(page.locator(".legend h3")).toHaveText(["Treats", "Entrance", "Tonight"]);   // the questions' own words
  await expect(page.locator(".legend .row").nth(1)).toContainText("Front gate");
  const fits = await page.locator(".legend .row").evaluateAll((rows) => rows.every((n) => n.scrollWidth <= n.clientWidth + 1));
  expect(fits).toBe(true);                                                 // no row runs off the side
  await expect(page.locator(".legend .chip").filter({ hasText: "Both gates" })).toBeInViewport();
});

test("events that aren't treat nights say 'Done', not 'Out of treats'", async ({ page }) => {
  await openEvent(page, pinEvent({ look: "yard_sale" }));
  await openKey(page);
  await expect(page.locator(".legend")).toContainText("Done");
  await expect(page.locator(".legend")).not.toContainText("Out of treats");
});

test("gate rings are thick enough to see (≥ 4px)", async ({ page }) => {
  await openEvent(page, pinEvent());
  expect(await pin(page, 0).evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth))).toBeGreaterThanOrEqual(4);
});

test("builder: Halloween template pre-ticks 'Both gates' as a split ring; ticks round-trip", async ({ page }) => {
  const ab = adminBackend({ scopes: ["events"] });
  const { calls } = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/");
  await page.locator("#newEv").click();
  await page.locator('[data-tpl="halloween"]').click();
  await page.locator("#title_en").fill("Halloween 2027");
  const gate = page.locator('.qcard[data-q="2"]');
  await expect(gate.locator("[data-c-split]")).toHaveCount(3);
  await expect(gate.locator("[data-c-split]").nth(2)).toBeChecked();
  await expect(gate.locator(".help")).toContainText("half in each");
  await expect(page.locator('.qcard[data-q="0"] [data-c-split]')).toHaveCount(0);   // icon question: no split tick
  await gate.locator("[data-c-split]").nth(0).check();
  await gate.locator("[data-c-split]").nth(0).uncheck();
  await page.locator("#save").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  const saves = calls.filter((c) => c.name === "jc_admin_event_save");
  expect(saves[saves.length - 1].args.p_fields.payload_schema.fields.entrance.ring_split).toEqual(["both"]);
});

test("small phone: the map screen fits without scrolling; the Map Labels window fits on screen and closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await openEvent(page, pinEvent({ look: "haq_al_laila", features: { giant_switch: true, crowd_reports: true, supply: true } }));
  await expect(page.locator("body")).toHaveClass(/\bevfit\b/);           // no key under the map any more
  await openKey(page);
  const d = await page.locator("#labels").boundingBox();
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(d.y + d.height).toBeLessThanOrEqual(640);                         // the window itself fits
  const last = page.locator("#labels .legend .row").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();                                     // and scrolls to its last row
  await page.locator("#labelsClose").click();
  await expect(page.locator("#labels")).toBeHidden();
  await openKey(page);
  await page.mouse.click(5, 5);                                            // a tap on the dimmed backdrop closes it too
  await expect(page.locator("#labels")).toBeHidden();
});

test("supply: the key explains the four bars; the popup and list show the gauge", async ({ page }) => {
  const entries = [home("a", "1", 24.521, { treats: "candy", entrance: "front" }, { supply_level: 1 })];
  await openEvent(page, pinEvent({ features: { supply: true } }, entries));
  await openKey(page);
  await expect(page.locator(".legend h3").last()).toHaveText("How much is left");
  const levels = page.locator(".legend .row").last().locator(".chip");
  await expect(levels).toHaveText(["Plenty", "Some left", "Running low", "Almost out"]);
  expect(await levels.evaluateAll((cs) => cs.map((c) => c.querySelectorAll(".gauge i.on").length))).toEqual([4, 3, 2, 1]);
  await page.locator("#labelsClose").click();
  await page.locator("#map .leaflet-marker-icon").first().dispatchEvent("click");
  const sup = page.locator(".leaflet-popup .supply");
  await expect(sup).toHaveText("Supply: Running low");
  await expect(sup.locator(".gauge i.on")).toHaveCount(2);
  await expect(sup.locator(".gauge i")).toHaveCount(4);
});

test("split ring falls back to one colour when it can't split", async ({ page }) => {
  const two = { fields: { g: { type: "enum", values: ["a", "b"], pin: "ring", ring_split: ["b"] } } };
  await openEvent(page, pinEvent({ payload_schema: two }, [home("a", "1", 24.521, { g: "b" })]));
  await expect(pin(page, 0)).toHaveClass(/\br1\b/);                       // only one other choice: plain ring
  await expect(pin(page, 0)).not.toHaveAttribute("style", /.*/);
});
test("a non-array ring_split never splits", async ({ page }) => {
  const odd = { fields: { g: { type: "enum", values: ["a", "b", "c"], pin: "ring", ring_split: "c" } } };
  await openEvent(page, pinEvent({ payload_schema: odd }, [home("a", "1", 24.521, { g: "c" })]));
  await expect(pin(page, 0)).toHaveClass(/\br2\b/);
});
