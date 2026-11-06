# R0 — WebKit test lane — review (2026-11-06)

**Scope:** `tests/e2e/playwright.config.js` (new `webkit` project, `devices["iPhone 13"]`, trace on failure),
`tests/e2e/package.json` (`npm test` pinned to `--project=mobile`; new `test:webkit`),
`.github/workflows/commons-e2e.yml` (existing job runs `--project=mobile`; new non-blocking `e2e-webkit` job),
`docs/architecture.md` (CI line). No app code changed.

**Reviewer:** `code-reviewer` agent (read-only), 2026-11-06.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Med | Bare `npx playwright test` now runs both engines (~546 tests, red locally, needs WebKit installed) | **Fixed** — `npm test` pinned to Chromium; comment in config header; architecture.md CI line explains the three commands |
| 2 | Med | `continue-on-error` makes the WebKit job show green even when tests fail; "green twice" can't be read off the check | **Fixed** — failure step writes a visible line to the job summary. Rule: "green" = the Run step passed (check the log) |
| 3 | Med | Job name should be stable before it ever becomes a required check | **Fixed** — named `e2e-webkit` (no suffix). Whether `e2e` is a required check in branch protection: **cannot confirm, check in GitHub settings** (name unchanged) |
| 4 | Low | Failure artifact nearly empty without traces | **Fixed** — `trace: "retain-on-failure"` on the webkit project only |
| 5 | Low | Playwright WebKit on Linux/macOS is not iOS Safari | **Accepted** — real-iPhone checks stay in R8. Verified: the date-field test still passes WebKit with the `box-sizing` fix removed (global `*{box-sizing:border-box}` already applies; the iOS spill is the native control's intrinsic width), so this lane does not catch that bug |
| 6 | — | Security posture (pull_request, contents: read, no secrets, SHA pins identical), `install --with-deps webkit`, shared webServer, other configs | No material issue |
| 7 | — | Deterministic WebKit failure `event-day.spec.js:98` (app bug, not fixed here) | **Tracked for Zee** — see PR body; lane cannot reach "green twice" until fixed |

**Tests:** Chromium 273 / 273. WebKit 272 / 273 on two consecutive runs (same single failure both times).
