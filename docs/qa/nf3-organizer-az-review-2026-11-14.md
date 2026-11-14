# NF-3 — Organizer Tools A–Z: review (2026-11-14)

Tier 2 (screen logic, no database change). Plan: `docs/plans/nearest-first.md` § NF-3. Reviewer: `code-reviewer` agent (read-only, on the uncommitted diff). Verdict: **APPROVE**. 0 critical, 0 high, 0 medium, 2 low (tests) plus 1 informational note.

## What changed

- **`commons/assets/api.js`:**
  - `jcVillageCmp(cfg)` gives villages A–Z by their shown name, in the page's language. No village (Whole community) comes first.
  - `jcHomeNumCmp` is the house-number order (building, then number, 9 before 10), moved verbatim from `events.js` `byNumber`.
- **Organizer Courts:** Whole community first, then villages A–Z, then the court's name in the page's language. The manual `sort` number no longer sets the display order (Zee's decision). Retired courts stay apart, in the same order.
- **Households:** villages A–Z instead of the community's config order. A village the config doesn't list still shows, in its alphabetical place. Homes inside a village go by building, then number.
- **Sign-ups and the resident Events List:** the same comparators. Their behaviour is unchanged.
- Pets organizer lists come with R5d (as planned).

## Findings and disposition

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | LOW | No test proves the page's language is used. A hard-coded `"en"` compare would have passed every test. | **Fixed.** Added "NF-3 in Arabic", which mixes an Arabic-named and a Latin-named court: in Arabic, Arabic script sorts first. It was verified to **fail** with `"en"` swapped in and to pass with `jcLang()`. |
| 2 | LOW | In the Households fixture, raw-key order and shown-name order agree, so a comparator ordering by key would also pass. | **Kept.** The test still separates the old config order from A–Z. Finding 1's test proves the compare uses the shown name and the language. |
| 3 | info | `api.js` is unversioned. A stale cached `api.js` paired with a fresh `admin.js` would throw `jcVillageCmp is not defined`. | **Kept.** This is the same exposure as every earlier `api.js` addition. `update.js` reloads the open pages after a deploy. Post-deploy check: open Organizer Tools → Courts and Households. |

Checked and fine (reviewer): the comparator is consistent across null, "" and undefined; every caller uses the factory correctly; nothing else depended on the config order; Households focus, scroll and `hh.open` work by id, never by position.

## Verification

- **New tests:** Courts ×2 (English A–Z ignoring `sort`; Arabic order) and Households ×1 (villages A–Z, building then number). All three were verified to **fail on the old code** and pass on the new.
- **Affected specs locally:** admin-courts, admin-households, admin-signups, admin, events: 378 passed, plus the new tests. The full suite runs in CI.
