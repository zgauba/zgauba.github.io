-- T4c behaviour tests: orphan auth-user purge, photo-purge queue/done, single-use nonce gate,
-- maintenance section of the report. Community 'testville7' (not jubail).
-- Not testable here (needs HTTP + Storage API): the Edge Function itself — verified after
-- deploy by invoking it and reading jc_maintenance_log (see plan doc, Step 8c).

do $t$
declare
  o1 uuid := '00000000-0000-4000-8000-000000000701';  -- orphan, 40 days, never signed in → purged
  o2 uuid := '00000000-0000-4000-8000-000000000702';  -- orphan, 5 days → kept
  o3 uuid := '00000000-0000-4000-8000-000000000703';  -- member, 40 days → kept
  o4 uuid := '00000000-0000-4000-8000-000000000704';  -- orphan, 40 days, signed in 2 days ago → kept
  o5 uuid := '00000000-0000-4000-8000-000000000705';  -- orphan, 40 days, with a jc_rate row → purged (cascade)
  v jsonb; v_err text; n int; k int := 0; v_pet uuid; v_q text[]; v_nonce text;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email, created_at, last_sign_in_at) values
    (o1, 'o1@t4c.test', now() - interval '40 days', null),
    (o2, 'o2@t4c.test', now() - interval '5 days',  null),
    (o3, 'o3@t4c.test', now() - interval '40 days', null),
    (o4, 'o4@t4c.test', now() - interval '40 days', now() - interval '2 days'),
    (o5, 'o5@t4c.test', now() - interval '40 days', null);
  insert into jc_rate (user_id, bucket, window_start, n) values (o5, 'join', now() - interval '35 days', 10);
  insert into jc_communities (id, name_en, map_lat, map_lng) values ('testville7', 'Testville 7', 25.0, 55.0);
  insert into jc_accounts (user_id, community_id) values (o3, 'testville7');
  insert into jc_pets (community_id, kind, species, name, care_state)
  values ('testville7', 'stray', 'cat', 'Sandy', 'under_care') returning id into v_pet;
  insert into jc_pet_photos (path, community_id, pet_id, state, retired_at, created_at) values
    ('testville7/a-retired.jpg', 'testville7', v_pet, 'retired', now(), now() - interval '2 days'),
    ('testville7/b-pending-old.jpg', 'testville7', v_pet, 'pending', null, now() - interval '2 hours'),
    ('testville7/c-pending-new.jpg', 'testville7', v_pet, 'pending', null, now() - interval '5 minutes'),
    ('testville7/d-current.jpg', 'testville7', v_pet, 'current', null, now() - interval '3 days');

  -- ---------- C01 orphan purge: only the old, idle, never-joined account ----------
  n := jc_purge_orphan_users();
  if exists (select 1 from auth.users where id in (o1, o5)) then raise exception 'FAIL C01a old orphan kept'; end if;
  if exists (select 1 from jc_rate where user_id = o5) then raise exception 'FAIL C01d rate row survived'; end if;
  v_err := null; begin perform jc_purge_orphan_users(1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_DAYS' then raise exception 'FAIL C01e tiny window accepted: %', v_err; end if;
  if (select count(*) from auth.users where id in (o2, o3, o4)) <> 3 then raise exception 'FAIL C01b purged a keeper'; end if;
  if n < 2 or not exists (select 1 from jc_maintenance_log where job = 'orphan_users' and affected = n) then
    raise exception 'FAIL C01c run not logged (n=%)', n; end if;
  k := k + 5;

  -- ---------- C02 photo queue: retired + abandoned pending only, oldest first ----------
  v_q := jc_photo_purge_queue(1000);
  if not (v_q @> array['testville7/a-retired.jpg', 'testville7/b-pending-old.jpg'])
     or v_q && array['testville7/c-pending-new.jpg', 'testville7/d-current.jpg'] then
    raise exception 'FAIL C02 queue: %', v_q; end if;
  k := k + 1;

  -- ---------- C03 done: an error marks nothing but is logged; success marks only due paths ----------
  n := jc_photo_purge_done(array['testville7/a-retired.jpg'], 'storage: boom');
  if n <> 0 or (select purged_at from jc_pet_photos where path = 'testville7/a-retired.jpg') is not null then
    raise exception 'FAIL C03a error path marked rows'; end if;
  if not exists (select 1 from jc_maintenance_log where job = 'photo_purge' and error = 'storage: boom') then
    raise exception 'FAIL C03b error not logged'; end if;
  n := jc_photo_purge_done(array['testville7/a-retired.jpg', 'testville7/b-pending-old.jpg',
                                 'testville7/d-current.jpg'], null);
  if n <> 2 then raise exception 'FAIL C03c marked % (expected 2)', n; end if;
  if (select purged_at from jc_pet_photos where path = 'testville7/d-current.jpg') is not null then
    raise exception 'FAIL C03d a current photo was marked purged'; end if;
  if jc_photo_purge_queue(1000) && array['testville7/a-retired.jpg', 'testville7/b-pending-old.jpg'] then
    raise exception 'FAIL C03e purged paths re-queued'; end if;
  k := k + 5;

  -- ---------- C04 single-use nonce gate ----------
  v_nonce := jc_cron_nonce_new('photo_purge');
  if v_nonce !~ '^[0-9a-f]{48}$' then raise exception 'FAIL C04a nonce shape: %', v_nonce; end if;
  if jc_cron_nonce_use(null, 'photo_purge') or jc_cron_nonce_use(repeat('0', 48), 'photo_purge') then
    raise exception 'FAIL C04b unknown nonce accepted'; end if;
  if not jc_cron_nonce_use(v_nonce, 'photo_purge') then raise exception 'FAIL C04c fresh nonce refused'; end if;
  if jc_cron_nonce_use(v_nonce, 'photo_purge') then raise exception 'FAIL C04d nonce reusable'; end if;
  v_nonce := jc_cron_nonce_new('photo_purge');
  update jc_cron_nonces set created_at = now() - interval '11 minutes' where nonce = v_nonce;
  if jc_cron_nonce_use(v_nonce, 'photo_purge') then raise exception 'FAIL C04e expired nonce accepted'; end if;
  k := k + 5;

  -- ---------- C05 internals unreachable by residents; service role can reach the three ----------
  perform set_config('request.jwt.claims', json_build_object('sub', o3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_purge_orphan_users(); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05a purge callable: %', v_err; end if;
  v_err := null; begin perform jc_photo_purge_queue(1); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05b queue callable: %', v_err; end if;
  v_err := null; begin perform jc_cron_nonce_use(repeat('0', 48), 'photo_purge'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05c nonce check callable: %', v_err; end if;
  v_err := null; begin perform jc_cron_nonce_new('photo_purge'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05g nonce mint callable: %', v_err; end if;
  v_err := null; begin perform jc_admin_report_core(); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05d report core callable: %', v_err; end if;
  v_err := null; begin perform 1 from jc_maintenance_log; exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL C05e log readable: %', v_err; end if;
  execute 'reset role';
  if not (has_function_privilege('service_role', 'public.jc_photo_purge_queue(int)', 'execute')
      and has_function_privilege('service_role', 'public.jc_photo_purge_done(text[], text)', 'execute')
      and has_function_privilege('service_role', 'public.jc_cron_nonce_use(text, text)', 'execute'))
     or has_function_privilege('service_role', 'public.jc_cron_nonce_new(text)', 'execute') then
    raise exception 'FAIL C05f service-role grants wrong'; end if;
  k := k + 7;

  -- ---------- C06 report: maintenance section, still admin-only ----------
  perform jc_code_set('testville7', 'community', 'T4C-TV7-ADMIN-01');
  perform set_config('request.jwt.claims', json_build_object('sub', o3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_admin_report(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL C06a wrapper skipped authz: %', v_err; end if;
  perform jc_admin_unlock('T4C-TV7-ADMIN-01');
  v := jc_admin_report();
  if not (v ? 'snapshot' and v ? 'maintenance') then raise exception 'FAIL C06b keys: %', v; end if;
  if (v -> 'maintenance' -> 'photo_purge' ->> 'stale')::boolean is not false
     or (v -> 'maintenance' -> 'orphan_users' ->> 'stale')::boolean is not false then
    raise exception 'FAIL C06c fresh runs flagged stale: %', v -> 'maintenance'; end if;
  execute 'reset role';
  update jc_maintenance_log set at = now() - interval '2 days' where job = 'photo_purge';
  execute 'set local role authenticated';
  v := jc_admin_report();
  if (v -> 'maintenance' -> 'photo_purge' ->> 'stale')::boolean is not true then
    raise exception 'FAIL C06d silent purge not flagged'; end if;
  -- ... and the outside probe fails with it (stale, then erroring)
  execute 'reset role'; execute 'set local role anon';
  v := jc_health('testville7');
  if (v ->> 'maintenance_ok')::boolean is not false then raise exception 'FAIL C06e probe missed stale purge: %', v; end if;
  execute 'reset role';
  perform jc_photo_purge_done('{}', 'storage: still broken');
  execute 'set local role anon';
  if (jc_health('testville7') ->> 'maintenance_ok')::boolean is not false then raise exception 'FAIL C06f probe missed erroring purge'; end if;
  execute 'reset role';
  perform jc_photo_purge_done('{}', null);
  execute 'set local role anon';
  if (jc_health('testville7') ->> 'maintenance_ok')::boolean is not true then raise exception 'FAIL C06g recovered purge still failing'; end if;
  execute 'reset role';
  k := k + 7;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's7_cleanup: % checks passed', k;
end
$t$;
