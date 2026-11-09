# Courts: tabs, the event map, Private on the court page: review (2026-11-09)

PR: `feat/r4c-courts-tabs`.

**Source:** Zee's iPhone review of R4c on commons.ae.
- The map was too close to the court card.
- The map should be like the other maps (Find Me, full screen) and show the court names.
- The banner on the court page had a spacing problem.
- He asked for sub-tabs **List · Map · My Bookings**.
- He wanted Private on the court timing page too.
- Standing rule: **consistency between modules** (sub-menu, map full screen…).

## What changed

- **Courts page:**
  - The shared sub-tab row (`jcTabsHtml` / `jcTabsWire`, as Events / My Home / Organizer). List first, `?tab=`.
  - Back from a court returns to the tab it came from.
- **Map tab = the event map.** It fills the screen above the tab bar and has Street / Satellite, Full Screen
  (Escape closes), and Find Me. It also has:
  - court names as labels on the pins;
  - a popup with hours, note, See times, and **Directions** (as on event pins).
- **Shared look.** The map CSS moved **verbatim** from `events/events.css` to a new shared `assets/mapui.css`. Events
  and Courts load the same file with the same classes, so the two can't drift.
- **Private on the court page:** my own slot on a court's day has the Private switch (the same handler as My
  Bookings).
- **Spacing:** even 12 px gaps on both screens; the court title, type and note grouped.

## Code review: approve, no High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M | M | A late My Bookings re-read after booking called `show("list")` on the Map / List tab, rebuilding the map (Full Screen and pan lost) | **Fixed.** It redraws only when the My Bookings block is on screen. Test (mutant caught) |
| L | L | No Leaflet → the map buttons drawn but dead | **Fixed.** A message instead of the map |
| L | L | Find Me refused in Full Screen → the message hidden behind the map | **Fixed on both pages** (Events had the same). The map steps out of Full Screen first. Test |
| L | L | A booking found gone (NOT_FOUND) didn't refresh My Bookings | **Fixed.** Marked stale, re-read on the way back |
| L | L | Reload on a court, then Back → List even when opened from Map | **Fixed.** `&tab=` kept in the court URL |
| L | L | Tab panel `tabindex` | No change needed (the panels hold focusable controls) |

The reviewer verified the CSS move:
- 29 rules removed and 29 added, the same text.
- No cascade change for Events.
- No leak onto other pages.

## Verification

- **`courts.spec.js`:** 28 tests. New ones:
  - the Map tab (labels, height, Street, Full Screen + Escape, Find Me, popup Directions, See times → court → Back
    to Map);
  - no pins;
  - Private on the court page (focus kept);
  - spacing (≥ 8 px between banner, day strip, slots);
  - the late re-read keeping the map;
  - Find Me refused in Full Screen.
- **Full suite:** 998/998, mobile + webkit.
- **Screenshots** (WebKit, iPhone 13): List tab, Map tab, court page. The **Events map after the CSS move is
  unchanged** (looked at).
- **One unexplained failure:** "no home" failed once under a full-suite run on WebKit, then passed 55 times in a
  row (×15, ×40). It has not been reproduced. If it recurs, look at the list re-render vs. the "See times" click.
