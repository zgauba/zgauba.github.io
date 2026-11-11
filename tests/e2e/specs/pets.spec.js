// R5b-1 — residents' Pets page (server S4 + R5a). Plan: docs/plans/R5-pets.md.
// The stub mirrors the server's privacy rules (jc_pet_card / jc_pet_get, R5a): a home is sent only when it is in
// the directory, or while the pet is missing AND its household opted in; show_home only to the own household;
// sightings only for strays / community animals, the own household and Pets admins; never a reporter.
// The page must render exactly what arrives.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { stubBackend, ok, raise, CONFIG, MEMBER, MEMBER_NO_HOME } = require("./stub");
const { signIn } = require("./backends");

test.use({ timezoneId: "Europe/London" });

const lastCall = (calls, name) => calls.filter((c) => c.name === name).pop();
const named = (calls, name) => calls.filter((c) => c.name === name);
const NOW = Date.parse("2026-11-11T06:30:00Z");          // 10:30 in Dubai
const GROUP = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12";
const ID = (n) => "22222222-bbbb-4bbb-8bbb-00000000000" + n;
const MY_HOME = "h1";                                      // stub.js MEMBER: Villa 12 · Ain Al Maha
const V40 = { id: "h40", village: "seef-al-jubail", building: null, number: "40", hidden: false };
const MINE_HOME = { id: MY_HOME, village: "ain-al-maha", building: null, number: "12", hidden: false };

