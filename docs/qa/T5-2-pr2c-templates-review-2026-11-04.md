# T5.2 PR 2c — templates, event kind, look, venue (organizer screens) — review (2026-11-04)

**Scope:** `commons/admin/` (template picker, kind / look / venue fieldset with a Leaflet pin map,
capacity, spots, JICM notice, "at <place>" in the list), new shared `commons/assets/map.js` (tiles +
coordinate parser, replacing copies in `home/home.js` + `events/events.js`), pin-map CSS moved to
`assets/app.css`, admin CSP `img-src` + the two tile hosts, `dir="ltr"` on English / coordinate inputs,
strings EN + AR (AR = DRAFT). Server side: PR 3b (#36, live). Haq al Laila template follows Zee's
concept (nut-free = the choice that matters). Tests 122 → **127**, two clean runs; `/shot` harness
gains `SHOT_CLICKS`.
**Reviewers:** `code-reviewer` (approve after the Med) · `security-reviewer` (no critical / high).
**Mutation-checked:** the venue save branch, the kind lock, and the Enter-in-coordinates fix each
turn their tests red when removed.
**Found by looking (`/shot`, EN + AR) before review:** the layer button sat on Leaflet's zoom
control in Arabic (also on the residents' home pin map) → physical `right:`; English inputs
rendered "?What will you sell" in Arabic → `dir="ltr"`; the capacity box was unstyled (white).

## Findings and dispositions

| # | Reviewer | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | code | Med | Enter in the coordinates box submitted the event form (created a draft, left the editor) | **Fixed** — Enter = "Go"; test (red without the fix) |
| 2 | code | Low-Med | Kind radios unlock when only withdrawn sign-ups exist (list counts `in` only); server refuses with `KIND_LOCKED` | **Accepted** — the server is the backstop and says why; not worth a new list field |
| 3 | code | Low | A look unknown to this page would be rewritten to "plain" on any save | **Fixed** — an unknown look stays as an option |
| 4 | code | Low | Venue map hidden → shown again keeps stale size | **Fixed** — `invalidateSize()` |
| 5 | code | Low | Non-numeric capacity read as "no limit" (clears an existing one) | **Fixed** — `validity.badInput` → `BAD_CAPACITY` |
| 6 | code | — | Test gaps: homes → venue fields, Enter in coords | **Fixed** — new test covers both |
| 7 | security | Low | Admin page now contacts Esri / OSM for tiles (viewer IP + the area viewed) — only when "One place" is chosen (map is lazy) | **Accepted** — same exposure as the home / events maps; no tokens (no-referrer; OSM gets the bare origin only) |
| 8 | security | Info | Stale CSP comment "No map tiles here" | **Fixed** |
| 9 | security | Info | `GRANT` concatenated into `next` unencoded (pre-existing; regex-limited to `[A-Za-z0-9_-]`) | **Accepted** — not exploitable as written |

**Confirmed safe:** venue names escaped once at the sink (`esc(line)`); editor values set via
`.value`; geolocation only moves the map; the map.js move is byte-identical (OSM referrer policy
kept); CSP widened for images only (`script-src` / `connect-src` unchanged); framing headers intact.
**Carry to 4b:** render venue names / spots with `esc()` on the resident screens too.
