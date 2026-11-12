-- Cumulative permission surface for JubailCommons. Every slice that adds or
-- removes a callable function updates the two lists below — this file is the
-- single source of truth for "who can call what".

do $t$
declare
  k int := 0; n int; v_actual text[];
  v_anon_expected text[] := array['jc_config_get', 'jc_health', 'jc_hit'];  -- T3 retired jc_code_check; T4b jc_health
  v_auth_expected text[] := array[
    -- S1
    'jc_account_delete', 'jc_admin_code_rotate', 'jc_admin_exit', 'jc_admin_home_edit',
    'jc_admin_homes_list', 'jc_admin_invite_decide', 'jc_admin_log_list',
    'jc_admin_member_remove', 'jc_admin_notice_resolve', 'jc_admin_notices_list', 'jc_admin_unlock',
    'jc_config_get', 'jc_directory_list', 'jc_display_name_set', 'jc_home_claim',
    'jc_home_edit', 'jc_home_leave', 'jc_home_pin_set', 'jc_invite_accept', 'jc_invite_create',
    'jc_join', 'jc_me_get', 'jc_prefs_set',
    -- S2
    'jc_hit', 'jc_events_list', 'jc_event_get', 'jc_event_signup', 'jc_entry_withdraw',
    'jc_entry_live_set', 'jc_entry_report', 'jc_entry_reports_clear', 'jc_my_history',
    'jc_event_stats_get', 'jc_admin_events_list', 'jc_admin_event_save', 'jc_admin_event_publish',
    'jc_admin_event_signups', 'jc_admin_entries_list', 'jc_admin_entry_moderate', 'jc_event_close',
    -- S3
    'jc_facilities_list', 'jc_facility_day', 'jc_booking_create', 'jc_booking_cancel', 'jc_my_bookings', 'jc_my_bookings_past',
    'jc_admin_facilities_list', 'jc_admin_facility_save', 'jc_admin_facility_status',
    'jc_admin_facility_day', 'jc_admin_booking_cancel', 'jc_admin_booking_name_clear',
    'jc_admin_block_create', 'jc_admin_block_remove',
    -- S4
    'jc_pets_list', 'jc_pet_get', 'jc_pet_save', 'jc_pet_missing_set', 'jc_pet_archive',
    'jc_pet_sighting_add', 'jc_pet_photo_begin', 'jc_pet_photo_commit', 'jc_pet_photo_remove',
    'jc_admin_pets_list', 'jc_admin_stray_save', 'jc_admin_pet_care_add', 'jc_admin_pet_archive',
    'jc_admin_sighting_hide',
    -- T4
    'jc_admin_report', 'jc_health',
    -- T5.2 PR 3a
    'jc_admin_broadcast_set', 'jc_admin_home_pin_set', 'jc_admin_entry_pin_set',
    -- T5.2 PR A (per-event admins)
    'jc_event_admin_link_create', 'jc_event_admin_accept', 'jc_event_admins_list', 'jc_event_admin_revoke',
    -- T5.2 PR 3b (event kinds)
    'jc_admin_entry_spot_set',
    -- T5.3 (feedback)
    'jc_feedback_send', 'jc_feedback_list', 'jc_feedback_mark_read',
    -- T5.4 (coming soon)
    'jc_admin_event_announce',
    -- R2a (events audit)
    'jc_admin_broadcast_set_event',
    -- R2b-1 (organizer event-night actions)
    'jc_admin_entry_live_set', 'jc_admin_entry_withdraw', 'jc_entry_supply_clear',
    -- R4a (courts to spec: private bookings, effective rules)
    'jc_booking_book', 'jc_booking_privacy_set', 'jc_admin_booking_rules',
    -- R4a-2 (per-person module admins by invite link)
    'jc_module_admin_link_create', 'jc_module_admin_accept', 'jc_module_admins_list', 'jc_module_admin_revoke',
    -- R5a (pets to spec)
    'jc_admin_pet_care_set', 'jc_pets_group_get', 'jc_admin_pets_group_set',
    -- RM-a (renamable modules)
    'jc_admin_module_label_set'];
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

  -- storage (S4): one private bucket, exactly two policies, both delegating to jc_private;
  -- jc_private is never callable by anon, and holds only the two policy predicates
  if not exists (select 1 from storage.buckets where id = 'pet-photos' and not public
                   and file_size_limit = 2097152) then
    raise exception 'FAIL G11 pet-photos bucket missing, public, or uncapped'; end if;
  if (select array_agg(policyname::text || ':' || cmd order by policyname) from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname like 'jc\_%')
     is distinct from array['jc_pet_photos_insert:INSERT', 'jc_pet_photos_select:SELECT'] then
    raise exception 'FAIL G12 storage policies: %', (select array_agg(policyname::text || ':' || cmd) from pg_policies where schemaname = 'storage'); end if;
  -- and nothing (ours or not) grants UPDATE/DELETE on pet-photos objects
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception 'FAIL G15 an UPDATE/DELETE/ALL policy exists on storage.objects'; end if;
  select count(*) into n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'jc_private'
     and (has_function_privilege('anon', pr.oid, 'execute') or not pr.prosecdef
          -- R2a (security review S-L1): members run only the storage-policy checks
          or (has_function_privilege('authenticated', pr.oid, 'execute')
              and pr.proname not in ('pet_photo_can_read', 'pet_photo_can_write'))
          or not exists (select 1 from unnest(coalesce(pr.proconfig, '{}')) c where c like 'search_path=%'));
  if n <> 0 then raise exception 'FAIL G13 % jc_private functions anon/member-callable or not definer/pinned', n; end if;
  if has_schema_privilege('anon', 'jc_private', 'usage') then raise exception 'FAIL G14 anon can use jc_private'; end if;
  -- T4: pg_cron's functions carry PUBLIC execute; schema usage is what keeps them out of reach
  if has_schema_privilege('anon', 'cron', 'usage') or has_schema_privilege('authenticated', 'cron', 'usage') then
    raise exception 'FAIL G16 anon/authenticated can use schema cron'; end if;
  -- T4: anon keeps EXECUTE on net.http_* and privileges on net's queue tables (Supabase
  -- grants, unrevocable by postgres). Two pins keep that unreachable: no public function
  -- touches net/vault at all, and only the named monitoring functions read cron. (The
  -- third pin — net/cron/vault not API-exposed — is the canary's HTTP probe.)
  select count(*) into n from pg_proc pr where pr.pronamespace = 'public'::regnamespace
     and pr.prosrc ~* '\m(net|vault)\.';
  if n <> 0 then raise exception 'FAIL G17 % public functions reference net./vault.', n; end if;
  select count(*) into n from pg_proc pr where pr.pronamespace = 'public'::regnamespace
     and pr.prosrc ~* '\mcron\.' and pr.proname not in ('jc_admin_report', 'jc_admin_report_core', 'jc_health');
  if n <> 0 then raise exception 'FAIL G18 % unexpected public functions reference cron.', n; end if;
  k := k + 8;

  -- R4a: courts RPC signatures are frozen (create or replace only, never an overload)
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and (p.proname in ('jc_facilities_list', 'jc_facility_day', 'jc_booking_create', 'jc_booking_cancel',
                            'jc_my_bookings', 'jc_my_bookings_past', 'jc_booking_book', 'jc_booking_privacy_set')
              or p.proname like 'jc\_admin\_facilit%' or p.proname like 'jc\_admin\_block\_%'
              or p.proname like 'jc\_admin\_booking\_%'))
     <> 'jc_admin_block_create(p_facility uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_reason text), '
        'jc_admin_block_remove(p_block uuid), jc_admin_booking_cancel(p_booking uuid, p_reason text), '
        'jc_admin_booking_name_clear(p_booking uuid), jc_admin_booking_rules(), jc_admin_facilities_list(), '
        'jc_admin_facility_day(p_facility uuid, p_date date), jc_admin_facility_save(p_facility uuid, p_fields jsonb), '
        'jc_admin_facility_status(p_facility uuid, p_status text), '
        'jc_booking_book(p_facility uuid, p_starts timestamp with time zone, p_private boolean), '
        'jc_booking_cancel(p_booking uuid), '
        'jc_booking_create(p_facility uuid, p_starts timestamp with time zone, p_display_name text), '
        'jc_booking_privacy_set(p_booking uuid, p_private boolean), jc_facilities_list(), '
        'jc_facility_day(p_facility uuid, p_date date), jc_my_bookings(), jc_my_bookings_past()' then
    raise exception 'FAIL G19 a courts signature changed (or gained an overload): %',
      (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jc\_%book%'); end if;
  k := k + 1;

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
