// R5b-1 — residents' Pets page (server S4 + R5a). Plan: docs/plans/R5-pets.md.
// The stub mirrors the server's privacy rules (jc_pet_card / jc_pet_get): an owned pet's home is always sent (homes
// can't be hidden — HH 2026-11-11; `noHome` fakes a server that sends none, to check the page renders only what
// arrives); sightings only as the server's rule sends them (jc_pet_sight_from); never a reporter.
// The page must render exactly what arrives.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_HOME } = require("./stub");
const PNG_1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const { signIn, tapWhenStill, petsBackend: backend, PET_GROUP: GROUP, petId: ID, PET_MY_HOME: MY_HOME, PET_V40: V40, PET_MINE_HOME: MINE_HOME } = require("./backends");

test.use({ timezoneId: "Europe/London" });

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const named = (calls, name) => calls.filter((c) => c.name === name);
const NOW = Date.parse("2026-11-11T06:30:00Z");          // 10:30 in Dubai
const gate = () => { let open; const p = new Promise((res) => { open = res; }); return { p, open }; };

async function open(page, b, opts = {}) {
  await page.clock.install({ time: NOW });
  if (opts.lang) await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, opts.lang);
  // record what would be copied, and keep WhatsApp links from navigating (no request may leave the stubs)
  await page.addInitScript(() => {
    window.__copied = [];
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); } catch (e) {}
    window.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest('a[target="_blank"]'); if (a) e.preventDefault(); }, true);
  });
  const stub = await stubBackend(page, { rpc: b.rpc, storage: b.storage });
  await signIn(page);
  await page.goto("pets/" + (opts.q || ""));
  return stub;
}

test("module off: the kill switch — a notice, no pets RPC, no Pets in the bar, no My Pets on My Home", async ({ page }) => {
  const b = backend({ enabled: false });
  const { calls } = await open(page, b);
  await expect(page.locator("#ptOff")).toHaveText("This section isn't open yet in your community.");
  expect(calls.filter((c) => /^jc_pet/.test(c.name))).toEqual([]);
  await expect(page.locator('#tabbar a[data-tab="pets"]')).toHaveCount(0);
  await page.goto("home/");
  await expect(page.locator("#toPin")).toBeVisible();
  await expect(page.locator("#toPets")).toHaveCount(0);
});

