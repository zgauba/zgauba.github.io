# T2 — Commons schema batch (plan)

> Status: **APPROVED 2026-11-03** — S1 + S2 live; S3 in review/apply. Source of truth for scope:
> Use Cases traceability table + Wireframes v4.1 (both frozen 2026-11-03),
> `docs/qa/SYNTHESIS-2026-11-03.md` T2, the 2026-11-02 DB review findings.
> Target: JubailCommons (`qrpxfssdeeuzmsmlbtbu`) only.

## Step 0 — Scope & freshness

- **Tier: cross-layer** (schema, RLS/grants, auth, contract `jc_config_get`).
- Manifest LAST VERIFIED 2026-11-03. JubailCommons re-queried 2026-11-03:
  1 applied migration (`foundation_tables_and_config`); tables `jc_communities`
  (1 row: `jubail`, passcode + admin_code NULL), `jc_events` (0), `jc_entries` (0);
  RPCs `jc_assert_admin` (internal), `jc_config_get` (anon+auth);
  `jc_season_close` **not applied** (KG6 — correct); `auth.users` = 0;
  extensions: pgcrypto, uuid-ossp, vault, pg_stat_statements — **no pg_cron, no btree_gist**.
- **Default ACLs (live):** `anon` + `authenticated` get EXECUTE on every new
  function and full rights on every new table/sequence in `public`. Every
  object this batch creates is exposed unless explicitly revoked.
- **Mirror drift:** `supabase/commons/migrations/20261102180000_foundation.sql`
  contains the never-applied `jc_season_close` + its grant. Repo ≠ live.

## Step 1 — Inventory

