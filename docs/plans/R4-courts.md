# R4: Courts (tennis + basketball). Plan (`/plan-change`, 2026-11-07)

> Sources: `docs/plans/ROADMAP.md` R4 + Decisions (Zee 2026-11-06: no padel, households book, no outside
> coaches, community admins add courts and their location), `docs/plans/backlog.md` "Facility booking
> module", `supabase/commons/migrations/20261103210000_s3_courts.sql` (T2 / S3), `tests/sql/s3_courts.test.sql`.
> Live state read **read-only** from JubailCommons (`qrpxfssdeeuzmsmlbtbu`) on 2026-11-07, after
> `20261107090000 r2b_1_organizer_acts` applied. PLANNING ONLY: nothing here is built or applied.
>
> **Parallel work right now:** R2b-2 is being BUILT (edits `admin/admin.js`, `events/events.js`,
> `assets/strings.js`, one migration). R3 (app shell: navigation, start page, Save as an app, a11y) is being
> PLANNED. The order and file rules below exist because of both.

## The headline finding

**Most of R4's server already exists and is live.** S3 (T2) shipped the courts schema and 13 RPCs on
2026-11-03: facilities with a slot grid, bookings with a double-booking index, admin blocks, a per-home daily
cap, an advance window, one-tap cancel, My bookings, vacancy release, and the module kill switch. **No client
uses any of it yet** (no `commons/bookings/` page, no Courts tab in Organizer Tools). All three tables are
empty. So R4 is mostly **screens**, plus one small migration that brings S3 in line with the 2026-11-06
decisions and closes two anti-squatting and privacy gaps found in this inventory.

## Step 0: Scope and manifest freshness

- **Tier: cross-layer (full protocol).** A migration (constraint swap, function bodies changed, possibly one
  new column and one cron), a change to the Organizer Tools entry gate (auth-adjacent), and two new screens.
- **Manifest:** `docs/architecture.md` LAST VERIFIED 2026-11-06 (1 day old, under 14). Because R4 touches
  `[live]` layers, the courts layer was re-queried now (Step 1). **Drift found (minor):** the manifest says
  82 authenticated functions; live has **85** (R2b-1's three RPCs applied 2026-11-07, migration history row
  `20261107090000 r2b_1_organizer_acts` present). That belongs to R2b-1's closeout, not R4. Nothing in the
  courts layer has drifted from the repo.

## Step 1: Inventory (every layer, each with its check)

