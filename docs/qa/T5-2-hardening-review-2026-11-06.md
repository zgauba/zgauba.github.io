# T5.2 hardening migration (`20261106090000_t5_2_hardening`) — review (2026-11-06)

**Asked by Zee (2026-11-06):** "do the database updates" — the items deferred from the T5.2 reviews.
**Target:** JubailCommons (`qrpxfssdeeuzmsmlbtbu`). No signature changes, no grant changes, functions only (no data).

**What it does** (each function re-created from its live `pg_get_functiondef` body + marked changes):
1. `jc_schema_check` — `allergy_friendly` only on the icon question (`pin: glyph`), `ring_split` only on the ring
   question (`pin: ring`): an array of ≤ 20 strings, each one of that question's own choices (5a S2, 5a.1).
2. `jc_entry_reports_clear` — `jc_home_hold` (membership lock), as `jc_entry_live_set` (5b F3).
3. `jc_admin_report` — storage, wrong-code counters and pre-membership join lockouts only for the platform owner;
   other community admins also get the nightly cleanups reduced to ran / stale / failed (no counts, no error text).
4. `jc_admin_report_core` — the cron failure message: labelled tails (DETAIL / CONTEXT / HINT / QUERY / LINE n)
   removed, first line only, ≤ 120 chars (PR 6 H-1).
Client: `admin/admin.js` reads the reduced cleanup shape for non-owners (one test).

**Reviewers:** database-reviewer + security-reviewer (foreground, gate before apply), on the first draft.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| DB-F1 | Low | Trim kept extra lines when no label marker | **Fixed** — `split_part(…, E'\n', 1)`; test H06c |
| DB-F2 | Low | Down note not executable (t4c renamed the t4a function) | **Fixed** — header spells out the real down path |
| SEC-F1 | Med | Reporter-anonymity canary only matched a quoted literal; easy to bypass | **Fixed** — bare-identifier scan over `public` + `jc_private` client-callable functions with an allowlist (`jc_entry_report`, `jc_pet_get`, `jc_pet_sighting_add` — the pets pair use `jc_pet_sightings.reporter` for "by me"), plus structural checks: no table / column privilege, no policy, no client function returning `jc_entry_reports` rows |
| SEC-F2 | Med | "First line only" wasn't literally true; first line can echo input | **Fixed** (as DB-F1). Remaining: a first line like `invalid input syntax … "<value>"` — the job takes no user input; accepted |
| SEC-F3 | Med | `maintenance` (cleanup counts + storage error text) is whole-platform, shown to any community admin | **Fixed** — non-owners get ran / stale / failed only; client updated; tests H05d/e + e2e |
| SEC-F4 | Low | `jc_home_hold` test only checked the function text | **Fixed** — behaviour: an ex-member gets `NO_HOME` (H04c) |
| SEC-F5 | Low | Short-circuit reliance in the array checks | **Accepted** — same pattern as existing code; H02 covers scalars |
| — | — | Owner gate, other inference paths, grants, search_path, existing stored schemas (H03: every live event still passes), regex edge cases (NULL message, no markers) | **Checked clean** |

**Dry run:** `ALL_TESTS_PASSED (658 checks)` (631 before; `s13_hardening` 27, `s6` N07 now runs as a platform
owner). **Nothing persisted:** live definitions unchanged, no `testville*` communities, no fake cron rows, owners
unchanged — checked after both dry runs.
**E2E:** 263 / 263 twice.