| Layer | Touched | Check |
|---|---|---|
| DB — `jc_communities` | Yes: plaintext `passcode`/`admin_code` columns move out (hashed table); `villages` jsonb → table; add `tz`; `retention_days` drops from public config | live column list; both codes NULL |
| DB — `jc_events` | Yes: features/payload config, composite key, status set | 0 rows |
| DB — `jc_entries` | **Replaced** by home-scoped `jc_event_entries` (drop: edit_token, pin_hash, pii, lat/lng, unit/village) | 0 rows |
| DB — new | homes, members, invites, villages, codes, admin grants, notices, facilities, bookings, blocks, pets, sightings, care log, reports, state log, event stats, hits, snapshots | — |
| Auth (Supabase Auth) | Yes: first use. Email+password, confirm-email OFF, signup open at the Auth API (gated at `jc_join`) | `auth.users` = 0; settings are dashboard config, not SQL (→ #2b) |
| RPC contract `jc_config_get` | Rewritten; output keys the landing uses kept (`name_en/ar, links, brand, modules, broadcast, map, villages`) | grep of `commons/index.html`: reads name_en, name_ar, links, modules, broadcast, tokens — not villages, not retention_days |
| Storage | Yes (Pets photos) — new bucket + `storage.objects` policies | no bucket exists |
| Frontend `commons/` | Not touched — landing contract preserved | grep above |
| SignalPost / Halloween | Not touched | separate project ref; no jh_ references in commons |
| Cron | Not touched (pg_cron enable + jobs = T4) | extension absent |
| Edge functions | Not touched (gateway = T3) | none deployed |

## Step 2 — Design (impact by component)

**Access model (unchanged principle):** RLS on, zero policies, all grants
revoked; every read/write through `security definer` RPCs with
`search_path = public, pg_temp`. Community is **derived from the caller's
membership**, never trusted from a client parameter (exceptions: `jc_config_get`,
`jc_code_check`, `jc_join`). One helper, `jc_me()`, returns
`(user_id, community_id, home_id)` or **raises** `NOT_MEMBER` — never returns
empty (catalog #2).

**S1 — Identity, homes, admin (security core)**
- `jc_villages` (community_id, key, name_en, name_ar, status `delivered|upcoming`,
  delivery_label, parent_key → sub-areas e.g. Marsa ⊂ Marfaa, glyph, etymology_en/ar,
  sort). Seed Jubail: 5 delivered + Marsa (sub-area of Marfaa) + Bada (upcoming,
  late 2027) + Rimas (upcoming, 2030).
- `jc_codes` (community_id, scope `join|community|<module>`, code_hash bcrypt,
  version, rotated_at). Plaintext columns dropped from `jc_communities`.
- `jc_accounts` (user_id PK → auth.users on delete cascade, community_id,
  display_name null, prefs jsonb {tabs, start}, joined_at).
- `jc_homes` (id, community_id, village_key, home_type, building (apartments),
  number_raw, number_norm GENERATED, lat/lng null, pin_set_at, directory_suppressed,
  flags jsonb, created_at). Unique (community, village, building_norm, number_norm).
  **Vacancy derived** (0 members), not stored.
- `jc_home_members` (user_id PK, home_id, joined_at, via) — one home per account.
- `jc_home_invites` (id, home_id, token_hash, created_by, expires_at = +72h,
  used_by/used_at, needs_admin_approval, approved_by).
- `jc_admin_grants` (user_id, community_id, scope, code_version, last_used_at) —
  unlock is **account-bound** (D3); valid iff code_version matches and
  last_used_at > now() − 60d; rotation bumps version ⇒ every grant dies.
- `jc_admin_notices` (departure → "rotate community code?" banner).
- RPCs: `jc_code_check` (anon, tar-pitted, UX only) · `jc_join` (auth, re-checks
  code) · `jc_home_claim` · `jc_home_pin_set` · `jc_invite_create/accept` ·
  `jc_home_leave` · `jc_me_get` · `jc_prefs_set` · `jc_admin_unlock/exit` ·
  `jc_admin_code_rotate` · admin Homes queue (detach, suppress, approve over-cap).
- Rewrite `jc_config_get` (villages from table, no retention_days, `stable`).
- Repo hygiene: strip never-applied part 2 from the foundation mirror file.

**S2 — Events, archive-at-close, instrumentation**
- `jc_events`: add features jsonb (giant_switch, supply, crowd_reports, route,
  safety), payload_schema jsonb, safety jsonb; status `draft|live|closed|archived`;
  unique (id, community_id) for composite FKs; `ends_at >= starts_at`.
  **Concurrent live events allowed** (D4 — wireframes draw a multi-event landing;
  supersedes the DB review's one-live-event check).
- `jc_event_entries` (event_id, community_id, home_id, payload, participating,
  supply_level 0–3, done, note, org_note, archived_at, created_at, updated_at,
  updated_by) · unique (event_id, home_id) · composite FK (event_id, community_id).
- `jc_reports` (crowd): unique (entry, reporter), entry `reports_locked_until`.
- `jc_state_log` (append-only; entity, field, new_value, actor, at).
- `jc_event_stats` (event_id PK, snapshot jsonb, source `snapshot|manual`, taken_at).
- `jc_hits` (community, page allowlist, hour, count) + `jc_snapshots` (generic
  metrics jsonb) — tables only; cron wiring is T4.
- RPCs: `jc_event_signup(p_event uuid, p_payload jsonb)` — **signature frozen at
  launch** · entry setters · crowd report/clear · admin event CRUD (draft→publish) ·
  `jc_event_close(p_event, p_confirm)`: lock event `for update` → status `closed`
  → snapshot `jc_event_stats` → set `archived_at` → `archived`. **Deletes nothing.**
  Replaces the obsolete part-2 paste (closes KG6).
- Seed: Halloween 2026 archived event + manual `jc_event_stats` row from
  `docs/halloween-2026-final.md` (D6).
- **Purge deferred** (D5): no delete path ships; retention_days removed from public
  config so nothing advertises an unenforced policy.

**S3 — Courts**
- `jc_facilities` (kind padel|tennis, names, lat/lng, status draft|published,
  open/close time, slot_minutes default 60, window_days 7, per_home_per_day 1).
- `jc_bookings` (facility, home_id, booked_by user (null on account delete),
  starts_at, ends_at, display_name opt-in, status booked|cancelled,
  cancel_reason, cancelled_by) · **unique (facility, starts_at) where booked**
  (slots grid-aligned, enforced in RPC — no btree_gist needed).
- `jc_booking_blocks` (admin).
- Day boundaries use `jc_communities.tz` (Asia/Dubai).
- RPCs: book (window + quota + alignment + block check, home row locked) ·
  cancel · admin block/cancel-with-reason · facility draft/publish.

**S4 — Pets + Storage**
- `jc_pets` (home_id null ⇔ stray, species, name, description, photo_path,
  wanderer, microchipped, missing, missing_since, care_state for strays).
- `jc_pet_sightings`, `jc_pet_care_log`.
- Storage bucket `pet-photos`: private, `file_size_limit`, image MIME allowlist;
  read/write via signed URLs issued by RPC — no public bucket.

**Offboarding (cross-slice):** account delete → `jc_accounts`/`jc_home_members`
cascade; history FKs to users `on delete set null` (anonymized history stays with
the home). Last member leaving → future bookings + live entries cancelled,
admin notice raised.

## Step 3 — Regression surface

- `/commons/` landing renders Jubail config (name, modules greyed, broadcast,
  links) — `jc_config_get` keys preserved; verified by rollback test + live curl.
- Error fallback on the landing still fires if the RPC fails.
- Halloween site + SignalPost: untouched (different project).

## Step 4 — Proposal: split into four slices

The synthesis said "one migration while tables are empty." The constraint that
matters is **empty tables**, not a single file. One ~1,200-line migration is past
the point where a reviewer catches what matters (and both reviewer gates are
mandatory). Proposal: **four ordered migrations (S1→S4), one PR each, each gated**,
all applied before any invite. The emptiness guarantee is mechanical: **no join
code is set until S4 is applied**, so `jc_join` fails closed and no resident row
can exist mid-batch. Schema **freezes when S4 merges** — later changes go
through `/plan-change`.

| Slice | Est. SQL LOC | Gates |
|---|---|---|
| S1 identity/homes/admin | ~350 | database-reviewer + **security-reviewer** |
| S2 events/archive/instrumentation | ~300 | database-reviewer + security-reviewer |
| S3 courts | ~200 | database-reviewer |
| S4 pets + storage | ~200 | database-reviewer + **security-reviewer** (storage) |

Each exceeds the 200-LOC soft cap: SQL DDL is declarative and per-table; splitting
further fragments tables from the RPCs that guard them, which is worse for review.

- **Cost impact:** $0. Free tier: 500 MB DB, 1 GB storage — photos capped per file.
- **Migration:** DDL only; no data migration (tables empty). S1 drops plaintext
  code columns + S2 replaces `jc_entries` — **delete-bearing DDL may be declined by
  local tooling** → Zee pastes those statements (same pattern as T1).
- **Out-of-band config (manual, recorded in manifest):** Auth → email confirm OFF,
  min password length, Site URL + redirect allowlist (reset email target),
  leaked-password protection.

## Step 5 — Premortem

| # | Mode | Exposure | Mitigation (in-slice) |
|---|---|---|---|
| 6 | Auth/RLS regression | **Highest.** Default ACLs expose every new function/table to anon. | Each slice opens with `alter default privileges … revoke` for anon/authenticated + explicit per-function grants. **Allowlist test:** query enumerating every anon/authenticated-executable `jc_` function and every table grant must equal the declared allowlist — fails on any extra. |
| 6 | Cross-community leak | Client-supplied community id | Community derived from `jc_me()`; tests impersonate a user in community B against A's rows. |
| 6 | Open Auth signup | Anyone with the anon key can create an `auth.users` row | Accepted: such a user has no `jc_accounts` row ⇒ every RPC raises `NOT_MEMBER`. T3 gateway may move signup server-side. |
| 1 | Silent corruption | Denormalized community_id mismatch; number variants (12-A/12A) | Composite FKs (child community = parent community); generated `number_norm`; vacancy derived, not stored. |
| 2 | Silent zero-output | Authz failure returning `[]` looks like "no data" | `jc_me()` raises; tests assert raise, not empty. Snapshot canary = T4. |
| 2b | Config drift | Auth dashboard settings, storage bucket limits live outside migrations | Manifest records each value; Step 8 checklist re-verifies before invites. |
| 5 | Races | Two claims on one villa; 5th household member; double booking; quota; close vs signup | Unique constraints are the backstop; home/event rows locked `for update` before count checks; close takes the event lock and flips status before snapshot. |
| 7 | Rollback | Pre-invite: each slice reversible (drop objects; tables empty). Post-invite: forward-only. | Down section per migration; codes stay NULL until S4 ⇒ no data at risk mid-batch. |
| 3 | Cost | Hits table + photos | Page allowlist on `jc_hits`; bucket file_size_limit. |
| 4 | Contract drift | `jc_config_get` consumers; Supabase Auth API | Keys preserved; landing regression test. |
| — | Sequencing | Building modules before freeze | T5 starts only after S4 merges. |

## Step 8 — Verification (per slice)

- **Automated:** `tests/sql/<slice>.sql` — runs against JubailCommons inside
  `begin … rollback` (tables empty ⇒ safe, $0, no branch needed), impersonating
  roles via `set local role` + `request.jwt.claims`. Asserts: grant allowlist,
  NOT_MEMBER raises, cross-community denial, cap/quota/double-book races
  (sequential simulation), close-archives-not-deletes, `jc_config_get` keys.
- **Manual:** landing renders; join with wrong code tar-pits; Auth settings match
  manifest.

## Decisions (ratified by Zee 2026-11-03)

D1 four slices (S1→S4), all applied before any invite · D2 RPC-only access ·
D3 admin unlock bound to the account (all devices; exit = everywhere) · D4
concurrent live events allowed · D5 purge deferred, retention_days removed from
public config · D6 Halloween 2026 baseline row seeded in S2.
H1 (security review, ratified 2026-11-03): codes are 10+ server-generated chars,
so the guess-rate defence is entropy. The 1.5 s tar-pit is REMOVED from the join
paths (anon `jc_code_check`, open-signup `jc_join`) — there it only let anyone pin
DB connections — and KEPT on `jc_admin_unlock` (resident-only, attributable).
Failure counters stay on all paths; per-IP limits arrive with T3.

Testing note: the local tooling declines delete/drop-bearing SQL, so the S1
dry run (migration + tests, always ending in a raise ⇒ full rollback) is pasted
into the SQL editor by Zee.

## Test harness (from S2 on)

`tests/sql/build_dryrun.sh [pending migrations]` → one paste: migrations + `00_grants`
(cumulative allowlist + structural checks) + every slice test + `zz_finish` (always
raises ⇒ full rollback). Fixtures live in `jubail` and are rolled back; `00_grants`
**aborts if jubail has real residents** — post-launch, slice tests must move to test
communities before they can run again.

**Launch-checklist additions (not automatable in one transaction):** two-tab manual
concurrency run — (a) `jc_event_close` in tab A while tab B signs up (expect
SIGNUPS_CLOSED or inclusion in the snapshot, never a gap); (b) two household members
sign up at once (one row, last write wins).

**Accepted residuals (S2 reviews):** signup/withdraw churn writes one state-log row per
call (T3 rate limits); a deleted account's crowd reports vanish with it (its data).

**S3 product calls (ratified 2026-11-03):** daily quota counts across ALL courts
(`modules.bookings.per_home_per_day`, default 1); residents cancel any time before
the slot starts; an admin block cancels the bookings it covers (reason shown);
no cap on total upcoming bookings per home for launch (revisit with real usage).
Launch checklist adds a two-tab run: block creation while a booking is in flight
(expect the booking cancelled by the block, never live inside it).
