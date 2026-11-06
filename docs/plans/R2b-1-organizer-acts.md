# R2b-1: organizer acts on a sign-up, and the household is told. Plan (`/plan-change`, 2026-11-06)

> Sources: `docs/plans/ROADMAP.md` R2b, `docs/plans/R2-event-night.md` ("R2b design notes"), and Zee
> 2026-11-06: "if I click Plenty by mistake… clicking it again should clear it". Live bodies were read
> read-only from JubailCommons (`qrpxfssdeeuzmsmlbtbu`) **after R2a** (`20261106120000_r2a_events_audit`).
> **Build order:** after R1.1 (Households "Fix pin") merges. It runs in the same agent stream as the
> event-page polish (Admin button on the title line, full-screen map). That stream edits `events.js`, and
> R1.1 edits `admin.js`. One build agent at a time per hotspot file.

## Step 0: Scope

**Cross-layer, tier 3.** New RPCs, 2 new columns, body changes to protected functions (signatures
unchanged), and client changes on both the resident and organizer screens. Full protocol, `/db-rehearse`,
database + security + code review.

## What ships (one PR, one migration)

| # | Who | What | Server |
|---|---|---|---|
| a | Organizers + that event's admins | Set a home's switch (Handing Out ↔ Out) and supply level, or clear the supply | **new** `jc_admin_entry_live_set(p_entry, p_state, p_supply, p_supply_clear)` |
| b | Organizers + that event's admins | Free a no-show's place: withdraw the sign-up | **new** `jc_admin_entry_withdraw(p_entry)` |
| c | Household | My Sign-Up shows "Adjusted by an organizer · ⟨time⟩", and after (b) "An organizer removed your sign-up". Never who. | **new** columns `org_adjusted_at`, `org_withdrawn_at` on `jc_event_entries`; set by (a), (b), event-pin move, home-pin move |
| d | Household | Tapping the selected supply level again clears it | **new** `jc_entry_supply_clear(p_event)` |

## Step 1: Inventory

| Layer | Touched? | Check |
|---|---|---|
| DB functions, new | `jc_admin_entry_live_set`, `jc_admin_entry_withdraw`, `jc_entry_supply_clear` | n/a |
| DB functions, body only | `jc_entry_live_set` (clears `org_adjusted_at` when the household acts; **signature frozen**) · `jc_event_signup` (re-join resets both new columns; **signature frozen**) · `jc_admin_entry_pin_set` + `jc_admin_home_pin_set` (set `org_adjusted_at`) · `jc_home_vacated` (new family: clear both) · `jc_event_get` (`mine` + 2 keys) · `jc_admin_entries_list` (+2 keys) | `pg_get_functiondef` on each, 2026-11-06 post-R2a. `jc_entry_live_set` today: `coalesce(p_supply, supply_level)`, so null = unchanged and it can't clear. It has no ended check (residents can act in the 24 h grace). `jc_entry_withdraw` raises `SIGNUPS_CLOSED` after `jc_private.event_ends()` |
| DB schema | `jc_event_entries` + `org_adjusted_at timestamptz`, + `org_withdrawn_at timestamptz` (both nullable, no default, so no table rewrite) | `information_schema.columns`: neither exists. `updated_by` exists but is overwritten by every write, so it can't carry "an organizer did it" |
| Auth helper | `jc_assert_event_admin(p_event, p_write)` reused as is (organizer = any event; event admin = own event while not archived) | function body read |
| Logs | `jc_admin_log_add` (admin actions), `jc_log` → `jc_state_log` (state history, actor = `auth.uid()`) | bodies read; `jc_state_log.actor` nullable |
| Stats | `jc_event_snapshot`: no change. It counts `status='in' and not hidden`, so supply only `where supply_level is not null` (a cleared level drops out) and `done` from `live_state` | body read (R2a session) |
| Cron | Not touched | auto-close runs through `jc_private.event_close_core` and reads entries only |
| Edge functions / Resend | Not touched | no event email path |
| Client | `events/events.js` (supply segment toggle ~L555–572, My Sign-Up lines), `admin/admin.js` (Sign-ups row actions ~L1282, `suWrite` ~L1313), `assets/strings.js` EN + AR | grep |
| Tests | new `tests/sql/s15_organizer_acts.test.sql`; `00_grants` allowlist +3; e2e `event-day.spec.js`, `admin-signups.spec.js` | `ls tests/sql tests/e2e/specs` |
| SignalPost / Pages / Cloudflare | Not touched | no `jh_`, `_headers` or deploy config in scope |

