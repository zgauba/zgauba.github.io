-- R4d — jc_my_bookings_past(): own home only, ended slots only, since this member joined, within 90 days,
-- booked + organizer-cancelled (never the household's own cancels), no names, newest first, at most 100,
-- [] without a home, MODULE_OFF when Courts is off, anon can't call it.
-- Own communities (testville20 / testville20b) — never jubail. Rows are inserted directly as postgres because the
-- booking RPCs refuse past slots. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  a1 uuid := '00000000-0000-4000-8000-000000002001';  -- home A, joined 30 days ago
  a2 uuid := '00000000-0000-4000-8000-000000002002';  -- home A, joined 2 days ago (new household member)
  b1 uuid := '00000000-0000-4000-8000-000000002003';  -- home B (a neighbor)
  nh uuid := '00000000-0000-4000-8000-000000002004';  -- member without a home
  o1 uuid := '00000000-0000-4000-8000-000000002005';  -- testville20b (Courts off), has a home
  v jsonb; k int := 0; msg text; n int;
  ha uuid; hb uuid; fac uuid; fac_b uuid; d timestamptz;
  x_done uuid := gen_random_uuid(); x_org uuid := gen_random_uuid(); x_self uuid := gen_random_uuid();
  x_old uuid := gen_random_uuid(); x_now uuid := gen_random_uuid(); x_up uuid := gen_random_uuid();
  x_before uuid := gen_random_uuid(); x_nb uuid := gen_random_uuid(); x_ancient uuid := gen_random_uuid();
  x_presale uuid := gen_random_uuid(); x_presale2 uuid := gen_random_uuid();
  n1 uuid := '00000000-0000-4000-8000-000000002006';  -- buys home B after its family leaves
begin
  execute $f$create function pg_temp.s20_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s20_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s20_as(uuid), pg_temp.s20_err(text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (a1, 'a1@s20.test'), (a2, 'a2@s20.test'), (b1, 'b1@s20.test'),
    (nh, 'nh@s20.test'), (o1, 'o1@s20.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville20', 'Testville 20', 24.53, 54.43, '{"bookings": {"enabled": true}}'),
    ('testville20b', 'Testville 20b', 25.00, 55.00, '{"bookings": {"enabled": false}}');
  insert into jc_villages (community_id, key, name_en) values ('testville20', 'north', 'North'), ('testville20b', 'north', 'North');
  perform jc_code_set('testville20', 'join', 'S20-JOIN-CODE-01');
  perform jc_code_set('testville20b', 'join', 'S20-JOIN-CODE-02');

  execute 'set local role authenticated';
  perform pg_temp.s20_as(a1); perform jc_join('testville20', 'S20-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '1');
  v := jc_invite_create();
  perform pg_temp.s20_as(a2); perform jc_join('testville20', 'S20-JOIN-CODE-01');
  perform jc_invite_accept(v ->> 'token');
  perform pg_temp.s20_as(b1); perform jc_join('testville20', 'S20-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '2');
  perform pg_temp.s20_as(nh); perform jc_join('testville20', 'S20-JOIN-CODE-01');
  perform pg_temp.s20_as(o1); perform jc_join('testville20b', 'S20-JOIN-CODE-02');
  perform jc_home_claim('north', 'villa', null, '1');
  execute 'reset role';

  select home_id into ha from jc_home_members where user_id = a1;
  select home_id into hb from jc_home_members where user_id = b1;
  update jc_home_members set joined_at = now() - interval '30 days' where user_id = a1;
  update jc_home_members set joined_at = now() - interval '2 days' where user_id = a2;
  update jc_home_members set joined_at = now() - interval '200 days' where user_id = b1;
  insert into jc_facilities (community_id, kind, name_en, name_ar, status, open_time, close_time, slot_minutes)
  values ('testville20', 'tennis', 'S20 Court', 'ملعب', 'published', '07:00', '22:00', 60) returning id into fac;
  insert into jc_facilities (community_id, kind, name_en, status, open_time, close_time, slot_minutes)
  values ('testville20', 'basketball', 'S20 Padel', 'retired', '07:00', '22:00', 60) returning id into fac_b;

  d := date_trunc('hour', now());
  insert into jc_bookings (id, community_id, facility_id, home_id, booked_by, starts_at, ends_at, status, cancel_reason, cancelled_by, cancelled_at, is_private) values
    -- home A, all after a1 joined (30 d ago)
    (x_done,  'testville20', fac,   ha, a1, d - interval '5 days',  d - interval '5 days' + interval '1 hour', 'booked', null, null, null, true),
    (x_org,   'testville20', fac,   ha, a1, d - interval '4 days',  d - interval '4 days' + interval '1 hour', 'cancelled', 'Court blocked: Maintenance', b1, d - interval '6 days', false),
    (x_self,  'testville20', fac,   ha, a1, d - interval '3 days',  d - interval '3 days' + interval '1 hour', 'cancelled', null, a1, d - interval '4 days', false),
    (x_old,   'testville20', fac_b, ha, a1, d - interval '20 days', d - interval '20 days' + interval '1 hour', 'booked', null, null, null, false),
    -- being played now (not ended) and upcoming: never in Past
    (x_now,   'testville20', fac,   ha, a1, now() - interval '30 minutes', now() + interval '30 minutes', 'booked', null, null, null, false),
    (x_up,    'testville20', fac,   ha, a1, d + interval '1 day',   d + interval '1 day' + interval '1 hour', 'booked', null, null, null, false),
    -- before a1 joined (the previous family's)
    (x_before,'testville20', fac,   ha, null, d - interval '40 days', d - interval '40 days' + interval '1 hour', 'booked', null, null, null, false),
    -- a neighbor's, and one older than 90 days
    (x_nb,    'testville20', fac,   hb, b1, d - interval '6 days',  d - interval '6 days' + interval '1 hour', 'booked', null, null, null, false),
    (x_ancient,'testville20', fac,  hb, b1, d - interval '95 days', d - interval '95 days' + interval '1 hour', 'booked', null, null, null, false);
  update jc_bookings set created_at = least(starts_at - interval '1 day', now()) where community_id = 'testville20';
  -- M1: a slot made BEFORE a1 joined that starts after it (the previous family's), played and cancelled by the system
  insert into jc_bookings (id, community_id, facility_id, home_id, starts_at, ends_at, status, cancel_reason, cancelled_at, created_at) values
    (x_presale, 'testville20', fac, ha, d - interval '10 days', d - interval '10 days' + interval '1 hour', 'booked', null, null, now() - interval '35 days'),
    (x_presale2,'testville20', fac, ha, d - interval '9 days',  d - interval '9 days' + interval '1 hour', 'cancelled', 'Household left', now() - interval '31 days', now() - interval '35 days');
  execute 'set local role authenticated';

  -- ---------- P01 own home: ended booked + organizer-cancelled, newest first ----------
  perform pg_temp.s20_as(a1);
  v := jc_my_bookings_past();
  if (select array_agg((x ->> 'id')::uuid order by o) from jsonb_array_elements(v) with ordinality t(x, o))
     is distinct from array[x_org, x_done, x_old] then
    raise exception 'FAIL P01a rows/order: %', v; end if;
  if (select x ->> 'cancel_reason' from jsonb_array_elements(v) x where (x ->> 'id')::uuid = x_org) is distinct from 'Court blocked: Maintenance' then
    raise exception 'FAIL P01b organizer reason'; end if;
  if (select x ->> 'status' from jsonb_array_elements(v) x where (x ->> 'id')::uuid = x_done) is distinct from 'booked' then
    raise exception 'FAIL P01c done status'; end if;
  if (select x ->> 'facility' from jsonb_array_elements(v) x where (x ->> 'id')::uuid = x_old) is distinct from 'S20 Padel' then
    raise exception 'FAIL P01d a retired court keeps its name'; end if;
  k := k + 4;

  -- ---------- P02 never: own cancels, not-ended, a neighbor's, names / people ----------
  if exists (select 1 from jsonb_array_elements(v) x where (x ->> 'id')::uuid in (x_self, x_now, x_up, x_nb, x_ancient, x_presale, x_presale2)) then
    raise exception 'FAIL P02a a row that must not show: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v) x, jsonb_object_keys(x) key
              where key in ('booked_by', 'cancelled_by', 'display_name', 'home_id', 'home', 'is_private')) then
    raise exception 'FAIL P02b a person / home field leaked: %', v; end if;
  k := k + 2;

  -- ---------- P03 since joining: the previous family's booking, and a new household member ----------
  if exists (select 1 from jsonb_array_elements(v) x where (x ->> 'id')::uuid = x_before) then
    raise exception 'FAIL P03a booking from before this member joined'; end if;
  perform pg_temp.s20_as(a2);
  if jc_my_bookings_past() <> '[]'::jsonb then raise exception 'FAIL P03b a member who joined 2 days ago sees older history: %', jc_my_bookings_past(); end if;
  k := k + 2;

  -- ---------- P04 90 days: a neighbor who joined 200 days ago sees 6 days, not 95 ----------
  perform pg_temp.s20_as(b1);
  v := jc_my_bookings_past();
  if (select array_agg((x ->> 'id')::uuid) from jsonb_array_elements(v) x) is distinct from array[x_nb] then
    raise exception 'FAIL P04 90-day window / own home: %', v; end if;
  k := k + 1;

  -- ---------- P05 no home → []; Courts off → MODULE_OFF ----------
  perform pg_temp.s20_as(nh);
  if jc_my_bookings_past() <> '[]'::jsonb then raise exception 'FAIL P05a no home'; end if;
  perform pg_temp.s20_as(o1);
  msg := pg_temp.s20_err('select jc_my_bookings_past()');
  if msg is distinct from 'MODULE_OFF' then raise exception 'FAIL P05b Courts off: %', msg; end if;
  k := k + 2;

  -- ---------- P06 the upcoming list is unchanged by R4d (x_now + x_up there, no ended rows) ----------
  perform pg_temp.s20_as(a1);
  v := jc_my_bookings();
  if (select array_agg((x ->> 'id')::uuid order by o) from jsonb_array_elements(v) with ordinality t(x, o))
     is distinct from array[x_now, x_up] then raise exception 'FAIL P06 upcoming changed: %', v; end if;
  k := k + 1;

  -- ---------- P07 a member who left: no home, no history ----------
  perform pg_temp.s20_as(a2);
  perform jc_home_leave();
  if jc_my_bookings_past() <> '[]'::jsonb then raise exception 'FAIL P07 left the home, still sees its history'; end if;
  k := k + 1;

  -- ---------- P08 limit 100 ----------
  execute 'reset role';
  insert into jc_bookings (community_id, facility_id, home_id, starts_at, ends_at, status)
  select 'testville20', fac_b, hb, d - (i || ' hours')::interval - interval '7 days', d - (i || ' hours')::interval - interval '7 days' + interval '1 hour', 'booked'
    from generate_series(1, 120) i;
  execute 'set local role authenticated';
  perform pg_temp.s20_as(b1);
  v := jc_my_bookings_past();
  if jsonb_array_length(v) <> 100 then raise exception 'FAIL P08a limit: %', jsonb_array_length(v); end if;
  if (v -> 0 ->> 'id')::uuid is distinct from x_nb then raise exception 'FAIL P08b newest first: %', v -> 0; end if;
  if (v -> 99 ->> 'starts_at')::timestamptz <> d - interval '99 hours' - interval '7 days' then
    raise exception 'FAIL P08c the newest 100 kept: %', v -> 99 ->> 'starts_at'; end if;
  k := k + 3;

  -- ---------- P09 anon can't call it ----------
  execute 'reset role';
  if has_function_privilege('anon', 'public.jc_my_bookings_past()', 'execute') then raise exception 'FAIL P09a anon can execute'; end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.jc_my_bookings_past()'::regprocedure and a.grantee = 0) then
    raise exception 'FAIL P09b PUBLIC can execute'; end if;
  k := k + 2;

  -- ---------- P10 a real sale: the family books, leaves; the next family claims the home and sees nothing of theirs ----------
  execute 'set local role authenticated';
  perform pg_temp.s20_as(b1);
  perform jc_home_leave();                                    -- home B empties (its future bookings: "Household left")
  execute 'reset role';
  update jc_bookings set created_at = now() - interval '1 hour' where home_id = hb;   -- as if all made before the sale
  insert into auth.users (id, email) values (n1, 'n1@s20.test');
  execute 'set local role authenticated';
  perform pg_temp.s20_as(n1); perform jc_join('testville20', 'S20-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '2');
  if jc_my_bookings_past() <> '[]'::jsonb then raise exception 'FAIL P10 the buyer sees the seller''s bookings: %', jc_my_bookings_past(); end if;
  execute 'reset role';
  k := k + 1;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's20_past_bookings: % checks passed', k;
end
$t$;
