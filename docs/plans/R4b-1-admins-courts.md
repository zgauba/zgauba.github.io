# R4b-1 — Admins screen + Courts editor (plan, /plan-change)

Status: **PLAN — awaiting Zee's approval.** Branch `feat/r4b1-admins-ui`. Date 2026-11-08.
Source: `docs/plans/R4-courts.md` (R4b-1 row, C5), manifest R4a-2 / R4a-3 entries, review deferrals in
`docs/qa/R4a-2-review-2026-11-08.md` (S4, S9) and `docs/qa/R4a-3-review-2026-11-08.md` (D3, S10).

## Step 0 — Scope + freshness

**Tier: cross-layer.** It is client only (no migration), but it is the UI for an **auth boundary**: invite links
are bearer tokens up to root (`community`), and the Courts tab widens who can enter Organizer tools.

Manifest LAST VERIFIED 2026-11-08 (today). Re-queried live, read-only: the 10 RPCs these screens call are granted
to `authenticated` (`jc_module_admin_link_create / _accept / _revoke`, `jc_module_admins_list`,
`jc_admin_facilities_list / _facility_save / _facility_status / _facility_day`, `jc_admin_booking_rules`,
`jc_admin_code_rotate`); `jc_module_admins` = 0 rows; `jc_facilities` = 0 rows; codes set: `jubail:community`,
`e2e:community|join|events` (**no Jubail join code — nobody can join Jubail yet**); `e2e.modules.bookings.enabled = false`.

## Step 1 — Inventory

| Layer | Touched? |
|---|---|
| DB / RPCs | **Read only, no change.** Contracts read from `20261108200000_r4a3_unified_admins.sql` (link_create → `{token, scope, expires_at}`; accept → `{scope}`, errors `BAD_LINK` / `ALREADY_ADMIN`; list/revoke → `{scope, admins[{user_id, name, village, type, building, number, granted_at, last_used_at, via[], idle}], links[{id, created_at, expires_at}]}`; revoke errors `LAST_ADMIN` / `NOT_FOUND`; `TOO_MANY_LINKS`) and `20261108090000_r4a_courts.sql` (facility list/save/status; `RULES_LOCKED`, `FACILITY_RETIRED`, `BAD_STATE`, `BAD_FIELDS`; columns + checks from `s3_courts.sql`: name ≤ 60, note ≤ 200, slot ∈ {30,45,60,90,120}, window 1–30, open/close same day ≥ one slot). |
| `commons/admin/admin.js` (2088 lines) | **Yes.** `ADM_TABS` (+ Courts), `canEnter()` (+ bookings), `admCommunityHtml` (+ Admins entry, rotate copy), new views `admins`, `acceptInvite`, `courts`, `court`; boot reads the invite fragment. |
| `commons/admin/admin.css` | Yes, small (admin rows, via/idle chips, court rows). |
| `commons/assets/strings.js` | Yes, EN + AR (AR marked DRAFT). |
| `commons/assets/api.js` | **Not touched** — checked `jcSafeNext` (L135): the invite comes back via sessionStorage, not `next`, so no new redirect pattern. `JC_URL_HASH` (L45) only reads auth errors. |
| `commons/assets/nav.js` | Not touched — L27 already shows Organizer tools for any non-empty `admin_scopes` (so bookings-only admins already see the entry; today they hit the lock screen). |
| `commons/assets/icons.js` | Maybe (tennis / basketball glyph) — R4b-1b only. |
| Auth (Supabase) | Not touched; verify `detectSessionInUrl` (pkce) ignores `#admininvite=` (assumption A1). |
| Cron / Edge Functions / Storage | Not touched — no server change (grep for these RPC names in `supabase/functions/`: none). |
| Tests | `tests/e2e/specs/stub.js`, `backends.js` (stub shapes), new `admin-admins.spec.js`, new `admin-courts.spec.js`, `a11y.spec.js` (new views). |
| Docs | `docs/architecture.md` (client screens line under R4a-2/3), `docs/qa/` reviews. |

## Step 2 — Impact map

