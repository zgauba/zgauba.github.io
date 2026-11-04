# T5.2 — Organizer screens + event day (six PRs)

> Status: **APPROVED 2026-11-04** (Zee). Protocol: End-to-End Thinking (cross-layer).
> Builds on `docs/plans/T5-events.md` (T5.2 scope + Zee's 2026-11-04 test feedback) and
> the T5.1 review `docs/qa/T5-1-review-2026-11-04.md`.

## Inventory (verified 2026-11-04 against the live DB)

- **Already in the database (screens missing):** `jc_admin_unlock/exit`, `jc_admin_events_list`,
  `jc_admin_event_save/publish/signups`, `jc_event_close`, `jc_admin_entries_list`,
  `jc_admin_entry_moderate` (hide + organizer note), `jc_admin_code_rotate`, `jc_admin_report`;
  event day `jc_entry_live_set` (giant switch / supply, each behind an event feature flag),
  `jc_entry_report`, `jc_entry_reports_clear`. `jc_me_get` returns `admin_scopes`.
- **No migration needed:** `jc_schema_check` ignores extra keys in a field spec, so friendly
  wording (`label_en`, `labels_en`) and pin encoding hints live in `payload_schema`.
  `theme` is hex colours only (`jc_kv_check`).
- **Missing (PR 3 migration):** organizer sets the broadcast (column `jc_communities.broadcast`
  exists and `jc_config_get` returns it; no setter); organizer moves a pin; server-side pin check
  on sign-up.

## Decisions (Zee, 2026-11-04)

| # | Decision |
|---|---|
| Q1 | **CSV export: yes** — built on the organizer's phone from `jc_admin_entries_list`; nothing new stored. |
| Q2 | **Event organizers** (events scope, or community) may move a home's pin and post the broadcast — pin hygiene. The move asks: **this home's pin (everywhere)** or **just for this event** (e.g. backyard vs front). Event-only pins are organizer-set for now; households ask the organizer. |
| Q3 | Order below; organizer screens second so Zee can try event setup early. |
| Q4 | **No pin → redirect, never refuse.** Sign up without a pin goes to the pin screen and comes straight back to the form. The server check (PR 3) is a safety net the screen turns into the same redirect. |
| Q5 | **Reviews are saved in the repo, enforced:** a CI check fails app/DB PRs that add no `docs/qa/` review file (KG13 missed twice). |

## PRs (each ships alone)

| # | PR | Migration |
|---|---|---|
| 1 | **Event screen tidy-up** — tabs inside an event (Map · List · My home); no map beside sign-up; home pin required (no "Skip"; no-pin → pin screen → back); footer "your neighbor in Jubail Island"; T5.1 review Lows; Actions pinned to SHAs; review-file CI check | No |
| 2 | **Organizer: set up events** — `commons/admin/`: unlock / exit, events list, create / edit / publish (questions + friendly wording), sign-ups open/closed, close event (type the slug), rotate codes | No |
| 3 | **Database additions** — `jc_admin_broadcast_set`; organizer pin move (home or event-only — new nullable event pin on `jc_event_entries`, cleared when the home is vacated); `jc_event_get` / `jc_admin_entries_list` return the effective pin; `jc_event_signup` body raises `NO_PIN` (signature unchanged). Grants allowlist + slice tests + dry run; database + security review before apply | **Yes** |
| 4 | **Organizer tab inside an event** — sign-ups by village, note, hide/restore, move pin (two choices), CSV; broadcast banner on every page | No (uses 3) |
| 5 | **Event day + Halloween pins** — giant switch, supply, crowd reports + "we're not out", pins (fill = availability, ring = entrance, glyph = treats, ❓ = reported), legend, refresh every 60 s while visible + live, theme colours; **measure `jc_event_get` size** | No |
| 6 | **Reports panel** — `jc_admin_report` | No |

## Premortem (§0.5)

| # | Exposure | Mitigation |
|---|---|---|
| 1 | Organizer moves the wrong home's pin; concurrent event edits overwrite | Confirm shows the home label; admin log keeps old coordinates (reversible); editor sends only changed fields; schema locks once entries exist (server) |
| 2 | Broadcast set but no banner; NO_PIN shown as an error; BAD_ADMIN read as success | Spec per path; NO_PIN → redirect; `rpc()` already rejects 200+`{error}` |
| 2b | Codes set out-of-band; update.js reloads mid-edit (it ignores toggles/selects) | Codes shown in chat only, never committed; editor marked `data-no-autoreload` while open |
| 3 | Event-night polling egress (~hundreds of MB/h at peak vs free-tier allowance — unverified) | 60 s, visible + live only (Halloween did the same); measure the real response size in PR 5 and slow down if needed |
| 4 | Stub shapes drift from the real RPCs | Extend the real-backend smoke test: organizer unlock + event read in `e2e` |
| 5 | Two writers on one pin / event | Last write wins, both logged — accepted |
| 6 | Events-scope organizers gain pin moves + broadcast | Server-enforced scope; `00_grants` allowlist; NOT_ADMIN + cross-community tests; database + security review on PR 3 |
| 7 | Rollback | Screens: revert. PR 3: drop the new functions/column, restore the old `jc_event_signup` body (down script in the migration header). Module flag = kill switch |

## Regression surface

Sign in / join / reset; claim home, pin screen (Streets fixed in #24), invites, leave, delete;
events list, past stats, Our year, sign up / update / withdraw, organizer note to a home;
map Directions / Google Maps / Find me / Streets-Satellite; auto-update banner; AR + RTL;
Jubail modules stay OFF.
