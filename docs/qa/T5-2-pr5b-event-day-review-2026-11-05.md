# T5.2 PR 5b — event day — review (2026-11-05)

**Plan:** `docs/plans/T5-2-plan.md` → "PR 5 split (2026-11-05)". **Zee decisions:** event-day window = 2 h before
the start until the end (undated events: never); refresh every **2 minutes** (changed from the plan's 60 s) plus on
return to the app, with an "Updated HH:MM" line; household controls are **two-sided toggles with every value
visible — never a cycling button** ("🎃 Handing Out | ✕ Out of Treats"; "Open | Done" for non-treat events); supply
3 Plenty · 2 Some left · 1 Running low · 0 Almost out. **Chosen while building (open to change):** a start with no
end gets a 6 h window.

**Scope:** `events/events.js` (event-day block: `eventDay`, `liveHtml` + `wireLive`, `bannerHtml` + `paintDay`,
`act`, `reportHtml` + `report`, `repaint`, `refresh` + `tick`; homes drawn in their own layer `drawHomes` so a
refresh never moves the map; `headSub`), `events.css`, `strings.js` (EN + AR), tests (`specs/event-day.spec.js`,
stateful `dayBackend` in `specs/backends.js`, also served to `/shot` as `events/?id=6666…`). **No migration**: the
three RPCs already exist; their live definitions were compared with
`supabase/commons/migrations/20261103180000_s2_events.sql` (identical), granted to `authenticated` only.

**Payload measured (live, `jc_event_get` shape):** event ≈ 1.7 KB + ≈ 365 B per home → ≈ 47 KB at all 124 homes,
uncompressed. 200 phones × 30 refreshes/h ≈ 280 MB/h worst case; 124 households × 3 h ≈ 0.5 GB per event night.
The free-tier egress allowance was not verified (security reviewer recalls 5 GB/month — check). No slimmer RPC needed.

**Reviewers:** code-reviewer + security-reviewer, on commit a278448 (pre-fix).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S — | — | XSS in the new HTML (switch, banner, report button, supply line, popup `setContent`, `data-report`); cross-household writes; reporter anonymity; fixtures | **None found** — every interpolation through `esc()` or `textContent`; live_set / reports_clear key on the caller's home via `jc_me()`; the report RPC returns only `{reported:true}` and the client sees only a count + the 3+ boolean |
| F1 | Low | Refresh egress at peak; every phone on the same 2-minute beat | **Fixed (partly)** — ±10 % jitter (`tick`). Volume accepted (estimate above) |
| F2 | Low | Reporter identity is stored (`jc_entry_reports.reporter*`, `jc_state_log.actor`); anonymity relies on no RPC ever returning it | **Accepted / tracked** — checked: no RPC in any later migration reads them (only the snapshot counts by field). Rule for future admin RPCs: never return reporter / actor for reports → next events DB PR |
| F3 | Low | `jc_entry_reports_clear` has no `jc_home_hold` (live_set does); a household can keep clearing its own reports | **Deferred** → next events DB PR (parity). By design the household is trusted |
| F4 | Info | The household sees how many neighbors reported (not who) | **Accepted** — inherent to the private banner |
| R1 | Med | `show()` removed the map before clearing popup state; `popupclose` fires during teardown and could draw onto the dying map | **Fixed** — state cleared first; test: language switch with a popup open and a redraw waiting (fails without the fix) |
| R2 | Med | `acting` / `refreshing` reset in a `.then` that a throw would skip → controls dead for the session | **Fixed** — `.finally` |
| R3 | Med | Every refresh rebuilt My Sign-Up (focus lost, a tap mid-press could be lost) | **Fixed** — rebuilt only when this home's state changed; focus returns to the tapped side / level (noted before the buttons are disabled — found by the new test) |
| R4 | Low | Withdraw / sign-up didn't invalidate a refresh in flight | **Fixed** — `gen++` |
| R5 | Low | `ALREADY_DONE` / `NOT_FOUND` on a report left the pin stale | **Fixed** — refreshes. (`setContent` freezing that one popup until the next redraw: accepted — it shows the thank-you) |
| R6 | Low | The "Updated" line appearing / wrapping didn't refit the map | **Fixed** — `paintDay` reports it |
| R7 | Low | Controls stayed after the event ended (no redraw once the window closed) | **Fixed** — `tick` redraws when the window opens or closes; test |
| T1 | Med | "Map doesn't move" test didn't move the map first | **Fixed** — moves it, compares zoom + centre (fails if a refresh rebuilds the map) |
| T2 | Med | Popup test didn't prove a refresh ran | **Fixed** — polls the stub's request count |
| T3 | Med | No test for a refresh answer landing after a tap | **Fixed** — stub can hold a reply; test fails without the `gen` check |
| T4 | Low | Missing: language switch mid-event, window boundaries | **Fixed** — language-switch test, window-ends test (+ existing 5 h / 90 min cases) |

**Tests:** stubbed Playwright **234 / 234** twice (215 after 5a.1; 19 new in `event-day.spec.js`). Mutation checks —
each guard removed makes its test fail: no-redraw-while-editing, popup deferral, `gen` race guard, map
rebuild on refresh, teardown order (R1), focus restore. Screens checked with `/shot` (My Sign-Up EN + AR, map EN);
the map shot led to slimmer banner buttons.
