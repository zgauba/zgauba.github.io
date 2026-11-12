# Publish state clarity — Courts + Events — review 2026-11-12

From Zee (2026-11-11, court admin on a phone): "I added another court and went to the module but did not see it there…
it wasn't published… there's no message when I first save it and no visual indication that there may be another step."

Tier: screen logic (client only — no DB change; live `jc_admin_facility_status` already allows draft ⇄ published).
Reviewer: `code-reviewer`.

## What changed

- **Court editor**: a state line at the top (new → "New courts start as drafts…", draft → amber "Draft — residents
  can't see this court yet.", published → "Published — residents can see this court."). New / draft courts get
  **Save and Publish** + **Save as Draft** (Enter = draft); a published court keeps one **Save**.
- **After a draft save**: "Saved as a draft. Residents can't see it until you publish." + a **Publish** button in the
  message (no confirm — the button says what it does). Save and Publish = save, then publish; if the publish half
  fails, a red message says it's still a draft, with Publish to retry.
- **Courts list**: draft chip in warn amber, "Draft — residents can't see it yet".
- **Events**: a draft row wears the amber "Draft — only organizers can see it" pill; a draft save says "Saved as a
  draft. Residents can't see it until you publish it." (live edits still "Saved."). No Save-and-Publish in the event
  editor: a draft event has two exits (Coming Soon / Publish and Open Sign-Ups), both on the list row.
- Strings EN + AR. Amber = the brand's warn signal ("needs a step"), not decoration.

## Tests

| Run | Result |
|---|---|
| Full suite, mobile (Chromium) | 565 passed |
| `admin-courts` + `admin`, WebKit | 75 passed |
| New tests (`admin-courts.spec.js`, "publish state …") | 8 |
| Mutations: Save and Publish → draft · no Publish in the message · draft event says "Saved." · no saving guard · no name match · publish dropped after leaving · no scroll-to-top | 7 / 7 caught |

Screenshots looked at: courts list with the draft-saved message + Publish and the amber chip; new-court editor
(amber note, three buttons — note spacing fixed after); events list with the amber draft pill.

## Code review (`code-reviewer`) — REQUEST CHANGES → fixed

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | Med | After saving from the bottom of the long form the message can be above the screen | **Fixed** — `back()` scrolls to the top; the message also scrolls into view. Test with a 15-court list (failed without the fix) |
| M2 | Med | Save and Publish silently became a draft save when the new court's id couldn't be found (another admin's court in the same reply) | **Fixed** — match by English name among the new ones; still ambiguous → red "didn't publish — tap Publish on it in the list". Test |
| L3 | Low | Leaving the editor mid-save dropped the publish silently | **Fixed** — the publish the admin asked for goes ahead; the message shows if they're on the Courts list. Test |
| L4 | Low | A language switch re-enables the buttons → a second save (duplicate court) | **Fixed** — `ctEd.saving` guard. Test |
| L5 | Low | Editor opened while a Publish is in flight can say "draft" for a now-live court | **Accepted** — sub-second window; the server refuses a wrong move (BAD_STATE) and the list re-reads |
| L6 | Low | `ctBusy` not set during the publish half | **Accepted** — the server serialises status changes; worst case one BAD_STATE message |
| L7 | Low | A failed Publish from the message replaces the message (button gone) | **Accepted** — the error shows; Publish stays on the court's row |
| L8 | Low | Long draft chip may wrap | **Accepted** — checked on the iPhone-width screenshot: one line (EN); AR is shorter |
