# R4b-2 follow-up: the day view's date bar (cosmetic, 2026-11-09)

**Zee, from an iPhone on commons.ae:** the date spilled into the "Next day" button. He asked for ‹ and › instead of
words.

**Change (CSS + markup only):**
- **Layout:** the bar is a 3-column grid, `48px | minmax(0,1fr) | 48px`.
- **Date box:** the iPhone date pill has a wide built-in minimum width, which is what spilled. It is now given
  `min-width:0; width:100%`, and its 44 px height matches the arrows.
- **Arrows:** ‹ / › keep their names for screen readers ("Previous day" / "Next day" as `aria-label`).
- **Arabic:** the arrows are mirrored, so they point the way they move.

**Tier:** cosmetic, so the suite runs once with CI and a screenshot; no reviewer agent. **Checked:**
- **Screenshot:** WebKit at iPhone 13 size. The date box sits between the arrows with no overlap.
- **Tests:** `admin-courtday.spec.js` (incl. axe EN + AR: the buttons still have names) and the full suite.
