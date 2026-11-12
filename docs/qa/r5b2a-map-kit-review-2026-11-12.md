# R5b-2a shared map kit — review (2026-11-12)

**Branch:** `feat/r5b2a-map-kit` · **Tier:** 2 screen logic (shared-asset refactor, no DB / RPC / auth / PII)
**Reviewer:** `code-reviewer` agent — verdict **APPROVE**, no High / Medium findings.

## Scope
The Leaflet code that Events, Courts, the home pin picker and the organizer pin picker each copied now lives once in
`commons/assets/map.js`: `jcMapColors`, `JC_POPUP`, `jcDirectionsUrl`, `jcMapLayers`, `jcLocate`, `jcMeDot`, `jcMapHtml`,
`jcMapFull`, `jcPinPickerHtml`, `jcPinPicker`. The Find Me dot's `#3a86ff` became the `--jc-me` token.

## Reviewer checks (all clean)
- `full` controller initialised before any use; no early references; `comingLine(…, full)` parameter shadowing harmless.
- `set()` / `reset()` match the removed `setMapFull` / inline resets; Escape registered once per page.
- Layer choice still persists across redraws; home pin `map === pm` and admin `vmap === m` guards equivalent or stricter.
- No leftover `mapFull` / `setMapFull` / `POPUP_OPTS` / local `tiles`; load order (leaflet → map.js → strings/api) holds.
- XSS: kit markup args are literals at every call site; the one dynamic aria-label is `esc()`'d.

## Findings
| # | Sev | Where | Finding | Disposition |
|---|---|---|---|---|
| 1 | Low | `map.js` `jcLocate` | `fresh` parameter unused today | **Accepted** — its user is the Pets sighting pin in R5b-2b-2 (next PR); comment now says so |
| 2 | Low | `map.js` `jcMapHtml` / `jcPinPickerHtml` | raw-HTML args not documented as trusted | **Fixed** — doc comments say callers pass literals or escape |
| 3 | Low | `events.js` ~941 | stray double blank line | **Fixed** |

## Behaviour differences (intended)
- Courts full map: Escape now leaves an open `<dialog>`'s Escape alone (as Events already did).
- No `navigator.geolocation`: Events / Courts now leave full screen before showing the error (before, it was hidden behind the map).

## Tests
- Map-related Playwright specs (events, courts, home, admin, admin-courts, looks-pins, event-day, a11y), mobile: **283 / 283**. Full suite: CI.
- `/shot` before (main) vs after (branch): event map EN, AR, full screen, Street; home pin EN, AR — **byte-identical PNGs**.
  Courts map and organizer pin are not reachable by the `/shot` harness; covered by `courts.spec.js` / admin specs.
