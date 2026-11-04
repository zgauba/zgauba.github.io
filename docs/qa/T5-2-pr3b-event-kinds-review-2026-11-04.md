# T5.2 PR 3b — event kinds, looks, venue, capacity, spots — review (2026-11-04)

**Scope:** `supabase/commons/migrations/20261105080000_t5_2_3b_event_kinds.sql` (JubailCommons);
tests `tests/sql/s10_event_kinds.test.sql` (new, 54 checks) + `00_grants` allowlist
(`jc_admin_entry_spot_set`). No client changes; screens come in 2c / 4 / 4b.
**Decisions (Zee, 2026-11-04):** on a one-place event residents see **how many** households are
coming, never **which**; capacity counts **households**.
**Reviewers:** `database-reviewer` (no high; 2 med) · `security-reviewer` (no critical / high; 2 med).
**Dry run:** 510 → **564 checks**, rolled back; nothing persisted (columns, function, index,
fixtures, history row all absent afterwards). **Mutation-checked**: the venue entries rule, capacity
`>=`, the stats privacy rule, the post-save 10 km check and `CAPACITY_BELOW` each turn the suite red
when removed. The stats test first passed on the broken code (its only signed-up home was hidden)
— fixed so it can fail.
**Caught by the tests before review:** a one-coordinate venue pin passed the CHECK (NULL in a CHECK
passes) — constraint now says `is not null` explicitly.

## Findings and dispositions

| # | Reviewer | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | security | Med | `jc_event_snapshot` → `by_village` / `by_type` reachable by residents (`jc_event_stats_get` live, `stats` after close): a 2-home village names the household on a venue event | **Fixed** — venue events report totals only (both paths); R10a–c, mutation-checked |
| 2 | database + security | Med | A live venue event could lose its name / pin (save had no `NO_VENUE`), or a live homes event switch to a place-less venue | **Fixed** — rules run on the saved row: live + venue needs name + pin (`NO_VENUE`); R03d/e/g/h |
| 3 | database + security | Med / Low | 10 km rule only ran when both coordinates were sent — one-coordinate edits walked the venue anywhere | **Fixed** — checked on the saved row; R03f, mutation-checked. Also moves the float casts inside the error mapping (no raw 22003) |
| 4 | security | Med | An event admin could set capacity below the sign-ups (blocks sign-ups, "release" places to friends); log had field names only | **Fixed** — `CAPACITY_BELOW` (it removes nobody; "pause sign-ups" stops new ones); save log records old kind / capacity / spots / venue + spots cleared; R05e, R09d |
| 5 | database + security | Low | Spot uniqueness case- / format-sensitive ("a1", "A1", zero-width twins) | **Fixed** — stored uppercase, `^[A-Z0-9][A-Z0-9 -]{0,11}$` (column CHECK + `BAD_SPOT`); R08e–e3 |
| 6 | database + security | Low | Same-household double submit at the last place → false `FULL` (exists check before the lock) | **Fixed** — both checks after the advisory lock |
| 7 | database | Low | Venue fields on a homes event silently dropped | **Fixed** — `BAD_FIELDS` (null / false / "" still allowed so an editor can send blanks); R01b/c |
| 8 | database | Low | Publish not row-locked | **Fixed** — `FOR UPDATE` first |
| 9 | database + security | Low | No organizer way to free a no-show's place | **Deferred → PR 4** (organizer tab: remove a sign-up) |
| 10 | database + security | Low | `homes_in` (list) excludes hidden; `households_in` / `full` include them → differ by the moderated count | **Accepted** — reveals how many were moderated, never which home; capacity must count hidden holders |
| 11 | database | Low | `KIND_LOCKED` also counts withdrawn sign-ups | **Accepted, intended** — that household signed up to the old meaning (commented) |
| 12 | security | Info | Organizer-written text (venue names, spots) reaches every resident | **Carried to 2c / 4b** — render through `esc()` like every other field (client convention) |
| 13 | database | Info | Real two-session concurrency can't run in the rolled-back harness | **Accepted** — reasoned sound by both reviewers (READ COMMITTED + per-event `pg_advisory_xact_lock`); spot-check by hand before the first capacity event |

**Confirmed safe:** existing homes events behave exactly as before (kind defaults `homes`, capacity
null ⇒ no lock, same entries list); lock order has no cycle (sign-up / withdraw / spot: event share →
entry; save / close: event update); the new RPC is `authenticated`-only and community-scoped
(cross-community → `NOT_FOUND` / `NOT_ADMIN`); every refusal is a fixed code.
