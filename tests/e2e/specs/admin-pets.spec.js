// R5d-1 — Organizer Tools → Pets (plan docs/plans/R5d-pets-organizer.md): who sees the tab, the animals A–Z
// (strays first, then the owners' villages A–Z, then name — NF-3), the Archived group, the pets WhatsApp group
// link (members-only, the server's rule said before sending), the jump in from an animal's Admin button.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise, CONFIG } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const ID = (n) => "44444444-dddd-4ddd-8ddd-00000000000" + n;
const PET = (o) => Object.assign({ kind: "owned", species: "cat", description: null, wanderer: false, microchipped: false,
  missing: false, missing_since: null, last_seen_note: null, care_state: null, photo_path: "p/x.jpg", mine: false, home: null,
  territory: null, territory_lat: null, territory_lng: null, care: null, last_seen: null, last_seen_at: null,
  status: "active", created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z", sightings_7d: 0 }, o);
const HOME = (village, number) => ({ village, type: "villa", building: null, number });
// the server's order (status, missing, name) is not the page's: the page sorts
const ANIMALS = () => [
  PET({ id: ID(1), name: "Rex", species: "dog", home: HOME("seef-al-jubail", "40") }),
  PET({ id: ID(2), name: "Luna", home: HOME("ain-al-maha", "7"), missing: true }),
  PET({ id: ID(3), name: "Ginger", kind: "stray", care_state: "needs_help", territory: "Behind the mosque", photo_path: null, sightings_7d: 3 }),
  PET({ id: ID(4), name: "Bella", species: "dog", home: HOME("seef-al-jubail", "12") }),
  PET({ id: ID(5), name: "Archie", kind: "stray", care_state: "known_fine", territory: "The marina" }),
  PET({ id: ID(6), name: "Old Tom", kind: "stray", care_state: "rehomed", status: "archived" }),
  PET({ id: ID(7), name: "Mochi", home: HOME("ain-al-maha", "12") }),
];
const LINK = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12";

function backend(opts = {}) {
  const ab = adminBackend({ scopes: opts.scopes || ["pets"] });
  const st = { list: opts.list || ANIMALS(), link: opts.link === undefined ? LINK : opts.link, sets: [] };
  const pets = () => ab.st.scopes.includes("pets") || ab.st.scopes.includes("community");
  Object.assign(ab.rpc, {
    jc_admin_pets_list: () => (pets() ? ok(st.list) : raise("NOT_ADMIN")),
    jc_pets_group_get: () => (opts.groupOff ? raise(opts.groupOff) : ok({ link: st.link })),
    jc_admin_pets_group_set: (a) => {
      st.sets.push(a.p_link);
      if (opts.setRaises) return raise(opts.setRaises);
      st.link = a.p_link || null;
      return ok({ link: st.link });
    },
  });
  if (opts.petsOn) ab.rpc.jc_config_get = () => ok(Object.assign({}, CONFIG, { modules: Object.assign({}, CONFIG.modules, { pets: { enabled: true } }) }));
  return { ab, st, rpc: ab.rpc };
}
async function openPets(page, b, q) {
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=pets" + (q || ""));
  await expect(page.locator("#paGroup")).toBeVisible();
}
const rowIds = (page, sel) => page.locator(sel + " [data-pet]").evaluateAll((ls) => ls.map((l) => l.dataset.pet));

test("who sees Pets: pets and community admins; courts-only and events-only don't", async ({ page }) => {
  const b = backend({ scopes: ["bookings"] });
  const { calls } = await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=pets");
  await expect(page.locator('[role="tab"]')).toHaveText(["Courts", "Community"]);   // ?tab=pets falls back
  await expect(page.locator("#paGroup")).toHaveCount(0);
  expect(calls.filter((c) => c.name === "jc_admin_pets_list" || c.name === "jc_pets_group_get")).toEqual([]);   // never asked
  b.ab.st.scopes = ["events"];
  await page.goto("admin/?tab=pets");
  await expect(page.locator('[role="tab"]')).toHaveText(["Events", "Community", "Banner"]);
  b.ab.st.scopes = ["pets"];
  await page.goto("admin/?tab=pets");
  await expect(page.locator('[role="tab"]')).toHaveText(["Pets", "Community"]);
  b.ab.st.scopes = ["community"];
  await page.goto("admin/?tab=pets");
  await expect(page.locator('[role="tab"]')).toHaveText(["Events", "Courts", "Pets", "Community", "Banner"]);
  await expect(page.locator("#atab-pets")).toHaveAttribute("aria-selected", "true");
});

test("the animals: strays and community animals first, then villages A–Z, then name; chips; Archived apart, names only", async ({ page }) => {
  await openPets(page, backend());
  await expect(page.locator("#paOff")).toContainText("Pets is switched off for residents");
  await expect(page.locator("#admPanel h2.group")).toHaveText(["Pets WhatsApp group", "Strays and community animals · 2",
    "Ain Al Maha · 2", "Seef Al Jubail · 2", "Archived · 1"]);
  expect(await rowIds(page, "#paList-strays")).toEqual([ID(5), ID(3)]);              // Archie, Ginger
  expect(await rowIds(page, "#paList-ain-al-maha")).toEqual([ID(2), ID(7)]);         // Luna, Mochi
  expect(await rowIds(page, "#paList-seef-al-jubail")).toEqual([ID(4), ID(1)]);      // Bella, Rex
  const ginger = page.locator(`[data-pet="${ID(3)}"]`);
  await expect(ginger.locator(".chip")).toHaveText(["Needs help", "No photo", "Seen 3× this week"]);
  await expect(ginger.locator(".chip.warn")).toHaveText("Needs help");
  await expect(ginger).toContainText("Cat · Stray");
  await expect(ginger).toContainText("Behind the mosque");
  await expect(page.locator(`[data-pet="${ID(2)}"] .chip.miss`)).toHaveText("Missing");
  await expect(page.locator(`[data-pet="${ID(2)}"]`)).toContainText("Villa 7");
  await expect(page.locator(`[data-pet="${ID(2)}"] a`)).toHaveAttribute("href", "../pets/?pet=" + ID(2));
  await expect(page.locator("#paArchived li")).toHaveText(["Old Tom"]);
  await expect(page.locator("#paArchived a, #paArchived button")).toHaveCount(0);   // no restore (Zee Q3)
});

test("Pets on for residents: no switched-off notice; no animals says so", async ({ page }) => {
  await openPets(page, backend({ petsOn: true, list: [] }));
  await expect(page.locator("#paOff")).toHaveCount(0);
  await expect(page.locator("#paNone")).toHaveText("No animals yet.");
});

test("group link: shown; a non-WhatsApp link is refused before sending; saving sends exactly the link; Remove asks first", async ({ page }) => {
  const b = backend({ link: null });
  await openPets(page, b);
  await expect(page.locator("#paLink")).toHaveValue("");
  await expect(page.locator("#paLinkClear")).toHaveCount(0);
  await page.locator("#paLink").fill("https://example.com/AbCdEfGhIjKlMnOpQr12");
  await page.locator("#paLinkSave").click();
  await expect(page.locator("#msg")).toHaveText("That isn't a WhatsApp group invite link. It starts with https://chat.whatsapp.com/");
  expect(b.st.sets).toEqual([]);
  await page.locator("#paLink").fill("  " + LINK + " ");
  await page.locator("#paLinkSave").click();
  await expect(page.locator("#msg")).toHaveText("Group link saved.");
  expect(b.st.sets).toEqual([LINK]);
  await expect(page.locator("#paLink")).toHaveValue(LINK);
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#paLinkClear").click();
  expect(b.st.sets).toEqual([LINK]);                                                // said no: nothing sent
  page.once("dialog", (d) => { expect(d.message()).toContain("Send to someone else"); d.accept(); });
  await page.locator("#paLinkClear").click();
  await expect(page.locator("#msg")).toHaveText("Group link removed.");
  expect(b.st.sets).toEqual([LINK, ""]);
  await expect(page.locator("#paLink")).toHaveValue("");
});

test("group link: the server's BAD_LINK in the Pets words (not the invite-link ones); unreadable while Pets is off says so", async ({ page }) => {
  await openPets(page, backend({ setRaises: "BAD_LINK", groupOff: "MODULE_OFF" }));
  await expect(page.locator("#paGroup .help")).toHaveText("The current link can't be read while Pets is switched off. Saving a new one replaces it.");
  await page.locator("#paLink").fill(LINK);
  await page.locator("#paLinkSave").click();
  await expect(page.locator("#msg")).toHaveText("That isn't a WhatsApp group invite link. It starts with https://chat.whatsapp.com/");
  await expect(page.locator("#paLinkSave")).toBeEnabled();
});

test("an empty Save never clears the link blind (reviews M1): unreadable or none set → asks for one; a link set → the Remove question", async ({ page }) => {
  const b = backend({ groupOff: "NOT_MEMBER" });                                    // a code-only admin with no home
  await openPets(page, b);
  await expect(page.locator("#paGroup .help")).toHaveText("The current link couldn't be read just now. Saving a new one replaces it.");
  await page.locator("#paLinkSave").click();
  await expect(page.locator("#msg")).toHaveText("Paste the group's invite link first. To take the link away, use Remove Link.");
  expect(b.st.sets).toEqual([]);
});

test("an empty Save with a link set asks the Remove question first", async ({ page }) => {
  const b = backend();
  await openPets(page, b);
  await expect(page.locator("#paLink")).toHaveValue(LINK);
  await expect(page.locator("#paLink")).toHaveAttribute("type", "text");            // styled like every input (review M)
  await expect(page.locator("#paLink")).toHaveAttribute("inputmode", "url");
  await page.locator("#paLink").fill("");
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#paLinkSave").click();
  expect(b.st.sets).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await page.locator("#paLinkSave").click();
  await expect(page.locator("#msg")).toHaveText("Group link removed.");
  expect(b.st.sets).toEqual([""]);
});

test("hostile names, territory and link text stay text", async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">"\'';
  await openPets(page, backend({ link: null, list: [PET({ id: ID(1), name: evil, kind: "stray", care_state: "under_care", territory: evil })] }));
  await expect(page.locator(`[data-pet="${ID(1)}"] b`)).toHaveText(evil);
  await expect(page.locator(`[data-pet="${ID(1)}"]`)).toContainText(evil);
  await page.locator("#paLink").fill(evil);
  await page.locator("#paLinkSave").click();                                        // refused before sending
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator("#view img")).toHaveCount(0);
});

