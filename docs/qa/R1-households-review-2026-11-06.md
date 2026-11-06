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
