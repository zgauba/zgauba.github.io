// One screenshot of one screen, against the same stubs the specs use. Driven by env vars
// (see playwright.shot.config.js); /shot is the wrapper. Never part of the normal suite.
//
//   SHOT_PATH     path under /commons/, e.g. "events/" or "events/?id=<LIVE_ID>"  (default "")
//   SHOT_PERSONA  anon | member | member-no-home | member-no-pin | organizer | community-admin | event-admin
//   SHOT_LANG     en | ar
//   SHOT_FULL     1 = full page instead of the viewport
//   SHOT_OUT      absolute .png path (required)
//
// A request the stubs can't answer still gets a picture, then FAILS the run naming the
// missing RPC — extend specs/stub.js or specs/backends.js rather than guessing here.
const { test, expect } = require("@playwright/test");
const { stubBackend, ok, CONFIG, MEMBER_NO_HOME, MEMBER_NO_PIN } = require("../specs/stub");
const { eventsBackend, adminBackend, signIn } = require("../specs/backends");

const PERSONAS = ["anon", "member", "member-no-home", "member-no-pin", "organizer", "community-admin", "event-admin"];
const persona = process.env.SHOT_PERSONA || "member";
const lang = process.env.SHOT_LANG || "en";
const out = process.env.SHOT_OUT;

test("shot", async ({ page }) => {
  expect(PERSONAS, "SHOT_PERSONA").toContain(persona);
  expect(["en", "ar"], "SHOT_LANG").toContain(lang);
  expect(out && out.startsWith("/") && out.endsWith(".png"), "SHOT_OUT must be an absolute .png path").toBe(true);

  const scopes = { organizer: ["events"], "community-admin": ["community"] }[persona] || [];
  const adminEvents = persona === "event-admin" ? ["44444444-4444-4444-8444-444444444444"] : [];   // backends ADMIN_LIVE_ID
  const rpc = Object.assign({}, eventsBackend().rpc, adminBackend({ scopes, adminEvents }).rpc, {
    jc_config_get: () => ok(Object.assign({}, CONFIG, {
      modules: { events: { enabled: true }, bookings: { enabled: false }, pets: { enabled: false } } })),
  });
  if (!scopes.length && !adminEvents.length) delete rpc.jc_me_get;   // fall back to stub.js's plain member
  if (persona === "member-no-home") rpc.jc_me_get = (a, c) => ok(MEMBER_NO_HOME);
  if (persona === "member-no-pin") rpc.jc_me_get = (a, c) => ok(MEMBER_NO_PIN);

  const { calls, escaped } = await stubBackend(page, { rpc });
  await page.addInitScript((l) => { try { localStorage.setItem("jc_lang", l); } catch (e) {} }, lang);
  if (persona !== "anon") await signIn(page);
  await page.goto(process.env.SHOT_PATH || "");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);   // let transitions settle
  await page.screenshot({ path: out, fullPage: process.env.SHOT_FULL === "1" });
  console.log("SHOT " + out);

  const missing = calls.filter((c) => !rpc[c.name] && c.kind === "rpc" && !["jc_hit", "jc_me_get"].includes(c.name));
  expect(missing.map((c) => c.name), "RPCs with no stub — the picture may show an error state").toEqual([]);
  expect(escaped, "requests that left for a real host").toEqual([]);
});
