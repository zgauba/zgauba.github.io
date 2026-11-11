-- R5a — Pets to spec: known & fine, territory, care record, sightings only for missing pets / strays,
-- sightings retention (reporter erased after 24 h, rows deleted after 30 days), the missing-pet show-home
-- opt-in, and the members-only pets WhatsApp group link.
-- Own communities (testville21 / testville21b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  o1 uuid := '00000000-0000-4000-8000-000000002101';  -- owner, home 1 (directory-hidden)
  o2 uuid := '00000000-0000-4000-8000-000000002102';  -- neighbor, home 2
  ad uuid := '00000000-0000-4000-8000-000000002103';  -- Pets admin (code unlock), home 3
  x1 uuid := '00000000-0000-4000-8000-000000002104';  -- testville21b member
  v jsonb; k int := 0; msg text; n int;
  v_dog uuid; v_cat uuid; v_fine uuid; v_old bigint; v_recent bigint; v_ancient bigint; v_h2 uuid;
begin
  execute $f$create function pg_temp.s21_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s21_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s21_as(uuid), pg_temp.s21_err(text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (o1, 'o1@s21.test'), (o2, 'o2@s21.test'), (ad, 'ad@s21.test'), (x1, 'x1@s21.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville21', 'Testville 21', 24.53, 54.43, '{"pets": {"enabled": true}}'),
    ('testville21b', 'Testville 21b', 25.00, 55.00, '{"pets": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville21', 'north', 'North'), ('testville21b', 'north', 'North');
  perform jc_code_set('testville21', 'join', 'S21-JOIN-CODE-01');
  perform jc_code_set('testville21', 'pets', 'S21-PETS-ADMIN-01');
  perform jc_code_set('testville21', 'community', 'S21-COMMUNITY-01');
  perform jc_code_set('testville21b', 'join', 'S21-JOIN-CODE-02');

  execute 'set local role authenticated';
  perform pg_temp.s21_as(o1); perform jc_join('testville21', 'S21-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '1');
  perform pg_temp.s21_as(o2); perform jc_join('testville21', 'S21-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '2');
  perform pg_temp.s21_as(ad); perform jc_join('testville21', 'S21-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '3');
  perform jc_admin_unlock('S21-PETS-ADMIN-01');
  perform pg_temp.s21_as(x1); perform jc_join('testville21b', 'S21-JOIN-CODE-02');
  perform pg_temp.s21_as(o1);
  v_dog := (jc_pet_save(null, '{"species": "dog", "name": "Biscuit"}') ->> 'id')::uuid;
  execute 'reset role';
  update jc_homes set directory_suppressed = true
   where id = (select home_id from jc_home_members where user_id = o1);
  select home_id into v_h2 from jc_home_members where user_id = o2;

  -- ---------- R01 known & fine: a 4th care state; filters split strays / community ----------
  execute 'set local role authenticated';
  perform pg_temp.s21_as(ad);
  v_cat := (jc_admin_stray_save(null, '{"species": "cat", "name": "Snow"}') ->> 'id')::uuid;
  v := jc_admin_stray_save(null, '{"species": "cat", "name": "Caramel", "care_state": "known_fine"}');
  v_fine := (v ->> 'id')::uuid;
  if v ->> 'care_state' <> 'known_fine' then raise exception 'FAIL R01a known_fine not saved: %', v; end if;
  perform pg_temp.s21_as(o2);
  v := jc_pets_list('strays');
  if jsonb_array_length(v) <> 1 or (v -> 0 ->> 'id')::uuid <> v_cat then raise exception 'FAIL R01b strays filter: %', v; end if;
  v := jc_pets_list('community');
  if jsonb_array_length(v) <> 1 or (v -> 0 ->> 'id')::uuid <> v_fine then raise exception 'FAIL R01c community filter: %', v; end if;
  if jsonb_array_length(jc_pets_list('all')) <> 3 then raise exception 'FAIL R01d all: %', jc_pets_list('all'); end if;
  k := k + 4;

  -- ---------- R02 owned pets never carry territory or a care record ----------
  execute 'reset role';
  msg := null; begin update jc_pets set territory = 'Park' where id = v_dog; exception when check_violation then msg := 'ok'; end;
  if msg is null then raise exception 'FAIL R02a owned pet took a territory'; end if;
  msg := null; begin update jc_pets set care = '{"sterilized": {"s": "done"}}' where id = v_dog; exception when check_violation then msg := 'ok'; end;
  if msg is null then raise exception 'FAIL R02b owned pet took a care record'; end if;
  msg := null; begin update jc_pets set territory_lat = 24.5 where id = v_cat; exception when check_violation then msg := 'ok'; end;
  if msg is null then raise exception 'FAIL R02c half a territory spot'; end if;
  k := k + 3;

  -- ---------- R03 territory via jc_admin_stray_save ----------
  execute 'set local role authenticated';
  perform pg_temp.s21_as(ad);
  v := jc_admin_stray_save(v_cat, '{"territory": "  Souk — near the fountain  ", "territory_lat": 24.54, "territory_lng": 54.44}');
  if v ->> 'territory' <> 'Souk — near the fountain' or (v ->> 'territory_lat')::float <> 24.54 then
    raise exception 'FAIL R03a territory: %', v; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory": 5}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03b number territory: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory_lat": 24.5}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03c lat without lng: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory_lat": "24.5", "territory_lng": "54.4"}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03d string spot: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory_lat": 24.5, "territory_lng": null}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03e half-null spot: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory_lat": 100, "territory_lng": 54.4}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03f lat out of range: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory_lat": 1e400, "territory_lng": 1}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03f2 lat beyond double (db L1): %', msg; end if;
  k := k + 1;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, jsonb_build_object('territory', repeat('x', 121))));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03g 121 chars: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory": "   "}'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R03h blank territory: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_dog, '{"territory": "Park"}'));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL R03i territory on an owned pet: %', msg; end if;
  v := jc_admin_stray_save(v_cat, '{"territory": null, "territory_lat": null, "territory_lng": null}');
  if v ->> 'territory' is not null or v ->> 'territory_lat' is not null then raise exception 'FAIL R03j clear: %', v; end if;
  perform jc_admin_stray_save(v_cat, '{"territory": "Souk", "territory_lat": 24.54, "territory_lng": 54.44}');
  perform pg_temp.s21_as(o2);
  msg := pg_temp.s21_err(format('select jc_admin_stray_save(%L, %L)', v_cat, '{"territory": "Mine"}'));
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL R03k resident set territory: %', msg; end if;
  k := k + 11;

  -- ---------- R04 care record ----------
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, null, null)', v_cat, 'sterilized', 'done'));
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL R04a resident set care: %', msg; end if;
  perform pg_temp.s21_as(ad);
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, null, null)', v_cat, 'rabies', 'done'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04b bad item: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, null, null)', v_cat, 'dewormed', 'maybe'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04c bad status: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, %L, null)', v_cat, 'dewormed', 'done', '1999-12-31'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04d ancient date: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, %L, null)', v_cat, 'dewormed', 'due', (now() + interval '3 years')::date));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04d2 date 3 years out: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, null, null, null)', v_cat, 'dewormed'));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04d3 null status: %', msg; end if;
  v := jc_admin_pet_care_set(v_cat, 'dewormed', 'unknown', null, null);
  if v -> 'care' <> '{}'::jsonb then raise exception 'FAIL R04d4 unknown on a missing item: %', v -> 'care'; end if;
  k := k + 3;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, null, %L)', v_cat, 'dewormed', 'done', repeat('y', 121)));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R04e long note: %', msg; end if;
  msg := pg_temp.s21_err(format('select jc_admin_pet_care_set(%L, %L, %L, null, null)', v_dog, 'dewormed', 'done'));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL R04f care on an owned pet: %', msg; end if;
  perform jc_admin_pet_care_set(v_cat, 'sterilized', 'done', null, 'ear-tipped');
  perform jc_admin_pet_care_set(v_cat, 'vaccination', 'due', (now() + interval '7 days')::date, 'booster');
  v := jc_admin_pet_care_set(v_cat, 'treatment', 'ongoing', null, 'eye drops');
  if v -> 'care' -> 'sterilized' ->> 's' <> 'done' or v -> 'care' -> 'sterilized' ->> 'n' <> 'ear-tipped'
     or v -> 'care' -> 'vaccination' ->> 'd' <> (now() + interval '7 days')::date::text
     or (select count(*) from jsonb_object_keys(v -> 'care')) <> 3 then raise exception 'FAIL R04g care: %', v -> 'care'; end if;
  v := jc_admin_pet_care_set(v_cat, 'treatment', 'unknown', null, null);
  if v -> 'care' ? 'treatment' then raise exception 'FAIL R04h unknown should remove: %', v -> 'care'; end if;
  perform pg_temp.s21_as(o2);
  v := jc_pet_get(v_cat);
  if v -> 'care' -> 'sterilized' ->> 's' <> 'done' or v ->> 'territory' <> 'Souk' then raise exception 'FAIL R04i resident view: %', v; end if;
  if jc_pet_get(v_dog) -> 'care' <> 'null'::jsonb then raise exception 'FAIL R04j owned card has care: %', jc_pet_get(v_dog) -> 'care'; end if;
  k := k + 10;

  -- ---------- R05 sightings: only for a missing pet or a stray / community animal ----------
  msg := pg_temp.s21_err(format('select jc_pet_sighting_add(%L, %L, null, null)', v_dog, 'by the park'));
  if msg is distinct from 'SIGHTINGS_CLOSED' then raise exception 'FAIL R05a sighting on a pet at home: %', msg; end if;
  perform jc_pet_sighting_add(v_cat, 'near the fountain', 24.54, 54.44);
  perform jc_pet_sighting_add(v_fine, null, null, null);
  perform pg_temp.s21_as(o1);
  perform jc_pet_missing_set(v_dog, true, 'slipped out the gate');
  perform pg_temp.s21_as(o2);
  perform jc_pet_sighting_add(v_dog, 'by the park', 24.55, 54.45);
  perform pg_temp.s21_as(o1);
  v := jc_pet_get(v_dog);
  if jsonb_array_length(v -> 'sightings') <> 1 or v -> 'sightings' -> 0 ? 'reporter'
     or (v -> 'sightings' -> 0 ->> 'by_me')::boolean then raise exception 'FAIL R05b owner view of a sighting: %', v -> 'sightings'; end if;
  -- found closes sightings again; a rehomed stray takes none (security L4)
  perform jc_pet_missing_set(v_dog, false, null);
  perform pg_temp.s21_as(o2);
  msg := pg_temp.s21_err(format('select jc_pet_sighting_add(%L, null, null, null)', v_dog));
  if msg is distinct from 'SIGHTINGS_CLOSED' then raise exception 'FAIL R05c found pet still open: %', msg; end if;
  perform pg_temp.s21_as(ad);
  v := jc_admin_stray_save(null, '{"species": "dog", "name": "Lucky", "care_state": "rehomed"}');
  perform pg_temp.s21_as(o2);
  msg := pg_temp.s21_err(format('select jc_pet_sighting_add(%L, null, null, null)', v ->> 'id'));
  if msg is distinct from 'SIGHTINGS_CLOSED' then raise exception 'FAIL R05d rehomed stray open: %', msg; end if;
  perform pg_temp.s21_as(o1);
  perform jc_pet_missing_set(v_dog, true, null);
  k := k + 4;

  -- ---------- R06 missing pet from a directory-hidden home: show-home opt-in ----------
  perform pg_temp.s21_as(o2);
  if jc_pet_get(v_dog) -> 'home' <> 'null'::jsonb then raise exception 'FAIL R06a hidden home shown without opt-in'; end if;
  msg := pg_temp.s21_err(format('select jc_pet_missing_home_set(%L, true)', v_dog));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL R06b neighbor opted in: %', msg; end if;
  perform pg_temp.s21_as(o1);
  msg := pg_temp.s21_err(format('select jc_pet_missing_home_set(%L, null)', v_dog));
  if msg is distinct from 'BAD_FIELDS' then raise exception 'FAIL R06c null: %', msg; end if;
  v := jc_pet_missing_home_set(v_dog, true);
  if not (v ->> 'show_home')::boolean then raise exception 'FAIL R06d opt-in: %', v; end if;
  perform pg_temp.s21_as(o2);
  if jc_pet_get(v_dog) -> 'home' ->> 'number' is distinct from '1' then raise exception 'FAIL R06e opted-in home hidden: %', jc_pet_get(v_dog); end if;
  if jc_pet_get(v_dog) -> 'show_home' <> 'null'::jsonb then raise exception 'FAIL R06e2 neighbor sees the opt-in flag (security L2)'; end if;
  -- found: opt-in cleared, home hidden again; a new "missing" starts hidden
  perform pg_temp.s21_as(o1);
  v := jc_pet_missing_set(v_dog, false, null);
  if (v ->> 'show_home')::boolean then raise exception 'FAIL R06f found kept the opt-in'; end if;
  msg := pg_temp.s21_err(format('select jc_pet_missing_home_set(%L, true)', v_dog));
  if msg is distinct from 'NOT_MISSING' then raise exception 'FAIL R06g opt-in while home: %', msg; end if;
  perform jc_pet_missing_set(v_dog, true, null);
  perform pg_temp.s21_as(o2);
  if jc_pet_get(v_dog) -> 'home' <> 'null'::jsonb then raise exception 'FAIL R06h re-missing started shown'; end if;
  -- archiving an opted-in missing pet works (constraint) and clears it
  perform pg_temp.s21_as(o1);
  perform jc_pet_missing_home_set(v_dog, true);
  perform jc_pet_archive(v_dog);
  execute 'reset role';
  if (select row(status, missing, missing_show_home)::text from jc_pets where id = v_dog) <> '(archived,f,f)' then
    raise exception 'FAIL R06i archive: %', (select row(status, missing, missing_show_home) from jc_pets where id = v_dog); end if;
  -- an admin hiding a home ends its pets' opt-in (security M1)
  execute 'set local role authenticated';
  perform pg_temp.s21_as(o2);
  v := jc_pet_save(null, '{"species": "cat", "name": "Pepper"}');
  perform jc_pet_missing_set((v ->> 'id')::uuid, true, null);
  perform jc_pet_missing_home_set((v ->> 'id')::uuid, true);
  perform pg_temp.s21_as(ad);
  perform jc_admin_unlock('S21-COMMUNITY-01');
  perform jc_admin_home_suppress(v_h2, true);
  perform pg_temp.s21_as(o1);
  if jc_pet_get((v ->> 'id')::uuid) -> 'home' <> 'null'::jsonb then raise exception 'FAIL R06j suppressed home still shown'; end if;
  execute 'reset role';
  if (select missing_show_home from jc_pets where id = (v ->> 'id')::uuid) then raise exception 'FAIL R06k opt-in survived suppression'; end if;
  -- the household leaving (jc_home_vacated) clears an opted-in missing pet
  execute 'set local role authenticated';
  perform pg_temp.s21_as(o2);
  perform jc_pet_missing_home_set((v ->> 'id')::uuid, true);
  perform jc_home_leave();
  execute 'reset role';
  if (select row(status, missing, missing_show_home)::text from jc_pets where id = (v ->> 'id')::uuid) <> '(archived,f,f)' then
    raise exception 'FAIL R06l vacated: %', (select row(status, missing, missing_show_home) from jc_pets where id = (v ->> 'id')::uuid); end if;
  k := k + 13;

  -- ---------- R07 retention: reporter erased after 24 h, rows deleted after 30 days ----------
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, seen_at) values
    ('testville21', v_cat, o2, 'two days ago', now() - interval '2 days') returning id into v_old;
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, seen_at) values
    ('testville21', v_cat, o2, 'an hour ago', now() - interval '1 hour') returning id into v_recent;
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, seen_at) values
    ('testville21', v_cat, o2, 'a month ago', now() - interval '31 days') returning id into v_ancient;
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, seen_at) values
    ('testville21', v_cat, null, '29 days ago', now() - interval '29 days'),
    ('testville21', v_cat, o2, '23 hours ago', now() - interval '23 hours');
  n := jc_pets_retention();
  if (select count(*) from jc_pet_sightings where note = '29 days ago') <> 1
     or (select reporter from jc_pet_sightings where note = '23 hours ago') is distinct from o2 then
    raise exception 'FAIL R07h the job over-reached (29 d deleted or 23 h reporter erased)'; end if;
  k := k + 1;
  if (select reporter from jc_pet_sightings where id = v_old) is not null then raise exception 'FAIL R07a reporter kept past 24 h'; end if;
  if (select reporter from jc_pet_sightings where id = v_recent) is distinct from o2 then raise exception 'FAIL R07b recent reporter erased (caps need it)'; end if;
  if exists (select 1 from jc_pet_sightings where id = v_ancient) or n < 1 then raise exception 'FAIL R07c 31-day sighting kept (n=%)', n; end if;
  if (select affected from jc_maintenance_log where job = 'pets_purge' order by id desc limit 1) is distinct from n then
    raise exception 'FAIL R07d not logged'; end if;
  if not (jc_maintenance_status() ? 'pets_purge') or (jc_maintenance_status() -> 'pets_purge' ->> 'never_run')::boolean then
    raise exception 'FAIL R07e maintenance status: %', jc_maintenance_status(); end if;
  if has_function_privilege('authenticated', 'public.jc_pets_retention()', 'execute')
     or has_function_privilege('anon', 'public.jc_pets_retention()', 'execute') then raise exception 'FAIL R07f retention callable'; end if;
  if not exists (select 1 from cron.job where jobname = 'jc-pets-purge' and schedule = '50 3 * * *' and active) then
    raise exception 'FAIL R07g cron job'; end if;
  k := k + 7;

  -- ---------- R08 the pets WhatsApp group link: members only, never in jc_config_get ----------
  execute 'set local role authenticated';
  perform pg_temp.s21_as(o2);
  if jc_pets_group_get() ->> 'link' is not null then raise exception 'FAIL R08a link before set'; end if;
  msg := pg_temp.s21_err('select jc_admin_pets_group_set(''https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12'')');
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL R08b resident set the link: %', msg; end if;
  perform pg_temp.s21_as(ad);
  msg := pg_temp.s21_err('select jc_admin_pets_group_set(''http://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12'')');
  if msg is distinct from 'BAD_LINK' then raise exception 'FAIL R08c http: %', msg; end if;
  msg := pg_temp.s21_err('select jc_admin_pets_group_set(''https://wa.me/971500000000'')');
  if msg is distinct from 'BAD_LINK' then raise exception 'FAIL R08d wa.me: %', msg; end if;
  msg := pg_temp.s21_err('select jc_admin_pets_group_set(''https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12?x=<script>'')');
  if msg is distinct from 'BAD_LINK' then raise exception 'FAIL R08e trailing junk: %', msg; end if;
  v := jc_admin_pets_group_set('  https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12  ');
  if v ->> 'link' <> 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12' then raise exception 'FAIL R08f set: %', v; end if;
  perform pg_temp.s21_as(o2);
  if jc_pets_group_get() ->> 'link' <> 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12' then raise exception 'FAIL R08g member read'; end if;
  perform pg_temp.s21_as(x1);
  if jc_pets_group_get() ->> 'link' is not null then raise exception 'FAIL R08h other community read the link'; end if;
  execute 'reset role';
  if jc_config_get('testville21')::text like '%chat.whatsapp.com%' then raise exception 'FAIL R08i link in the anon config'; end if;
  if exists (select 1 from jc_admin_log where community_id = 'testville21' and target::text like '%whatsapp%') then
    raise exception 'FAIL R08j link written to the admin log'; end if;
  if (select target ->> 'ref' from jc_admin_log where community_id = 'testville21' and action = 'pets_group_set'
       order by id desc limit 1) is distinct from left(md5('https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQr12'), 8) then
    raise exception 'FAIL R08j2 no fingerprint of the change (security L3)'; end if;
  update jc_communities set modules = '{"pets": {"enabled": false}}' where id = 'testville21';
  execute 'set local role authenticated';
  perform pg_temp.s21_as(o2);
  msg := pg_temp.s21_err('select jc_pets_group_get()');
  if msg is distinct from 'MODULE_OFF' then raise exception 'FAIL R08k module off: %', msg; end if;
  execute 'reset role';
  update jc_communities set modules = '{"pets": {"enabled": true}}' where id = 'testville21';
  execute 'set local role authenticated';
  perform pg_temp.s21_as(ad);
  if jc_admin_pets_group_set('') ->> 'link' is not null then raise exception 'FAIL R08l clear'; end if;
  execute 'reset role';
  if (select pets_group_link from jc_communities where id = 'testville21') is not null then raise exception 'FAIL R08m clear stored'; end if;
  k := k + 14;

  -- ---------- R10 (R5b-1b) the home's type is on the card, and nothing else new ----------
  execute 'set local role authenticated';
  perform pg_temp.s21_as(ad);
  v := jc_pet_save(null, '{"species": "cat", "name": "Tabby"}');
  perform pg_temp.s21_as(o1);                                        -- a neighbor reads ad's (listed) home
  v := jc_pet_get((v ->> 'id')::uuid);
  if v -> 'home' ->> 'type' is distinct from 'villa' then raise exception 'FAIL R10a home type missing: %', v -> 'home'; end if;
  if (select array_agg(k2 order by k2) from jsonb_object_keys(v -> 'home') k2) <> array['building', 'number', 'type', 'village'] then
    raise exception 'FAIL R10b unexpected home keys: %', v -> 'home'; end if;
  if (select count(*) from jsonb_array_elements(jc_pets_list('all')) e where e -> 'home' ->> 'type' = 'villa') < 1 then
    raise exception 'FAIL R10c list cards lack the home type'; end if;
  execute 'reset role';
  k := k + 3;

  -- ---------- R09 the new RPCs: authenticated only ----------
  if has_function_privilege('anon', 'public.jc_pets_group_get()', 'execute')
     or has_function_privilege('anon', 'public.jc_admin_pets_group_set(text)', 'execute')
     or has_function_privilege('anon', 'public.jc_pet_missing_home_set(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.jc_admin_pet_care_set(uuid, text, text, date, text)', 'execute') then
    raise exception 'FAIL R09 anon can call a new pets RPC'; end if;
  k := k + 1;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's21_pets_r5: % checks passed', k;
end
$t$;