| Change | Behaviour | Shared consumers | Could break | Assumptions → verify |
|---|---|---|---|---|
| **Admins view** (Community tab → "Admins") | Community admins see four groups (Community · Events · Courts · Pets*), each: people (name, home, *Invited / Code* chip, *Unused 90+ days* chip), Remove; open links + Cancel; **Make invite link** (shown once, Copy / Share) | `show()`, `fail()`, the per-event Admins panel (same visual, separate RPCs) | `fail()` after **self-removal**: revoke succeeds, the caller is no longer community → re-read `jc_me_get`, land on what's left (or lock) | A2: revoke returns the payload even after self-removal (it does — `jc_admins_payload`, L370) |
| **Two-admin warning** | Banner when fewer than 2 Community rows have `invite` in `via` | — | none | — |
| **LAST_ADMIN copy** | Plain "you can't remove the last community admin — invite another first" | `jcErrText` table | none | — |
| **Invite landing** `admin/#admininvite=<token>` | Token in the **fragment** (never sent to GitHub/CDN logs or Referer). On load: validate `^[A-Za-z0-9_-]{16,64}$`, **strip it from the URL at once**, keep it in `sessionStorage` (per tab) across sign-in / join; then an Accept screen saying exactly what the role can do (per scope; community adds "full control, including adding and removing admins"); Yes → `jc_module_admin_accept`; clear storage on accept, decline, or any error | boot sequence (shared with `?eventadmin=`), account sign-in round trip | The existing `?eventadmin=` flow must keep working (unchanged) | A1: supabase-js pkce only reacts to `?code` / `#access_token`-style hashes → test with the real lib in one e2e |
| **Courts tab** + `canEnter()` widened to `has("bookings")` | Bookings admins (and community) get a Courts tab: list (status, upcoming count, walk-on), add / edit, Publish / Unpublish / Retire with counts in the confirm | `canEnter()` is used by lock, accept-decline, boot, fail (4 sites) | A bookings-only admin now **enters** Organizer tools: must see only Courts + Community (add code / exit), never Events or Banner. Events tab `show()` = `isOrganizer() || isEventAdmin()` (OK); Banner `show()` has `events.some(live)` — `events` is empty for them because `jc_admin_events_list` → `NOT_ADMIN` → today's `loadHome` error path **sends them to the lock** | **loadHome must tolerate NOT_ADMIN from the events list for a bookings-only admin** (as it does for the owner) — test it |
| **Rotate confirm copy** | "Change the {s}? Everyone who unlocked with it loses access now. People added by invite keep theirs." | — | none | Server: rotation bumps `code_version` → code unlocks die; `jc_module_admins` untouched (confirmed in R4a-3 header) |

\* **Pets** — no pets admin screens exist. A pets-only admin would enter (canEnter false) → the lock screen. **Recommend: hide Pets in the Admins view until the pets module has admin screens** (Q1).

## Step 3 — Regression surface

1. Code unlock (lock view) → home for community / events codes; "Enter another code"; Exit.
2. Per-event Admins panel: make link, copy, accept via `?eventadmin=`, remove, cancel link.
3. Event admin (no code) lands on their events only; owner-only lands on Feedback.
4. Tabs Events · Banner · Community: keyboard + `?tab=` deep link; banner draft survives a tab switch.
5. Health, Households, Feedback, Admin log entries from the Community tab.
6. Code rotate: new code shown once, Copy.
7. Language toggle on every new view keeps state (incl. the one-time link and half-typed court form).
8. `fail()` NOT_ADMIN re-read path.

## Step 4 — Proposal

**Split (required: > 200 LOC and two separate surfaces, both in `admin.js` / `strings.js` → serial, not parallel):**

