-- T2 / S3 behaviour tests: facilities, slot bookings, quota, blocks, admin cancel,
-- vacancy release, retirement. Run via tests/sql/build_dryrun.sh (rolls back).
-- Users w1..w8 are disjoint from S1/S2 fixtures; homes are Souk Al Jubail 21–24.
-- All times are relative to "tomorrow, Dubai" so the suite runs at any hour.

do $t$
declare
  w1 uuid := '00000000-0000-4000-8000-000000000301';
  w2 uuid := '00000000-0000-4000-8000-000000000302';
  w3 uuid := '00000000-0000-4000-8000-000000000303';
  w4 uuid := '00000000-0000-4000-8000-000000000304';
  w5 uuid := '00000000-0000-4000-8000-000000000305';
  w6 uuid := '00000000-0000-4000-8000-000000000306';
  w7 uuid := '00000000-0000-4000-8000-000000000307';
  w8 uuid := '00000000-0000-4000-8000-000000000308';
  tz text := 'Asia/Dubai';
  v_today date; v_d1 date; v jsonb; v_err text; v_tok text; n int; k int := 0;
  v_fac uuid; v_b1 uuid; v_b3 uuid; v_b4 uuid; v_block uuid;
begin
  v_today := (now() at time zone tz)::date;
  v_d1 := v_today + 1;

  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (w1, 'w1@s3.test'), (w2, 'w2@s3.test'), (w3, 'w3@s3.test'), (w4, 'w4@s3.test'),
    (w5, 'w5@s3.test'), (w6, 'w6@s3.test'), (w7, 'w7@s3.test'), (w8, 'w8@s3.test');
  perform jc_code_set('jubail', 'join', 'S3-JOIN-CODE-01');
  perform jc_code_set('jubail', 'bookings', 'S3-BOOKINGS-ADMIN-01');
  perform jc_code_set('jubail', 'events', 'S3-EVENTS-ADMIN-01');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules)
  values ('testville3', 'Testville 3', 25.0, 55.0, '{"bookings": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville3', 'north', 'North');
  perform jc_code_set('testville3', 'join', 'S3-TV3-JOIN-01');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_home_claim('souk-al-jubail', 'villa', null, '21');
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_invite_accept(v_tok);
  perform set_config('request.jwt.claims', json_build_object('sub', w3, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_home_claim('souk-al-jubail', 'villa', null, '22');
  perform set_config('request.jwt.claims', json_build_object('sub', w4, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_home_claim('souk-al-jubail', 'villa', null, '23');
  perform set_config('request.jwt.claims', json_build_object('sub', w5, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_home_claim('souk-al-jubail', 'villa', null, '24');
  perform jc_admin_unlock('S3-BOOKINGS-ADMIN-01');
  perform set_config('request.jwt.claims', json_build_object('sub', w7, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S3-JOIN-CODE-01');
  perform jc_admin_unlock('S3-EVENTS-ADMIN-01');
  perform set_config('request.jwt.claims', json_build_object('sub', w8, 'role', 'authenticated')::text, true);
  perform jc_join('testville3', 'S3-TV3-JOIN-01');
  perform jc_home_claim('north', 'villa', null, '1');

  -- ---------- C01 kill switch ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_facilities_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL C01a: %', v_err; end if;
  v_err := null; begin perform jc_my_bookings(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL C01b: %', v_err; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{bookings,enabled}', 'true') where id = 'jubail';
  if (select modules -> 'bookings' ->> 'per_home_per_day' from jc_communities where id = 'jubail') <> '1' then
    raise exception 'FAIL C01c quota rule missing from config'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- C02 admin gates + validation ----------
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL C02a resident: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_facilities_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL C02b events admin reached courts: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "squash", "name_en": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02c kind: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "colour": "red"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02d unknown key: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "slot_minutes": 50}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02e slot length: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "open_time": "22:00", "close_time": "07:00"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02f hours: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "open_time": "07:00:30"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02h seconds in hours: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "close_time": "24:00"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02i midnight close: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "X", "open_time": "10:00", "close_time": "10:30"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02j hours shorter than a slot: %', v_err; end if;
  v_err := null; begin perform jc_admin_facility_save(null, '{"kind": "padel", "name_en": "   "}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL C02k blank name: %', v_err; end if;
  v := jc_admin_facility_save(null, '{"kind": "padel", "name_en": "Padel 1", "location_note": "Behind the souk"}');
  select (x ->> 'id')::uuid into v_fac from jsonb_array_elements(v) x where x ->> 'name_en' = 'Padel 1';
  if v_fac is null then raise exception 'FAIL C02g create: %', v; end if;
  k := k + 11;

  -- ---------- C03 drafts are invisible ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_facilities_list()) <> 0 then raise exception 'FAIL C03a draft listed'; end if;
  v_err := null; begin perform jc_facility_day(v_fac, v_d1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C03b: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '09:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C03c booked a draft: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  perform jc_admin_facility_status(v_fac, 'published');
  v_err := null; begin perform jc_admin_facility_status(v_fac, 'draft'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL C03d unpublish: %', v_err; end if;
  k := k + 4;

  -- ---------- C04 the day grid + window ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_facilities_list()) <> 1 then raise exception 'FAIL C04a not listed'; end if;
  v := jc_facility_day(v_fac, v_d1);
  if jsonb_array_length(v -> 'slots') <> 15
     or exists (select 1 from jsonb_array_elements(v -> 'slots') x where x ->> 'state' <> 'free') then
    raise exception 'FAIL C04b grid: %', v; end if;
  v_err := null; begin perform jc_facility_day(v_fac, v_today + 7); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'OUT_OF_WINDOW' then raise exception 'FAIL C04c beyond window: %', v_err; end if;
  v_err := null; begin perform jc_facility_day(v_fac, v_today - 1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'OUT_OF_WINDOW' then raise exception 'FAIL C04d yesterday: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w5, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_facility_day(v_fac, v_d1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL C04e homeless account read the grid: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  k := k + 5;

  -- ---------- C05 slot rules ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w5, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '09:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL C05a: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '09:30') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SLOT' then raise exception 'FAIL C05b misaligned: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '06:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SLOT' then raise exception 'FAIL C05c before open: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '22:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SLOT' then raise exception 'FAIL C05d past close: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, ((v_today - 1) + time '09:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'OUT_OF_WINDOW' then raise exception 'FAIL C05e past: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, ((v_today + 7) + time '09:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'OUT_OF_WINDOW' then raise exception 'FAIL C05f beyond window: %', v_err; end if;
  v := jc_booking_create(v_fac, (v_d1 + time '09:00') at time zone tz, 'Omar ' || chr(8238) || '— join in');
  v_b1 := (v ->> 'booking_id')::uuid;
  if (select x ->> 'state' from jsonb_array_elements(v -> 'day' -> 'slots') x
       where (x ->> 'starts_at')::timestamptz = (v_d1 + time '09:00') at time zone tz) <> 'mine' then
    raise exception 'FAIL C05g: %', v; end if;
  k := k + 7;

  -- ---------- C06 one booking per home per day (household shares the quota) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '10:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'QUOTA_REACHED' then raise exception 'FAIL C06a household double-dipped: %', v_err; end if;
  perform jc_booking_create(v_fac, ((v_d1 + 1) + time '10:00') at time zone tz, null);  -- next day is fine
  k := k + 1;

  -- ---------- C07 double booking + what other residents see ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '09:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SLOT_TAKEN' then raise exception 'FAIL C07a: %', v_err; end if;
  v_b3 := (jc_booking_create(v_fac, (v_d1 + time '10:00') at time zone tz, 'Gus') ->> 'booking_id')::uuid;
  v := jc_facility_day(v_fac, v_d1);
  select x into v from jsonb_array_elements(v -> 'slots') x
   where (x ->> 'starts_at')::timestamptz = (v_d1 + time '09:00') at time zone tz;
  if v ->> 'state' <> 'booked' or v ->> 'display_name' <> 'Omar — join in'
     or v -> 'booking_id' <> 'null'::jsonb or v -> 'home' <> 'null'::jsonb then
    raise exception 'FAIL C07b resident view of another booking: %', v; end if;
  k := k + 2;

  -- ---------- C08 cancel: own only; slot frees ----------
  v_err := null; begin perform jc_booking_cancel(v_b1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C08a cancelled a neighbour''s booking: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  v := jc_booking_cancel(v_b1);  -- same household as the booker: allowed
  if jsonb_array_length(v) <> 1 then raise exception 'FAIL C08b my_bookings after cancel: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w4, 'role', 'authenticated')::text, true);
  v_b4 := (jc_booking_create(v_fac, (v_d1 + time '09:00') at time zone tz, null) ->> 'booking_id')::uuid;
  k := k + 2;

  -- ---------- C09 admin grid shows homes ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  v := jc_admin_facility_day(v_fac, v_d1);
  if (select x -> 'home' ->> 'number' from jsonb_array_elements(v -> 'slots') x
       where (x ->> 'starts_at')::timestamptz = (v_d1 + time '09:00') at time zone tz) <> '23' then
    raise exception 'FAIL C09: %', v; end if;
  k := k + 1;

  -- ---------- C10 admin cancel needs a reason; the resident sees it ----------
  v_err := null; begin perform jc_admin_booking_cancel(v_b4, ' '); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'REASON_REQUIRED' then raise exception 'FAIL C10a: %', v_err; end if;
  perform jc_admin_booking_cancel(v_b4, 'Court repair');
  perform set_config('request.jwt.claims', json_build_object('sub', w4, 'role', 'authenticated')::text, true);
  if (select x ->> 'cancel_reason' from jsonb_array_elements(jc_my_bookings()) x where (x ->> 'id')::uuid = v_b4) <> 'Court repair' then
    raise exception 'FAIL C10b reason not shown'; end if;
  k := k + 2;

  -- ---------- C11 blocks: cancel only what they cover, stop new bookings, lifted via the admin grid ----------
  v_b4 := (jc_booking_create(v_fac, (v_d1 + time '12:00') at time zone tz, null) ->> 'booking_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', w2, 'role', 'authenticated')::text, true);
  v_b1 := (jc_booking_create(v_fac, (v_d1 + time '14:00') at time zone tz, 'JICM Official') ->> 'booking_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_block_create(v_fac, (v_d1 + time '12:00') at time zone tz, (v_d1 + time '14:00') at time zone tz, 'no'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'REASON_REQUIRED' then raise exception 'FAIL C11a: %', v_err; end if;
  v := jc_admin_block_create(v_fac, (v_d1 + time '12:00') at time zone tz, (v_d1 + time '14:00') at time zone tz, 'Tournament');
  if (v ->> 'bookings_cancelled')::int <> 1 then raise exception 'FAIL C11b: %', v; end if;
  execute 'reset role';
  if (select status from jc_bookings where id = v_b1) <> 'booked' then raise exception 'FAIL C11c adjacent 14:00 booking cancelled'; end if;
  if not exists (select 1 from jc_admin_log where action = 'block_create' and target -> 'bookings_cancelled' ? v_b4::text) then
    raise exception 'FAIL C11d cancelled ids not logged'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', w4, 'role', 'authenticated')::text, true);
  if (select x ->> 'cancel_reason' from jsonb_array_elements(jc_my_bookings()) x where (x ->> 'id')::uuid = v_b4) <> 'Court blocked: Tournament' then
    raise exception 'FAIL C11e'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '13:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SLOT_BLOCKED' then raise exception 'FAIL C11f: %', v_err; end if;
  v := jc_admin_facility_day(v_fac, v_d1);
  select (x ->> 'block_id')::uuid into v_block from jsonb_array_elements(v -> 'slots') x
   where (x ->> 'starts_at')::timestamptz = (v_d1 + time '13:00') at time zone tz;
  if v_block is null then raise exception 'FAIL C11g admin grid has no block id'; end if;
  perform jc_admin_block_remove(v_block);
  v_err := null; begin perform jc_admin_block_remove(v_block); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C11h double remove: %', v_err; end if;
  perform jc_booking_create(v_fac, (v_d1 + time '13:00') at time zone tz, null);
  -- an impersonating name: admin clears it, the booking stays
  perform jc_admin_booking_name_clear(v_b1);
  perform set_config('request.jwt.claims', json_build_object('sub', w3, 'role', 'authenticated')::text, true);
  if (select x -> 'display_name' from jsonb_array_elements(jc_facility_day(v_fac, v_d1) -> 'slots') x
       where (x ->> 'starts_at')::timestamptz = (v_d1 + time '14:00') at time zone tz) <> 'null'::jsonb then
    raise exception 'FAIL C11i name not cleared'; end if;
  k := k + 9;

  -- ---------- C12 the grid is locked while future bookings exist ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_facility_save(v_fac, '{"slot_minutes": 30}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RULES_LOCKED' then raise exception 'FAIL C12a: %', v_err; end if;
  perform jc_admin_facility_save(v_fac, '{"name_en": "Padel One"}');
  k := k + 1;

  -- ---------- C13 community isolation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w8, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_facilities_list()) <> 0 then raise exception 'FAIL C13a'; end if;
  v_err := null; begin perform jc_facility_day(v_fac, v_d1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C13b: %', v_err; end if;
  v_err := null; begin perform jc_booking_create(v_fac, (v_d1 + time '15:00') at time zone tz, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL C13c cross-community booking: %', v_err; end if;
  k := k + 3;

  -- ---------- C14 last member out releases the home's future bookings ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w3, 'role', 'authenticated')::text, true);
  perform jc_home_leave();
  execute 'reset role';
  if (select status || ':' || coalesce(cancel_reason, '') || ':' || coalesce(display_name, '-') from jc_bookings where id = v_b3)
     <> 'cancelled:Household left:-' then
    raise exception 'FAIL C14a: %', (select row(status, cancel_reason, display_name) from jc_bookings where id = v_b3); end if;
  if (select status from jc_bookings where id = v_b1) <> 'booked' then raise exception 'FAIL C14b another home''s booking released'; end if;
  begin perform jc_bookings_cancel_range(null, null, now(), now() + interval '1 day', 'x'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SCOPE' then raise exception 'FAIL C14c unscoped bulk cancel: %', v_err; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', w5, 'role', 'authenticated')::text, true);
  perform jc_home_claim('souk-al-jubail', 'villa', null, '22');  -- the next family moves in
  if jc_my_bookings() <> '[]'::jsonb then raise exception 'FAIL C14d new family sees the last one''s bookings'; end if;
  k := k + 4;

  -- ---------- C15 retiring a court cancels its future bookings ----------
  perform set_config('request.jwt.claims', json_build_object('sub', w6, 'role', 'authenticated')::text, true);
  perform jc_admin_facility_status(v_fac, 'retired');
  execute 'reset role';
  if exists (select 1 from jc_bookings where facility_id = v_fac and status = 'booked') then raise exception 'FAIL C15a'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', w1, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_facilities_list()) <> 0 then raise exception 'FAIL C15b retired court listed'; end if;
  k := k + 2;

  -- ---------- C16 account deletion anonymizes bookings ----------
  perform jc_account_delete('DELETE');
  execute 'reset role';
  if exists (select 1 from jc_bookings where booked_by = w1 or cancelled_by = w1) then raise exception 'FAIL C16a'; end if;
  if not exists (select 1 from jc_bookings where id = v_b1) then raise exception 'FAIL C16b booking history erased'; end if;
  k := k + 2;

  -- ---------- C17 audit trail ----------
  select count(distinct action) into n from jc_admin_log
   where action in ('facility_save', 'facility_status', 'booking_cancel', 'block_create', 'block_remove');
  if n <> 5 then raise exception 'FAIL C17a admin actions logged=% (want 5)', n; end if;
  if not exists (select 1 from jc_state_log where field = 'booking') or not exists (select 1 from jc_state_log where field = 'booking_cancel') then
    raise exception 'FAIL C17b booking activity not logged'; end if;
  k := k + 2;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's3_courts: % checks passed', k;
end
$t$;
