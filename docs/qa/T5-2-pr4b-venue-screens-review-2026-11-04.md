# T5.2 PR 4b — One-place resident screens — review (2026-11-04)

**Scope:** `commons/events/events.js` (venue helpers; list row; detail tabs Map + My home; header count;
venue map pin + Directions line; My home without a home pin, "is coming", spot / spot pending, Full; FULL
refetch; archive totals only), `events.css`, `strings.js` (EN + AR), tests in `tests/e2e/specs/events.spec.js`.
No migration — uses `jc_event_get` / `jc_events_list` / `jc_event_signup` as shipped in 3b.

**Reviewer:** code-reviewer (agent, static review of 1152585). Privacy: no client-side path shows which homes
are coming (the server sends `entries: []` for venues; the map uses one synthetic pin; no List tab).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| H1 | **High** | **Stored XSS:** the organizer-typed place name went to Leaflet `bindTooltip` raw — Leaflet sets string content as HTML, so it would run in every resident's session | **Fixed** — escaped (`esc()` in a `dir="auto"` span); test with `<img onerror>` + `<b>` asserts literal text, no elements, no script. Swept every Leaflet content call in `commons/`: the only other one (`popupHtml`) was already escaped |
| M1 | Med | List count (`homes_in`, skips hidden) ≠ event page (`households_in`, all) → the mismatch reveals a hidden sign-up | **Fixed (client)** — list reads `households_in` when present, else `homes_in`; test. **Server:** `jc_events_list` gains `households_in` in the next Commons migration (feedback, `t5_3`) — until then the old count shows |
| M2 | Med | FULL → refetch fails → form left open with the old count | **Fixed** — form closes and says Full either way; test |
| M3 | Med | Null / half location: empty map, Directions to "lat,null" | **Fixed** — both coordinates checked (`hasPos`); no location → the name without Directions, no pin; test |
| L1 | Low | "1 households", "1 places"; Arabic number agreement | **Fixed** — singular strings in English; Arabic uses "label: number" forms that read right for every number |
| L2 | Low | Empty place name rendered an empty bold | **Fixed** — "The place" fallback |
| L3 | Low | Arabic tooltip direction untested | **Fixed** — tooltip text in a `dir="auto"` span |
| L4 | Low | FULL while editing an existing sign-up untested | **Accepted** — an update never counts as a new place server-side (3b: the home already `in` passes the capacity check) |

## Tests

- Before review: 160 passed ×2. **After fixes: 164 passed ×2** (Playwright, stubbed).
