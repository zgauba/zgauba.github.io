// R1 — Households (community admins): homes by village, over-limit join requests, address fixes,
// directory hide / show, member removal, the admin log, and App Health notices linking to a home.
// The stub mirrors the live shapes read 2026-11-06 (docs/plans/R1-households.md). Every write
// asserts its exact arguments: a wrong-argument bug fails here, not on a resident's home.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, raise } = require("./stub");
const { adminBackend, signIn } = require("./backends");

const homes = () => [
  { id: "h7", village: "ain-al-maha", type: "villa", building: null, number: "7", lat: 24.53, lng: 54.43,
    pin_set_at: "2026-11-03T10:00:00Z", suppressed: false, flags: {}, created_at: "2026-11-03T09:00:00Z",
    members: [
      { user_id: "u-secret-alice", name: "Alice", joined_at: "2026-11-03T09:00:00Z", via: "claim" },
      { user_id: "u-secret-bob", name: "b•••@example.com", joined_at: "2026-11-04T09:00:00Z", via: "invite" },
    ] },
  { id: "h8", village: "ain-al-maha", type: "townhouse", building: null, number: "40", lat: null, lng: null,
    pin_set_at: null, suppressed: true, flags: { pin_far: true }, created_at: "2026-11-03T09:00:00Z", members: [] },
  { id: "h10", village: "seef-al-jubail", type: "apartment", building: "B2", number: "304", lat: 24.531, lng: 54.431,
    pin_set_at: "2026-11-03T10:00:00Z", suppressed: false, flags: { pin_near: "h7" }, created_at: "2026-11-03T09:00:00Z",
    members: [{ user_id: "u-secret-carol", name: "Carol", joined_at: "2026-11-05T09:00:00Z", via: "claim" }] },
];
const PENDING = [{ invite_id: "inv-1", home_id: "h7", requester: "d•••@example.com", created_at: "2026-11-05T12:00:00Z" }];
const LOG = [
  { at: "2026-11-06T08:00:00Z", action: "event_autoclose", target: { event_id: "ev-1" }, actor: null },
  { at: "2026-11-06T07:00:00Z", action: "home_suppress", target: { home_id: "h8", on: true }, actor: "Alice" },
  { at: "2026-11-06T06:00:00Z", action: "member_remove", target: { user_id: "u-secret-zed", home_id: "h10", account_deleted: false }, actor: "Alice" },
  { at: "2026-11-06T05:00:00Z", action: "facility_save", target: { facility_id: "f-1" }, actor: "Alice" },
];

function hhBackend(opts = {}) {
  const st = { homes: homes(), pending: PENDING.map((p) => Object.assign({}, p)), log: opts.log || LOG };
  const list = () => ok({ homes: st.homes, pending: st.pending });
  const home = (id) => st.homes.find((h) => h.id === id);
  const rpc = {
    jc_admin_homes_list: () => list(),
    jc_admin_invite_decide: (a) => {
      if (!st.pending.some((p) => p.invite_id === a.p_invite)) return raise("NOT_FOUND");
      st.pending = st.pending.filter((p) => p.invite_id !== a.p_invite);
      if (a.p_approve === true) home("h7").members.push({ user_id: "u-secret-dan", name: "d•••@example.com", joined_at: "2026-11-06T09:00:00Z", via: "invite" });
      return list();
    },
    jc_admin_home_edit: (a) => {
      if (opts.editError) return raise(opts.editError);
      const h = home(a.p_home);
      if (!h) return raise("NOT_FOUND");
      Object.assign(h, { village: a.p_village, type: a.p_type, building: a.p_type === "apartment" ? a.p_building : null, number: a.p_number });
      return list();
    },
    jc_admin_home_suppress: (a) => { home(a.p_home).suppressed = a.p_on === true; return list(); },
    jc_admin_member_remove: (a) => {
      st.homes.forEach((h) => { h.members = h.members.filter((m) => m.user_id !== a.p_user); });
      return list();
    },
    jc_admin_log_list: () => ok(st.log),
    // R1.1: the live shape — the pin back (not the homes list), with the old spot for Undo
    jc_admin_home_pin_set: (a) => {
      if (opts.pinError) return raise(opts.pinError);
      const h = home(a.p_home);
      if (!h) return raise("NOT_FOUND");
      const from = h.lat == null ? null : [h.lat, h.lng];
      Object.assign(h, { lat: a.p_lat, lng: a.p_lng, flags: {} });
      return ok({ home_id: h.id, lat: a.p_lat, lng: a.p_lng, from });
    },
  };
  return Object.assign({ st }, opts.wrap ? opts.wrap(rpc) : { rpc });
}

