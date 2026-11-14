-- NF-1 — a court's optional village (where it is; never who may book). Own communities (testville25 / testville25b) —
-- never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  ad uuid := '00000000-0000-4000-8000-000000002501';  -- Courts admin, testville25
  r1 uuid := '00000000-0000-4000-8000-000000002502';  -- resident, testville25 (home in south)
  b1 uuid := '00000000-0000-4000-8000-000000002503';  -- Courts admin, testville25b
  v jsonb; k int := 0; msg text; v_fac uuid; v_two uuid; d1 date := (now() at time zone 'Asia/Dubai')::date + 1;
begin
  execute $f$create function pg_temp.s25_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s25_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s25_vk(l jsonb, id uuid) returns jsonb language sql as
    $b$ select x -> 'village_key' from jsonb_array_elements(l) x where x ->> 'id' = id::text $b$$f$;
  execute 'grant execute on function pg_temp.s25_as(uuid), pg_temp.s25_err(text), pg_temp.s25_vk(jsonb, uuid) to authenticated';

  -- ---------- fixtures ----------
  insert into auth.users (id, email) values (ad, 'ad@s25.test'), (r1, 'r1@s25.test'), (b1, 'b1@s25.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville25', 'Testville 25', 24.53, 54.43, '{"bookings": {"enabled": true}}'),
    ('testville25b', 'Testville 25b', 25.00, 55.00, '{"bookings": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values
    ('testville25', 'north', 'North'), ('testville25', 'south', 'South'), ('testville25b', 'east', 'East');
  perform jc_code_set('testville25', 'join', 'S25-JOIN-CODE-01');
  perform jc_code_set('testville25', 'bookings', 'S25-BOOKINGS-01');
  perform jc_code_set('testville25b', 'join', 'S25B-JOIN-CODE-01');
  perform jc_code_set('testville25b', 'bookings', 'S25B-BOOKINGS-01');

  execute 'set local role authenticated';
  perform pg_temp.s25_as(ad); perform jc_join('testville25', 'S25-JOIN-CODE-01'); perform jc_admin_unlock('S25-BOOKINGS-01');
  perform pg_temp.s25_as(r1); perform jc_join('testville25', 'S25-JOIN-CODE-01'); perform jc_home_claim('south', 'villa', null, '7');
  perform pg_temp.s25_as(b1); perform jc_join('testville25b', 'S25B-JOIN-CODE-01'); perform jc_admin_unlock('S25B-BOOKINGS-01');

  -- ---------- C01 a new court with a village; the organizer list returns it ----------
  perform pg_temp.s25_as(ad);
  v := jc_admin_facility_save(null, '{"kind": "tennis", "name_en": "Court N", "lat": 24.531, "lng": 54.431, "village_key": "north"}');
  v_fac := (select (x ->> 'id')::uuid from jsonb_array_elements(v) x where x ->> 'name_en' = 'Court N');
  if pg_temp.s25_vk(v, v_fac) is distinct from '"north"'::jsonb then raise exception 'FAIL C01 admin list village: %', v; end if;
  k := k + 1;

  -- ---------- C02 a resident in another village sees it (where it is, not who may book) ----------
  perform jc_admin_facility_status(v_fac, 'published');
  perform pg_temp.s25_as(r1);
  if pg_temp.s25_vk(jc_facilities_list(), v_fac) is distinct from '"north"'::jsonb then
    raise exception 'FAIL C02 resident list village: %', jc_facilities_list(); end if;
  k := k + 1;

  -- ---------- C03 a save without village_key leaves it; another key changes it ----------
  perform pg_temp.s25_as(ad);
  v := jc_admin_facility_save(v_fac, '{"location_note": "By the gate"}');
  if pg_temp.s25_vk(v, v_fac) is distinct from '"north"'::jsonb then raise exception 'FAIL C03a untouched village changed: %', v; end if;
  v := jc_admin_facility_save(v_fac, '{"village_key": "south"}');
  if pg_temp.s25_vk(v, v_fac) is distinct from '"south"'::jsonb then raise exception 'FAIL C03b change village: %', v; end if;
  k := k + 2;

  -- ---------- C04 clear: "" and null both mean Whole community ----------
  v := jc_admin_facility_save(v_fac, '{"village_key": ""}');
  if pg_temp.s25_vk(v, v_fac) is distinct from 'null'::jsonb then raise exception 'FAIL C04a "" clears: %', v; end if;
  perform jc_admin_facility_save(v_fac, '{"village_key": "north"}');
  v := jc_admin_facility_save(v_fac, '{"village_key": null}');
  if pg_temp.s25_vk(v, v_fac) is distinct from 'null'::jsonb then raise exception 'FAIL C04b null clears: %', v; end if;
  k := k + 2;

  -- ---------- C05 refusals: unknown village, another community's village, a non-string; nothing changes ----------
  perform jc_admin_facility_save(v_fac, '{"village_key": "north"}');
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": "nowhere"}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL C05a unknown village: %', msg; end if;
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": "east"}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL C05b other community''s village: %', msg; end if;
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": 5}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL C05c non-string: %', msg; end if;
  msg := pg_temp.s25_err($q$select jc_admin_facility_save(null, '{"kind": "tennis", "name_en": "Court X", "village_key": "nowhere"}')$q$);
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL C05d new court, unknown village: %', msg; end if;
  if pg_temp.s25_vk(jc_admin_facilities_list(), v_fac) is distinct from '"north"'::jsonb then raise exception 'FAIL C05e refused save changed it'; end if;
  if exists (select 1 from jsonb_array_elements(jc_admin_facilities_list()) x where x ->> 'name_en' = 'Court X') then
    raise exception 'FAIL C05f refused new court was created'; end if;
  k := k + 6;

  -- ---------- C06 a court without a village (Whole community) ----------
  v := jc_admin_facility_save(null, '{"kind": "basketball", "name_en": "Hoops"}');
  v_two := (select (x ->> 'id')::uuid from jsonb_array_elements(v) x where x ->> 'name_en' = 'Hoops');
  if pg_temp.s25_vk(v, v_two) is distinct from 'null'::jsonb then raise exception 'FAIL C06 default village: %', v; end if;
  k := k + 1;

  -- ---------- C07 a resident can't set it ----------
  perform pg_temp.s25_as(r1);
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": "south"}'));
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL C07 resident saved a court: %', msg; end if;
  k := k + 1;

  -- ---------- C08 a village a court points at can't be deleted; the schema is as planned ----------
  execute 'reset role';
  begin
    delete from jc_villages where community_id = 'testville25' and key = 'north';
    raise exception 'FAIL C08a deleted a village a court uses';
  exception when foreign_key_violation then null;                       -- the FK, not some other error
  end;
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'jc_facilities' and column_name = 'village_key') <> 'YES' then
    raise exception 'FAIL C08b village_key must be nullable'; end if;
  if not exists (select 1 from pg_constraint where conname = 'jc_facilities_village_fk' and contype = 'f') then
    raise exception 'FAIL C08c foreign key missing'; end if;
  k := k + 3;

  -- ---------- C09 review hardening: trim, case, booking never restricted, other community, the log ----------
  execute 'set local role authenticated';
  perform pg_temp.s25_as(ad);
  v := jc_admin_facility_save(v_fac, '{"village_key": " south "}');
  if pg_temp.s25_vk(v, v_fac) is distinct from '"south"'::jsonb then raise exception 'FAIL C09a spaces trimmed: %', v; end if;
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": "North"}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL C09b keys are lower case: %', msg; end if;
  perform jc_admin_facility_save(v_fac, '{"village_key": "north"}');
  -- a resident from another village books the north court: the village never limits who may book
  perform pg_temp.s25_as(r1);
  perform jc_booking_book(v_fac, (d1 + time '09:00') at time zone 'Asia/Dubai', false);
  -- with that booking upcoming, the village can still change (it is not one of the locked rules)
  perform pg_temp.s25_as(ad);
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": "south"}'));
  if msg is not null then raise exception 'FAIL C09c village locked by an upcoming booking: %', msg; end if;
  -- another community's Courts admin can't touch it
  perform pg_temp.s25_as(b1);
  msg := pg_temp.s25_err(format('select jc_admin_facility_save(%L, %L)', v_fac, '{"village_key": null}'));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL C09d other community''s admin: %', msg; end if;
  execute 'reset role';
  if (select village_key from jc_facilities where id = v_fac) is distinct from 'south' then raise exception 'FAIL C09e other admin changed it'; end if;
  if not exists (select 1 from jc_admin_log where community_id = 'testville25' and action = 'facility_save'
                  and target -> 'fields' ? 'village_key') then
    raise exception 'FAIL C09f the log names the field'; end if;
  k := k + 6;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's25_court_village: % checks passed', k;
end
$t$;
