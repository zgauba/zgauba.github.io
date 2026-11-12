-- R5c-2 — jc_pet_photo_remove: who may remove, what it clears, what it leaves (pending uploads, the file for the purge).
-- Own communities (testville23 / testville23b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back — storage rows included).

do $t$
declare
  o1 uuid := '00000000-0000-4000-8000-000000002301';  -- owner, home 1
  o2 uuid := '00000000-0000-4000-8000-000000002302';  -- neighbour, home 2
  ad uuid := '00000000-0000-4000-8000-000000002303';  -- Pets admin, home 3
  x1 uuid := '00000000-0000-4000-8000-000000002304';  -- testville23b member
  m2 uuid := '00000000-0000-4000-8000-000000002305';  -- second member of home 1
  v jsonb; k int := 0; msg text; n int; v_tok text;
  v_dog uuid; v_cat uuid; v_p1 text; v_p2 text; v_p3 text;
  v_meta jsonb := '{"size": 2048, "mimetype": "image/jpeg"}';
begin
  execute $f$create function pg_temp.s23_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s23_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s23_as(uuid), pg_temp.s23_err(text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (o1, 'o1@s23.test'), (o2, 'o2@s23.test'), (ad, 'ad@s23.test'),
    (x1, 'x1@s23.test'), (m2, 'm2@s23.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville23', 'Testville 23', 24.53, 54.43, '{"pets": {"enabled": true}}'),
    ('testville23b', 'Testville 23b', 25.00, 55.00, '{"pets": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville23', 'north', 'North'), ('testville23b', 'north', 'North');
  perform jc_code_set('testville23', 'join', 'S23-JOIN-CODE-01');
  perform jc_code_set('testville23', 'pets', 'S23-PETS-ADMIN-01');
  perform jc_code_set('testville23b', 'join', 'S23-JOIN-CODE-02');

  execute 'set local role authenticated';
  perform pg_temp.s23_as(o1); perform jc_join('testville23', 'S23-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '1');
  v_tok := jc_invite_create() ->> 'token';
  perform pg_temp.s23_as(m2); perform jc_join('testville23', 'S23-JOIN-CODE-01'); perform jc_invite_accept(v_tok);
  perform pg_temp.s23_as(o2); perform jc_join('testville23', 'S23-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '2');
  perform pg_temp.s23_as(ad); perform jc_join('testville23', 'S23-JOIN-CODE-01'); perform jc_home_claim('north', 'villa', null, '3');
  perform jc_admin_unlock('S23-PETS-ADMIN-01');
  perform pg_temp.s23_as(x1); perform jc_join('testville23b', 'S23-JOIN-CODE-02');
  -- o1's dog with a committed photo
  perform pg_temp.s23_as(o1);
  v_dog := (jc_pet_save(null, '{"species": "dog", "name": "Pepper"}') ->> 'id')::uuid;
  v_p1 := jc_pet_photo_begin(v_dog, 'jpg') ->> 'path';
  insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_p1, o1, v_meta);
  perform jc_pet_photo_commit(v_dog);
  -- a stray with a photo (Pets admin)
  perform pg_temp.s23_as(ad);
  v_cat := (jc_admin_stray_save(null, '{"species": "cat", "name": "Smudge"}') ->> 'id')::uuid;
  v_p2 := jc_pet_photo_begin(v_cat, 'jpg') ->> 'path';
  insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_p2, ad, v_meta);
  perform jc_pet_photo_commit(v_cat);

  -- ---------- F01 nobody outside the household / community can remove ----------
  perform pg_temp.s23_as(o2);
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_p1;
  if n <> 1 then raise exception 'FAIL F01a neighbour can''t see the photo before removal'; end if;
  msg := pg_temp.s23_err(format('select jc_pet_photo_remove(%L)', v_dog));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL F01b neighbour removed: %', msg; end if;
  perform pg_temp.s23_as(x1);
  msg := pg_temp.s23_err(format('select jc_pet_photo_remove(%L)', v_dog));
  if msg is distinct from 'NOT_FOUND' then raise exception 'FAIL F01c other community removed: %', msg; end if;
  perform pg_temp.s23_as(o2);
  msg := pg_temp.s23_err(format('select jc_pet_photo_remove(%L)', v_cat));
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL F01d resident removed a stray''s photo: %', msg; end if;
  k := k + 4;

  -- ---------- F02 a pending upload by the household is left alone ----------
  perform pg_temp.s23_as(m2);
  v_p3 := jc_pet_photo_begin(v_dog, 'jpg') ->> 'path';

  -- ---------- F03 the household (any member) removes: card has no photo, ledger retired, unreadable at once ----------
  perform pg_temp.s23_as(o1);
  v := jc_pet_photo_remove(v_dog);
  if v ->> 'id' <> v_dog::text or v -> 'photo_path' <> 'null'::jsonb or (v ->> 'mine')::boolean is not true then
    raise exception 'FAIL F03a card after remove: %', v; end if;
  if (jc_pet_get(v_dog) ->> 'photo_path') is not null then raise exception 'FAIL F03b pet still has a photo'; end if;
  perform pg_temp.s23_as(o2);
  select count(*) into n from storage.objects where bucket_id = 'pet-photos' and name = v_p1;
  if n <> 0 then raise exception 'FAIL F03c neighbour still reads the removed photo'; end if;
  execute 'reset role';
  if (select state from jc_pet_photos where path = v_p1) <> 'retired'
     or (select retired_at from jc_pet_photos where path = v_p1) is null then
    raise exception 'FAIL F03d ledger not retired: %', (select row_to_json(x) from jc_pet_photos x where path = v_p1); end if;
  if not exists (select 1 from storage.objects where bucket_id = 'pet-photos' and name = v_p1) then
    raise exception 'FAIL F03e the file went before the purge (it must stay for jc-photo-purge)'; end if;
  if (select pending_photo_path from jc_pets where id = v_dog) is distinct from v_p3
     or (select state from jc_pet_photos where path = v_p3) <> 'pending' then
    raise exception 'FAIL F02 the pending upload was touched'; end if;
  k := k + 6;

  -- ---------- F04 nothing to remove → NO_PHOTO (no ledger change) ----------
  execute 'set local role authenticated';
  perform pg_temp.s23_as(o1);
  msg := pg_temp.s23_err(format('select jc_pet_photo_remove(%L)', v_dog));
  if msg is distinct from 'NO_PHOTO' then raise exception 'FAIL F04 second remove: %', msg; end if;
  k := k + 1;

  -- ---------- F05 the second member's pending upload can still be committed afterwards ----------
  perform pg_temp.s23_as(m2);
  insert into storage.objects (bucket_id, name, owner, metadata) values ('pet-photos', v_p3, m2, v_meta);
  v := jc_pet_photo_commit(v_dog);
  if v ->> 'photo_path' <> v_p3 then raise exception 'FAIL F05 commit after remove: %', v; end if;
  k := k + 1;

  -- ---------- F06 a Pets admin removes a stray's photo ----------
  perform pg_temp.s23_as(ad);
  v := jc_pet_photo_remove(v_cat);
  if v -> 'photo_path' <> 'null'::jsonb or v ->> 'kind' <> 'stray' then raise exception 'FAIL F06 stray: %', v; end if;
  k := k + 1;

  -- ---------- F07 kill switch ----------
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{pets,enabled}', 'false') where id = 'testville23';
  execute 'set local role authenticated';
  perform pg_temp.s23_as(o1);
  msg := pg_temp.s23_err(format('select jc_pet_photo_remove(%L)', v_dog));
  if msg is distinct from 'MODULE_OFF' then raise exception 'FAIL F07 module off: %', msg; end if;
  execute 'reset role';
  if (select photo_path from jc_pets where id = v_dog) is distinct from v_p3 then raise exception 'FAIL F07b removed with module off'; end if;
  k := k + 2;

  -- ---------- F08 grants: authenticated only; definer + pinned search_path ----------
  if has_function_privilege('anon', 'public.jc_pet_photo_remove(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.jc_pet_photo_remove(uuid)', 'execute') then
    raise exception 'FAIL F08a grants'; end if;
  if not (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.jc_pet_photo_remove(uuid)'::regprocedure) then
    raise exception 'FAIL F08b definer / search_path'; end if;
  k := k + 2;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's23_pet_photo_remove: % checks passed', k;
end
$t$;
