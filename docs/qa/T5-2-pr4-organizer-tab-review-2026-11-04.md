# T5.2 PR 4 — Organizer Sign-ups tab — review (2026-11-04)

**Scope:** `commons/admin/admin.js` (views `signups` + `pinmove`, entry actions, CSV, banner panel,
`initPinMap` / `pinMapHtml` shared with the venue pin), `commons/assets/nav.js` (`jcBanner` — the banner on
every member page), `app.css`, `admin.css`, `strings.js` (EN + DRAFT AR), tests
`tests/e2e/specs/admin-signups.spec.js` + stub additions in `specs/backends.js`. No migration: built on
`jc_admin_entries_list`, `jc_admin_entry_moderate`, `jc_admin_entry_spot_set`, `jc_admin_entry_pin_set`,
`jc_admin_home_pin_set`, `jc_admin_broadcast_set` (all live since 3a / PR A / 3b).

**Reviewers:** code-reviewer, security-reviewer (agents, static review of commit 5dd46cb).
**Decisions (Zee, 2026-11-04):** "free a no-show's place" stays deferred (needs a DB change: hidden
sign-ups hold their place); CSV carries everything the organizer sees on screen.

## Security review — no Critical / High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S1 | Low | CSV formula defusing missed leading whitespace / LF; negative longitudes (numbers) were being prefixed with `'` | **Fixed** — `csvCell` defuses text matching `^[\s=+\-@]`, never numbers; test asserts `" @SUM(1)"` → `"' @SUM(1)"` |
| S2 | Low | CSV filename from the slug; file holds resident notes off-platform | **Accepted** — slug is DB-constrained `^[a-z][a-z0-9-]{1,40}$`; content = exactly `jc_admin_entries_list` (verified `created_at` / `updated_at` already returned); warning under the button |
| S3 | Low | Banner abuse by a compromised event admin (alarming text on every page) | **Accepted** — server-side: event admins only while their event is live, never over an organizer's banner (`BANNER_IN_USE`), 280 chars, plain text (`textContent`), every post in `jc_admin_log` with the event; cleared at close |
| S4 | Info | Check `jc_admin_home_pin_set` is organizer-only | **No change** — event admins moving pins of homes signed up to their event is by design (plan Q2 / PR A, reviewed then) |
| S5 | Info | Admin page frameable (meta CSP can't carry `frame-ancestors`) | **Already mitigated** — `commons/_headers` sends `frame-ancestors 'none'` + `X-Frame-Options: DENY` on every Commons page (PR B, verified live) |

XSS: every resident / organizer string reaching `innerHTML` goes through `esc()`; messages, banner and
confirms use `textContent` / `confirm()`. Clean.

## Code review — no High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | Med | Hide / Restore button stayed disabled after a failed write | **Fixed** — `suFail` re-enables the view's buttons then reports; test "a failed write says why and leaves the buttons usable" |
| C2 | Med | Home-pin move: list refresh failing left the pin screen dead and never said the pin moved; duplicated refetch | **Fixed** — `refreshList()`; the move is reported (with Undo) even if the refresh fails |
| C3 | Med | No test for home-pin Undo, event-pin Undo over an existing event pin, or failure paths | **Fixed** — three tests added (+ list-load failure) |
| C4 | Low | Language switch lost the banner draft / open note / pin map position | **Fixed** — values + map view kept across the re-render; test for the banner |
| C5 | Low | Errors written to `#msg` at the top, off-screen on a long list | **Fixed** — `showErr` scrolls the message into view |
| C6 | Low | Village sort ignored the language | **Fixed** — `localeCompare(…, jcLang())` |
| C7 | Low | List load failure → "Working…" forever | **Fixed** — error + Try again; test |
| C8 | Low | A late write answer could pull the organizer off another pin screen | **Fixed** — `suWrite` only navigates if still on the screen it started from |
| C9 | Low | Pin-map markup duplicated (editor / pin move) | **Fixed** — `pinMapHtml()` |

## Tests

- Before review: 142 passed, twice.
- After fixes: **147 passed, twice** (Playwright, stubbed; `cd tests/e2e && npx playwright test`).
- CI (first push): 146 / 147 — `admin.spec.js` "editing: the kind is locked…" (from 2c) read the last
  save call right after clicking Save, before the request was sent; raced on the slower runner. **Fixed**
  — waits for "Saved." first. Scanned all specs for the same click → `lastCall` pattern: none left.
- Screens checked with `/shot` (organizer, EN + AR): found resident English notes mirrored in RTL → `dir="auto"` on resident text, note / banner inputs and the banner.

## Open / deferred

- Free a no-show's place (organizer withdraw) — needs a DB PR; deferred by Zee.
- Arabic strings for PR 4 are DRAFT — pending neighbor review with the 2c batch.
