# zgauba.github.io — Jubail Commons monorepo — Stack Manifest

```
APP: zgauba.github.io (Jubail Commons monorepo)
PRIMARY PURPOSE: Zee's networking pages + Jubail Island community tools
  (Halloween 2026 season closed 2026-11-03 — site live but empty; Jubail Commons in rebuild)
LAST VERIFIED: 2026-11-03 (SignalPost re-queried at T1 close-out; JubailCommons
  re-queried after T4 applied — 28 tables, anon = 3 fns, authenticated = 69,
  modules OFF, no codes set, 3 cron jobs, 1 edge function; T5.0a smoke test:
  e2e community added, Auth email confirmation found ON — drift, see Auth layer)
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
- [repo] `commons/index.html` landing: renders from `jc_config_get('jubail')` with an explicit error fallback; counts a visit via `jc_hit('jubail','landing')` (fire-and-forget); EN/AR strings (`commons/assets/strings.js` — Arabic native-reviewed 2026-11-03: «كومنز الجبيل», singular address, Western digits; the old zero-PII `privacy_line` removed 2026-11-03 — the join screen's `join_privacy` is the only privacy copy until the T6 policy) + RTL; three-layer tokens.
- [repo] **T5.0a/0b screens** (`commons/`): landing = signed-out platform entry (picker; Jubail written in until a community-list RPC) / signed-in hub (member without a home → `home/`); `account/` (sign in, code-first join, PKCE reset); `home/` (claim village/type/number, **required** pin drop — no skip since T5.2; `?view=pin&next=<event tab>` returns to the event — on vendored **Leaflet 1.9.4** with Esri/OSM tiles, My Home: household + single-use invite links `home/?invite=<token>`, display name, leave, delete account). Shared: `assets/api.js` (client + `rpc()` error contract), `nav.js` + `tabbar.css` (bottom tab bar: Commons · live modules · My Home), `icons.js` (dot icon family from Wireframes v4.1 + a new house icon), `update.js` (auto-update: every 2 min / on tab focus, fingerprint page HTML + asset ETags → reload when idle, banner when mid-form or on the pin map). Every page: `canonical.js` first, CSP `script-src 'self'`, `connect-src 'self'` + the Supabase project (`'self'` is required by update.js). Tests: `tests/e2e` (Playwright, stubbed) + `tests/e2e/smoke` (real backend, `e2e` community).
- [repo] **Organizer tools (T5.2 PR 2)** `commons/admin/` (linked from My Home): unlock with a scoped code / lock again (`jc_admin_unlock` / `jc_admin_exit`), events list incl. drafts, create / edit (sends only changed fields; short name locked after publish; questions locked once homes sign up; "Halloween questions" template with friendly wording + pin hints `pin: ring|glyph`, `glyphs`), publish, pause / open sign-ups, close (type the short name), community admins change codes (shown once). **Question builder (PR 2b):** pick one / yes-no / short answer, required, choices with optional Arabic, one question may drive the pin ring and one the pin icon (per-choice icons); reorder / remove; keys derived from the English wording and kept once given; client mirrors `jc_schema_check` limits (12 questions, 20 choices, 8 KB).
- [repo] **Events (T5.1; tabs T5.2)** `commons/events/`: list (live + Past), detail with tabs **Map · List · My home** (`?tab=`; Leaflet map of pinned entries / village-grouped searchable list / my sign-up — no map beside it, the event uses the home pin), schema-driven signup (ALWAYS sends the full payload + note — `jc_event_signup` replaces both), withdraw, archived-event stats from the `jc_event_stats` snapshot; My Home "Our year" (`jc_my_history`, hidden while the module is off). Everything raises `MODULE_OFF` until `jubail`'s events flag is on. Event-day live controls + admin are T5.2.

### LAYER — DATABASE / API (JubailCommons)
- [live] Migrations applied (history rows present): `foundation_tables_and_config`, `20261103120000 s1_identity_homes`, `20261103180000 s2_events`, `20261103210000 s3_courts`, `20261104000000 s4_pets`, `t3_rate_limits` (applied via the Supabase tool, so its history version is `20261103062032` vs repo filename `…20261105000000` — same migration), `arabic_names`, `t4a_enable_pg_cron`, `t4a_snapshots`, `t4b_health`, `t4c_enable_pg_net`, `t4c_cleanup` (tool-applied: history versions are apply timestamps, names match repo filenames). S1–S4 were pasted via the SQL editor (local tooling declines drop/delete-bearing SQL); history rows added by hand. Note: foundation's history version (`20261102165811`) differs from its repo filename (`…180000`) — same migration.
- [live] **28 `jc_` tables**, RLS on every one, **zero policies, no table/sequence grants** to anon/authenticated. Access model = **RPC-only**: every read/write is a `SECURITY DEFINER` function with a pinned `search_path`; the caller's community is derived from their membership (`jc_me`), never from client input.
- [live] **Callable surface:** anon = `jc_config_get`, `jc_health`, `jc_hit` (3). authenticated = 69 (identity/homes, events, courts, pets, scoped admin, `jc_admin_report`, `jc_health`). service_role = the three purge RPCs explicitly — and, by Supabase default privileges, every other public function too (it is the admin key; `jc_cron_nonce_new` is explicitly revoked from it). The exact lists live in `tests/sql/00_grants.test.sql` — that file is the source of truth for "who can call what".
- [live] **Rate limits (T3):** `jc_join` 10 attempts/hour and `jc_admin_unlock` 5 attempts/15 min, per account (`jc_rate`; attempts counted — join clears on success, admin unlock never clears; admin unlock sleeps 1.5 s on every attempt; one attempt in flight per account → parallel calls get `RATE_LIMITED`). Wrong codes **return** `{"error": "BAD_CODE"|"BAD_ADMIN"}` (HTTP 200) so the counter commits — clients must check `error`. `jc_code_check` retired (no grants). No IPs stored; per-IP limiting is Supabase Auth's (below). Plan: `docs/plans/T3-rate-limits.md`.
- [live] Default privileges are closed globally for role `postgres` (except service_role, above): any function it creates (any schema) starts private and needs an explicit grant.
- [live] Arabic names seeded (migration `arabic_names`, repo `20261105010000_arabic_names.sql`): community `name_ar` «كومنز الجبيل» + official village spellings. The landing header reads `name_ar` from config, not from strings.js.
- [live] Communities: `jubail` (real) + `e2e` (real-backend smoke tests only, migration `20261105050000_e2e_test_community.sql`; join code bootstrapped out-of-band, never committed). Never put test accounts in `jubail` — `00_grants` aborts once jubail has residents.
- [live] Modules (`jc_communities.modules`): `events`, `bookings` (`per_home_per_day: 1`), `pets` — **all `enabled: false`**. The flag is the compliance kill switch: every resident RPC of a module raises `MODULE_OFF` while it is off.
- [live] Codes (join, community admin, per-module admin): **none set** — `jc_join` fails closed until they are. Set with `select jc_code_bootstrap('jubail', '<scope>')` (server-generated, 10 chars, shown once; never typed into SQL). Stored bcrypt-hashed.
- [repo] Standing rules: `jc_event_signup(uuid, jsonb)` signature frozen at launch (new fields go in the payload); every user reference is `ON DELETE SET NULL` (or CASCADE) so account deletion never blocks; email is never an authorization key (confirmation is off).

### LAYER — AUTH & SESSIONS
- [live] Supabase Auth, email + password. ⚠ **DRIFT (found 2026-11-03 by the T5.0a real-backend smoke test): email confirmation is ON in the dashboard** — sign-up returns no session and Supabase mails a confirmation link (`confirmation_sent_at` set). The decision (and the client) assume OFF; the client says "check your email to confirm" instead of failing silently. Resolve: switch it off (Authentication → Sign In / Providers → Email → Confirm email) or re-decide. Sign-up is open at the Auth API but grants nothing — an auth user becomes a resident only through `jc_join` with the join code.
- [live] Auth flow = **PKCE** (client setting, T5.0a review): reset links exchange only in the browser that requested them. Redirect URLs allowlist set by Zee 2026-11-03 (`https://zgauba.github.io/commons/**`).
- [live] Admin = account-bound grants (`jc_admin_grants`): unlock with a scoped code (community / events / bookings / pets), valid 60 days from last use, invalidated by code rotation. Wrong admin codes are tar-pitted 1.5 s; join-code failures are counted but not delayed (codes are high-entropy). Both are rate-limited per account (T3).
- [live] Offboarding: `jc_account_delete` / `jc_admin_member_remove` → `jc_home_detach` → `jc_home_vacated` (invites expire, event entries withdrawn + answers cleared, future bookings released, pets archived). A `BEFORE DELETE` trigger on `auth.users` (`jc_users_offboard`) runs the same path for dashboard deletes.
- ⚠ Dashboard config (out-of-band, not in migrations — re-check before launch): email confirmation off; Site URL + redirect allowlist for the password-reset email; minimum password length; leaked-password protection; **anonymous sign-ins disabled**; **Auth rate limits** (sign-ups + sign-ins per IP — T3 relies on these for strangers; raise before the invite burst, since residents may share carrier NAT; values not yet recorded).

