# R2b-2: safety block, holiday lights, clean event text. Plan (`/plan-change`, 2026-11-07)

> Sources: `docs/plans/ROADMAP.md` R2b, `docs/plans/R2-event-night.md` ("R2b design notes"), and Zee
> 2026-11-06 on holiday lights: "just another event template". Live definitions were read read-only from
> JubailCommons (`qrpxfssdeeuzmsmlbtbu`) on 2026-11-07, **after R2b-1** (`20261107090000_r2b_1_organizer_acts`).
> Zee pre-approved building this; open questions below are decided conservatively by the parent session
> under that approval and marked as such.

## Step 0: Scope

**Cross-layer, tier 3.** One constraint swap on `jc_events`, the body of `jc_admin_event_save` (argument list
unchanged), and client changes on the editor and the event page. Full protocol, `/db-rehearse`, database +
security + code review.

## What ships (one PR, one migration)

| # | What | Server | Client |
|---|---|---|---|
| a | **Safety block**: the community security number and the agreed lost-child meeting point (EN / AR), per event, behind the event's `safety` switch | `jc_admin_event_save` validates and normalises `safety` (allowed keys, phone format, clean text) | Editor: a "Safety" section. Event page: a compact block under the description, phone as a `tel:` link |
| b | **Holiday lights**: a homes event where each decorated home is a stop | `holiday_lights` added to `jc_events_look_check` | Look (colours, mark), template with three questions, EN + AR |
| c | **Clean event text on write** | `jc_admin_event_save`: `jc_clean_text` on `title_en`, `title_ar`, `description_en`, `description_ar`. Stored rows are left as is | none |

## Step 1: Inventory (named checks against the live DB, 2026-11-07)

| Layer | Touched? | Check (read-only) | Result |
|---|---|---|---|
| `jc_events.safety` | Used, not altered | `information_schema.columns` | `jsonb`, default `'{}'`. CHECKs: `jc_events_safety_check` (object), `jc_events_json_caps` (≤ 2048 bytes) |
| Existing safety data | Read | `select count(*) filter (where safety <> '{}') from jc_events` | **0 of 7** events carry any safety data; **0** have `features.safety` |
| `jc_kv_check(p, 'safety')` | Reused as is | `pg_get_functiondef` | Any key matching `^[a-z][a-z0-9_-]{0,30}$`, string values ≤ 500 chars. **No key allowlist, no phone rule.** So R2b-2 adds both in the save body, not in the shared helper (it also checks `theme`) |
| `jc_features_check` | Reused as is | `pg_get_functiondef` | Already allows `safety` (with `giant_switch`, `supply`, `crowd_reports`, `route`), booleans only. No change |
| `jc_clean_text` | Reused as is | `pg_get_functiondef` | `IMMUTABLE` SQL. Strips C0 controls except tab and newline, plus bidi overrides U+202A–202E and U+2066–2069; trims; empty → `null`. `jc_clean_line` = that, plus newlines, tabs and zero-width marks removed |
| `jc_admin_event_save(uuid, jsonb)` | **Body only** | `pg_get_functiondef` | Already calls `jc_clean_text` on the venue names only. Title / description are stored raw: a whitespace-only title passes `jc_events_text_caps` today |
| `jc_events_look_check` | **Dropped and re-added** | `pg_get_constraintdef` | `plain, halloween, haq_al_laila, gathering, market, yard_sale`. Live looks in use: `plain, gathering, market, haq_al_laila, halloween`. 7 rows, so the re-validation is instant |
| Other functions that list looks | No | `prosrc ~ 'haq_al_laila\|yard_sale'` | **None.** Looks are a client concern plus the one CHECK |
| Read paths for `safety` | No change | `prosrc ~ 'safety'` | `jc_event_get` and `jc_admin_events_list` return `safety` as stored; `jc_admin_event_save` writes it. No other reader |
| Grants on `jc_admin_event_save` | Unchanged | `routine_privileges` | `authenticated`, `service_role`, `postgres`. `create or replace` keeps them |
| Migration history | Read | `supabase_migrations.schema_migrations` | Latest `20261107090000 r2b_1_organizer_acts`. New file sorts after it |
| Cron / Edge / Resend / Auth | Not touched | n/a | No event-text or look code in any of them |
| Client | `admin/admin.js` (LOOKS, TEMPLATES, editor, `saveEvent`), `events/events.js` (`LOOK_MARKS`, detail header), `events/events.css`, `assets/tokens.css`, `assets/strings.js` (EN + AR) | grep | |
| Tests | new `tests/sql/s16_safety_lights.test.sql`; e2e new `safety-lights.spec.js`; `backends.js` gains a holiday-lights event | `ls` | |
| SignalPost / Pages config | Not touched | no `jh_`, `_headers` or deploy change | |

