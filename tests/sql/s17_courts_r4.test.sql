-- R4a — courts to spec (docs/plans/R4-courts.md + Zee's 2026-11-08 decisions). Each check fails on the
-- code live before R4a: padel accepted; opt-in names stored and shown; no home labels, no privacy; no
-- Unpublish; no active cap; no walk-on; block reasons hidden from residents; no retention / hourly counts;
-- no effective-rules RPC. Also pins the module-admin model courts rely on (bookings OR community scope).
-- Own communities (testville17 / testville17b). Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  a1 uuid := '00000000-0000-4000-8000-000000001701';  -- community admin
  a2 uuid := '00000000-0000-4000-8000-000000001702';  -- courts admin (bookings code)
  a3 uuid := '00000000-0000-4000-8000-000000001703';  -- events admin (events code)
  a4 uuid := '00000000-0000-4000-8000-000000001704';  -- pets admin (pets code)
  a5 uuid := '00000000-0000-4000-8000-000000001705';  -- per-event admin only
  r1 uuid := '00000000-0000-4000-8000-000000001706';  -- home 1
  r2 uuid := '00000000-0000-4000-8000-000000001707';  -- home 2
  r3 uuid := '00000000-0000-4000-8000-000000001708';  -- home 3 (directory-suppressed)
  b1 uuid := '00000000-0000-4000-8000-000000001709';  -- testville17b courts admin
  tz text := 'Asia/Dubai';
  d1 date; v jsonb; s jsonb; k int := 0; n int; msg text; q text;
  ct uuid; cw uuid; bk1 uuid; bk2 uuid; bk3 uuid; bk_d2 uuid; h1 uuid; h2 uuid; h3 uuid; ev uuid; v_old timestamptz;
begin
  execute $f$create function pg_temp.s17_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s17_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s17_at(d date, t time) returns timestamptz language sql immutable as
    $b$ select (d + t) at time zone 'Asia/Dubai' $b$$f$;
  execute $f$create function pg_temp.s17_slot(day jsonb, ts timestamptz) returns jsonb language sql as
    $b$ select x from jsonb_array_elements(day -> 'slots') x where (x ->> 'starts_at')::timestamptz = ts $b$$f$;
  execute 'grant execute on function pg_temp.s17_as(uuid), pg_temp.s17_err(text), pg_temp.s17_at(date, time),
           pg_temp.s17_slot(jsonb, timestamptz) to authenticated';
  d1 := (now() at time zone tz)::date + 1;

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (a1, 'a1@s17.test'), (a2, 'a2@s17.test'), (a3, 'a3@s17.test'),
    (a4, 'a4@s17.test'), (a5, 'a5@s17.test'), (r1, 'r1@s17.test'), (r2, 'r2@s17.test'), (r3, 'r3@s17.test'),
    (b1, 'b1@s17.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville17', 'Testville 17', 24.53, 54.43,
     '{"bookings": {"enabled": true, "per_home_per_day": 1, "per_home_active": 2}, "events": {"enabled": true}}'),
    ('testville17b', 'Testville 17b', 25.00, 55.00, '{"bookings": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville17', 'north', 'North'), ('testville17b', 'north', 'North');
  perform jc_code_set('testville17', 'join', 'S17-JOIN-CODE-01');
  perform jc_code_set('testville17', 'community', 'S17-COMMUNITY-01');
  perform jc_code_set('testville17', 'bookings', 'S17-BOOKINGS-01');
  perform jc_code_set('testville17', 'events', 'S17-EVENTS-01');
  perform jc_code_set('testville17', 'pets', 'S17-PETS-01');
  perform jc_code_set('testville17b', 'join', 'S17B-JOIN-CODE-01');
  perform jc_code_set('testville17b', 'bookings', 'S17B-BOOKINGS-01');

  execute 'set local role authenticated';
  perform pg_temp.s17_as(a1); perform jc_join('testville17', 'S17-JOIN-CODE-01'); perform jc_admin_unlock('S17-COMMUNITY-01');
  perform pg_temp.s17_as(a2); perform jc_join('testville17', 'S17-JOIN-CODE-01'); perform jc_admin_unlock('S17-BOOKINGS-01');
  perform pg_temp.s17_as(a3); perform jc_join('testville17', 'S17-JOIN-CODE-01'); perform jc_admin_unlock('S17-EVENTS-01');
  perform pg_temp.s17_as(a4); perform jc_join('testville17', 'S17-JOIN-CODE-01'); perform jc_admin_unlock('S17-PETS-01');
  perform pg_temp.s17_as(a5); perform jc_join('testville17', 'S17-JOIN-CODE-01');
  perform pg_temp.s17_as(r1); perform jc_join('testville17', 'S17-JOIN-CODE-01');
  h1 := (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid;
  perform pg_temp.s17_as(r2); perform jc_join('testville17', 'S17-JOIN-CODE-01');
  h2 := (jc_home_claim('north', 'villa', null, '2') -> 'home' ->> 'id')::uuid;
  perform pg_temp.s17_as(r3); perform jc_join('testville17', 'S17-JOIN-CODE-01');
  h3 := (jc_home_claim('north', 'villa', null, '3') -> 'home' ->> 'id')::uuid;
  perform pg_temp.s17_as(b1); perform jc_join('testville17b', 'S17B-JOIN-CODE-01'); perform jc_admin_unlock('S17B-BOOKINGS-01');
  execute 'reset role';
  if h1 is null or h2 is null or h3 is null then raise exception 'FAIL setup: homes %, %, %', h1, h2, h3; end if;
  update jc_homes set directory_suppressed = true where id = h3;
  -- households joined before today (my_bookings shows cancellations made after joining; one transaction = one now())
  update jc_home_members set joined_at = now() - interval '1 day' where user_id in (r1, r2, r3);
  insert into jc_events (community_id, slug, title_en, status) values ('testville17', 's17-night', 'S17 night', 'live') returning id into ev;
  insert into jc_event_admins (event_id, user_id, community_id, granted_by) values (ev, a5, 'testville17', a1);
  execute 'set local role authenticated';

  -- ---------- K01 kinds: tennis | basketball only ----------
  perform pg_temp.s17_as(a2);
  if pg_temp.s17_err($q$select jc_admin_facility_save(null, '{"kind": "padel", "name_en": "P"}')$q$) is distinct from 'BAD_FIELDS'
     or pg_temp.s17_err($q$select jc_admin_facility_save(null, '{"kind": "other", "name_en": "O"}')$q$) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL K01a padel / other still accepted'; end if;
  v := jc_admin_facility_save(null, '{"kind": "tennis", "name_en": "Court A"}');
  select (x ->> 'id')::uuid into ct from jsonb_array_elements(v) x where x ->> 'name_en' = 'Court A';
  v := jc_admin_facility_save(null, '{"kind": "basketball", "name_en": "Hoops", "walk_on": true}');
  select (x ->> 'id')::uuid into cw from jsonb_array_elements(v) x where x ->> 'name_en' = 'Hoops';
  if ct is null or cw is null then raise exception 'FAIL K01b tennis / basketball not created: %', v; end if;
  execute 'reset role';
  begin
    insert into jc_facilities (community_id, kind, name_en) values ('testville17', 'padel', 'Direct');
    msg := null;
  exception when check_violation then msg := 'check';
  end;
  if msg is distinct from 'check' then raise exception 'FAIL K01c the table accepts padel'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- W01 walk-on courts: listed, no grid, no booking ----------
  perform pg_temp.s17_as(a2);
  if pg_temp.s17_err(format('select jc_admin_facility_save(%L, %L)', cw, '{"walk_on": "yes"}')) is distinct from 'BAD_FIELDS'
     or pg_temp.s17_err(format('select jc_admin_facility_save(%L, %L)', cw, '{"walk_on": 1}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL W01a walk_on accepts a non-boolean'; end if;
  perform jc_admin_facility_status(cw, 'published');
  perform jc_admin_facility_status(ct, 'published');
  if (select (x ->> 'walk_on')::boolean from jsonb_array_elements(jc_admin_facilities_list()) x where (x ->> 'id')::uuid = cw) is not true then
    raise exception 'FAIL W01b admin list has no walk_on'; end if;
  perform pg_temp.s17_as(r1);
  v := jc_facilities_list();
  if jsonb_array_length(v) <> 2
     or (select (x ->> 'walk_on')::boolean from jsonb_array_elements(v) x where (x ->> 'id')::uuid = cw) is not true
     or (select (x ->> 'walk_on')::boolean from jsonb_array_elements(v) x where (x ->> 'id')::uuid = ct) is not false then
    raise exception 'FAIL W01c resident list: %', v; end if;
  if pg_temp.s17_err(format('select jc_facility_day(%L, %L)', cw, d1)) is distinct from 'WALK_ON' then
    raise exception 'FAIL W01d a walk-on court has a grid'; end if;
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', cw, pg_temp.s17_at(d1, '09:00'))) is distinct from 'WALK_ON'
     or pg_temp.s17_err(format('select jc_booking_create(%L, %L, null)', cw, pg_temp.s17_at(d1, '09:00'))) is distinct from 'WALK_ON' then
    raise exception 'FAIL W01e a walk-on court took a booking'; end if;
  k := k + 5;

  -- ---------- N01 no names, ever ----------
  bk1 := (jc_booking_create(ct, pg_temp.s17_at(d1, '09:00'), 'Ahmed from villa 1') ->> 'booking_id')::uuid;
  execute 'reset role';
  if (select display_name from jc_bookings where id = bk1) is not null then raise exception 'FAIL N01a the name was stored'; end if;
  begin
    update jc_bookings set display_name = 'Ahmed' where id = bk1;
    msg := null;
  exception when check_violation then msg := 'check';
  end;
  if msg is distinct from 'check' then raise exception 'FAIL N01b the table accepts a name'; end if;
  execute 'set local role authenticated';
  k := k + 2;

  -- ---------- P01 other residents see the home label (never a name, never an id) unless private ----------
  perform pg_temp.s17_as(r2);
  s := pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '09:00'));
  if s ->> 'state' is distinct from 'booked' or s ? 'display_name' or s -> 'booking_id' is distinct from 'null'::jsonb
     or s -> 'is_private' is distinct from 'null'::jsonb or s -> 'home' ? 'id'
     or s -> 'home' ->> 'number' is distinct from '1' or s -> 'home' ->> 'village' is distinct from 'north' then
    raise exception 'FAIL P01a neighbour view of a public booking: %', s; end if;
  if pg_temp.s17_err(format('select jc_booking_privacy_set(%L, true)', bk1)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL P01b another home changed my privacy'; end if;
  perform pg_temp.s17_as(r1);
  if pg_temp.s17_err(format('select jc_booking_privacy_set(%L, null)', bk1)) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL P01c null privacy accepted'; end if;
  v := jc_booking_privacy_set(bk1, true);
  if (select (x ->> 'is_private')::boolean from jsonb_array_elements(v) x where (x ->> 'id')::uuid = bk1) is not true
     or exists (select 1 from jsonb_array_elements(v) x where x ? 'display_name') then
    raise exception 'FAIL P01d my bookings after privacy_set: %', v; end if;
  s := pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '09:00'));
  if s ->> 'state' is distinct from 'mine' or (s ->> 'booking_id')::uuid is distinct from bk1 or (s ->> 'is_private')::boolean is not true then
    raise exception 'FAIL P01e own view: %', s; end if;
  perform pg_temp.s17_as(r2);
  s := pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '09:00'));
  if s ->> 'state' is distinct from 'booked' or s -> 'home' is distinct from 'null'::jsonb then raise exception 'FAIL P01f private booking shows the home: %', s; end if;
  -- private at booking time (no visible window); a null flag fails closed
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, null)', ct, pg_temp.s17_at(d1, '11:00'))) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL P01k a null privacy flag booked'; end if;
  bk2 := (jc_booking_book(ct, pg_temp.s17_at(d1, '11:00'), true) ->> 'booking_id')::uuid;
  perform pg_temp.s17_as(r1);
  s := pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '11:00'));
  if s ->> 'state' is distinct from 'booked' or s -> 'home' is distinct from 'null'::jsonb then raise exception 'FAIL P01g booked-private shows the home: %', s; end if;
  -- a directory-suppressed home always shows as "Booked"
  perform pg_temp.s17_as(r3);
  bk3 := (jc_booking_book(ct, pg_temp.s17_at(d1, '10:00'), false) ->> 'booking_id')::uuid;
  perform pg_temp.s17_as(r1);
  s := pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '10:00'));
  if s ->> 'state' is distinct from 'booked' or s -> 'home' is distinct from 'null'::jsonb then raise exception 'FAIL P01h suppressed home shown: %', s; end if;
  -- admins always see the home and the privacy flag
  perform pg_temp.s17_as(a2);
  s := pg_temp.s17_slot(jc_admin_facility_day(ct, d1), pg_temp.s17_at(d1, '09:00'));
  if (s -> 'home' ->> 'id')::uuid is distinct from h1 or (s ->> 'is_private')::boolean is not true or s ? 'display_name' then
    raise exception 'FAIL P01i admin view: %', s; end if;
  -- and back to public
  perform pg_temp.s17_as(r1);
  perform jc_booking_privacy_set(bk1, false);
  perform pg_temp.s17_as(r2);
  if pg_temp.s17_slot(jc_facility_day(ct, d1), pg_temp.s17_at(d1, '09:00')) -> 'home' ->> 'number' is distinct from '1' then
    raise exception 'FAIL P01j un-private did not restore the label'; end if;
  k := k + 11;

  -- ---------- A01 at most N upcoming bookings per home (default 2), daily cap still first ----------
  perform pg_temp.s17_as(r1);
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', ct, pg_temp.s17_at(d1, '12:00'))) is distinct from 'QUOTA_REACHED' then
    raise exception 'FAIL A01a daily cap'; end if;
  bk_d2 := (jc_booking_book(ct, pg_temp.s17_at(d1 + 1, '09:00'), false) ->> 'booking_id')::uuid;
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', ct, pg_temp.s17_at(d1 + 2, '09:00'))) is distinct from 'ACTIVE_CAP_REACHED' then
    raise exception 'FAIL A01b a third upcoming booking was allowed'; end if;
  perform jc_booking_cancel(bk_d2);
  if pg_temp.s17_err(format('select jc_booking_privacy_set(%L, true)', bk_d2)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL A01g privacy set on a cancelled booking'; end if;
  perform jc_booking_book(ct, pg_temp.s17_at(d1 + 2, '09:00'), false);              -- a cancel frees one
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{bookings,per_home_active}', '"two"') where id = 'testville17';
  execute 'set local role authenticated';
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', ct, pg_temp.s17_at(d1 + 3, '09:00'))) is distinct from 'ACTIVE_CAP_REACHED' then
    raise exception 'FAIL A01c a malformed cap is not the strict default'; end if;
  perform pg_temp.s17_as(a2);
  v := jc_admin_booking_rules();
  if v ->> 'per_home_active' is distinct from '2' or v -> 'configured' ->> 'per_home_active' is distinct from 'two'
     or v ->> 'per_home_per_day' is distinct from '1' or (v ->> 'enabled')::boolean is not true
     or v ->> 'retention_days' is distinct from '90' then
    raise exception 'FAIL A01d effective rules: %', v; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{bookings,per_home_active}', '3') where id = 'testville17';
  execute 'set local role authenticated';
  perform pg_temp.s17_as(r1);
  perform jc_booking_book(ct, pg_temp.s17_at(d1 + 3, '09:00'), false);              -- raised cap honoured
  perform pg_temp.s17_as(a2);
  if jc_admin_booking_rules() ->> 'per_home_active' is distinct from '3' then raise exception 'FAIL A01e raised cap not reported'; end if;
  perform pg_temp.s17_as(r1);
  if pg_temp.s17_err('select jc_admin_booking_rules()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL A01f a resident read the admin rules'; end if;
  k := k + 7;

  -- ---------- B01 residents read a block's (cleaned) reason ----------
  perform pg_temp.s17_as(a2);
  perform jc_admin_block_create(ct, pg_temp.s17_at(d1 + 4, '08:00'), pg_temp.s17_at(d1 + 4, '10:00'), 'Resurf' || chr(8203) || 'acing');
  perform pg_temp.s17_as(r2);
  s := pg_temp.s17_slot(jc_facility_day(ct, d1 + 4), pg_temp.s17_at(d1 + 4, '09:00'));
  if s ->> 'state' is distinct from 'blocked' or s ->> 'block_reason' is distinct from 'Resurfacing' or s -> 'block_id' is distinct from 'null'::jsonb then
    raise exception 'FAIL B01a resident view of a block: %', s; end if;
  if pg_temp.s17_slot(jc_facility_day(ct, d1 + 4), pg_temp.s17_at(d1 + 4, '11:00')) -> 'block_reason' is distinct from 'null'::jsonb then
    raise exception 'FAIL B01b a free slot carries a reason'; end if;
  k := k + 2;

  -- ---------- M01 module admins: courts = bookings OR community scope, nobody else ----------
  foreach q in array array['select jc_admin_facilities_list()', 'select jc_admin_booking_rules()',
                           format('select jc_admin_facility_day(%L, %L)', ct, d1),
                           format('select jc_admin_facility_save(%L, %L)', ct, '{"sort": 1}'),
                           format('select jc_admin_facility_status(%L, %L)', ct, 'retired'),
                           format('select jc_admin_booking_cancel(%L, %L)', bk1, 'No reason'),
                           format('select jc_admin_block_create(%L, %L, %L, %L)', ct, pg_temp.s17_at(d1 + 5, '08:00'), pg_temp.s17_at(d1 + 5, '09:00'), 'Nope')] loop
    perform pg_temp.s17_as(a3); msg := pg_temp.s17_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL M01a events admin: % -> %', q, msg; end if;
    perform pg_temp.s17_as(a4); msg := pg_temp.s17_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL M01b pets admin: % -> %', q, msg; end if;
    perform pg_temp.s17_as(a5); msg := pg_temp.s17_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL M01c per-event admin: % -> %', q, msg; end if;
    perform pg_temp.s17_as(r2); msg := pg_temp.s17_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL M01d resident: % -> %', q, msg; end if;
  end loop;
  perform pg_temp.s17_as(a1);
  if jsonb_array_length(jc_admin_facilities_list()) <> 2 or jc_admin_booking_rules() is null then
    raise exception 'FAIL M01e community admin is not a courts admin'; end if;
  k := k + 5;

  -- ---------- X01 another community's courts admin can't touch ours ----------
  perform pg_temp.s17_as(b1);
  if jsonb_array_length(jc_admin_facilities_list()) <> 0 then raise exception 'FAIL X01a cross-community list'; end if;
  foreach q in array array[format('select jc_admin_facility_day(%L, %L)', ct, d1),
                           format('select jc_admin_facility_save(%L, %L)', ct, '{"sort": 1}'),
                           format('select jc_admin_facility_status(%L, %L)', ct, 'draft'),
                           format('select jc_admin_booking_cancel(%L, %L)', bk1, 'Cross community'),
                           format('select jc_admin_block_create(%L, %L, %L, %L)', ct, pg_temp.s17_at(d1 + 5, '08:00'), pg_temp.s17_at(d1 + 5, '09:00'), 'Cross community')] loop
    msg := pg_temp.s17_err(q);
    if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL X01b %: %', q, msg; end if;
  end loop;
  k := k + 2;

  -- ---------- K02 kill switch: hides and freezes, keeps bookings ----------
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{bookings,enabled}', 'false') where id = 'testville17';
  select count(*) into n from jc_bookings where community_id = 'testville17' and status = 'booked';
  execute 'set local role authenticated';
  perform pg_temp.s17_as(r1);
  if pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', ct, pg_temp.s17_at(d1 + 5, '09:00'))) is distinct from 'MODULE_OFF'
     or pg_temp.s17_err(format('select jc_booking_privacy_set(%L, true)', bk1)) is distinct from 'MODULE_OFF'
     or pg_temp.s17_err('select jc_my_bookings()') is distinct from 'MODULE_OFF' then
    raise exception 'FAIL K02a a resident RPC ran with the module off'; end if;
  perform pg_temp.s17_as(a2);
  if (jc_admin_booking_rules() ->> 'enabled')::boolean is not false then raise exception 'FAIL K02b rules do not show the switch'; end if;
  execute 'reset role';
  if (select count(*) from jc_bookings where community_id = 'testville17' and status = 'booked') <> n then
    raise exception 'FAIL K02c switching off touched bookings'; end if;
  update jc_communities set modules = jsonb_set(modules, '{bookings,enabled}', 'true') where id = 'testville17';
  execute 'set local role authenticated';
  perform pg_temp.s17_as(r1);
  if jsonb_array_length(jc_my_bookings()) < 3 then raise exception 'FAIL K02d bookings not back after switching on'; end if;
  k := k + 4;

  -- ---------- U01 Unpublish cancels future bookings with a reason; re-publish works ----------
  perform pg_temp.s17_as(a2);
  if pg_temp.s17_err(format('select jc_admin_facility_save(%L, %L)', ct, '{"walk_on": true}')) is distinct from 'RULES_LOCKED' then
    raise exception 'FAIL U01a walk-on switched under live bookings'; end if;
  perform jc_admin_facility_save(ct, '{"walk_on": false}');
  perform jc_admin_facility_status(ct, 'draft');
  execute 'reset role';
  if exists (select 1 from jc_bookings where facility_id = ct and status = 'booked')
     or (select cancel_reason from jc_bookings where id = bk1) is distinct from 'Court temporarily unavailable' then
    raise exception 'FAIL U01b unpublish left bookings or no reason'; end if;
  if not exists (select 1 from jc_admin_log where action = 'facility_status' and target ->> 'status' = 'draft'
                  and target -> 'bookings_cancelled' ? bk1::text) then
    raise exception 'FAIL U01c cancelled ids not logged'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s17_as(r1);
  if (select x ->> 'cancel_reason' from jsonb_array_elements(jc_my_bookings()) x where (x ->> 'id')::uuid = bk1)
     is distinct from 'Court temporarily unavailable' then raise exception 'FAIL U01d the home was not told'; end if;
  if jsonb_array_length(jc_facilities_list()) <> 1
     or pg_temp.s17_err(format('select jc_facility_day(%L, %L)', ct, d1)) is distinct from 'NOT_FOUND'
     or pg_temp.s17_err(format('select jc_booking_book(%L, %L, false)', ct, pg_temp.s17_at(d1 + 5, '09:00'))) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL U01e an unpublished court is still visible / bookable'; end if;
  perform pg_temp.s17_as(a2);
  if pg_temp.s17_err(format('select jc_admin_facility_status(%L, %L)', ct, 'draft')) is distinct from 'BAD_STATE' then
    raise exception 'FAIL U01f draft -> draft'; end if;
  perform jc_admin_facility_status(ct, 'published');
  perform jc_admin_facility_save(ct, '{"walk_on": true}');                             -- no live bookings now: allowed
  perform jc_admin_facility_save(ct, '{"walk_on": false}');
  perform pg_temp.s17_as(r1);
  if jc_booking_book(ct, pg_temp.s17_at(d1 + 5, '09:00'), false) ->> 'booking_id' is null then
    raise exception 'FAIL U01g a re-published court takes bookings'; end if;
  k := k + 7;

  -- ---------- S01 snapshot canary: bookings made through the RPC are counted ----------
  execute 'reset role';
  perform jc_snapshot_run(now());
  if coalesce((select (metrics ->> 'created_24h')::int from jc_snapshots
       where community_id = 'testville17' and module = 'bookings' and bucket = date_trunc('hour', now())), 0) < 6 then
    raise exception 'FAIL S01 created_24h missed RPC bookings'; end if;
  k := k + 1;

  -- ---------- R01 retention: rows go 90 days after the slot, hourly counts stay (no home, no user) ----------
  v_old := date_trunc('hour', now() - interval '100 days');
  insert into jc_bookings (community_id, facility_id, home_id, booked_by, starts_at, ends_at) values
    ('testville17', ct, h1, r1, v_old, v_old + interval '1 hour'),
    ('testville17', ct, h2, r2, now() - interval '10 days', now() - interval '10 days' + interval '1 hour');
  insert into jc_bookings (community_id, facility_id, home_id, booked_by, starts_at, ends_at, status, cancelled_at) values
    ('testville17', ct, h2, r2, v_old, v_old + interval '1 hour', 'cancelled', v_old - interval '1 day');
  insert into jc_booking_blocks (community_id, facility_id, starts_at, ends_at, reason, removed_at) values
    ('testville17', ct, v_old, v_old + interval '2 hours', 'Old removed', v_old);
  insert into jc_booking_blocks (community_id, facility_id, starts_at, ends_at, reason) values
    ('testville17', ct, v_old, v_old + interval '2 hours', 'Old kept');
  insert into jc_state_log (community_id, field, value, actor, at) values
    ('testville17', 'booking', '{"s17": "old"}', r1, now() - interval '100 days'),
    ('testville17', 'booking', '{"s17": "new"}', r1, now() - interval '1 day');
  n := jc_courts_retention();
  if n < 2 or exists (select 1 from jc_bookings where facility_id = ct and starts_at = v_old) then
    raise exception 'FAIL R01a old bookings kept (deleted %)', n; end if;
  if not exists (select 1 from jc_bookings where facility_id = ct and starts_at < now() - interval '9 days') then
    raise exception 'FAIL R01b a 10-day-old booking was deleted'; end if;
  if (select row(booked, cancelled)::text from jc_court_hours where facility_id = ct and hour = v_old) is distinct from '(1,1)'
     or (select booked from jc_court_hours where facility_id = ct and hour = date_trunc('hour', now() - interval '10 days')) is distinct from 1 then
    raise exception 'FAIL R01c hourly counts: %', (select jsonb_agg(to_jsonb(c)) from jc_court_hours c where facility_id = ct); end if;
  if (select array_agg(column_name::text order by column_name) from information_schema.columns
       where table_schema = 'public' and table_name = 'jc_court_hours')
     is distinct from array['booked', 'cancelled', 'community_id', 'facility_id', 'hour', 'updated_at'] then
    raise exception 'FAIL R01d jc_court_hours gained a column (no home, no user)'; end if;
  if exists (select 1 from jc_booking_blocks where facility_id = ct and reason = 'Old removed')
     or not exists (select 1 from jc_booking_blocks where facility_id = ct and reason = 'Old kept') then
    raise exception 'FAIL R01e blocks: removed old ones go, live ones stay'; end if;
  if exists (select 1 from jc_state_log where value ->> 's17' = 'old')
     or not exists (select 1 from jc_state_log where value ->> 's17' = 'new') then
    raise exception 'FAIL R01f booking log retention'; end if;
  if not exists (select 1 from jc_maintenance_log where job = 'courts_purge' and at = now()) then
    raise exception 'FAIL R01g run not logged'; end if;
  -- idempotent, and keyed on UTC hours whatever the session time zone (+05:30 here)
  select count(*) into n from jc_court_hours where facility_id = ct;
  set local timezone = 'Asia/Kolkata';
  perform jc_courts_retention();
  reset timezone;
  if (select count(*) from jc_court_hours where facility_id = ct) <> n
     or exists (select 1 from jc_court_hours where facility_id = ct and extract(minute from hour at time zone 'UTC') <> 0) then
    raise exception 'FAIL R01j a non-UTC session re-keyed the hours'; end if;
  if (select row(booked, cancelled)::text from jc_court_hours where facility_id = ct and hour = v_old) is distinct from '(1,1)' then
    raise exception 'FAIL R01h a second run changed the kept counts'; end if;
  if not exists (select 1 from cron.job where jobname = 'jc-courts-purge' and schedule = '45 3 * * *'
                  and command = 'select public.jc_courts_retention()' and active) then
    raise exception 'FAIL R01i cron job missing'; end if;
  k := k + 10;

  -- ---------- G01 new functions: definer, pinned path, grants ----------
  if exists (select 1 from pg_proc p where p.oid in ('public.jc_booking_book(uuid, timestamptz, boolean)'::regprocedure,
                                                      'public.jc_booking_privacy_set(uuid, boolean)'::regprocedure,
                                                      'public.jc_admin_booking_rules()'::regprocedure)
              and (not p.prosecdef
                   or not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, '{}')))
                   or has_function_privilege('anon', p.oid, 'execute')
                   or not has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'FAIL G01a a new RPC is not definer / pinned / authenticated-only'; end if;
  if has_function_privilege('authenticated', 'public.jc_courts_retention()', 'execute')
     or has_function_privilege('authenticated', 'public.jc_booking_active_cap(text)', 'execute')
     or has_function_privilege('authenticated', 'public.jc_facility_grid(uuid, text, date, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.jc_courts_retention()', 'execute') then
    raise exception 'FAIL G01b an internal courts helper is callable'; end if;
  k := k + 2;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's17_courts_r4: % checks passed', k;
end
$t$;