### LAYER — STORAGE
- [live] One private bucket `pet-photos` (2 MB, jpeg/png/webp). Exactly two policies on `storage.objects` (INSERT, SELECT), each delegating to a `SECURITY DEFINER` predicate in schema **`jc_private`**. No UPDATE/DELETE policies: objects are write-once at server-chosen paths (`jc_pet_photo_begin` → upload → `jc_pet_photo_commit`, 15-minute window).
- [live] `jc_private` is **not** exposed by the API — verified 2026-11-03 ("Only the following schemas are exposed: public, graphql_public"). ⚠ Never add it to the exposed schemas (dashboard → API settings).
- [live] Every issued path is tracked in `jc_pet_photos` (pending → current → retired) — the purge queue. Storage blocks SQL deletes, so retired + stale-pending (> 1 h) objects are removed daily by the `jc-photo-purge` Edge Function (below), which sets `purged_at`.

### LAYER — SCHEDULED JOBS + EDGE FUNCTIONS (JubailCommons, T4)
- [live] `pg_cron` 1.6.4 + `pg_net` 0.20.4, each enabled in its own migration. ⚠ Never repeat a `CREATE EXTENSION` for them — Supabase's event trigger re-runs its grant script and fails ("dependent privileges exist").
- [live] Jobs (UTC): `jc-hourly-snapshot` `5 * * * *` → `jc_snapshot_run()` (6 modules × community, upsert per hour); `jc-orphan-users` `15 3 * * *` → `jc_purge_orphan_users()` (auth users with no `jc_accounts` row, 30 d old + 30 d idle); `jc-photo-purge` `35 3 * * *` → `net.http_post` to the Edge Function.
- [live] Edge Function `jc-photo-purge` (`verify_jwt=false`; source `supabase/commons/functions/jc-photo-purge/`). Gate = single-use nonce in `x-jc-cron`, minted per cron run (`jc_cron_nonce_new`), spent via `jc_cron_nonce_use` (< 10 min). Never put a long-lived secret in a pg_net header: anon holds grants on `net.*` (Supabase default, unrevocable by `postgres`); safe only because `net` is not API-exposed.
- [live] Every cleanup run writes `jc_maintenance_log` (affected + first error). First forced runs 2026-11-03: 0 orphans, 0 photos, HTTP 200.

