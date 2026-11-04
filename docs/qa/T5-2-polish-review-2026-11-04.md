# T5.2 polish PR — review (2026-11-04)

**Scope:** landing spacing; hub "See events"; events list (View + Sign up CTAs, no status pill,
soonest-first sort, Admin badge → `admin/?event=<id>`); My Home sub-menu
(Home · Household · Account, `?tab=`); shared `.subtabs` styling.
Source: Zee's testing feedback (2026-11-04).

**Reviewers:** `code-reviewer` (verdict: approve) · `security-reviewer` (nothing material).
**Tests:** 108 → 111, two clean full runs after fixes; racy pin-paste test fixed and
stress-run 100× green.

## Findings and dispositions

| # | Reviewer | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | code | Med | Unsaved display name lost when switching My Home tabs (re-render resets the field) | **Fixed** — `draftName` carried across tab switches; test types → switches tab → switches language → value kept |
| 2 | code | Low | Admin badge cleared the title with a fixed 64px padding; a wider label could overlap | **Fixed** — badge now sits in a flex title row (`.evtop`), no absolute positioning; AR checked with `/shot` |
| 3 | code | Low | After accepting an invite the tab is Household but the URL had no `?tab=` | **Fixed** — `replaceState("?tab=household")`; invite test asserts the tab + URL (token still gone) |
| 4 | code | Low | Test gaps: tab kept on language toggle; invite lands on Household; badge for `community` scope | **Fixed** — all three covered (badge test runs for `events` and `community`) |
| 5 | code | Low | Dead strings `mh_household`, `mh_account`, `ev_archived` | **Fixed** — removed (EN + AR) |
| 6 | code | Low | Tab rows use `role=tab` without tabpanel / aria-controls / arrow keys; focus lost on re-render | **Deferred** — not a regression (same as the existing event tabs); one shared fix for both pages in a later a11y pass |
| 7 | code | Low | Locked organizer → unlock → `?event=` path untested | **Accepted** — same `loadHome()` path as the tested one; code reviewer confirmed both call sites |
| 8 | security | Low | Destructive buttons (Leave / Delete) are frameable — no `frame-ancestors` possible via meta CSP on Pages | **Deferred** — pre-existing for every page; Leave already asks `confirm()`, Delete needs DELETE typed. Site-wide frame-bust belongs in `canonical.js` (track for T6 launch gate) |
| 9 | security | Low | `?tab=account` lands straight on the Account tab | **Accepted** — display only; nothing fires without a tap + confirmation |

Confirmed safe by security review: `?event=` is only compared against server-returned ids
(never rendered or navigated to) and opens the editor without saving; `?tab=` is allowlisted;
all new markup escaped / `encodeURIComponent`; the Admin badge reveals nothing a resident
doesn't already receive, and the server's `jc_assert_admin` still gates every admin call.

## Found while testing (not from a reviewer)

- **Flaky test** `home.spec.js` "pin: paste coordinates…" — failed 1 of 2 runs. Root cause:
  it read the stub's recorded calls right after the click; the route handler hadn't recorded
  the save yet, so `.pop()` returned the *previous* save (off by exactly the first pin's
  latitude). `waitForRequest` alone wasn't enough (fires before the handler). Fixed with
  `expect.poll` on the recorded count; 100/100 under `--repeat-each`. No other spec reads
  `calls` right after a click.
