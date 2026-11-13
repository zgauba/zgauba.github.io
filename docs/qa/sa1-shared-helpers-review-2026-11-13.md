# SA-1 — shared page helpers into `api.js` · review 2026-11-13

From the Commons structural audit (`docs/qa/STRUCTURAL-AUDIT-2026-11-13.md`, "SA-1"). Tier 2 (screen logic, no data/RPC).
Reviewer: `code-reviewer` (read-only) — **APPROVE**, 0 critical / high / medium.

## What changed
- `commons/assets/api.js` now holds the one copy of the page helpers every page re-declared:
  - messages: `jcMsgBox`, `jcSay`, `jcShowOk`, `jcShowErr`, `jcErrTextFor`, `jcShowErrFor`;
  - wiring and state: `jcBusy`, `jcOn`, `jcEach`, `jcSetUrl`;
  - small checks: `jcObj`, `jcFinite`, `jcHasPos`, `jcIsAr`, `jcModuleOn`, `jcHM`.
  
  They live in `api.js`, not `nav.js`, because Account loads `api.js` but not `nav.js`. `jcTzToday` now calls
  `jcDateOf` (one Intl block).
- In the pages (pets, bookings, events, home, account, admin), the short names stay as `var x = jcX` aliases, so
  call sites are unchanged.
  - Module error text (`ptMsg` / `bkMsg` / `ctMsg` / `ctErrText` / `cdMsg` / `adMsg` / the Names error / the Pets photo
    error) now goes through `jcShowErrFor` / `jcErrTextFor`. Admin's `hNum` is now `jcFinite`.
  - Every inline `history.replaceState` in the pages is now `jcSetUrl`. The two that drop the `#fragment` use
    `jcSetUrl(location.search.slice(1) || null)`.
- Intended behaviour changes, accepted in the audit plan:
  - every success or error message now scrolls into view ("nearest");
  - Account's messages gain the null guard;
  - admin's `each` takes the optional event.

## Findings
| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Low | `jcHomeFull` / `jcMyHome` not extracted | **Deferred.** The remaining `hasHome()` / `myHome()` are tiny and haven't drifted; the Pets card variant stays by plan. Revisit in SA-3. |
| 2 | Low | Inline error-text copies left in admin (`adm_mn_err_`, `cd_err_`, `adm_ad_err_`) and pets (photo error) | **Fixed.** All use `jcShowErrFor` / `jcErrTextFor`. `hhWrite`'s per-branch handling is kept, as planned. |
| 3 | Low | Admin `hNum` duplicates `jcFinite` | **Fixed** (alias). |

The reviewer also checked:
- behaviour equivalence of every swap;
- hoisting: no alias is called before its line runs, and the admin `INVITE` code calls `jcSetUrl` directly;
- no shadowing;
- load order: every page loads `strings.js` then `api.js` before its own script.

## Tests
- Full suite, both browsers: **1188/1188** (before the leftover fixes).
- After the leftover fixes, the admin* and pets specs on both browsers: **466/466**.