### LAYER — OBSERVABILITY
- [live] `jc_state_log` (entry/booking/pet state changes), `jc_hits` (anon page counter, page × hour), `jc_snapshots` (idempotent per community/module/bucket), `jc_event_stats` (Halloween 2026 baseline seeded: 124 homes), `jc_admin_log` (append-only admin actions, never codes), `jc_admin_notices` (departures, over-cap requests, pin flags).
- [live] **`jc_admin_report()`** (community admin; T5 Reports screen will render it): snapshot age/stale, cron job state + last failure, fail counters **minus baseline** (`jc_counter_baseline`: admin 35 / join 38 at T4 apply — dry-run noise), live lock-outs, 24 h state changes, open notices, hits vs accounts (silent-counter flag), storage bytes vs 1 GB (alert ≥ 80 %), cleanup job freshness.
- [live] **`jc_health(community)`** (anon): `{ok, cron_active, maintenance_ok, snapshot_age_minutes}` only. `ok` = all 3 jobs active + snapshot < 3 h + no cleanup job stale (> 36 h) or erroring.
- [repo] **Canary** `.github/workflows/commons-canary.yml` (every 6 h + manual): fails on `ok != true`, unreachable API (e.g. paused project), or any of `net cron vault jc_private storage extensions supabase_functions` no longer returning 406 (schema exposed). GitHub emails the repo owner on failure. ⚠ Scheduled workflows are disabled after 60 days without repo activity.
- ⚠ Dry runs still advance the fail counters after the baseline — run them sparingly post-launch.

### LAYER — TESTS
- [repo] `tests/sql/build_dryrun.sh [pending migrations]` assembles ONE paste: migrations + `00_grants` (allowlists + structural checks: definer/search_path, FK delete rules, storage policies, `jc_private`) + every slice test + `zz_finish`, which always raises ⇒ **everything rolls back**. 371 checks as of T4 (`s6_snapshots`, `s7_cleanup` added; those use test communities `testville6/7`). Run in the SQL editor; success = `ERROR: ALL_TESTS_PASSED (n checks)`.
- [repo] Fixtures are written into `jubail` and rolled back; `00_grants` **aborts once jubail has real residents** — post-launch, tests must move to test communities before they can run again.