## Step 2: Impact map

**(a) `jc_admin_entry_live_set(p_entry uuid, p_state text, p_supply integer, p_supply_clear boolean)`**
- **Auth and lookup:** looks up the entry's event in the caller's community, then
  `jc_assert_event_admin(event, true)`. Same pattern as `jc_admin_entry_pin_set`.
- **Validation:** the same checks as the resident path. The event must be live (`FOR SHARE`).
  `FEATURE_OFF` per feature. State must be `active`/`done`. Supply must be 0–3. `p_supply` together with
  `p_supply_clear` raises `BAD_SUPPLY`. All empty raises `BAD_STATE`. The entry must be `in` and not
  archived (`FOR UPDATE`).
- **Writes:** sets `org_adjusted_at = now()`. `done` clears open reports, as the resident path does.
- **Logging:** `jc_log` for each field (actor = the organizer, in the state log) and
  `jc_admin_log_add('entry_live_set', …)`. It returns `jc_admin_entries_list(event)`.
- **Consumers:** the snapshot counts `done` and supply; the map and List show the state; crowd reports
  hide on `done`. All read the same columns, so nothing forks.
- **Assumption:** organizers set state for **no-show or mistaken** households, not routinely. Logged,
  visible to the household.

**(b) `jc_admin_entry_withdraw(p_entry uuid)`**
- **Same entry, event and auth rule as (a).**
- **Writes:** `status='withdrawn'`, `spot=null`, `org_withdrawn_at=now()`. Clears open reports.
  Payload is kept, as on a self-withdraw.
- **Logging:** state log `status:"withdrawn"`, plus admin log `entry_withdraw`.
- **Capacity:** the place frees itself, because capacity counts `status='in'`. No capacity lock is needed,
  since the count only goes down. A household waiting on `FULL` can then join, before the end only (R2a).
- **Interaction with the ended rule:** see Q1. The recommendation is to allow it until close, so an
  organizer can correct the record in the 24 h grace.
- **Re-join:** the household can sign up again before the end, and the re-join clears
  `org_withdrawn_at`. That's acceptable: it's their sign-up.

**(c) Telling the household**
- **`org_adjusted_at` is set by:**
  - (a);
  - `jc_admin_entry_pin_set` (event-only pin moved or reset);
  - `jc_admin_home_pin_set`, on that home's `in`, non-archived entries in **live** events only.
- **Cross-feature effect:** R1.1's Households "Fix pin" calls the same function, so a pin fixed there
  during a live event tells that household too. That is intended.
- **Cleared by:**
  - the household's own `jc_entry_live_set` / `jc_entry_supply_clear` (they've seen or overridden it);
  - re-join;
  - `jc_home_vacated` (new family).
