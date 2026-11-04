# T5.2 PR A — per-event admins (migration `t5_2b_event_admins`) — review (2026-11-04)

**Scope:** `supabase/commons/migrations/20261105070000_t5_2b_event_admins.sql` + `tests/sql/s9_event_admins.test.sql`
+ `00_grants` allowlist. Plan: `docs/plans/T5-2-per-event-admins-plan.md` (PR #32), decisions D1–D4.
**Reviewers:** `database-reviewer` (verdict before fixes: *do not apply — fix H1*) · `security-reviewer`
(no critical / high). Both static, against commit 4b72e3c.
**Dry run:** 497 → **510 checks** after fixes, rolled back; nothing persisted (tables, column, functions,
test communities / users all absent afterwards). The H1 test was proven to **fail on the unfixed
code** (`FAIL Q08x`) before passing on the fix.

## Findings and dispositions

| # | Reviewer | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | database | **High** | Organizer path used read-only `jc_admin_has` → community admins / legacy `events` holders using only event screens would stop sliding their 60-day unlock and silently lapse | **Fixed** — `jc_events_organizer()` slides `last_used_at` exactly as `jc_assert_admin` does; test Q08x (fails on the old code) |
| 2 | security | Med | Event admin could overwrite / clear the community-wide banner (incl. an organizer's notice); theirs outlived the event | **Fixed** — `jc_communities.broadcast_event`: an event admin's banner is tied to their live event and **cleared when it closes**; they get `BANNER_IN_USE` over an organizer's banner (set or clear). Tests Q05q4–q6, Q06a1, Q07h (draft-only admin refused) |
| 3 | database | Med | Link-cap race (count then insert) | **Fixed** — `link_create` locks the event row (`for update`), which also orders it against close |
| 4 | database | Med | `accept` vs `close` race | **Fixed** — event row read `for share` |
| 5 | database | Med | Set-null user refs (`granted_by`, `created_by`, `used_by`) unindexed → account deletion scans | **Fixed** — partial indexes (S4 convention); Q09d deletes the granting admin and checks the rows stay with null refs |
| 6 | both | Med | Event admins see participants' home coordinates / house labels / answers (`jc_admin_entries_list`), incl. the 5-day read window | **Accepted (by design, D2)** — the map and pin fixes need coordinates; organizers see the same today. **PR B:** the accept screen states what the role can see (per-feature disclosure). Note: repo CLAUDE.md still says zero-PII though Zee dropped that promise 2026-11-02 — fix in a docs PR, never silently |
| 7 | security | Low | Event admin can close (irreversible) and change features / safety | **Accepted** — D2, Zee confirmed |
| 8 | security | Low | Event titles / descriptions not passed through `jc_clean_text`; writer pool widens | **Deferred** — every screen renders them through `esc()` (security review PR #31 confirmed); server-side cleaning of event text for all writers is a separate change |
| 9 | security | Low | Forwarded link is claimed by whoever accepts first | **Accepted** — admin list shows the holder, revoke is immediate. PR B may show the event title before confirming |
| 10 | database | Low | Event admin may move the pin of a home signed up to a *draft* event of theirs | **Accepted** — matches plan (pin hygiene); 10 km bound + logged with Undo data |
| 11 | database | — | Test gaps: slide check; day-4 refusal for moderate / entry pin / home pin; event admin can't make / list / revoke; draft-only admin's banner; granting admin's deletion | **Fixed** — all added (Q08x, Q06i1–i3, Q05q1–q3, Q07h, Q09d) |
| 12 | database | — | Concurrency (3, 4) not testable in one rolled-back transaction | **Accepted** — joins the T6 two-tab concurrency checklist (manifest KG 11) |

## Verified by the reviewers (no change)

Every path is scoped by event id **and** the caller's community; entry-based functions derive the event
from the entry inside the caller's community; non-admins get `NOT_ADMIN` for real and made-up ids alike
(no existence oracle); tokens 144-bit, only sha256 stored, single use under `for update`; revoke is
immediate (no cached grant); new helpers not callable by the app; new RPCs `authenticated` only.