## Step 2: Impact map

**(a) Safety block.**
- **Shape (server-enforced):** `safety` may hold only `phone`, `meeting_en`, `meeting_ar`. Any other key → `BAD_FIELDS`.
  `jc_kv_check(…, 'safety')` still runs first (strings only, ≤ 500).
- **Phone:** whitespace runs collapse to one space, then trimmed. It must match `^\+?[0-9]( ?[0-9])*$`, with
  3–15 digits (3 for a short code like 999; 15 is the E.164 maximum) and ≤ 24 characters. Otherwise **`BAD_PHONE`** (new code).
  Stored normalised.
- **Meeting point:** `jc_clean_line` (one line, no controls or bidi overrides), ≤ 200 characters, else `BAD_FIELDS`.
- **Empty values are dropped**, so `{}` clears the block. The stored object is rebuilt from the three keys, never
  copied from input.
- **The switch:** `features.safety` (already accepted by `jc_features_check`) decides whether the event page shows the block.
  Turning it off keeps the values. That's the per-event kill switch.
- **Event page:** shown when the switch is on and at least one value is set. A compact panel under the description:
  "Security: ⟨number⟩" as a `tel:` link (digits and `+` only in the href) and "Lost child? Meet at: ⟨place⟩".
  The client re-checks the phone pattern before making a link, so a bad stored value shows as text, never as a link.
- **Editor:** a "Safety" section: one checkbox for the switch, a `type="tel"` number field (LTR), and meeting point
  EN / AR fields. The help text says it is the community's security line, never a resident's own number.
  If the switch is ticked with nothing filled in, saving says so (`SAFETY_EMPTY`, client-only) and sends nothing.
- **What it stores about people:** nothing. No child, household or resident is named or linked. The number is a
  community service line, the same for every household.
- **Read path:** `jc_event_get` returns `safety` as stored, whatever the switch says, as it does today. It is
  community information, not personal data, so no read change is needed (smaller diff, no `jc_event_get` re-create).

**(b) Holiday lights.**
- **CHECK:** `jc_events_look_check` adds `holiday_lights`. `alter table … drop constraint …, add constraint …`
  runs as one statement, so there's no window without the check.
- **Look:** a night palette (deep blue-black surfaces, warm string-light accent `#ffe3a3`), mark ✨. It
  sets accent, brand and surface tokens only, never the four signals (tokens.css guardrail).
- **Template:** homes event, look `holiday_lights`, switch on (a home can mark itself done for the night). Supply and
  neighbour reports are off (nothing runs out). Questions:
  - "Best seen from…": street / garden / both (ring, split ring for both).
  - "What kind of lights?": warm white 💡 / colourful 🌈 / lights and music 🎶 (icon).
  - "Lights on until…": 9 pm / 10 pm / 11 pm / midnight or later.
  It is not a treat night, so the copy says "done", not "out of treats".
- **Old clients:** an unknown look renders plain (`lookOf` falls back), and the editor keeps an unknown look
  selected, so an old cached page never rewrites it.

**(c) Clean event text.**
- `title_en`: cleaned on insert and update. If it cleans to nothing (whitespace, controls only) → `BAD_FIELDS`, the
  same code as a missing title today. JSON `null` still means "unchanged", as before.
- `title_ar`, `description_en`, `description_ar`: cleaned. Blank becomes `null`, not `""`. Readers already treat
  both as "none" (`ev.title_ar ? … : title_en`).
- Descriptions keep newlines and tabs, since the rich-text markers need them (`jc_clean_text`, not `jc_clean_line`).
- Stored rows are not rewritten.

**Write path:** only `jc_admin_event_save`. **Read paths:** unchanged functions. No new table, no RLS change,
no new function, no grant change.

## Step 3: Regression surface

1. Creating and editing events: every existing key behaves as before. That covers slug lock, `SCHEMA_LOCKED`,
   `KIND_LOCKED`, `CAPACITY_BELOW`, `NO_VENUE`, `NO_DATE`, spots clearing, venue `BAD_PIN` and the admin log.
2. Existing looks still save, and an unknown look (`disco`) is still `BAD_FIELDS`.
3. Theme validation (`jc_kv_check(…, 'theme')`) is unchanged.
4. Venue names are still cleaned exactly as before.
5. The event page header: title, Admin button on the title line, two-line description with "More", and the tabs.
   The map stays high: the safety block is two short lines and only appears when switched on.