- **`org_withdrawn_at`:** set by (b), cleared by re-join or vacate.
- **Not set by:** hide (U1's "not shown" line covers it) or organizer note (already shown verbatim).
- **`jc_event_get.mine`:** gains `org_adjusted_at` and `org_withdrawn_at`. Additive keys, so cached clients
  ignore them. **`jc_admin_entries_list`** gains the same two keys.
- **My Sign-Up shows:**
  - `org_withdrawn_at` → "An organizer removed your sign-up." with Sign Up again if still open;
  - otherwise `org_adjusted_at` → "Adjusted by an organizer · ⟨time⟩".
  - It never shows who.

**(d) `jc_entry_supply_clear(p_event uuid)`**
- **Mirrors `jc_entry_live_set`:** module on, `jc_home_hold`, live event `FOR SHARE`, supply feature on,
  own `in` entry. Sets `supply_level = null`, clears `org_adjusted_at`, and writes state log
  `supply_level: null`.
- **Client:** tapping the pressed level calls this; tapping any other level calls `jc_entry_live_set`, as
  today. `aria-pressed` reflects the result.
- **Old client + new server:** the toggle doesn't exist yet, so nothing changes.
- **New client + old server:** `jc_entry_supply_clear` is missing and the tap shows the generic error.
  Mitigation: deploy order (DB first).

**Read paths:** `jc_event_get` (resident), `jc_admin_entries_list` (organizer), CSV export (reads
`jc_admin_entries_list`; gets 2 new columns), snapshot (unchanged).
**Write paths:** listed above. Every write goes through a SECURITY DEFINER RPC. No new table, no RLS change.

## Step 3: Regression surface

1. **Resident switch and supply:** set, change and Done (clears reports) still work.
   `jc_entry_live_set(p_event, p_state, p_supply)` keeps its signature, and null still means unchanged.
2. **Sign-up / re-join:** signature frozen. Re-join still resets live state, supply, report lock, event pin
   and spot, plus the 2 new columns.
3. **Capacity `FULL`** under concurrent sign-ups: the advisory lock is untouched.
4. **Self-withdraw:** blocked after the end (R2a `SIGNUPS_CLOSED`); frees the spot before it.
5. **Organizer pin moves:** event-only pin and home pin keep their Undo. Their `from` return values are
   unchanged.
6. **Hide / Undo, organizer note, spot, CSV:** unchanged, plus 2 columns in the CSV.
7. **Auto-close and manual close:** the snapshot is unchanged, and an organizer-withdrawn row is excluded
   like any withdrawn row.
8. **Vacate (R2a D1):** still clears hidden and spot, now also the 2 new columns.
9. **Crowd reports:** an organizer `done` hides the "They're Out" link exactly as a household's `done` does.
10. **R1.1 Households Fix pin:** works, and its Undo still gets `from`.

## Step 4: Proposal

- **Cost:** none. No paid layer.
- **Diff budget:** about 420 LOC. That's the migration (about 230: 3 new RPCs, plus re-created bodies of
  `jc_entry_live_set`, `jc_event_signup`, 2 pin setters, `jc_home_vacated`, `jc_event_get`,
  `jc_admin_entries_list`), the client (about 130) and tests (about 160). It's over the 200 soft cap.
  Splitting server and client would ship organizer powers with no screen to use them, so it stays one PR
  (the same call as R2a). Each re-created body starts from its live definition, patched by a script that
  fails if a patch point moves (the R2a technique).
- **Migration:** `/db-rehearse`. Dry-run the full suite and prove nothing persisted; apply only on Zee's
  "apply".
- **Deploy order:** **DB first, then merge.** The new keys and RPCs are additive, so old clients are
  unaffected. A new client against the old DB would fail only on the new buttons.
- **Signatures frozen:** `jc_event_signup`, `jc_entry_live_set`, `jc_event_close`,
  `jc_admin_broadcast_set`. The grants test asserts it.

## Step 5: Premortem

