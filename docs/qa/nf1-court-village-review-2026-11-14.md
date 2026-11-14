# NF-1 — courts get a village · review 2026-11-14

Branch `feat/court-village`. Tier 3 (schema + RPC bodies). Plan: `docs/plans/nearest-first.md` "NF-1" (Zee decisions 2026-11-14).
Migration `supabase/commons/migrations/20261114100000_nf1_court_village.sql`, test slice `tests/sql/s25_court_village.test.sql`.
Reviewers: `database-reviewer` and `security-reviewer`, both read-only, 2026-11-14. **Both APPROVE.**

## Scope

- `jc_facilities.village_key` is nullable, with a foreign key on `(community_id, village_key)` → `jc_villages`, the same pair homes use. Null means Whole community.
- The village says **where** a court is. It never limits who may book.
- Bodies only, no signature change:
  - `jc_admin_facility_save` accepts `village_key` (string or null; null / "" clears; an unknown or other-community village gives `BAD_FIELDS`).
  - `jc_admin_facilities_list` and `jc_facilities_list` return it.
- **Organizer court editor:** a Village picker ("Whole community" plus delivered villages). It sends only a change. The court card shows the village.

## Pre-apply checks

- **Drift:** the live `pg_get_functiondef` for the three functions was diffed line by line against the migration. Every difference is an NF-1 line (plus the comma it needs).
- **Table access:** `jc_facilities` has no grants to `anon` / `authenticated` and no policies, so it is read only through the definer functions.
- **Secrets:** none in the files. The `S25-*` codes and `@s25.test` users are throwaway fixtures in `testville25` / `25b`, rolled back.

## Database review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Info | Locking: `ADD COLUMN` without a default is metadata-only, and the foreign key validates a few null rows | Accepted, no change |
| 2–4 | Info | Foreign key shape, NO ACTION on village delete (nothing deletes villages), `foreign_key_violation` can't hide another error in that block | Verified, no change |
| 5 | Low | C08a only checked that some error happened | **Fixed.** It now requires `foreign_key_violation` |
| 6 | Low | C07 only checked that some error happened | **Fixed.** It now requires `NOT_ADMIN` |
| 7 | Low | Missing cases: trim, upper case, editable with upcoming bookings | **Fixed.** C09a trim, C09b `North` → `BAD_FIELDS`, C09c changeable with a booking upcoming |
| 8 | Low | The log names fields, not values | **Accepted** (same as every court field). C09f checks `village_key` is logged |
| 9–11 | Info | No `select *` / row-type breakage; no index needed; body logic | Verified, no change |

## Security review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Low | The baseline was the repo bodies, not live | **Done.** Live drift check, see above |
| 2 | Low | Table grants / policies unknown | **Done.** No grants, no policies |
| 3 | Low | No test that the village doesn't restrict booking | **Fixed.** C09c: a resident from the south village books the north court |
| 4 | Low | C07 loose | **Fixed** (same as database review 6) |
| 5 | Low | No test of another community's admin | **Fixed.** C09d/e: that admin gets `NOT_FOUND` and nothing changes |
| 6–8 | Info | Future foreign keys report as `BAD_FIELDS`; upcoming or sub-area villages allowed; trim / case behaviour | Accepted. The editor offers delivered villages only (plus the court's own) |

## Tests

- **SQL dry run** (migration + full suite, rolled back): **ALL_TESTS_PASSED (1291 checks)**. That is 1268 before plus 23 in `s25`.
  - The first run was 1285. The review hardening added 6.
  - After each run, a live check showed no column, no constraint and no fixtures persisted.
- **e2e:**
  - New test: the Village picker (options, only a change sent, clear to Whole community, card shows the village).
  - The new-court test now expects `village_key: ""`.
  - The admin-courts list assertion includes "Whole community".
  - Court specs (admin-courts, admin-courtday, courts, section-names): **206/206**, both browsers.
  - Full suite, both browsers: **1194/1194**.

## Carry-overs

- **NF-2:** residents see the village on court cards, plus the shared "Sorted by" control.
- **NF-3:** organizer A–Z by village.

## Applied (2026-11-14, on Zee's "apply")

- One transaction plus history row `20261114100000 nf1_court_village`.
- Live suite with no migration: **ALL_TESTS_PASSED (1291 checks)**.
- Live checks: column nullable, `jc_facilities_village_fk` present, no `testville` fixtures left.
- Advisors: authenticated 98 / anon 3, no new lint kinds.
