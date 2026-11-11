# Paw icon review — 2026-11-11 (cosmetic)

Zee: "look at the pet icon in the branding document … the current icon does not look like a paw because of the spacing."

- Cause: two earlier icon rules together — each glyph drawn tight to its box (2026-11-04) and every small dot 8% of the
  side (2026-11-05). Four toes at 8% can only fill the width by spreading apart, so the paw fell into five loose dots.
- Fix: `commons/assets/icons.js` pets geometry = toes close in an arc, pad tucked under (brand direction §03); the paw is
  the stated exception to the 8% rule (toes 10.5%). `landing.spec.js` "icons" test asserts the exception explicitly.
- Looked at: before / after at 96, 32, 22 px on the dark background; the pet page heading and the bottom bar (360 px).
- Tests: `landing.spec.js` 16 passed; `pets.spec.js` screenshot run passed. No reviewer agent (cosmetic tier).
