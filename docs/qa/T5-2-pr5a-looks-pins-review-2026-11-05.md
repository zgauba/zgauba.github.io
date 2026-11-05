# T5.2 PR 5a — event looks + Halloween-parity pins — review (2026-11-05)

**Plan:** `docs/plans/T5-2-plan.md` → "PR 5 split (2026-11-05)". PR 5 was split: **5a** (this — display only,
no new RPC calls) and **5b** (event day: giant switch, supply, crowd reports, "we're not out", 60 s refresh,
payload measurement). No migration.

**Scope:** `events/events.js` (pins as `L.divIcon`: fill = availability, ring = the `pin: "ring"` question,
icon = the `pin: "glyph"` question, teal icon for choices in `allergy_friendly`; map key `#mapAfter .legend`;
popup / list state lines; `html[data-look]` + mark + Haq al Laila tagline; list cards wear their look),
`assets/tokens.css` (`[data-look]` presets, ring palette — never the four signals), `events.css`,
`admin/admin.js` + `admin.css` (per-choice "allergy-friendly" tick on icon questions; Halloween / Haq al Laila
templates pre-tick non-food 🎃 / nut-free 🧡), `strings.js` (EN + AR), tests.

**Zee decisions (2026-11-05):** fill = availability in every look (Haq al Laila's concept had fill = treats);
nut-free shows through the icon tinted teal (the Halloween teal-pumpkin filter) — 🍬 doesn't tint, so the
template uses 🧡 (renders as a teal heart; candidate sheet compared on gold pins); event-day window +
supply wording + emoji header marks → 5b / as recommended. **Changed during build:** "reported out" is a
dark pin with a red `?` (amber was indistinguishable from Haq al Laila's gold — test guards the contrast).

**Reviewers:** code-reviewer + security-reviewer, on the staged diff (pre-fix).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S1 | — | XSS via glyphs / labels / look in divIcon, key, popup, list, header, card attribute | **None found** — every typed string through `esc()`; `lookOf` whitelists via `jcOwn` (own string props) + DB CHECK on `look`; ring class from an integer index |
| S2 | Low | `allergy_friendly` not validated server-side (`jc_schema_check` ignores unknown keys) | **Deferred** → next events DB PR: array ≤ 20 strings, members of `values`, enum + `pin = 'glyph'` only. Client reads it via `Array.isArray` + `indexOf` (boolean → one class); 8 KB schema cap applies |
| S3 | Low | Tests didn't cover hostile choice labels in the key, hostile / `__proto__` look, non-array `allergy_friendly` | **Fixed** — two tests |
| C1 | Med | Two-emoji icons (🍬🎃, 🥜🧡) clipped by `overflow:hidden` in a 30 px pin | **Fixed** — grapheme count (`Intl.Segmenter`) → `.multi` 11 px (13 px on your own pin), clip removed; test checks the icon's box sits inside the pin |
| C2 | Med | Done / reported pins replace the allergy icon with ✕ / ? | **Accepted** — Halloween parity (🚫 replaced the icon); state must not be colour-only; the popup + list still show the icon |
| C3 | Low | Ring colours repeat after 6 choices; an answer outside `values` gets the ink border ≈ ring 0 | **Accepted** — no template has > 3 ring choices; revisit if organizers use more (builder cap) |
| C4 | Low | `--jc-ring-5` (#111) invisible on the dark reported pin | **Accepted** — only with a 6th ring choice |
| C5 | Low | Tests checked the `teal` class, not the computed filter | **Fixed** — asserts `hue-rotate` is applied |
| — | Info | data-look leaks, fitMap math, venue events, builder round-trip, divIcon anchors, token guardrail | Checked by the reviewer: fine |

**Pre-existing flake (not this PR):** `feedback.spec.js` "hub feedback link isn't duplicated by a language
switch" fails ~2–8 % of runs — reproduced on a clean `main` worktree (2/60) and on this branch (5/60); the
hub isn't touched here. **Deferred** — fix in a separate test-only PR.

**Tests:** stubbed Playwright **207 / 207** twice (191 before; 16 new in `specs/looks-pins.spec.js`; 4
selectors in `events.spec.js` moved from SVG circles to marker icons; pin fixtures shared in `backends.js` so
`/shot` can show `events/?id=8888…` Halloween and `?id=9999…` Haq al Laila). Mutation check: removing
`esc()` from the icon fails the XSS test. Screens checked with `/shot` (EN + AR).
