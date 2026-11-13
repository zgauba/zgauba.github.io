# R5b-2b-2a — Pets · Strays · My Pets — review 2026-11-13

**Tier 2 (screen logic)**: client only; it reads the R5b-2b-0 server change (#102, live). Reviewer: `code-reviewer`. The brief
included the standing duplication check added to `/ship-pr` on 2026-11-13.
**Verdict:** APPROVE. Nothing High or Medium.

## Tests (local, mobile project)
- Pets spec **46/46**. New tests:
  - Pets tab: owned only, server order kept, chips, sort line.
  - Pets tab: no home pin → name order; an old `?tab=list` link opens Pets.
  - Strays: pin colours, rehomed off the map, the "not on the map yet" line, card order, labels only when zoomed in, the
    key, popup → Open → pet page and back to a fresh map.
  - The seen-out line on My Pets and on the hub card.
  - axe **EN + AR** on all three tabs with the key open, all impact levels.
- Affected specs (Events, event day, events audit, looks/pins, Courts, Organizer Tools, health, landing, My Home, shell,
  section names, help, a11y): **352/352** before the review fixes; Pets, Courts, landing, health and Events **181/181** after.
- Screens looked at (`/shot` via `SHOT_DIR`): Strays tab, Pets tab (Wanderers filter), hub Pets card.

## Findings and disposition
| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Low | `jcAgo` was inserted between `jcMapRemove` and its comment | **Fixed** |
| 2 | Low | The hub alerts read never retries after a network failure | **Fixed**: the flag resets on failure; the next hub draw may ask again (no loop) |
| 3 | Low | The popup's "Last seen" used `last_seen_at`, which can be a newer sighting with no location than the one the pin stands on | **Fixed**: the popup uses `last_seen.at`. Note-only sightings exist. |
| 4 | Low | A Find Me error landed on another screen if the user moved on while the prompt was pending | **Fixed**: guarded by `map === m` |
| 5 | Low | Map pins aren't keyboard or screen-reader targets; Directions is only in popups | **Accepted**: the cards below give the same content and Open |
| D1 | Dup | Popup wiring had 3 copies (Pets, Courts, Events) | **Extracted** `jcMapPopups` in `assets/map.js`; Courts and Pets use it. The Events variant (report buttons, `popupOpen` flag) is **deferred** to the scoped structural audit (ROADMAP) |
| D2 | Dup | `.ptdot` resembles the Events legend dots | **Accepted**: different meaning (state colour vs glyph); move to `mapui.css` if a third map needs it |
| D3 | Dup | `.mini` defined in admin.css, bookings.css and pets.css; `.pop` in `mapui.css` and `bookings.css` (pre-existing) | **Deferred** to the structural audit (move to `app.css`) |

Extractions made in this PR (Prior Art "EXTRACT"):
- **Key window:** `jcKeySheet` in `assets/map.js`, used by Events and Pets.
- **Label and legend CSS:** moved to `assets/mapui.css`.
- **"ago" helper:** `jcAgo` in `assets/api.js`, used by Organizer Tools and Pets.
- **Map pin tap helper:** `tapWhenStill` in the test `backends.js`, used by the Courts and Pets specs.

A map-height fitter was tried and dropped. The Strays map is a fixed 46vh, so a phone can still scroll down to the cards.
