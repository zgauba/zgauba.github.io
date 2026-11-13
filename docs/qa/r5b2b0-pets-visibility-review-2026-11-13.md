# R5b-2b-0 — pets visibility / out-alone / nearest-first / alerts — review 2026-11-13

**Scope:** `supabase/commons/migrations/20261113100000_r5b2b0_pets_visibility.sql`, new slice
`tests/sql/s24_pets_visibility.test.sql`, superseded checks updated in `s4_pets` (P06a), `s21_pets_r5` (R05a/R05a2/R05c),
`00_grants` (+ `jc_pets_alerts`). Plan: `docs/plans/R5b-2-pets-maps.md` "Re-plan 2026-11-13" (Zee approved, Q1 = 24 h before).
**Tier 3** (visibility of resident reports). Reviewers: `database-reviewer`, `security-reviewer` (both read-only, foreground gate).

## Results

| Run | Result |
|---|---|
| Dry run 1 (migration + full suite, rolled back) | `ALL_TESTS_PASSED (1263 checks)` (was 1228 live) |
| Mutation: neighbours see everything while missing | caught — `FAIL V03a` |
| Mutation: everyone sees everything | caught — `FAIL R05a2` |
| Dry run 2 (after review fixes) | `ALL_TESTS_PASSED (1268 checks)` |
| Persistence check after dry runs | new functions 0, bodies unchanged, fixtures 0, test users 0, history row 0 |

Both reviewers: **no leak of a household-only sighting to a neighbour or another community; nothing Critical / High.**

## Findings and disposition

| # | Sev | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | Med | DB + Sec | DOWN note named `r5b_pet_home_type` for `jc_pet_card`; that body reads columns HH dropped → rollback would fail | **Fixed** — DOWN points at `20261111160000_hh_remove_home_hiding.sql:233` |
| 2 | Med | DB (Sec: Info) | `seen_out` still fires for a sighting logged while missing after the pet is found (`missing_since` cleared; no `found_at`) | **Accepted** — the household just marked it found; client copy "If {name} is home, you can ignore this" (R5b-2b-2b). Comment in migration E; pinned by test V08i |
| 3 | Med | DB | Disclosure drift: R5a's disclosed amendment says sightings only for missing pets / strays; rule B widens it | **Deferred to R5b-2b-2b** (same plan) — no client path to an out-alone report exists until that PR, which ships the disclosure (privacy line, `help_pets_3`, manifest R5a note) before the button |
| 4 | Low / Info | DB + Sec | Nearest-first is a pin oracle (move own pin, re-sort) | **Accepted** — no marginal exposure: `jc_directory_list` already returns every home's pin to members. **Dependency recorded in the plan:** if home pins are ever hidden again, re-review this order (bucket or drop) |
| 5 | Low | DB + Sec | Harassment: any resident can file out-alone reports (5/pet/day) → household alert they can't dismiss | **Accepted for now** — reporter never shown, caps, Pets-admin hide (`jc_admin_sighting_hide`). Household "dismiss" idea → plan backlog |
| 6 | Low | Sec | Out-alone lat/lng only bounds-checked, not clamped to the community area | **Deferred** (pre-existing for all sightings) → plan backlog |
| 7 | Low | Sec | `jc_admin_has` not community-scoped | **Accepted + comment** — one community per account (`jc_me`); every caller pre-filters by community |
| 8 | Low | DB | Per-row `jc_admin_has` / card cost | **Accepted** — indexed, ~hundreds of pets |
| 9 | Low | DB | New functions plain `create` (not re-run safe) | **Fixed** — `create or replace` |
| 10 | Low | DB | V07b passed even if `last_seen` ignored | **Fixed** — Snow's territory now the farthest; only her sighting puts her first |
| 11 | Low | DB + Sec | Test gaps: null-distance last; V04 alerts; other-community list; admin list card; neighbour list card while missing; after-found seen_out | **Fixed** — Bo (unpinned home) sorts last (V07a/c/d), V08h hidden sighting not in seen_out, V08g other community lists nothing, V01i admin list card, V03f neighbour list card, V08i after-found pinned |
| 12 | Info | Sec | No test for `missing` with null `missing_since` | **N/A** — table check `missing = (missing_since is not null)` makes the state impossible |
| 13 | Info | Sec | No new test for the 5/pet/day cap on out-alone reports | **Accepted** — cap code unchanged, covered by existing slices |
