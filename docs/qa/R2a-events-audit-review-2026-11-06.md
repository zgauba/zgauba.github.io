# R2a — Events audit fixes: review (2026-11-06)

> PR: R2a (`feat/r2a-events-audit`). Plan: `docs/plans/R2-event-night.md` (approved by Zee 2026-11-06 with
> four defaults). Source findings: `docs/qa/events-qa-2026-11-06.md`.
> Migration: `supabase/commons/migrations/20261106120000_r2a_events_audit.sql`, **rehearsed, NOT applied**.

## Status of this review

**This is the builder's self-review, not an independent one.** The builder ran as a forked worker, which can't
start reviewer agents. Before "apply" and before "merge", the main session runs `database-reviewer` +
`security-reviewer` on the migration and slice, and `code-reviewer` on the client. Their findings are added below
under "Independent reviews", each with a disposition.

## What was verified

- **Dry run** (whole suite + migration, always rolls back): `ALL_TESTS_PASSED (721 checks)` at the self-review,
  723 after the independent-review fixes (below). Baseline on live
  was 658; the s12 fixture gained 1 check, s14 is 62 new.
- **Fails on today's code:** s14 run alone against the live schema stops at
  `FAIL A01a hide survived the household leaving` (D1). The grants test stops at G02, because
  `jc_admin_broadcast_set_event` doesn't exist yet.
- **Nothing persisted after either dry run.** No `broadcast_by` / `broadcast_org` columns, none of the 4 new
  functions, no `jc-event-autoclose` job, no `testville*` communities, no `*.test` users, no
  event_ended / autoclose_failed notices, no history row. `e2e/halloween-test` is still `live`.
- **e2e, both engines, twice:** 614/614 each run (307 tests × Chromium + WebKit). The new
  `events-audit.spec.js` has 18 tests; 16 of them fail on the pre-R2a client. The other 2 assert that something
  is absent: no "not shown" line on a visible home, and no tie choice for event admins.
- **Older fixtures changed by the new date rule.** s2, s9, s10 and s12 fixtures and the e2e draft fixture now
  carry a start date. The rule is behaviour, so this is not test drift. s12 C08 now also checks `NO_DATE` before
  the date is added.

## Self-review findings

| # | Sev | Where | Finding | Disposition |
|---|---|---|---|---|
| S1 | **Medium** | `jc_admin_broadcast_set` | A banner an organizer tied to an event has `broadcast_event` set. Until now that field meant "an event admin's banner", so the T5.2b check (`broadcast_event is null`) would let that event's admins replace or clear the organizer's banner. | **Fixed:** new `jc_communities.broadcast_org`. Event admins get `BANNER_IN_USE` when the banner is untied **or** organizer-posted. Revoke never clears an organizer banner. Tests A10e2–e4. |
| S2 | Low | `jc_private.event_ends` | Declared `immutable`, but `timestamptz + interval` is only stable. | **Fixed:** `stable`. It's not used in an index. |
| S3 | Low | `jc_private.events_autoclose` | An event more than 24 h past its end got an "ended" notice that was then resolved in the same run (noise rows). | **Fixed:** the notice loop skips events that are already due to close. |
| S4 | Low | `events.js` | Event-day refresh stops at the end, so a page left open never learned `ended` from the server and kept offering Withdraw (the server refuses it). | **Fixed:** `ended()` also compares the server's `ends_effective` with the phone's clock. |
| S5 | Low | `jc_admin_log` | The job's admin-log row: `jc_admin_log_add` takes `auth.uid()`, which in a test session (or any session that calls the function) would name a person. | **Fixed:** the job inserts `actor = NULL` directly. R1's log screen shows NULL as "Automatic". Test A07g. |
| S6 | Low | F2 save rule | Refusing every save of a live, undated homes event would lock older undated events out of editing. | **By design:** only a save that touches `starts_at` or `kind` is checked (A09d). Publish and opening a coming-soon event check the date. |
| S7 | Low | Snapshot timing | An auto-close snapshots 24 h after the end. A household that leaves the island in that window (vacate) drops out of the count. | **Accepted:** residents can't withdraw after the end (default 1). Only leave / remove / account deletion can change the count, and those are rare within a day. |
| S8 | Info | `autoclose_failed.detail.error` | Holds `left(sqlerrm, 200)`, shown to community admins only (escaped). | **Accepted:** admin-only, no resident data in our error texts. |
| S9 | Info | Grace notice audience | App Health (community admins). Events-only organizers see "Ended · closes automatically ⟨time⟩" on the event's row in Organizer Tools. | **Accepted.** |

## Frozen signatures

`jc_event_signup`, `jc_entry_live_set`, `jc_event_close` and `jc_admin_broadcast_set` keep their signatures and
have no overloads. SQL check A11 asserts this.

## Independent reviews

