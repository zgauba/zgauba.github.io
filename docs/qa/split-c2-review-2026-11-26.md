# Split step C2 — remove Commons from zgauba.github.io — review note (2026-11-26)

Contract: `docs/plans/SPLIT-commons-repo-contract.md` in **zgauba/commons** (rows 3, 4, 6).

## What changed
- Removed everything that now lives in zgauba/commons: `commons/`, `supabase/commons/`, `tests/e2e/`, `tests/sql/`, Commons CI scripts (affected-specs, design-guard + baseline, e2e-port test), workflows `commons-e2e`, `commons-canary`, `design-guard`, `.claude/app-check.json`, `.claude/skills/` (the Commons `shot` skill), and the Commons docs (`docs/plans`, `docs/qa`, `docs/incidents`, `docs/design*`, `docs/brand.md`). History stays in both repos.
- New root `404.html`: GitHub Pages serves it for any missing path. A `/commons…` path forwards to the same path on commons.ae with query + fragment (same mapping as the old `commons/assets/canonical.js`); any other path shows a plain not-found page linking to commons.ae and home. No phone number, no external resources.
- `CLAUDE.md`, `docs/architecture.md` (96 KB → 7 KB) and `.claude/verify.sh` trimmed to the personal page, `/jubail/`, the Halloween site and the remaining gates.
- Branch protection: `design-guard` removed from required checks (it guards Commons CSS and would fail its zero-output minimum here).

## Checks run locally
- `bash .claude/verify.sh` → green (repo-rules reads 3 migrations / 3 personal pages incl. 404.html / 4 credit-scope files; gate unit tests pass).
- 404 forwarding: checked after merge against live github.io (contract row 3).

## Disposition
No reviewer agent: deletions + a static page whose only logic is a one-line path mapping copied from a tested function.
