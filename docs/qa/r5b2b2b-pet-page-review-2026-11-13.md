# R5b-2b-2b — the pet page · review 2026-11-13

Branch `feat/r5b2b2b-pet-page`. Tier 2 (screen logic, no schema / RPC change) plus `security-reviewer`, because this PR
ships the privacy disclosure that the R5b-2b-0 review made a condition of the "out on their own" button.
Plan: `docs/plans/R5b-2-pets-maps.md` "R5b-2b-2b". Reviewers: `code-reviewer` and `security-reviewer` (read-only, 2026-11-13).

## Scope

- Pet page tabs by state: About · Sightings · Map.
- Map tab: the latest sighting big with "Latest · …", sightings older than 48 h faded, a stray's territory as a
  dashed ring. No lines between dots, no home pin.
- Small sighting maps: the kit's new `jcMiniMap`, on the newest 10 sightings, built lazily.
- Add Location Pin: `jcPinPicker` plus a fresh `jcLocate`; if it can't find you, the map opens on the community
  centre and says so.
- "Seen {name} out on their own?", with the household-only disclosure and an "Is this {name}?" share.
- The household's amber box, with Report as missing.
- Help text and the manifest's disclosure note.

## Security review

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | Med | The disclosure said "only the household"; Pets admins see the reports too (`jc_pet_sight_from`) | **Fixed.** `pt_out_privacy`, `help_pets_3` and `help_pet_1` (EN + AR) now name the pet admins. Test asserts the text. |
| M2 | Med | The "Is this Rex?" share follows a household-only promise with no line saying the group sees it | **Fixed.** `#ptWaOut` sits above the share on out-alone reports: "Sharing is your choice: this message goes to everyone in the chat, not only {n}'s household." Tested. |
| L1 | Low | Anonymous free-text channel to a household (harassment) | **Accepted.** Caps: 5/pet/day and 30/day per reporter. Pets admins can hide a report (`jc_admin_sighting_hide`, s4). The household is told "you can ignore this". Household dismiss stays in the backlog (plan). |
| L2 | Low | With no location fix, "Use this spot" could send the community centre untouched | **Fixed.** The button stays disabled until the map is moved. Tested. |
| L3 | Low | The share quotes the reporter's own note | **Accepted.** It is the reporter's own text and is shown before sending (see M2). |
| L4 | Low | The amber box can show a report from an earlier missing period | **Accepted.** Already pinned by s24 V08i; the copy says "If {n} is home, you can ignore this". |

The reviewer also found these sound:
- The disclosure is shown every time, before Send.
- Nothing is rendered that the server didn't send; there are no home coordinates.
- All Leaflet HTML goes through `esc`.
- Geolocation uses a fresh fix, moves the map only, and nothing is sent until "Use this spot".
- The CSP has no new hosts, and links carry `rel="noopener noreferrer"`.

## Code review — APPROVE

| # | Sev | Finding | Disposition |
|---|---|---|---|
| L1 | Low | Cancel and reopen the pin map: the first, cancelled locate failing late rewrote the second's help line | **Fixed.** One token per open (`sight.tok`). Test: "Cancel then reopen the pin map…" |
| L2 | Low | The small maps and the amber box relied on the server's newest-first order | **Fixed.** `sightList` sorts newest first on the phone. Test sends sightings oldest first. |
| L3 | Low | Test gaps: lazy building, teardown on redraw, stale locate | **Fixed.** New test: a mini map far down isn't built until scrolled to; after a language switch the maps never pile up; the Map tab leaves exactly one map. The stale-locate test is above. |
| D1 | Dup | Fit-to-pins (`fitTo`) is now a third copy (bookings.js:329, events.js:923) | **Deferred** to the scoped `/structural-audit` (ROADMAP, next after this PR): extract `jcFitPins` into the kit. Extracting here would mean touching Events and Courts in a Pets PR. |
| D2 | Dup | Popup shell (`<div class="pop">…popacts Directions`) in pets / bookings / events | **Deferred**, same audit: `jcPopHtml`. Already on its list (the Events popup variant). |
| D3 | Dup | The Find Me handler (`jcLocate` → `jcMeDot` → `setView`) in pets `bigMap` / bookings / events | **Deferred**, same audit. Inside Pets it is already one copy (`bigMap`, shared by Strays and the Map tab). |

No duplicate was found for the amber box (`.seenbox`). `jcMiniMap` is new and lives in the kit.

## Tests

- **Pets spec, both browsers:**
  - 108/108 before the review fixes.
  - **112/112** after them (4 new tests).
- **Full suite, once locally (tier 2), both browsers:** **1188/1188**.
  - An earlier full run was void: Chromium couldn't start in the sandbox after a session restart, so 1180 launch errors and no test failures.
- **Screens looked at (`SHOT_DIR`):**
  - Map tab for a missing pet.
  - The household's amber box.
  - A stray's Sightings tab with a small map.

## Carry-overs

- The Arabic strings are drafts → Arabic review list.
- The scoped `/structural-audit` picks up D1–D3.