test("from an animal's Admin button: that animal is shown once; one that's gone says so", async ({ page }) => {
  await openPets(page, backend(), "&pet=" + ID(7));
  await expect(page.locator(`[data-pet="${ID(7)}"]`)).toHaveClass(/focus/);
  await expect(page.locator(`[data-pet="${ID(7)}"]`)).toBeFocused();              // keyboard / screen reader too
  await expect(page).toHaveURL(/\?tab=pets$/);                                      // once: the link is dropped
  await page.goto("admin/?tab=pets&pet=" + ID(9));
  await expect(page.locator("#msg")).toHaveText("That animal isn't in the list any more.");
});

test("the pets right ends while the list is on its way: back to the lock, nothing of it shown", async ({ page }) => {
  const b = backend();
  b.rpc.jc_admin_pets_list = () => { b.ab.st.scopes = []; return raise("NOT_ADMIN"); };
  await stubBackend(page, { rpc: b.rpc });
  await signIn(page);
  await page.goto("admin/?tab=pets");
  await expect(page.locator("#go")).toBeVisible();                                   // the lock: they can't enter any more
  await expect(page.locator("#msg")).not.toBeEmpty();
  await expect(page.locator("#paGroup")).toHaveCount(0);
  await expect(page.locator("[data-pet]")).toHaveCount(0);
});
