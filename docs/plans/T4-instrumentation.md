# T4 — Day-one instrumentation (observe → detect → clean up)

> Status: **APPROVED 2026-11-03** (Zee: D1 split into T4a/T4b/T4c, D2 GitHub Actions canary).
> Source: `docs/qa/SYNTHESIS-2026-11-03.md` T4 + KG9, KG10, KG12.
> Reviews: `docs/qa/T4-review-2026-11-03.md`.

## Why the split

The synthesis put the canary "in the Reports panel" — a T5 screen that doesn't exist yet.
A canary nobody can see is the silent failure it was meant to catch. And the deletes
(pet photos) need the Storage API, which SQL cannot reach — a different layer.

| PR | Scope | Layers |
|---|---|---|
| T4a + T4b (one PR — T4a isn't done without T4b) | hourly snapshots, admin health report, landing visit counter; anon `jc_health` probe + GitHub Actions canary every 6 h | DB, cron, frontend (1 call), CI |
| T4c | orphan auth-user purge; pet-photo purge via Edge Function | DB, cron, pg_net, Edge Function, Storage |

## T4a — observe

- `pg_cron` enabled in its **own** migration. Supabase's event trigger re-runs its cron
  grant script on every `CREATE EXTENSION` (even `IF NOT EXISTS`); a second run fails with
  "dependent privileges exist". Same for `pg_net`. Never repeat those files.
- `jc_snapshot_run()` — cron `jc-hourly-snapshot` at :05 UTC. One row per community ×
  module × hour (homes, accounts, events, bookings, pets, traffic); upsert ⇒ idempotent.
  Writes even for modules that are off, with `enabled` recorded: "ran, nothing to count"
  ≠ "didn't run".
- `jc_admin_report()` (community admin): snapshot age + stale (> 2 h), cron job present /
  active / last failure, failure counters **minus a baseline** recorded at migration
  (dry runs had left 35 admin / 38 join of noise), lock-outs, 24 h state-log summary, open
  notices, hits vs accounts (silent-counter flag), storage bytes vs 1 GB (alert at 80 %).
- Landing calls `jc_hit('jubail','landing')`, fire-and-forget.

## T4b — detect

- `jc_health(p_community)` (anon): `{ok, cron_active, snapshot_age_minutes}` — nothing else.
  `ok` = job active and a snapshot within 3 h.
- `.github/workflows/commons-canary.yml`, every 6 h + manual: fails when `ok` is false or
  the API is unreachable (e.g. paused project), and when any of `net`, `cron`, `vault`,
  `jc_private` stops returning 406 (exposed by a dashboard change). A failed scheduled run
  emails the repo owner.

## T4c — clean up

- `jc_purge_orphan_users()` — cron `jc-orphan-users` daily 03:15 UTC: deletes auth users
  with no `jc_accounts` row, created 30+ days ago and idle 30+ days.
- Pet photos — cron `jc-photo-purge` daily 03:35 UTC → `pg_net` → Edge Function
  `jc-photo-purge` (`verify_jwt=false`; gate = `x-jc-cron` header vs Vault secret
  `jc_cron_token`) → `jc_photo_purge_queue` → Storage API remove → `jc_photo_purge_done`.
  Due: retired rows, and pending rows older than 1 h.
- `jc_maintenance_log` records every run (affected + first error); the report flags a job
  that hasn't logged in 36 h.

## Premortem

| # | Mode | Mitigation |
|---|---|---|
| 2 | Cron silently stops / project pauses | Report: snapshot age, job state, last failure. Outside: canary every 6 h. |
| 2 | Counter silently stops | Report flags accounts > 0 with 0 hits in 24 h. |
| 2 | Purge never fires | `jc_maintenance_log` + report stale flag (36 h). |
| 1 | Wrong counts / wrong rows deleted | s6 asserts exact counts; s7 asserts only the old idle orphan is deleted and only due photo paths are marked. |
| 2b | Job unscheduled in the dashboard; internal schema exposed | Report reads `cron.job`; canary probes schema exposure. |
| 5 | Double fire; photo committed between queue and done | Upsert per bucket; `done` re-checks due-ness before marking. |
| 6 | New surface | anon + `jc_health` only (thin); `jc_admin_report` admin-only; purge RPCs service-role only; pg_net/cron PUBLIC execute unremovable but schemas unexposed (canary-checked). |
| 3 | Cost | $0: ~52.6k snapshot rows/yr (6 × 24 × 365), ≤ 70k hit rows/yr; 1 Edge Function call/day. |
| 7 | Rollback | Unschedule the three jobs; drop the functions/tables listed in each migration header; delete the Edge Function. |

## Known residuals

- Dry runs still advance the failure counters after the baseline — run them sparingly
  post-launch.
- GitHub disables scheduled workflows after 60 days without repo activity (public repos).
- Whether the canary's traffic keeps the free-tier project from auto-pausing is unverified
  (KG8 stays a T6 decision).
