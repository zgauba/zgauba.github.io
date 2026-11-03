-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4a step 1: enable Supabase Cron (per supabase.com/docs/guides/cron/install). No jobs.
-- Applied live 2026-11-03 as migration `t4a_enable_pg_cron`. Run ONCE: Supabase's event
-- trigger re-runs its cron grant script on every CREATE EXTENSION (even IF NOT EXISTS),
-- and a second run fails with "dependent privileges exist" — so never put this in a
-- dry-run paste or a later migration.
-- Exposure: cron functions keep PUBLIC execute, but anon/authenticated have no USAGE on
-- schema cron and it is not an API-exposed schema (00_grants G16 pins this).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