| Mode | Exposed | Mitigation |
|---|---|---|
| **1 Silent corruption** | Organizer acts on the wrong household; supply cleared on the wrong row; vacate leaves a stale "removed" line on the next family | Entry looked up **in the caller's community** and the event decided by the entry itself (the `jc_admin_entry_pin_set` pattern). The client confirm names the home (as pin moves do). Vacate clears both columns. SQL tests for each. |
| **2 Silent zero-output** | Household never sees the line (key missing from `mine`, client reads the wrong key) | e2e asserts the visible text from a stubbed `mine`. SQL asserts `jc_event_get` returns both keys after each setter. A test proves the home-pin move sets it only on live `in` entries. |
| **2b Config drift** | none: no external consumer, no frozen copy | n/a |
| **3 Cost** | none | n/a |
| **4 Contract** | Frozen signatures; additive JSON | Signature asserts in `00_grants`/s15. Old-payload e2e (no new keys) still renders My Sign-Up. |
| **5 Race** | Organizer withdraw vs. household re-join in the same second; organizer vs. household both setting supply | Entry row `FOR UPDATE` in the admin RPCs; the upsert locks the row on re-join. Last write wins, both are logged, and the household sees the result. Accepted: neither outcome corrupts. |
| **6 Auth / RLS** | Resident calls admin RPCs; event admin of event A acts on event B's entry; anon reaches anything | `jc_assert_event_admin(entry's event, true)` → `NOT_ADMIN`. Event admins lose write at archive. Grants: revoke from public/anon, grant to authenticated, allowlist +3. SQL negative tests for each. `jc_entry_supply_clear` acts only on the caller's own home. |
| **7 Rollback** | Organizer withdraws the wrong household | The confirm names the home. Before the end the household can re-join, and after the end the record is still correctable until close (Q1). An organizer **Undo** is Q2 (recommendation: no new restore RPC). Mark-out is self-reversing, since it uses the same RPC. |

## Step 8: Verification (when built)

Each must fail on today's live code.

**SQL (`s15_organizer_acts.test.sql`)**
- (a) Organizer sets `done` → `live_state=done`, reports cleared, `org_adjusted_at` set, admin log +
  state log rows. An event admin of another event gets `NOT_ADMIN`; a resident gets `NOT_ADMIN`.
- (a) `FEATURE_OFF` when supply is off; `BAD_SUPPLY` for supply + clear together; an archived event gets
  `NOT_FOUND`.
- (b) Organizer withdraw on a full capacity event frees a place (`places_left` +1), nulls the spot, clears
  reports, sets `org_withdrawn_at`. The snapshot excludes the row.
- (b) Household re-join clears `org_withdrawn_at` and `org_adjusted_at`.
- (c) `jc_admin_entry_pin_set` and `jc_admin_home_pin_set` set `org_adjusted_at`. The home-pin move doesn't
  touch withdrawn or archived entries or draft events.
- (c) The household's own `jc_entry_live_set` clears `org_adjusted_at`.
- (c) `jc_home_vacated` clears both columns.
- (d) `jc_entry_supply_clear` → `supply_level` null + state log null. Supply feature off gets
  `FEATURE_OFF`; another home's entry is untouched.
- Signatures of the 4 frozen functions unchanged; grants allowlist includes the 3 new RPCs, and anon has
  no execute on them.

**e2e (stubbed RPCs, both browsers)**
- Resident: tapping the pressed level sends `jc_entry_supply_clear` with the exact args and un-presses.
  Tapping another level still sends `jc_entry_live_set`.
- Resident: `mine.org_adjusted_at` shows "Adjusted by an organizer · ⟨time⟩".
  `mine.org_withdrawn_at` shows "An organizer removed your sign-up". No organizer name or id appears in
  the DOM.
- Organizer Sign-ups row: Mark out / Handing out / supply / Clear supply / Withdraw send exact args. The
  withdraw confirm names the home, and dismissing it sends nothing.
- Old-server payload (no new keys): My Sign-Up renders, no "adjusted" line.
- AR + RTL for every new string.

**Post-apply:** full suite against live, `get_advisors` shows no new category, and an e2e-community smoke
test (an organizer marks a test home out, the household view shows the line).

## Open questions for Zee (each with a recommendation)

1. **After an event ends (the 24 h before it closes itself), may organizers still mark a home out, set or
   clear supply, or withdraw a no-show?** *Recommendation: yes, until it closes.* This window is where
   no-shows become obvious, and fixing them makes the saved report true. Households stay blocked from
   withdrawing after the end (R2a). Every organizer change is logged and the household is told.
2. **Undo for "withdraw a no-show"?** *Recommendation: no Undo button.* Use a confirm that names the home.
   Before the end, the household can sign up again. An Undo would need a "restore" RPC that re-checks
   capacity, which is more server surface for a rare mistake.
3. **Should organizers also get "Clear supply"?** *Recommendation: yes.* It's the same button pattern as
   residents' and costs one argument on the new RPC. Without it, an organizer who sets the wrong level can
   only overwrite it, never remove it.
