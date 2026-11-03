# T3 — Rate limits on join + admin unlock (replaces the edge gateway)

> Status: **APPROVED 2026-11-03** (Zee: D1 = B, D2 = retire pre-check, D3 = keep tar-pit).
> Source: `docs/qa/SYNTHESIS-2026-11-03.md` T3 (amended). Migration:
> `supabase/commons/migrations/20261105000000_t3_rate_limits.sql`. Tests: `tests/sql/s5_rate_limits.test.sql`.

## Why not the edge gateway

The synthesis framed T3 as per-IP limits in an edge function. Re-examined at plan time:

- **Bypassable unless direct access is revoked.** The anon key is public; a gateway only
  limits anything once the gated RPCs lose their anon/authenticated grants — which makes
  the edge function a single point of failure on the join path and forces RPC rewrites
  (user id passed by the gateway instead of read from the JWT).
- **Per-IP misfires for neighbours.** Carrier-grade NAT and shared household Wi-Fi put
  many residents behind one address; one invite → a burst of joins from few IPs.
- **IP addresses are personal data** — a new category to disclose (KG7).
- **The threat shrank in T2.** H1 made codes 10+ random chars (entropy is the guessing
  defence) and removed the tar-pit from the join paths.

## Decisions

| | Decision | Rationale |
|---|---|---|
| D1 | Account-keyed limits inside Postgres; no edge function | Every guarded path needs an account; strangers are limited upstream by Supabase Auth's per-IP sign-up/sign-in limits. No IPs stored. |
| D2 | Retire `jc_code_check` (grants revoked) | Behind sign-in it duplicates `jc_join`, which re-checks the code. Removes the only anon path that ran bcrypt. Code-first screen keeps the code locally and submits it with `jc_join` after sign-up. |
| D3 | Keep the 1.5 s admin tar-pit — now on **every** attempt (refined after security review) | Backstop if the lockout logic has a bug; a failure-only delay leaks the answer by timing, and a caller who cancels mid-sleep would roll back the count. Cost bounded (≤ 5 per account per 15 min, one in flight). |

## Design

- `jc_rate (user_id, bucket, window_start, n)` — RLS on, no grants, cascades with the user.
- **Count attempts, not failures**: increment before the code check. Counting failures lets
  parallel calls all read "0 so far". `join` clears on success (the caller is then a member and
  `jc_join` short-circuits); `admin_unlock` **never clears** — success is per scope, so an
  events admin's own valid unlock must not reset their guesses at the community code.
- **One attempt in flight per account per bucket**: `pg_try_advisory_xact_lock` —
  a parallel call gets `RATE_LIMITED` at once instead of queueing on the counter row
  (queueing would pin connections exactly like the tar-pit).
- **Failures return, not raise**: `{"error": "BAD_CODE" | "BAD_ADMIN"}` with HTTP 200, so
  the counter commits. Over the limit raises `RATE_LIMITED` (the count is already at the
  limit, so losing that increment changes nothing). One error code for both buckets.
- Limits: `join` 10 / hour; `admin_unlock` 5 / 15 min.

## Premortem

| # | Mode | Mitigation |
|---|---|---|
| 2 | Limiter silently never fires (counter rolled back) | R01/R05: failure inside an exception block, then assert the counter persisted. |
| 1 | Wrong thing counted → legit lock-out | R02–R04, R06–R07: off-by-one, refusal leaves the count at the limit, right code refused while limited, window expiry, join clears / admin doesn't, per-account isolation. |
| 6 | Grant change | `00_grants` allowlists updated (anon = `jc_config_get`, `jc_hit`); R08 asserts `jc_rate` + helpers are unreachable. |
| 2b | Auth per-IP limits live in the dashboard | Recorded in the manifest; re-checked on the launch list, raised before the invite. |
| 5 | Parallel attempts | Advisory lock (one in flight); atomic upsert. Cross-session behaviour is a manual two-tab check (KG11). |
| 7 | Rollback | Pre-invite: steps in the migration header. Post-invite: forward-only. |
| UX | Code typo discovered only after account creation | Accepted; retry with the same account works. Orphan auth users (never joined) → T4 cleanup. |

Reviews: `docs/qa/T3-review-2026-11-03.md` (database + security, both pre-apply).

## Client contract (for T5)

- `jc_join` / `jc_admin_unlock`: check `result.error` before using the result.
- `RATE_LIMITED` (HTTP 4xx error): show "too many attempts — try again later"; don't retry automatically.
- `jc_admin_unlock` always takes ~1.5 s (right or wrong) — show a spinner.
- Never call `jc_code_check`.
