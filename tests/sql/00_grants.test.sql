-- Cumulative permission surface for JubailCommons. Every slice that adds or
-- removes a callable function updates the two lists below — this file is the
-- single source of truth for "who can call what".

do $t$
declare
  k int := 0; n int; v_actual text[];
  v_anon_expected text[] := array['jc_code_check', 'jc_config_get', 'jc_hit'];
  v_auth_expected text[] := array[
    -- S1
    'jc_account_delete', 'jc_admin_code_rotate', 'jc_admin_exit', 'jc_admin_home_edit',
    'jc_admin_home_suppress', 'jc_admin_homes_list', 'jc_admin_invite_decide', 'jc_admin_log_list',
    'jc_admin_member_remove', 'jc_admin_notice_resolve', 'jc_admin_notices_list', 'jc_admin_unlock',
    'jc_code_check', 'jc_config_get', 'jc_directory_list', 'jc_display_name_set', 'jc_home_claim',
    'jc_home_edit', 'jc_home_leave', 'jc_home_pin_set', 'jc_invite_accept', 'jc_invite_create',
    'jc_join', 'jc_me_get', 'jc_prefs_set',
    -- S2
    'jc_hit', 'jc_events_list', 'jc_event_get', 'jc_event_signup', 'jc_entry_withdraw',
    'jc_entry_live_set', 'jc_entry_report', 'jc_entry_reports_clear', 'jc_my_history',
    'jc_event_stats_get', 'jc_admin_events_list', 'jc_admin_event_save', 'jc_admin_event_publish',
    'jc_admin_event_signups', 'jc_admin_entries_list', 'jc_admin_entry_moderate', 'jc_event_close',
    -- S3
    'jc_facilities_list', 'jc_facility_day', 'jc_booking_create', 'jc_booking_cancel', 'jc_my_bookings',
    'jc_admin_facilities_list', 'jc_admin_facility_save', 'jc_admin_facility_status',
    'jc_admin_facility_day', 'jc_admin_booking_cancel', 'jc_admin_booking_name_clear',
    'jc_admin_block_create', 'jc_admin_block_remove'];
begin
  -- Pre-launch suite: fixtures are written into 'jubail' and rolled back. Refuse to run
  -- once real residents exist — post-launch tests must move to a test community.
  if exists (select 1 from jc_accounts where community_id = 'jubail')
     or exists (select 1 from jc_homes where community_id = 'jubail') then
    raise exception 'ABORT: jubail has real residents — this suite is pre-launch only';
  end if;

  select array_agg(pr.proname::text order by pr.proname) into v_actual
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and has_function_privilege('anon', pr.oid, 'execute');
  if v_actual is distinct from (select array_agg(x order by x) from unnest(v_anon_expected) x) then
    raise exception 'FAIL G01 anon-executable functions: %', v_actual; end if;
  select array_agg(pr.proname::text order by pr.proname) into v_actual
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and has_function_privilege('authenticated', pr.oid, 'execute');
  if v_actual is distinct from (select array_agg(x order by x) from unnest(v_auth_expected) x) then
    raise exception 'FAIL G02 authenticated-executable functions: % (expected %)',
      (select array_agg(x) from unnest(v_actual) x where x <> all(v_auth_expected)),
      (select array_agg(x) from unnest(v_auth_expected) x where x <> all(coalesce(v_actual, '{}'))); end if;
  k := k + 2;

  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', cl.oid, 'select,insert,update,delete')
       or has_table_privilege('authenticated', cl.oid, 'select,insert,update,delete'));
  if n <> 0 then raise exception 'FAIL G03 % tables grant anon/authenticated access', n; end if;
  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind = 'S'
     and (has_sequence_privilege('anon', cl.oid, 'usage,select,update')
       or has_sequence_privilege('authenticated', cl.oid, 'usage,select,update'));
  if n <> 0 then raise exception 'FAIL G04 % sequences grant access', n; end if;
  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind = 'r' and not cl.relrowsecurity;
  if n <> 0 then raise exception 'FAIL G05 % tables without RLS', n; end if;
  k := k + 3;

  -- every callable function is SECURITY DEFINER with a pinned search_path
  select count(*) into n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and (has_function_privilege('anon', pr.oid, 'execute') or has_function_privilege('authenticated', pr.oid, 'execute'))
     and (not pr.prosecdef or not exists (select 1 from unnest(coalesce(pr.proconfig, '{}')) c where c like 'search_path=%'));
  if n <> 0 then raise exception 'FAIL G08 % callable functions lack security definer / search_path', n; end if;
  -- no reference to a user may block account deletion (jc_account_delete = delete from auth.users)
  select count(*) into n from pg_constraint co
   where co.contype = 'f' and co.confrelid = 'auth.users'::regclass
     and co.connamespace = 'public'::regnamespace and co.confdeltype not in ('n', 'c');
  if n <> 0 then raise exception 'FAIL G09 % FKs to auth.users would block account deletion', n; end if;
  select count(*) into n from pg_constraint co
    join pg_attribute at on at.attrelid = co.conrelid and at.attnum = any(co.conkey)
   where co.contype = 'f' and co.confrelid = 'auth.users'::regclass
     and co.connamespace = 'public'::regnamespace and co.confdeltype = 'n' and at.attnotnull;
  if n <> 0 then raise exception 'FAIL G10 % SET NULL user references are NOT NULL', n; end if;
  k := k + 3;

  -- anything created after the migrations (next slice, or by hand) must start closed
  execute 'create function public.jc_zz_probe() returns int language sql as $f$ select 1 $f$';
  execute 'create table public.jc_zz_probe_t (x int)';
  if has_function_privilege('anon', 'public.jc_zz_probe()', 'execute')
     or has_function_privilege('authenticated', 'public.jc_zz_probe()', 'execute') then
    raise exception 'FAIL G06 new functions default to callable'; end if;
  if has_table_privilege('anon', 'public.jc_zz_probe_t', 'select')
     or has_table_privilege('authenticated', 'public.jc_zz_probe_t', 'select') then
    raise exception 'FAIL G07 new tables default to readable'; end if;
  execute 'drop function public.jc_zz_probe()';
  execute 'drop table public.jc_zz_probe_t';
  k := k + 2;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice '00_grants: % checks passed', k;
end
$t$;
