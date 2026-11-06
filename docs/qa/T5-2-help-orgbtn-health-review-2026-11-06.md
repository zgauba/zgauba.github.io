# Page help, Organizer Tools button, App Health platform rows — review (2026-11-06)

**Asked / decided by Zee (2026-11-06):**
1. A "?" help icon on the right pages explaining things — pages approved: Events list, Event page, My Home (incl.
   Account), Organizer Tools; wording approved with edits ("tap its pin and click They're Out of Treats"; the
   "Signing out on a shared phone…" line removed).
2. App Health: whole-platform numbers (storage, wrong codes, platform join lockouts) shown to the platform owner only;
   Organizer Tools help copy says so.
3. Organizer Tools sat inside the account box ("a very odd spot"): organizers get their own button above the box.
   Residents without a code get a small "Have an organizer code?" link at the bottom instead (so a newly given code
   still has a way in).

**Scope:** `assets/nav.js` (`jcHelp` / `jcHelpOpen` / `jcHelpClose`: "?" before the language button, native
`<dialog>` built on open from `help_<key>_*` strings, `**x**` → bold after `esc()`), `assets/app.css` (shared
`dialog.sheet` moved from events.css; 30 px "?"), `events/events.js`, `admin/admin.js`, `home/home.js` (calls;
organizer button), `admin/admin.js` `healthChecks` (owner-only rows), `strings.js` (EN + AR), tests. Also a test-only
race fix in `feedback.spec.js` (the language button exists in the HTML before `landing.js` wires it; the test tapped
in that gap ~1 in 20 runs → it now waits for the hub to draw; 60 / 60).

**Reviewer:** code-reviewer on commit b2177ff. Verdict: approve; no Critical / High.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| — | — | XSS in the help window (bold after `esc()`), dialog reuse / language, missing `#langBtn`, duplicate "?" / back button, owner gating + summary count, duplicate `#toAdmin` | **Checked clean** |
| R1 | Med | My Home showed the Organizer Tools button for any scope (e.g. pets-only), which Organizer Tools then refuses | **Fixed** — same rule as `canEnter()`: events / community scope, an event admin, or the owner; test |
| R2 | Med | Non-owner lockout count said to be platform-wide but labelled as local | **No change — finding incorrect**: `admin_unlock` is filtered by `a.community_id = v_comm` (`20261105020000_t4a_snapshots.sql:149`; the security review of PR 6 found the same) |
| R3 | Low | No "?" while claiming a home (status not yet member) | **Fixed** — `jcHelp("home")` on every paint |
| R4 | Low | "?" aria-label stayed in the old language when a page switches language without re-rendering | **Fixed** — updated on every language tap; test |
| R5 | Low | Top bar at 320 px | **Checked** — `a.home` already has `min-width:0` + ellipsis; test at 320 px |
| R6 | Low | Test gaps (single "?" after toggles / navigation, owner-only organizer) | **Fixed** — tests |
| R7 | Low | Help reused `ev_labels_close` | **Fixed** — generic `close` string |

**Tests:** stubbed Playwright **263 / 263** twice (254 after the map-buttons PR; new: `help.spec.js` ×5, organizer
button ×3, non-owner App Health). Screens checked with `/shot`: event help window, organizer's Account tab, top bar
with back + "?" + language.
