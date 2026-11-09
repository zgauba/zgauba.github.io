# Courts: "yours" in blue, Help + Admin as on Events: review (2026-11-09)

PR: `fix/slot-mine-blue` (#83).

**Source:** Zee's iPhone review.
- Free and Your booking were both green.
- "Make sure we have consistent UI/UX between modules… I do not see help buttons or the admin button."

**Tier:** screen logic (who sees Admin; a new Organizer Tools deep link) → **code-reviewer**.

## What changed

- **Slot colours.** "Yours" now has its own blue (`--jc-mine`), drawn as a blue outline with a filled label (8.6:1).
  The note in `slot-colors-review-2026-11-09.md` is updated.
- **Help.** Courts gets the shared ? Help button (`jcHelp`):
  - "Courts" on the list (5 points);
  - "This court" on a court's day (4 points, including the colour key).
  - EN + AR (AR draft).
- **Admin.** Courts admins (community / bookings scope, the same test as Organizer Tools' Courts tab) get Admin:
  - a badge on each court card, as on event cards;
  - a button on the court title's line, as on an event page.
  - Both go to `../admin/?tab=courts&court=<id>`, which opens that court's Day view once. The URL is then cleaned,
    so Back returns to the courts list. An unknown court says "That court is no longer listed."
- **Shared header styles.** `.badge`, `.evtop` and `.evtitle` moved verbatim from `events/events.css` to
  `assets/app.css`, so Events and Courts use one copy. `#evAdmin` became `.adminbtn`.
- **The earlier unexplained Courts flake, found on CI.** In the Map tab test, Find Me pans the map and a tap during
  the pan misses the pin. The test now taps until the popup opens. 30 stress runs passed on WebKit.

## Code review: no High, no Medium

| # | Sev | Finding | Disposition |
|---|---|---|---|
| L1 | L | `?court=` stayed pending if the user left the Courts tab before the list landed; a later list load would jump into that day view | **Fixed.** Consumed whenever the list lands; opens only if still on Courts |
| L2 | L | Not consumed if the court list were already cached | No change: not reachable (`ct` is null on a fresh load) |
| L3 | L | A deep link drops a pending note; a walk-on target shows the list with no message | No change: no note can exist on a fresh load; a walk-on court has no day view |
| L4 | L | Every card's Admin link reads just "Admin" | **Fixed.** `aria-label` "Admin: <court>" |

The reviewer verified:
- **No cascade change for Events.** `app.css` loads first; specificity still beats `.lang` and `a:visited`.
- **Scope parity.** The Courts check equals `isCourtsAdmin()`, so the button never leads to a refusal.
- **XSS.** `encodeURIComponent` inside the href is safe.
- **The kill-switch page.** It shows no Help.

## Verification

- **Full suite:** 1012/1012 (mobile + webkit).
- **Tests:**
  - Help on the list and the court;
  - Admin per scope (community / bookings yes, events no), on the title line;
  - the deep link (opens once, URL cleaned, Back, unknown court).
- **Mutation checks:**
  - Admin shown to everyone: caught.
  - Help removed: caught.
- **Screenshots (WebKit, iPhone 13):**
  - my slot in blue among free ones;
  - a court as a community admin, with ? in the top bar and Admin on the title line.
