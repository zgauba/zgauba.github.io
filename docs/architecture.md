# zgauba.github.io — Jubail Commons monorepo — Stack Manifest

```
APP: zgauba.github.io (Jubail Commons monorepo)
PRIMARY PURPOSE: Zee's networking pages + Jubail Island community tools
  (Halloween trick-or-treat map live; Jubail Commons platform in rebuild)
LAST VERIFIED: 2026-11-02 (/manifest refresh — every [live] fact below re-queried
  from running infra this date; Commons landing now live at /commons/, modules not yet built)
COST-BEARING LAYERS: none — GitHub Pages, Supabase free tier, keyless map tiles.
SOURCE-OF-TRUTH POLICY:
  [live] = queried from running infra. Re-query before assuming.
  [repo] = derived from source code at this commit.
  When [live] and [repo] disagree, the live system wins.
```

---

## SECTION — PERSONAL PAGES (`/`, `/jubail/`)

- [repo] Static HTML, no backend, no JS beyond none — no layers needed. Same page differing only in the middle section (see CLAUDE.md section rules).
- ⚠ Stats on `/jubail/` ("122 homes") predate the event's final numbers — update pending.

## SECTION — HALLOWEEN SITE (`jubail-halloween/`) — legacy, live

### LAYER — FRONTEND
- [repo] `jubail-halloween/index.html` (single-file app, vanilla JS, string concat, no build) + `jubail-halloween/dashboard.html` (event stats; traffic chart baked, home tiles live via `jh_list`).
- [repo] Leaflet map: Esri World Imagery default (no key) + OSM street toggle (dark CSS filter).
- [repo] PWA: manifest + pass-through service worker; iOS home-screen storage is separate from Safari (control-link paste box exists for this).
- [repo] Auto-reload: pages HEAD-poll own URL every 2 min, compare ETag, reload when idle (deferred with toast mid-form).
- [repo] Broadcast banner: polls `jh_broadcast_get` every 60s; red site-wide alert.
- [repo] All user-supplied strings HTML-escaped at render (`esc()` in both pages).

### LAYER — BACKEND / API
- [live] Supabase project **SignalPost** (`hrdmhifeynnokzjqtlsa`) — Jubail tables are prefixed `jh_`.
- [live] All access via `security definer` RPCs (all pin `search_path=public`); REST base `https://hrdmhifeynnokzjqtlsa.supabase.co/rest/v1/rpc/`.
- [live] Public RPCs (anon): jh_list, jh_signup (passcode-gated), jh_set_candy, jh_set_handout, jh_set_entrance, jh_set_treats, jh_set_details, jh_update_location, jh_remove, jh_get_note, jh_ack_note, jh_stats_list, jh_broadcast_get.
- [live] Admin RPCs: organizer-code-gated; enumerated in the private ops doc, not here. Failed code checks are tar-pitted (1.5s sleep before BAD_ADMIN) and counted via the `jh_admin_fail_count` sequence (sequences survive the failed transaction's rollback) — see `supabase/signalpost/migrations/20261102170000_jh_admin_tarpit.sql`.
- [live] Internal-only (no anon/authenticated execute): jh_snapshot (pg_cron), jh_assert_admin, jh_backfill_prefixes, jh_set_nonfood (superseded).
- [live] pg_cron: `jh-hourly-snapshot` (minute 5, active; last success 2026-11-02 16:05 UTC — fired cleanly after the RLS lockdown) → `jh_snapshot()` → `jh_stats`. Unschedule at season close-out.
- [live] No other table or RPC in this Supabase project is anon/authenticated-accessible (verified 2026-11-02).
- ⚠ RULE: never change `jh_signup`'s signature — add follow-up RPCs instead.

### LAYER — DATABASE
- [live] Tables: `jh_homes` (unit, village, lat/lng, candy/handout/entrance/treats, notes, season, edit_token, removed, created_at), `jh_settings` (key/value: passcode, admin_code, season, broadcast), `jh_stats` (hourly snapshots; `both_kinds` — `both` is a Postgres reserved word).
- [live] RLS enabled, zero policies (deny-all) on all three `jh_` tables; no anon/authenticated table grants. RPCs are the only access path. (`jh_stats` brought into line 2026-11-02 — see `supabase/signalpost/migrations/20261102160000_jh_stats_rls_lockdown.sql`.)
- [live] Season model: rows tagged by `season` ('2026'); "New season" relabels the active season; 500-entry cap per season.
- [live] Check constraints on home_type/handout/entrance; treats validated in RPC.

### LAYER — AUTH & SESSIONS
- [repo] No accounts, no auth provider. Per-entry `edit_token` (control link `?m=<id>~<token>`), organizer code for admin RPCs, sign-up passcode. Zero-PII by design (see CLAUDE.md).
- Secrets live in `jh_settings` and the private ops doc — never in this repo.

### LAYER — EXTERNAL APIs
- [repo] Esri World Imagery tiles (free, keyless); OSM tiles (street toggle). Nothing else third-party. No analytics/trackers by promise.

### LAYER — OBSERVABILITY
- [live] None by design on the client. Server-side: Supabase edge logs (~24h retention) are the only traffic proxy; query recipes live in the private ops doc.
- [live] `jh_stats` hourly snapshots (read via `jh_stats_list`).

## SECTION — COMMONS (`commons/`) — landing live, modules not yet built

- **Decision (2026-11-02): Commons gets its OWN Supabase project** — **JubailCommons** (`qrpxfssdeeuzmsmlbtbu`, ap-south-1, created 2026-11-02). `jc_` prefix retained for clarity; migrations land in `supabase/commons/migrations/` here. Repo layout: one dir per remote project (`supabase/signalpost/`, `supabase/commons/`) so a migration can never be applied to the wrong database.
- Per-community config + per-module feature flags, EN/AR + RTL, optional-PII identity slots — see `docs/plans/backlog.md`.

## LAYER — CI / CD (whole repo)

- [live] GitHub Pages user site (legacy build) serving `main` root; push → deploy, ~10 min CDN cache. Verify via `gh api repos/zgauba/zgauba.github.io/actions/runs`.
- [live] Old `zgauba/jubail-halloween` repo: Pages disabled + archived 2026-11-02; the `jubail-halloween/` folder now serves the identical URL.
- [repo] One Pages build serves everything — career page shares blast radius with community-app pushes.
- Note: the whole repo is served verbatim (this file is a public URL) — docs here must stay sanitized.

## LAYER — SECRETS & ENV VARS

- [repo] Supabase publishable anon key embedded in HTML — public by design.
- [live] Organizer code + passcode in `jh_settings` (organizer code changeable only via SQL).

---

## Known gaps & drift

1. **Historical `jh_` schema not in git** — only migrations from 2026-11-02 onward are mirrored into `supabase/signalpost/migrations/`; the ~24 earlier `jh_` migrations exist only in Supabase migration history. Backfill when convenient.
2. **Season close-out pending** (deliberately deferred; do in this order): bake final village/treats numbers into dashboard.html → Export CSV → delete season-2026 rows (honors the "deleted after the season" promise) → new season label → unschedule `jh-hourly-snapshot`.
3. **Print button hidden** (`display:none`, listener still bound) pending community privacy consensus.
4. **Unused `non_food` column** on jh_homes (superseded by `treats`); `jh_set_nonfood` grant revoked but function lingers.
5. **Bio-page stats stale** — `/jubail/` says 122 homes; reconcile final count (live DB: 124 active + 3 removed; note one-off "Marsa Al jubail" village spelling vs "Marfaa Al Jubail" before quoting a village count).