| Layer | Touched? | Check (2026-11-07, read-only) |
|---|---|---|
| **DB tables** `jc_facilities`, `jc_bookings`, `jc_booking_blocks` | **Yes.** Swap `jc_facilities_kind_check` (`padel/tennis/other` → `tennis/basketball`). Possibly add `walk_on` (Q3) and `fee_note` (Q4). Add `check (display_name is null)` on `jc_bookings` (Q7). | `select count(*)`: **0 / 0 / 0** rows. `pg_constraint` on all three: matches S3 exactly (kind check, slot_minutes ∈ {30,45,60,90,120}, window_days 1–30, close ≤ 23:59, ≥ 1 slot fits, unique (id, community_id), composite FKs). `pg_indexes`: `jc_bookings_slot` = UNIQUE (facility_id, starts_at) WHERE status='booked' (the double-booking guard) is live |
| **Resident RPCs** `jc_facilities_list`, `jc_facility_day`, `jc_booking_create`, `jc_booking_cancel`, `jc_my_bookings` | **Body only** for `jc_booking_create` (ignore the name, add the active-bookings cap). **Signatures frozen** (signup-class rule). Others unchanged except `jc_facilities_list` gaining keys if Q3/Q4 add columns | `has_function_privilege`: all 5 authenticated-only, anon none. `pg_get_functiondef(jc_booking_create)`: same as the S3 file (module check → facility FOR SHARE → home FOR UPDATE → `jc_home_hold` → `jc_slot_check` → block check → `QUOTA_REACHED` → insert, `unique_violation` → `SLOT_TAKEN`) |
| **Admin RPCs** (8: facilities list/save/status/day, booking cancel, name clear, block create/remove) | **Body only** for `jc_admin_facility_status` (add published → draft = Unpublish). `jc_admin_booking_name_clear` becomes dead once names are gone (left in place, see Secondary findings) | All 8 authenticated, anon none. All use `jc_assert_admin('bookings')`, which accepts a **bookings or community** grant (live body read). None calls `jc_module_on`, so admins can set courts up while the module is off. That is what Jubail needs before R8 |
| **Internal helpers** `jc_facility_grid`, `jc_slot_check`, `jc_booking_quota`, `jc_bookings_cancel_range`, `jc_clean_line` | **Body only** for `jc_facility_grid` (stop returning `display_name` to residents). New internal helper `jc_booking_active_cap(text)` | All 5 revoked from anon/authenticated (live). Grid live body matches S3 |
| **Identity helpers** `jc_me`, `jc_home_hold`, `jc_assert_admin(text)`, `jc_module_on` | Not touched | Live bodies read. `jc_home_members.user_id` is the primary key, so **one home per account** (S1 L152): a person can't hold two homes' caps |
| **Vacancy path** `jc_home_vacated` | **Not touched, deliberately.** It already cancels the home's future bookings and nulls names. R2a, R2b-1 (and possibly R2b-2) each re-created this body. Touching it in R4 would race R2b-2 | Live body read: lines "S3: future court bookings are released…" present. Reached from `jc_home_detach`, `jc_account_delete`, `jc_admin_member_remove`, the `auth.users` delete trigger (manifest) |
| **Config** `jc_communities.modules.bookings` | Read only. Possibly a new key `per_home_active` (Q1). No RPC writes `modules`; it's an out-of-band SQL edit (Zee) | Live: `jubail` = `{"enabled": false, "per_home_per_day": 1}`, tz `Asia/Dubai`. `e2e` = `{"enabled": false}` (no cap key, so `jc_booking_quota` falls back to 1). `jc_config_get` returns `modules` and `tz` publicly |
| **Admin grants** | Not touched | `jc_admin_grants where scope='bookings'`: 0 rows. A `bookings` admin code scope exists (S1). Community admins already pass `jc_assert_admin('bookings')` |
| **Cron** | **None today touches bookings** (except the snapshot's read). Possibly one new daily purge (Q8) | `cron.job` live: `jc-hourly-snapshot`, `jc-orphan-users`, `jc-photo-purge`, `jc-feedback-notify`, `jc-feedback-purge`, `jc-event-autoclose`. Only `jc_snapshot_run` reads `jc_bookings` (upcoming / next_24h / created_24h counts, hourly, per community) |
| **Logs** `jc_state_log`, `jc_admin_log` | Read only. Booking create/cancel already log to `jc_state_log` (`booking`, `booking_cancel`); admin acts to `jc_admin_log`. Organizer Tools history already labels them (`adm_h_ch_booking*` strings exist) | S3 bodies; `admin.js` L205 |
| **Edge functions / Resend** | Not touched | No courts email path; `jc-photo-purge` is pets-only |
| **Client: nav** `assets/nav.js` | **R3 owns this file.** Today it hard-codes `["events", "bookings"]` and links `bookings/`, shown only when the module is on | `nav.js` L1–12 |
| **Client: hub** `assets/landing.js`, `assets/icons.js`, `assets/strings.js` | Hub card + "Book a Court" CTA and the `bookings` icon already exist. New strings for every Courts screen (EN + AR) | grep `bookings` in `commons/` |
| **Client: Organizer Tools** `admin/admin.js` | **Yes (R4b).** New "Courts" sub-tab. `canEnter()` = `isOrganizer() || isEventAdmin() || owner`, where `isOrganizer` = events or community. **A bookings-only admin can't get in today** | `admin.js` L40–46, L138–140 |
| **Client: resident page** `commons/bookings/` | **Yes (R4c), new.** Doesn't exist. The tab bar already points at it | `ls commons/` |
| **Tests** | `tests/sql/s3_courts.test.sql` (300 lines, exists); new `s16_courts_r4.test.sql`; `00_grants` (signatures + allowlist); e2e `stub.js` + new `admin-courts.spec.js`, `courts.spec.js` | `ls tests/sql tests/e2e/specs` |
| **Pages / Cloudflare / `_headers`** | Not touched. New page `commons/bookings/index.html` is served by the existing deploy | no deploy config in scope |
| **SignalPost / Halloween / personal pages** | Not touched | no `jh_`, `jubail-halloween/`, `index.html` in scope |

## Step 2: Impact map

### 2.1 What S3 already enforces (so R4 doesn't rebuild it)

| Rule | Where | Notes |
|---|---|---|
| Double booking impossible | UNIQUE (facility_id, starts_at) WHERE booked | Correct because every booking is exactly one grid-aligned slot (`jc_slot_check`) and the grid can't change while future bookings exist (`RULES_LOCKED`) |
| Advance window | `window_days` per court (default 7, 1–30); "today counts as day 1" | Per court, edited by admins |
| Max slot length | One booking = one slot; `slot_minutes` ≤ 120 | Back-to-back slots are blocked by the daily cap of 1 |
| Per-home daily cap | `modules.bookings.per_home_per_day` (default 1), across **all** courts, by Dubai day | Home row `FOR UPDATE` serializes two members of the same home |
| Block vs booking race | Block takes the facility `FOR UPDATE`, booking `FOR SHARE` | A block cancels covered bookings with the reason, which residents see in My bookings |
| Kill switch | `jc_module_on` in all 5 resident RPCs → `MODULE_OFF` | Admin RPCs deliberately skip it |
| Household leaves | `jc_home_vacated` cancels future bookings ("Household left") | New family never sees old bookings (`jc_my_bookings` filters by `joined_at`) |
| Retire a court | Cancels all future bookings ("Court no longer available") | One-way |

### 2.2 Changes and their consumers

**(a) Kind: `tennis | basketball`.** Drop `jc_facilities_kind_check`, add the new one. The migration first
asserts `not exists (select 1 from jc_facilities where kind not in ('tennis','basketball'))` and raises if
any exist (0 today). Consumers: `jc_admin_facility_save` (passes `kind` straight through; a bad kind becomes
`BAD_FIELDS` via `check_violation`), both list RPCs and the client icons. Break risk: none (no rows, no client).

**(b) No names on bookings (zero-PII: by home, never by name).** S3 has an opt-in `display_name` that
other residents see on the grid. That contradicts the R4 brief.
- `jc_booking_create` keeps its signature `(uuid, timestamptz, text)` but stores `null` whatever is sent.
- `jc_facility_grid` stops returning `display_name`.
- `check (display_name is null)` on `jc_bookings` makes it a data rule, not just an RPC habit.
- The column, `jc_admin_booking_name_clear`, and the null-out line in `jc_home_vacated` stay (dropping them
  means re-creating `jc_home_vacated`, which collides with R2b-2). R7's grant audit removes them.
- Consumers: no client reads it yet. `jc_my_bookings` returns `display_name` only for `booked`, now always null.

**(c) Unpublish (published → draft).** S3 only allows draft → published → retired. Proposed: published →
draft also allowed; it **cancels future bookings** with the reason "Court temporarily unavailable", the same
path as retire (`jc_bookings_cancel_range`), and the confirm shows the count (`upcoming` is already in
`jc_admin_facilities_list`). A hidden court that still holds bookings would be a ghost residents can't
see on the grid. For a short closure, admins use a **block**, which keeps the court visible as "Unavailable".
Re-publish is draft → published (exists).

**(d) Active-bookings cap (new anti-squatting rule).** With a 7-day window and 1 per day, one home can hold
**7 prime slots at once** on the only tennis court. Proposed `modules.bookings.per_home_active` (default 2):
the number of upcoming `booked` slots a home may hold across all courts. Checked in `jc_booking_create` under
the same home row lock, so it's race-free like the daily cap. A malformed value falls back to the default,
like `jc_booking_quota`. New error `ACTIVE_CAP_REACHED`. (Q1)

**(e) Walk-on courts (Q3) and fees (Q4).** Only if the inventory needs them: `walk_on boolean not null
default false` (listed with pin and hours, no grid, every booking RPC raises `WALK_ON`), and `fee_note text
≤ 120` (display-only, e.g. "Paid at the clubhouse"; Commons never takes money). Each column adds an editor
field, list keys, and one check in `jc_booking_create` / `jc_facility_day`.

**(f) Booking-row retention (Q8).** Nothing ever deletes bookings. Over a year that's a per-home record of
when a household plays. Proposed daily cron `jc-bookings-purge`: delete bookings and removed blocks whose
`ends_at` is older than `retention_days` (30). The snapshot already keeps the counts hourly.

### 2.3 Time zones

- **The server is the authority:** days are `jc_communities.tz` = `Asia/Dubai` (UTC+4, no DST, so no
  23- or 25-hour days). `starts_at` is `timestamptz`; the grid builds slots as `(date + open_time) at time
  zone tz`.
- **The client risk is the device clock zone.** A resident whose phone is set to London (or an admin
  travelling) would see "today" and slot labels in the wrong zone. Rule for R4b and R4c: **every date and
  time is computed and formatted with `cfg.tz`** (the events page already does, `events.js` L53/L546). The
  date sent to `jc_facility_day` is "today in Dubai", never `new Date()` local. e2e runs with Playwright
  `timezoneId: "Europe/London"` and asserts Dubai labels.
- **Edge:** close time can't be 24:00 (check `close ≤ 23:59`). A court lit until midnight is entered as
  23:59, so its last 60-minute slot is 22:00–23:00, not 23:00–24:00. Cosmetic; flagged in the editor help.

### 2.4 Races (double booking and cap bypass are the centre)

| Race | Outcome today | Evidence |
|---|---|---|
| Two homes, same slot, same instant | One wins, the other gets `SLOT_TAKEN` | Unique partial index; insert catches `unique_violation` |
| Two members of one home, two slots, same day | Second waits on the home row, then `QUOTA_REACHED` | `jc_homes FOR UPDATE` before the count |
| Admin block vs resident booking | Block waits for in-flight bookings (FOR UPDATE vs FOR SHARE), then cancels them; later bookings see the block → `SLOT_BLOCKED` | S3 comments + body |
| Admin edits grid vs resident booking | Serialized on the facility row; `RULES_LOCKED` if a future booking exists | `jc_admin_facility_save` |
| Unpublish vs booking | Same facility lock; booking re-checks `status='published'` | (c) uses the retire path |
| Cancel vs slot start | `starts_at > now()` in the UPDATE; after start, `NOT_FOUND` | `jc_booking_cancel` |
| Household leaves mid-booking | `jc_home_hold` (membership FOR SHARE) vs detach; vacate cancels anything committed | S1/S3 lock order: facility → home → membership → bookings |

These can't be exercised inside one rolled-back SQL transaction. **Two-tab concurrency** (two homes / same
slot; two members / same day; block vs booking) joins the R8 manual run list. The manifest's Known Gap 11
already lists "block vs booking".