async function openHouseholds(page, opts = {}) {
  const hb = hhBackend(opts);
  const ab = adminBackend({ scopes: opts.scopes || ["community"], rpc: hb.rpc, notices: opts.notices });
  const sb = await stubBackend(page, { rpc: ab.rpc });
  await signIn(page);
  await page.goto("admin/?tab=community");
  if (opts.noOpen) return { hb, calls: sb.calls };
  await page.locator("#hhOpen").click();
  await expect(page.locator("h1")).toHaveText("Households");
  await expect(page.locator("[data-home]").first()).toBeVisible();
  return { hb, calls: sb.calls };
}
const writes = (calls, name) => calls.filter((c) => c.kind === "rpc" && c.name === name).map((c) => c.args);
const card = (page, id) => page.locator('[data-home="' + id + '"]');

test("homes by village with counts and flags; names as the server sends them, never an account id", async ({ page }) => {
  await openHouseholds(page);
  await expect(page.locator(".sub")).toHaveText("3 homes · 3 members");
  await expect(page.locator("h2.group").nth(0)).toHaveText("Waiting for you (1)");
  await expect(page.locator("[data-invite]")).toContainText("Wants to join Villa 7 · Ain Al Maha");
  await expect(page.locator("h2.group").nth(1)).toHaveText("Ain Al Maha");
  await expect(page.locator("h2.group").nth(2)).toHaveText("Seef Al Jubail");
  await expect(page.locator(".help", { hasText: "2 homes · 1 pinned · 2 members" })).toBeVisible();
  await expect(card(page, "h7")).toContainText("Alice");
  await expect(card(page, "h7")).toContainText("b•••@example.com");
  await expect(card(page, "h8").locator(".flags")).toHaveText(/No pin.*Pin far away.*Hidden from the directory.*Nobody lives here now/);
  await expect(card(page, "h10")).toContainText("Apt 304, B2");
  await expect(card(page, "h10").locator(".flags")).toHaveText("Pin on top of another home");
  // no account id anywhere in the page — not in the text, not in an attribute
  expect(await page.content()).not.toContain("u-secret");
  await expect(card(page, "h8").locator('[data-hh="show"]')).toHaveText("Show In Directory");
});

test("approve and decline an over-limit request send the invite and the answer", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await page.locator('[data-inv="inv-1"][data-yes="1"]').click();
  await expect(page.locator("#msg")).toHaveText("Approved. They're now a member of that home.");
  expect(writes(calls, "jc_admin_invite_decide")).toEqual([{ p_invite: "inv-1", p_approve: true }]);
  await expect(page.locator("[data-invite]")).toHaveCount(0);
  await expect(card(page, "h7")).toContainText("d•••@example.com");
});

test("decline sends p_approve false", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await page.locator('[data-inv="inv-1"][data-yes="0"]').click();
  await expect(page.locator("#msg")).toHaveText("Declined.");
  expect(writes(calls, "jc_admin_invite_decide")).toEqual([{ p_invite: "inv-1", p_approve: false }]);
});

test("one write at a time: a tap while a decision is in flight sends nothing", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { calls } = await openHouseholds(page, { wrap: (rpc) => ({ rpc: Object.assign({}, rpc, {
    jc_admin_invite_decide: async (a) => { await gate; return rpc.jc_admin_invite_decide(a); },
  }) }) });
  await page.locator('[data-inv="inv-1"][data-yes="1"]').click();
  await expect.poll(() => writes(calls, "jc_admin_invite_decide").length).toBe(1);
  await card(page, "h7").locator('[data-hh="hide"]').click();
  await card(page, "h8").locator('[data-hh="show"]').click();
  release();
  await expect(page.locator("#msg")).toHaveText("Approved. They're now a member of that home.");
  expect(writes(calls, "jc_admin_home_suppress")).toEqual([]);
  expect(writes(calls, "jc_admin_invite_decide")).toHaveLength(1);
});

