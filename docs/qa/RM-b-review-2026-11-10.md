# RM-b review — renamable modules (client) — 2026-11-10

Scope: `commons/assets/{api,nav,landing,strings}.js`, `commons/assets/tabbar.css`, `commons/{admin,home,events,bookings}/*.js`,
`tests/e2e/specs/section-names.spec.js` (+ two wording updates in `courts.spec.js` / `events.spec.js`).
Server half: RM-a (PR #88, applied). Plan: `docs/plans/RM-renamable-modules.md`. Tier 2 (screen logic; no schema / RPC / auth change).
Reviewer: `code-reviewer` (static). Carries RM-a security SEC-I3 (escape everywhere, isolate direction).

## Tests

| Run | Result |
|---|---|
| Full e2e, Chromium (before review fixes) | 525 passed |
| Full e2e, Chromium (after review fixes) | 530 passed |
| `section-names` + `shell`, WebKit (after fixes) | 32 passed |
| `section-names` + `shell`, Chromium (after the final CSS change) | 32 passed |
| Mutation: bar-fit test without the CSS fix | fails ("My Home is pushed off the screen") |
| Mutation: mid-save Back test without the guard | fails |
| Static check vs the old `bookings.js` | flags 4 lines |

## Found while building (screenshots at 360 px)

- A single long English word ("Neighbourhoods") widened its bar button and pushed **My Home off the screen** — the
  character cap can't prevent it. Fixed in `tabbar.css`: buttons never grow (`min-width:0`), long words break inside the
  button, at most two lines; the page's bottom padding follows the bar's real height (`nav.js`, ResizeObserver).
- WebKit hyphenated "Neigh-bour-hoods" onto three lines → clamped. Hyphenation removed (breaks at a letter instead).

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Medium | `mnSave` redraws Section Names over another screen if Back is tapped mid-save | **Fixed** — callbacks return when `current !== "names"` (the bar still updates); test "Back while a save is in flight" (mutation-checked) |
| 2 | Medium | Bar-fit test couldn't see text clipped by the two-line clamp | **Fixed** — `scrollHeight > clientHeight` counts as spilling (it then caught the WebKit hyphenation bug) |
| 3 | Medium | Bottom padding measured once (fonts, rotation, text zoom) | **Fixed** — ResizeObserver on the bar |
| 4 | Medium | No test for `&` / `'` in names (server allows both) | **Fixed** — bar text, browser title, tab-list and Settings aria-labels asserted literally |
| 5 | Low | Names inside sentences lack bidi isolation | **Accepted** — the server allow-lists keep an EN name Latin-only and an AR name Arabic-only, so a name always matches the sentence's script; titles (AR may include Latin) only appear in `dir="auto"` headings |
| 6 | Low | Organizer Tools Events / Courts group headings, Events back label, hub buttons still built-in | **Fixed** the two headings; back label + buttons → **backlog** ("Buttons follow a renamed section", Zee 2026-11-10) |
| 7 | Low | Static check missed concatenated lookups (`jcT("scope_" + s)`, `jcT(d.label)`…) | **Fixed** — second pattern; deliberate fallbacks marked `RM-ok` |
| 8 | Low | Cache guard needs an id on both sides | **Accepted** — same as `jc_name`; test added: another community's cached names never show |
| 9 | Low | Save buttons look enabled while a save is in flight after a language switch | **Fixed** — rendered disabled while `mnBusy` |
| 10 | Info | No tests for NOT_ADMIN on save / cross-community cache | **Fixed** — both added |
| 11 | Medium | CI `e2e-webkit` (Linux, non-blocking lane; missed in the first PR report — 2026-11-11): the 18-char AR Courts name "ملاعب الجبيل الأول" needed 3 lines in that machine's wider Arabic font and was clamped to "ملاعب الجبيل…". Passed on Chromium CI and macOS WebKit | **Fixed** — `nav.js` `fit()` gives a label the `tight` class only when it would be cut off: 9.5 px instead of 11 px, and up to 3 lines (CI showed 9.5 px alone wasn't enough: that font puts each word on its own line). Measured, so it follows whatever font the phone has; re-runs on `document.fonts.ready`. The bar grows ~8 px only then; the page padding follows. Test "a label that would be cut off gets smaller text instead (wide font)" forces one word per line (word-spacing); mutation-checked both halves (no smaller text / no 3rd line → fails in both browsers). The bar-fit test allows 3 lines only for a shrunk label |

### Re-run after finding 11 (2026-11-11)

| Run | Result |
|---|---|
| Full e2e, Chromium + WebKit (macOS), 9.5 px only | 1061 passed, 1 failed — `courts.spec.js:271` "a failed Private switch…" on WebKit |
| CI `e2e-webkit` (Linux), 9.5 px only | AR Courts name still cut off → 3rd line added; also 3 `courts.spec.js` flakes (271, 475, 589: "navigation interrupted") |
| Full e2e, Chromium + WebKit (macOS), final | **1062 passed** |
| That courts test on the branch **without** this fix, WebKit ×5 | 2 failed / 3 passed → pre-existing WebKit flake, not caused by RM-b's fix; the WebKit lane also fails intermittently on other branches (`fix/slot-mine-blue`); tracked in the backlog |

## Open before launch

- **19 new AR strings** (`adm_mn_*`, `adm_log_module_label_set`, `adm_ad_scope_mod`, name-free off notices, generic Pets
  title) need the native-speaker review (strings.js rule).