test("Pets tab: owned pets only, missing on top, the server's (nearest-first) order kept, species / wanderer chips", async ({ page }) => {
  const b = backend({ serverOrder: true, extra: [{ id: ID(7), kind: "owned", species: "bird", name: "Kiwi", home: { id: "h9", village: "ain-al-maha", building: "B2", number: "304", noHome: true } }] });
  const { calls } = await open(page, b);
  await expect(page.locator('[role="tab"]')).toHaveText(["Pets", "Strays", "My Pets"]);
  await expect(page.locator("#pttab-pets")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptMissing li")).toHaveCount(1);
  const luna = page.locator(`#ptMissing [data-pet="${ID(2)}"]`);
  await expect(luna).toContainText("Cat · Pet");
  await expect(luna).toContainText("Home 40 · Seef Al Jubail");
  await expect(luna).toContainText("Last seen: Near the beach park");
  await expect(luna.locator(".chip.miss")).toHaveText("Missing");
  expect(lastCall(calls, "jc_pets_list").args).toEqual({ p_filter: "all" });
  // owned only, in the order the server sent (nearest my home pin) — not re-sorted A–Z; no strays here
  await expect(page.locator("#ptList b")).toHaveText(["Rex", "Mochi", "Kiwi"]);
  await expect(page.locator("#ptSorted")).toHaveText("Sorted by: nearest your home");
  await expect(page.locator("#view")).not.toContainText("Ginger");
  await expect(page.locator("#view")).not.toContainText("Community animal");
  // the server sends no home (defensive: render only what arrives) → the card shows none
  expect((await page.locator(`[data-pet="${ID(7)}"]`).innerText()).replace(/\s+/g, " ").trim()).toBe("Kiwi Bird · Pet");
  await expect(page.locator("#ptFilters button")).toHaveText(["All", "Dogs", "Cats", "Other", "Wanderers"]);
  for (const [f, names] of [["dogs", ["Rex"]], ["cats", ["Mochi"]], ["other", ["Kiwi"]], ["wanderers", ["Mochi"]]]) {
    await page.locator("#ptF-" + f).click();
    await expect(page.locator("#ptF-" + f)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ptList b")).toHaveText(names);
    await expect(page.locator("#ptMissing li")).toHaveCount(1);            // missing stays on top under every filter
  }
  await expect(page.locator('#tabbar a[data-tab="pets"]')).toHaveAttribute("aria-current", "page");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-list.png", fullPage: true });
});

test("Pets tab: no home pin → name order said plainly; an old ?tab=list link opens Pets", async ({ page }) => {
  const b = backend({ me: Object.assign({}, MEMBER, { home: Object.assign({}, MEMBER.home, { lat: null, lng: null, pin_set_at: null }) }) });
  await open(page, b, { q: "?tab=list" });
  await expect(page.locator("#pttab-pets")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptSorted")).toHaveText("Sorted by: name. Pin your home on My Home to see the nearest first.");
});

const GINGER_SEEN = { lat: 24.5310, lng: 54.4320, at: "2026-11-11T04:30:00Z" };   // 2 h before NOW
function straysBackend() {
  return backend({ serverOrder: true, pets: [
    { id: ID(3), kind: "stray", species: "cat", name: "Ginger", care_state: "under_care", territory: "Behind the mosque",
      territory_lat: 24.60, territory_lng: 54.50, last_seen: GINGER_SEEN, last_seen_at: GINGER_SEEN.at },
    { id: ID(4), kind: "stray", species: "dog", name: "Sandy", care_state: "known_fine", territory: "The marina", territory_lat: 24.50, territory_lng: 54.40 },
    { id: ID(8), kind: "stray", species: "cat", name: "Pepper", care_state: "needs_help" },                       // no location yet
    { id: ID(5), kind: "stray", species: "cat", name: "Biscuit", care_state: "rehomed", territory_lat: 24.52, territory_lng: 54.41 },
    { id: ID(1), kind: "owned", species: "dog", name: "Rex", home: V40 },
  ] });
}

test("Strays tab: one coloured pin per stray (latest sighting, else territory), rehomed off the map, cards below — Needs help first", async ({ page }) => {
  await open(page, straysBackend(), { q: "?tab=strays" });
  await expect(page.locator("#pttab-strays")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptmap")).toHaveAttribute("aria-label", "Map of strays");
  // Ginger (sighting) + Sandy (territory); Pepper has no location; Biscuit is rehomed
  await expect(page.locator("#ptmap path.leaflet-interactive")).toHaveCount(2);
  const fills = await page.locator("#ptmap path.leaflet-interactive").evaluateAll((ps) => ps.map((p) => p.getAttribute("fill")));
  expect(fills).toEqual(["#3e9b76", "#a9a294"]);                          // Under care = the normal pin; Known and fine = neutral
  await expect(page.locator("#ptUnplaced")).toHaveText("1 not on the map yet — see below");
  await expect(page.locator("#ptStrays b")).toHaveText(["Pepper", "Ginger", "Sandy", "Biscuit"]);
  await expect(page.locator(`#ptStrays [data-pet="${ID(4)}"]`)).toContainText("Dog · Stray");
  await expect(page.locator(`#ptStrays [data-pet="${ID(4)}"] .chip`)).toHaveText("Known and fine");
  await expect(page.locator(`#ptStrays [data-pet="${ID(8)}"] .chip.warn`)).toHaveText("Needs help");
  await expect(page.locator(`#ptStrays [data-pet="${ID(3)}"]`)).toContainText("Last seen 2 h ago");
  await expect(page.locator("#view")).not.toContainText("Rex");
  // names only when zoomed in
  await expect(page.locator("#ptmap")).toHaveClass(/nolabels/);
  await page.clock.runFor(2000);                                             // the fake clock: let the fit-to-pins animation end
  await page.evaluate(() => map.setView([24.531, 54.432], 18, { animate: false }));
  await expect(page.locator("#ptmap")).not.toHaveClass(/nolabels/);
  await expect(page.locator("#ptmap .bklabel")).toHaveText(["Ginger", "Sandy"]);
  // the key
  await page.locator("#labelsBtn").click();
  await expect(page.locator("#ptKey .legend .chip")).toHaveText(["Needs help", "Under care", "Known and fine"]);
  await page.locator("#ptKeyClose").click();
  await expect(page.locator("#ptKey")).not.toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-strays.png", fullPage: true });
  // a pin → its popup → Open → the stray's page
  await tapWhenStill(page, page.locator("#ptmap path.leaflet-interactive").first());
  await expect(page.locator(".leaflet-popup")).toContainText("Ginger");
  await expect(page.locator(".leaflet-popup")).toContainText("Cat · Under care");
  await page.locator(".leaflet-popup [data-popopen]").click();
  await expect(page.locator("h1")).toHaveText("Ginger");
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#pttab-strays")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptmap path.leaflet-interactive")).toHaveCount(2);           // a fresh map, not a dead one
});

test("My Pets: my pet seen out on its own in the last 24 h → an amber line; older → none; the hub card says it too", async ({ page }) => {
  const out = "2026-11-11T04:30:00Z";
  const b = backend({ alerts: { missing: [{ id: ID(2), name: "Luna" }], seen_out: [{ id: ID(6), name: "Mochi", at: out }] },
    extra: [{ id: ID(9), kind: "owned", species: "dog", name: "Bruno", home: MINE_HOME, last_seen_at: "2026-11-10T04:00:00Z" }] });
  b.st.pets.find((p) => p.name === "Mochi").last_seen_at = out;
  const { calls } = await open(page, b, { q: "?tab=mine" });
  const before = named(calls, "jc_pets_alerts").length;
  await expect(page.locator(`#ptMine [data-pet="${ID(6)}"] .seenout`)).toHaveText("Seen out on their own · 2 h ago");
  await expect(page.locator(`#ptMine [data-pet="${ID(9)}"] .seenout`)).toHaveCount(0);
  await page.goto("./");
  await expect(page.locator("#hubPets .hubmiss")).toHaveText("1 missing pet");
  await expect(page.locator("#hubPets .hubout")).toHaveText("Mochi was seen out · 2 h ago");
  await expect.poll(() => named(calls, "jc_pets_alerts").length).toBe(before + 1);   // one read per hub visit
  if (process.env.SHOT_DIR) await page.locator("#hubPets").locator("xpath=..").screenshot({ path: process.env.SHOT_DIR + "/pt-hub.png" });
});

for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: Pets, Strays (map + key open) and My Pets have no violations`, async ({ page }) => {
    await open(page, straysBackend(), { lang });
    const scan = async () => (await new AxeBuilder({ page }).disableRules(["region"]).analyze()).violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "));
    await expect(page.locator("#ptSorted")).toBeVisible();
    expect(await scan()).toEqual([]);
    await page.locator("#pttab-strays").click();
    await expect(page.locator("#ptmap path.leaflet-interactive")).toHaveCount(2);
    expect(await scan()).toEqual([]);
    await page.locator("#labelsBtn").click();
    await expect(page.locator("#ptKey")).toBeVisible();
    expect(await scan()).toEqual([]);
    await page.locator("#ptKeyClose").click();
    await page.locator("#pttab-mine").click();
    expect(await scan()).toEqual([]);
  });
}

// R5b-2b-2b: ids past 9 (petId would make a 37-character id)
const XID = (s) => "22222222-bbbb-4bbb-8bbb-0000000000" + s;

test("a neighbor's wanderer that isn't missing: no sightings, no report button, no owner controls, no share", async ({ page }) => {
  const b = backend({ extra: [{ id: XID("a1"), kind: "owned", species: "cat", name: "Pip", home: V40, wanderer: true }] });
  const { calls } = await open(page, b, { q: "?pet=" + XID("a1") });
  await expect(page.locator("h1")).toHaveText("Pip");
  await expect(page.locator("#ptFacts")).toContainText("Home 40 · Seef Al Jubail");
  for (const id of ["#ptSight", "#ptShare", "#ptSightings", "#ptOwner", "#ptMiss", "#ptEdit", "#ptAlarm", "#ptSeenOut"]) await expect(page.locator(id)).toHaveCount(0);
  await expect(page.locator('[role="tab"]')).toHaveCount(0);                 // a wanderer being out is normal: About only, no tab row
  expect(named(calls, "jc_pets_group_get")).toEqual([]);                  // the group link isn't even asked for
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#ptList")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("a neighbor's pet at home: 'Seen Rex out on their own?' — household-only said before sending; then 'Is this Rex?' to share", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(1) });
  await expect(page.locator('[role="tab"]')).toHaveText(["About", "Sightings"]);    // no Map: not missing, not a stray
  await expect(page.locator("#ptpg-about")).toHaveAttribute("aria-selected", "true");
  for (const id of ["#ptOwner", "#ptMiss", "#ptEdit", "#ptAlarm", "#ptSeenOut"]) await expect(page.locator(id)).toHaveCount(0);
  await page.locator("#ptpg-sightings").click();
  await expect(page.locator("#ptSightings")).toHaveCount(0);                 // the server sends a neighbor none
  await expect(page.locator("#ptShare")).toHaveCount(0);                     // nothing to share until something was seen
  expect(named(calls, "jc_pets_group_get")).toEqual([]);
  await expect(page.locator("#ptSight")).toHaveText("Seen Rex out on their own?");
  await page.locator("#ptSight").click();
  await expect(page.locator("#ptSightPrivacy")).toHaveText("Only Rex's household and the community's pet admins see this report. If they report Rex missing within a day, neighbors helping to search see it too. It never shows who you are. We delete the record of who sent it within 48 hours, and the report itself after 30 days.");
  await page.locator("#ptSightNote").fill("By the canal");
  await page.locator("#ptSightGo").click();
  await expect(page.locator("#msg")).toHaveText("Thanks. Rex's household will see your report.");
  expect(lastCall(calls, "jc_pet_sighting_add").args).toEqual({ p_pet: ID(1), p_note: "By the canal", p_lat: null, p_lng: null });
  await expect(page.locator("#ptSightings")).toHaveCount(0);                 // still the household's only
  const url = new URL(page.url()).origin + "/commons/pets/?pet=" + ID(1);
  await expect(page.locator("#ptWaText")).toHaveText("Is this Rex (Dog)? I just saw them out on their own: By the canal. Details on Commons: " + url);
  await expect(page.locator("#ptWaOut")).toHaveText("Sharing is your choice: this message goes to everyone in the chat, not only Rex's household.");
  await expect(page.locator("#ptWaGroup")).toHaveAttribute("href", GROUP);
});

test("my own pet seen out on its own: amber box on every tab, the report on Sightings, Report as missing right there; no report button for me", async ({ page }) => {
  const b = backend({ extra: [
    { id: XID("b1"), kind: "owned", species: "dog", name: "Pepper", home: MINE_HOME, last_seen_at: "2026-11-11T04:30:00Z",
      sightings: [{ id: 50, note: "By the canal", lat: null, lng: null, seen_at: "2026-11-11T04:30:00Z", by_me: false }] },
    { id: XID("b2"), kind: "owned", species: "cat", name: "Tom", home: MINE_HOME },
  ] });
  await open(page, b, { q: "?pet=" + XID("b1") });
  await expect(page.locator("#ptSeenOut")).toContainText("Pepper was seen out on their own · 2 h ago");
  await expect(page.locator("#ptSeenOut")).toContainText("By the canal");
  await expect(page.locator("#ptSeenOut")).toContainText("If Pepper is home, you can ignore this.");
  await expect(page.locator("#ptAlarm")).toHaveCount(0);
  await expect(page.locator('[role="tab"]')).toHaveText(["About", "Sightings (1)"]);
  await page.locator("#ptpg-sightings").click();
  await expect(page.locator("#ptSeenOut")).toBeVisible();
  await expect(page.locator("#ptSightings li")).toContainText("By the canal");
  await expect(page.locator("#ptSight")).toHaveCount(0);                     // the household gets reports, doesn't send them
  await expect(page.locator("#ptShare")).toHaveCount(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-seen-out.png", fullPage: true });
  await page.locator("#ptSeenMiss").click();
  await expect(page.locator("#ptpg-about")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptMissNote")).toBeFocused();
  await expect(page.locator("#ptSeenMiss")).toHaveCount(0);                  // one red button at a time
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#msg")).toHaveText("Pepper is now listed as missing. Share the alert below.");
  await expect(page.locator("#ptAlarm")).toBeVisible();
  await expect(page.locator("#ptSeenOut")).toHaveCount(0);
  // my other pet, never reported: Sightings says what will land there
  await page.goto("pets/?pet=" + XID("b2") + "&show=sightings");
  await expect(page.locator("#ptSightings")).toHaveText("If neighbors see Tom out on their own, their reports show here. Only your household sees them.");
  await expect(page.locator("#ptSeenOut")).toHaveCount(0);
});

test.describe("a sighting", () => {
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 24.5312345, longitude: 54.4329876 } });

  test("missing pet: note + location sent exactly; privacy said up front; the WhatsApp message tells the group what was seen", async ({ page }) => {
    const b = backend();
    const { calls } = await open(page, b, { q: "?pet=" + ID(2) });
    await expect(page.locator("#ptAlarm")).toContainText("Luna has been missing since Tue 10 Nov · ⁦19:00⁩");
    await expect(page.locator("#ptAlarm")).toContainText("Last seen: Near the beach park");
    await expect(page.locator("#ptSightings")).toHaveText("No sightings yet.");   // R5b-2b-0: a missing pet's sightings reach neighbors too
    await expect(page.locator("#ptpg-sightings")).toHaveAttribute("aria-selected", "true");   // a missing pet opens on Sightings
    await expect(page.locator(".pthero .chip.miss")).toHaveCount(0);   // the alarm says it; no second "Missing" badge
    await page.locator("#ptSight").click();
    await expect(page.locator("#ptSightPrivacy")).toHaveText(/never shows who you are\. We delete the record of who sent it within 48 hours, and the sighting itself after 30 days\./);
    await page.locator("#ptSightNote").fill("Under a car on Marsa road");
    await page.locator("#ptPosAdd").click();
    await expect(page.locator("#ptPick")).toBeVisible();
    await expect(page.locator("#ptSightGo")).toHaveCount(0);                 // the pin map decides first
    await expect(page.locator("#ptPickHelp")).toHaveText("Move the map so the ring is where you saw Luna.");   // found me
    await page.locator("#ptPickOk").click();
    await expect(page.locator("#ptPos")).toContainText("Location pin added.");
    await expect(page.locator("#ptPosClear")).toBeFocused();
    await page.locator("#ptSightGo").click();
    await expect(page.locator("#msg")).toHaveText("Thanks. Your sighting was sent.");
    expect(lastCall(calls, "jc_pet_sighting_add").args).toEqual({ p_pet: ID(2), p_note: "Under a car on Marsa road", p_lat: 24.53123, p_lng: 54.43299 });
    const url = new URL(page.url()).origin + "/commons/pets/?pet=" + ID(2);
    const text = "I just saw Luna (Cat): Under a car on Marsa road. Details on Commons: " + url;
    await expect(page.locator("#ptWaText")).toHaveText(text);
    await expect(page.locator("#ptWaGroup")).toHaveAttribute("href", GROUP);
    await expect(page.locator("#ptWaGroup")).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.locator("#ptWaAny")).toHaveAttribute("href", "https://wa.me/?text=" + encodeURIComponent(text));
    await expect(page.locator("#ptWaAny")).toHaveAttribute("rel", "noopener noreferrer");
    await page.locator("#ptWaGroup").click();
    await expect(page.locator("#msg")).toHaveText("Message copied. Paste it into the group.");
    expect(await page.evaluate(() => window.__copied)).toEqual([text]);
  });

  test("location only (no note) is accepted; nothing at all is refused before sending; Remove drops the location", async ({ page }) => {
    const b = backend();
    const { calls } = await open(page, b, { q: "?pet=" + ID(3) + "&show=sightings" });
    await page.locator("#ptSight").click();
    await page.locator("#ptSightGo").click();
    await expect(page.locator("#msg")).toHaveText("Add a note or your location first.");
    expect(named(calls, "jc_pet_sighting_add")).toEqual([]);
    const pin = async () => {
      await page.locator("#ptPosAdd").click();
      await expect(page.locator("#ptPickHelp")).toHaveText("Move the map so the ring is where you saw Ginger.");
      await page.locator("#ptPickOk").click();
    };
    await pin();
    await page.locator("#ptPosClear").click();
    await expect(page.locator("#ptPosAdd")).toBeFocused();
    await page.locator("#ptPosAdd").click();                                  // Cancel closes the pin map, nothing added
    await page.locator("#ptPickCancel").click();
    await expect(page.locator("#ptPosAdd")).toBeFocused();
    await expect(page.locator("#ptPos")).toHaveCount(0);
    await pin();
    await page.locator("#ptSightGo").click();
    await expect(page.locator("#msg")).toHaveText("Thanks. Your sighting was sent.");
    expect(lastCall(calls, "jc_pet_sighting_add").args).toEqual({ p_pet: ID(3), p_note: null, p_lat: 24.53123, p_lng: 54.43299 });
    await expect(page.locator("#ptWaText")).toContainText("I just saw Ginger (Cat). Details on Commons:");
  });
});

for (const [label, group] of [["none set", null], ["not a WhatsApp invite", "https://evil.example/chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12"], ["a script URL", "javascript:alert(1)"]]) {
  test(`group link ${label}: no group button — only the chat picker`, async ({ page }) => {
    const b = backend({ group });
    await open(page, b, { q: "?pet=" + ID(2) });
    await expect(page.locator("#ptWaAny")).toBeVisible();
    await expect(page.locator("#ptWaText")).toContainText("Missing: Luna (Cat). Seen them?");     // a neighbor's share: no home (security M1)
    await expect(page.locator("#ptWaText")).not.toContainText("Home 40");
    await expect(page.locator("#ptWaGroup")).toHaveCount(0);
  });
}

test("a stray: care record, territory, care log, sightings with no reporter (only \"your report\" on my own); rehomed = closed", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(3) });
  await expect(page.locator(".pthero .meta")).toHaveText("Cat · Stray");
  await expect(page.locator(".pthero .chip")).toHaveCount(0);             // its status is in the facts, not repeated
  await expect(page.locator("#ptFacts")).toContainText("Under care");
  await expect(page.locator("#ptFacts")).toContainText("Behind the mosque");
  await expect(page.locator("#ptCare li")).toHaveCount(4);
  await expect(page.locator('[data-care="sterilized"]')).toContainText("Done · ⁦1 Oct 2026⁩");
  await expect(page.locator('[data-care="sterilized"]')).toContainText("Clinic A");
  await expect(page.locator('[data-care="vaccination"] .st')).toHaveText("Due");
  await expect(page.locator('[data-care="dewormed"] .st')).toHaveText("Not recorded");
  await expect(page.locator("#ptLog li")).toContainText("Fed · Tue 10 Nov · ⁦09:00⁩");
  // R5b-2b-1: About first (a stray that isn't missing); Sightings is its own tab, with the count
  await expect(page.locator('[role="tab"]')).toHaveText(["About", "Sightings (3)", "Map"]);
  await expect(page.locator("#ptpg-about")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptSightings")).toHaveCount(0);
  await page.locator("#ptpg-sightings").click();
  await expect(page.locator("#ptpg-sightings")).toBeFocused();
  expect(new URL(page.url()).search).toBe("?pet=" + ID(3) + "&show=sightings");
  await expect(page.locator("#ptCare")).toHaveCount(0);
  const s = page.locator("#ptSightings li");
  await expect(s).toHaveCount(3);
  await expect(s.nth(0)).toContainText("By the bins");
  await expect(s.nth(0).locator("a")).toHaveText("Open in Google Maps");
  await expect(s.nth(0).locator("a")).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("24.531,54.432"));
  await expect(s.nth(0)).not.toContainText("your report");
  await expect(s.nth(1)).toContainText("your report");
  await expect(s.nth(2)).toContainText("Sleeping in the shade");
  await expect(s.nth(2)).not.toContainText("your report");               // reporter erased: never guessed as mine
  await expect(page.locator("#ptSight")).toHaveText("Report seeing Ginger");
  await expect(page.locator("#ptWaText")).toContainText("Ginger (Cat), one of our community's animals:");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-stray.png", fullPage: true });
  await page.goto("pets/?pet=" + ID(5));
  await expect(page.locator("h1")).toHaveText("Biscuit");
  await expect(page.locator("#ptSight")).toHaveCount(0);
  await expect(page.locator("#ptShare")).toHaveCount(0);
});

test("My Pets: add (exact fields), then edit, then remove; the pet opens after adding", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?tab=mine" });
  await expect(page.locator("#ptMine b")).toHaveText(["Mochi"]);
  await page.locator("#ptAdd").click();
  await expect(page.locator("h1")).toHaveText("Add a Pet");
  await expect(page.locator("#ptForm")).toContainText("Neighbors see your pet with your home (Villa 12 · Ain Al Maha)");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-add.png", fullPage: true });
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Give your pet a name.");
  expect(named(calls, "jc_pet_save")).toEqual([]);
  await page.locator("#ptName").fill("  Pepper ");
  await page.locator('[data-sp="dog"]').click();
  await expect(page.locator('[data-sp="dog"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-sp="cat"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator("#ptDescIn").fill("Black lab, red collar");
  await page.locator("#ptChipIn").check();
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Pepper was added.");
  expect(lastCall(calls, "jc_pet_save").args).toEqual({ p_pet: null,
    p_fields: { species: "dog", name: "Pepper", description: "Black lab, red collar", wanderer: false, microchipped: true } });
  await expect(page.locator("h1")).toHaveText("Pepper");
  await expect(page.locator("#ptFacts")).toContainText("Home 12 · Ain Al Maha");
  const id = new URL(page.url()).searchParams.get("pet");
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptName")).toHaveValue("Pepper");
  await page.locator("#ptWand").check();
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(lastCall(calls, "jc_pet_save").args).toEqual({ p_pet: id,
    p_fields: { species: "dog", name: "Pepper", description: "Black lab, red collar", wanderer: true, microchipped: true } });
  await expect(page.locator("#ptArchive")).toHaveCount(0);               // not on the pet page — it's in Edit, away from the alarm
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptArchive")).toHaveText("Remove Pepper from the directory");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-edit.png", fullPage: true });
  page.once("dialog", (d) => { expect(d.message()).toBe("Remove Pepper from the directory? This can't be undone."); d.accept(); });
  await page.locator("#ptArchive").click();
  await expect(page.locator("#msg")).toHaveText("Pepper was removed from the directory.");
  expect(lastCall(calls, "jc_pet_archive").args).toEqual({ p_pet: id });
  await expect(page.locator("#pttab-mine")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptMine b")).toHaveText(["Mochi"]);
});

test("Remove is only in Edit (never on Add, never on the pet page); the home's type shows once the server sends it", async ({ page }) => {
  const b = backend({ extra: [{ id: ID(8), kind: "owned", species: "dog", name: "Bolt", home: { id: "h8", village: "ain-al-maha", type: "townhouse", building: null, number: "7" } },
                              { id: ID(9), kind: "owned", species: "cat", name: "Zuzu", home: { id: "h9", village: "ain-al-maha", type: "apartment", building: "B2", number: "304" } }] });
  await open(page, b, { q: "?tab=mine" });
  await page.locator("#ptAdd").click();
  await expect(page.locator("#ptSave")).toBeVisible();
  await expect(page.locator("#ptArchive")).toHaveCount(0);
  await page.goto("pets/?pet=" + ID(6));
  await expect(page.locator("#ptEdit")).toHaveText("Edit details");
  await expect(page.locator("#ptOwner .btn")).toHaveText(["Report as missing", "Edit details"]);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-owner-buttons.png", fullPage: true });
  await page.goto("pets/?pet=" + ID(8));
  await expect(page.locator("#ptFacts")).toContainText("Townhouse 7 · Ain Al Maha");
  await page.goto("pets/?pet=" + ID(9));
  await expect(page.locator("#ptFacts")).toContainText("Apt 304, B2 · Ain Al Maha");
});

test("the Edit form says neighbors see my home — no hiding option offered (HH)", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptForm")).toContainText("Neighbors see your pet with your home (Villa 12 · Ain Al Maha).");
  await expect(page.locator("#ptForm")).not.toContainText("hidden");
});

test("review: a shared ?show= belongs to the shared pet only — after Back, the same pet opens on its own default (About)", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(3) + "&tab=strays&show=sightings" });
  await expect(page.locator("#ptpg-sightings")).toHaveAttribute("aria-selected", "true");
  await page.locator("#jcBackBtn").click();
  await page.locator(`[data-open="${ID(3)}"]`).click();
  await expect(page.locator("#ptpg-about")).toHaveAttribute("aria-selected", "true");
  await page.locator("#ptpg-about").click();
  expect(new URL(page.url()).search).toBe("?pet=" + ID(3) + "&tab=strays&show=about");   // a chosen tab (and the list tab to return to) kept for a reload
});

test("missing switch: one call (no show-home step — HH); the alarm is up; Found takes it down", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("#ptFacts")).toContainText("Home 12 · Ain Al Maha");
  await page.locator("#ptMiss").click();
  await expect(page.locator("#ptMissShow")).toHaveCount(0);
  await expect(page.locator("#ptEdit")).toHaveCount(0);                    // nothing else beside the red button
  await expect(page.locator("#ptArchive")).toHaveCount(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-miss-sheet.png", fullPage: true });
  await page.locator("#ptMissNote").fill("Last seen at the playground, 8 am");
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#msg")).toHaveText("Mochi is now listed as missing. Share the alert below.");
  await expect(page.locator("#ptpg-sightings")).toHaveAttribute("aria-selected", "true");   // the share is on this tab
  await expect(page.locator("#ptAlarm #ptFound")).toBeVisible();          // "is back home" sits in the alarm, on every tab
  expect(lastCall(calls, "jc_pet_missing_set").args).toEqual({ p_pet: ID(6), p_missing: true, p_note: "Last seen at the playground, 8 am" });
  expect(named(calls, "jc_pet_missing_home_set")).toEqual([]);
  await expect(page.locator("#ptAlarm")).toContainText("Last seen: Last seen at the playground, 8 am");
  await expect(page.locator("#ptShowHome")).toHaveCount(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-missing-mine.png", fullPage: true });
  await expect(page.locator("#ptWaText")).toContainText("Missing: Mochi (Cat) from Home 12 · Ain Al Maha.");   // my own share carries my home
  await expect(page.locator("#ptSightings")).toHaveText("No sightings yet.");   // my own pet: the server sends them
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptFound").click();
  await expect(page.locator("#msg")).toHaveText("Great news. Mochi is no longer listed as missing.");
  expect(lastCall(calls, "jc_pet_missing_set").args).toEqual({ p_pet: ID(6), p_missing: false, p_note: null });
  await expect(page.locator("#ptAlarm")).toHaveCount(0);
  await expect(page.locator("#ptMiss")).toBeVisible();
});

for (const [code, text] of [
  ["TOO_MANY_SIGHTINGS", "You've sent a lot of sightings today. Thanks, that's enough for now."],
  ["SIGHTINGS_CLOSED", "Sightings are closed for this animal now."],
]) {
  test(`sighting refused (${code}): said in words`, async ({ page }) => {
    const b = backend({ sightError: code });
    await open(page, b, { q: "?pet=" + ID(3) + "&show=sightings" });
    await page.locator("#ptSight").click();
    await page.locator("#ptSightNote").fill("x");
    await page.locator("#ptSightGo").click();
    await expect(page.locator("#msg")).toHaveText(text);
  });
}

test("no home yet: My Pets asks to claim one, no Add; a deep link to a pet that's gone lands on the list with a message", async ({ page }) => {
  const b = backend({ me: MEMBER_NO_HOME });
  await open(page, b, { q: "?tab=mine" });
  await expect(page.locator("#ptNoHome")).toHaveText("Claim your home first to add your pets.");
  await expect(page.locator("#ptAdd")).toHaveCount(0);
  await page.goto("pets/?pet=" + ID(9));
  await expect(page.locator("#msg")).toHaveText("That pet isn't listed any more.");
  await expect(page.locator("#ptMissing")).toBeVisible();
});

test("a shared pet link opened while signed out comes back to that pet after signing in (and nothing looser is accepted)", async ({ page }) => {
  const b = backend();
  await page.clock.install({ time: NOW });
  await stubBackend(page, { rpc: b.rpc });
  await page.goto("pets/?pet=" + ID(3));
  await expect(page).toHaveURL(/\/account\/\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("../pets/?pet=" + ID(3));
  await page.locator("#email").fill("a@example.com");
  await page.locator("#password").fill("correct-horse");
  await page.locator("#go").click();
  await expect(page).toHaveURL(new RegExp("/pets/\\?pet=" + ID(3) + "$"));
  await expect(page.locator("h1")).toHaveText("Ginger");
  expect(await page.evaluate(() => [jcSafeNext("../pets/?pet=22222222-bbbb-4bbb-8bbb-000000000003&x=1"),
    jcSafeNext("../pets/?pet=javascript:1"), jcSafeNext("../pets/?tab=mine")])).toEqual(["../", "../", "../"]);
});

test("a late list answer after Remove never puts its message on the pet opened meanwhile (review M1)", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("h1")).toHaveText("Mochi");
  await page.locator("#ptEdit").click();
  const g = gate(); b.st.hold.jc_pets_list = g.p;
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptArchive").click();
  await expect(page.locator("#pttab-mine")).toBeVisible();                // the list, still loading
  await page.locator("#jcBackBtn").count();                               // (no back button on the list)
  await page.goto("pets/?pet=" + ID(3));                                  // a different pet, opened before the list lands
  await expect(page.locator("h1")).toHaveText("Ginger");
  g.open();
  await page.waitForTimeout(300);
  await expect(page.locator("#msg")).toHaveText("");
});

test("in-page: list still loading, a pet opened → the late list answer stays off the pet page (review M1)", async ({ page }) => {
  const b = backend();
  await open(page, b);
  await expect(page.locator("#ptList")).toBeVisible();
  await page.locator('[data-open="' + ID(6) + '"]').click();
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptArchive")).toBeVisible();
  const g = gate(); b.st.hold.jc_pets_list = g.p;
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptArchive").click();
  await expect(page.locator("#pttab-mine")).toBeVisible();                // Remove done: the list view, waiting for the held answer
  await expect(page.locator("#ptArchive")).toHaveCount(0);
  await page.evaluate((id) => openPet(id), ID(3));                        // a pet opened in-page before the list lands
  await expect(page.locator("h1")).toHaveText("Ginger");
  g.open();
  await page.waitForTimeout(400);
  await expect(page.locator("h1")).toHaveText("Ginger");
  await expect(page.locator("#msg")).not.toHaveText("Mochi was removed from the directory.");
});

test("a fresh read closes a sheet opened on the old state (review M3)", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("h1")).toHaveText("Mochi");
  await page.locator("#ptMiss").click();
  const g = gate(); b.st.hold.jc_pet_get = g.p;
  await page.locator("#ptMissGo").click();                                 // the alarm is set; the re-read is slow
  await expect.poll(() => b.st.pets.find((x) => x.id === ID(6)).missing).toBe(true);
  await page.locator("#ptSheetKeep").click();                             // closed while the old (not-missing) state is on screen
  await expect(page.locator("#ptMiss")).toBeVisible();
  await page.locator("#ptMiss").click();                                  // …so the sheet can be opened again on it
  await expect(page.locator("#ptMissNote")).toBeVisible();
  g.open();
  await expect(page.locator("#ptFound")).toBeVisible();                   // the fresh read: missing, so "Found" — and no stale sheet
  await expect(page.locator("#ptMissNote")).toHaveCount(0);
});

for (const late of ["the pet", "NOT_FOUND"]) {
  test("Edit opened while the pet re-reads: a late answer (" + late + ") never yanks the form away (review M1)", async ({ page }) => {
    const o = {};
    const b = backend(o);
    await open(page, b, { q: "?pet=" + ID(6) });
    await expect(page.locator("h1")).toHaveText("Mochi");
    await page.locator("#ptMiss").click();
    const g = gate(); b.st.hold.jc_pet_get = g.p;
    await page.locator("#ptMissGo").click();
    await expect.poll(() => b.st.pets.find((x) => x.id === ID(6)).missing).toBe(true);
    await page.locator("#ptSheetKeep").click();
    await page.locator("#ptEdit").click();
    await expect(page.locator("#ptName")).toHaveValue("Mochi");
    if (late === "NOT_FOUND") o.getError = "NOT_FOUND";
    g.open();
    await page.waitForTimeout(400);
    await expect(page.locator("#ptName")).toHaveValue("Mochi");          // still on the form
    await expect(page.locator("#ptSave")).toBeVisible();
    await expect(page.locator("#msg")).toHaveText("");                    // and no pet-page message on it
  });
}

test("Back is ignored while a pet-page write is in flight", async ({ page }) => {
  const b = backend();
  await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("h1")).toHaveText("Mochi");
  await page.locator("#ptMiss").click();
  const g = gate(); b.st.hold.jc_pet_missing_set = g.p;
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#ptMissGo")).toBeDisabled();
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("h1")).toHaveText("Mochi");                  // still on the pet page
  g.open();
  await expect(page.locator("#ptFound")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Mochi");
});

test("a language switch while Save is in flight keeps Save disabled (review M2)", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?tab=mine" });
  await page.locator("#ptAdd").click();
  await page.locator("#ptName").fill("Pepper");
  const g = gate(); b.st.hold.jc_pet_save = g.p;
  await page.locator("#ptSave").click();
  await expect(page.locator("#ptSave")).toBeDisabled();
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#ptSave")).toBeDisabled();                   // redrawn, still locked
  await expect(page.locator("#ptName")).toHaveValue("Pepper");
  g.open();
  await expect(page.locator("h1")).toHaveText("Pepper");
  expect(named(calls, "jc_pet_save")).toHaveLength(1);
});

test("My Home links to My Pets while Pets is open", async ({ page }) => {
  const b = backend();
  await open(page, b);
  await page.goto("home/");
  await expect(page.locator("#toPets")).toHaveText("My Pets");
  await page.locator("#toPets").click();
  await expect(page.locator("#pttab-mine")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptMine b")).toHaveText(["Mochi"]);
});

test("Arabic + a renamed section: title and help follow the community's name; a half-typed sighting survives the switch", async ({ page }) => {
  const labels = { pets: { name: { en: "Paws", ar: "مخالب" }, title: { en: "Pets of Jubail", ar: "حيوانات الجبيل الأليفة" } } };
  const b = backend({ labels });
  await open(page, b, { q: "?pet=" + ID(3) + "&show=sightings" });
  await page.locator("#ptSight").click();
  await page.locator("#ptSightNote").fill("draft note");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#ptSightNote")).toHaveValue("draft note");
  await expect(page.locator("#ptSightGo")).toHaveText("أرسل المشاهدة");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-ar-sight.png", fullPage: true });
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#view h1")).toHaveText("حيوانات الجبيل الأليفة");
  await expect(page).toHaveTitle(/^حيوانات الجبيل الأليفة — /);
  await page.locator("#jcHelpBtn").click();
  await expect(page.locator("#jcHelp h2")).toHaveText("مخالب");
});

test("axe: list, a stray's page and the edit form have no violations", async ({ page }) => {
  const b = backend();
  await open(page, b);
  await expect(page.locator("#ptList")).toBeVisible();
  const scan = async () => (await new AxeBuilder({ page }).disableRules(["region"]).analyze()).violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "));
  expect(await scan()).toEqual([]);
  await page.locator("#pttab-strays").click();
  await page.locator(`[data-open="${ID(3)}"]`).click();
  await expect(page.locator("#ptCare")).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.goto("pets/?tab=mine");
  await page.locator("#ptAdd").click();
  await expect(page.locator("#ptForm")).toBeVisible();
  expect(await scan()).toEqual([]);
});

// ---- R5b-2b-2b: the Map tab, the small maps, the pin map's fallback ----
const BOLT = XID("c1");
const boltBackend = (extra = {}) => backend({ extra: [Object.assign({ id: BOLT, kind: "owned", species: "dog", name: "Bolt", home: V40, missing: true,
  missing_since: "2026-11-07T10:00:00Z", sightings: [
    { id: 61, note: "Running past the school", lat: 24.531, lng: 54.432, seen_at: "2026-11-11T06:10:00Z", by_me: false },   // 20 min ago
    { id: 62, note: null, lat: null, lng: null, seen_at: "2026-11-10T20:00:00Z", by_me: false },                           // no location
    { id: 63, note: "Near the marina", lat: 24.532, lng: 54.433, seen_at: "2026-11-10T08:00:00Z", by_me: false },          // within 48 h
    { id: 64, note: "Old one", lat: 24.533, lng: 54.434, seen_at: "2026-11-08T08:00:00Z", by_me: false },                  // older: faded
  ] }, extra)] });

test("missing pet, Map tab: newest big with 'Latest · 20 min ago', within 48 h normal, older faded; no lines, no home pin; popups say when", async ({ page }) => {
  await open(page, boltBackend(), { q: "?pet=" + BOLT });
  await expect(page.locator('[role="tab"]')).toHaveText(["About", "Sightings (4)", "Map"]);
  await page.locator("#ptpg-map").click();
  expect(new URL(page.url()).search).toBe("?pet=" + BOLT + "&show=map");
  await expect(page.locator("#ptpmap")).toHaveAttribute("aria-label", "Map of where Bolt was seen");
  await expect(page.locator("#ptpmap path.leaflet-interactive")).toHaveCount(3);          // the 3 with a location; nothing else
  await expect(page.locator("#ptpmap path.ptlatest")).toHaveCount(1);
  await expect(page.locator("#ptpmap path.ptrecent")).toHaveCount(1);
  await expect(page.locator("#ptpmap path.ptold")).toHaveCount(1);
  await expect(page.locator("#ptpmap polyline, #ptpmap .ptterr")).toHaveCount(0);
  expect(Number(await page.locator("#ptpmap path.ptold").getAttribute("fill-opacity"))).toBeLessThan(0.5);
  await expect(page.locator("#ptpmap .bklabel")).toHaveText("Latest · 20 min ago");
  await expect(page.locator("#ptMapKey")).toHaveText("The big dot is the latest sighting. Faded dots are older than 2 days.");
  await expect(page.locator("#ptAlarm")).toBeVisible();                                   // the alarm stays on every tab
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-map-missing.png", fullPage: true });
  await tapWhenStill(page, page.locator("#ptpmap path.ptlatest"));
  await expect(page.locator(".leaflet-popup")).toContainText("Running past the school");
  await expect(page.locator(".leaflet-popup .popacts a")).toHaveAttribute("href", /destination=24\.531%2C54\.432/);
  // Sightings: a small map on each one with a location, the Google link kept
  await page.locator("#ptpg-sightings").click();
  await expect(page.locator("#ptSightings .ptmini")).toHaveCount(3);
  await expect(page.locator("#ptSightings .ptmini").first()).toHaveClass(/leaflet-container/);   // built once in view
  await expect(page.locator("#ptSightings .ptmini").first()).toHaveAttribute("role", "img");
  await expect(page.locator("#ptSightings li").nth(1).locator(".ptmini")).toHaveCount(0);       // no location, no map
});

test("Map tab with nothing to place says so; a stray's territory spot is a dashed ring; at most 10 small maps (the rest keep the link)", async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 200 + i, note: "s" + i, lat: 24.53 + i / 1000, lng: 54.43, seen_at: new Date(NOW - (i + 1) * 3600e3).toISOString(), by_me: false }));
  const b = backend({ extra: [
    { id: XID("d1"), kind: "stray", species: "cat", name: "Smudge", care_state: "needs_help", territory: "The park", territory_lat: 24.535, territory_lng: 54.435 },
    { id: XID("d2"), kind: "stray", species: "dog", name: "Lots", care_state: "under_care", sightings: many },
  ] });
  await open(page, b, { q: "?pet=" + ID(2) + "&show=map" });                 // Luna: missing, nothing with a location
  await expect(page.locator("#ptMapNone")).toHaveText("No sightings of Luna with a location yet.");
  await expect(page.locator("#ptpmap")).toHaveCount(0);
  await page.goto("pets/?pet=" + XID("d1") + "&show=map");
  await expect(page.locator("#ptpmap .ptterr")).toHaveCount(1);
  await expect(page.locator("#ptMapKey")).toContainText("The dashed ring is its usual spot.");
  await page.goto("pets/?pet=" + XID("d2") + "&show=sightings");
  await expect(page.locator("#ptSightings li")).toHaveCount(12);
  await expect(page.locator("#ptSightings .ptmini")).toHaveCount(10);
  await expect(page.locator("#ptSightings li").nth(11).locator("a")).toHaveText("Open in Google Maps");
  await expect(page.locator("#ptSightings li").nth(11).locator(".ptmini")).toHaveCount(0);
});

test("review: small maps are lazy (only near the screen), the server's order isn't trusted, and a redraw leaves no stray maps", async ({ page }) => {
  // 12 located sightings sent OLDEST first: the page still puts the newest on top
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 300 + i, note: "s" + i, lat: 24.53 + i / 1000, lng: 54.43, seen_at: new Date(NOW - (12 - i) * 3600e3).toISOString(), by_me: false }));
  const b = backend({ extra: [{ id: XID("f1"), kind: "stray", species: "dog", name: "Lots", care_state: "under_care", sightings: many }] });
  await open(page, b, { q: "?pet=" + XID("f1") + "&show=sightings" });
  await expect(page.locator("#ptSightings li").first()).toContainText("s11");
  await expect(page.locator("#ptSightings .ptmini").first()).toHaveClass(/leaflet-container/);
  await expect(page.locator("#ptSightings .ptmini").nth(9)).not.toHaveClass(/leaflet-container/);    // far below: not built yet
  await page.locator("#ptSightings .ptmini").nth(9).scrollIntoViewIfNeeded();
  await expect(page.locator("#ptSightings .ptmini").nth(9)).toHaveClass(/leaflet-container/);
  const built = await page.locator(".leaflet-container").count();
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect.poll(() => page.locator(".leaflet-container").count()).toBeLessThanOrEqual(built);   // rebuilt, never piled up
  await page.locator("#ptpg-map").click();
  await expect(page.locator(".leaflet-container")).toHaveCount(1);                                // only the Map tab's map
});

test("review: Cancel then reopen the pin map — the first, cancelled locate failing late never rewrites the second", async ({ page }) => {
  await page.addInitScript(() => {
    window.__cbs = [];
    navigator.geolocation.getCurrentPosition = (ok, bad) => { window.__cbs.push({ ok, bad }); };
  });
  await open(page, backend(), { q: "?pet=" + ID(3) + "&show=sightings" });
  await page.locator("#ptSight").click();
  await page.locator("#ptPosAdd").click();
  await page.locator("#ptPickCancel").click();
  await page.locator("#ptPosAdd").click();
  await page.evaluate(() => window.__cbs[1].ok({ coords: { latitude: 24.5312345, longitude: 54.4329876 } }));
  await expect(page.locator("#ptPickHelp")).toHaveText("Move the map so the ring is where you saw Ginger.");
  await page.evaluate(() => window.__cbs[0].bad({ code: 2 }));                 // the cancelled one, late
  await expect(page.locator("#ptPickHelp")).toHaveText("Move the map so the ring is where you saw Ginger.");
  await expect(page.locator("#ptPickOk")).toBeEnabled();
});

test("Add Location Pin: asks for a fresh fix; can't find me → the community's centre, said plainly; the pin sent is where the ring is", async ({ page }) => {
  await page.addInitScript(() => {
    window.__geo = [];
    navigator.geolocation.getCurrentPosition = (ok, bad, o) => { window.__geo.push(o); setTimeout(() => bad({ code: 2 }), 0); };
  });
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(3) + "&show=sightings" });
  await page.locator("#ptSight").click();
  await page.locator("#ptPosAdd").click();
  await expect(page.locator("#ptPickHelp")).toHaveText("Couldn't find where you are, so the map shows the community's centre. Move it so the ring is where you saw Ginger.");
  expect((await page.evaluate(() => window.__geo))[0]).toMatchObject({ maximumAge: 0, enableHighAccuracy: true });   // never an old fix
  await expect(page.locator("#msg")).toHaveText("");                       // not an error: the map is still usable
  await expect(page.locator("#ptPickOk")).toBeDisabled();                  // never the centre by accident (security L2)
  await page.evaluate(() => map.setView([24.5355555, 54.4344444], 18, { animate: false }));   // the person moves the map
  await expect(page.locator("#ptPickOk")).toBeEnabled();
  await page.locator("#ptPickOk").click();
  await page.locator("#ptSightGo").click();
  await expect(page.locator("#msg")).toHaveText("Thanks. Your sighting was sent.");
  expect(lastCall(calls, "jc_pet_sighting_add").args).toEqual({ p_pet: ID(3), p_note: null, p_lat: 24.53556, p_lng: 54.43444 });
});

test("Arabic: the pin map keeps its place and the half-typed note across a language switch", async ({ page }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (ok, bad) => setTimeout(() => bad({ code: 1 }), 0); });
  await open(page, backend(), { q: "?pet=" + ID(3) + "&show=sightings" });
  await page.locator("#ptSight").click();
  await page.locator("#ptSightNote").fill("draft");
  await page.locator("#ptPosAdd").click();
  await expect(page.locator("#ptPickHelp")).toContainText("community's centre");
  await page.evaluate(() => map.setView([24.5355555, 54.4344444], 18, { animate: false }));
  await page.locator("#langBtn").click();
  await expect(page.locator("#ptPickOk")).toHaveText("استخدم هذا المكان");
  await expect(page.locator("#ptSightNote")).toHaveValue("draft");
  expect(await page.evaluate(() => [map.getCenter().lat, map.getCenter().lng].map((x) => Math.round(x * 1e5) / 1e5))).toEqual([24.53556, 54.43444]);
});

for (const lang of ["en", "ar"]) {
  test(`axe ${lang}: the pet page — seen-out box, Sightings with the pin map open, small maps, the Map tab — no violations`, async ({ page }) => {
    const b = boltBackend();
    b.st.pets.push(Object.assign({}, b.st.pets[0], { id: XID("e1"), name: "Pepper", home: MINE_HOME, missing: false, missing_since: null,
      last_seen_at: "2026-11-11T04:30:00Z", sightings: [{ id: 70, note: "By the canal", lat: 24.531, lng: 54.432, seen_at: "2026-11-11T04:30:00Z", by_me: false }] }));
    await open(page, b, { lang, q: "?pet=" + XID("e1") });
    const scan = async () => (await new AxeBuilder({ page }).disableRules(["region"]).analyze()).violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "));
    await expect(page.locator("#ptSeenOut")).toBeVisible();
    expect(await scan()).toEqual([]);
    await page.goto("pets/?pet=" + BOLT + "&show=sightings");
    await expect(page.locator("#ptSightings .ptmini").first()).toHaveClass(/leaflet-container/);
    await page.locator("#ptSight").click();
    await page.locator("#ptPosAdd").click();
    await expect(page.locator("#ptPick")).toBeVisible();
    expect(await scan()).toEqual([]);
    await page.locator("#ptPickCancel").click();
    await page.locator("#ptpg-map").click();
    await expect(page.locator("#ptpmap path.leaflet-interactive")).toHaveCount(3);
    expect(await scan()).toEqual([]);
  });
}

// ---- R5c: photos ----
// a camera-sized JPEG made in the page (2000×1500): what a phone hands the file picker
async function bigJpeg(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 2000; c.height = 1500;
    const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 2000, 1500);
    gr.addColorStop(0, "#c58b4b"); gr.addColorStop(1, "#2d5a3d");
    g.fillStyle = gr; g.fillRect(0, 0, 2000, 1500);
    g.fillStyle = "#fff"; g.font = "200px sans-serif"; g.fillText("Rex", 600, 800);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  return { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}
// width × height from a JPEG's SOF marker
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const loaded = (loc) => loc.evaluate((s) => !!(s.classList.contains("has") && s.querySelector("img") && s.querySelector("img").naturalWidth > 0));

test("R5c: add a pet with a photo — shrunk to 1280 px JPEG, begin → upload at the server's path → commit, shown on the page", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?tab=mine" });
  await page.locator("#ptAdd").click();
  await expect(page.locator("#ptPhotoPick")).toHaveText("Add Photo");
  await page.locator("#ptName").fill("Pepper");
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await expect(page.locator("#ptPhotoHelp")).toHaveText("Photo ready — it's added when you save.");
  if (process.env.SHOT_DIR) await page.locator("#ptPhotoBox").screenshot({ path: process.env.SHOT_DIR + "/pet-edit-photo.png" });
  await expect(page.locator("#ptPhotoPick")).toHaveText("Change Photo");
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);     // nothing leaves before Save
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Pepper was added.");
  const order = calls.filter((c) => /^jc_pet_(save|photo_)/.test(c.name) || c.name === "upload").map((c) => c.name);
  expect(order).toEqual(["jc_pet_save", "jc_pet_photo_begin", "upload", "jc_pet_photo_commit"]);
  expect(lastCall(calls, "jc_pet_photo_begin").args).toEqual({ p_pet: "33333333-cccc-4ccc-8ccc-000000000001", p_ext: "jpg" });
  const up = lastCall(calls, "upload").args;
  expect(up.bucket).toBe("pet-photos");
  expect(up.path).toBe("jubail/33333333-cccc-4ccc-8ccc-000000000001/r2.jpg");          // exactly the server's path
  expect(up.type).toBe("image/jpeg");
  expect(up.upsert).toBe("false");
  expect(up.jpeg).toBe(true);
  expect(up.size).toBeGreaterThan(1024);
  expect(up.size).toBeLessThan(2000000);
  expect(jpegSize(up.buf)).toEqual({ w: 1280, h: 960 });
  const hero = page.locator(".pthero .ptph[data-photo]");
  await expect.poll(() => loaded(hero)).toBe(true);                                     // CSP lets the signed URL load
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pet-page-photo.png" });
});

test("R5c: the list signs every photo in one call; a photo that won't load leaves the paw; no photo = the paw", async ({ page }) => {
  const b = backend({ broken: ["jubail/x/luna.jpg"] });
  b.st.pets.find((p) => p.name === "Rex").photo_path = "jubail/x/rex.jpg";
  b.st.pets.find((p) => p.name === "Luna").photo_path = "jubail/x/luna.jpg";
  const { calls } = await open(page, b);
  const rex = page.locator(`li[data-pet="${ID(1)}"] .ptph[data-photo]`);
  await expect.poll(() => loaded(rex)).toBe(true);
  const signs = calls.filter((c) => c.name === "sign");                        // one batch for the whole list
  expect(signs[0].args.paths.sort()).toEqual(["jubail/x/luna.jpg", "jubail/x/rex.jpg"]);
  expect(signs[0].args.expiresIn).toBe(3600);
  const luna = page.locator(`li[data-pet="${ID(2)}"] .ptph[data-photo]`);
  // Luna's photo fails → signed once more (review: a dead URL gets one fresh signing), then the paw stays — no loop
  await expect.poll(() => calls.filter((c) => c.name === "sign").length).toBe(2);
  expect(calls.filter((c) => c.name === "sign")[1].args.paths).toEqual(["jubail/x/luna.jpg"]);
  await expect.poll(() => calls.filter((c) => c.name === "image" && c.args.path === "jubail/x/luna.jpg").length).toBe(2);
  await page.waitForTimeout(300);
  expect(calls.filter((c) => c.name === "sign")).toHaveLength(2);
  await expect(luna.locator("img")).toHaveCount(0);
  await expect(luna.locator("svg")).toBeVisible();
  await expect(page.locator(`li[data-pet="${ID(4)}"] .ptph[data-photo]`)).toHaveCount(0);           // no photo: the plain paw
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pets-list-photos.png" });
  await page.locator(`[data-open="${ID(1)}"]`).click();                                  // the pet page reuses the signed URL
  await expect.poll(() => loaded(page.locator(".pthero .ptph[data-photo]"))).toBe(true);
  expect(calls.filter((c) => c.name === "sign")).toHaveLength(2);
});

test("R5c: the upload fails → the details are still saved and it says the photo didn't go up", async ({ page }) => {
  const b = backend({ uploadFail: true });
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Mochi is saved, but the photo didn't upload: The upload didn't go through. Check your connection. Try again from Edit details.");
  await expect(page.locator("#msg")).toHaveClass(/err/);
  expect(named(calls, "jc_pet_photo_commit")).toHaveLength(0);
  expect(named(calls, "jc_pet_save")).toHaveLength(1);
});

test("R5c: a household member mid-upload (PHOTO_PENDING) is said in words", async ({ page }) => {
  const b = backend({ beginError: "PHOTO_PENDING" });
  await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toContainText("Someone else in your home is adding a photo right now.");
});

test("R5c: a file that isn't a readable image is refused on the phone — nothing sent", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles({ name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a picture") });
  await expect(page.locator("#msg")).toHaveText("That photo couldn't be read. Try another one.");
  await expect(page.locator("#ptPhotoNew")).toHaveCount(0);
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);
});

test("R5c: the picked photo survives a language switch; Arabic labels", async ({ page }) => {
  const b = backend();
  b.st.pets.find((p) => p.name === "Mochi").photo_path = "jubail/x/mochi.jpg";
  await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptPhotoPick")).toHaveText("Change Photo");                // already has one
  await expect.poll(() => loaded(page.locator("#ptPhotoBox .ptph.big"))).toBe(true);
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await page.locator("#langBtn").click();
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await expect(page.locator("#ptPhotoPick")).toHaveText("تغيير الصورة");
  await expect(page.locator("#ptPhotoHelp")).toHaveText("الصورة جاهزة — تُضاف عند الحفظ.");
});

test("R5c: an image that comes out (near) blank after shrinking is refused — never uploaded", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_1 });   // decodes, 1×1
  await expect(page.locator("#msg")).toHaveText("That photo couldn't be read. Try another one.");
  await expect(page.locator("#ptPhotoNew")).toHaveCount(0);
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);
});

test("R5c review: a page left open past the hour re-signs its photos instead of keeping dead links", async ({ page }) => {
  const b = backend();
  b.st.pets.find((p) => p.name === "Rex").photo_path = "jubail/x/rex.jpg";
  const { calls } = await open(page, b);
  await expect.poll(() => loaded(page.locator(`li[data-pet="${ID(1)}"] .ptph[data-photo]`))).toBe(true);
  expect(calls.filter((c) => c.name === "sign")).toHaveLength(1);
  await page.locator("#ptF-dogs").click();                                    // a redraw inside the hour: reuses it
  expect(calls.filter((c) => c.name === "sign")).toHaveLength(1);
  await page.clock.fastForward("56:00");                                      // past the hour, less the 5-minute margin
  await page.locator("#ptF-all").click();
  await expect.poll(() => calls.filter((c) => c.name === "sign").length).toBe(2);
});

test("R5c review: Save waits while a photo is still being prepared — never saves without it; the last pick wins", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  // hold the phone-side shrink until the test lets it go
  await page.evaluate(() => {
    const real = FileReader.prototype.readAsDataURL;
    window.__shrinkGate = []; FileReader.prototype.readAsDataURL = function(f){ window.__shrinkGate.push(() => real.call(this, f)); };
  });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoHelp")).toHaveText("One moment…");
  await expect(page.locator("#ptSave")).toBeDisabled();
  await page.locator("#ptPhotoIn").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_1 });   // a second pick
  await page.evaluate(() => window.__shrinkGate[1]());                        // the second (refused) one finishes first…
  await expect(page.locator("#msg")).toHaveText("That photo couldn't be read. Try another one.");
  await page.evaluate(() => window.__shrinkGate[0]());                        // …the first, now stale, is ignored
  await page.waitForTimeout(300);
  await expect(page.locator("#ptPhotoNew")).toHaveCount(0);
  await expect(page.locator("#ptSave")).toBeEnabled();
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);
});

test("R5c review: says who sees the photo; a file over 25 MB is refused before it's read", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptPhotoWho")).toHaveText(/^Neighbors in your community can see this photo\. Keep people, faces, house numbers and car plates out of it\./);
  await page.evaluate(() => {                                                   // count reads: a refused file is never read
    const real = FileReader.prototype.readAsDataURL; window.__reads = 0;
    FileReader.prototype.readAsDataURL = function(f){ window.__reads++; return real.call(this, f); };
  });
  await page.locator("#ptPhotoIn").setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(26e6, 0xff) });
  await expect(page.locator("#msg")).toHaveText("That photo couldn't be read. Try another one.");
  expect(await page.evaluate(() => window.__reads)).toBe(0);
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);
});

// ---- R5c-2: remove a photo ----
test("R5c-2: Remove Photo asks first, then takes it down; Back returns to the pet (no photo), the list drops it", async ({ page }) => {
  const b = backend();
  b.st.pets.find((p) => p.name === "Mochi").photo_path = "jubail/x/mochi.jpg";
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await expect.poll(() => loaded(page.locator(".pthero .ptph[data-photo]"))).toBe(true);
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptPhotoRemove")).toHaveText("Remove Photo");
  let asked = null;
  page.once("dialog", async (d) => { asked = d.message(); await d.dismiss(); });
  await page.locator("#ptPhotoRemove").click();
  await expect.poll(() => asked).toBe("Remove Mochi's photo? Neighbors will stop seeing it.");
  expect(named(calls, "jc_pet_photo_remove")).toHaveLength(0);                       // said no: nothing sent
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptPhotoRemove").click();
  await expect(page.locator("#msg")).toHaveText("Mochi's photo is removed.");
  expect(lastCall(calls, "jc_pet_photo_remove").args).toEqual({ p_pet: ID(6) });
  await expect(page.locator("#ptPhotoBox .ptph")).toHaveCount(0);
  await expect(page.locator("#ptPhotoPick")).toHaveText("Add Photo");
  await expect(page.locator("#ptPhotoRemove")).toHaveCount(0);
  await expect(page.locator("#ptPhotoIn")).toBeFocused();                              // focus kept in the photo field
  await page.locator("#jcBackBtn").click();                                              // Back → the same pet, without its photo
  await expect(page.locator(".pthero h1")).toHaveText("Mochi");
  await expect(page.locator(".pthero .ptph[data-photo]")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("?pet=" + ID(6));
  await page.locator("#jcBackBtn").click();                                              // the list re-reads: Mochi without a photo
  await expect(page.locator(`li[data-pet="${ID(6)}"]`)).toBeVisible();
  await expect(page.locator(`li[data-pet="${ID(6)}"] .ptph[data-photo]`)).toHaveCount(0);
  expect(calls.filter((c) => /photo_(begin|commit)/.test(c.name) || c.name === "upload")).toEqual([]);
});

test("R5c-2: already removed elsewhere (NO_PHOTO) reads as done; Drop on a pet with a saved photo keeps it", async ({ page }) => {
  const b = backend();
  b.st.pets.find((p) => p.name === "Mochi").photo_path = "jubail/x/mochi.jpg";
  await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));                // pick, then change your mind
  await expect(page.locator("#ptPhotoRemove")).toHaveCount(0);
  await page.locator("#ptPhotoDrop").click();
  await expect(page.locator("#ptPhotoRemove")).toBeVisible();                          // the saved photo is back in view
  await expect.poll(() => loaded(page.locator("#ptPhotoBox .ptph.big"))).toBe(true);
  b.st.pets.find((p) => p.name === "Mochi").photo_path = null;                       // a household member removed it meanwhile
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptPhotoRemove").click();
  await expect(page.locator("#msg")).toHaveText("Mochi's photo is removed.");
  await expect(page.locator("#msg")).toHaveClass(/ok/);
});

test("R5c-2: a just-picked photo can be dropped before Save; no Remove on a pet without a photo", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptEdit").click();
  await expect(page.locator("#ptPhotoRemove")).toHaveCount(0);
  await page.locator("#ptPhotoIn").setInputFiles(await bigJpeg(page));
  await expect(page.locator("#ptPhotoNew")).toBeVisible();
  await page.locator("#ptPhotoDrop").click();
  await expect(page.locator("#ptPhotoNew")).toHaveCount(0);
  await expect(page.locator("#ptPhotoPick")).toHaveText("Add Photo");
  await page.locator("#ptSave").click();
  await expect(page.locator("#msg")).toHaveText("Saved.");
  expect(calls.filter((c) => c.kind === "storage" || /photo/.test(c.name))).toEqual([]);
});

// ── NF-2: nearest first (docs/plans/nearest-first.md) ──
test("NF-2 Strays: server order from my home pin; Use Where I Am re-sorts the cards (Needs help still first), ≈ distance on each", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 24.5000, longitude: 54.4000 });   // at Sandy's marina
  await open(page, straysBackend(), { q: "?tab=strays" });
  await expect(page.locator("#ptStraysSorted")).toHaveText("Sorted by: nearest your home");
  await expect(page.locator("#ptStrays b")).toHaveText(["Pepper", "Ginger", "Sandy", "Biscuit"]);
  await expect(page.locator(`#ptStrays [data-pet="${ID(3)}"]`)).toContainText("≈ 90 m");          // Ginger's last spot from Villa 12 (≈ 91 m)
  await expect(page.locator(`#ptStrays [data-pet="${ID(8)}"]`)).not.toContainText("≈");           // Pepper: no spot
  await page.locator("#sortHereBtn").click();
  await expect(page.locator("#ptStraysSorted")).toHaveText("Sorted by: nearest where you are now");
  await expect(page.locator("#ptStrays b")).toHaveText(["Pepper", "Sandy", "Ginger", "Biscuit"]);
  await expect(page.locator(`#ptStrays [data-pet="${ID(4)}"]`)).toContainText("≈ 0 m");
  await page.locator("#sortHereBtn").click();                                                       // Use My Home
  await expect(page.locator("#ptStrays b")).toHaveText(["Pepper", "Ginger", "Sandy", "Biscuit"]);
});

test("NF-2 Strays: Find Me on the map re-sorts the cards under it; the map stays (same zoom, the blue dot)", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 24.5000, longitude: 54.4000 });
  await open(page, straysBackend(), { q: "?tab=strays" });
  await expect(page.locator("#ptmap path.leaflet-interactive")).toHaveCount(2);
  const box = await page.locator("#ptmap").evaluate((n) => (n.dataset.mark = "same", "ok"));
  expect(box).toBe("ok");
  await page.locator("#locateBtn").click();
  await expect(page.locator("#ptStraysSorted")).toHaveText("Sorted by: nearest where you are now");
  await expect(page.locator("#ptStrays b")).toHaveText(["Pepper", "Sandy", "Ginger", "Biscuit"]);
  await expect(page.locator("#ptmap")).toHaveAttribute("data-mark", "same");                     // not redrawn
  await expect(page.locator("#ptmap path.leaflet-interactive")).toHaveCount(3);                  // + the blue dot
  // the re-drawn cards still open their pet
  await page.locator(`#ptStrays [data-open="${ID(4)}"]`).click();
  await expect(page).toHaveURL(new RegExp("pet=" + ID(4)));
});