6. Event day, pins and keys for every existing look are unchanged.
7. The features object keeps unknown flags. The editor only adds or removes `safety` next to the existing three.
8. Templates: the existing six are unchanged; holiday lights is added before Blank.
9. `jc_admin_event_save`'s argument list and grants are unchanged, and so are the frozen signatures (asserted in s16).

## Step 4: Proposal

- **Cost:** none.
- **Diff budget:** about 380 LOC. The migration is about 190, mostly the re-created save body. The client is about
  120, including strings, and the tests about 170. Over the 200 soft cap, but each part is small, and splitting
  would ship editor fields the server rejects.
- **Migration:** `20261107120000_r2b_2_safety_lights.sql` via `/db-rehearse`: dry-run the full suite and prove
  nothing persisted. The parent applies it only on Zee's "apply".
- **Deploy order: DB first, then merge.** A new client on the old DB can't save `holiday_lights` (`BAD_FIELDS`). It
  would store safety unnormalised but still within `jc_kv_check`. An old client on the new DB is unaffected.
- **Frozen:** `jc_event_signup`, `jc_entry_live_set`, `jc_event_close`, `jc_admin_broadcast_set`, `jh_signup`, and
  `jc_admin_event_save`'s argument list.

## Step 5: Premortem

| Mode | Exposed | Mitigation |
|---|---|---|
| **1 Silent corruption** | Cleaning eats legitimate text (Arabic joiners, newlines in descriptions); a safety save drops a field | Descriptions use `jc_clean_text` (keeps newlines; zero-width joiners untouched). Only meeting points use `jc_clean_line`. SQL tests: Arabic text and newlines survive, controls and bidi overrides go. Safety round-trip test for all three keys |
| **2 Silent zero-output** | Organizer fills safety but the switch is off, or ticks it with nothing filled in; page never shows the block | Editor refuses ticked-and-empty (`SAFETY_EMPTY`). The event page shows the block exactly when the switch is on and a value exists (e2e both ways). The organizer sees the values in the editor either way |
| **2b Config drift** | Look list lives in the CHECK plus the client `LOOKS` / `LOOK_MARKS` / tokens | s16 asserts the CHECK list. An e2e test asserts the template saves `look: "holiday_lights"` and the page sets `data-look` |
| **3 Cost** | none | n/a |
| **4 Contract** | Save signature; existing safety/theme callers; blank → null | `jc_admin_event_save(p_event uuid, p_fields jsonb)` asserted in s16. No live event has safety data (inventory). Blank → null is read as "none" everywhere |
| **5 Race** | Two organizers save at once | Unchanged: the row is locked `FOR UPDATE` in the save |
| **6 Auth / injection** | A stored `javascript:` or markup in the phone; markup in the meeting point | Server: digits / `+` / spaces only (`BAD_PHONE`). Client: `href="tel:"` built from digits and `+` only, and only if the pattern matches. Meeting text goes through `esc()`. e2e: a hostile stored value renders as text, never as a link or markup |
| **7 Rollback** | Need to undo | Rollback note in the migration header: restore the previous CHECK (only if no `holiday_lights` rows exist, else set them to `plain` first) and re-create the R2b-1-era save body from `20261106120000_r2a_events_audit.sql` (its last definer). Normalised safety and cleaned text stay as stored (harmless) |

## Decisions (parent, under Zee's pre-approval, 2026-11-07)

Each takes the conservative recommendation. None adds personal data, changes an existing user-visible promise or
needs a frozen-signature change.

1. **Decided (parent, under Zee's pre-approval):** safety keys are exactly `phone`, `meeting_en`, `meeting_ar`,
   enforced server-side. Anything else is `BAD_FIELDS`.
2. **Decided (parent, under Zee's pre-approval):** phone = digits with an optional leading `+` and single spaces,
   3–15 digits, ≤ 24 characters, stored normalised. Failure is a new code, `BAD_PHONE`, with its own EN + AR message.
3. **Decided (parent, under Zee's pre-approval):** the block is shown only when the event's `safety` switch is on and
   a value exists. Switching it off keeps the values. The template does not pre-tick it, because it needs real numbers first.
4. **Decided (parent, under Zee's pre-approval):** `jc_event_get` is not changed. It already returns `safety`. Gating
   the read on the switch would mean re-creating a hot read function for no privacy gain.
5. **Decided (parent, under Zee's pre-approval):** a title that cleans to nothing is `BAD_FIELDS` (it was accepted
   before), and blank optional texts are stored as `null`.
6. **Decided (parent, under Zee's pre-approval):** holiday lights runs the switch only, with generic "Open / Done"
   wording. Lights-specific switch wording ("Lights on / Lights off") is **deferred**: it needs a third wording set
   next to the treat-night one, and that's polish, not event-night safety.