| PR | What | Est. diff | Tier / review |
|---|---|---|---|
| **R4b-1a Admins** | Admins view (community / events / bookings; pets hidden — Q1), invite links (fragment + sessionStorage), Accept screen, two-admin warning, LAST_ADMIN / BAD_LINK / ALREADY_ADMIN / TOO_MANY_LINKS copy, idle chip, rotate confirm copy; `canEnter()` + `loadHome` tolerate bookings-only (so a Courts invitee doesn't hit the lock — they see Community until R4b-1b); e2e `admin-admins.spec.js` | ~260 client, ~180 e2e | **Auth-adjacent → security + code review** |
| **R4b-1b Courts editor** | as `R4-courts.md` R4b-1 row: Courts tab, list, add / edit (name EN/AR, kind tennis / basketball, pin via the existing `pinMapHtml` / `initPinMap`, note, hours, slot, window, walk-on), Publish / Unpublish / Retire (confirm states the bookings it cancels), `RULES_LOCKED` explained, effective rules + "module is off" notice | ~300 client, ~140 e2e | Screen logic + security review (gate widened) |

**Moved out:** *block-reason maxlength 185* belongs to **R4b-2** (the block form is the day grid; R4b-1 has no block
input — R4a-2 review D9 already says R4b-2). *Hide code UI for retired scopes + `jc_admin_code_rotate` refuses them*
(R4a-3 S10) needs a migration → after code retirement, its own small PR.

No cost impact (no paid layer). No migration, no re-seed. Cache: Pages CDN ~10 min; `?v=` bump on admin assets as usual.

## Step 5 — Premortem

| # | Mode | Exposed? | Mitigation |
|---|---|---|---|
| 1 | Silent data corruption | Court edit could send unchanged fields and trip `RULES_LOCKED` or overwrite another admin's edit | **Send only changed fields** (same rule as the event editor); e2e asserts the payload |
| 2 | Silent zero-output | Invite link made but never shown (list refresh fails) → token lost, link counts toward the cap | Show the link **even if the list refresh fails** (pattern from `wireAdmins`); e2e with a failing list stub |
| 2b | Config drift | e2e community has bookings off; a stale cached `admin.js` against new strings | Bump `?v=`; testing on live `e2e` needs `modules.bookings.enabled = true` there — **a live write, ask first** |
| 4 | Contract drift | Client reads `via` / `idle` / `links` | e2e stubs copy the exact R4a-3 payload; one real-backend smoke on `e2e` after merge |
| 5 | Race | Two admins removing each other | Server serializes (advisory lock → one gets `LAST_ADMIN`); client shows the copy and re-reads the list |
| **6** | **Auth regression** | (a) Token leaks via URL / history / Referer / screenshots. (b) Bookings-only admin sees events data. (c) A `community` invite forwarded to the wrong person = root. (d) Self-removal leaves a stale admin UI | (a) fragment, stripped on load, sessionStorage only, never logged; `admin/index.html` already sends `no-referrer` (L13, checked). (b) tabs gated + server `NOT_ADMIN`; e2e as bookings-only. (c) Community link: red-flag copy, 24 h, ≤ 3 open (server), the list shows who accepted; Remove is one tap. (d) `fail()`-style re-read after a self-remove; e2e |
| 7 | Rollback | — | Client-only: `git revert` of the merge; server grants untouched. Any accepted invite stays a valid grant (removable via the list or break-glass SQL) |

## Step 6 — Questions for Zee

- **Q1** Pets in the Admins view: hide until pets admin screens exist (recommended), or show now?
- **Q2** Move the existing per-event `?eventadmin=` link to the fragment too, for consistency? Recommended **yes, later** (its own tiny PR — it is live and has an accepted review; not in R4b-1a).
- **Q3** OK to set `modules.bookings.enabled = true` on the **e2e** community (not Jubail) for the R4b-1b live smoke test?

## Separate track (not R4b-1) — a Commons super admin across communities

**Weakest part first:** a cross-community super admin is a single bearer of root on every community. It is the
highest-value account on the platform, and today's design deliberately has none: `jc_platform_owners` reads feedback
only, gets no admin rights, and is not counted by the last-admin guard (R4a-3 header §6). Break-glass is SQL-editor-only.

What blocks it today:
1. **One account = one community** (`jc_accounts.user_id` PK + community FK). Every `jc_me()`-based RPC (92) derives
   the community from the caller; the multi-community note in the manifest already flags `jc_admin_has` /
   `jc_events_organizer` filtering by `auth.uid()` only.
2. **The SQL suite writes its fixtures into `jubail`** and aborts once Jubail has any account (`00_grants` L55).
   This is a launch-prep task regardless of super admin: move fixtures to a test community.
3. Zee's account lives in `e2e`.

Options:
| | What | Cost | Verdict |
|---|---|---|---|
| A | Super admin = an owner role that can *act in* any community without membership (community passed explicitly to admin RPCs) | Touches every admin gate + `jc_me()`; new trust boundary | Defer — design it when a second community is real |
| B | Multi-membership: `jc_accounts` keyed (user, community) + an "active community" | Rewrites identity for 92 RPCs | No — biggest change, least need |
| C | **One account per community** (Zee in `e2e` as test admin; a resident account in Jubail as a normal community admin, invited/bootstrapped like anyone) + owner break-glass stays SQL | Zero schema change | **Recommended now.** Zee *is* a Jubail resident; the second community doesn't exist |

Recommended sequence: (1) R4b-1a ships invites; (2) launch-prep PR moves SQL fixtures off `jubail` and removes the
`00_grants` abort; (3) Zee's Jubail account joins (needs a Jubail join code) → bootstrap with the community code once
→ self-invite → invite a second admin in another household; (4) revisit option A when community #2 is signed.

## Step 8 — Verification (per PR)

Automated: e2e (Chromium + WebKit) with stubbed RPCs — R4b-1a: list render per scope, chips, two-admin warning,
make link shown once + survives failing list, cancel link, remove (confirm), LAST_ADMIN copy, self-remove → re-read,
fragment stripped on load, signed-out round trip keeps the invite (sessionStorage), accept / decline / BAD_LINK /
ALREADY_ADMIN, bookings-only admin lands without the lock and sees no Events/Banner, rotate confirm text, AR + RTL,
axe on the new views. R4b-1b: per `R4-courts.md`. Mutation check: each new assertion fails when its line is reverted.

Manual (after merge, on `e2e` with Zee's account): make a community invite → open in a private window signed in as a
second e2e account → accept → it shows under Community with *Invited*; remove it; try removing yourself as last →
LAST_ADMIN copy.
