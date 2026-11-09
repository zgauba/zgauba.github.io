# R4c: Residents book a court (plan, 2026-11-09)

Source: `docs/plans/R4-courts.md` (R4c row, decisions Q1–Q10). Prerequisites: R4b-2 merged (#78, #79). Zee has
tested court creation + blocking on `e2e` against the real backend.

## Step 0: scope

**Tier: screen logic + security review.** It is the first resident screen that shows **other homes'** labels (the
Q7 amendment), so the plan row calls for security if anything beyond "Booked" is rendered, and it is. It is
client only: no migration, no RPC change. Every RPC below is live and authenticated-only. Manifest LAST VERIFIED
2026-11-08.

## Step 1: inventory (live bodies read 2026-11-09)

| RPC | What the screen relies on |
|---|---|
| `jc_facilities_list()` | Published courts only: name EN/AR, kind, note, pin, hours, slot, window, `walk_on`. `MODULE_OFF` when the flag is off |
| `jc_facility_day(court, date)` | A community-tz date, today … today + window − 1, else `OUT_OF_WINDOW`. `NO_HOME`, `WALK_ON`, `NOT_FOUND`. Slots carry: `state` free / mine / booked / blocked / past; `booking_id` only on **mine**; `home` label only when another home's booking is **not private and not directory-suppressed**; `block_reason` |
| `jc_booking_book(court, starts, private)` | `p_private` **required** (null → `BAD_FIELDS`, fail closed). Errors: `SLOT_BLOCKED`, `QUOTA_REACHED` (1 a day), `ACTIVE_CAP_REACHED` (2 upcoming), `SLOT_TAKEN`, `OUT_OF_WINDOW`, `BAD_SLOT`, `WALK_ON`, `NO_HOME`. Returns the updated day. *(Not the frozen `jc_booking_create`, which always books public.)* |
| `jc_booking_cancel(id)` | Own home, before the slot starts. Returns `jc_my_bookings()` |
| `jc_booking_privacy_set(id, private)` | Own home, before start. Returns `jc_my_bookings()` |
| `jc_my_bookings()` | Upcoming booked + admin-cancelled (with reason) from the last 7 days and since joining. `[]` without a home |

The other layers:

| Layer | Touched? | Notes |
|---|---|---|
| `commons/bookings/` (new) | **Yes** | `index.html`, `bookings.js`, `bookings.css`, same shell as `events/` (CSP `script-src 'self'`, `api.js`, `nav.js`, `strings.js`) |
| `assets/nav.js` | **1 line** | `bookings` `page: false → true` (the comment there already says so). The tab only shows where the flag is on: **`e2e` yes, Jubail no** |
| `assets/strings.js` | **Yes** | `bk_*` EN + AR (AR DRAFT); **`join_privacy` amended (Q7 disclosure, wording Q1 below)** |
| Hub (`index.html`) module tile | Check | Hub tiles come from the same registry + flag (verify in build) |
| Leaflet map | Reuse | Same vendor + pin pattern as `events/`, used only if a court has a pin |
| Admin screens, DB | Not touched | — |

## Step 2: the screens

1. **Courts:**
   - The line **"Official community-management bookings take precedence."** at the top (EN + AR, MCD §15.10).
   - A small map with the court pins, when any court has one; tap a pin to go to that court.
   - Court cards: name, kind, hours, location note.
   - Walk-on courts: "Walk-on: no booking needed", with no grid.
   - Above the list, **My bookings**: each upcoming booking with Cancel (one tap + confirm) and a Private switch;
     admin-cancelled ones show the reason ("Cancelled by the organizers: Court blocked: Maintenance").
2. **A court's day:**
   - Day strip: today … the window, in `cfg.tz`.
   - Slots: Free (tap → confirm sheet), Mine (Cancel), Booked (the home label if shown, else "Booked"), Blocked
     (reason), Over.
3. **Confirm sheet:**
   - Court, day and time.
   - **Private booking** checkbox, unticked by default (Q7).
   - The disclosure: "Other residents will see your home on this booking unless you tick Private."
   - The rules line: "1 a day, 2 upcoming".
   - Book → the returned day redraws.
4. **States:**
   - No home: "Add your home first", linking to My Home with `next` back here; needs a `jcSafeNext` pattern for
     `../bookings/?court=`.
   - Module off / paused: friendly page, no RPCs after `MODULE_OFF`.
   - No courts.
   - Each booking error explained in words (`SLOT_TAKEN` → re-read the day).
5. **Time zone:** every date and time in `cfg.tz` (the R4b-2 helpers, moved to `api.js` so both pages share them).
   Tests run the phone in London.

**Size:** ~420 client + ~200 e2e. That is over the 200-LOC soft cap, but it is one new page and nothing else
consumes it. A split (book/cancel first, then My bookings + privacy + map) would ship a screen residents can't
manage. **Recommend one PR.**

## Step 3: regression surface

- The tab bar and hub on Jubail: **no Courts tab** (flag off). Asserted by test.
- Events, My Home, Organizer tools: unchanged. `jcSafeNext` keeps rejecting everything it rejected before.
- The R4b admin day view still shows homes, including private ones, to admins only.

## Step 4: premortem

| # | Mode | Mitigation |
|---|---|---|
| 1 | Wrong day / time (phone tz) | Shared `cfg.tz` helpers; London-tz tests; the server rejects a bad slot (`BAD_SLOT` / `OUT_OF_WINDOW`) anyway |
| 2 | **A private booking leaks the home** | The server never sends it (`home` null). The client renders only what arrives, and a test asserts the DOM for another home's private slot is exactly "Booked". The booking sends `p_private` from the checkbox **every time** (true / false, never omitted). Security review |
| 2b | Out-of-band config | None. Jubail stays off, `e2e` is on; asserted |
| 3 | Stale grid / double tap | One write at a time; `SLOT_TAKEN` → re-read + message |
| 4 | Silent failure | Every code mapped; generic fallback |
| 5 | Race (two homes, one slot) | The server's unique index → `SLOT_TAKEN` |
| 6 | Auth | Nothing new; every RPC checks membership + home server-side |
| 7 | Copy / disclosure | `join_privacy` amendment + the confirm-sheet disclosure, in the same PR (Q7 requirement) |

## Questions for Zee

1. **Privacy wording (required by Q7).** Add to the join screen's "What we keep": *"Court bookings show your home
   number to neighbors unless you mark the booking Private."* OK as worded?
2. **Map on the Courts page:** recommend yes (a small map, only when a court has a pin).
3. **My bookings placement:** recommend at the top of Courts (no separate tab).
4. **The Private switch after booking:** recommend allowed until the slot starts (the server supports it).

## Step 8: verification (after build)

- **e2e `courts.spec.js` (Chromium + WebKit, London tz):**
  - list + map pins;
  - walk-on;
  - day strip limits;
  - each slot state;
  - another home's private slot = "Booked" only;
  - book sends `p_private` true / false;
  - every error code;
  - cancel;
  - the Private switch;
  - admin-cancel reason shown;
  - no home → next back;
  - module off;
  - Jubail shows no tab;
  - language switch;
  - hostile text;
  - axe EN + AR.
- Mutation checks.
- **Manual on `e2e`:**
  1. Book a slot.
  2. See it in My bookings.
  3. Switch it to Private.
  4. In the Organizer day view, see the home + the Private chip.
  5. Block over it, and see the reason in My bookings.
  6. Book again, then cancel.
