# R4d: My Bookings: past bookings (plan, 2026-11-09)

**Source:** Zee, 2026-11-09: "just like we show old events, should we show old historical bookings of mine in the My
Bookings page?" Answer: yes. Zee: "plan now".

## Step 0: scope

**Tier: data / auth / PII → full rigor.**
- It needs a new server function, a migration on JubailCommons, and a resident screen.
- It shows a home's history, so who may see which rows is the whole risk.
- Required: `/db-rehearse` (dry run twice, rolled back), plus **database-reviewer + security-reviewer + code-reviewer**,
  each saved in `docs/qa/`.

**Manifest:** LAST VERIFIED 2026-11-08 (fresh). The [live] layer was re-queried read-only today; findings below.

## Step 1: inventory (live, read 2026-11-09)

| Layer | Finding |
|---|---|
| `jc_my_bookings()` | Returns upcoming only (`ends_at > now()`): booked, plus organizer-cancelled with a reason from the last 7 days **and since this member joined** (`jc_home_members.joined_at`). No past rows today |
| `jc_bookings` | `id, community_id, facility_id, home_id, booked_by, starts_at, ends_at, display_name, status, cancel_reason, cancelled_by, cancelled_at, created_at, is_private` |
| **Retention** | Cron `jc-courts-purge` runs daily at 03:45 UTC. `jc_courts_retention()` rolls ended bookings into hourly counts (`jc_court_hours`, no homes) and then **deletes each booking 90 days after its slot**. **History can never reach further back than 90 days** |
| Client | `commons/bookings/`: the My Bookings tab (`mineHtml`, `drawMine`, `setMine`) |
| Tests | `tests/sql/s3_courts.test.sql` (the my-bookings checks); `tests/e2e/specs/courts.spec.js` |
| Not touched | `jc_my_bookings` (no change to its signature or body); admin screens; retention job; other modules |

## Step 2: the change

1. **New server function `jc_my_bookings_past()`.** It takes no arguments, is read-only, and is callable by
   authenticated users only.
   - **Scope.** The caller's own home. Ended slots only (`ends_at <= now()`, so it never overlaps the upcoming list).
   - **Window.** Only bookings **made after this member joined the home** (`created_at`, per security review M1) and
     within the last 90 days.
     - **The joined-date rule is the privacy core.** When a home changes hands, or a new household member joins,
       they must not see earlier occupants' bookings.
   - **What it returns.** Booked rows that ended ("Done") and organizer-cancelled rows with their reason.
     - Bookings the home cancelled itself are left out (Q1).
     - **Never** `booked_by`, `display_name`, `cancelled_by`: no names or people.
   - **Order and size.** Newest first, at most 100 rows. The rules allow at most 1 a day, so 90 days is about 90 rows.
   - **Checks.** It checks the module flag like every bookings function (`jc_module_on`) and returns `[]` without a
     home.
2. **Client.** The My Bookings tab gets a **Past** section under Upcoming.
   - **Loading.** It is read when the tab opens, in its own request, so a failure there never hides upcoming bookings.
   - **Each row.** The court, the day and time (community time), and a chip: "Done", or "Cancelled by the
     organizers: <reason>".
   - **Look.** The faded "Over" look from the slot colours.
   - **Copy.**
     - A line saying "Bookings are kept for 90 days."
     - The empty state: "No past bookings yet."
   - EN + AR.

**Size:** about 50 lines of migration, 60 SQL test, 70 client and 60 e2e.

**Split into 2 PRs** (data migration rule):
- **(a)** Migration + SQL tests → rehearse → reviews → **apply only on Zee's "apply"**.
- **(b)** Client + e2e, after (a) is live.

## Step 3: regression surface

- **Upcoming My Bookings** stays as is: the same function, unchanged, with the same 7-day organizer-cancel rule.
- **The retention job and hourly counts** are untouched. The new function only reads.
- **Courts off** (Jubail today): the new function refuses with `MODULE_OFF`, and the client never calls it (the kill
  switch path).
- **Function grants:** authenticated goes from 92 to 93 functions; anon stays at 3.

## Step 4: premortem

| # | Mode | Mitigation |
|---|---|---|
| 1 | **A home's new occupant sees the previous occupant's bookings** | `created_at >= joined_at` (security review M1: by slot start, a pre-sale booking for a later slot leaked). SQL tests: a later member, a pre-sale slot, and a real leave → claim |
| 2 | Another home's bookings leak | `where home_id = <caller's home>` from `jc_me()`, never a parameter. SQL test |
| 2b | Grants drift (anon can call it) | Revoke from public/anon and grant authenticated, in the migration. The suite's grant checks (anon = 3) |
| 3 | Cost | None (no paid layer) |
| 4 | Silent failure | Its own request: an error shows in Past only, Upcoming unaffected |
| 5 | Wrong day (phone in another zone) | Shared `cfg.tz` helpers; e2e in London time |
| 6 | Rows vanish at 90 days and confuse | The "kept for 90 days" line. The purge is hour-aligned and only touches rows older than 90 days, which are outside the window anyway |
| 7 | Slow | At most 100 rows on one home; the index `(home_id, starts_at)` exists (verified live) |
| 8 | A retired or deleted court | Retired courts keep their row, so the name still shows. A court can't be hard-deleted while it has bookings (the foreign key has no ON DELETE; verified live), so the inner join is safe |

## Questions for Zee

1. **Bookings you cancelled yourself:** leave them out of Past? **Recommend leaving them out.** They're noise, and
   Past means the times you had the court.
2. **How far back:** the full 90 days (the most the server keeps)? **Recommend yes.**
3. **Where:** a **Past** section under Upcoming in the My Bookings tab? **Recommend yes.** It is how Events puts past
   events at the bottom.
4. **The word for an ended booking:** "Done". We can't know whether they actually played, so not "Played".

## What this change does (plain English)

**What this change does:** My Bookings gets a Past section listing the last 90 days of your home's court bookings,
including ones the organizers cancelled and why.

**Biggest risk:** someone seeing bookings that aren't theirs, for example a new household member, or a new owner after
a sale, seeing the previous people's history. Each person sees only bookings made after they joined the home, and this
is tested.

**Recommended next step:** answer the 4 questions above (or "agree"), then I build PR (a) and stop before applying it
to the live database.
