# R4b-2: Courts day view for admins (plan, 2026-11-09)

Source: `docs/plans/R4-courts.md` (R4b-2 row, Q5/Q7 decisions), R4a-2 review D9 (block reason cap 185).
Prerequisite: R4b-1b merged (#77, live 2026-11-09 on both origins).

## Step 0: scope

**Tier: screen logic, client only.** No migration, no RPC change, no new grant. It uses four admin RPCs that
are already live (all `jc_assert_admin('bookings')`, so a bookings or community admin; authenticated only).
Manifest LAST VERIFIED 2026-11-08 (fresh). The live bodies were read on 2026-11-09 (below).

## Step 1: inventory

| Layer | Touched? | Check |
|---|---|---|
| DB / RPCs | **Read only.** Uses `jc_admin_facility_day`, `jc_admin_booking_cancel`, `jc_admin_block_create`, `jc_admin_block_remove` | `pg_get_functiondef`, live 2026-11-09 (facts below) |
| Internal `jc_facility_grid` | Not touched | Live body read: with `p_admin`, it returns `booking_id`, `home{id,village,type,building,number}`, `is_private`, `block_id`, `block_reason` |
| `admin/admin.js` | **Yes.** New view `courtday`; a "Day" button on the court rows; history labels | `grep` loadCourts / courtRow / VIEWS (L1380–1500) |
| `assets/strings.js` | **Yes.** `cd_*` keys (EN + AR, AR DRAFT) + 8 `adm_log_*` labels | The history shows "other: block_create" today: `LOG_KEYS` (L983) lacks `facility_save`, `facility_status`, `block_create`, `block_remove`, `booking_cancel`, `module_admin_link/accept/revoke` (grep of every `jc_admin_log_add` action in the migrations) |
| `admin/admin.css` | Small: slot rows, reason chips | — |
| Resident pages | Not touched | No resident courts page until R4c (`ls commons/`) |
| e2e | `backends.js` / `stub.js` day-grid stubs; `admin-courts.spec.js` + ~12 tests | — |
| Halloween / personal pages | Not touched | Paths outside `commons/` unchanged |

### Server facts the screen must respect (live bodies)

1. **The grid's state order** is blocked → mine → booked → past → free. A booked slot stays `booked` after it
   ends, but cancel then answers `NOT_FOUND` (`ends_at > now`). **No Cancel on slots that have ended.** A slot
   being played now can still be cancelled.
2. **Cancel reason:** 3–200 after `jc_clean_line`. It is resident-facing (My bookings in R4c). It returns
   `jc_admin_facilities_list()`, which refreshes the courts list counts.
3. **Block:** reason 3–185 (`maxlength=185`, D9), resident-facing (Q5: residents read it on the slot). The
   range must be ≤ 31 days with `ends > now`; the start may be in the past. It cancels every booking in
   `[max(start, now), end)` with "Court blocked: <reason>" and **returns the count it cancelled**. Not allowed
   on retired courts (`NOT_FOUND`).
4. **Remove block** doesn't bring cancelled bookings back. The copy must say so.
5. The day is a **community-time-zone date** (`p_date date`; the slots come back as ISO instants). So "today"
   and every displayed time use `cfg.tz`, never the phone's zone. Block ranges are taken from the grid's own
   `starts_at` / `ends_at`, so the client does no time-zone arithmetic for writes.

## Step 2: the change

**Courts list:** non-retired, non-walk-on rows get a **"Day view"** button (drafts too, so a block can be set
before publishing).

**Day view screen** (`VIEWS.courtday`):
- Header: the court name. Date bar: **‹ Prev · date · Next ›**, plus a native date input. Range today → +90
  days (Q4). Opens on today in `cfg.tz`.
- One row per slot (a list, not a grid, at phone width): time `HH:MM–HH:MM`, then a state chip:
  - **Free**
  - **Booked**: the home label (`jcHomeLabel` + village) + a **"Private"** chip when `is_private`, with a note
    that residents see only "Booked"
  - **Blocked**: the reason
  - **Past**
- **Cancel booking** (booked, not ended): an inline reason field (3–200, required) → `jc_admin_booking_cancel`
  → "Cancelled. The household will see your reason." → the day reloads.
- **Block time** button → From (slot starts) / To (slot ends) selects + a "Whole day" shortcut. **Preset chips**
  fill the reason: *Maintenance · Community event · Official booking · Other* (Q1). Input `maxlength=185`.
  The note "Residents will see this reason." The confirm names the range and the number of bookings it will
  cancel, counted from the grid on screen. The result notice uses the **server's** count ("Blocked. 2 bookings
  cancelled; those households see your reason."). Only slots that haven't ended can be chosen.
- **Remove block** (on a blocked row; the block's run of slots is grouped and shown once): a confirm says
  "Bookings it cancelled stay cancelled." → `jc_admin_block_remove` → reload.
- Stale screen: `NOT_FOUND` on cancel / remove → reload the day + "That changed in the meantime" (the `ctNote`
  pattern). `NOT_ADMIN` → `fail()`. Busy flag + a `write()`-style wrapper (the R4b-1a M2 lesson). A late answer
  after leaving is dropped, or only updates `ct.list` (the R4b-1b M1 lesson).

**History:** labels for the 8 courts / module-admin actions above.

**Size:** ~250 client + ~130 e2e. One layer. No split needed.

## Step 3: regression surface

- The Courts list: Publish / Unpublish / Retire confirms and counts; the editor's change-only save; `RULES_LOCKED`.
- The Admins screen + invite flow (R4b-1a), the tab row (4 tabs for a community admin, Courts only for a
  bookings admin).
- The Events / Community / Households tabs: untouched.
- Language switch on the new screen keeps the day and an open form (the R4b-1 L1 pattern).
- axe EN + AR on the new screen.

## Step 4: premortem

| # | Mode | Exposure | Mitigation |
|---|---|---|---|
| 1 | Wrong day / wrong time (phone ≠ community tz) | **Central** | "Today" from `Intl` in `cfg.tz`; times formatted with `timeZone: cfg.tz`; block ranges from the grid's instants. e2e runs one spec with `timezoneId: "Europe/London"` and asserts the dates and the times shown |
| 2 | Mass cancel by a fat finger (Whole day on a full day) | Yes | The confirm names the range + the booking count; reason required; the server count is in the result |
| 2b | Out-of-band config | No | No flag / config change; `e2e` already has bookings on |
| 3 | Stale grid (a booking lands after view) | Yes, benign | The server cancels it anyway and the server count is reported; cancel on a gone booking → reload + note |
| 4 | Silent failure | Yes | Every RPC error shows a message; no `.catch` that swallows; the busy flag always resets |
| 5 | Race (block vs booking) | Server-handled | `FOR UPDATE` in `jc_admin_block_create` (S3) |
| 6 | Auth / PII | Low | Home labels are shown only on the admin screen, already gated by the server (`p_admin` only through `jc_admin_facility_day`). No names exist. Escaped like every string. A late answer after the right ends is dropped (`isCourtsAdmin()`) |
| 7 | Resident-facing text quality | Yes | The note "Residents will see this reason"; presets; caps match the server (185 / 200) |

**Reviewer:** code-reviewer (screen logic). It shows home labels, but only what the server already returns to
admins, so no security review per tier. *Raise to security if you'd rather.*

## Questions for Zee: answered 2026-11-09

**Answers:** 1 agreed · **2 CHANGED: multi-day blocks needed** ("fixing a cracked court"): one day, or "closing time on another day" ≤ 30 days later, the end taken from that day's last slot as the server lays it out · 3 agreed · 4 agreed. Plus, mid-build: wherever a start / end pair is picked, a start moves an empty or earlier end to it (block form + event editor).


1. **Reason presets:** *Maintenance · Community event · Official booking · Other* (from Q5's recommendation)?
2. **Block range:** recommend **within one day** (From / To slot, or Whole day). Multi-day closures use one
   block per day, or Unpublish. Alternative: add "until <date>" (server allows ≤ 31 days). +~40 LOC, and the
   confirm count would be unknown for the days not on screen.
3. **Walk-on courts:** recommend **no day view** for now (nothing to book). Whether residents see "closed"
   notices on walk-on courts is an R4c decision.
4. **How far ahead:** today → +90 days (admins pre-block official events beyond the 7-day resident window).
   Past days hidden.

## Step 8: verification (after build)

- e2e (`admin-courts.spec.js`):
  - day view opens on today (London tz);
  - prev / next / limits;
  - each slot state renders, with the home + Private chip;
  - no Cancel on an ended slot;
  - cancel needs a reason and sends the exact args;
  - the block sends the grid's instants + reason;
  - `maxlength` 185;
  - the confirm count, and dismissing sends nothing;
  - the server count shown;
  - remove block confirm;
  - `NOT_FOUND` → reload + note;
  - a late answer dropped;
  - language switch keeps the state;
  - axe EN + AR;
  - hostile reason / home text stays text;
  - history labels.
- Mutation checks on the new guards.
- Manual on `e2e` (no invites needed; Zee is the community admin there):
  1. Make a test court, publish it, open Day view, and block 18:00–20:00 "Maintenance".
  2. Check the slots show Blocked with the reason, then Remove block.
  3. Bookings to cancel need R4c (resident booking), so the cancel path is verified against the real backend
     in R4c's smoke.
