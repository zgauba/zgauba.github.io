-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4c — scheduled cleanup: never-joined auth users (KG12) and pet-photo objects (KG10).
-- Plan: docs/plans/T4-instrumentation.md. Requires T4a, T4b, pg_net (t4c_enable_pg_net).
--
-- 1. Orphan auth users: an account that signed up but never joined (no jc_accounts row),
--    is 30+ days old and hasn't signed in for 30 days is deleted. It grants nothing (T2),
--    holds no Commons data, and the offboarding trigger is a no-op for non-members.
--    Note: this also removes any hand-made non-member test/service account after 30 days.
-- 2. Pet photos: SQL cannot delete Storage objects (Storage blocks it), so cron calls the
--    jc-photo-purge Edge Function (supabase/commons/functions/jc-photo-purge), which asks
--    jc_photo_purge_queue for work, deletes via the Storage API, and reports back through
--    jc_photo_purge_done. Due: retired rows, and pending rows older than 1 hour (abandoned
--    uploads; the write window is 15 min).
--    Gate: the function is not JWT-gated (cron has no user). Each cron run mints a
--    SINGLE-USE nonce (jc_cron_nonce_new) and sends it as x-jc-cron; the function spends
--    it (jc_cron_nonce_use) — unused, < 10 min old — before doing anything. No long-lived
--    secret: pg_net's request queue is readable by anon at the grant level (Supabase
--    default, unrevocable; safe only because schema net is not API-exposed — canary
--    checks), so whatever travels through it must be worthless after one use.
--    Worst case with a fresh nonce: someone runs a cleanup early — every path it can touch
--    is already due for deletion.
-- Every run writes jc_maintenance_log (affected count + first error); the report and the
-- outside probe (jc_health.maintenance_ok) read it.
--
-- Rollback: cron.unschedule('jc-orphan-users'), cron.unschedule('jc-photo-purge'); restore
-- T4b's jc_health; drop jc_admin_report, rename jc_admin_report_core back and re-grant it;
-- drop the functions + tables below; delete the Edge Function.

-- ---------- 1. run log ----------
create table public.jc_maintenance_log (
  id        bigint generated always as identity primary key,
  job       text not null check (job in ('orphan_users', 'photo_purge')),
  at        timestamptz not null default now(),
  affected  int not null default 0,
  error     text check (error is null or char_length(error) <= 500)
);
alter table public.jc_maintenance_log enable row level security;
revoke all on table public.jc_maintenance_log from public, anon, authenticated;
create index jc_maintenance_log_job on public.jc_maintenance_log (job, at desc);

-- ---------- 2. orphan auth users (cron, as postgres; no grants) ----------
create function public.jc_purge_orphan_users(p_days int default 30) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_days is null or p_days < 7 then raise exception 'BAD_DAYS'; end if;
  with gone as (
    delete from auth.users u
     where u.created_at < now() - make_interval(days => p_days)
       and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(days => p_days)
       and not exists (select 1 from jc_accounts a where a.user_id = u.id)
    returning 1)
  select count(*) into n from gone;
  insert into jc_maintenance_log (job, affected) values ('orphan_users', n);
  return n;
end;
$$;
revoke execute on function public.jc_purge_orphan_users(int) from public, anon, authenticated;

-- ---------- 3. single-use cron nonces ----------
create table public.jc_cron_nonces (
  nonce       text primary key check (nonce ~ '^[0-9a-f]{48}$'),
  job         text not null check (job in ('photo_purge')),
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
alter table public.jc_cron_nonces enable row level security;
revoke all on table public.jc_cron_nonces from public, anon, authenticated;

-- Called inside the cron command (as postgres); prunes day-old nonces as it goes.
create function public.jc_cron_nonce_new(p_job text) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from jc_cron_nonces where created_at < now() - interval '1 day';
  insert into jc_cron_nonces (nonce, job) values (v, p_job);
  return v;
end;
$$;

-- Called by the Edge Function (service role): true once per fresh nonce, then never again.
create function public.jc_cron_nonce_use(p_nonce text, p_job text) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update jc_cron_nonces set used_at = now()
   where nonce = p_nonce and job = p_job and used_at is null
     and created_at > now() - interval '10 minutes';
  return found;
end;
$$;

-- ---------- 4. photo purge (Edge Function, service role) ----------
create function public.jc_photo_purge_queue(p_limit int default 100) returns text[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(path order by created_at), '{}') from (
    select path, created_at from jc_pet_photos
     where purged_at is null
       and (state = 'retired' or (state = 'pending' and created_at < now() - interval '1 hour'))
     order by created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 1000)) q;