test("an invite already decided elsewhere: the list is read again and the stale request is gone", async ({ page }) => {
  const { hb, calls } = await openHouseholds(page, { wrap: (rpc) => ({ rpc: Object.assign({}, rpc, {
    jc_admin_invite_decide: () => { hb.st.pending = []; return raise("NOT_FOUND"); },
  }) }) });
  await page.locator('[data-inv="inv-1"][data-yes="1"]').click();
  await expect(page.locator("#msg")).toHaveText("That changed in the meantime. The list below is up to date.");
  expect(writes(calls, "jc_admin_homes_list")).toHaveLength(2);
  await expect(page.locator("[data-invite]")).toHaveCount(0);
});

test("fix an address: starts from the home's values, delivered villages only, exact arguments", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await card(page, "h10").locator('[data-hh="edit"]').click();
  const f = page.locator('[data-form="edit"]');
  await expect(f.locator("#hhVillage")).toHaveValue("seef-al-jubail");
  await expect(f.locator("#hhType")).toHaveValue("apartment");
  await expect(f.locator("#hhBuilding")).toHaveValue("B2");
  await expect(f.locator("#hhNumber")).toHaveValue("304");
  await expect(f.locator('#hhVillage option[value="bada-al-jubail"]')).toHaveCount(0);   // not delivered
  await f.locator("#hhNumber").fill("305");
  await f.locator('button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Address saved.");
  expect(writes(calls, "jc_admin_home_edit")).toEqual([
    { p_home: "h10", p_village: "seef-al-jubail", p_type: "apartment", p_building: "B2", p_number: "305" }]);
  await expect(card(page, "h10")).toContainText("Apt 305, B2");
});

test("changing an apartment to a villa sends no building", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await card(page, "h10").locator('[data-hh="edit"]').click();
  await page.locator("#hhType").selectOption("villa");
  await expect(page.locator("#hhBldWrap")).toBeHidden();
  await page.locator("#hhVillage").selectOption("ain-al-maha");
  await page.locator('[data-form="edit"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Address saved.");
  expect(writes(calls, "jc_admin_home_edit")).toEqual([
    { p_home: "h10", p_village: "ain-al-maha", p_type: "villa", p_building: null, p_number: "304" }]);
});

test("an address another household has: admin wording, form kept open", async ({ page }) => {
  await openHouseholds(page, { editError: "HOME_TAKEN" });
  await card(page, "h7").locator('[data-hh="edit"]').click();
  await page.locator('[data-form="edit"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Another household already has that address.");
  await expect(page.locator("#msg")).not.toContainText("Ask one of them");
  await expect(page.locator('[data-form="edit"] button[type="submit"]')).toBeEnabled();
});

test("hide from the directory, then show again", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="hide"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 7 is hidden from the directory and event maps.");
  await expect(card(page, "h7").locator(".flags")).toContainText("Hidden from the directory");
  await card(page, "h7").locator('[data-hh="show"]').click();
  await expect(page.locator("#msg")).toHaveText("Villa 7 shows in the directory again.");
  expect(writes(calls, "jc_admin_home_suppress")).toEqual([{ p_home: "h7", p_on: true }, { p_home: "h7", p_on: false }]);
});

test("remove a member: the right person, account kept unless ticked", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="remove"][data-m="1"]').click();
  await expect(page.locator('[data-form="remove"]')).toContainText("Remove b•••@example.com from Villa 7?");
  await expect(page.locator("#hhDelete")).not.toBeChecked();
  await page.locator('[data-form="remove"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("b•••@example.com removed from the home.");
  expect(writes(calls, "jc_admin_member_remove")).toEqual([{ p_user: "u-secret-bob", p_delete_account: false }]);
  await expect(card(page, "h7")).not.toContainText("b•••@example.com");
  await expect(card(page, "h7")).toContainText("Alice");
});

test("deleting the account asks again by name; saying no sends nothing", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  const asked = [];
  page.once("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await card(page, "h7").locator('[data-hh="remove"][data-m="0"]').click();
  await page.locator("#hhDelete").check();
  await page.locator('[data-form="remove"] button[type="submit"]').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe("Delete Alice's account for good? This can't be undone.");
  expect(writes(calls, "jc_admin_member_remove")).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-form="remove"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("Alice removed and their account deleted.");
  expect(writes(calls, "jc_admin_member_remove")).toEqual([{ p_user: "u-secret-alice", p_delete_account: true }]);
});

