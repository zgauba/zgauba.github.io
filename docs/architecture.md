# zgauba.github.io — Jubail Commons monorepo — Stack Manifest

```
APP: zgauba.github.io (Jubail Commons monorepo)
PRIMARY PURPOSE: Zee's networking pages + Jubail Island community tools
  (Halloween 2026 season closed 2026-11-03 — site live but empty; Jubail Commons in rebuild)
LAST VERIFIED: 2026-11-03 (SignalPost re-queried at T1 close-out; JubailCommons
  re-queried after each T2 slice applied — schema complete, modules OFF, no codes set)
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

## SECTION — COMMONS (`commons/`) — schema complete (T2), modules OFF, not yet open to residents

- **Decision (2026-11-02): Commons gets its OWN Supabase project** — **JubailCommons** (`qrpxfssdeeuzmsmlbtbu`, ap-south-1, free tier). `jc_` prefix; migrations in `supabase/commons/migrations/`, one dir per remote project so a migration can never hit the wrong database. Plan + decisions: `docs/plans/T2-schema-batch.md`.

### LAYER — FRONTEND
- [repo] `commons/index.html` landing: renders from `jc_config_get('jubail')` with an explicit error fallback; EN/AR strings (`commons/assets/strings.js`, Arabic flagged `ar_draft` pending native review) + RTL; three-layer tokens. No module screens yet (T5).

### LAYER — DATABASE / API (JubailCommons)
- [live] Migrations applied (history rows present): `foundation_tables_and_config`, `20261103120000 s1_identity_homes`, `20261103180000 s2_events`, `20261103210000 s3_courts`, `20261104000000 s4_pets`. S1–S4 were pasted via the SQL editor (local tooling declines drop/delete-bearing SQL); history rows added by hand. Note: foundation's history version (`20261102165811`) differs from its repo filename (`…180000`) — same migration.
- [live] **24 `jc_` tables**, RLS on every one, **zero policies, no table/sequence grants** to anon/authenticated. Access model = **RPC-only**: every read/write is a `SECURITY DEFINER` function with a pinned `search_path`; the caller's community is derived from their membership (`jc_me`), never from client input.
- [live] **Callable surface:** anon = `jc_config_get`, `jc_code_check`, `jc_hit` (3). authenticated = 68 (identity/homes, events, courts, pets, scoped admin). The exact lists live in `tests/sql/00_grants.test.sql` — that file is the source of truth for "who can call what".
- [live] Default privileges are closed globally for role `postgres`: any function it creates (any schema) starts private and needs an explicit grant.
- [live] Modules (`jc_communities.modules`): `events`, `bookings` (`per_home_per_day: 1`), `pets` — **all `enabled: false`**. The flag is the compliance kill switch: every resident RPC of a module raises `MODULE_OFF` while it is off.
- [live] Codes (join, community admin, per-module admin): **none set** — `jc_join` fails closed until they are. Set with `select jc_code_bootstrap('jubail', '<scope>')` (server-generated, 10 chars, shown once; never typed into SQL). Stored bcrypt-hashed.
- [repo] Standing rules: `jc_event_signup(uuid, jsonb)` signature frozen at launch (new fields go in the payload); every user reference is `ON DELETE SET NULL` (or CASCADE) so account deletion never blocks; email is never an authorization key (confirmation is off).

### LAYER — AUTH & SESSIONS
- [live] Supabase Auth, email + password. **Email confirmation OFF** (decision); sign-up is open at the Auth API but grants nothing — an auth user becomes a resident only through `jc_join` with the join code.
- [live] Admin = account-bound grants (`jc_admin_grants`): unlock with a scoped code (community / events / bookings / pets), valid 60 days from last use, invalidated by code rotation. Wrong admin codes are tar-pitted 1.5 s; join-code failures are counted but not delayed (codes are high-entropy).
- [live] Offboarding: `jc_account_delete` / `jc_admin_member_remove` → `jc_home_detach` → `jc_home_vacated` (invites expire, event entries withdrawn + answers cleared, future bookings released, pets archived). A `BEFORE DELETE` trigger on `auth.users` (`jc_users_offboard`) runs the same path for dashboard deletes.
- ⚠ Dashboard config (out-of-band, not in migrations — re-check before launch): email confirmation off; Site URL + redirect allowlist for the password-reset email; minimum password length; leaked-password protection.

### LAYER — STORAGE
- [live] One private bucket `pet-photos` (2 MB, jpeg/png/webp). Exactly two policies on `storage.objects` (INSERT, SELECT), each delegating to a `SECURITY DEFINER` predicate in schema **`jc_private`**. No UPDATE/DELETE policies: objects are write-once at server-chosen paths (`jc_pet_photo_begin` → upload → `jc_pet_photo_commit`, 15-minute window).
- [live] `jc_private` is **not** exposed by the API — verified 2026-11-03 ("Only the following schemas are exposed: public, graphql_public"). ⚠ Never add it to the exposed schemas (dashboard → API settings).
- [live] Every issued path is tracked in `jc_pet_photos` (pending → current → retired) — the work queue for T4's cleanup (Storage blocks SQL deletes; purge via the Storage API).

### LAYER — OBSERVABILITY
- [live] Tables ready, nothing writing on a schedule yet (T4): `jc_state_log` (entry/booking/pet state changes), `jc_hits` (anon page counter, page × hour), `jc_snapshots` (idempotent per community/module/bucket), `jc_event_stats` (Halloween 2026 baseline seeded: 124 homes), `jc_admin_log` (append-only admin actions, never codes), `jc_admin_notices` (departures, over-cap requests, pin flags).
- [live] No `pg_cron` extension yet (T4). Fail counters: `jc_admin_fail_count`, `jc_join_fail_count` (no reader yet — KG9).

### LAYER — TESTS
- [repo] `tests/sql/build_dryrun.sh [pending migrations]` assembles ONE paste: migrations + `00_grants` (allowlists + structural checks: definer/search_path, FK delete rules, storage policies, `jc_private`) + every slice test + `zz_finish`, which always raises ⇒ **everything rolls back**. 285 checks as of S4. Run in the SQL editor; success = `ERROR: ALL_TESTS_PASSED (n checks)`.
- [repo] Fixtures are written into `jubail` and rolled back; `00_grants` **aborts once jubail has real residents** — post-launch, tests must move to test communities before they can run again.

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
2. ~~**Season close-out pending**~~ ✓ **Resolved 2026-11-03** (T1): numbers baked + recorded (PR #7, `docs/halloween-2026-final.md`) → CSV exported (private, deletion due 2026-11-17) → season relabelled 2027 + passcode rotated → 127 season-2026 rows deleted → cron unscheduled. Mirror: `supabase/signalpost/migrations/20261102213000_jh_season_2026_close.sql`.
3. **Print button hidden** (`display:none`, listener still bound) pending community privacy consensus.
4. ~~**Unused `non_food` column**~~ ✓ **Resolved 2026-11-03** — column + `jh_set_nonfood` dropped with the season close (`treats` untouched).
5. ~~**Bio-page stats stale** — `/jubail/` says 122 homes; reconcile final count.~~ ✓ **Resolved 2026-11-02** (PR #5 updated `/jubail/` to 124; spelling caveat moved into KG 2).
6. ~~**Obsolete Commons close function — do not apply.**~~ ✓ **Resolved 2026-11-03** (T2/S2, PR #10): never-applied `jc_season_close` removed from the foundation mirror (PR #9); replaced by `jc_event_close` — snapshot `jc_event_stats` → mark entries archived → delete nothing. Purge deferred (no delete path ships).
7. **Docs state a superseded privacy posture.** CLAUDE.md and `docs/plans/backlog.md` still describe the zero-PII default; superseded 2026-11-03 (accounts + first-party-only privacy policy). Update both alongside the auth PR, with public disclosure — never silently. Stale backlog items: recovery PIN, optional-PII identity slots. → Theme T6.
8. **JubailCommons free-tier auto-pause** — the project pauses after 7 idle days; resolve (upgrade or keep-alive) before invites go out. → Theme T6.
9. **Admin-failure counter has no reader** — `jh_admin_fail_count` is write-only in practice; event-day checks are manual. Fold a reader into the Commons Reports panel / event-day checklist. → Theme T4.
10. **Pet-photo cleanup not yet scheduled** — objects for retired / stale-pending `jc_pet_photos` rows stay in Storage until T4's purge (Storage API delete). Until then a signed URL minted while a photo was current keeps working to its TTL; clients must mint short TTLs. Also add a storage-usage alert vs the 1 GB free tier. → Theme T4.
11. **Pre-launch manual checks owed** (can't run inside one rolled-back transaction): Storage API smoke test with a real JWT (upload, createSignedUrl, upsert denied, list scoping); two-tab concurrency runs (event close vs signup, block vs booking, two household signups). → Theme T6.