test("NF-2 Pets tab: the owned pets' line is the shared one, with no button (their homes never reach the phone)", async ({ page }) => {
  await open(page, backend(), { q: "?tab=pets" });
  await expect(page.locator("#ptSorted")).toHaveText("Sorted by: nearest your home");
  await expect(page.locator("#sortHereBtn")).toHaveCount(0);
  await page.locator("#jcHelpBtn").click();
  await expect(page.locator("#jcHelp li")).toHaveCount(4);
  await expect(page.locator("#jcHelp")).toContainText("Your location stays on your phone");
});

// ── R5d-1: the way into Organizer Tools → Pets, as on a court's page ──
for (const [scopes, shown] of [[[], false], [["events"], false], [["pets"], true], [["community"], true]]) {
  test(`R5d-1 pet page: Admin ${shown ? "shown" : "hidden"} for admin_scopes [${scopes}] (into Organizer Tools → Pets, that animal)`, async ({ page }) => {
    await open(page, backend({ me: Object.assign({}, MEMBER, { admin_scopes: scopes }) }), { q: "?pet=" + ID(3) });
    await expect(page.locator("h1")).toHaveText("Ginger");
    await expect(page.locator("#ptAdmin")).toHaveCount(shown ? 1 : 0);
    if (shown) await expect(page.locator("#ptAdmin")).toHaveAttribute("href", "../admin/?tab=pets&pet=" + ID(3));
  });
}
