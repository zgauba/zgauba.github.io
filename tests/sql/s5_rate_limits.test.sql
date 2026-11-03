-- T3 behaviour tests: account-keyed rate limits on jc_join and jc_admin_unlock.
-- (Named s5_ so build_dryrun.sh's glob picks it up after the T2 slices.)
-- now() is frozen inside the dry-run transaction, so windows are expired by
-- rewinding window_start as postgres rather than by waiting.
-- Not testable in one session (advisory locks are re-entrant per session): two
-- parallel attempts → the second gets RATE_LIMITED at once. That is a manual
-- two-tab check on the launch list (KG11).

do $t$
declare
  r1 uuid := '00000000-0000-4000-8000-000000000501';
  r2 uuid := '00000000-0000-4000-8000-000000000502';
  r3 uuid := '00000000-0000-4000-8000-000000000503';
  v jsonb; v_err text; n int; k int := 0; i int; v_t timestamptz;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values (r1, 'r1@t3.test'), (r2, 'r2@t3.test'), (r3, 'r3@t3.test');
  perform jc_code_set('jubail', 'join', 'T3-JOIN-CODE-01');
  perform jc_code_set('jubail', 'community', 'T3-COMMUNITY-ADMIN-01');

  -- ---------- R01 a failed attempt's count survives (returned, not raised) ----------
  -- Asserts the failure is a returned value (no error) and that the count is written.
  -- A raise would roll the count back at the request boundary — the original reason for T3.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', r1, 'role', 'authenticated')::text, true);
  v_err := null; begin v := jc_join('jubail', 'wrong-wrong'); exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  if v_err is not null or v ->> 'error' is distinct from 'BAD_CODE' then raise exception 'FAIL R01a: % / %', v_err, v; end if;
  select jc_rate.n into n from jc_rate where user_id = r1 and bucket = 'join';
  if n is distinct from 1 then raise exception 'FAIL R01b join counter = % (expected 1)', n; end if;
  k := k + 2;

  -- ---------- R02 join: 10 attempts per hour, the 11th is refused fast ----------
  execute 'set local role authenticated';
  for i in 2..10 loop
    v := jc_join('jubail', 'wrong-wrong');
    if v ->> 'error' is distinct from 'BAD_CODE' then raise exception 'FAIL R02a attempt %: %', i, v; end if;
  end loop;
  v_t := clock_timestamp();
  v_err := null; begin perform jc_join('jubail', 'wrong-wrong'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL R02b 11th attempt: %', v_err; end if;
  execute 'reset role';
  if (select jc_rate.n from jc_rate where user_id = r1 and bucket = 'join') is distinct from 10 then
    raise exception 'FAIL R02f refusal moved the count off the limit'; end if;
  execute 'set local role authenticated';
  if clock_timestamp() - v_t > interval '0.5 seconds' then raise exception 'FAIL R02c refusal is slow'; end if;
  -- attempts, not failures: the right code is refused too while limited
  v_err := null; begin perform jc_join('jubail', 'T3-JOIN-CODE-01'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL R02d right code while limited: %', v_err; end if;
  execute 'reset role';
  if exists (select 1 from jc_accounts where user_id = r1) then raise exception 'FAIL R02e joined while limited'; end if;
  k := k + 5;

  -- ---------- R03 window expiry; success clears the counter ----------
  update jc_rate set window_start = now() - interval '61 minutes' where user_id = r1 and bucket = 'join';
  execute 'set local role authenticated';
  v := jc_join('jubail', 'T3-JOIN-CODE-01');
  execute 'reset role';
  if v ->> 'community' is distinct from 'jubail' then raise exception 'FAIL R03a join after expiry: %', v; end if;
  if exists (select 1 from jc_rate where user_id = r1 and bucket = 'join') then raise exception 'FAIL R03b counter not cleared'; end if;
  k := k + 2;

  -- ---------- R04 limits are per account ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', r2, 'role', 'authenticated')::text, true);
  v := jc_join('jubail', 'T3-JOIN-CODE-01');
  if v ->> 'community' is distinct from 'jubail' then raise exception 'FAIL R04 r2 blocked by r1''s history: %', v; end if;
  k := k + 1;

  -- ---------- R05 admin unlock: failure counted + still tar-pitted ----------
  perform set_config('request.jwt.claims', json_build_object('sub', r1, 'role', 'authenticated')::text, true);
  v_t := clock_timestamp();
  v_err := null; begin v := jc_admin_unlock('not-the-code'); exception when others then v_err := sqlerrm; end;
  if clock_timestamp() - v_t < interval '1.4 seconds' then raise exception 'FAIL R05a admin failure not tar-pitted'; end if;
  execute 'reset role';
  if v_err is not null or v ->> 'error' is distinct from 'BAD_ADMIN' then raise exception 'FAIL R05b: % / %', v_err, v; end if;
  if (select jc_rate.n from jc_rate where user_id = r1 and bucket = 'admin_unlock') is distinct from 1 then
    raise exception 'FAIL R05c admin counter not persisted'; end if;
  k := k + 3;

  -- ---------- R06 admin unlock: 6th attempt in 15 min refused fast, no tar-pit ----------
  update jc_rate set n = 5 where user_id = r1 and bucket = 'admin_unlock';
  execute 'set local role authenticated';
  v_t := clock_timestamp();
  v_err := null; begin perform jc_admin_unlock('T3-COMMUNITY-ADMIN-01'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL R06a 6th attempt: %', v_err; end if;
  if clock_timestamp() - v_t > interval '0.5 seconds' then raise exception 'FAIL R06b locked refusal is tar-pitted'; end if;
  execute 'reset role';
  if exists (select 1 from jc_admin_grants where user_id = r1) then raise exception 'FAIL R06c unlocked while limited'; end if;
  k := k + 3;

  -- ---------- R07 admin window expiry; success is tar-pitted too and does NOT clear ----------
  -- (success is per scope: clearing would let a scoped admin keep guessing other codes)
  update jc_rate set window_start = now() - interval '16 minutes' where user_id = r1 and bucket = 'admin_unlock';
  execute 'set local role authenticated';
  v_t := clock_timestamp();
  v := jc_admin_unlock('T3-COMMUNITY-ADMIN-01');
  if clock_timestamp() - v_t < interval '1.4 seconds' then raise exception 'FAIL R07c success not tar-pitted (timing leak)'; end if;
  execute 'reset role';
  if v is distinct from '["community"]'::jsonb then raise exception 'FAIL R07a: %', v; end if;
  if (select jc_rate.n from jc_rate where user_id = r1 and bucket = 'admin_unlock') is distinct from 1 then
    raise exception 'FAIL R07b admin success cleared or skipped the counter'; end if;
  k := k + 3;

  -- ---------- R08 counter is server-only; deleting the user removes its rows ----------
  perform set_config('request.jwt.claims', json_build_object('sub', r3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := jc_join('jubail', 'wrong-wrong');
  v_err := null; begin perform 1 from jc_rate; exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL R08a authenticated read jc_rate: %', v_err; end if;
  v_err := null; begin perform jc_rate_take(r3, 'join', 1000, interval '1 second'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL R08b jc_rate_take callable: %', v_err; end if;
  v_err := null; begin perform jc_rate_clear(r3, 'join'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL R08c jc_rate_clear callable: %', v_err; end if;
  v_err := null; begin perform jc_fail_return('BAD_CODE'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL R08e jc_fail_return callable: %', v_err; end if;
  execute 'reset role';
  delete from auth.users where id = r3;
  if exists (select 1 from jc_rate where user_id = r3) then raise exception 'FAIL R08d rows survive user delete'; end if;
  k := k + 5;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's5_rate_limits: % checks passed', k;
end
$t$;
