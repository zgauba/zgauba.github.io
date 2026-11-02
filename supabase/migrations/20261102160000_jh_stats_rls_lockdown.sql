-- jh_stats was created (2026-10-31) without RLS, so Supabase's default grants
-- left anon/authenticated with full DML on it. Lock it down to the same
-- deny-all posture as jh_homes/jh_settings: access only via the
-- security-definer RPCs (jh_stats_list) and the pg_cron snapshot job.
alter table public.jh_stats enable row level security;
revoke all on table public.jh_stats from anon, authenticated;

-- jh_snapshot() is called only by the pg_cron job (which runs as the function
-- owner); no browser client calls it, so public execute is pure write-spam surface.
-- PUBLIC included: Postgres grants EXECUTE to PUBLIC on new functions by default,
-- and revoking only anon/authenticated would leave that path open.
revoke execute on function public.jh_snapshot() from public, anon, authenticated;
