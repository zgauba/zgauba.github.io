# T5.2 PR B — per-event admins in the app — review (2026-11-04)

**Scope:** `commons/admin/` (event-admin landing, Admins panel, grant-link accept view, "Enter
another code"), `commons/assets/api.js` (`jcSafeNext` + grant link), `commons/events/events.js`
(per-event Admin badge), strings EN + AR, new `commons/_headers`; tests `admin.spec.js`,
`events.spec.js`, `backends.js`. Server side: PR #33 (`t5_2b_event_admins`, live).
**Reviewers:** `code-reviewer` (approve with fixes; no high) · `security-reviewer` (no critical / high).
**Tests:** 111 → **122**, two clean runs after fixes. Mutation-checked: removing event-admin entry,
the per-event badge rule, or the "keep other events on NOT_ADMIN" fix each turns the matching
tests red.

## Findings and dispositions

| # | Reviewer | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | code | Med | Any `NOT_ADMIN` (e.g. one event just closed) wiped all event-admin access → lock screen until reload | **Fixed** — `fail()` re-reads `jc_me_get` and lands wherever the person still belongs; test "one event's NOT_ADMIN… keeps the person's other events" (red on the old code) |
| 2 | code | Med | Make link: if the list refresh failed after the link was created, the one-time link was lost | **Fixed** — the link is drawn even when the refresh fails |
| 3 | code | Med | Make link / revoke results attributed to whichever panel was open when the reply arrived | **Fixed** — handlers capture the event id and drop results for a closed panel |
| 4 | code | Med | Exit / failure left a stale Admins panel open | **Fixed** — cleared on exit, on `NOT_ADMIN`, and when the close form opens (L7) |
| 5 | code | Low | Language switch on the accept view dropped a shown error | **Fixed** — `accErr` re-shown |
| 6 | code | Low | A revoked event admin keeps the UI until reload | **Accepted** — the server refuses every call; the first refusal now re-reads access (fix 1) |
| 7 | code | — | Tests: dual-state exit, one-event `NOT_ADMIN`, Codes absent for event admins, "shown once" via another action; unreadable save stub | **Fixed** — all added; stub rewritten in the `guardEv` style |
| 8 | code | — | Not covered: panel switching mid-request, copy / share, "No thanks", organizer opening a grant link | **Accepted** — logic covered by fix 3 / code reading; copy+share need clipboard permissions the stubbed suite doesn't grant |
| 9 | security | Med | Admin screens (Accept / Remove / Make link) can be framed — clickjacking. A `<meta>` CSP can't carry `frame-ancestors` | **Fixed** — `commons/_headers` (Cloudflare Pages): `frame-ancestors 'none'` + `X-Frame-Options: DENY` on every Commons page. Also closes the deferred PR #31 finding. Verify on commons.ae after deploy (`curl -sI`) |
| 10 | security | Med | A grant link waiting on sign-up / password reset may not survive a reset email on another device | **Accepted** — usability, not a leak (single use, 72 h); the community admin can make a new link |
| 11 | security | Low | Token visible in history / share sheet / github.io → commons.ae hop | **Accepted** — single use, 72 h, no-referrer on admin + account pages, `jc_hit` never sends the query string |

**Confirmed safe:** new `jcSafeNext` branch is anchored (no open redirect, no extra params);
nothing is accepted without a tap (link-preview bots can't burn a token); every new value goes
through `esc()`; messages render as text; only community admins see the Admins button (server
refuses everyone else).
