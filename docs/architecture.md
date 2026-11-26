# zgauba.github.io — personal site — Stack Manifest

```
APP: zgauba.github.io (GitHub Pages user site)
PRIMARY PURPOSE: Zeeshan's networking page + the legacy Jubail Halloween 2026 site
  (season closed 2026-11-03; to be retired into Commons before Commons launches)
LAST VERIFIED: 2026-11-26 (Commons split out to zgauba/commons; this manifest trimmed to what stays.
  Commons' own manifest, history and Known gaps now live in that repo's docs/architecture.md.)
COST-BEARING LAYERS: none — GitHub Pages, Supabase free tier (SignalPost).
SOURCE-OF-TRUTH POLICY:
  [live] = queried from running infra. Re-query before assuming.
  [repo] = derived from source code at this commit.
  When [live] and [repo] disagree, the live system wins.
```

---

## SECTION — PERSONAL PAGES (`/`, `/jubail/`)

- [repo] Static HTML, no backend, no JS beyond none — no layers needed. Same page differing only in the middle section (see CLAUDE.md section rules).
- [repo] `/jubail/` shows the final count (124 homes) — fixed in PR #5 (KG 5).

## SECTION — HALLOWEEN SITE (`jubail-halloween/`) — legacy, live, season closed

### LAYER — FRONTEND
- [repo] `jubail-halloween/index.html` (single-file app, vanilla JS, string concat, no build) + `jubail-halloween/dashboard.html` (event stats — fully baked at season close, no backend calls; source numbers in `docs/halloween-2026-final.md`).
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
- [live] Internal-only (no anon/authenticated execute): jh_snapshot (no longer scheduled), jh_assert_admin, jh_backfill_prefixes.
- [live] pg_cron: `jh-hourly-snapshot` **unscheduled 2026-11-02 21:2x UTC** at season close (last firing 21:05 UTC). `jh_snapshot()` remains, unscheduled.
- [live] No other table or RPC in this Supabase project is anon/authenticated-accessible (verified 2026-11-02).
- ⚠ RULE: never change `jh_signup`'s signature — add follow-up RPCs instead.

### LAYER — DATABASE
- [live] Tables: `jh_homes` (unit, village, home_type, lat/lng, out_of_candy, handout, entrance, treats, details, org_note, season, edit_token, removed, created_at — **0 rows since the 2026 close**), `jh_settings` (key/value: passcode, admin_code, season, broadcast), `jh_stats` (58 hourly aggregate snapshots for season 2026, kept — counts only; `both_kinds` — `both` is a Postgres reserved word).
- [live] RLS enabled, zero policies (deny-all) on all three `jh_` tables; no anon/authenticated table grants. RPCs are the only access path. (`jh_stats` brought into line 2026-11-02 — see `supabase/signalpost/migrations/20261102160000_jh_stats_rls_lockdown.sql`.)
- [live] Season model: rows tagged by `season`; active season is now '2027' (sign-up passcode rotated, unshared — signups effectively closed). "New season" only relabels; it does not archive or delete. 500-entry cap per season.
- [live] Check constraints on home_type/handout/entrance; treats validated in RPC.

### LAYER — AUTH & SESSIONS
- [repo] No accounts, no auth provider. Per-entry `edit_token` (control link `?m=<id>~<token>`), organizer code for admin RPCs, sign-up passcode. Zero-PII by design (see CLAUDE.md).
- Secrets live in `jh_settings` and the private ops doc — never in this repo.

### LAYER — EXTERNAL APIs
- [repo] Esri World Imagery tiles (free, keyless); OSM tiles (street toggle). Nothing else third-party. No analytics/trackers by promise.

### LAYER — OBSERVABILITY
- [live] None by design on the client. Server-side: Supabase edge logs (~24h retention) are the only traffic proxy; query recipes live in the private ops doc.
- [live] `jh_stats` hourly snapshots (read via `jh_stats_list`).


## LAYER — CI / CD

- [live] GitHub Pages user site (legacy build) serving `main` root; push → deploy, ~10 min CDN cache. Verify via `gh api repos/zgauba/zgauba.github.io/actions/runs`.
- [live] Old `zgauba/jubail-halloween` repo: Pages disabled + archived 2026-11-02; the `jubail-halloween/` folder now serves the identical URL.
- [repo] **Commons left this repo on 2026-11-26** → `zgauba/commons` (full history copied; commons.ae deploys from there via Cloudflare Pages). `404.html` forwards any `/commons/…` path to the same path on commons.ae (path, query and fragment kept), so old links, QR codes and home-screen apps keep working.
- [repo] Gates run main's copy (`pull_request_target`; read-only token, PR checked out as data only): `review-saved` (a PR touching `supabase/` must add `docs/qa/*review*.md`), `plan-followed` (PR-body headings for `commons/` / `supabase/` changes), `secret-scan` (every PR; patterns `tests/ci/secret-patterns.cjs`), `repo-rules` (R1–R9: no `jc_` under `supabase/signalpost/`, migration headers name their project, no `jh_signup` signature change, personal page: no phone / no "acquired" near Segmint / no "relocating", credit links to the root). Zero-output minimums: 3 migrations, 2 personal pages, 3 credit-scope files.
- [live] **Branch protection on `main`:** required `review-saved`, `plan-followed`, `secret-scan`, `repo-rules` (design-guard dropped 2026-11-26 with Commons); not strict; admins not enforced (hotfix pushes still work). Push protection + secret scanning on.
- [repo] Local verify gate: `.claude/verify.sh` = repo-rules + the gate scripts' unit tests.
- Note: the whole repo is served verbatim (this file is a public URL) — docs here must stay sanitized.

## LAYER — SECRETS & ENV VARS

- [repo] Supabase publishable anon key embedded in HTML — public by design.
- [live] Organizer code + passcode in `jh_settings` (organizer code changeable only via SQL).

---

## Known gaps & drift

1. **Historical `jh_` schema not in git** — only migrations from 2026-11-02 onward are mirrored into `supabase/signalpost/migrations/`; the ~24 earlier `jh_` migrations exist only in Supabase migration history. Backfill when convenient.
2. **Print button hidden** (`display:none`, listener still bound) pending community privacy consensus.
