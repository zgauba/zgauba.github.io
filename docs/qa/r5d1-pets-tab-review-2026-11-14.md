# R5d-1 — Organizer Tools → Pets (the way in): reviews (2026-11-14)

Plan: `docs/plans/R5d-pets-organizer.md` (approved 2026-11-14: Q1 = A, Q2 yes, Q3 yes, Banner last). Tier 2 + security (who may enter Organizer Tools). No database change.

Reviewers (read-only, on the uncommitted diff):
- `code-reviewer`: **WARNING**, 0 critical/high, 2 medium, 4 low.
- `security-reviewer`: **no CRITICAL/HIGH**, 2 medium, 2 low, 1 info. Confidence 0.85.

## What changed

- **Organizer Tools:**
  - A **Pets** tab for pets and community admins:
    - the animals, strays and community animals first, then the owners' villages A–Z, then name (NF-3)
    - chips: Missing, care state, No photo, Seen n× this week
    - **Archived · n** with names only (no restore, per Zee Q3)
    - the **pets WhatsApp group link** (set / replace / remove)
    - `?tab=pets&pet=` lands on that animal
  - Pets-only admins can enter. The Admins screen lists and invites **Pets admins**. Pet actions are named in the admin log.
  - The **Banner is the last tab** (Zee): Events · Courts · Pets · Community · Banner.
- **Pets page:** an **Admin** button on an animal's page for pets and community admins, as on a court's page.
- **My Home → Account:** the Organizer Tools button now goes to any admin role (`jcIsAdmin`). Courts admins were missing it before: a found drift.
- **CSS:** `.chip` / `.chip.miss` / `.chip.warn` moved into `assets/app.css`. Before, they were copied in `pets.css` and `admin.css`; the merged rule matches the old cascade.

## Findings and disposition

| # | From | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | both | MEDIUM | When the current link can't be read (Pets off; a code-only admin with no home; the network), the field shows empty and **Save sends "" and clears the live link** without asking. | **Fixed.** An empty Save never clears blind. If the link is unreadable or none is set, it asks for a link (`pa_err_NEED_LINK`). If a link is set, it asks the Remove question. Tests added. |
| 2 | security | MEDIUM | "Can't be read while Pets is switched off" showed for every read failure. | **Fixed.** That wording shows for `MODULE_OFF` only; any other code gets `pa_group_unread`. Tests added. |
| 3 | code | MEDIUM | `type="url"` matched no shared input rule: unstyled, and iOS zooms on focus. | **Fixed.** `type="text" inputmode="url"`, as the other inputs. Test asserts it. |
| 4 | security | LOW | An in-flight list could refill `pa` after `fail()`. | **Fixed.** `paSeq` drops answers from before a right ended. |
| 5 | code | LOW | The View link was an inline `a.mini` (underlined, visited colour). | **Fixed.** `btn ghost small`, as other Organizer Tools link-buttons. |
| 6 | code | LOW | The deep-link focus was visual only. | **Fixed.** `tabindex=-1` + `focus()`. The test asserts focus. |
| 7 | security | LOW | Pets rows stay on screen for the milliseconds until `jc_me_get` answers after a right ends. | **Kept.** The person already held the data, the lock replaces it, and other tabs behave the same. |
| 8 | code | LOW | The Pets list is cached for the session (another admin's change shows after Retry or a reload). | **Kept.** This is the Courts pattern. R5d-2 / R5d-3 writes re-read the list. |
| 9 | code | LOW | The invite-accept "no screens yet" branch can no longer run. | **Kept** as a safety net; the comment was updated. |
| 10 | security | INFO | The Admin button shows on owned pets too. | **Intended.** Zee Q2: organizers can archive a household's pet as moderation (R5d-3). |

Weak tests raised by the code review, and what was done:
- **The right-ends test only checked absence.** Now it asserts the lock and a message.
- **The courts-only test.** Now it asserts the Pets RPCs are never called.
- **Hostile names, territory and link.** Test added.
- **Empty Save.** Two tests added (unreadable, and a link set).
- **A styling assertion.** Covered by the `type` / `inputmode` assertion.

## Verification

- **`admin-pets.spec.js` (new):** 10 tests. Who sees the tab; order, chips and archived; module on/off; link save, refuse and remove; BAD_LINK and unreadable wording; the empty-Save guard ×2; hostile text; deep link and focus; a right ending mid-load.
- **`pets.spec.js`:** the Admin button for 4 roles.
- **Updated for the new behaviour:**
  - the tab order in `admin.spec`, `admin-courts`, `a11y` (keyboard order + the banner draft survives)
  - Pets on the Admins screen in `admin-admins` and `section-names`
  - a pets code entering Organizer Tools, and the My Home button for every role (`admin.spec`)
  - log words (`admin-households`)
- **Affected specs locally, both browsers:** 722 passed. The full suite runs in CI.
- **Screenshot:** Organizer Tools → Pets (EN, community admin). The tabs, the switched-off notice and the group panel render correctly.
