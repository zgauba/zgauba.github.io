# SA-2 — map kit consolidation · review 2026-11-14

Branch `refactor/sa2-map-kit`. Tier 2: a client refactor with no schema, RPC, auth or PII change.
Plan: `docs/qa/STRUCTURAL-AUDIT-2026-11-13.md`, section "SA-2". Reviewer: `code-reviewer` (read-only, 2026-11-14). Verdict: **APPROVE**.

## Scope

- **Moved into `commons/assets/map.js`** (one copy each):
  - `jcBigMap`: map, community centre, Street / Satellite, Full Screen.
  - `jcFindMe`: the blue dot and zoom to `JC_LABEL_ZOOM`. A late answer never lands on a map that has gone.
  - `jcFitPins`: padding 40; one pin at 17, or 18 for an Events place; no pins leaves the map where it is.
  - `jcDirLink`: always `noopener noreferrer`.
  - `jcPopHtml`: one popup shell.
  - `jcMapFit`: the map sized to the screen above the tab bar.
  - `JC_LABEL_ZOOM` and `JC_MAP_HOME`.
  - `jcMapPopups(m, onOpen, hooks)`: Events now uses the kit, with hooks for "They're Out" and the held-back repaint.
- **Pages now use the kit:** Events, Courts and Pets. The Pets `bigMap` / `fitTo` / `LABEL_ZOOM` and the Courts `locate` / `userPos` are gone. Events keeps `locate` because sort-by-distance needs it.
- **CSS:**
  - The `.pop` flex rhythm moved from `bookings.css` to `mapui.css`, so every module's popup is spaced the same.
  - `.ptmini` now uses `var(--jc-radius)`.
- **Courts pin names:** still always shown (Zee decision, 2026-11-13).

**User-visible changes:**
- Popup spacing is the same in Events, Courts and Pets.
- The Events place label follows the theme (`bklabel`, radius 11, fill .95).
- Find Me zooms in the same way everywhere.
- A late Find Me answer doesn't show a message or dot on the next screen (Courts and Events; Pets already did this).
- Directions and Google Maps links send no referrer.
- The Events fit padding is 40 instead of 30.

## Code review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Med | No test for the Events late Find Me guard (only Courts had one) | **Fixed.** New Events test covers both cases. A late failure after switching to List shows no message. A late fix after the map is redrawn adds no dot. It fails on the old code and passes on the new. |
| 2 | Low | Events has two `jcLocate` callers (`jcFindMe` and `locate` for sort-by-distance). Sort-by-distance has no stale-screen guard. | **Accepted.** It shows a page-level message, which is harmless. Nearest-first (next on the queue) reworks distance sorting, so this is revisited there. |
| 3 | Low | WhatsApp link (`events.js:386`) and landing credit link still use `rel="noopener"` | **Deferred.** These aren't map links. They go to the SA-4 / CI-grep prevention pass. |
| 4 | Low | `jcFitPins` is a no-op on no pins, where Pets `fitTo` would have thrown | **Accepted.** This is an improvement and is documented in the function comment. |

The reviewer confirmed these are unchanged:
- variable initialisation order (`full` / `fitter` / hoisted `fitMap`);
- the `jcMapFit` order and the `evfit` toggle;
- the `measureDesc` order;
- Events teardown (`popupclose` fires on a cleared state);
- popup hook order;
- escaping of every `jcPopHtml` part.

## Tests

- **Full suite, both browsers, before the new tests: 1188/1188.**
- **Map specs** (courts, events, pets, looks-pins, home, event-day) **with the new tests: 576/576.**
- **Each new test fails on the old code:**
  - Courts late failure.
  - Events venue `bklabel`.
  - Events late Find Me (added after the review): 2/2.
- **New assertions** on existing tests: `rel` on Directions and Google Maps, and the Events Find Me zoom ≥ 17.

## Carry-overs

- **Prevention rules** (audit §Prevention): CI grep for map helpers redefined in page files, after SA-4.
- **Sort-by-distance:** revisit with nearest-first.
