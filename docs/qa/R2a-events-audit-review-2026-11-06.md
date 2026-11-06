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

- **Dry run** (whole suite + migration, always rolls back): `ALL_TESTS_PASSED (721 checks)`. Baseline on live
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

_(to be appended by the main session: database-reviewer, security-reviewer, code-reviewer, each finding with
its disposition)_
