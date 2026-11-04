# T5.2 — Per-event admins (plan, 2026-11-04)

**Ask (Zee, 2026-11-04):** "creation of events should be done by community admin who can then
grant someone admin rights to the event." Retire the shared `events` organizer code. The events
list's Admin badge (PR #31) narrows to the events a person was granted.
Related ask, **split out** (see D3): "Commons app admin level access so that I can be the app
admin as well as the community admin."

Protocol: End-to-End Thinking (`/plan-change`). **Scope tier: cross-layer** — permission model,
schema, 10 live RPCs, a public contract (`jc_me_get`), client, tests, out-of-band codes.
Manifest LAST VERIFIED 2026-11-04 (today); the admin layer was re-queried live for this plan.

## Step 1 — Inventory (live wins)

| Layer | Touched? | Check |
|---|---|---|
| `jc_codes` / `jc_admin_grants` (scope CHECK incl. `events`) | **Yes** — `events` scope retired (PR C) | s1 migration lines 104–192; live `jc_codes`: **only `e2e` has an `events` code (v1)**; `jubail` has **no admin codes at all**; live grants: 1 (`e2e`/`events`, Zee) |
| `jc_assert_admin(scope)` + 10 live fns calling it with `'events'` | **Yes** — event-scoped check | live `pg_proc` scan: `jc_admin_event_save` / `_publish` / `_signups`, `jc_event_close`, `jc_admin_entries_list` (take the event id); `jc_admin_entry_moderate`, `jc_admin_entry_pin_set` (take an **entry** → event derivable); `jc_admin_home_pin_set` (a **home**), `jc_admin_broadcast_set` (**community-wide**), `jc_admin_events_list` (all events) |
| `jc_admin_unlock` / `jc_admin_code_rotate` / `jc_code_bootstrap` | **Yes** (PR C) — `events` dropped from scope loops/allowlists | s1 lines 695–760 |
| `jc_me_get` (contract, every page) | **Yes** — additive `admin_events: [event ids]` | s1 line 441 (`admin_scopes`) |
| Offboarding (`jc_home_detach`, `auth.users` delete trigger) | **Yes** — new grants must vanish with the account | FK `on delete cascade` to `jc_accounts`, as `jc_admin_grants` does |
| `jc_admin_log` | **Yes** — grant / revoke / accept logged | existing `jc_admin_log_add` |
| Client `commons/admin/` | **Yes** — `isOrganizer()` = `has("events") \|\| has("community")`; code rotation lists `events` | admin.js 55, 119 |
| Client `commons/events/` | **Yes** — Admin badge reads scopes today | events.js (PR #31) |
| Client `commons/home/` | **Yes** — grant-link landing (accept screen), like `?invite=` | home.js invite flow |
| SQL test suite (424 checks) | **Yes** — s2 / s8 / 00_grants use the `events` code | `grep -ln "'events'" tests/sql` |
| Stubbed e2e (111) | **Yes** — `adminBackend` scopes, badge tests | `specs/backends.js` |
| Smoke (`tests/e2e/smoke`, real `e2e`) | **Check in PR B** — whether it unlocks with the events code | `grep` found no `admin_unlock` in smoke/ |
| Private ops doc (codes list) | **Yes** — `events` code for `e2e` listed there | out-of-band; Zee updates |
| Courts / pets / bookings scopes | Not touched — confirmed: their fns call `jc_assert_admin('bookings'|'pets'|'community')`, never `'events'` (live scan above) |
| SignalPost / Halloween site | Not touched — separate project (`jh_`), no shared fns |
| Pages / CSP / cron / Storage | Not touched — no new hosts, jobs, buckets |

## Step 2 — Impact map

1. **New: event-admin grants.** Table `jc_event_admins(event_id, user_id, granted_by, granted_at)`
   + single-use **grant links** (`jc_event_admin_invites`, hashed token, 72 h — same shape as
   household invites). Community admin: create link / list / revoke. Member: accept.
   *Consumers:* none yet. *Breaks:* nothing (additive).
2. **New helper `jc_assert_event_admin(event_id)`** = community admin **or** a grant on that
   event (or, until PR C, the legacy `events` scope — back-compat for cached pages).
   *Consumers:* the 10 fns. *Could break:* a fn that derives the wrong event → **widening**
   (admin of A edits B). See premortem #6.
3. **The 10 fns switch to it**, each deriving the event server-side from its own argument:
   - event id given → that event;
   - entry id → the entry's event;
   - `home_pin_set` → allowed if the home has an **active entry in an event you admin**;
   - `broadcast_set` → allowed while **an event you admin is live** (event-day alerts);
   - `admin_events_list` → filtered to your events (community admin: all).
   - **create** (`event_save` with no id) → **community admin only**.
   - **publish** → community admin only (D2: the approval gate, incl. JICM for one-place events).
4. **`jc_me_get` adds `admin_events`** (additive; old pages ignore it). Badge + admin page read it.
5. **Retire `events` scope (PR C, after B is live ≥ 1 day):** delete the `e2e` events code + grant,
   drop `events` from the two CHECKs, unlock loop, rotate allowlist, client rotate list,
   strings, tests. *Breaks if early:* a cached old admin page whose user relied on the code.

Assumptions (to verify in PR A): every entry row carries its `event_id` (yes — entries are keyed
by event); `jc_event_close` is the only archive path (yes — manifest); account delete cascades
via `jc_accounts` (pattern exists on `jc_admin_grants`).

## Step 3 — Regression surface (must keep working)

- Community admin (code-unlocked) can do **everything** an events organizer does today.
- Residents: sign up / withdraw / map / list / stats — no admin call touched.
- Courts / pets admin unlock + actions (scopes untouched).
- Code rotation for join / community / bookings / pets.
- Offboarding: deleting an account removes its grants (incl. event grants) and nothing else.
- Admin badge + `admin/?event=` deep link (PR #31) — now per granted event.
- Rate limits / tar-pit on `jc_admin_unlock` unchanged.

## Step 4 — Proposal (split — mandatory: >2 layers, contract change, data removal)

| PR | What | Ship gate |
|---|---|---|
| **0 (ops, no code)** | Mint Zee's **community admin** codes for `jubail` + `e2e` (`jc_code_bootstrap`, shown once, kept in the private ops doc). Prerequisite: only community admins can create/grant. | Zee runs it / OKs it |
| **A (DB, `/db-rehearse`)** | grants + grant links + `jc_assert_event_admin` + the 10 fns switched + `jc_me_get.admin_events`. **Legacy `events` scope still honored.** New test slice s9: for each of the 10 fns, own-event allowed / other-event refused / resident refused / community admin allowed. Grace window: read allowed at close + 4 days, refused at close + 6; every write refused once closed. | dry run green, DB + security review saved, Zee "apply" |
| **B (app)** | Community admin: per event **"Event admins"** section — make grant link (copy/share), list (display name or masked email + home), revoke. Accept screen (`home/?eventadmin=<token>`) says what the role sees. Event admins land on **their** events; create/publish hidden; badge from `admin_events`. | e2e + `/shot`, reviews saved, "merge" |
| **C (DB + app, deprecation)** | Remove the `events` scope everywhere (data + CHECKs + fns + client + tests). | B live ≥ 1 day; private ops doc updated; "apply" + "merge" |
| *(separate plan)* **App admin** | Platform-level role across communities. | D3 |

**Diff budget:** A ≈ 300–400 lines, most of it the s9 test slice (~40 checks) — over the 200 soft
cap; the alternative split (helper without enforcement) ships nothing testable, so A stays whole.
B ≈ 200. C ≈ 120. **Cost:** none (no paid layer; free-tier DB, a few rows).
**Migration:** A additive; C deletes 1 code row + 1 grant row (`e2e` only).

## Decisions for Zee (recommendation first)

- **D1 — How the community admin picks the person: a grant link** (recommended). The admin taps
  "Make admin link", sends it (WhatsApp), the person opens it signed in and accepts; the admin then
  sees who holds it and can revoke. Alternatives: pick a home (but which account in a household?)
  or type an email (an email-lookup feature → PII search surface). Link = consent + no lookup.
- **D2 — What an event admin can do:** everything for *their* event — edit details + questions,
  open/pause sign-ups, moderate entries, fix pins (event-only, or the home's pin if that home is
  signed up), CSV, banner while their event is live, **close** it afterwards. **Not:** create,
  publish (community admin approves — that's where the JICM-approval notice for one-place
  events lands in PR 3b), grant others, codes.
- **D3 — App admin: separate plan**, after this. It's a new top layer (create communities, act
  across them), not needed for per-event admins. Until then PR 0 makes you community admin of
  both communities, which covers everything you can do today.
- **D4 — Grant lifetime (Zee: close + 5 days):** a grant is valid while the event is open and
  for **5 days after it is closed** (`jc_events.archived_at`, already on the table — the check
  computes it at call time; **no cron, nothing to clean up**). During the 5 days access is
  **read-only** (entries list / CSV / stats — wrap-up and hand-over); every write still refuses
  on a closed event as today. Also ends on revoke or account deletion. No 60-day inactivity
  expiry (that exists for shared codes; a named grant is revocable instead).

## Decisions (Zee, 2026-11-04)

D1 **grant link** · D2 **as recommended** (create + publish community-only; event admin
closes) · D3 **app admin = separate plan** · D4 **close + 5 days, read-only in the grace
window**.

## Step 5 — Premortem (catalog §0.5 + deprecation walk)

| # | Exposed? | Mitigation |
|---|---|---|
| **6 Auth regression** (required) | **Yes — the core risk.** A fn deriving the wrong event = admin of A edits B; `home_pin_set` / `broadcast_set` have no event argument. | Each fn derives its event server-side from its own argument; s9 runs **own / other / resident / community** for all 10 fns + the two event-less rules; security-reviewer foreground before "apply". Create + publish stay community-only. |
| **1 Silent corruption** (required) | Yes — a forwarded grant link accepted by the wrong person. | Single use, 72 h, same-community members only; accept screen names the event; community admin sees the holder (name / masked email + home) and revokes; every grant/accept/revoke in `jc_admin_log`. |
| **2 Silent zero-output** (required) | Yes — event admin opens admin and sees **no events** if the filter is wrong. | s9 asserts the filtered list per role; e2e asserts the event admin's landing list; badge test per granted event only. |
| **2b Config drift** (required) | Yes — cached old admin pages still offer the events code; private ops doc lists it; your tester may hold it. | PR A keeps legacy scope working; PR C waits ≥ 1 day after B (auto-update reloads idle pages in ~2 min); ops doc updated in PR C's checklist; ask before revoking the tester. |
| 5 Race | Two accepts of one link. | `update … where used_at is null returning` — second gets `INVITE_USED`; tested. |
| 7 Rollback | A: additive → revert = drop new objects, fns restored from S2/T5.2a bodies. C: re-run `jc_code_bootstrap('e2e','events')` + restore CHECKs from the mirror. | State in each PR. |
| 3 Cost / 4 Contract | Not exposed — no paid layer; `jc_me_get` change is additive. | — |

**Deprecation walk (`events` scope):** orphans → admin.js `isOrganizer` + rotate list, strings
`scope_events`, s1/s2/s8/00_grants tests, two CHECKs, unlock loop, rotate allowlist, manifest
line on scopes, private ops doc · frozen data → `e2e` code row v1 + 1 grant (deleted in C;
`jc_admin_log` history kept) · downstream → cached pages (2b above) · billing → none.

**PII note:** listing event admins shows display name or masked email + home to the
community admin — the existing household pattern; the accept screen discloses it
(per-feature disclosure, Round-3 posture).
