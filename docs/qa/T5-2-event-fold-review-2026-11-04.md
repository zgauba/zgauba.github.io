# Event page above the fold + icon sizes — review (2026-11-04)

**Asked by Zee (2026-11-04, from a phone screenshot of the e2e test event):** back arrow left of the logo
instead of the "‹ Events" line; everything above the fold so the whole map shows without scrolling; icons
looked like different sizes.

**Scope:** `assets/nav.js` (`jcBack`; back label relabelled on language switch), `assets/app.css` (top bar,
44px back target, name ellipsis), `events/events.js` + `events.css` (back in the top bar, 2-line description
+ More / Less, `fitMap` sizes the map to the tab bar, `body.evfit`), `admin/admin.js` (Sign-ups / Move pin use
the top-bar back), `assets/icons.js` (tight square viewBox per glyph), `strings.js` (`back`, `ev_more`,
`ev_less` EN + AR), tests. No database change.

**Reviewer:** code-reviewer (agent, static review of 27d4372). Security review not needed: no auth, data,
RPC or secret changes.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Med | `fitMap` used `visualViewport.height` — shrinks on pinch-zoom (iOS), map would jump toward the minimum | **Fixed** — `window.innerHeight` (tracks Safari's toolbar); visualViewport listener dropped |
| 2 | Med | `body{min-height:100vh}` (iOS large viewport) kept the map screen slightly scrollable → toolbar toggles → re-fits | **Fixed** — `body.evfit{min-height:0}`; test asserts the page can't scroll |
| 3 | Low | "More" measured once — font swap / rotation could hide it on cut-off text | **Fixed** — `measureDesc()` re-runs from the resize / fonts path |
| 4 | Low | Back `aria-label` stale after a language switch where the view doesn't re-render (load error, editing) | **Fixed** — label stored as a strings key, refreshed by `jcTabBar` on every `paint()`; test |
| 5 | Low | Back tap target 36px (< 44pt) | **Fixed** — 44px, absorbed by negative margins; test |
| 6 | Low | Long community name could squeeze the language button | **Fixed** — ellipsis on the name |
| 7 | Low | Glyphs ~1.3–1.8× larger at the same px after the viewBox change — check hub cards / My Home | **Checked** — `/shot` hub, My Home, event page: balanced, no layout change needed |

Checked by the reviewer, no issue: viewBox math for all six icons (tight, centred, no clipping); `ic.vb` has
no other consumer; module-level listeners exit early off the map tab; `evfit` cleared on every `show()`;
`jcBack` URL / function targets reset each other; RTL (mirrored arrow, physical-right Streets button).

**Also fixed (found by `/shot`, already live):** in Arabic the map's Streets / Satellite button sat on top of
Leaflet's zoom buttons (logical `inset-inline-end` flips; Leaflet's zoom doesn't) → physical `right`, as the
pin screen already does; test.

## Tests

- **154 passed, twice** (Playwright, stubbed) — was 147; +7: back in the top bar (left of the logo, none on
  the list), map fits between tabs and tab bar with no page scroll, description More / Less + RTL arrow
  mirrored, short description has no More, icons fill their box (all six), Arabic Streets vs zoom, back
  label follows the language + 44px.
- Screens: event page EN + AR, hub, My Home (`/shot`, iPhone 13 size).