$$;

-- Marks only paths that are still due (re-checked here), and logs the run.
-- p_error = the first Storage error, if any (then nothing is marked; next run retries).
create function public.jc_photo_purge_done(p_paths text[], p_error text) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int := 0;
begin
  if p_error is null then
    update jc_pet_photos set purged_at = now()
     where path = any(coalesce(p_paths, '{}')) and purged_at is null
       and (state = 'retired' or (state = 'pending' and created_at < now() - interval '1 hour'));
    get diagnostics n = row_count;
  end if;
  insert into jc_maintenance_log (job, affected, error) values ('photo_purge', n, left(p_error, 500));
  return n;
end;
$$;

revoke execute on function
  public.jc_cron_nonce_new(text), public.jc_cron_nonce_use(text, text),
  public.jc_photo_purge_queue(int), public.jc_photo_purge_done(text[], text)
from public, anon, authenticated;
grant execute on function
  public.jc_cron_nonce_use(text, text), public.jc_photo_purge_queue(int), public.jc_photo_purge_done(text[], text)
to service_role;

-- ---------- 5. schedules (UTC; re-running updates by name) ----------
select cron.schedule('jc-orphan-users', '15 3 * * *', 'select public.jc_purge_orphan_users()');
select cron.schedule('jc-photo-purge', '35 3 * * *', $cmd$
  select net.http_post(
    url     := 'https://qrpxfssdeeuzmsmlbtbu.supabase.co/functions/v1/jc-photo-purge',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-jc-cron', public.jc_cron_nonce_new('photo_purge')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cmd$);

-- ---------- 6. report: add a maintenance section ----------
-- T4a's report becomes the (ungranted) core; the public name wraps it. The core still
-- runs jc_assert_admin('community') itself, so authorization is unchanged.
-- A daily job that hasn't logged in 36 h is stale: the purge never firing is the silent
-- failure here (pg_cron logs "succeeded" as soon as the HTTP call is queued, whatever the
-- function then does), not a purge that ran and found nothing.
create function public.jc_maintenance_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_object_agg(j.job, jsonb_build_object(
           'last_at', l.at, 'affected', l.affected, 'error', l.error,
           'stale', l.at is not null and l.at < now() - interval '36 hours',
           'never_run', l.at is null))
    from (values ('orphan_users'), ('photo_purge')) j(job)
    left join lateral (select at, affected, error from jc_maintenance_log m
                        where m.job = j.job order by at desc limit 1) l on true;
$$;
revoke execute on function public.jc_maintenance_status() from public, anon, authenticated;

alter function public.jc_admin_report() rename to jc_admin_report_core;
revoke execute on function public.jc_admin_report_core() from public, anon, authenticated;
create function public.jc_admin_report() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return jc_admin_report_core() || jsonb_build_object('maintenance', jc_maintenance_status());
end;
$$;
grant execute on function public.jc_admin_report() to authenticated;

-- ---------- 7. outside probe: add maintenance_ok (same signature; grants carry over) ----------
-- ok now also requires every cleanup job to be fresh or erroring-free. A job that has
-- never run counts as ok (fresh install); the first runs are forced at deploy (plan
-- Step 8c), after which only "stale" or "last run errored" fail the canary.
create or replace function public.jc_health(p_community text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_last timestamptz; v_active boolean; v_maint boolean;
begin
  if not exists (select 1 from jc_communities where id = p_community) then raise exception 'NOT_FOUND'; end if;
  select max(taken_at) into v_last from jc_snapshots where community_id = p_community;
  select bool_and(active) and count(*) = 3 into v_active from cron.job
   where jobname in ('jc-hourly-snapshot', 'jc-orphan-users', 'jc-photo-purge');
  select coalesce(bool_and(not (s.value ->> 'stale')::boolean and s.value ->> 'error' is null), true)
    into v_maint from jsonb_each(jc_maintenance_status()) s;
  return jsonb_build_object(
    'ok', coalesce(v_active, false) and v_maint and v_last is not null and v_last > now() - interval '3 hours',
    'cron_active', coalesce(v_active, false),
    'maintenance_ok', v_maint,
    'snapshot_age_minutes', floor(extract(epoch from now() - v_last) / 60));
end;
$$;
