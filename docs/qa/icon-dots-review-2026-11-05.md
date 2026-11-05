# Icon dot sizes + footer credit link — review (2026-11-05)

**Asked by Zee:** after the 2026-11-04 viewBox fix the icons were one size but their dots weren't
(small dot = 7%…12% of the icon side across the six glyphs); the footer credit should open in its own tab.

**Change:** `commons/assets/icons.js` — every glyph's radii scaled so the small dot = **8% of the side**
(accent dots keep their ratio: house door, mark centre, paw pad); viewBox re-fitted around the scaled dots.
8.5% was tried first and merged the dense Courts grid at card size (seen in `/shot`), so 8%.
`commons/assets/landing.js` — credit link `target="_blank" rel="noopener"`.

**Review:** self-check only (no reviewer agent — geometry + one link attribute, no logic, data or auth):
- Tests assert the property directly: every glyph fills its square (existing) and every small dot is
  16% ±0.5% of the icon as a diameter (new); the credit link opens in a new tab with `noopener` (new).
- `/shot` hub (cards 26 px + tab bar 22 px): dots read as one size; Courts' grid keeps visible gaps.
- `rel="noopener"`: the opened page gets no handle on Commons (`window.opener` null).

**Tests:** Playwright **175 passed ×2**.
