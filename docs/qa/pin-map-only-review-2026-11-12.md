# Pins on the map only — review note 2026-11-12

Zee (court editor screenshot, 2026-11-12): "Why is there a 'Go' button there? No one will have coordinates… we
should only allow via map."

Tier: screen logic, removal only (no DB). The paste-coordinates box + Go is removed from **every** pin picker so they
stay alike: admin pin map (event venue, court pin, Households / sign-up pin move) and the resident home pin. Also
removed: `jcParseLatLng` (map.js, no other caller), strings `pin_paste`, `pin_paste_help`, `pin_paste_go`,
`err_BAD_COORDS` (EN + AR). The map, Find Me, Street / Satellite and the ring are unchanged; the saved spot is still the
map centre.

## Tests

| Run | Result |
|---|---|
| Full suite, mobile (Chromium) | 565 passed |
| Tests that typed coordinates to move the map | now pan the map directly (`vmap` / `map.setView`) — same saved-spot assertions |
| New guards | home pin, venue editor, court editor assert no `#coords` / `#coordsGo` (and no "coordinates" text on the home pin page) |

No reviewer agent: removal of an input that only moved the map (no data path changed — the save still reads the map
centre). Plan R5b-2 updated (shared pin picker: no paste box).
