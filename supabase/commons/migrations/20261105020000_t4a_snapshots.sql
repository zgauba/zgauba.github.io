-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4a — day-one instrumentation: hourly snapshots (pg_cron) + the community admin's
-- health report. Plan: docs/plans/T4-instrumentation.md.
--
-- The snapshot writes every module every hour, even while a module is off, with
-- `enabled` in its metrics: "the job ran and there was nothing to count" must look
-- different from "the job did not run". The report's snapshot age is the canary;
-- T4b adds the outside check that emails when it goes stale (nobody reads an
-- in-database report until the T5 Reports screen exists).
--
-- Failure counters (sequences) survive rolled-back dry runs, so they already hold
-- test noise; the report shows them minus a baseline recorded here. Dry runs run
-- after this point still add noise (known residual — run them sparingly post-launch).
--
-- Rollback: select cron.unschedule('jc-hourly-snapshot'); drop function
-- jc_admin_report(), jc_snapshot_run(timestamptz); drop table jc_counter_baseline.
-- Snapshot rows are harmless to keep.

-- Requires pg_cron: 20261105015000_t4a_enable_pg_cron.sql (applied first, on its own —
-- Supabase's event trigger re-runs its cron grant script on every CREATE EXTENSION,
-- even IF NOT EXISTS, and a second run fails on dependent privileges).

-- ---------- 1. counter baseline ----------
create table public.jc_counter_baseline (
  name   text primary key check (name in ('admin_fail', 'join_fail')),
  value  bigint not null,
  at     timestamptz not null default now()
);
alter table public.jc_counter_baseline enable row level security;
revoke all on table public.jc_counter_baseline from public, anon, authenticated;

insert into public.jc_counter_baseline (name, value)
select 'admin_fail', coalesce(last_value, 0) from pg_sequences
 where schemaname = 'public' and sequencename = 'jc_admin_fail_count'
union all
select 'join_fail', coalesce(last_value, 0) from pg_sequences
 where schemaname = 'public' and sequencename = 'jc_join_fail_count'
on conflict (name) do nothing;