test("removing yourself: told to use My Home", async ({ page }) => {
  await openHouseholds(page, { wrap: (rpc) => ({ rpc: Object.assign({}, rpc, { jc_admin_member_remove: () => raise("USE_ACCOUNT_DELETE") }) }) });
  await card(page, "h10").locator('[data-hh="remove"]').click();
  await page.locator('[data-form="remove"] button[type="submit"]').click();
  await expect(page.locator("#msg")).toHaveText("That's you. Leave your home from My Home instead.");
});

test("admin log: actions in words, a scheduled job shows as Automatic, only home labels from the target", async ({ page }) => {
  await openHouseholds(page);
  await page.locator("#logOpen").click();
  await expect(page.locator("h1")).toHaveText("Admin Log");
  const rows = page.locator(".fblist li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Closed an event (after it ended)");
  await expect(rows.nth(0).locator(".fbbody")).toHaveText("Automatic");
  await expect(rows.nth(1)).toContainText("Changed directory visibility");
  await expect(rows.nth(1).locator(".fbbody")).toHaveText("Alice · Townhouse 40 · Ain Al Maha");
  await expect(rows.nth(2).locator(".fbbody")).toHaveText("Alice · Apt 304, B2 · Seef Al Jubail");
  await expect(rows.nth(3)).toContainText("facility_save");          // not yet in words: its own name
  expect(await page.content()).not.toContain("u-secret");
  expect(await page.content()).not.toContain("ev-1");
});

test("an App Health notice opens its home; a home no longer listed says so", async ({ page }) => {
  await openHouseholds(page, { noOpen: true });
  await page.locator("#healthOpen").click();
  await expect(page.locator(".fblist li")).toHaveCount(2);
  await page.locator(".fblist li").nth(0).locator("[data-nhome]").click();   // NOTICES[0] → h7
  await expect(page.locator("h1")).toHaveText("Households");
  await expect(card(page, "h7")).toHaveClass(/\bfocus\b/);
  await page.goto("admin/?tab=community");
  await page.locator("#healthOpen").click();
  await page.locator(".fblist li").nth(1).locator("[data-nhome]").click();   // NOTICES[1] → h9, not in the list
  await expect(page.locator("#msg")).toHaveText("That home is no longer listed.");
});

test("an events-only organizer has no Households button", async ({ page }) => {
  await openHouseholds(page, { scopes: ["events"], noOpen: true });
  await expect(page.locator("#addCode")).toBeVisible();
  await expect(page.locator("#hhOpen")).toHaveCount(0);
});

test("Arabic: households in Arabic, right to left, an open edit keeps what was typed", async ({ page }) => {
  await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="edit"]').click();
  await page.locator("#hhNumber").fill("7A");
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("الأسر");
  await expect(page.locator("#hhNumber")).toHaveValue("7A");
  await expect(card(page, "h7").locator('[data-hh="hide"]')).toHaveText("إخفاء من الدليل");
});

// ---------- R1.1: fix a home's pin from Households ----------
test("fix a pin: map opens on the home's pin, the confirm names the home, exact arguments, Undo puts it back", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await expect(card(page, "h7").locator('[data-hh="pin"]')).toHaveText("Fix Pin");
  await card(page, "h7").locator('[data-hh="pin"]').click();
  await expect(page.locator("h1")).toHaveText("Fix Pin");
  await expect(page.locator(".sub")).toHaveText("Villa 7 · Ain Al Maha");
  await expect(page.getByText("Showing the home's own pin.")).toBeVisible();
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.locator("#hhPinGo").click();
  await expect(page.locator("h1")).toHaveText("Households");
  await expect(page.locator("#msg")).toContainText("Villa 7's pin saved.");
  expect(asked).toContain("Villa 7");
  const a = writes(calls, "jc_admin_home_pin_set")[0];
  expect(Object.keys(a).sort()).toEqual(["p_home", "p_lat", "p_lng"]);
  expect(a.p_home).toBe("h7");
  expect(a.p_lat).toBeCloseTo(24.53, 3);                                // the map opened on the home's own pin
  expect(a.p_lng).toBeCloseTo(54.43, 3);
  expect(writes(calls, "jc_admin_homes_list")).toHaveLength(2);         // the list is read again after the write
  await page.locator("#undo").click();
  await expect(page.locator("#msg")).toHaveText("Put back.");
  expect(writes(calls, "jc_admin_home_pin_set")[1]).toEqual({ p_home: "h7", p_lat: 24.53, p_lng: 54.43 });
});