function backend(opts = {}) {
  const st = {
    enabled: opts.enabled !== false,
    me: opts.me || MEMBER,
    admin: !!opts.admin,
    group: opts.group === undefined ? GROUP : opts.group,
    myHomeHidden: !!opts.myHomeHidden,
    pets: (opts.pets || [
      { id: ID(1), kind: "owned", species: "dog", name: "Rex", home: V40, missing: false },
      { id: ID(2), kind: "owned", species: "cat", name: "Luna", home: V40, missing: true, missing_since: "2026-11-10T15:00:00Z",
        last_seen_note: "Near the beach park", show_home: false, sightings: [] },
      { id: ID(3), kind: "stray", species: "cat", name: "Ginger", care_state: "under_care", territory: "Behind the mosque",
        care: { sterilized: { s: "done", d: "2026-10-01", n: "Clinic A" }, vaccination: { s: "due", d: null, n: null } },
        care_log: [{ kind: "fed", note: "Morning round", at: "2026-11-10T05:00:00Z" }],
        sightings: [{ id: 7, note: "By the bins", lat: 24.531, lng: 54.432, seen_at: "2026-11-10T18:00:00Z", by_me: false },
                    { id: 8, note: null, lat: null, lng: null, seen_at: "2026-11-09T18:00:00Z", by_me: true },
                    // older than 24 h: the nightly job erased the reporter, so by_me is NULL (reporter = me → null), not false
                    { id: 9, note: "Sleeping in the shade", lat: null, lng: null, seen_at: "2026-11-08T12:00:00Z", by_me: null }] },
      { id: ID(4), kind: "stray", species: "dog", name: "Sandy", care_state: "known_fine", territory: "The marina" },
      { id: ID(5), kind: "stray", species: "cat", name: "Biscuit", care_state: "rehomed" },
      { id: ID(6), kind: "owned", species: "cat", name: "Mochi", home: MINE_HOME, missing: false, wanderer: true },
    ].concat(opts.extra || [])).map((p) => Object.assign({ description: null, wanderer: false, microchipped: false, missing: false,
      missing_since: null, last_seen_note: null, care_state: null, photo_path: null, territory: null, territory_lat: null, territory_lng: null,
      care: p.kind === "stray" ? {} : null, care_log: [], sightings: [], show_home: false, status: "active" }, p)),
  };
  let n = 0;
  const homeOf = (p) => (p.home && p.home.id === MY_HOME ? Object.assign({}, p.home, { hidden: st.myHomeHidden }) : p.home);
  const card = (p) => {
    const h = homeOf(p), mine = !!(st.me.home && h && h.id === MY_HOME);
    return { id: p.id, kind: p.kind, species: p.species, name: p.name, description: p.description, wanderer: p.wanderer,
      microchipped: p.microchipped, missing: p.missing, missing_since: p.missing_since, last_seen_note: p.last_seen_note,
      care_state: p.care_state, photo_path: p.photo_path, mine,
      home: h && (!h.hidden || (p.missing && p.show_home)) ? { village: h.village, building: h.building, number: h.number } : null,
      show_home: mine ? p.show_home : null,
      territory: p.territory, territory_lat: p.territory_lat, territory_lng: p.territory_lng, care: p.kind === "stray" ? p.care : null };
  };
  const find = (id) => st.pets.find((p) => p.id === id && p.status === "active");
  const off = () => (st.enabled ? null : raise("MODULE_OFF"));
  // st.hold[name] = a Promise: that RPC answers only once it resolves (a slow network, on demand)
  st.hold = {};
  const held = (name, f) => (a, c) => (st.hold[name] ? st.hold[name].then(() => f(a, c)) : f(a, c));
  const manage = (id) => { const p = find(id); return p && p.kind === "owned" && card(p).mine ? p : null; };
  const rpc = {
    jc_config_get: () => ok(Object.assign({}, CONFIG, { tz: "Asia/Dubai", labels: opts.labels,
      modules: { events: { enabled: false }, bookings: { enabled: false }, pets: { enabled: st.enabled } } })),
    jc_me_get: (a, c) => (c.signedIn ? ok(st.me) : raise("NOT_SIGNED_IN")),
    jc_pets_list: (a) => off() || (a.p_filter !== "all" ? raise("BAD_FILTER")
      : ok(st.pets.filter((p) => p.status === "active").sort((x, y) => (y.missing - x.missing) || x.name.localeCompare(y.name)).map(card))),
    jc_pet_get: (a) => {
      if (off()) return off();
      if (opts.getError) return raise(opts.getError);
      const p = find(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      const c = card(p);
      const see = p.kind === "stray" || c.mine || st.admin;
      return ok(Object.assign(c, { sightings: see ? p.sightings : null, care_log: p.kind === "stray" ? p.care_log : null }));
    },
    jc_pet_save: (a) => {
      if (off()) return off();
      if (!st.me.home) return raise("NO_HOME");
      const f = a.p_fields;
      if (a.p_pet === null) {
        n += 1;
        const p = { id: "33333333-cccc-4ccc-8ccc-00000000000" + n, kind: "owned", home: MINE_HOME, missing: false, missing_since: null, last_seen_note: null, care_state: null,
          photo_path: null, territory: null, territory_lat: null, territory_lng: null, care: null, care_log: [], sightings: [], show_home: false,
          status: "active", description: null, wanderer: false, microchipped: false };
        Object.assign(p, f);
        st.pets.push(p);
        return ok(card(p));
      }
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      Object.assign(p, f);
      return ok(card(p));
    },
    jc_pet_archive: (a) => { const p = manage(a.p_pet); if (!p) return raise("NOT_FOUND"); p.status = "archived"; return ok({ pet_id: p.id, archived: true }); },
    jc_pet_missing_set: (a) => {
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      p.missing = a.p_missing;
      p.missing_since = a.p_missing ? (p.missing_since || "2026-11-11T06:00:00Z") : null;
      p.last_seen_note = a.p_missing ? a.p_note : null;
      if (!a.p_missing) p.show_home = false;                     // found clears the opt-in (R5a)
      return ok(card(p));
    },
    jc_pet_missing_home_set: (a) => {
      if (opts.homeSetError) return raise(opts.homeSetError);
      const p = manage(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      if (!p.missing) return raise("NOT_MISSING");
      p.show_home = a.p_show;
      return ok(card(p));
    },
    jc_pet_sighting_add: (a) => {
      if (opts.sightError) return raise(opts.sightError);
      const p = find(a.p_pet);
      if (!p) return raise("NOT_FOUND");
      if (!(p.missing || (p.kind === "stray" && p.care_state !== "rehomed"))) return raise("SIGHTINGS_CLOSED");
      if ((a.p_lat === null) !== (a.p_lng === null)) return raise("BAD_FIELDS");
      p.sightings.unshift({ id: 100, note: a.p_note, lat: a.p_lat, lng: a.p_lng, seen_at: "2026-11-11T06:30:00Z", by_me: true });
      return ok({ pet_id: p.id, logged: true });
    },
    jc_pets_group_get: () => off() || ok({ link: st.group }),
  };
  for (const k of ["jc_pets_list", "jc_pet_save", "jc_pet_get", "jc_pet_missing_set"]) rpc[k] = held(k, rpc[k]);
  return { st, rpc };
}
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
  const stub = await stubBackend(page, { rpc: b.rpc });
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

test("List: missing on top; filters split strays from community animals; homes only as sent (neutral label, never a guessed Villa)", async ({ page }) => {
  const b = backend({ extra: [{ id: ID(7), kind: "owned", species: "bird", name: "Kiwi", home: { id: "h9", village: "ain-al-maha", building: "B2", number: "304", hidden: true } }] });
  const { calls } = await open(page, b);
  await expect(page.locator('[role="tab"]')).toHaveText(["List", "My Pets"]);
  await expect(page.locator("#ptMissing li")).toHaveCount(1);
  const luna = page.locator(`#ptMissing [data-pet="${ID(2)}"]`);
  await expect(luna).toContainText("Cat · Pet");
  await expect(luna).toContainText("Home 40 · Seef Al Jubail");
  await expect(luna).toContainText("Last seen: Near the beach park");
  await expect(luna.locator(".chip.miss")).toHaveText("Missing");
  expect(lastCall(calls, "jc_pets_list").args).toEqual({ p_filter: "all" });
  // All: everyone except the missing one (it is already on top), A–Z as the server sorts
  await expect(page.locator("#ptList b")).toHaveText(["Biscuit", "Ginger", "Kiwi", "Mochi", "Rex", "Sandy"]);
  // a hidden home: the server sends no home → the card shows none
  expect((await page.locator(`[data-pet="${ID(7)}"]`).innerText()).replace(/\s+/g, " ").trim()).toBe("Kiwi Bird · Pet Details");
  await page.locator("#ptF-strays").click();
  await expect(page.locator("#ptF-strays")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ptList b")).toHaveText(["Biscuit", "Ginger"]);
  await expect(page.locator(`[data-pet="${ID(3)}"]`)).toContainText("Behind the mosque");
  await expect(page.locator(`[data-pet="${ID(3)}"] .chip`)).toHaveText("Under care");
  await page.locator("#ptF-community").click();
  await expect(page.locator("#ptList b")).toHaveText(["Sandy"]);
  await expect(page.locator(`[data-pet="${ID(4)}"]`)).toContainText("Dog · Community animal");
  await page.locator("#ptF-wanderers").click();
  await expect(page.locator("#ptList b")).toHaveText(["Mochi"]);
  await expect(page.locator("#ptMissing li")).toHaveCount(1);              // missing stays on top under every filter
  await expect(page.locator('#tabbar a[data-tab="pets"]')).toHaveAttribute("aria-current", "page");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-list.png", fullPage: true });
});

test("someone else's pet that isn't missing: no sightings, no report button, no owner controls, no share", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(1) });
  await expect(page.locator("h1")).toHaveText("Rex");
  await expect(page.locator("#ptFacts")).toContainText("Home 40 · Seef Al Jubail");
  for (const id of ["#ptSight", "#ptShare", "#ptSightings", "#ptOwner", "#ptMiss", "#ptEdit", "#ptAlarm"]) await expect(page.locator(id)).toHaveCount(0);
  expect(named(calls, "jc_pets_group_get")).toEqual([]);                  // the group link isn't even asked for
  await page.locator("#jcBackBtn").click();
  await expect(page.locator("#ptList")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test.describe("a sighting", () => {
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 24.5312345, longitude: 54.4329876 } });

  test("missing pet: note + location sent exactly; privacy said up front; the WhatsApp message tells the group what was seen", async ({ page }) => {
    const b = backend();
    const { calls } = await open(page, b, { q: "?pet=" + ID(2) });
    await expect(page.locator("#ptAlarm")).toContainText("Luna has been missing since Tue 10 Nov · ⁦19:00⁩");
    await expect(page.locator("#ptAlarm")).toContainText("Last seen: Near the beach park");
    await expect(page.locator("#ptSightings")).toHaveCount(0);           // owned + not mine: the server sends none
    await page.locator("#ptSight").click();
    await expect(page.locator("#ptSightPrivacy")).toHaveText(/never shows who you are\. We delete the record of who sent it within 48 hours, and the sighting itself after 30 days\./);
    await page.locator("#ptSightNote").fill("Under a car on Marsa road");
    await page.locator("#ptPosAdd").click();
    await expect(page.locator("#ptPos")).toContainText("Your current location is added.");
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
    const { calls } = await open(page, b, { q: "?pet=" + ID(3) });
    await page.locator("#ptSight").click();
    await page.locator("#ptSightGo").click();
    await expect(page.locator("#msg")).toHaveText("Add a note or your location first.");
    expect(named(calls, "jc_pet_sighting_add")).toEqual([]);
    await page.locator("#ptPosAdd").click();
    await page.locator("#ptPosClear").click();
    await expect(page.locator("#ptPosAdd")).toBeFocused();
    await page.locator("#ptPosAdd").click();
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
  page.once("dialog", (d) => { expect(d.message()).toBe("Remove Pepper from the directory? This can't be undone."); d.accept(); });
  await page.locator("#ptArchive").click();
  await expect(page.locator("#msg")).toHaveText("Pepper was removed from the directory.");
  expect(lastCall(calls, "jc_pet_archive").args).toEqual({ p_pet: id });
  await expect(page.locator("#pttab-mine")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#ptMine b")).toHaveText(["Mochi"]);
});

test("missing switch, home in the directory: no show-home choice; one call; the alarm is up; Found takes it down", async ({ page }) => {
  const b = backend();
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("#ptFacts")).toContainText("Home 12 · Ain Al Maha");
  await page.locator("#ptMiss").click();
  await expect(page.locator("#ptMissShow")).toHaveCount(0);
  await expect(page.locator("#ptEdit")).toHaveCount(0);                    // nothing else beside the red button
  await expect(page.locator("#ptArchive")).toHaveCount(0);
  await page.locator("#ptMissNote").fill("Last seen at the playground, 8 am");
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#msg")).toHaveText("Mochi is now listed as missing. Share the alert below.");
  expect(lastCall(calls, "jc_pet_missing_set").args).toEqual({ p_pet: ID(6), p_missing: true, p_note: "Last seen at the playground, 8 am" });
  expect(named(calls, "jc_pet_missing_home_set")).toEqual([]);
  await expect(page.locator("#ptAlarm")).toContainText("Last seen: Last seen at the playground, 8 am");
  await expect(page.locator("#ptShowHome")).toHaveCount(0);
  await expect(page.locator("#ptWaText")).toContainText("Missing: Mochi (Cat) from Home 12 · Ain Al Maha.");   // my own share carries my home
  await expect(page.locator("#ptSightings")).toHaveText("No sightings yet.");   // my own pet: the server sends them
  page.once("dialog", (d) => d.accept());
  await page.locator("#ptFound").click();
  await expect(page.locator("#msg")).toHaveText("Great news. Mochi is no longer listed as missing.");
  expect(lastCall(calls, "jc_pet_missing_set").args).toEqual({ p_pet: ID(6), p_missing: false, p_note: null });
  await expect(page.locator("#ptAlarm")).toHaveCount(0);
  await expect(page.locator("#ptMiss")).toBeVisible();
});

test("missing switch, home hidden (Q6): opt-in offered with my home; missing then show-home, in that order; switch off later", async ({ page }) => {
  const b = backend({ myHomeHidden: true });
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await expect(page.locator("#ptFacts")).toContainText("Not shown (your home is hidden from the directory)");
  await page.locator("#ptMiss").click();
  await expect(page.locator("#ptOwner")).toContainText("Show Villa 12 · Ain Al Maha while Mochi is missing");
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-miss-sheet.png", fullPage: true });
  await expect(page.locator("#ptMissShow")).not.toBeChecked();             // never pre-ticked: an opt-in
  await page.locator("#ptMissShow").check();
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#msg")).toHaveText("Mochi is now listed as missing. Share the alert below.");
  const writes = calls.filter((c) => /^jc_pet_missing/.test(c.name)).map((c) => [c.name, c.args]);
  expect(writes).toEqual([["jc_pet_missing_set", { p_pet: ID(6), p_missing: true, p_note: null }],
                          ["jc_pet_missing_home_set", { p_pet: ID(6), p_show: true }]]);
  await expect(page.locator("#ptFacts")).toContainText("Home 12 · Ain Al Maha");    // now sent by the server
  await expect(page.locator("#ptShowHome")).toBeChecked();
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/pt-missing-mine.png", fullPage: true });
  await page.locator("#ptShowHome").uncheck();
  await expect(page.locator("#msg")).toHaveText("Your home is hidden again.");
  expect(lastCall(calls, "jc_pet_missing_home_set").args).toEqual({ p_pet: ID(6), p_show: false });
  await expect(page.locator("#ptFacts")).toContainText("Not shown");
});

test("hidden home, opt-in left unticked: only the missing call — the home stays hidden", async ({ page }) => {
  const b = backend({ myHomeHidden: true });
  const { calls } = await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptMiss").click();
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#ptAlarm")).toBeVisible();
  expect(named(calls, "jc_pet_missing_home_set")).toEqual([]);
  await expect(page.locator("#ptShowHome")).not.toBeChecked();
  await expect(page.locator("#ptFacts")).toContainText("Not shown");
});

test("the show-home step fails: the alarm is still up and the page says the home isn't shown (never silent)", async ({ page }) => {
  const b = backend({ myHomeHidden: true, homeSetError: "NETWORK" });
  await open(page, b, { q: "?pet=" + ID(6) });
  await page.locator("#ptMiss").click();
  await page.locator("#ptMissShow").check();
  await page.locator("#ptMissGo").click();
  await expect(page.locator("#msg")).toHaveText("Your pet is listed as missing, but your home couldn't be shown. Try the switch below.");
  await expect(page.locator("#ptAlarm")).toBeVisible();
  await expect(page.locator("#ptShowHome")).not.toBeChecked();
});

for (const [code, text] of [
  ["TOO_MANY_SIGHTINGS", "You've sent a lot of sightings today. Thanks, that's enough for now."],
  ["SIGHTINGS_CLOSED", "Sightings are closed for this animal now."],
]) {
  test(`sighting refused (${code}): said in words`, async ({ page }) => {
    const b = backend({ sightError: code });
    await open(page, b, { q: "?pet=" + ID(3) });
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
  await open(page, b, { q: "?pet=" + ID(3) });
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
  await page.locator(`[data-open="${ID(3)}"]`).click();
  await expect(page.locator("#ptCare")).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.goto("pets/?tab=mine");
  await page.locator("#ptAdd").click();
  await expect(page.locator("#ptForm")).toBeVisible();
  expect(await scan()).toEqual([]);
});
