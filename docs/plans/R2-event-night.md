# R2 — Events audit fixes (R2a) + event-night extras (R2b) — plan (`/plan-change`, 2026-11-06)

> Sources: `docs/plans/ROADMAP.md` R2, `docs/qa/events-qa-2026-11-06.md`. Built **after R1 merges** (R1 also
> edits `admin.js` / `strings.js`). Live function bodies read from JubailCommons (`qrpxfssdeeuzmsmlbtbu`) on
> 2026-11-06, read-only. Manifest LAST VERIFIED 2026-11-06.

## Step 0 — Scope

**Cross-layer** — new scheduled job, function bodies, one column, additive JSON keys, client. Full protocol.

## Ships as three PRs (Step 4 split rule: data + cron + client)

| PR | What | DB |
|---|---|---|
| **R2a** | All eight audit findings | 1 migration: function bodies + 1 column + 1 cron job |
| **R2b-1** | Organizer acts → household told: mark a home out, withdraw a no-show, "adjusted by an organizer" | 1 migration: 2 new RPCs + 1 column |
| **R2b-2** | Safety block, holiday lights look + template, `jc_clean_text` on event title / description | 1 migration: look CHECK + save body |

R2b-1 / R2b-2 get their own Step 1–5 pass when R2a merges (they touch the functions R2a rewrites). Their
design notes are at the end so nothing is lost.

## Step 1 — Inventory (R2a)

| Layer | Touched? | Check |
|---|---|---|
| DB functions | `jc_home_vacated`, `jc_event_signup` (body only), `jc_entry_withdraw`, `jc_event_close` (body moves to a core fn), `jc_events_list`, `jc_event_get`, `jc_admin_event_publish`, `jc_admin_event_save`, `jc_admin_broadcast_set`, `jc_event_admin_revoke`; new `jc_private.event_close_core`, `jc_private.events_autoclose` | `pg_get_functiondef` on each, 2026-11-06 |
| DB schema | `jc_communities.broadcast_by uuid` (new, nullable); `jc_notice` kind for "event ended" (CHECK if one exists — verify at build) | `information_schema.columns`; `jc_admin_log.actor` already nullable |
| Cron | new `jc-event-autoclose`, hourly | `cron.job` lists 5 jobs, none on event lifecycle |
| Edge functions | Not touched | `jc-photo-purge` is the only one invoked by cron; no event code |
| Client | `events/events.js` (Past list, ended page, My Sign-Up line), `admin/admin.js` (templates, publish check, banner tie, notice, events list), `assets/strings.js` | grep `TEMPLATES`, `missingForPublish`, `eventDay`, `jc_admin_broadcast_set` |
| Tests | `tests/sql/` new slice `s14_events_audit.test.sql`; e2e `events.spec.js`, `admin.spec.js`, `admin-health.spec.js` | `ls tests/sql tests/e2e/specs` |
| Hosting / Auth / Resend | Not touched | no `_headers`, auth or email change in scope |
| SignalPost | Not touched | `jc_` only; Commons project ref in migration header |

## Step 2 — Impact map (R2a)

