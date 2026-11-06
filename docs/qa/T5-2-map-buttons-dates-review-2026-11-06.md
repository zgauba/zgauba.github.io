# Map buttons + editor date fields — review (2026-11-06)

**Asked by Zee (2026-11-06, phone):** drop the "?" from Map Labels; Map Labels on the same line as Street; Find Me
bottom right. In the event editor (iPhone), the Starts / Ends date fields spill past the right edge.

**Scope:** `events/events.js` (Map Labels + Street in one `.mapbtns` row, top right; Find Me button unchanged in
markup), `events.css` (`.mapbtns` flex row; `.maplocate` bottom right; popup-open hiding now covers the row),
`admin/admin.css` (`input[type=datetime-local]`: `box-sizing:border-box`, block, no native appearance, 46 px tall —
`width:100%` plus padding + border overflowed on iOS Safari). Tests.

**Review:** layout / CSS only, no logic, no data — no reviewer agent; covered by tests + screens.

| # | Check | Result |
|---|---|---|
| 1 | Buttons: same row, Map Labels then Street, top right, clear of zoom; Find Me bottom right | Test + `/shot` |
| 2 | Popup open still hides the buttons (row now nested) | Existing "nothing covers" test passes |
| 3 | Date fields inside the panel, no sideways page scroll | Test added — **but it passes without the fix too**: the spill is iOS Safari-specific and the suite runs Chromium. The fix needs a check on a real iPhone (Zee) |
| 4 | RTL | Row uses physical right like the old button; Leaflet zoom stays top-left in Arabic |

**Tests:** 254 / 254 (second run; first run 253 + the known flaky `feedback.spec` language-switch test — now
scheduled for its own test-only fix).
