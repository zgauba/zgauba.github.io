-- T5.2 PR 3a behaviour tests: organizer pin moves (home / event-only), broadcast, NO_PIN on
-- sign-up, the event-only pin cleared when a home is vacated, schema wording caps.
-- Runs in its own communities (testville8 / testville8b), so it never depends on jubail.
-- Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  u1 uuid := '00000000-0000-4000-8000-000000000801';  -- organizer (events scope), has a home
  u2 uuid := '00000000-0000-4000-8000-000000000802';  -- resident, home NOT pinned
  u3 uuid := '00000000-0000-4000-8000-000000000803';  -- resident, pinned, signs up
  u4 uuid := '00000000-0000-4000-8000-000000000804';  -- testville8b resident (isolation)
  v jsonb; v_err text; k int := 0;
  v_ev uuid; v_home2 uuid; v_home3 uuid; v_home4 uuid; v_entry3 uuid;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (u1, 'u1@s8.test'), (u2, 'u2@s8.test'), (u3, 'u3@s8.test'), (u4, 'u4@s8.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville8', 'Testville 8', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville8b', 'Testville 8b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville8', 'north', 'North'), ('testville8b', 'north', 'North');
  perform jc_code_set('testville8', 'join', 'S8-JOIN-CODE-01');
  perform jc_code_set('testville8', 'events', 'S8-EVENTS-ADMIN-01');
  perform jc_code_set('testville8b', 'join', 'S8B-JOIN-CODE-01');
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville8', 'block-party', 'Block party', 'live', true, '{"fields": {}}')
  returning id into v_ev;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_join('testville8', 'S8-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '1');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_join('testville8', 'S8-JOIN-CODE-01');
  v_home2 := (jc_home_claim('north', 'villa', null, '2') -> 'home' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_join('testville8', 'S8-JOIN-CODE-01');
  v_home3 := (jc_home_claim('north', 'villa', null, '3') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5310, 54.4310);
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  perform jc_join('testville8b', 'S8B-JOIN-CODE-01');
  v_home4 := (jc_home_claim('north', 'villa', null, '4') -> 'home' ->> 'id')::uuid;

  -- ---------- P01 non-organizers can't call the new RPCs ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_broadcast_set('hi'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL P01a broadcast by resident: %', v_err; end if;
  v_err := null; begin perform jc_admin_home_pin_set(v_home2, 24.53, 54.43); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL P01b home pin by resident: %', v_err; end if;
  v_err := null; begin perform jc_admin_entry_pin_set(gen_random_uuid(), 24.53, 54.43); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL P01c entry pin by resident: %', v_err; end if;
  k := k + 3;

  -- ---------- P02 no pin → NO_PIN (never a silent sign-up off the map) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_signup(v_ev, '{}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_PIN' then raise exception 'FAIL P02 unpinned sign-up: %', v_err; end if;
  if exists (select 1 from jc_event_entries where home_id = v_home2) then raise exception 'FAIL P02b entry written'; end if;
  k := k + 2;

  -- ---------- P03 organizer pins the home → sign-up works; logged with from/to ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_admin_unlock('S8-EVENTS-ADMIN-01');
  v_err := null; begin perform jc_admin_home_pin_set(v_home2, null, 54.43); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PIN' then raise exception 'FAIL P03a null lat: %', v_err; end if;
  v_err := null; begin perform jc_admin_home_pin_set(v_home2, 91, 54.43); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PIN' then raise exception 'FAIL P03b lat 91: %', v_err; end if;
  v := jc_admin_home_pin_set(v_home2, 24.5320, 54.4320);
  if (v ->> 'far')::boolean then raise exception 'FAIL P03c near pin flagged far'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_event_signup(v_ev, '{}');
  execute 'reset role';
  if not exists (select 1 from jc_admin_log where community_id = 'testville8' and action = 'home_pin_set'
                  and target ->> 'home_id' = v_home2::text and target -> 'from' = 'null'::jsonb
                  and target -> 'to' = '[24.532, 54.432]'::jsonb) then
    raise exception 'FAIL P03d home pin move not logged'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- P04 a far pin is flagged; an open pin flag is resolved by the move ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v := jc_admin_home_pin_set(v_home2, 26.0, 56.0);
  if not (v ->> 'far')::boolean then raise exception 'FAIL P04a far pin not flagged'; end if;
  execute 'reset role';
  perform jc_notice('testville8', 'pin_flag', v_home2, '{"pin_far": true}');
  execute 'set local role authenticated';
  perform jc_admin_home_pin_set(v_home2, 24.5320, 54.4320);
  execute 'reset role';
  if exists (select 1 from jc_admin_notices where home_id = v_home2 and kind = 'pin_flag' and resolved_at is null) then
    raise exception 'FAIL P04b pin flag left open'; end if;
  if (select flags ? 'pin_far' from jc_homes where id = v_home2) then raise exception 'FAIL P04c stale pin_far flag'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- P05 isolation: an organizer can't touch another community's home ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_home_pin_set(v_home4, 25.0, 55.0); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P05 cross-community pin move: %', v_err; end if;
  k := k + 1;

  -- ---------- P06 event-only pin: shown instead of the home pin; home pin untouched ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_event_signup(v_ev, '{}');
  execute 'reset role';
  select id into v_entry3 from jc_event_entries where home_id = v_home3 and event_id = v_ev;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_entry_pin_set(v_entry3, 24.5, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PIN' then raise exception 'FAIL P06a half pin: %', v_err; end if;
  v := jc_admin_entry_pin_set(v_entry3, 24.5315, 54.4315);
  if not exists (select 1 from jsonb_array_elements(v) x where x ->> 'id' = v_entry3::text
                  and (x ->> 'event_lat')::float8 = 24.5315 and (x ->> 'home_lat')::float8 = 24.5310) then
    raise exception 'FAIL P06b admin list lacks home + event pins: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v := jc_event_get(v_ev);
  if not exists (select 1 from jsonb_array_elements(v -> 'entries') x where x ->> 'id' = v_entry3::text
                  and (x ->> 'lat')::float8 = 24.5315 and (x ->> 'lng')::float8 = 54.4315 and (x ->> 'event_pin')::boolean) then
    raise exception 'FAIL P06c residents do not see the event-only pin: %', v -> 'entries'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'entries') x where (x ->> 'mine')::boolean
                  and not (x ->> 'event_pin')::boolean and (x ->> 'lat')::float8 = 24.532) then
    raise exception 'FAIL P06d own home pin wrong: %', v -> 'entries'; end if;
  execute 'reset role';
  if (select lat from jc_homes where id = v_home3) <> 24.5310 then raise exception 'FAIL P06e home pin changed'; end if;
  if not exists (select 1 from jc_admin_log where action = 'entry_pin_set' and target ->> 'entry_id' = v_entry3::text
                  and target -> 'to' = '[24.5315, 54.4315]'::jsonb) then raise exception 'FAIL P06f not logged'; end if;
  execute 'set local role authenticated';
  -- clearing goes back to the home's pin
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_admin_entry_pin_set(v_entry3, null, null);
  v := jc_event_get(v_ev);
  if not exists (select 1 from jsonb_array_elements(v -> 'entries') x where x ->> 'id' = v_entry3::text
                  and (x ->> 'lat')::float8 = 24.5310 and not (x ->> 'event_pin')::boolean) then
    raise exception 'FAIL P06g clearing did not restore the home pin'; end if;
  k := k + 7;

  -- ---------- P07 leaving the home clears its event-only pin (new family starts clean) ----------
  perform jc_admin_entry_pin_set(v_entry3, 24.5315, 54.4315);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_home_leave();
  execute 'reset role';
  if (select event_lat from jc_event_entries where id = v_entry3) is not null then
    raise exception 'FAIL P07 event-only pin survived the household leaving'; end if;
  execute 'set local role authenticated';
  k := k + 1;

  -- ---------- P08 broadcast: set, cleaned, capped, cleared, logged; config shows it ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v := jc_admin_broadcast_set(E'  Gate B closed ‮tonight  ');
  if v ->> 'broadcast' <> 'Gate B closed tonight' then raise exception 'FAIL P08a not cleaned: %', v; end if;
  if jc_config_get('testville8') ->> 'broadcast' <> 'Gate B closed tonight' then raise exception 'FAIL P08b config'; end if;
  if jc_config_get('testville8b') ->> 'broadcast' <> '' then raise exception 'FAIL P08c leaked to another community'; end if;
  v_err := null; begin perform jc_admin_broadcast_set(repeat('x', 281)); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'TOO_LONG' then raise exception 'FAIL P08d 281 chars: %', v_err; end if;
  perform jc_admin_broadcast_set(null);
  if jc_config_get('testville8') ->> 'broadcast' <> '' then raise exception 'FAIL P08e not cleared'; end if;
  execute 'reset role';
  if (select count(*) from jc_admin_log where community_id = 'testville8' and action = 'broadcast_set') <> 2 then
    raise exception 'FAIL P08f broadcast changes not logged'; end if;
  execute 'set local role authenticated';
  k := k + 6;

  -- ---------- P09 schema wording caps ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_admin_event_save(null, jsonb_build_object('slug', 's8-ok', 'title_en', 'OK', 'payload_schema',
    '{"fields": {"t": {"type": "enum", "values": ["a", "b"], "label_en": "Treats?", "label_ar": "حلوى؟",
       "labels_en": {"a": "Candy", "b": "Toys"}, "labels_ar": {"a": "حلوى"}, "pin": "glyph",
       "glyphs": {"a": "🍬", "b": "👨‍👩‍👧‍👦"}}}}'::jsonb));
  declare bad jsonb[] := array[
    jsonb_build_object('fields', jsonb_build_object('t', jsonb_build_object('type', 'text', 'label_en', repeat('x', 201)))),
    '{"fields": {"t": {"type": "text", "label_en": ""}}}',
    '{"fields": {"t": {"type": "text", "label_en": 5}}}',
    jsonb_build_object('fields', jsonb_build_object('t', jsonb_build_object('type', 'enum', 'values', '["a"]'::jsonb,
      'labels_en', jsonb_build_object('a', repeat('y', 81))))),
    '{"fields": {"t": {"type": "enum", "values": ["a"], "labels_en": "Candy"}}}',
    '{"fields": {"t": {"type": "enum", "values": ["a"], "labels_ar": {"a": 1}}}}',
    jsonb_build_object('fields', jsonb_build_object('t', jsonb_build_object('type', 'enum', 'values', '["a"]'::jsonb,
      'pin', 'glyph', 'glyphs', jsonb_build_object('a', repeat('🍬', 17))))),
    '{"fields": {"t": {"type": "enum", "values": ["a"], "pin": "fill"}}}',
    '{"fields": {"t": {"type": "text", "pin": "ring"}}}'];
    i int;
  begin
    for i in 1 .. array_length(bad, 1) loop
      v_err := null;
      begin perform jc_admin_event_save(null, jsonb_build_object('slug', 's8-bad-' || i, 'title_en', 'Bad', 'payload_schema', bad[i]));
      exception when others then v_err := sqlerrm; end;
      if v_err is distinct from 'BAD_SCHEMA' then raise exception 'FAIL P09.% accepted bad schema %: %', i, bad[i], v_err; end if;
      k := k + 1;
    end loop;
  end;
  k := k + 1;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's8_pins_broadcast: % checks passed', k;
end
$t$;