`database-reviewer`, `security-reviewer` and `code-reviewer` ran from the main session (2026-11-06). None
found anything High or Critical. The coordinator combined the findings; dispositions are below.

**After the fixes (commit after `c6be8ee`):**
- Dry run: `ALL_TESTS_PASSED (723 checks)`.
- New SQL check A07r fails on the earlier dedupe logic.
- Nothing persisted: re-checked live after every dry run (no new columns, functions, cron job, fixtures or
  history row; the notices CHECK is unchanged; `halloween-test` is still live).
- e2e: 628/628 twice on Chromium + WebKit (314 tests each). The open-page and venue-line tests fail on the
  previous `events.js`.

### Independent database review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| D-M1 | Medium | The grace notice came back every hour after an organizer dismissed it: dedupe only looked at open rows. | **Fixed.** Insert only when no row for that event is open **and** none was dismissed by a person (`resolved_by` set) for the same `closes_at`. The job's own "end moved later" resolutions (`resolved_by` null) don't count. Test A07r (fails on the old code). |
| D-M2 | Medium | `jc_admin_broadcast_set_event` checked the event without a lock, so a close running at the same moment could leave a tie pointing at an archived event. | **Fixed.** `… status = 'live' FOR SHARE`, then `NOT_FOUND`. A running close (`FOR UPDATE`) finishes first. |
| D-M4 | Medium (design) | A start with no end gives a 6 h window, then closes a day later, and organizers aren't told. | **Fixed in the client** (coordinator's call; Zee can override). Publishing, opening a coming-soon event, or saving a live event to "start, no end" asks: "No end time — sign-ups stop 6 hours after the start and the event closes a day after that." EN + AR. No server requirement. |
| D-L1 | Low | No test proves the job's close and the button's close give the same numbers. | **Fixed.** A07q: two identical events, one closed by `events_autoclose`, one by `jc_event_close`; their `jc_event_stats` snapshots match apart from `taken_at`. |
| D-L2 | Low | A07 counted the job's global return value, so an overdue event in live data (e.g. `halloween-test` after 2026-11-07 06:50 UTC) would break the suite. | **Fixed.** Counts are the test community's `event_autoclose` admin-log rows. |
| D-L3 | Low | Banners posted before the migration have `broadcast_by` null: they survive a revoke and clear at close. | **Accepted.** One-time gap, no backfill. |
| D-L4 | Low | A transient failure writes an `autoclose_failed` notice. | **Accepted.** It clears when the next run succeeds (A07m). |
| D-Info | Info | Plain `create function` (not `or replace`) for the new functions. | **Accepted.** It's a single transactional apply, so a re-run fails loudly instead of silently replacing. |

### Independent security review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S-L1 | Low | G13 checked only `anon` on `jc_private`. | **Fixed.** G13 also fails if `authenticated` can execute any `jc_private` function except the storage-policy checks `pet_photo_can_read` / `pet_photo_can_write`, which need it by design. |
| S-L2 | Low | An event admin can replace another event admin's banner. | **Accepted.** That's T5.2b behaviour; organizer banners are protected (A10e2–e4). |
| S-L3 | Low | A pre-migration banner has `broadcast_by` null, so a revoke doesn't take it down. | **Accepted.** Same one-time gap as D-L3. |
| S-L4 | Low | The `autoclose_failed` notice stored `sqlerrm` text, which can carry values. | **Fixed.** It stores `sqlstate` only (A07e checks `P0001`). |
| S-L5 | Low | An event admin closing their event removes an organizer banner tied to it. | **Accepted (intended).** A tied banner exists to come down with its event. |
| S-Info | Info | A failure inserting the failure notice would abort the whole job run. | **Fixed.** The notice insert has its own nested `begin … exception`, which raises a warning only. |

### Independent code review (client)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C-M1 | Medium | `tick()` redrew only when the event-day window changed. Venue events and homes events whose day window had already closed kept Sign Up / Withdraw on a page left open past the end. | **Fixed.** `tick()` also redraws when `ended()` flips (`endedShown`, set in `paintDay`). |
| C-M2 | Medium | No test for a page open across the end, nor for an older server's payload. | **Fixed.** (a) `page.clock`: an open page crosses `ends_effective`, and Withdraw goes away for homes **and** venue events (fails on the old `events.js`). (b) The pre-R2a payload with no `ended` / `ends_effective`: event day runs and nothing reads NaN. |
| C-L1 | Low | "Your home isn't shown on the map" could show on a one-place event, which has no home pins. | **Fixed.** Homes events only, with a test. |
| C-L2 | Low | The client derived the close time as `ends_effective + 864e5`, a second copy of the server rule. | **Fixed.** `jc_admin_events_list` returns `closes_at`; the client uses it and keeps the old calculation only for an older server. Test included. |
| C-L3 | Low | Saving a draft without a date gives no warning. | **Accepted (intended).** The date is required at Publish / Open (F2). |