**D1 + L1 — vacating a home clears its moderation.** `jc_home_vacated` gains one update: the home's entries in
**live** events, `archived_at is null`, **any status**, get `hidden = false, spot = null`. Any status matters:
a family that withdrew while hidden would otherwise hand the flag to the next family on re-join. Archived
entries keep `hidden` (history). Same-household withdraw + re-join is unchanged (stays hidden).
Callers of `jc_home_vacated`: leave home, `jc_admin_member_remove` (R1's new button), account delete.
Assumption: no caller relies on `hidden` surviving vacate. Verify: grep the migrations for `hidden`.

**D2 — an event ends on its own.** One server rule, `ended = starts_at is not null and
coalesce(ends_at, starts_at + 6 h) < now()` — the 6 h matches the client's `NO_END_MS`, so event day and
"ended" agree. It is computed, never stored: if an organizer moves the end time later, sign-ups reopen.
- `jc_event_signup` (body only, signature untouched): ended → `SIGNUPS_CLOSED`.
- `jc_entry_withdraw`: ended → `SIGNUPS_CLOSED`, so the night's numbers don't erode the morning after.
- `jc_events_list` / `jc_event_get` add `ended` and `ends_effective`. Additive keys; cached clients ignore them.
- Client: Past = archived **or** ended. An ended live event shows "This event has ended", with no sign-up or
  withdraw. `eventDay()` uses `ends_effective` when the server sends it. That removes the duplicated 6 h
  (drift surface).
- **Auto-close:** `jc_event_close`'s body moves into `jc_private.event_close_core(event)`. The public function
  keeps its signature and checks (admin, `FOR UPDATE`, live, slug confirm) and calls the core. The cron job
  `jc-event-autoclose` (hourly) runs `jc_private.events_autoclose()`: every live event whose
  `ends_effective + 24 h < now()` is closed by the same core, with admin log `event_autoclose` (actor null).
  Each event closes in its own `begin … exception` block, so one failure doesn't stop the rest. A failure
  writes a `jc_notice`. The job is condition-based, not time-of-day: after a free-tier pause it catches up.
- **Grace notice:** the first run after an event ends writes one App Health notice to organizers:
  "⟨event⟩ ended — it closes automatically at ⟨time⟩. Wrong date? Change the end time." (deduped per event).
- Consumers of close: Organizer Tools close button, stats view, `jc_event_stats_get`, the hourly snapshot
  (counts entries; unaffected), banner clear. All go through the one core, so behaviour can't fork.

**F1 — templates.** `TEMPLATES` Halloween + Haq al Laila → `{ giant_switch, supply, crowd_reports }: true`;
the "Use the Halloween questions" button ticks all three. Client only.

**F2 — a homes event needs a date.** Client `missingForPublish` adds start date for homes events. Server mirrors
the `NO_VENUE` pattern: `jc_admin_event_publish` raises `NO_DATE`; `jc_admin_event_save` refuses to clear
`starts_at` on a live, not-coming-soon homes event. Live data: every homes event has a date, so nothing
existing breaks.

**U1 — the household is told.** `jc_event_get.mine` adds `home_hidden` (own home's `directory_suppressed`;
`hidden` is already returned). My Sign-Up shows "Your home isn't shown on the map" when either is true.
No reason is given: the organizer's note, if any, already shows.

**U3 — banners go with their reason.**
- New `jc_communities.broadcast_by`. `jc_admin_broadcast_set` records the poster (body only).
- `jc_event_admin_revoke` clears the banner if `broadcast_event = event and broadcast_by = revoked user`.
- An organizer can tie their banner to an event ("Remove when ⟨event⟩ closes") through a **new** RPC,
  `jc_admin_broadcast_set_event(p_text, p_event)`, so the existing one's signature is untouched. Close (manual
  or automatic) already clears `broadcast_event = event`.

## Step 3 — Regression surface

1. Manual close from Organizer Tools: same snapshot, same archive, clears the event admin's banner, and is
   irreversible behind the slug confirm.
2. Sign-up, update and withdraw **before** the end: unchanged, including capacity `FULL`, `NO_PIN` and
   re-join resets.
3. Event day (switch, supply, reports, 2-min refresh) runs from start − 2 h to the effective end, as today.
4. Coming soon: still shows "coming soon" until its date passes.
5. Hide / Undo, organizer note, pin moves, spot, CSV: unchanged for current households.
6. Venue events: sign-up and capacity unchanged; they end and auto-close by the same rule.
7. Undated events: never "ended", never auto-closed.
8. Stats view of archived events and the events list "came" count.
9. Hourly snapshot, feedback jobs, orphan purge: unaffected (separate jobs).
10. R1 member remove → vacate: works, and now also clears hidden / spot.

## Step 4 — Proposal