## LAYER — HOSTING: commons.ae (Cloudflare Pages) — added 2026-11-03
- [live] **commons.ae** = Cloudflare Pages project `commons` (default URL `commons-7ii.pages.dev`), Git-connected to this repo, production branch `main`, **build output directory `commons/`**, no build command. Every push to `main` deploys in ~1 min; `cache-control: max-age=0, must-revalidate` (no 10-min CDN lag — event-day hotfixes land fast). Every other branch gets a preview at `<branch>.commons-7ii.pages.dev`.
- [live] DNS for commons.ae is on Cloudflare (nameservers `asa`/`bryce.ns.cloudflare.com`, Free plan): apex CNAME → Pages (proxied); `TXT v=spf1 -all` + `_dmarc` `p=reject` (the domain sends no mail — anti-spoofing). No `www`.
- [repo] Why not a GitHub Pages custom domain: on the `zgauba.github.io` user-site repo it would also move every project site (Varzish, Thrivepoint) under commons.ae. Why Cloudflare over Vercel: free tier allows commercial use (productization).
- [repo] The SAME `commons/` folder is still served at zgauba.github.io/commons/ by GitHub Pages; `commons/assets/canonical.js` (first script on every Commons page) forwards that copy to commons.ae, keeping path/query/fragment. **Every new Commons page must load it first.**
- [repo] `commons/404.html` — Cloudflare serves it (HTTP 404) for unknown paths; without it Pages answers any path with the landing + 200.
- [live] Supabase Auth Site URL `https://commons.ae/`; Redirect URLs include `https://commons.ae/**` (+ the github.io entry until no longer needed).
- ⚠ Cloudflare labels Pages "legacy" in favour of Workers static assets; Pages remains supported. Migration = one small Wrangler config pointing at `commons/`.

## LAYER — CI / CD (whole repo)

- [live] GitHub Pages user site (legacy build) serving `main` root; push → deploy, ~10 min CDN cache. Verify via `gh api repos/zgauba/zgauba.github.io/actions/runs`.
- [live] Old `zgauba/jubail-halloween` repo: Pages disabled + archived 2026-11-02; the `jubail-halloween/` folder now serves the identical URL.
- [repo] One Pages build serves everything — career page shares blast radius with community-app pushes.
- [repo] `.github/workflows/commons-e2e.yml` (T5.1): the stubbed Playwright suite runs on every PR touching `commons/` or `tests/e2e/` (never the live backend). A red check = don't merge. Actions pinned to commit SHAs (T5.2).
- [repo] `.github/workflows/review-saved.yml` (T5.2): any PR touching `commons/` or `supabase/` must add a `docs/qa/*review*.md` (label `review-not-needed` for trivial copy). Reads the PR file list via the API; no checkout.
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
9. ~~**Admin-failure counter has no reader**~~ ✓ **Commons side resolved 2026-11-03** (T4: `jc_admin_report` reads `jc_admin_fail_count` / `jc_join_fail_count` against a baseline). SignalPost's `jh_admin_fail_count` stays write-only (legacy, no investment). Render in the T5 Reports screen.
10. ~~**Pet-photo cleanup not yet scheduled**~~ ✓ **Resolved 2026-11-03** (T4c: daily `jc-photo-purge`; storage alert in `jc_admin_report`). Original note: objects for retired / stale-pending `jc_pet_photos` rows stay in Storage until T4's purge (Storage API delete). Until then a signed URL minted while a photo was current keeps working to its TTL; clients must mint short TTLs. Also add a storage-usage alert vs the 1 GB free tier. → Theme T4.
11. **Pre-launch manual checks owed** (can't run inside one rolled-back transaction): Storage API smoke test with a real JWT (upload, createSignedUrl, upsert denied, list scoping); two-tab concurrency runs (event close vs signup, block vs booking, two household signups, two parallel `jc_admin_unlock` from one account → second gets `RATE_LIMITED` at once). → Theme T6.
12. ~~**Orphan auth users**~~ ✓ **Resolved 2026-11-03** (T4c: daily `jc-orphan-users`, 30 days). Original note: with `jc_code_check` retired (T3), a stranger or a mistyped code leaves an `auth.users` row with no `jc_accounts` row. Grants nothing (T2 accepted), but accumulates. Purge never-joined users after N days. → Theme T4.
13. **Review reports not persisted** — the synthesis's "reviews land in `docs/qa/` at creation" was not followed in T2 (only outcomes survive, in `docs/plans/T2-schema-batch.md`), and missed again for PR #24 (saved post-merge as `docs/qa/T5-1-review-2026-11-04.md`). **Enforced from T5.2:** CI `review-saved.yml` fails app/DB PRs with no `docs/qa/*review*.md`.
14. **Supabase platform defaults bypass the grant model** — anon holds grants on `net.*` (unrevocable by `postgres`); service_role gets EXECUTE on every new public function; `CREATE EXTENSION` re-runs grant scripts. Current defences: schema exposure (canary-probed), structural pins G16–G18, explicit service_role revokes where it matters. Candidate for a `/structural-audit` pass before invites. → Theme T6.
