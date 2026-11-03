-- T2 / S4 behaviour tests: owned pets, wanderers, missing, sightings, strays + care log,
-- moderation, vacancy, the offboarding trigger, and the storage policies + photo ledger.
-- Run via tests/sql/build_dryrun.sh (rolls back — storage rows included).
-- Users p1..p8 are disjoint from earlier fixtures; homes are Nad Al Dhabi 41–44.

do $t$
declare
  p1 uuid := '00000000-0000-4000-8000-000000000401';
  p2 uuid := '00000000-0000-4000-8000-000000000402';
  p3 uuid := '00000000-0000-4000-8000-000000000403';
  p4 uuid := '00000000-0000-4000-8000-000000000404';
  p5 uuid := '00000000-0000-4000-8000-000000000405';
  p6 uuid := '00000000-0000-4000-8000-000000000406';
  p8 uuid := '00000000-0000-4000-8000-000000000408';
  v jsonb; v_err text; v_tok text; n int; k int := 0; i int;
  v_simba uuid; v_stray uuid; v_rex uuid; v_extra uuid; v_bob uuid; v_home44 uuid;
  v_path1 text; v_path2 text; v_path3 text; v_path4 text; v_path5 text;
  v_meta jsonb := '{"size": 1024, "mimetype": "image/jpeg"}';
  v_sighting bigint;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (p1, 'p1@s4.test'), (p2, 'p2@s4.test'), (p3, 'p3@s4.test'), (p4, 'p4@s4.test'),
    (p5, 'p5@s4.test'), (p6, 'p6@s4.test'), (p8, 'p8@s4.test');
  perform jc_code_set('jubail', 'join', 'S4-JOIN-CODE-01');
  perform jc_code_set('jubail', 'pets', 'S4-PETS-ADMIN-01');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules)
  values ('testville4', 'Testville 4', 25.0, 55.0, '{"pets": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville4', 'north', 'North');
  perform jc_code_set('testville4', 'join', 'S4-TV4-JOIN-01');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  perform jc_home_claim('nad-al-dhabi', 'villa', null, '41');
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  perform jc_invite_accept(v_tok);
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  perform jc_home_claim('nad-al-dhabi', 'villa', null, '42');
  perform set_config('request.jwt.claims', json_build_object('sub', p4, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  perform jc_home_claim('nad-al-dhabi', 'villa', null, '43');
  perform set_config('request.jwt.claims', json_build_object('sub', p8, 'role', 'authenticated')::text, true);
  perform jc_join('testville4', 'S4-TV4-JOIN-01');
  perform jc_home_claim('north', 'villa', null, '1');

  -- ---------- P01 kill switch ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pets_list('all'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL P01a: %', v_err; end if;
  v_err := null; begin perform jc_pet_save(null, '{"species": "cat", "name": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL P01b write with module off: %', v_err; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{pets,enabled}', 'true') where id = 'jubail';
  execute 'set local role authenticated';
  k := k + 2;

  -- ---------- P02 the household's own pets ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p4, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_save(null, '{"species": "cat", "name": "Ghost"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL P02a: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_save(null, '{"species": "dragon", "name": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P02b species: %', v_err; end if;
  v_err := null; begin perform jc_pet_save(null, '{"species": null, "name": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P02c null species: %', v_err; end if;
  v_err := null; begin perform jc_pet_save(null, '{"species": "cat", "name": "X", "care_state": "under_care"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P02d owner set stray-only field: %', v_err; end if;
  v_err := null; begin perform jc_pet_save(null, '{"species": "cat", "name": "   "}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P02e blank name: %', v_err; end if;
  v_err := null; begin perform jc_pet_save(null, '{"species": "cat"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P02f no name: %', v_err; end if;
  v := jc_pet_save(null, '{"species": "cat", "name": "Simba", "wanderer": true, "description": "grey tabby"}');
  v_simba := (v ->> 'id')::uuid;
  if not (v ->> 'mine')::boolean or v -> 'home' ->> 'number' <> '41' then raise exception 'FAIL P02g: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  v := jc_pet_save(v_simba, '{"microchipped": true}');  -- household member edits
  if not (v ->> 'microchipped')::boolean then raise exception 'FAIL P02h: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_save(v_simba, '{"name": "Mine now"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P02i neighbour edited: %', v_err; end if;
  k := k + 9;

  -- ---------- P03 cap: 10 active pets per home ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  for i in 2..10 loop
    v_extra := (jc_pet_save(null, jsonb_build_object('species', 'other', 'name', 'Fish ' || i)) ->> 'id')::uuid;
  end loop;
  v_err := null; begin perform jc_pet_save(null, '{"species": "other", "name": "Fish 11"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'TOO_MANY_PETS' then raise exception 'FAIL P03: %', v_err; end if;
  k := k + 1;

  -- ---------- P04 the board + filters ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v := jc_pets_list('wanderers');
  if jsonb_array_length(v) <> 1 or (v -> 0 ->> 'mine')::boolean or v -> 0 -> 'home' ->> 'number' <> '41' then
    raise exception 'FAIL P04a: %', v; end if;
  if jsonb_array_length(jc_pets_list('strays')) <> 0 then raise exception 'FAIL P04b'; end if;
  v_err := null; begin perform jc_pets_list('cats'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FILTER' then raise exception 'FAIL P04c: %', v_err; end if;
  k := k + 3;

  -- ---------- P05 missing: the household's switch, top of the board ----------
  v_err := null; begin perform jc_pet_missing_set(v_simba, true, 'x'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P05a neighbour flagged missing: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  perform jc_pet_missing_set(v_simba, true, 'Last seen on the boardwalk');
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v := jc_pets_list('all');
  if (v -> 0 ->> 'id')::uuid <> v_simba or not (v -> 0 ->> 'missing')::boolean
     or v -> 0 ->> 'last_seen_note' <> 'Last seen on the boardwalk' then raise exception 'FAIL P05b missing not first: %', v -> 0; end if;
  k := k + 2;

  -- ---------- P06 sightings: anyone logs; an owned pet's trail goes to its household ----------
  perform jc_pet_sighting_add(v_simba, 'by the souk', 24.55, 54.49);
  if jc_pet_get(v_simba) -> 'sightings' <> 'null'::jsonb then raise exception 'FAIL P06a neighbour sees owned trail'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_pet_get(v_simba) -> 'sightings') <> 1 then raise exception 'FAIL P06b owner can''t see sighting'; end if;
  v_err := null; begin perform jc_pet_sighting_add(v_simba, 'x', 24.55, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P06c half a location: %', v_err; end if;
  k := k + 3;

  -- ---------- P07 strays: Pets admin only; care log + sightings public to residents ----------
  v_err := null; begin perform jc_admin_stray_save(null, '{"species": "cat", "name": "Souk cat"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL P07a: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  perform jc_admin_unlock('S4-PETS-ADMIN-01');
  v_err := null; begin perform jc_admin_stray_save(null, '{"species": "cat", "name": "S", "wanderer": true}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P07b: %', v_err; end if;
  v_err := null; begin perform jc_admin_stray_save(null, '{"species": "cat", "name": "S", "care_state": "adopted?"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P07c bad care state: %', v_err; end if;
  v_stray := (jc_admin_stray_save(null, '{"species": "cat", "name": "Souk cat #3"}') ->> 'id')::uuid;
  perform jc_admin_stray_save(v_stray, '{"care_state": "needs_help"}');
  perform jc_admin_pet_care_add(v_stray, 'fed', 'Fed at 7pm');
  v_err := null; begin perform jc_admin_pet_care_add(v_simba, 'fed', 'x'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P07d care log on an owned pet: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  perform jc_pet_sighting_add(v_stray, 'near the mosque', null, null);
  perform jc_pet_sighting_add(v_stray, 'buy cheap stuff at spam.example', null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  select (x ->> 'id')::bigint into v_sighting from jsonb_array_elements(jc_pet_get(v_stray) -> 'sightings') x
   where x ->> 'note' like 'buy cheap%';
  perform jc_admin_sighting_hide(v_sighting);
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v := jc_pet_get(v_stray);
  if v ->> 'care_state' <> 'needs_help' or jsonb_array_length(v -> 'care_log') <> 1 or jsonb_array_length(v -> 'sightings') <> 1 then
    raise exception 'FAIL P07e stray card (hidden sighting should be gone): %', v; end if;
  v_err := null; begin perform jc_pet_save(v_stray, '{"name": "Mine"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL P07f resident edited a stray: %', v_err; end if;
  k := k + 7;

  -- ---------- P08 photos: server-chosen paths, write-once, ledger, windows, scoped reads ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_photo_begin(v_simba, 'jpg'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P08a neighbour began upload: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_photo_begin(v_simba, 'exe'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL P08b: %', v_err; end if;
  v_path1 := jc_pet_photo_begin(v_simba, 'jpg') ->> 'path';
  if v_path1 !~ ('^jubail/' || v_simba || '/[0-9a-f]{24}\.jpg$') then raise exception 'FAIL P08c path %', v_path1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_photo_begin(v_simba, 'jpg'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'PHOTO_PENDING' then raise exception 'FAIL P08d trampled a fresh upload: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_pet_photo_commit(v_simba); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'PHOTO_MISSING' then raise exception 'FAIL P08e commit before upload: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path1, p3, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err not like 'new row violates row-level security policy%' then raise exception 'FAIL P08f foreign upload: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', 'jubail/' || v_simba || '/evil.jpg', p1, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err not like 'new row violates row-level security policy%' then raise exception 'FAIL P08g arbitrary path: %', v_err; end if;
  insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path1, p1, v_meta);
  v := jc_pet_photo_commit(v_simba);
  if v ->> 'photo_path' <> v_path1 then raise exception 'FAIL P08h commit: %', v; end if;
  -- write-once: neither a duplicate nor an upsert can replace the committed object
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path1, p1, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL P08i duplicate upload accepted'; end if;
  v_err := null;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path1, p1, v_meta)
    on conflict (bucket_id, name) do update set metadata = excluded.metadata;
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL P08j upsert overwrote a photo'; end if;
  -- a re-begin kills the previous pending path
  v_path2 := jc_pet_photo_begin(v_simba, 'png') ->> 'path';
  v_path3 := jc_pet_photo_begin(v_simba, 'webp') ->> 'path';
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path2, p1, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err not like 'new row violates row-level security policy%' then raise exception 'FAIL P08k abandoned path still writable: %', v_err; end if;
  -- the 15-minute window closes both the upload and the commit
  execute 'reset role';
  update jc_pets set pending_photo_at = now() - interval '16 minutes' where id = v_simba;
  execute 'set local role authenticated';
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path3, p1, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err not like 'new row violates row-level security policy%' then raise exception 'FAIL P08l expired path writable: %', v_err; end if;
  v_err := null; begin perform jc_pet_photo_commit(v_simba); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'PHOTO_EXPIRED' then raise exception 'FAIL P08m: %', v_err; end if;
  -- an object without Storage's size/type metadata (unfinished upload) can't be committed
  v_path4 := jc_pet_photo_begin(v_simba, 'jpg') ->> 'path';
  insert into storage.objects (bucket_id, name, owner) values ('pet-photos', v_path4, p1);
  v_err := null; begin perform jc_pet_photo_commit(v_simba); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'PHOTO_MISSING' then raise exception 'FAIL P08n half-written upload committed: %', v_err; end if;
  -- the ledger tracks every path for T4's cleanup
  execute 'reset role';
  if (select array_agg(state order by created_at, path) from jc_pet_photos where pet_id = v_simba) is null
     or (select count(*) from jc_pet_photos where pet_id = v_simba and state = 'current' and path = v_path1) <> 1
     or (select count(*) from jc_pet_photos where pet_id = v_simba and state = 'retired') <> 2
     or (select count(*) from jc_pet_photos where pet_id = v_simba and state = 'pending' and path = v_path4) <> 1 then
    raise exception 'FAIL P08o ledger: %', (select jsonb_agg(jsonb_build_object('p', right(path, 8), 's', state)) from jc_pet_photos where pet_id = v_simba); end if;
  execute 'set local role authenticated';
  -- reads: same community yes, other community no, anon no, module off no
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_path1;
  if n <> 1 then raise exception 'FAIL P08p neighbour can''t see the photo'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p8, 'role', 'authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_path1;
  if n <> 0 then raise exception 'FAIL P08q other community sees the photo'; end if;
  execute 'reset role'; execute 'set local role anon';
  v_err := null; begin select count(*) into n from storage.objects where bucket_id = 'pet-photos'; exception when others then v_err := sqlerrm; end;
  if v_err is null and n <> 0 then raise exception 'FAIL P08r anon sees photos'; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{pets,enabled}', 'false') where id = 'jubail';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_path1;
  if n <> 0 then raise exception 'FAIL P08s photo readable with module off'; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{pets,enabled}', 'true') where id = 'jubail';
  -- a member who leaves the household loses their in-flight upload
  update jc_pets set pending_photo_at = now() - interval '2 minutes' where id = v_simba;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  v_path5 := jc_pet_photo_begin(v_simba, 'jpg') ->> 'path';
  perform jc_home_leave();
  v_err := null; begin insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_path5, p2, v_meta); exception when others then v_err := sqlerrm; end;
  if v_err not like 'new row violates row-level security policy%' then raise exception 'FAIL P08t ex-member uploaded: %', v_err; end if;
  k := k + 20;

  -- ---------- P09 community isolation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p8, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_pets_list('all')) <> 0 then raise exception 'FAIL P09a'; end if;
  v_err := null; begin perform jc_pet_get(v_simba); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P09b: %', v_err; end if;
  v_err := null; begin perform jc_pet_sighting_add(v_simba, 'x', null, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL P09c: %', v_err; end if;
  k := k + 3;

  -- ---------- P10 the family that leaves takes its pets off the board ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  v_rex := (jc_pet_save(null, '{"species": "dog", "name": "Rex"}') ->> 'id')::uuid;
  perform jc_pet_missing_set(v_rex, true, 'call 050 123 4567');
  perform jc_home_leave();
  execute 'reset role';
  if (select status || ':' || missing || ':' || coalesce(last_seen_note, '-') from jc_pets where id = v_rex) <> 'archived:false:-' then
    raise exception 'FAIL P10: %', (select row(status, missing, last_seen_note) from jc_pets where id = v_rex); end if;
  execute 'set local role authenticated';
  k := k + 1;

  -- ---------- P11 moderation needs a reason ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_pet_archive(v_extra, ''); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'REASON_REQUIRED' then raise exception 'FAIL P11a: %', v_err; end if;
  perform jc_admin_pet_archive(v_extra, 'duplicate listing');
  k := k + 1;

  -- ---------- P12 archived pet: off the board, photo unreadable, every path queued for cleanup ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  perform jc_pet_archive(v_simba);
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  if exists (select 1 from jsonb_array_elements(jc_pets_list('all')) x where (x ->> 'id')::uuid = v_simba) then
    raise exception 'FAIL P12a archived pet listed'; end if;
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_path1;
  if n <> 0 then raise exception 'FAIL P12b archived pet''s photo still readable'; end if;
  execute 'reset role';
  if exists (select 1 from jc_pet_photos where pet_id = v_simba and state <> 'retired') then
    raise exception 'FAIL P12c ledger not retired'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- P13 sightings caps: 5 per pet per reporter per day ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p4, 'role', 'authenticated')::text, true);
  for i in 1..5 loop perform jc_pet_sighting_add(v_stray, null, null, null); end loop;
  v_err := null; begin perform jc_pet_sighting_add(v_stray, null, null, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'TOO_MANY_SIGHTINGS' then raise exception 'FAIL P13: %', v_err; end if;
  k := k + 1;

  -- ---------- P14 deleting the Pets admin anonymizes, never erases ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p5, 'role', 'authenticated')::text, true);
  perform jc_account_delete('DELETE');
  execute 'reset role';
  if exists (select 1 from jc_pet_care_log where author = p5) or exists (select 1 from jc_pets where created_by = p5)
     or not exists (select 1 from jc_pet_care_log where pet_id = v_stray) then
    raise exception 'FAIL P14'; end if;
  k := k + 1;

  -- ---------- P15 a dashboard delete of a user still runs offboarding (trigger) ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p6, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S4-JOIN-CODE-01');
  v_home44 := (jc_home_claim('nad-al-dhabi', 'villa', null, '44') -> 'home' ->> 'id')::uuid;
  v_bob := (jc_pet_save(null, '{"species": "dog", "name": "Bob"}') ->> 'id')::uuid;
  execute 'reset role';
  delete from auth.users where id = p6;  -- not via jc_account_delete
  if (select status from jc_pets where id = v_bob) <> 'archived'
     or not exists (select 1 from jc_admin_notices where kind = 'departure' and home_id = v_home44 and resolved_at is null) then
    raise exception 'FAIL P15 dashboard delete skipped offboarding'; end if;
  k := k + 1;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's4_pets: % checks passed', k;
end
$t$;
