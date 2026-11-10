# RM-a review — renamable modules (DB) — 2026-11-10

Scope: `supabase/commons/migrations/20261110120000_rm_module_labels.sql`, `tests/sql/s22_module_labels.test.sql`,
`tests/sql/00_grants.test.sql`. Plan: `docs/plans/RM-renamable-modules.md` (Zee approved Q1–Q5).
Reviewers: `database-reviewer`, `security-reviewer` (static, before apply). Tier 3 (data / auth).

## Tests

| Run | Result |
|---|---|
| Dry run 1 (before review) | `ALL_TESTS_PASSED (1188 checks)` |
| Dry run after fixes, run 1 | `ALL_TESTS_PASSED (1210 checks)` |
| Dry run after fixes, run 2 | `ALL_TESTS_PASSED (1210 checks)` |
| Persistence check (live) | no function, column, test community or test user left behind |

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| DB-1 / SEC-M2 | Medium | Uniqueness only checked other modules' *custom* names: a module could take another's built-in name ("Events") or a fixed app label ("My Home", "Organizer Tools") | **Fixed** — `RESERVED_NAME`: every other module's built-in name + fixed app labels, EN + AR, case- and space-insensitive (s22 L13a–f) |
| DB-2 | Medium | No test that `jc_config_get` keeps its other keys | **Fixed** — exact key set + village/map values (L15) |
| SEC-M1 | Medium | `jc_clean_line` misses some invisibles (U+2060–2064, U+3164, NBSP, variation selectors, tags…) | **Fixed** — per-field allow-lists → `BAD_CHARS` (Latin incl. accented; Arabic letters without tashkeel/tatweel; titles add basic punctuation); inner spaces collapsed (L11c, L12a–h). Shared `jc_clean_line` left unchanged |
| DB-3 | Low | Whole-entry replace semantics unpinned | **Fixed** — documented in the function comment; L11a–b |
| DB-4 | Low | Lock placement | **No change** — correct; comment added that the lock must stay before the NAME_TAKEN read |
| DB-5 | Low | Normalisation (double spaces, tashkeel) | **Fixed** — spaces collapsed; tashkeel/tatweel refused by the allow-list |
| DB-6 | Low | Null caps clarity | **Fixed** — `coalesce(char_length(...), 0)` |
| DB-7 | Low | Test gaps: refusal leaves labels unchanged; reset of an unset module | **Fixed** — L14a–b. Per-person `community` grant path is already covered by s18/s19 |
| DB-8 | Low | Seed is a silent no-op if the id differs | **Verify after apply** — `select module_labels from jc_communities where id='jubail'` |
| SEC-L1 | Low | `jc_assert_admin` grant lookup doesn't filter `g.community_id = v_comm` (latent cross-community, not exploitable with one community per account) | **Deferred** — pre-existing function; backlog item added (multi-community hardening, own migration + test) |
| SEC-L2 / DB-11 | Low/Info | Log can't trace a defacement | **Fixed** — log carries an 8-char md5 `ref` of the new entry (never the text) |
| SEC-L3 | Low | No DB-level size bound on the anon-readable column | **Fixed** — check `octet_length(module_labels::text) <= 4096` (L16) |
| SEC-I3 | Info | Client must escape names in `aria-label` / `document.title` and isolate direction | **RM-b checklist** — `esc()`/`textContent` everywhere, `dir="auto"` on label elements |
| DB-9, 10, 12; SEC-I1, I2 | Info | Column add, grants, rollback order, anon read | No change |

## Found during the fixes

- The built-in Arabic Pets label «الحيوانات الأليفة» is **17** characters, longer than the planned 14-character cap. The Arabic
  name cap is now **18** (English stays 14). RM-b must check the AR bar still fits on a 360 px phone.
