# T5.2 PR 6 — App Health + notices — review (2026-11-05)

**Plan:** `docs/plans/T5-2-plan.md` PR 6 ("Reports panel — `jc_admin_report`"). Inventory (live, 2026-11-05):
`jc_admin_report` is a platform health check, not an events report (hourly snapshot age, its cron job, two nightly
cleanup jobs, wrong-code counters, rate-limit lockouts, 24 h state-log activity, page views + broken-counter flag,
storage vs 1 GB, open notices count); `jc_admin_notices_list` / `jc_admin_notice_resolve` exist live, unused by any
screen. All three `jc_assert_admin('community')`, authenticated only. **No migration.**

**Zee decisions (2026-11-05):** approve; notices listed on the same screen with "Mark Resolved"; platform-wide numbers
labelled "whole platform" now, split per community in a later DB PR before a second community gets an admin.
**Design rule:** every check starts as "couldn't check" — a missing or unexpected value never shows ✅ / "All good".

**Scope:** `admin/admin.js` (`VIEWS.health`, `loadHealth`, `healthChecks`, `noticeHome`, helpers; "App Health &
Notices" button for community admins; back → Organizer Tools), `admin.css`, `strings.js` (EN + AR `adm_h_*`), tests
(`specs/admin-health.spec.js`; `healthReport()` + `NOTICES` stubs shaped like the live RPCs).

**Reviewers:** security-reviewer + code-reviewer, on commit 3c29d64 (pre-fix).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S — | — | XSS (cron message, job error, raw state-log key, home labels), notice `detail` (account ids), cross-community leaks beyond the three accepted, client vs server gating, fixtures | **None found** — all through `esc()`; only `id / kind / home / created_at` read; notices + resolve scoped by community; inner functions not executable by clients |
| H-1 (sec) | Low | Cron failure text is raw Postgres error output (may name tables; a DETAIL line could carry an id) — community admins only | **Deferred** → next DB PR: trim at `DETAIL:` / `CONTEXT:` |
| H-2 (sec) | Info | Platform-wide: join lockouts, both wrong-code counters, storage | **Accepted** (Zee) — labelled; split before a second community admin |
| H1 | Med | Traffic ✅ when `counter_suspect` missing | **Fixed** — ok only when `false`; test |
| H2 | Med | Cleanup job ✅ when `error` missing; "0 removed" invented | **Fixed** — ok needs `error === null` + numeric `affected`; test |
| H3 | Med | "All good" while notices failed to load | **Fixed** — counts as an issue; test |
| H4 | Med | A null notice row threw → stuck on "Working…" | **Fixed** — malformed rows filtered; load failure → "couldn't run the checks"; test |
| H5 | Med | Check Again during Mark Resolved → TypeError → wrong error | **Fixed** — resolve writes to the snapshot it started from; Check Again waits |
| H6 | Low | Out-of-order resolves; NOT_FOUND dead end | **Fixed** — one resolve at a time; NOT_FOUND reloads the list; test |
| H7 | Low | Ages from the phone clock; future times passed as fresh | **Fixed** — measured against the server's `generated_at`; > 5 min in the future = couldn't check; test |
| H8 | Low | Notice without a numeric id → `p_id: null` | **Fixed** — filtered (safe integers only) |
| H9 | Low | Activity "No changes." from non-numeric values | **Fixed** — couldn't check |
| H10 | Low | `snapshot: {}` read as "no copy yet" | **Fixed** — needs `last_at === null` and `stale === true` |
| H11 | Low | "Invalid Date"; "Villa {n}" for a missing number | **Fixed** — `hDate`; "Home no longer listed" |
| H12 | Low | Cron "succeeded" ✅ at any age | **Fixed** — over 3 h since the last run = needs a look |
| T1 | Low | Missing tests (above) + Check Again test didn't prove a re-render | **Fixed** — 7 tests added; Check Again changes the report between loads |

**Tests:** stubbed Playwright **250 / 250** twice (236 after 5b.1; 14 in `admin-health.spec.js`). Mutation checks —
each makes its test fail: an odd backup value shown ✅, the failure note un-escaped, Mark Resolved not updating the
list. Screens checked with `/shot` (EN + AR); Arabic showed "MB 3.2" → sizes isolated left-to-right.
