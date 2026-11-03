-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4c step 1: enable pg_net (async HTTP from Postgres) so cron can call the
-- jc-photo-purge Edge Function. Applied live 2026-11-03 as migration `t4c_enable_pg_net`.
-- Run ONCE, on its own (same reason as pg_cron: extension event triggers re-run grants).
create extension if not exists pg_net;
