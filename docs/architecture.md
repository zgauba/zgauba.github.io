# Jubail Trick-or-Treat — Stack Manifest

```
APP: zgauba.github.io (Jubail Commons monorepo)
PRIMARY PURPOSE: Community trick-or-treat sign-up/map for Jubail Island events
LAST VERIFIED: 2026-11-02 (monorepo consolidation; Halloween layers verified, Commons not yet built)
SOURCE-OF-TRUTH POLICY:
  [live] = queried from running infra. Re-query before assuming.
  [repo] = derived from source code at this commit.
  When [live] and [repo] disagree, the live system wins.
```

---

## LAYER — FRONTEND
- [repo] Single-file app `index.html` (vanilla JS, string concat, no build) + `dashboard.html` (event stats).
- [repo] Leaflet map: Esri World Imagery default (no key) + OSM street toggle (dark CSS filter).
- [repo] PWA: `manifest` + pass-through service worker; iOS home-screen storage is separate from Safari (control-link paste box exists for this).
- [repo] Auto-reload: pages HEAD-poll own URL every 2 min, compare ETag, reload when idle (deferred with toast mid-form).
- [repo] Broadcast banner: polls `jh_broadcast_get` every 60s; red site-wide alert.

## LAYER — BACKEND / API
- [live] Supabase project **SignalPost** (`hrdmhifeynnokzjqtlsa`), shared with unrelated systems — Jubail tables are prefixed `jh_`.
- [live] All access via `security definer` RPCs granted to `anon`; REST base `https://hrdmhifeynnokzjqtlsa.supabase.co/rest/v1/rpc/`.
- [live] Public RPCs: jh_list, jh_signup (passcode-gated), jh_set_candy, jh_set_handout, jh_set_entrance, jh_set_treats, jh_set_details, jh_update_location, jh_remove, jh_get_note, jh_ack_note, jh_stats_list, jh_broadcast_get.
- [live] Admin RPCs (organizer-code-gated): jh_admin_list (returns edit tokens), jh_admin_set_candy, jh_admin_set_entrance, jh_admin_set_note, jh_admin_set_removed, jh_admin_set_location, jh_admin_set_broadcast, jh_admin_set_passcode, jh_admin_new_season.
- [live] pg_cron: `jh-hourly-snapshot` (minute 5) → `jh_snapshot()` → `jh_stats`.
- ⚠ RULE: never change `jh_signup`'s signature — add follow-up RPCs instead.

## LAYER — DATABASE
- [live] Tables: `jh_homes` (unit, village, lat/lng, candy/handout/entrance/treats, notes, season, edit_token, removed, created_at), `jh_settings` (passcode, organizer code, broadcast), `jh_stats` (hourly snapshots; `both_kinds` — `both` is a Postgres reserved word).
- [live] RLS: deny-all on all tables; RPCs are the only access path.
- [live] Season model: rows tagged by `season` ('2026'); "New season" archives by tag; 500-entry cap per season.
- ⚠ GAP: schema SQL exists only as Supabase migration history + ops doc — not in git.

## LAYER — AUTH & SESSIONS
- [repo] No accounts, no auth provider. Per-entry `edit_token` (control link `?m=<id>~<token>`), organizer code for admin RPCs, sign-up passcode. Zero-PII by design (see CLAUDE.md).
- Secrets live in `jh_settings` and the private ops doc — never in this repo.

## LAYER — EXTERNAL APIs
- [repo] Esri World Imagery tiles (free, keyless); OSM tiles (street toggle). Nothing else third-party. No analytics/trackers by promise.

## LAYER — OBSERVABILITY
- [live] None by design on the client. Server proxy: Supabase edge logs (~24h retention) via ClickHouse SQL (`logs` table, `source='edge_logs'`, `log_attributes['request.headers.cf_connecting_ip']`).
- [live] `jh_stats` hourly snapshots power time-series charts.

## LAYER — CI / CD
- [live] GitHub Actions Pages workflow; push to `main` → deploy; ~10 min CDN cache. Verify via `gh api .../actions/runs`.

## LAYER — SECRETS & ENV VARS
- [repo] Supabase publishable anon key embedded in HTML — public by design.
- [live] Organizer code + passcode in `jh_settings` (organizer code changeable only via SQL).

---

## Known gaps & drift

1. **Schema not in git** — Supabase SQL (tables, RPCs, cron) lives only in Supabase migration history; to be fixed in the `jubail-events` rebuild (supabase/migrations/ in-repo).
2. **Print button hidden** (`display:none`, listener still bound) pending community privacy consensus.
3. **Unused `non_food` column** on jh_homes (superseded by `treats`); `jh_set_nonfood` grant revoked but function may linger.
4. **Repo will be superseded** by `jubail-events` (Nov 2026 rebuild); this page becomes a redirect stub — don't invest in structural changes here.

---

## MONOREPO NOTE (2026-11-02)

This manifest was written for the Halloween app, now at `jubail-halloween/` in this repo (moved from the retired `zgauba/jubail-halloween` repo — identical serving URL). The **Jubail Commons** rebuild (`commons/`, tables `jc_*`, migrations in `supabase/migrations/`) gets its own layers here as it's built. Personal pages (`/`, `/jubail/`) are static HTML with no backend — no layers needed.
