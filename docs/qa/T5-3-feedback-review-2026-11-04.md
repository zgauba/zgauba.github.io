# T5.3 Feedback — review (2026-11-04)

**Scope:** migration `supabase/commons/migrations/20261105090000_t5_3_feedback.sql` (JubailCommons) +
test slice `tests/sql/s11_feedback.test.sql` + `00_grants` allowlist; app: My Home → Account feedback form
(`home/home.js`, `home.css`), hub footer link (`assets/landing.js`), owner inbox (`admin/admin.js`,
`admin.css`), strings EN + AR, `tests/e2e/specs/feedback.spec.js` + stubs.
**Decisions (Zee, 2026-11-04):** only the platform owner reads feedback (not community admins); every
message linked to the home (disclosed on the form); email alert to the owner (Resend).

**Reviewers:** database-reviewer + security-reviewer (gate, before apply), on the first draft.

## Security review — no Critical / High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S1 | Med | Up to 144 emails/day (one per 10-min run) — Resend free-tier quota; could starve other mail on the same account | **Fixed** — at most one email an hour (throttle on the last logged send). Use a separate, sending-only Resend key |
| S2 | Med | Per-account limit only; a flood could push real feedback out of the 200-row list | **Fixed** — also 10/day per home, 100/day per community (`RATE_LIMITED`); list is unread first; tests F11a/b |
| S3 | Med/Low | Email failure silent (`notified_at` set before delivery; pg_net is async) | **Fixed** — each send's pg_net request id is logged (`jc_maintenance_log.ref`); the next run reads `net._http_response`, logs a failure once and re-queues that batch; tests F07j–l |
| S4 | Low | Authorization header readable in `net.http_request_queue` by anon/authenticated (confirmed: Supabase grants SELECT) | **Accepted** — Known Gap 14: schema `net` is not API-exposed (canary checks every 6 h); the row lives seconds; sending-only key limits blast radius. Recorded in the migration header |
| S5 | Low | Resident-typed building could inject line breaks into the email; label could exceed 120 | **Fixed** — control characters stripped, `left(…, 120)`, each part `coalesce`d. (Not separately tested: a villa can't carry a building; apartments' building input is already single-line in the app) |
| S6 | Low | Unread kept forever; Resend sees home labels | **Fixed** — unread purged after 24 months (test F08). Resend receives counts + home labels only, never the text; the owner is the only recipient |
| S7 | Low | Harden the Vault reader | **Fixed** — `feedback_notify` runs with `search_path = ''`, everything schema-qualified |

Verified by the reviewer: RLS + revoked grants on both tables; only owner-checked RPCs read feedback;
`jc_is_owner` / `jc_purge_feedback` / `feedback_notify` not callable; key never logged (cron command is
literal; maintenance log stores counts; responses don't hold request headers); JSON-safe email body; input
size bounded before regex work; rate counter never runs past the limit.

## Database review — no High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| D1 | Med | Rollback dropped `jc_is_owner` before restoring `jc_me_get` (app-wide breakage); constraint restores fail if new values exist | **Fixed** — ordered rollback in the header incl. deleting `feedback%` log rows / `feedback` rate rows first |
| D2 | Med | Delivery failure invisible | **Fixed** (= S3) |
| D3 | Med | 200-row cap could strand old unread items forever | **Fixed** — unread first (inner + outer order) |
| D4 | Low | Constraint swaps: lock wait; `if exists` inconsistency | **Fixed** — `set local lock_timeout = '3s'`; `if exists` on both |
| D5 | — | Notify race | No issue (single UPDATE…RETURNING; pg_cron doesn't overlap a job) |
| D6 | Low | Missing Vault secrets → silent | **Accepted** — the inbox badge is the source of truth; nothing is lost (rows wait unnotified) |
| D9 | Low | No indexes on the FKs | **Fixed** — `(community_id, created_at)`, partial `(home_id, created_at)` (also serve the caps) |
| D11 | Info | Owner must also be a member (`jc_me()`) | **Noted** for the owner-row step |
| D14 | Low | Label null if a part is null | **Fixed** (= S5) |
| — | Info | STABLE list, cron idempotency, vault access as postgres, G17 pin | Checked, no change |

## Tests

- SQL dry run (rolls back): **ALL_TESTS_PASSED (608 checks)** — was 564 live; s11 = 44 checks. Nothing
  persisted (tables, functions, cron jobs, constraints, test community/users, Vault, net queue, history row: all absent).
- Playwright (stubbed): **160 passed ×2** (154 + 6 feedback).