**Cost:** none. One hourly job on the free tier; no paid layer.
**Diff budget:** R2a is about 450 LOC (migration about 220, mostly unchanged bodies re-created; client about
120; tests about 110), over the 200 soft cap. Splitting further would ship a server that says "ended" before
the screen can show it, so R2a stays one PR. It is reviewable because each function diff is small.
**Migration:** yes, via `/db-rehearse` (dry-run the full suite, apply only on Zee's "apply").
**Deploy order:** either order is safe. The new keys are additive, and an old client against the new server
gets `SIGNUPS_CLOSED` after an end (an existing message).
**On apply:** `e2e/halloween-test` (ended 2026-11-06 06:50 UTC) auto-closes on the first hourly run after
2026-11-07 06:50 UTC. That is the live proof the job fires. Other live e2e events end 4 Dec, 1 Dec and
3 Feb. No Jubail event is live.

## Step 5 — Premortem (R2a)

| Mode | Exposed | Mitigation |
|---|---|---|
| 1 Silent corruption | Vacate clears the wrong rows; core refactor changes the snapshot | Vacate scoped to `home_id` + live + not archived. Existing close tests rerun against the core, plus a test that auto-close and manual close give identical stats. |
| 2 Silent zero-output | Job never fires (pause, cron off) or dies on one event | Condition-based catch-up; per-event exception → `jc_notice`. Post-deploy: `cron.job_run_details` succeeded **and** `halloween-test` archived with a `jc_event_stats` row. |
| 2b Config drift | The 6 h no-end rule exists in client + SQL | Client reads `ends_effective` from the server; SQL test pins the 6 h. |
| 3 Cost | Hourly job | Negligible: one indexed scan of `jc_events`. |
| 4 Contract | JSON shape | Additive keys only. `jc_event_signup`, `jc_entry_live_set`, `jc_event_close` and `jc_admin_broadcast_set` signatures unchanged; the grants test asserts it. |
| 5 Race | Cron close vs manual close; sign-up at the end second | Core takes `FOR UPDATE` and re-checks `live` (the loser skips / `BAD_STATE`); sign-up's `FOR SHARE` + ended check. |
| 6 Auth | New private functions reachable? | `jc_private` schema, no grants to anon / authenticated; grants test. New banner RPC = organizer only (`jc_assert_admin`). |
| 7 Rollback | **Close is irreversible; a wrong date closes a real event** | 24 h grace, visible "ended" state, an App Health notice with the close time, and editing the end time reopens. Kill switch: `select cron.unschedule('jc-event-autoclose')`. |

## Step 8 — Verification (R2a, when built)

- **SQL slice tests** (each fails on today's live code):
  - **D1:** hide, then vacate, then a new household re-joins → `hidden` is false.
  - **D1:** a withdrawn-while-hidden entry, then vacate → `hidden` is false.
  - **D1:** the same household withdraws and re-joins → it stays hidden.
  - **L1:** `spot` is null after vacate.
  - **D2:** after the end, sign-up and withdraw both raise `SIGNUPS_CLOSED`.
  - **D2:** auto-close closes only overdue events, skipping undated ones and drafts.
  - **D2:** auto-close writes `jc_event_stats` and is idempotent.
  - **D2:** a manual close after an auto-close raises `BAD_STATE`.
  - **D2:** one failing event doesn't block the others.
  - **F2:** `NO_DATE` on publish, and on clearing the date of a live event.
  - **U3:** revoke clears only the revoked admin's banner.
  - **U3:** a tied organizer banner clears on close.
- **e2e:**
  - Templates tick three features.
  - Publish asks for a date.
  - An ended event sits in Past with no sign-up.
  - A hidden household sees the line.
  - The grace notice renders.
  - The banner tie works.
  - AR + RTL.
- **Post-deploy firing:** after 2026-11-07 06:50 UTC, confirm a `jc-event-autoclose` run in
  `cron.job_run_details` with `status = 'succeeded'`. Confirm `halloween-test` is `archived`, has a stats row,
  and has an `event_autoclose` admin-log row.

## R2b design notes (planned in full when R2a merges)

- **R2b-1:**
  - `jc_admin_entry_live_set(p_entry, p_state, p_supply)` lets organizers and that event's admins set the
    switch or supply. It applies the same checks as the resident version and is admin-logged.
    `jc_admin_entry_withdraw(p_entry)` frees the place and spot and clears reports.
  - New `jc_event_entries.org_adjusted_at` is set by those two RPCs and by the event-pin move. A home-pin move
    sets it on the home's live entries. It is reset on re-join.
  - My Sign-Up shows "Adjusted by an organizer · ⟨time⟩", never who. A withdrawn household sees
    "An organizer removed your sign-up".
- **R2b-2:**
  - Safety block: security number + meeting point (EN / AR) in `jc_events.safety` behind `features.safety`.
    Verify the `jc_kv_check('safety')` keys and `jc_features_check` at build. It stores nothing about people.
  - `holiday_lights` is added to the `jc_events_look_check` constraint (drop / add on a tiny table), with its
    look and template questions.
  - `jc_clean_text` on title / description in `jc_admin_event_save`; stored rows are left as is.
