-- R5b-2b-0 — who sees a pet's sightings (rule A: jc_pet_sight_from), out-alone reports, card last_seen,
-- nearest-first order, jc_pets_alerts. Own communities (testville24 / testville24b) — never jubail.
-- Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  o1 uuid := '00000000-0000-4000-8000-000000002401';  -- owner of Biscuit + Ace (home 1, far pin)
  o2 uuid := '00000000-0000-4000-8000-000000002402';  -- neighbour (home 2, pinned)
  ad uuid := '00000000-0000-4000-8000-000000002403';  -- Pets admin (home 3, no pin)
  x1 uuid := '00000000-0000-4000-8000-000000002404';  -- testville24b member
  o3 uuid := '00000000-0000-4000-8000-000000002405';  -- owner of Ziggy (home 4, pin next to o2)
  v jsonb; k int := 0; msg text; n int;
  v_dog uuid; v_ace uuid; v_zig uuid; v_cat uuid; v_far uuid; v_old bigint; v_new bigint;
begin
  execute $f$create function pg_temp.s24_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s24_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s24_card(l jsonb, id uuid) returns jsonb language sql as
    $b$ select x from jsonb_array_elements(l) x where x ->> 'id' = id::text $b$$f$;
  execute $f$create function pg_temp.s24_names(l jsonb) returns text language sql as
    $b$ select string_agg(x ->> 'name', ',' order by o) from jsonb_array_elements(l) with ordinality t(x, o) $b$$f$;
  execute 'grant execute on function pg_temp.s24_as(uuid), pg_temp.s24_err(text), pg_temp.s24_card(jsonb, uuid), pg_temp.s24_names(jsonb) to authenticated';

  -- ---------- fixtures ----------
  insert into auth.users (id, email) values (o1, 'o1@s24.test'), (o2, 'o2@s24.test'), (ad, 'ad@s24.test'),
    (x1, 'x1@s24.test'), (o3, 'o3@s24.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville24', 'Testville 24', 24.53, 54.43, '{"pets": {"enabled": true}}'),
    ('testville24b', 'Testville 24b', 25.00, 55.00, '{"pets": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville24', 'north', 'North'), ('testville24b', 'north', 'North');
  perform jc_code_set('testville24', 'join', 'S24-JOIN-CODE-01');
  perform jc_code_set('testville24', 'pets', 'S24-PETS-ADMIN-01');
  perform jc_code_set('testville24b', 'join', 'S24-JOIN-CODE-02');

  execute 'set local role authenticated';
  perform pg_temp.s24_as(o1); perform jc_join('testville24', 'S24-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '1');
  perform jc_home_pin_set(24.560, 54.460);
  v_dog := (jc_pet_save(null, '{"species": "dog", "name": "Biscuit"}') ->> 'id')::uuid;
  v_ace := (jc_pet_save(null, '{"species": "cat", "name": "Ace", "wanderer": true}') ->> 'id')::uuid;
  perform pg_temp.s24_as(o2); perform jc_join('testville24', 'S24-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '2');
  perform jc_home_pin_set(24.530, 54.430);
  perform pg_temp.s24_as(o3); perform jc_join('testville24', 'S24-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '4');
  perform jc_home_pin_set(24.5302, 54.4302);
  v_zig := (jc_pet_save(null, '{"species": "dog", "name": "Ziggy"}') ->> 'id')::uuid;
  perform pg_temp.s24_as(ad); perform jc_join('testville24', 'S24-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '3');
  perform jc_admin_unlock('S24-PETS-ADMIN-01');
  perform jc_pet_save(null, '{"species": "dog", "name": "Bo"}');   -- owned pet at an unpinned home → sorts last
  v_cat := (jc_admin_stray_save(null, '{"species": "cat", "name": "Snow", "territory_lat": 24.62, "territory_lng": 54.52}') ->> 'id')::uuid;
  v_far := (jc_admin_stray_save(null, '{"species": "cat", "name": "Amber", "territory_lat": 24.60, "territory_lng": 54.50}') ->> 'id')::uuid;
  perform pg_temp.s24_as(x1); perform jc_join('testville24b', 'S24-JOIN-CODE-02');
  execute 'reset role';
  if (select wanderer from jc_pets where id = v_ace) is not true then raise exception 'FAIL fixture: Ace not a wanderer'; end if;
  execute 'set local role authenticated';

  -- ---------- V01 out on their own: a neighbour reports an owned pet at home; only the household / admin see it ----------
  perform pg_temp.s24_as(o2);
  perform jc_pet_sighting_add(v_dog, 'by the canal', 24.5401, 54.4401);
  v := jc_pet_get(v_dog);
  if v -> 'sightings' <> 'null'::jsonb or v -> 'last_seen' <> 'null'::jsonb or v -> 'last_seen_at' <> 'null'::jsonb then
    raise exception 'FAIL V01a reporter-neighbour sees the household-only report: %', v; end if;
  v := pg_temp.s24_card(jc_pets_list('all'), v_dog);
  if v -> 'last_seen' <> 'null'::jsonb or v -> 'last_seen_at' <> 'null'::jsonb then raise exception 'FAIL V01b neighbour list card leaks: %', v; end if;
  perform pg_temp.s24_as(o3);
  if jc_pet_get(v_dog) -> 'sightings' <> 'null'::jsonb then raise exception 'FAIL V01c another neighbour sees it'; end if;
  perform pg_temp.s24_as(o1);
  v := jc_pet_get(v_dog);
  if jsonb_array_length(v -> 'sightings') <> 1 or (v -> 'last_seen' ->> 'lat')::float8 <> 24.5401 or v ->> 'last_seen_at' is null then
    raise exception 'FAIL V01d household view: %', v; end if;
  v := pg_temp.s24_card(jc_pets_list('all'), v_dog);
  if (v -> 'last_seen' ->> 'lng')::float8 <> 54.4401 then raise exception 'FAIL V01e household list card: %', v; end if;
  perform pg_temp.s24_as(ad);
  if jsonb_array_length(jc_pet_get(v_dog) -> 'sightings') <> 1 then raise exception 'FAIL V01f Pets admin can''t see it'; end if;
  if (pg_temp.s24_card(jc_pets_list('all'), v_dog) -> 'last_seen' ->> 'lat')::float8 is distinct from 24.5401 then
    raise exception 'FAIL V01i Pets admin list card: %', pg_temp.s24_card(jc_pets_list('all'), v_dog); end if;
  perform pg_temp.s24_as(x1);
  msg := pg_temp.s24_err(format('select jc_pet_get(%L)', v_dog));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL V01g other community: %', msg; end if;
  msg := pg_temp.s24_err(format('select jc_pet_sighting_add(%L, null, null, null)', v_dog));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL V01h other community reports: %', msg; end if;
  k := k + 9;

  -- ---------- V02 a wanderer (not missing) takes no reports; once missing it does ----------
  perform pg_temp.s24_as(o2);
  msg := pg_temp.s24_err(format('select jc_pet_sighting_add(%L, null, null, null)', v_ace));
  if msg is distinct from 'SIGHTINGS_CLOSED' then raise exception 'FAIL V02a wanderer open: %', msg; end if;
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_ace, true, null);
  perform pg_temp.s24_as(o2);
  msg := pg_temp.s24_err(format('select jc_pet_sighting_add(%L, null, null, null)', v_ace));
  if msg is not null then raise exception 'FAIL V02b missing wanderer closed: %', msg; end if;
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_ace, false, null);
  execute 'reset role';
  update jc_pet_sightings set seen_at = now() - interval '3 days' where pet_id = v_ace;   -- keep V08's seen_out to Biscuit
  execute 'set local role authenticated';
  k := k + 2;

  -- ---------- V03 missing: neighbours see sightings from missing_since − 24 h, not older ----------
  execute 'reset role';
  select id into v_new from jc_pet_sightings where pet_id = v_dog;
  update jc_pet_sightings set seen_at = now() - interval '2 hours' where id = v_new;               -- just before "missing"
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, lat, lng, seen_at)
  values ('testville24', v_dog, o3, 'old one', 24.55, 54.45, now() - interval '30 hours') returning id into v_old;
  execute 'set local role authenticated';
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, true, 'gate open');
  perform pg_temp.s24_as(o2);
  v := jc_pet_get(v_dog);
  if jsonb_array_length(v -> 'sightings') <> 1 or (v -> 'sightings' -> 0 ->> 'id')::bigint <> v_new then
    raise exception 'FAIL V03a neighbour window: %', v -> 'sightings'; end if;
  if (v -> 'sightings' -> 0 ->> 'by_me')::boolean is not true or v -> 'sightings' -> 0 ? 'reporter' then
    raise exception 'FAIL V03b by_me / reporter: %', v -> 'sightings' -> 0; end if;
  if (v -> 'last_seen' ->> 'lat')::float8 <> 24.5401 then raise exception 'FAIL V03c card last_seen: %', v -> 'last_seen'; end if;
  if (pg_temp.s24_card(jc_pets_list('owned'), v_dog) -> 'last_seen' ->> 'lat')::float8 is distinct from 24.5401 then
    raise exception 'FAIL V03f neighbour list card for a missing pet: %', pg_temp.s24_card(jc_pets_list('owned'), v_dog); end if;
  perform pg_temp.s24_as(o1);
  if jsonb_array_length(jc_pet_get(v_dog) -> 'sightings') <> 2 then raise exception 'FAIL V03d household sees all'; end if;
  -- newest sighting has no location: last_seen keeps the newest located one, last_seen_at moves
  perform pg_temp.s24_as(o3); perform jc_pet_sighting_add(v_dog, 'heard barking', null, null);
  perform pg_temp.s24_as(o2);
  v := jc_pet_get(v_dog);
  if (v -> 'last_seen' ->> 'lat')::float8 <> 24.5401 or (v ->> 'last_seen_at')::timestamptz <= (v -> 'last_seen' ->> 'at')::timestamptz then
    raise exception 'FAIL V03e unlocated newest: %', v; end if;
  k := k + 6;

  -- ---------- V04 a hidden sighting is invisible everywhere (page, card, alerts) ----------
  execute 'reset role';
  update jc_pet_sightings set hidden = true where id = v_new;
  execute 'set local role authenticated';
  perform pg_temp.s24_as(o2);
  v := jc_pet_get(v_dog);
  if v -> 'last_seen' <> 'null'::jsonb or exists (select 1 from jsonb_array_elements(v -> 'sightings') x where (x ->> 'id')::bigint = v_new) then
    raise exception 'FAIL V04 hidden sighting shown: %', v; end if;
  execute 'reset role';
  update jc_pet_sightings set hidden = false where id = v_new;
  execute 'set local role authenticated';
  k := k + 1;

  -- ---------- V05 found: hidden from neighbours again ----------
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, false, null);
  perform pg_temp.s24_as(o2);
  v := jc_pet_get(v_dog);
  if v -> 'sightings' <> 'null'::jsonb or v -> 'last_seen' <> 'null'::jsonb or v -> 'last_seen_at' <> 'null'::jsonb then
    raise exception 'FAIL V05a found pet still shows sightings: %', v; end if;
  -- missing again later: the window restarts from the new missing_since (the 30 h one stays hidden)
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, true, null);
  perform pg_temp.s24_as(o2);
  if exists (select 1 from jsonb_array_elements(jc_pet_get(v_dog) -> 'sightings') x where (x ->> 'id')::bigint = v_old) then
    raise exception 'FAIL V05b old episode leaked'; end if;
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, false, null);
  k := k + 2;

  -- ---------- V06 strays: everyone sees all sightings; card last_seen ----------
  perform pg_temp.s24_as(o3); perform jc_pet_sighting_add(v_cat, 'by the souk', 24.5303, 54.4303);
  perform pg_temp.s24_as(o2);
  v := jc_pet_get(v_cat);
  if jsonb_array_length(v -> 'sightings') <> 1 or (v -> 'last_seen' ->> 'lat')::float8 <> 24.5303 then
    raise exception 'FAIL V06 stray: %', v; end if;
  k := k + 1;

  -- ---------- V07 order: missing → nearest the viewer's home pin → name; no pin → name ----------
  perform pg_temp.s24_as(o2);
  v := jc_pets_list('owned');
  if pg_temp.s24_names(v) <> 'Ziggy,Ace,Biscuit,Bo' then raise exception 'FAIL V07a nearest owned: %', pg_temp.s24_names(v); end if;
  -- strays: Snow's territory is the farthest, but her last sighting (next to o2) puts her first; Amber at her territory
  v := jc_pets_list('strays');
  if pg_temp.s24_names(v) <> 'Snow,Amber' then raise exception 'FAIL V07b nearest strays: %', pg_temp.s24_names(v); end if;
  perform pg_temp.s24_as(ad);
  if pg_temp.s24_names(jc_pets_list('owned')) <> 'Ace,Biscuit,Bo,Ziggy' then
    raise exception 'FAIL V07c no pin → name order: %', pg_temp.s24_names(jc_pets_list('owned')); end if;
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, true, null);
  perform pg_temp.s24_as(o2);
  if pg_temp.s24_names(jc_pets_list('owned')) <> 'Biscuit,Ziggy,Ace,Bo' then
    raise exception 'FAIL V07d missing first: %', pg_temp.s24_names(jc_pets_list('owned')); end if;
  -- no home coordinates on any card
  if exists (select 1 from jsonb_array_elements(jc_pets_list('all')) x where x -> 'home' ? 'lat' or x -> 'home' ? 'lng' or x ? 'dist') then
    raise exception 'FAIL V07e coordinates on a card'; end if;
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, false, null);
  k := k + 5;

  -- ---------- V08 alerts: missing list for all; seen_out for the household only (24 h, not missing) ----------
  perform pg_temp.s24_as(o3); perform jc_pet_missing_set(v_zig, true, null);
  perform pg_temp.s24_as(o1);
  v := jc_pets_alerts();
  if jsonb_array_length(v -> 'missing') <> 1 or v -> 'missing' -> 0 ->> 'name' <> 'Ziggy' or v -> 'missing' -> 0 ? 'home' then
    raise exception 'FAIL V08a missing list: %', v; end if;
  if jsonb_array_length(v -> 'seen_out') <> 1 or v -> 'seen_out' -> 0 ->> 'id' <> v_dog::text or v -> 'seen_out' -> 0 ->> 'at' is null then
    raise exception 'FAIL V08b household seen_out: %', v; end if;
  perform pg_temp.s24_as(o2);
  v := jc_pets_alerts();
  if jsonb_array_length(v -> 'seen_out') <> 0 or jsonb_array_length(v -> 'missing') <> 1 then raise exception 'FAIL V08c neighbour alerts: %', v; end if;
  perform pg_temp.s24_as(o3);   -- Ziggy is missing → not "seen out" (the missing alarm covers it)
  if jsonb_array_length(jc_pets_alerts() -> 'seen_out') <> 0 then raise exception 'FAIL V08d missing pet in seen_out'; end if;
  -- older than 24 h → off seen_out
  execute 'reset role';
  update jc_pet_sightings set seen_at = now() - interval '25 hours' where pet_id = v_dog and seen_at > now() - interval '24 hours';
  execute 'set local role authenticated';
  perform pg_temp.s24_as(o1);
  if jsonb_array_length(jc_pets_alerts() -> 'seen_out') <> 0 then raise exception 'FAIL V08e stale seen_out: %', jc_pets_alerts(); end if;
  perform pg_temp.s24_as(x1);
  v := jc_pets_alerts();
  if jsonb_array_length(v -> 'missing') <> 0 then raise exception 'FAIL V08f other community sees missing: %', v; end if;
  if jsonb_array_length(jc_pets_list('all')) <> 0 then raise exception 'FAIL V08g other community lists pets'; end if;
  -- a hidden sighting never raises seen_out
  execute 'reset role';
  insert into jc_pet_sightings (community_id, pet_id, reporter, note, hidden) values ('testville24', v_dog, o3, 'hidden', true);
  execute 'set local role authenticated';
  perform pg_temp.s24_as(o1);
  if jsonb_array_length(jc_pets_alerts() -> 'seen_out') <> 0 then raise exception 'FAIL V08h hidden sighting in seen_out'; end if;
  -- accepted (migration E): a sighting logged while missing still shows as seen_out after found
  perform jc_pet_missing_set(v_dog, true, null);
  perform pg_temp.s24_as(o2); perform jc_pet_sighting_add(v_dog, 'by the park', null, null);
  perform pg_temp.s24_as(o1); perform jc_pet_missing_set(v_dog, false, null);
  if jsonb_array_length(jc_pets_alerts() -> 'seen_out') <> 1 then raise exception 'FAIL V08i after-found behaviour changed: %', jc_pets_alerts(); end if;
  k := k + 9;

  -- ---------- V09 kill switch ----------
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{pets,enabled}', 'false') where id = 'testville24';
  execute 'set local role authenticated';
  perform pg_temp.s24_as(o1);
  msg := pg_temp.s24_err('select jc_pets_alerts()');
  if msg is distinct from 'MODULE_OFF' then raise exception 'FAIL V09 module off: %', msg; end if;
  k := k + 1;

  -- ---------- V10 grants: the rule is internal; alerts authenticated only; definer + pinned search_path ----------
  execute 'reset role';
  if has_function_privilege('authenticated', 'public.jc_pet_sight_from(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.jc_pet_sight_from(uuid, uuid)', 'execute') then
    raise exception 'FAIL V10a helper is client-callable'; end if;
  if has_function_privilege('anon', 'public.jc_pets_alerts()', 'execute')
     or not has_function_privilege('authenticated', 'public.jc_pets_alerts()', 'execute') then
    raise exception 'FAIL V10b alerts grants'; end if;
  select count(*) into n from pg_proc
   where oid in ('public.jc_pet_sight_from(uuid, uuid)'::regprocedure, 'public.jc_pets_alerts()'::regprocedure)
     and prosecdef and proconfig @> array['search_path=public, pg_temp'];
  if n <> 2 then raise exception 'FAIL V10c definer / search_path'; end if;
  k := k + 3;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's24_pets_visibility: % checks passed', k;
end
$t$;
