#!/bin/sh
# Assemble one paste for the Supabase SQL editor (JubailCommons):
#   [pending migrations...] + 00_grants + every slice test + zz_finish
# zz_finish always raises, so the whole paste rolls back — nothing persists.
# Usage:  tests/sql/build_dryrun.sh [migration.sql ...] > /tmp/dryrun.sql
#         (no args = test the schema that is already live)
set -e
dir=$(cd "$(dirname "$0")" && pwd)
echo "-- DRY RUN — JubailCommons only. Always ends in an error; nothing persists."
echo "-- Success looks like: ERROR: ALL_TESTS_PASSED (n checks)"
for m in "$@"; do echo; echo "-- ===== migration: $m"; cat "$m"; done
for t in "$dir"/00_grants.test.sql "$dir"/s[0-9]*_*.test.sql; do echo; echo "-- ===== test: $(basename "$t")"; cat "$t"; done
echo; cat "$dir/zz_finish.sql"