-- ---------- 2. hourly snapshot (internal: run by cron as postgres; no grants) ----------
-- One row per (community, module, hour); a retried or double-fired run overwrites.
-- Returns the number of rows written.
create function public.jc_snapshot_run(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c record; v_bucket timestamptz := date_trunc('hour', p_at); n int := 0;
begin
  for c in select id, modules from jc_communities loop
    insert into jc_snapshots as s (community_id, module, bucket, metrics)
    values
    (c.id, 'homes', v_bucket, (
       select jsonb_build_object(
         'total', count(*),
         'occupied', count(*) filter (where exists (select 1 from jc_home_members m where m.home_id = h.id)),
         'pinned', count(*) filter (where h.lat is not null),
         'by_village', coalesce((select jsonb_object_agg(village_key, k) from
                (select village_key, count(*) k from jc_homes where community_id = c.id group by village_key) v), '{}'::jsonb))
         from jc_homes h where h.community_id = c.id)),
    (c.id, 'accounts', v_bucket, (
       select jsonb_build_object(
         'total', count(*),
         'joined_24h', count(*) filter (where a.joined_at > p_at - interval '24 hours'),
         'admins', (select count(distinct g.user_id) from jc_admin_grants g
                     where g.community_id = c.id and g.last_used_at > p_at - interval '60 days'))
         from jc_accounts a where a.community_id = c.id)),
    (c.id, 'events', v_bucket, jsonb_build_object(
       'enabled', coalesce((c.modules -> 'events' ->> 'enabled')::boolean, false),
       'live_events', (select count(*) from jc_events e where e.community_id = c.id and e.status = 'live'),
       'entries_in', (select count(*) from jc_event_entries en join jc_events e on e.id = en.event_id
                       where en.community_id = c.id and e.status = 'live'
                         and en.status = 'in' and en.archived_at is null))),
    (c.id, 'bookings', v_bucket, jsonb_build_object(
       'enabled', coalesce((c.modules -> 'bookings' ->> 'enabled')::boolean, false),
       'upcoming', (select count(*) from jc_bookings b where b.community_id = c.id
                     and b.status = 'booked' and b.starts_at > p_at),
       'next_24h', (select count(*) from jc_bookings b where b.community_id = c.id
                     and b.status = 'booked' and b.starts_at > p_at and b.starts_at <= p_at + interval '24 hours'),
       'created_24h', (select count(*) from jc_bookings b where b.community_id = c.id
                        and b.created_at > p_at - interval '24 hours'))),
    (c.id, 'pets', v_bucket, (
       select jsonb_build_object(
         'enabled', coalesce((c.modules -> 'pets' ->> 'enabled')::boolean, false),
         'owned', count(*) filter (where p.kind = 'owned'),
         'strays', count(*) filter (where p.kind = 'stray'),
         'missing', count(*) filter (where p.missing))
         from jc_pets p where p.community_id = c.id and p.status = 'active')),
    (c.id, 'traffic', v_bucket, jsonb_build_object(
       'hour', v_bucket - interval '1 hour',
       'pages', coalesce((select jsonb_object_agg(page, count) from jc_hits
                           where community_id = c.id and hour = v_bucket - interval '1 hour'), '{}'::jsonb)))
    on conflict (community_id, module, bucket)
      do update set metrics = excluded.metrics, taken_at = now();
    n := n + 6;
  end loop;
  return n;
end;
$$;
revoke execute on function public.jc_snapshot_run(timestamptz) from public, anon, authenticated;

-- :05 past every hour (UTC). Re-running this migration updates the job by name.
select cron.schedule('jc-hourly-snapshot', '5 * * * *', 'select public.jc_snapshot_run()');

-- ---------- 3. the community admin's health report ----------
create function public.jc_admin_report() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_last timestamptz; v_job record; v_fail record; v_last_run record;
        v_hits bigint; v_accounts bigint; v_bytes bigint;
begin
  v_comm := jc_assert_admin('community');
  select max(taken_at) into v_last from jc_snapshots where community_id = v_comm;
  select jobid, active into v_job from cron.job where jobname = 'jc-hourly-snapshot';
  if v_job.jobid is not null then
    select status, end_time into v_last_run from cron.job_run_details
     where jobid = v_job.jobid order by start_time desc limit 1;
    select end_time, left(return_message, 200) as msg into v_fail from cron.job_run_details
     where jobid = v_job.jobid and status = 'failed' order by start_time desc limit 1;
  end if;
  select coalesce(sum(count), 0) into v_hits from jc_hits
   where community_id = v_comm and hour > now() - interval '24 hours';
  select count(*) into v_accounts from jc_accounts where community_id = v_comm;
  select coalesce(sum((metadata ->> 'size')::bigint), 0) into v_bytes from storage.objects;

  return jsonb_build_object(
    'generated_at', now(),
    'snapshot', jsonb_build_object(
      'last_at', v_last,
      'age_minutes', floor(extract(epoch from now() - v_last) / 60),
      'stale', v_last is null or v_last < now() - interval '2 hours'),
    'cron', jsonb_build_object(
      'job_present', v_job.jobid is not null,
      'active', coalesce(v_job.active, false),
      'last_status', v_last_run.status,
      'last_run_at', v_last_run.end_time,
      'last_failure', case when v_fail.end_time is null then null
                           else jsonb_build_object('at', v_fail.end_time, 'message', v_fail.msg) end),
    'failures_since_baseline', jsonb_build_object(
      'admin_codes', (select coalesce(s.last_value, 0) - b.value from pg_sequences s, jc_counter_baseline b
                       where s.schemaname = 'public' and s.sequencename = 'jc_admin_fail_count' and b.name = 'admin_fail'),
      'join_codes',  (select coalesce(s.last_value, 0) - b.value from pg_sequences s, jc_counter_baseline b
                       where s.schemaname = 'public' and s.sequencename = 'jc_join_fail_count' and b.name = 'join_fail'),
      'baseline_at', (select min(at) from jc_counter_baseline),
      'scope', 'all communities'),
    'rate_limited_now', jsonb_build_object(
      'admin_unlock', (select count(*) from jc_rate r join jc_accounts a on a.user_id = r.user_id
                        where a.community_id = v_comm and r.bucket = 'admin_unlock'
                          and r.n >= 5 and r.window_start > now() - interval '15 minutes'),
      'join_pre_membership', (select count(*) from jc_rate r where r.bucket = 'join'
                                and r.n >= 10 and r.window_start > now() - interval '1 hour')),
    'state_changes_24h', coalesce((select jsonb_object_agg(field, k) from
        (select field, count(*) k from jc_state_log where community_id = v_comm
           and at > now() - interval '24 hours' group by field) x), '{}'::jsonb),
    'notices_open', (select count(*) from jc_admin_notices where community_id = v_comm and resolved_at is null),
    'traffic', jsonb_build_object(
      'hits_24h', v_hits,
      'counter_suspect', v_accounts > 0 and v_hits = 0),
    'storage', jsonb_build_object(
      'bytes', v_bytes,
      'limit_bytes', 1073741824,
      'pct', round(v_bytes * 100.0 / 1073741824, 1),
      'alert', v_bytes >= 0.8 * 1073741824,
      'scope', 'whole project'));
end;
$$;
grant execute on function public.jc_admin_report() to authenticated;