### 2.5 Kill switch mid-day, move-out, archive

- **Module off mid-day:** the tab drops out of the bar, and every resident RPC raises `MODULE_OFF`. That
  includes `jc_my_bookings`, so residents can't see their bookings. Bookings are **kept, not cancelled**,
  so switching back on restores them. The resident page must show a clear "Court booking is paused" state on
  `MODULE_OFF`, never a blank grid. Organizers use the banner to say why. (Q9)
- **R3 interaction:** a saved start page or bottom-bar choice of "Courts" must lose to the kill switch.
  Fall back to the hub (see the R3 contract below).
- **Move-out:** already handled (2.1). New family: no inherited bookings or cancellation notes.
- **Archive:** bookings have no archive state; past rows just age (see (f)). Retired courts keep their history.

### 2.6 Assumptions (and how to verify)

1. Jubail's courts are few (1–4) and community-managed. **Verify:** Zee's facility inventory.
2. Official bookings are known ahead and can be entered as blocks. Recurring official bookings (e.g. every
   Tuesday 18:00–20:00) mean one block per week; **recurring blocks are not in R4** (Q6).
3. No outside coaches, so no "coach" role and no paid lessons.
4. Community admins do courts admin. A separate bookings code is optional (server already supports it).

## Step 3: Regression surface (must keep working)

