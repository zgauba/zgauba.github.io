# R1.1 — Households: fix a home's pin — review (2026-11-06)

> **Tier 2 (screen logic)** per `/ship-pr` step 1b: no schema / RPC / auth / PII change. It reuses the live
> `jc_admin_home_pin_set` (gate `jc_events_organizer()`, which accepts `events` or `community` scope; refuses pins
> >10 km from the centre; clears `pin_far`/`pin_near`; auto-resolves the home's open `pin_flag` notices;
> admin-logged; returns `{home_id, lat, lng, from}`).
> **Reviewer:** builder self-review. **The independent `code-reviewer` pass is owed before merge.**

## What changed

- `commons/admin/admin.js`
  - Each home card on Households gets **Fix Pin**, or **Set Pin** when the home has no pin.
  - The new `hhpin` view reuses the sign-ups pin-move map (`pinMapHtml` / `initPinMap` / `centerOf`):
    centre ring, coordinates box, Street toggle.
  - The confirm names the home. After the write, the households list is read again and Households shows the result.
  - **Undo** puts back the `from` spot. There is no Undo when the home had no pin, because there's nothing to put back.
  - The `hhBusy` one-write-at-a-time guard is respected, including by Undo and Cancel / Back while in flight.
  - BAD_PIN keeps the map open with admin wording. NOT_FOUND re-reads the list. If Leaflet didn't load,
    no spot is chosen and nothing is sent.
  - An App Health pin notice → **Open Home** focuses that home's pin button (one tap from the fix).
  - `pinFlags()` is factored out so the card and the pin view show the same flags.
- `commons/assets/strings.js`
  - 10 new `adm_hh_pin_*` keys and `adm_hh_err_BAD_PIN`, each in EN + AR (parity checked by key count).
  - `help_admin_6` now mentions "a home's pin" (EN + AR).
- `tests/e2e/specs/admin-households.spec.js`
  - The stub mirrors the live return shape.
  - 7 new tests:
    - Fix Pin sends exact arguments, the confirm names the home, and Undo sends the old coordinates
    - Set Pin on a home with no pin shows its flags and offers no Undo
    - BAD_PIN keeps the map open
    - a dismissed confirm sends nothing
    - no Leaflet sends nothing
    - a pin notice focuses Set Pin
    - Arabic / RTL

## Tests

- Full e2e suite, once locally on both projects: **642 / 642 passed** (321 Chromium + 321 WebKit). CI on the PR.
- Screenshots looked at (WebKit, iPhone 13):
  - Households list (EN)
  - Fix Pin view (EN)
  - Fix Pin view (AR, RTL)

  Layout is correct in both directions, and buttons and flags wrap cleanly. The grey map in the shots is the
  stub, which loads no tiles.

## Self-review findings

| Sev | Where | Finding | Disposition |
|---|---|---|---|
| Low | `hhReread` | If the list re-read fails after a successful pin write, Households shows the old flags. The pin DID move and the message says so. | **Accepted**: reopening Households refreshes the list. Same posture as R1's accepted "list load failure" item. |
| Low | Undo | Undo writes the `from` spot even if the household moved its own pin in between. That could undo their newer pin. | **Accepted**: same as the sign-ups pin move (T5.2). Undo is offered only in the success toast, right after the fix. |
| Info | R2b-1 | R2b-1's "adjusted by an organizer" will be set inside `jc_admin_home_pin_set`, so pins fixed here get it with no client change. | Noted for the R2b-1 plan. |
| Info | Conflict | The cherry-pick onto main conflicted with R2a's `closesAt` / `noEndWarn` helpers at the same spot. Both sides were kept; `node --check` passes and the full suite is green. | Resolved. |

## Independent code-reviewer (2026-11-06)

`code-reviewer` agent on PR #67, relayed by the coordinator. All 5 findings were fixed on this branch.

| # | Sev | Where | Finding | Disposition |
|---|---|---|---|---|
| 1 | Medium | `admin.js` `hhPinErr` / Undo | Undo reused the BAD_PIN "move the map onto the home" copy, but no map is shown on Households. Scenario: a far (>10 km) pin is fixed, Undo is tapped, the server refuses BAD_PIN, and the wrong copy appears. | **Fixed.** `hhPinErr(err, undo)` gives Undo its own wording. BAD_PIN shows new `adm_hh_pin_undo_bad` (EN + AR); other Undo failures show the generic `err_UNKNOWN`. NOT_ADMIN still goes to `fail`, and NOT_FOUND still re-reads the list. Tests: "Undo refused…" and "Undo failing for another reason…". |
| 2 | Medium | `admin-households.spec.js` first R1.1 test | The Undo assertion couldn't tell right from wrong: the map opened on the home's own pin, so the save payload equalled `from`. | **Fixed.** The test now moves the map (`#coords` 24.54, 54.44 → Go) before saving. It asserts the save sends the NEW spot and Undo sends the OLD one (24.53, 54.43). The h8 Set Pin test now asserts the exact coordinates sent. "The map opens on the home's own pin" moved to the BAD_PIN test, which saves unmoved. |
| 3 | Low | `okUndo` | The Undo button was disabled before `undo()` ran. If `hhBusy` made `undo()` bail, the button stayed dead. | **Fixed.** `undo()` returns `false` when it doesn't start, and `okUndo` re-enables the button. Other `okUndo` callers return `undefined`, so they are unchanged. |
| 4 | Low | `hhPinSave` / Undo | `hhBusy` was cleared before `hhReread` finished. A tap in that gap had its form thrown away by `hh.open = null; show()`. | **Fixed.** `hhBusy` now stays on until the re-read settles, and is cleared in `hhReread` (success or failure) or in `hhPinErr`. |
| 5 | Info | `VIEWS.hhpin` | Switching language during an in-flight save redrew the buttons as enabled. | **Fixed.** `VIEWS.hhpin` re-disables Save and Cancel while `hhBusy` is on. |
| (gap) | — | tests | There was no NOT_FOUND test through the pin path. | **Added:** "the home went away while fixing its pin…". |

Not test-covered: #3, #4 and #5. Each needs a request held mid-flight, which this stub doesn't do (every answer comes back at once). They are small, guard-only changes.

**Tests after the fixes:**
- Full e2e, once locally: **648 / 648 passed** (324 Chromium + 324 WebKit; +3 tests per browser).
- CI on the PR.
