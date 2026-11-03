-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T4c — scheduled cleanup: never-joined auth users (KG12) and pet-photo objects (KG10).
-- Plan: docs/plans/T4-instrumentation.md. Requires pg_cron (T4a) and pg_net (t4c_enable_pg_net).
--
-- 1. Orphan auth users: an account that signed up but never joined (no jc_accounts row),
--    is 30+ days old and hasn't signed in for 30 days is deleted. It grants nothing (T2),
--    holds no Commons data, and the offboarding trigger is a no-op for non-members.
-- 2. Pet photos: SQL cannot delete Storage objects (Storage blocks it), so cron calls the
--    jc-photo-purge Edge Function (supabase/commons/functions/jc-photo-purge), which asks
--    jc_photo_purge_queue for work, deletes via the Storage API, and reports back through
--    jc_photo_purge_done. Due: retired rows, and pending rows older than 1 hour (abandoned
--    uploads; the write window is 15 min).
--    The function is not JWT-gated (cron has no user); it requires the x-jc-cron header to
--    match the Vault secret `jc_cron_token`, checked server-side by jc_cron_token_ok.
--    Worst case if the token leaked: someone runs a cleanup early — every path it can touch
--    is already due for deletion.
-- Every run writes jc_maintenance_log (affected count + first error) — the report reads it.
--
-- Rollback: cron.unschedule('jc-orphan-users'), cron.unschedule('jc-photo-purge'); drop the
-- functions below, table jc_maintenance_log, and the Vault secret; delete the Edge Function.

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

-- ---------- 3. photo purge (called by the Edge Function with the service role) ----------
create function public.jc_cron_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_token is not null and exists (
    select 1 from vault.decrypted_secrets where name = 'jc_cron_token' and decrypted_secret = p_token);
$$;

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

-- Marks only paths that are still due (a path that became current meanwhile is skipped),
-- and logs the run. p_error = the first Storage error, if any (then nothing is marked).
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
  public.jc_cron_token_ok(text), public.jc_photo_purge_queue(int), public.jc_photo_purge_done(text[], text)
from public, anon, authenticated;
grant execute on function
  public.jc_cron_token_ok(text), public.jc_photo_purge_queue(int), public.jc_photo_purge_done(text[], text)
to service_role;

-- ---------- 4. the shared cron→function token (Vault; generated here, never typed) ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'jc_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'jc_cron_token',
                                'x-jc-cron header for jc-photo-purge (T4c)');
  end if;
end $$;

-- ---------- 5. schedules (UTC; re-running updates by name) ----------
select cron.schedule('jc-orphan-users', '15 3 * * *', 'select public.jc_purge_orphan_users()');
select cron.schedule('jc-photo-purge', '35 3 * * *', $cmd$
  select net.http_post(
    url     := 'https://qrpxfssdeeuzmsmlbtbu.supabase.co/functions/v1/jc-photo-purge',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-jc-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'jc_cron_token')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cmd$);

-- ---------- 6. report: add a maintenance section ----------
-- T4a's report becomes the (ungranted) core; the public name wraps it. The core still
-- runs jc_assert_admin('community') itself, so authorization is unchanged.
-- A daily job that hasn't logged in 36 h is flagged: the purge never firing is the
-- silent failure here, not a purge that ran and found nothing.
alter function public.jc_admin_report() rename to jc_admin_report_core;
revoke execute on function public.jc_admin_report_core() from public, anon, authenticated;
create function public.jc_admin_report() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  v := jc_admin_report_core();
  return v || jsonb_build_object('maintenance', (
    select jsonb_object_agg(j.job, jsonb_build_object(
             'last_at', l.at, 'affected', l.affected, 'error', l.error,
             'stale', l.at is null or l.at < now() - interval '36 hours'))
      from (values ('orphan_users'), ('photo_purge')) j(job)
      left join lateral (select at, affected, error from jc_maintenance_log m
                          where m.job = j.job order by at desc limit 1) l on true));
end;
$$;
grant execute on function public.jc_admin_report() to authenticated;