test("set a pin for a home with none: flags shown, no Undo (nothing to put back), flags gone after", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  const btn = card(page, "h8").locator('[data-hh="pin"]');
  await expect(btn).toHaveText("Set Pin");
  await btn.click();
  await expect(page.locator("h1")).toHaveText("Set Pin");
  await expect(page.getByText("This home has no pin yet.")).toBeVisible();
  await expect(page.locator(".panel .flags")).toContainText("Pin far away");
  page.once("dialog", (d) => d.accept());
  await page.locator("#hhPinGo").click();
  await expect(page.locator("#msg")).toHaveText("Townhouse 40's pin saved. It had no pin before, so there's nothing to undo.");
  await expect(page.locator("#undo")).toHaveCount(0);
  await expect(card(page, "h8").locator(".flags")).not.toContainText("No pin");
  await expect(card(page, "h8").locator(".flags")).not.toContainText("Pin far away");
  expect(writes(calls, "jc_admin_home_pin_set")).toHaveLength(1);
});

test("a spot outside the community: admin wording, the map stays open to try again", async ({ page }) => {
  const { calls } = await openHouseholds(page, { pinError: "BAD_PIN" });
  await card(page, "h7").locator('[data-hh="pin"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#hhPinGo").click();
  await expect(page.locator("#msg")).toHaveText("That spot can't be saved: a pin must be inside the community (within 10 km). Move the map onto the home.");
  await expect(page.locator("h1")).toHaveText("Fix Pin");
  await expect(page.locator("#hhPinGo")).toBeEnabled();
  expect(writes(calls, "jc_admin_home_pin_set")).toHaveLength(1);
});

test("saying no to the pin confirm sends nothing", async ({ page }) => {
  const { calls } = await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="pin"]').click();
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#hhPinGo").click();
  await expect(page.locator("h1")).toHaveText("Fix Pin");
  expect(writes(calls, "jc_admin_home_pin_set")).toHaveLength(0);
  await page.locator("#hhPinCancel").click();
  await expect(page.locator("h1")).toHaveText("Households");
});

test("no map (Leaflet didn't load): no spot is chosen and nothing is sent", async ({ page }) => {
  await page.route("**/leaflet-1.9.4/leaflet.js", (route) => route.fulfill({ status: 404, body: "" }));
  const { calls } = await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="pin"]').click();
  let asked = false;
  page.on("dialog", (d) => { asked = true; d.dismiss(); });
  await page.locator("#hhPinGo").click();
  await expect(page.locator("#msg")).toHaveText("The map didn't load, so no spot can be chosen. Try again in a moment.");
  expect(asked).toBe(false);
  expect(writes(calls, "jc_admin_home_pin_set")).toHaveLength(0);
});

test("a pin notice opens its home with Set Pin one tap away", async ({ page }) => {
  const notices = [{ id: 21, kind: "pin_flag", detail: {}, created_at: "2026-11-04T08:00:00Z",
    home: { id: "h8", village: "ain-al-maha", building: null, number: "40" } }];
  await openHouseholds(page, { noOpen: true, notices });
  await page.locator("#healthOpen").click();
  await page.locator(".fblist li").nth(0).locator("[data-nhome]").click();
  await expect(card(page, "h8")).toHaveClass(/\bfocus\b/);
  await expect(card(page, "h8").locator('[data-hh="pin"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Set Pin");
});

test("Arabic: the pin fix in Arabic, right to left", async ({ page }) => {
  await openHouseholds(page);
  await card(page, "h7").locator('[data-hh="pin"]').click();
  await page.locator("#langBtn").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toHaveText("تصحيح الدبوس");
  await expect(page.locator("#hhPinGo")).toHaveText("احفظ الدبوس هنا");
});
