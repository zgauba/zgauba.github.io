# T5.2 PR 5b.2 — Map Labels window, supply gauge, phone-sized popups — review (2026-11-06)

**Asked by Zee (2026-11-05 / 06, testing on a phone):**
1. Supply "needs to be a visual in the pop up window" (not on the pin — draining-pin mockups shown first, declined).
2. A "Map Labels" help button that opens a window with the key — the key under the map "looks very messy" and made
   the map too small on a phone.
3. A pin's popup took too much space and opened with its close button hidden (under the "Street" button).

**Scope:** `events/events.js` — `gaugeHtml` (four bars, `i <= level`: Almost out keeps one bar, like a battery) in
`supplyLine` (popup + list); `legendHtml` with a heading per group (the icon / gate questions' own wording, "Tonight",
"How much is left" with a gauge per level); key removed from under the map; `#labelsBtn` over the map opens a native
`<dialog id="labels">` (`openLabels` / `closeLabels`; Close, Esc, backdrop tap); popups `maxWidth 250` with auto-pan
padding; while a popup is open the overlay buttons and zoom control are hidden (`.evmapwrap.popopen`). `events.css`,
`strings.js` (EN + AR). Tests.

**Live test data:** none changed in this PR.

**Reviewer:** code-reviewer on commit 0c52428 (labels + gauge). Verdict: approve.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| — | — | XSS in the window (headings are organizer-typed question labels), dialog lifecycle across refresh / tab / language, Esc + focus return, RTL, `fitMap` with an empty `#mapAfter`, gauge accessibility | **Checked clean** — all escaped; the dialog is rebuilt closed by `show()`, untouched by `repaint()`; native dialog returns focus; gauge `aria-hidden` with the level in words |
| F1 | Low | No-`<dialog>` browsers: opened via `[open]` but `close()` missing → couldn't close | **Fixed** — `closeLabels` removes `[open]` |
| F2 | Low | A tap on the window's own padding closed it | **Fixed** — closes only for taps outside its box; test |
| F3 | Nit | "Almost out" lights one bar (never an empty gauge) | **Accepted** — intended (battery-style; empty would read as "out") |

Popup change (after the review, from Zee's phone screenshot) is covered by a test rather than a second pass: the
popup's close button is the topmost element at its centre, the popup is ≤ 290 px wide, Street / Map Labels / zoom are
hidden while it's open and come back when it closes.

**Pre-existing flakes fixed while here (tests only):** two-emoji icon box measured in two reads straddling the zoom
animation (failed 2 / 8) → one read (15 / 15); `events.spec` hostile-note test clicked a pin mid-zoom under full-suite
load (failed 1 run) → `dispatchEvent`, as the other map tests.

**Tests:** stubbed Playwright **238 / 238**, three full runs after the flake fixes (237 before this PR's additions on
`main`; new: Map Labels window on a small phone incl. edge / backdrop taps, supply key + gauge, popup not covered).
Screens checked with `/shot`: map with the button, the window open, a popup.
