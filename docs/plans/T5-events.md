# T5 — Events module (first module build)

> Status: **APPROVED 2026-11-03** (Zee: four-PR split; D1–D6 below).
> Reviews: `docs/qa/T5-0a-review-2026-11-03.md`.
> Source: `docs/qa/SYNTHESIS-2026-11-03.md` T5 ("per-module PRs; Playwright stub
> harness with the first module"). Use cases: A, B, C, D1–D3, D5, F1–F5, H1.

## Why a split

The backend is done (S1/S2 + T3/T4): every Events use case already has an RPC, so
T5 is frontend-only — **no migration expected**; if one turns out to be needed, stop
and re-plan. But it is ~3k LOC across ~40 RPCs, the first auth client, and the shared
frontend every later module builds on. Each PR ships alone; nothing is reachable by
residents until T6 (no codes set, all modules off).

| PR | Scope | Use cases |
|---|---|---|
| **T5.0a** Harness + auth | Playwright stub harness; vendored supabase-js; shared `api.js` (client, `rpc()` error contract, `jc_me` state); account page (sign in, join = code → account → `jc_join`, reset); CSP; landing regressions | A1–A3 |
| **T5.0b** Home + shell | Home claim (village, type, number), pin drop (vendored Leaflet), My Home (members, invite/accept, leave, delete, display name), tab bar + hub | B1, B2, H1 |
| **T5.1** Events — resident | List, detail (map + list), schema-driven signup, withdraw, "Our year", archived stats (Halloween 2026 baseline); CI job for the harness | C1–C3 |
| **T5.2** Event day + admin | Giant switch, supply, crowd reports/clear, safety, theme; admin unlock/exit, Admin tab, event editor/publish/signups/moderate/close, Reports panel (`jc_admin_report`) | D1–D3, D5, A4, F1–F5 |

Deferred out of T5: UC-D4 route + km counter (`route` flag stays off); admin Homes
queue (lands with the Community map module); UC-H2 rotation banner.

## Decisions

| # | Decision |
|---|---|
| D1 | One page per section (`commons/account/`, `commons/home/`, `commons/events/`, `commons/admin/`) sharing `commons/assets/`. No hash router, no build. All paths relative (commons.ae move is copy-and-go). |
| D2 | **supabase-js vendored** at `commons/assets/vendor/` (pinned, integrity checked against npm, served first-party — no CDN). Chosen over raw fetch for: token refresh across tabs/sleep, Storage (Pets photos), Realtime (event-day egress option), future auth methods. Every RPC still goes through our `rpc()` wrapper. |
| D3 | Leaflet 1.9.4 vendored (T5.0b). Tiles stay Esri/OSM. |
| D4 | `tests/e2e/` with its own dev-only `package.json` (Playwright pinned); `node_modules` ignored; stubbed RPC + auth. CI job added in T5.1, once stable. |
| D5 | Sign-up screen states the post-pivot privacy posture. The landing's old zero-PII `privacy_line` was **removed** 2026-11-03 (Zee: no public line until the privacy policy, T6/KG7). |
| D6 | Real-backend smoke test runs in a dedicated `e2e` community, never in `jubail` — `00_grants` aborts once jubail has residents. `?community=<slug>` is accepted on any page (server authz derives the community from membership, so it only picks which config/join code the screens use) and is always shown on the join step, never silent. |
| D7 | **Auth uses the PKCE flow** (PR #18 review): the default implicit flow adopts any session handed to it in a URL fragment (login CSRF). PKCE exchanges a reset `?code=` only in the browser that requested it — so reset links must be opened in that browser; the copy says so. |

## Client contract

- `rpc(name, args)` rejects on (a) a PostgREST error (message = the RAISE code, e.g.
  `MODULE_OFF`) and (b) a 200 whose body has an `error` key (T3: `BAD_CODE`,
  `BAD_ADMIN`). Callers never see a "successful" failure.
- `jc_me_get` drives routing: `NOT_SIGNED_IN` → account page; `NOT_MEMBER` → join
  code; `home: null` → claim (T5.0b); else → hub.
- `jc_event_signup` replaces payload + note: the form always sends the full payload,
  prefilled from `mine` (T5.1).

## Premortem (§0.5)

| # | Exposure | Mitigation |
|---|---|---|
| 1 | Partial signup wipes household note; household last-write-wins | Full-payload form + test; last-write-wins accepted (UC-C1) |
| 2 | 200+`{error}` treated as success; new-page hit counters silent | Single `rpc()` choke point, tested per code; every page calls `jc_hit`; report flags hits-vs-accounts |
| 2b | Hardcoded flags/villages/features; stale Pages JS | Read from server every load; no service worker; ≤10 min CDN, hotfix exception on event day |
| 6 | Session tokens in localStorage on the shared github.io origin | CSP (`script-src 'self'`, `connect-src` = the Supabase project) on every Commons page; `esc()` + string concat; Halloween site retirement removes the only other scripted pages; commons.ae at T6. Server grants unchanged (no migration) |
| 3 | Event-day polling egress (~40 KB `jc_event_get` × visitors × polls; upper bound ~420 MB/h at Halloween peak, gzip unconfirmed) | Poll only visible + live, ≥ 60 s; measure real response size in T5.2; slim RPC or Realtime broadcast as a separate migration if needed |
| 4 | Supabase Auth API drift | Pinned vendored client; real smoke test |
| 5 | Event closes mid-signup; parallel admin unlock | Server returns `SIGNUPS_CLOSED` / `RATE_LIMITED`; client renders them (stub tests); two-tab checks stay in KG11 |
| 7 | Bad screen ships | Frontend-only revert; module flags remain the kill switch |

## Out-of-band (dashboard) items this depends on

Reset-password redirect: the Auth **Site URL + redirect allowlist** must include the
account page (`…/commons/account/`) — add to the T6 launch list alongside the existing
Auth items in the manifest.
