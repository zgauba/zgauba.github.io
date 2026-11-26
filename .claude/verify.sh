#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PROJECT VERIFY CONTRACT (harness-autonomy-plan B2, 2026-11-23; trimmed 2026-11-26 when Commons moved to
# zgauba/commons). Run by the verify gate (~/.claude/scripts/hooks/verify-gate.js) when Claude tries to finish a turn
# with uncommitted changes here. exit 0 = green, Claude may finish; anything else = Claude must fix and re-check.
#
# LOCAL ONLY. This repo has no app tests any more: the personal page, /jubail/ and the Halloween site are static.
#   1. repo-rules (R1–R9) on the working tree — about a second
#   2. the unit tests of the two CI gate scripts (repo-rules, secret-scan)
# Run it yourself: bash .claude/verify.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
node tests/ci/repo-rules.mjs || fail=1
node --test --test-reporter=dot tests/ci/repo-rules.test.mjs tests/ci/secret-scan.test.mjs >/dev/null 2>&1 \
  || { echo "gate unit tests: FAILED — run: node --test tests/ci/*.test.mjs"; fail=1; }
[ "$fail" = 0 ] && echo "verify: green" || echo "verify: red"
exit "$fail"
