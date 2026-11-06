# R1 Households — review, 2026-11-06

> **Reviewer:** the R1 builder agent, reviewing its own diff (the code-review and security checklists). It ran as a
> worktree fork that can't start other agents. **This is not an independent review.** An independent
> `code-reviewer` + `security-reviewer` pass is owed before merge; append its findings below.
> **Scope:** `commons/admin/admin.js` (Households + Admin Log views, notice → home link), `commons/assets/strings.js`
> (EN + AR), `commons/admin/admin.css`, `tests/e2e/specs/admin-households.spec.js`, `docs/plans/R1-households.md`.
> App only: no migration. RPC shapes verified live (read-only) before building.

## Checks

| Area | Result |
|---|---|
| Server enforcement | Every RPC used is `jc_assert_admin('community')`-guarded (live definitions). The UI only hides the button from events-only organizers. A test covers it. |
| PII | Names come from the server as display name or masked email (`a•••@domain`). No account id appears in the page text or any attribute: members are addressed by list position, and a test checks the whole page HTML. The log never draws `target`; only a home label is looked up from `target.home_id`. A test checks this. |
| XSS | Every server or resident string goes through `esc()`. Selectors built from ids use `CSS.escape`. |
| Wrong data written | Each write's exact arguments are asserted: edit (apartment keeps its building; villa sends `p_building: null`), suppress on/off, invite approve/decline, member remove with/without account delete. |
| Irreversible action | Deleting an account is off by default, needs its own checkbox, and then a second by-name `window.confirm`. Dismissing it sends nothing. A test covers this. |
| Ordering | Writes redraw only if the person is still on the Households view. A late `jc_admin_homes_list` answer for a replaced state is dropped. |
| Error wording | Resident-worded errors that would mislead here (`HOME_TAKEN`, `ALREADY_HAS_HOME`, `NOT_FOUND` = "event", `USE_ACCOUNT_DELETE`) get admin wording. A test covers this. |
| i18n / RTL | All new keys exist in EN and AR (AR is a draft, like the rest of the file). A test switches to AR with the edit form open and the typed number survives. |
| Coordination (R2a) | A null `actor` in the log renders "Automatic" / «تلقائي». `event_autoclose` has words. A test covers it. No test asserts the old `hidden` / `spot` behaviour of `jc_home_vacated`. |

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Low | After `NOT_FOUND` (e.g. an invite another admin already decided), the list stays stale until reopened. The message says so. | Accepted. Same pattern as the sign-ups tab. |
| 2 | Low | The edit form offers the home's current village even if not delivered. Saving it unchanged is refused by the server (`VILLAGE_NOT_DELIVERED`). | Accepted: such a home can't exist through the claim flow. |
| 3 | Info | Removing a household's last member runs `jc_home_vacated`, which today keeps the event entries' `hidden` flag (Events audit D1). | Fixed in R2a, not here. |
| 4 | Info | Masked emails show the domain (`jc_mask_email`). This is roadmap-sanctioned ("display name or masked email"). | No change. |
| 5 | Fixed | The state comment named `user` for the open form; it's the member index `m`. | Fixed before PR. |

## Tests

`npx playwright test` twice: **287 passed** both runs (273 existing + 14 new in `admin-households.spec.js`). Chromium
mobile project only (R0's WebKit lane is separate).

## Independent code review (code-reviewer, 2026-11-06)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| C1 | Medium | `hhWrite` allowed concurrent writes. A second tap while one was in flight sent a second RPC, and answers could redraw out of order. | **Fixed.** Module-level `hhBusy` (the H6 `resolving` pattern). Every households control returns early while a write is in flight. Cleared on both answer paths before redrawing. Test: delayed `jc_admin_invite_decide` plus taps on two other controls → exactly one write. Fails on the pre-fix code. |
| C2 | Medium | After `NOT_FOUND` / `ALREADY_HAS_HOME` the list stayed stale, e.g. an invite another admin had already decided. | **Fixed.** `hh.data = null`, `hh.open = null`, `loadHouseholds()`, then the message. NOT_FOUND wording now says the list is up to date (EN + AR). Test: the homes list is read twice and the stale request is gone. Fails on the pre-fix code. |
| C3 | Low | `.then().catch()` reported a render exception as an API error. | **Fixed.** `.then(onOk, onErr)`. A malformed answer goes to `onErr` explicitly. |
| C4 | Low | Number / building were sent untrimmed. | **Fixed.** `.trim()` before sending (the server also trims the number). |
| C5 | Low | If `jc_admin_homes_list` fails, the screen keeps "Working…" with no retry. | **Accepted, deferred.** The error message shows and Back works. A retry button can come with the R3 app-shell pass. |

## Independent security review (security-reviewer, 2026-11-06)

No High or Critical findings. The coordinator verified these live on JubailCommons:
- `jc_admin_member_remove` matches S1: admin assert, `USE_ACCOUNT_DELETE` self-check, and a same-community `jc_accounts` check.
- `auth.users` foreign keys: `jc_accounts`, `jc_entry_reports` (reporter), `jc_rate` and `jc_platform_owners` CASCADE; every other key is SET NULL. Deleting an account drops no other member's data. A deleted user's open crowd reports disappear, which is acceptable.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| S1 | Low | A community admin can delete another admin's account. | **Deferred to the R7 structural audit** (server change, KG 14 area: `jc_assert_admin` / admin-on-admin rules). |
| S2 | Low | `member_remove` for an account with no home logs `home_id: null`. | **Accepted.** The log row still records the action. The screen shows no home label. |
| S3 | Low | The admin log keeps a deleted user's uuid in `target`. | **Accepted.** Opaque, never rendered (the screen draws only a home label; a test checks this). |
| S4 | Info | The masked email reveals the domain. | **Accepted.** Sanctioned by ROADMAP R1 ("display name or masked email"). |
| S5 | Info | Members are addressed by list index, which could go stale. | **No change.** The index is read from the same data the form was drawn from, and any write closes the form and redraws. |

## Tests after fixes

`npx playwright test` twice: **289 passed** both runs (273 existing + 16 in `admin-households.spec.js`). The two new
tests were run against the pre-fix `admin.js` and both failed.
