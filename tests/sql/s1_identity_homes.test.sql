-- T2 / S1 tests — run AFTER the S1 migration text, in the same execute_sql call,
-- against JubailCommons (tables empty). The block always ends by raising, so the
-- whole script (migration included) rolls back:
--   success  →  ERROR: ALL_TESTS_PASSED (n checks)
--   failure  →  ERROR: FAIL Txx: ...
-- Impersonation: request.jwt.claims + SET LOCAL ROLE, exactly what PostgREST does.
-- Side effect that survives rollback by design: the fail-count sequences advance
-- (join ~3, admin ~3 per run).

do $t$
declare
  A uuid := '00000000-0000-4000-8000-00000000000a';
  B uuid := '00000000-0000-4000-8000-00000000000b';
  C uuid := '00000000-0000-4000-8000-00000000000c';
  D uuid := '00000000-0000-4000-8000-00000000000d';
  E uuid := '00000000-0000-4000-8000-00000000000e';
  F uuid := '00000000-0000-4000-8000-00000000000f';
  G uuid := '00000000-0000-4000-8000-000000000010';
  H uuid := '00000000-0000-4000-8000-000000000011';
  I uuid := '00000000-0000-4000-8000-000000000012';
  J uuid := '00000000-0000-4000-8000-000000000013';
  v jsonb; v_err text; v_tok text; v_code text; n int; k int := 0;
  v_home uuid; v_home2 uuid; v_inv uuid; v_actual text[]; v_join text; v_t timestamptz;
  v_auth_expected text[] := array[
    'jc_account_delete','jc_admin_code_rotate','jc_admin_exit','jc_admin_home_edit',
    'jc_admin_home_suppress','jc_admin_homes_list','jc_admin_invite_decide','jc_admin_log_list',
    'jc_admin_member_remove','jc_admin_notice_resolve','jc_admin_notices_list',
    'jc_admin_unlock','jc_code_check','jc_config_get','jc_directory_list',
    'jc_display_name_set','jc_home_claim','jc_home_edit','jc_home_leave',
    'jc_home_pin_set','jc_invite_accept','jc_invite_create','jc_join','jc_me_get','jc_prefs_set'];
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (A, 'alice@example.test'), (B, 'bob@example.test'), (C, 'cara@example.test'),
    (D, 'dan@example.test'), (E, 'eve@example.test'), (F, 'fay@example.test'),
    (G, 'gus@example.test'), (H, 'hal@example.test'), (I, 'ida@example.test'),
    (J, 'jay@example.test');
  insert into jc_communities (id, name_en, map_lat, map_lng) values ('testville', 'Testville', 25.0, 55.0);
  insert into jc_villages (community_id, key, name_en) values ('testville', 'north', 'North');
  perform jc_code_set('jubail', 'join', 'join-test-1');
  perform jc_code_set('jubail', 'community', 'Admin Test 1');
  perform jc_code_set('jubail', 'events', 'events-test-1');
  perform jc_code_set('testville', 'join', 'tv-join-test');
  v_err := null; begin perform jc_code_set('jubail', 'pets', '123456'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'CODE_TOO_SHORT' then raise exception 'FAIL T00 short code accepted: %', v_err; end if;
  if char_length(jc_code_bootstrap('testville', 'community')) <> 10 then raise exception 'FAIL T00b bootstrap'; end if;
  k := k + 2;

  -- ---------- T01 function allowlist ----------
  select array_agg(pr.proname::text order by pr.proname) into v_actual
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and has_function_privilege('anon', pr.oid, 'execute');
  if v_actual is distinct from (select array_agg(x order by x) from unnest(array['jc_code_check','jc_config_get']) x) then
    raise exception 'FAIL T01a anon-executable functions: %', v_actual; end if;
  select array_agg(pr.proname::text order by pr.proname) into v_actual
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and has_function_privilege('authenticated', pr.oid, 'execute');
  if v_actual is distinct from (select array_agg(x order by x) from unnest(v_auth_expected) x) then
    raise exception 'FAIL T01b authenticated-executable functions: %', v_actual; end if;
  k := k + 2;

  -- ---------- T02 no table/sequence privileges; RLS everywhere; future functions closed ----------
  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', cl.oid, 'select,insert,update,delete')
       or has_table_privilege('authenticated', cl.oid, 'select,insert,update,delete'));
  if n <> 0 then raise exception 'FAIL T02a % tables grant anon/authenticated access', n; end if;
  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind = 'S'
     and (has_sequence_privilege('anon', cl.oid, 'usage,select,update')
       or has_sequence_privilege('authenticated', cl.oid, 'usage,select,update'));
  if n <> 0 then raise exception 'FAIL T02b % sequences grant access', n; end if;
  select count(*) into n from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public' and cl.relkind = 'r' and not cl.relrowsecurity;
  if n <> 0 then raise exception 'FAIL T02c % tables without RLS', n; end if;
  -- a function created AFTER this migration (S2-S4, or by hand) must start closed
  execute 'create function public.jc_zz_probe() returns int language sql as $f$ select 1 $f$';
  execute 'create table public.jc_zz_probe_t (x int)';
  if has_function_privilege('anon', 'public.jc_zz_probe()', 'execute')
     or has_function_privilege('authenticated', 'public.jc_zz_probe()', 'execute') then
    raise exception 'FAIL T02d new functions default to callable'; end if;
  if has_table_privilege('anon', 'public.jc_zz_probe_t', 'select')
     or has_table_privilege('authenticated', 'public.jc_zz_probe_t', 'select') then
    raise exception 'FAIL T02e new tables default to readable'; end if;
  execute 'drop function public.jc_zz_probe()';
  execute 'drop table public.jc_zz_probe_t';
  k := k + 5;

  -- ---------- T03 direct reads denied (anon + authenticated) ----------
  execute 'set local role anon';
  v_err := null; begin perform 1 from jc_homes; exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  if v_err not like 'permission denied%' then raise exception 'FAIL T03a anon read jc_homes: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform 1 from jc_codes; exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  if v_err not like 'permission denied%' then raise exception 'FAIL T03b authenticated read jc_codes: %', v_err; end if;
  k := k + 2;

  -- ---------- T04 public config contract ----------
  v := jc_config_get('jubail');
  if not (v ?& array['name_en', 'name_ar', 'links', 'brand', 'modules', 'broadcast', 'map', 'villages', 'tz'])
     or v ? 'retention_days' or v ? 'passcode' or v ? 'admin_code' then
    raise exception 'FAIL T04a config keys: %', (select array_agg(x) from jsonb_object_keys(v) x); end if;
  if jsonb_array_length(v -> 'villages') <> 8
     or (select x ->> 'parent' from jsonb_array_elements(v -> 'villages') x where x ->> 'key' = 'marsa-al-jubail') <> 'marfaa-al-jubail'
     or (select x ->> 'status' from jsonb_array_elements(v -> 'villages') x where x ->> 'key' = 'bada-al-jubail') <> 'upcoming' then
    raise exception 'FAIL T04b villages: %', v -> 'villages'; end if;
  k := k + 2;

  -- ---------- T05/T06 not signed in / signed in without membership: raise, never empty ----------
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_me_get(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_SIGNED_IN' then raise exception 'FAIL T05: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_directory_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_MEMBER' then raise exception 'FAIL T06: %', v_err; end if;
  k := k + 2;

  -- ---------- T07 code pre-check (anon, case/space-insensitive) ----------
  execute 'reset role'; execute 'set local role anon';
  v_t := clock_timestamp();
  v_err := null; begin perform jc_code_check('jubail', 'wrong-code'); exception when others then v_err := sqlerrm; end;
  if clock_timestamp() - v_t > interval '0.5 seconds' then raise exception 'FAIL T07c join-code failure is tar-pitted (H1: must be fast)'; end if;
  if v_err is distinct from 'BAD_CODE' then raise exception 'FAIL T07a: %', v_err; end if;
  if not jc_code_check('jubail', ' join-test-1 ') then raise exception 'FAIL T07b'; end if;
  execute 'reset role';
  k := k + 3;

  -- ---------- T08 join ----------
  execute 'set local role authenticated';
  v_err := null; begin perform jc_join('jubail', 'nope-nope'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_CODE' then raise exception 'FAIL T08a: %', v_err; end if;
  v := jc_join('jubail', 'JOIN-TEST-1');
  if v ->> 'community' <> 'jubail' then raise exception 'FAIL T08b: %', v; end if;
  v := jc_join('jubail', 'anything');  -- idempotent for an existing member
  v_err := null; begin perform jc_join('testville', 'tv-join-test'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'ALREADY_MEMBER_ELSEWHERE' then raise exception 'FAIL T08c: %', v_err; end if;
  k := k + 3;

  -- ---------- T09 claim rules ----------
  v_err := null; begin perform jc_home_claim('bada-al-jubail', 'villa', null, '3'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'VILLAGE_NOT_DELIVERED' then raise exception 'FAIL T09a: %', v_err; end if;
  v := jc_home_claim('ain-al-maha', 'villa', 'ignored', '12-A');
  if v -> 'home' ->> 'number' <> '12-A' or v -> 'home' ->> 'building' is not null then raise exception 'FAIL T09b: %', v; end if;
  v_home := (v -> 'home' ->> 'id')::uuid;
  k := k + 2;

  -- ---------- T10 normalization (incl. Arabic digits) + apartment/building rules ----------
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'join-test-1');
  v_err := null; begin perform jc_home_claim('ain-al-maha', 'villa', null, '12 a'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'HOME_TAKEN' then raise exception 'FAIL T10a (12-A vs 12 a): %', v_err; end if;
  v_err := null; begin perform jc_home_claim('ain-al-maha', 'townhouse', null, '١٢-A'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'HOME_TAKEN' then raise exception 'FAIL T10b (Arabic digits): %', v_err; end if;
  v_err := null; begin perform jc_home_claim('souk-al-jubail', 'apartment', '  ', '304'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BUILDING_REQUIRED' then raise exception 'FAIL T10c: %', v_err; end if;
  v_err := null; begin perform jc_home_claim('souk-al-jubail', 'apartment', '--', '304'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_BUILDING' then raise exception 'FAIL T10d (punctuation building): %', v_err; end if;
  v_err := null; begin perform jc_home_claim('souk-al-jubail', 'apartment', repeat('B', 21), '304'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_BUILDING' then raise exception 'FAIL T10e (long building): %', v_err; end if;
  k := k + 5;

  -- ---------- T11 invite → join; T12 edit locked once shared ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  v := jc_invite_accept(v_tok);
  if v ->> 'status' <> 'joined' or jsonb_array_length(v -> 'me' -> 'home' -> 'members') <> 2 then raise exception 'FAIL T11a: %', v; end if;
  v_err := null; begin perform jc_invite_accept(v_tok); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'ALREADY_HAS_HOME' then raise exception 'FAIL T11b reuse: %', v_err; end if;
  v_err := null; begin perform jc_home_edit('ain-al-maha', 'villa', null, '13'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'ADMIN_ASSIST_REQUIRED' then raise exception 'FAIL T12: %', v_err; end if;
  k := k + 3;

  -- ---------- T13 household cap 4 → admin approval ----------
  foreach v_inv in array array[D, E] loop
    perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
    v_tok := jc_invite_create() ->> 'token';
    perform set_config('request.jwt.claims', json_build_object('sub', v_inv, 'role', 'authenticated')::text, true);
    perform jc_join('jubail', 'join-test-1');
    perform jc_invite_accept(v_tok);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', F, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'join-test-1');
  v := jc_invite_accept(v_tok);
  if v ->> 'status' <> 'pending_approval' then raise exception 'FAIL T13a 5th member: %', v; end if;
  execute 'reset role';
  select count(*) into n from jc_home_members where home_id = v_home;
  if n <> 4 then raise exception 'FAIL T13b members=%', n; end if;
  if not exists (select 1 from jc_admin_notices where kind = 'over_cap' and resolved_at is null) then raise exception 'FAIL T13c no notice'; end if;
  select id into v_inv from jc_home_invites where requested_by = F;
  k := k + 3;

  -- ---------- T14 community isolation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', C, 'role', 'authenticated')::text, true);
  perform jc_join('testville', 'TV-JOIN-TEST');
  if jsonb_array_length(jc_directory_list()) <> 0 then raise exception 'FAIL T14a testville sees jubail homes'; end if;
  v_err := null; begin perform jc_invite_accept(v_tok); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_INVITE' then raise exception 'FAIL T14b cross-community invite: %', v_err; end if;
  v_err := null; begin perform jc_admin_unlock('Admin Test 1'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_ADMIN' then raise exception 'FAIL T14c jubail admin code in testville: %', v_err; end if;
  k := k + 3;

  -- ---------- T15 admin unlock + scope ----------
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T15a: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_t := clock_timestamp();
  v_err := null; begin perform jc_admin_unlock('wrong'); exception when others then v_err := sqlerrm; end;
  if clock_timestamp() - v_t < interval '1.4 seconds' then raise exception 'FAIL T15e admin failure is not tar-pitted'; end if;
  if v_err is distinct from 'BAD_ADMIN' then raise exception 'FAIL T15b: %', v_err; end if;
  if jc_admin_unlock('admin test 1') <> '["community"]'::jsonb then raise exception 'FAIL T15c'; end if;
  v := jc_admin_homes_list();
  if jsonb_array_length(v -> 'homes') <> 1 or jsonb_array_length(v -> 'pending') <> 1 then raise exception 'FAIL T15d: %', v; end if;
  k := k + 5;

  -- ---------- T16 over-cap approval ----------
  v := jc_admin_invite_decide(v_inv, true);
  if jsonb_array_length(v -> 'homes' -> 0 -> 'members') <> 5 or jsonb_array_length(v -> 'pending') <> 0 then raise exception 'FAIL T16: %', v; end if;
  k := k + 1;

  -- ---------- T17 rotation kills other unlocks, keeps the rotator's ----------
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  perform jc_admin_unlock('ADMIN TEST 1');
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_code := jc_admin_code_rotate('community') ->> 'code';
  if char_length(v_code) <> 10 then raise exception 'FAIL T17a code=%', v_code; end if;
  perform jc_admin_homes_list();
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T17b stale unlock survived rotation: %', v_err; end if;
  k := k + 2;

  -- ---------- T18 60-day inactivity expiry ----------
  execute 'reset role';
  update jc_admin_grants set last_used_at = now() - interval '61 days' where user_id = A;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T18a: %', v_err; end if;
  perform jc_admin_unlock(lower(v_code));
  perform jc_admin_homes_list();
  k := k + 1;

  -- ---------- T19 pin checks flag, never block; one open notice per home ----------
  v := jc_home_pin_set(24.5500, 54.4900);
  if (v -> 'home' ->> 'lat')::float <> 24.55 then raise exception 'FAIL T19a: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', G, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'join-test-1');
  v := jc_home_claim('ain-al-maha', 'villa', null, '14');
  v_home2 := (v -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.55002, 54.49002);  -- ~3 m from villa 12-A
  perform jc_home_pin_set(24.55003, 54.49003);  -- re-pin, still flagged
  execute 'reset role';
  if (select flags ->> 'pin_near' from jc_homes where id = v_home2) is distinct from v_home::text then
    raise exception 'FAIL T19b: %', (select flags from jc_homes where id = v_home2); end if;
  select count(*) into n from jc_admin_notices where kind = 'pin_flag' and home_id = v_home2 and resolved_at is null;
  if n <> 1 then raise exception 'FAIL T19c open pin notices=% (want 1)', n; end if;
  k := k + 3;

  -- ---------- T20 directory + suppression ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if jsonb_array_length(jc_directory_list()) <> 2 then raise exception 'FAIL T20a'; end if;
  perform jc_admin_home_suppress(v_home2, true);
  if jsonb_array_length(jc_directory_list()) <> 1 then raise exception 'FAIL T20b'; end if;
  perform jc_admin_home_suppress(v_home2, false);
  k := k + 2;

  -- ---------- T21 leave → vacant → reclaim in place ----------
  perform set_config('request.jwt.claims', json_build_object('sub', G, 'role', 'authenticated')::text, true);
  v := jc_home_leave();
  if v -> 'home' <> 'null'::jsonb then raise exception 'FAIL T21a: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', H, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'join-test-1');
  v := jc_home_claim('ain-al-maha', 'villa', null, '14');
  if (v -> 'home' ->> 'id')::uuid <> v_home2 or v -> 'home' ->> 'lat' is null then raise exception 'FAIL T21b reclaim: %', v; end if;
  k := k + 2;

  -- ---------- T22 rotating the join code clears departure notices ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  if not exists (select 1 from jsonb_array_elements(jc_admin_notices_list()) x where x ->> 'kind' = 'departure') then
    raise exception 'FAIL T22a no departure notice'; end if;
  v_join := jc_admin_code_rotate('join') ->> 'code';  -- old join code is dead from here on
  if exists (select 1 from jsonb_array_elements(jc_admin_notices_list()) x where x ->> 'kind' = 'departure') then
    raise exception 'FAIL T22b departure notice survived rotation'; end if;
  k := k + 2;

  -- ---------- T23 account deletion ----------
  perform set_config('request.jwt.claims', json_build_object('sub', B, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_account_delete('yes'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'CONFIRM_REQUIRED' then raise exception 'FAIL T23a: %', v_err; end if;
  perform jc_account_delete('DELETE');
  execute 'reset role';
  if exists (select 1 from auth.users where id = B) or exists (select 1 from jc_accounts where user_id = B) then
    raise exception 'FAIL T23b identity survived'; end if;
  select count(*) into n from jc_home_members where home_id = v_home;
  if n <> 4 then raise exception 'FAIL T23c members=%', n; end if;  -- A, D, E, F
  k := k + 3;

  -- ---------- T24 module admin cannot reach community-only functions ----------
  perform set_config('request.jwt.claims', json_build_object('sub', D, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if jc_admin_unlock('events-test-1') <> '["events"]'::jsonb then raise exception 'FAIL T24a'; end if;
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T24b events admin read Homes queue: %', v_err; end if;
  v_err := null; begin perform jc_admin_code_rotate('join'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T24c events admin rotated join code: %', v_err; end if;
  k := k + 3;

  -- ---------- T25 admin removal guards ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_member_remove(A, false); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'USE_ACCOUNT_DELETE' then raise exception 'FAIL T25a: %', v_err; end if;
  v_err := null; begin perform jc_admin_member_remove(C, true); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL T25b cross-community removal: %', v_err; end if;
  k := k + 2;

  -- ---------- T26 a removed member's invites die with the membership ----------
  perform set_config('request.jwt.claims', json_build_object('sub', E, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  perform jc_admin_member_remove(E, false);
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', v_join);
  v_err := null; begin perform jc_invite_accept(v_tok); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_INVITE' then raise exception 'FAIL T26a departed issuer''s invite still works: %', v_err; end if;
  k := k + 1;

  -- ---------- T27 expired invite ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  execute 'reset role';
  update jc_home_invites set expires_at = now() - interval '1 hour'
   where token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex');
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_invite_accept(v_tok); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_INVITE' then raise exception 'FAIL T27: %', v_err; end if;
  k := k + 1;

  -- ---------- T28 decline is a distinct signal ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', I, 'role', 'authenticated')::text, true);
  perform jc_invite_accept(v_tok);   -- A, D, F, I = 4
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', J, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', v_join);
  if jc_invite_accept(v_tok) ->> 'status' <> 'pending_approval' then raise exception 'FAIL T28a'; end if;
  execute 'reset role';
  select id into v_inv from jc_home_invites where requested_by = J;
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform jc_admin_invite_decide(v_inv, false);
  perform set_config('request.jwt.claims', json_build_object('sub', J, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_invite_accept(v_tok); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'INVITE_DECLINED' then raise exception 'FAIL T28b: %', v_err; end if;
  k := k + 2;

  -- ---------- T29 exit admin; the log recorded every admin action ----------
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_admin_log_list()) = 0 then raise exception 'FAIL T29a empty log'; end if;
  perform jc_admin_exit();
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL T29b exit left admin on: %', v_err; end if;
  execute 'reset role';
  select count(distinct action) into n from jc_admin_log
   where action in ('code_rotate', 'member_remove', 'invite_approve', 'invite_decline', 'home_suppress');
  if n <> 5 then raise exception 'FAIL T29c logged action kinds=% (want 5)', n; end if;
  if exists (select 1 from jc_admin_log where target::text ilike '%' || v_code || '%') then
    raise exception 'FAIL T29d a code leaked into the log'; end if;
  k := k + 4;

  raise exception 'ALL_TESTS_PASSED (% checks)', k;
end
$t$;