1. **S3 suite** `s3_courts.test.sql`: every existing assertion still passes, except the opt-in-name ones,
   which are deliberately rewritten (names are now refused / null).
2. **Vacate path** (R2a/R2b-1 bodies): a household that leaves still releases future bookings. R4 doesn't
   re-create `jc_home_vacated`, and the s3 vacancy test re-runs.
3. **Grants allowlist** (`00_grants`): 13 courts RPCs keep their signatures. Any new helper is revoked from
   anon/authenticated.
4. **Hourly snapshot** keeps writing the `bookings` module row (upcoming / next_24h / created_24h).
5. **Organizer Tools for event organizers and event admins:** the tab set, Households, Banner and History are
   unchanged. Adding "Courts" and widening `canEnter()` must not show Events or Community tabs to a
   bookings-only admin.
6. **Tab bar and hub with the module OFF** (Jubail until R8): no Courts tab, no Courts card, no request to
   any courts RPC.
7. **R3's navigation settings** (once merged): Courts appears only while the module is on.
8. **Events pages** (`events.js`) untouched; R2b-2's merge isn't affected.

## Step 4: Proposal

**In plain English:** turn on the courts machinery that's already in the database. Make it fit the
2026-11-06 decisions (tennis and basketball only; bookings by home, never by name). Add the anti-squatting
cap that's missing (how many upcoming bookings a home may hold). Then build the two screens: Organizer Tools
→ Courts for community admins, and a Courts page for residents.

- **Cost:** none. No paid layer, tiny row counts. One optional daily cron, which is free on pg_cron.
- **Migration:** yes, R4a only. Constraint swap and function bodies; no table rewrite. `/db-rehearse`.
- **Split:** required (data migration + >2 layers + over 200 LOC). Four PRs:

