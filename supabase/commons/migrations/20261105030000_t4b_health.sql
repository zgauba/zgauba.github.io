-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4b — the outside canary's probe. Plan: docs/plans/T4-instrumentation.md.
--
-- .github/workflows/commons-canary.yml calls this every 6 hours and fails (GitHub
-- emails the repo owner) when ok is false — or when the call itself fails, which also
-- catches a paused project. It is the detection half of T4: the in-database report
-- (jc_admin_report) has no screen until T5.
--
-- Deliberately anon (the workflow holds only the public key) and deliberately thin:
-- a yes/no and an age — no counts, names, or community data.
--
-- Rollback: drop function jc_health(text) and delete the workflow file.

create function public.jc_health(p_community text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_last timestamptz; v_active boolean;
begin
  if not exists (select 1 from jc_communities where id = p_community) then raise exception 'NOT_FOUND'; end if;
  select max(taken_at) into v_last from jc_snapshots where community_id = p_community;
  select bool_or(active) into v_active from cron.job where jobname = 'jc-hourly-snapshot';
  return jsonb_build_object(
    'ok', coalesce(v_active, false) and v_last is not null and v_last > now() - interval '3 hours',
    'cron_active', coalesce(v_active, false),
    'snapshot_age_minutes', floor(extract(epoch from now() - v_last) / 60));
end;
$$;
grant execute on function public.jc_health(text) to anon, authenticated;