| PR | What | Files | Tier / review | Diff (est.) | Waits for |
|---|---|---|---|---|---|
| **R4a: courts schema to spec** | (a) kind swap with zero-row guard; (b) no names: create ignores it, grid drops it, check constraint; (c) Unpublish; (d) `per_home_active` cap + `ACTIVE_CAP_REACHED`; (e) `walk_on` / `fee_note` **only if Q3/Q4 say yes**; (f) purge cron **only if Q8 says yes** | `supabase/commons/migrations/2026110Xxxxxxx_r4a_courts.sql` (timestamp **after R2b-2's**), `tests/sql/s16_courts_r4.test.sql`, `tests/sql/s3_courts.test.sql` (name assertions), `tests/sql/00_grants.test.sql`, `docs/architecture.md` (courts layer), `docs/qa/` review | Data: rehearse, suite twice, database + security + code review | ~140 migration (re-created bodies from live defs, patched by a script that fails if a patch point moves), ~150 tests | **R2b-2 merged and applied** (migration order and `00_grants` overlap). Zee's answers to Q1, Q3, Q4, Q7, Q8 |
| **R4b-1: Organizer Tools → Courts: the court editor** | Courts sub-tab (bookings or community scope); list with status + upcoming count; add/edit (name EN/AR, kind, map pin reusing the R1.1 pin-picker pattern, location note, open/close, slot length, window); Publish / Unpublish (confirm shows the count of bookings it cancels) / Retire; `RULES_LOCKED` explained; `canEnter()` widened to `has("bookings")` | `admin/admin.js`, `admin/admin.css`, `assets/strings.js` (EN + AR, AR marked DRAFT), `assets/icons.js` (tennis / basketball glyphs if not reusing `bookings`), `tests/e2e/specs/stub.js`, new `tests/e2e/specs/admin-courts.spec.js` | Screen logic **+ security review** (entry gate widened) | ~300 client, ~140 e2e | R4a applied; **R3 merged** (R3's a11y pass rebuilds the sub-tab rows in `admin.js`; R2b-2 merged first) |
| **R4b-2: Courts day grid for admins** | Pick court + day; see free / booked (home shown to admins) / blocked; cancel a booking with a reason; block a range (reason presets, Q5) and remove a block; a notice when a block cancelled N bookings | `admin/admin.js`, `assets/strings.js`, `stub.js`, `admin-courts.spec.js` | Screen logic + code-reviewer | ~220 client, ~100 e2e | R4b-1 merged |
| **R4c: Residents book a court** | New `commons/bookings/` (court list with map pins, hours, kind; per-court day strip for the window; grid; tap free → confirm → book; tap mine → one-tap cancel; My bookings with admin-cancel reasons); the **"Official community-management bookings take precedence."** line on the booking screen (EN + AR); paused / no-home / empty states; all times in `cfg.tz` | new `bookings/index.html`, `bookings/bookings.js`, `bookings/bookings.css`, `assets/strings.js`, `stub.js`, new `tests/e2e/specs/courts.spec.js` (Chromium + WebKit, `timezoneId` London) | Screen logic + code-reviewer (+ security if it renders anything about other homes beyond "Booked") | ~380 client, ~180 e2e | R4b-2 merged (shared `strings.js`/`stub.js`; and courts must exist to test against) |

Each client PR is over the 200 soft cap. Splitting further would ship half a screen (an editor that can't
publish, a grid without booking). That's the same call as R1 and R2a.

**Deploy order:** R4a applied to the DB first. It's additive for every current caller, since no client uses
courts yet. Then R4b-1 → R4b-2 → R4c, each merged after the previous one. **Jubail's `bookings` flag stays
OFF until R8.** Testing happens on the `e2e` community, which needs one out-of-band edit by Zee:
`modules.bookings.enabled = true` on `e2e` only. That's a live write, so ask first.

### Coordination with R3 (on paper: R3 should adopt these lines)

R4 adds no navigation code. It **relies on R3's navigation** for the Courts entry. The contract:

| # | R3 must… | Why |
|---|---|---|
| C1 | Keep a module registry with **`bookings`** in it: key `bookings`, label `module_bookings` ("Courts" / "الملاعب"), icon `bookings`, path `bookings/`. Don't hard-code an events-only list | `nav.js` already uses exactly this; R4c creates the page at that path |
| C2 | Default bottom bar for a new account: **Events + Courts** between the anchors (today's default) | Keeps the wireframe default |
| C3 | Offer "Courts" as a **start page** and bottom-bar choice **only while `cfg.modules.bookings.enabled`**. A saved pref naming a module that's now off falls back to the hub **silently**, without rewriting the saved pref | Kill switch beats personal prefs (premortem 2b, 6); switching back on restores the person's choice |
| C4 | **No module shortcuts in the static web manifest** (`shortcuts`), or a page that handles `MODULE_OFF` gracefully if there are any | The manifest is a frozen copy baked in at install; it can't follow the kill switch |
| C5 | Build the accessible sub-tab component in `admin.js` so a new tab ("Courts") is one entry in `adminTabs()` | R4b-1 adds the tab after R3's rebuild instead of patching the old rows |

**Order:** R2b-2 (building) → R3 build → R4b-1 → R4b-2 → R4c. **R4a can be built and rehearsed in parallel
with the R3 build**: no shared files (migration + SQL tests only), once R2b-2 has merged and applied. R4c
must not start before R3 merges. If R3 slips, R4c still works with today's `nav.js` (it already links
`bookings/`), so R3 is a soft dependency for R4c and a hard one for R4b-1 (`admin.js` tab rows).

## Step 5: Premortem (§0.5 catalog)

| # | Mode | Exposed? | How it would happen | Mitigation |
|---|---|---|---|---|
| **1** | Silent data corruption | **Yes** | (i) Booking lands on the wrong day/time: client computes "today" or labels in the device zone. (ii) An admin edits hours under live bookings and the grid misaligns. (iii) Kind swap meets an unexpected row | (i) All dates via `cfg.tz`; server validates every slot (`jc_slot_check`); e2e with `timezoneId: Europe/London` asserts Dubai labels and the `p_date` sent. (ii) `RULES_LOCKED` exists; s16 re-asserts it, and the editor explains it. (iii) Migration raises if any non-tennis/basketball row exists |
| **2** | Silent zero-output | **Yes** | Residents see an empty Courts page: module off, all courts in draft, `MODULE_OFF` / `NO_HOME` / `OUT_OF_WINDOW` rendered as a blank grid, or a grid with zero slots | Every error code has its own visible state (paused / claim your home first / no courts yet) and e2e asserts each text. SQL asserts slot count = (close − open) / slot for each fixture court. **Canary:** the hourly snapshot already records `upcoming` / `created_24h` per community; R4a adds an s16 assertion that a booking moves `created_24h` |
| **2b** | Out-of-band config drift | **Yes** | (i) `per_home_per_day` / `per_home_active` are hand-edited jsonb; a typo silently falls back to the default and nobody knows. (ii) R3 saved prefs or a static manifest shortcut still point at Courts after the kill switch. (iii) The resident screen shows a cap number from a stale cached config | (i) **Static-by-design note:** the values live in public config, are read on every call, and the fallback is the safe (strict) default. R4a adds the **effective** values (after fallback) to `jc_admin_facilities_list`'s output (wrapped as `{courts, rules}`, or an extra key, decided at build time), and the Courts tab shows them, so a typo is visible. (ii) R3 contract C3/C4. (iii) The client never enforces caps; it shows the server's error (`QUOTA_REACHED` / `ACTIVE_CAP_REACHED`) with the server's numbers |
| 3 | Cost blowout | No | Free tier; ≤ a few hundred rows a week; grid is one query per court-day | n/a |
| 4 | Contract drift | Low | Grid JSON loses `display_name`; `jc_booking_create` ignores its 3rd arg | No client consumes either yet. Signatures frozen and asserted in `00_grants`; R4c sends `p_display_name: null` explicitly |
| 5 | Race / ordering | **Central, mitigated by S3** | Double booking, cap bypass by two members, block vs booking, re-grid vs booking (table 2.4) | Unique partial index + home row lock + facility FOR UPDATE/SHARE; new active cap checked under the same home lock. Two-tab runs on the R8 manual list (+ "two members, same day" and "two homes, same slot") |
| **6** | Auth / RLS regression | **Yes** | (i) Widening `canEnter()` lets a bookings-only admin see Events/Community tools. (ii) A resident learns which home booked (grid leaks `home` / `booking_id`). (iii) A resident cancels another home's booking. (iv) A per-event admin gets courts powers. (v) Unpublish lets an admin cancel another community's bookings | (i) `adminTabs()` shows only Courts for bookings-only; e2e persona "bookings admin" asserts the exact tab list. **The server still gates every RPC** (`jc_assert_admin('bookings')`). (ii) s16: as resident, a booked slot of another home has **no** `home`, `booking_id`, `display_name`; e2e asserts the DOM shows only "Booked". (iii) Cancel is `home_id = v_home` (s3 test exists; re-run). (iv) s16: event admin → `NOT_ADMIN`. (v) Facility looked up `community_id = v_comm` (exists); s16 cross-community negative test |
| 7 | Rollback path | Yes, cheap | Bad migration or bad screen | R4a: down-migration re-creates the S3 bodies from the s3 file and swaps the kind check back (tables empty). Client PRs: `git revert`. Runtime: the module flag (off = everything hidden in seconds, bookings kept) |

**Cap-bypass checklist (central):** two members of one home (home lock ✓); cancel-and-rebook (allowed by
design; the daily cap still holds); a person joining a second home (impossible: one home per account ✓);
booking across midnight (slots can't cross a day ✓); booking a slot that has already started (`p_starts <=
now()` → `OUT_OF_WINDOW` ✓); hogging the week (**gap today**, closed by `per_home_active`, Q1); an admin
booking on residents' behalf (no admin booking RPC; admins use blocks ✓).

## Step 8: Verification outline (when built)

**SQL, `s16_courts_r4.test.sql`** (each fails on today's live code):
- Kind: create `basketball` ok; `padel` / `other` → `BAD_FIELDS`.
- Names: `jc_booking_create(…, 'Ahmed')` stores null; the grid has no `display_name` key for anyone; a direct
  insert with a name violates the check.
- Unpublish: published → draft cancels future bookings with the reason; the resident list hides the court;
  `jc_facility_day` → `NOT_FOUND`; re-publish works; draft → draft → `BAD_STATE`.
- Active cap: with `per_home_active = 2`, a third upcoming booking on another day → `ACTIVE_CAP_REACHED`;
  after one cancel, booking works again; a malformed value → default.
- Privacy: as home B, home A's booked slot carries no `home`, `booking_id`, `display_name`.
- Auth: per-event admin and plain resident → `NOT_ADMIN` on every admin courts RPC; bookings-scope admin ok;
  another community's facility → `NOT_FOUND`.
- Walk-on / fee / purge: only if Q3/Q4/Q8 are yes.
- `00_grants`: 13 signatures unchanged; new helper revoked; authenticated count +0 (no new public RPC).

**e2e (stubbed RPCs, Chromium + WebKit):**
- R4b: bookings-only admin sees only Courts; the editor sends only changed fields; Unpublish confirm shows
  the count, and dismissing sends nothing; `RULES_LOCKED` shows its explanation; block with a preset reason
  sends the exact args; a cancel needs a reason (3–200).
- R4c: the precedence line is visible on the booking screen (EN + AR, RTL); `timezoneId: Europe/London`
  still shows Dubai times and sends Dubai `p_date`; every error code shows its own text (`SLOT_TAKEN` →
  refresh grid, `QUOTA_REACHED`, `ACTIVE_CAP_REACHED`, `SLOT_BLOCKED`, `OUT_OF_WINDOW`, `MODULE_OFF`,
  `NO_HOME`); other homes show only "Booked"; cancel is one tap and sends `jc_booking_cancel` with the id;
  module off → no tab, no hub card, no courts RPC.

**Manual / post-apply:** full SQL suite twice on live (R4a); `get_advisors` shows no new category; e2e
community smoke (Zee enables bookings on `e2e`, an admin adds a court, a test home books and cancels, a block
cancels a booking and My bookings shows the reason); two-tab runs added to the R8 list; manifest courts layer
+ LAST VERIFIED updated in R4a.

## Open questions for Zee (each with a recommendation)

1. **Anti-squatting values.** Window **7 days** (per court, admin-editable); slot **60 min** default
   (30–120 allowed); **1 booking per home per day**; **new: at most 2 upcoming bookings per home** across all
   courts. *Recommend all four.* Without the last one, a household can hold the best slot every evening for a
   week. Revisit with real data after a month.
2. **Facility inventory (the blocker).** What R4 needs from it: how many courts, tennis or basketball, where
   (a pin), hours, walk-on or booked, any fee. *Recommend:* R4a can be built once Q1/Q3/Q4/Q7/Q8 are answered,
   without the full list. The list itself is entered by admins in R4b, not coded. Only Q3 (walk-on) and Q4
   (fees) change the schema.
3. **Walk-on courts** (common for basketball). *Recommend:* if any court is walk-on, add `walk_on` now
   (zero rows, cheap). It's listed with pin + hours + "Walk-on, no booking", with no grid. Otherwise skip it.
4. **Fees.** *Recommend:* if any court charges, add a display-only `fee_note` ("Paid to community management")
   and nothing else. No price field, no payment, no "paid" status. Commons coordinates intent only. If none
   charge, skip it.
5. **Block reasons.** *Recommend* preset chips in the admin screen (**Maintenance · Community event · Official
   booking · Other…**) that fill the free-text reason, with no schema change. Residents see only
   "Unavailable" on the grid, plus the reason when a block cancelled **their** booking. Recurring blocks
   (every Tuesday) are **not** in R4; add them only if the inventory shows recurring official bookings.
6. **Cancel cutoff.** *Recommend no cutoff* (cancel any time before the slot starts, as built). A cutoff makes
   people keep slots they won't use rather than release them. No-show handling waits for real data (ROADMAP).
7. **What residents see of other bookings.** *Recommend "Booked" only*: no home, no name, no count by home.
   This removes S3's opt-in name (zero-PII: by home, never by name), enforced by a check constraint. Admins
   see the home (needed to cancel with a reason), as they already do in Households.
8. **Old booking rows.** *Recommend a daily purge* of bookings (and removed blocks) more than 30 days past
   (`retention_days`), so Commons doesn't keep a long record of when each home plays. Counts survive in the
   hourly snapshots. About 25 lines in R4a.
9. **Kill switch behaviour.** *Recommend* switching off **hides and freezes** (bookings kept, restored when on)
   rather than cancelling. If management asks for a permanent stop, retire the courts (which cancels with a
   reason) before switching off.
10. **Who manages courts.** *Recommend* community admins (already allowed), with the optional `bookings` admin
    code available for a "courts captain" later. Nothing to build for that beyond R4b-1's `canEnter()`.

## Decisions (Zee, 2026-11-08)

1. **Limits:** agreed: 7-day window, 60-minute default (30 to 120), 1 booking per home per day, at most 2 upcoming per home.
2. **Fees:** none, so there is no `fee_note`. **Courts to start with:** admins create a couple of **test courts**.
   Organizer Tools must be able to create and edit courts (already R4b scope).
3. **Walk-on:** a per-court option when a court is created in Organizer Tools. Add `walk_on` in R4a.
4. **Fees:** none.
5. **Block reasons:** preset reasons, and **residents see the reason** on a blocked slot, not just
   "Unavailable". Admin reasons are therefore resident-facing text: they are cleaned (`jc_clean_line`, length
   cap), and the admin screen shows a note that residents will read the reason.
6. **Cancel cutoff:** none.
7. **Visibility (CHANGED from the recommendation):** a booking shows the **booking home's label** to other
   residents **by default**. The household can tick **"Private booking"** when booking, and others then see
   only "Booked". **Never a person's name**: S3's `display_name` is still removed. The server enforces it
   (other people's rows return the home label only when `is_private = false`), so the client can't leak it.
   **This amends the zero-PII promise**, which has to be disclosed rather than silently changed:
   - the booking screen states it ("Other residents will see your home on this booking unless you tick
     Private");
   - the privacy promise text is updated in the same PR (R4c);
   - the R4a migration header records the change.

   **Trade-off accepted:** visible by default, together with Q8's retention, lets any resident see which homes
   play when.
8. **Retention (CHANGED from 30 days):** delete individual booking rows (and removed blocks) **90 days** after
   the slot. Keep per-court, per-hour counts **indefinitely** (no home id) for pattern analysis.
9. **Kill switch:** agreed: switching off hides and freezes bookings, and switching on restores them.
10. **Who manages courts (WIDENED):** community admins, plus **assignable per-module admins** (Courts now, Pets
    in R5), alongside per-event admins. It must be a general module-admin model, not a one-off `bookings` code.
    It is an auth change, so it gets a full security and database review. Its scope is to be settled in R4a's
    build plan (it may become its own PR before R4b).

## Secondary findings (surfaced, not acted on)

- **Manifest drift:** authenticated functions 85 live vs 82 in the manifest (R2b-1 closeout).
- **Dead after R4a:** `jc_admin_booking_name_clear` and the `display_name` column. Leave for the R7 grant
  audit, which has the proof steps (grep, `git log -S`, grants).
- **`jc_home_vacated` has been re-created by four migrations** (S4, T5.2a, R2a, R2b-1) and maybe R2b-2. Each
  re-copy risks dropping another phase's lines. R4 avoids it. R7's structural audit should consider splitting
  it into per-module hooks.
- **Hub copy** ("events, bookings and pets") and the "Book a Court" CTA exist and link to `bookings/`. They're
  harmless while the flag is off; R4c makes the target real.

---

**What this change does:** Lets residents book Jubail's tennis and basketball courts by household, a few
days ahead, with fair-use limits. Community admins add the courts, set their hours, and close slots for
maintenance or official bookings. A single switch can turn it all off. Most of the machinery already exists
and only needs its screens and a few rule fixes.
**Biggest risk:** One household holding the best court slots all week, or a booking landing at the wrong
time for someone whose phone is set to another country. Both are addressed in the plan; watch the first
weeks of real bookings for squatting.
**Recommended next step:** Answer the open questions (especially the four limits in Q1, and whether any court
is walk-on or charges a fee), then approve building the database step once the R2b-2 build has merged.
