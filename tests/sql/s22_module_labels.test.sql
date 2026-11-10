-- RM-a — renamable modules: jc_communities.module_labels, jc_admin_module_label_set, jc_config_get 'labels'.
-- Own communities (testville22 / testville22b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  ca uuid := '00000000-0000-4000-8000-000000002201';  -- community admin (code unlock)
  ba uuid := '00000000-0000-4000-8000-000000002202';  -- Courts admin only (code unlock)
  mb uuid := '00000000-0000-4000-8000-000000002203';  -- plain member
  xa uuid := '00000000-0000-4000-8000-000000002204';  -- testville22b community admin
  v jsonb; k int := 0; msg text; n int;
begin
  execute $f$create function pg_temp.s22_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s22_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s22_as(uuid), pg_temp.s22_err(text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (ca, 'ca@s22.test'), (ba, 'ba@s22.test'), (mb, 'mb@s22.test'), (xa, 'xa@s22.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville22', 'Testville 22', 24.53, 54.43, '{"bookings": {"enabled": true, "per_home_active": 2}}'),
    ('testville22b', 'Testville 22b', 25.00, 55.00, '{}');
  insert into jc_villages (community_id, key, name_en) values ('testville22', 'north', 'North'), ('testville22b', 'north', 'North');
  perform jc_code_set('testville22', 'join', 'S22-JOIN-CODE-01');
  perform jc_code_set('testville22', 'community', 'S22-COMMUNITY-01');
  perform jc_code_set('testville22', 'bookings', 'S22-BOOKINGS-01');
  perform jc_code_set('testville22b', 'join', 'S22B-JOIN-CODE-01');
  perform jc_code_set('testville22b', 'community', 'S22B-COMMUNITY-01');

  execute 'set local role authenticated';
  perform pg_temp.s22_as(ca); perform jc_join('testville22', 'S22-JOIN-CODE-01'); perform jc_admin_unlock('S22-COMMUNITY-01');
  perform pg_temp.s22_as(ba); perform jc_join('testville22', 'S22-JOIN-CODE-01'); perform jc_admin_unlock('S22-BOOKINGS-01');
  perform pg_temp.s22_as(mb); perform jc_join('testville22', 'S22-JOIN-CODE-01');
  perform pg_temp.s22_as(xa); perform jc_join('testville22b', 'S22B-JOIN-CODE-01'); perform jc_admin_unlock('S22B-COMMUNITY-01');

  -- ---------- L01 default: nothing set, config carries an empty 'labels' ----------
  execute 'set local role anon';
  v := jc_config_get('testville22');
  if v -> 'labels' is distinct from '{}'::jsonb then raise exception 'FAIL L01a default labels: %', v -> 'labels'; end if;
  if v -> 'modules' -> 'bookings' ->> 'enabled' <> 'true' then raise exception 'FAIL L01b modules unchanged: %', v; end if;
  k := k + 2;

  -- ---------- L02 rename Courts: cleaned, returned, in the anon config ----------
  execute 'set local role authenticated';
  perform pg_temp.s22_as(ca);
  v := jc_admin_module_label_set('bookings', E'  Sports​ ', 'الرياضة', null, '  ');
  if v -> 'bookings' is distinct from '{"name": {"en": "Sports", "ar": "الرياضة"}}'::jsonb then
    raise exception 'FAIL L02a cleaned entry: %', v; end if;
  execute 'set local role anon';
  if jc_config_get('testville22') #>> '{labels,bookings,name,en}' <> 'Sports' then raise exception 'FAIL L02b config'; end if;
  k := k + 2;

  -- ---------- L03 a second module never disturbs the first (premortem 1) ----------
  execute 'set local role authenticated';
  perform pg_temp.s22_as(ca);
  v := jc_admin_module_label_set('pets', null, null, 'Pets of Testville', null);
  if v -> 'pets' is distinct from '{"title": {"en": "Pets of Testville"}}'::jsonb then raise exception 'FAIL L03a title only: %', v; end if;
  if v #>> '{bookings,name,en}' <> 'Sports' then raise exception 'FAIL L03b bookings lost: %', v; end if;
  v := jc_admin_module_label_set('events', 'Happenings', 'المناسبات', 'What''s On', 'ما الجديد');
  if v #>> '{events,title,ar}' <> 'ما الجديد' or v #>> '{pets,title,en}' <> 'Pets of Testville' then
    raise exception 'FAIL L03c events + pets: %', v; end if;
  k := k + 3;

  -- ---------- L04 refusals ----------
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'Neighbours', null, null, null)$q$);
  if msg is distinct from 'NAME_BOTH' then raise exception 'FAIL L04a en without ar: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', null, 'الجيران', null, null)$q$);
  if msg is distinct from 'NAME_BOTH' then raise exception 'FAIL L04b ar without en: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', '123456789012345', 'ج', null, null)$q$);
  if msg is distinct from 'TOO_LONG' then raise exception 'FAIL L04c 15-char name: %', msg; end if;
  msg := pg_temp.s22_err(format('select jc_admin_module_label_set(%L, null, null, %L, null)', 'community', repeat('x', 41)));
  if msg is distinct from 'TOO_LONG' then raise exception 'FAIL L04d 41-char title: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('admin', 'Tools', 'أدوات', null, null)$q$);
  if msg is distinct from 'BAD_MODULE' then raise exception 'FAIL L04e admin key: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('directory', 'Services', 'الخدمات', null, null)$q$);
  if msg is distinct from 'BAD_MODULE' then raise exception 'FAIL L04f directory not yet: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set(null, 'X', 'س', null, null)$q$);
  if msg is distinct from 'BAD_MODULE' then raise exception 'FAIL L04g null key: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'SPORTS', 'الجيران', null, null)$q$);
  if msg is distinct from 'NAME_TAKEN' then raise exception 'FAIL L04h en taken (case): %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'Neighbours', 'الرياضة', null, null)$q$);
  if msg is distinct from 'NAME_TAKEN' then raise exception 'FAIL L04i ar taken: %', msg; end if;
  -- renaming a module to its own current name is fine
  v := jc_admin_module_label_set('bookings', 'sports', 'الرياضة', null, null);
  if v #>> '{bookings,name,en}' <> 'sports' then raise exception 'FAIL L04j own name: %', v; end if;
  -- a 14-character name and a 40-character title are fine
  v := jc_admin_module_label_set('community', '12345678901234', 'ج', repeat('t', 40), null);
  if v #>> '{community,name,en}' <> '12345678901234' then raise exception 'FAIL L04k caps inclusive: %', v; end if;
  k := k + 11;

  -- ---------- L05 reset: all blank removes that module only ----------
  v := jc_admin_module_label_set('community', ' ', '', null, E'​');
  if v ? 'community' then raise exception 'FAIL L05a reset kept: %', v; end if;
  if not (v ? 'bookings' and v ? 'pets' and v ? 'events') then raise exception 'FAIL L05b reset took others: %', v; end if;
  k := k + 2;

  -- ---------- L06 an out-of-band flag switch never touches names (premortem 2b) ----------
  execute 'reset role';
  update jc_communities set modules = '{"bookings": {"enabled": false}}' where id = 'testville22';
  if (select module_labels #>> '{bookings,name,en}' from jc_communities where id = 'testville22') <> 'sports' then
    raise exception 'FAIL L06 flag update wiped names'; end if;
  k := k + 1;

  -- ---------- L07 who may rename ----------
  execute 'set local role authenticated';
  perform pg_temp.s22_as(ba);
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('bookings', 'Courts', 'الملاعب', null, null)$q$);
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL L07a Courts admin renamed: %', msg; end if;
  perform pg_temp.s22_as(mb);
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('bookings', 'Courts', 'الملاعب', null, null)$q$);
  if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL L07b member renamed: %', msg; end if;
  -- another community's admin changes only its own community
  perform pg_temp.s22_as(xa);
  v := jc_admin_module_label_set('bookings', 'Courts B', 'ملاعب ب', null, null);
  execute 'reset role';
  if (select module_labels #>> '{bookings,name,en}' from jc_communities where id = 'testville22') <> 'sports'
     or (select module_labels #>> '{bookings,name,en}' from jc_communities where id = 'testville22b') <> 'Courts B' then
    raise exception 'FAIL L07c cross-community'; end if;
  k := k + 3;

  -- ---------- L08 logged: module + reset, never the text ----------
  select count(*) into n from jc_admin_log where community_id = 'testville22' and action = 'module_label_set';
  if n <> 6 then raise exception 'FAIL L08a log rows (refusals log nothing): %', n; end if;
  if exists (select 1 from jc_admin_log where community_id = 'testville22' and action = 'module_label_set'
              and (target::text like '%sports%' or target::text like '%Happenings%')) then
    raise exception 'FAIL L08b text in the log'; end if;
  if not exists (select 1 from jc_admin_log where community_id = 'testville22' and action = 'module_label_set'
                  and target = '{"module": "community", "reset": true}'::jsonb) then
    raise exception 'FAIL L08c reset logged'; end if;
  k := k + 3;

  -- ---------- L09 the column only takes an object ----------
  msg := null; begin update jc_communities set module_labels = '[]' where id = 'testville22'; exception when check_violation then msg := 'ok'; end;
  if msg is null then raise exception 'FAIL L09 array accepted'; end if;
  k := k + 1;

  -- ---------- L11 each call replaces the module's whole entry (database review L3) ----------
  execute 'set local role authenticated';
  perform pg_temp.s22_as(ca);
  perform jc_admin_module_label_set('community', 'Neighbours', 'الجيران', 'Our Island', null);
  v := jc_admin_module_label_set('community', 'Neighbours', 'الجيران', 'Our Village', null);
  if v -> 'community' is distinct from '{"name": {"en": "Neighbours", "ar": "الجيران"}, "title": {"en": "Our Village"}}'::jsonb then
    raise exception 'FAIL L11a title change kept the name: %', v; end if;
  v := jc_admin_module_label_set('community', null, null, 'Our Village', null);
  if v -> 'community' is distinct from '{"title": {"en": "Our Village"}}'::jsonb then
    raise exception 'FAIL L11b null name drops the name: %', v; end if;
  v := jc_admin_module_label_set('community', E'Sports   Club', 'نادي  الرياضة', null, null);
  if v #>> '{community,name,en}' <> 'Sports Club' or v #>> '{community,name,ar}' <> 'نادي الرياضة' then
    raise exception 'FAIL L11c inner spaces collapsed: %', v; end if;
  k := k + 3;

  -- ---------- L12 character allow-lists (security M1) ----------
  v := jc_config_get('testville22') -> 'labels';
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', E'Spo⁠rts', 'الجيران', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12a word joiner: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', E'ㅤ', 'الجيران', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12b hangul filler: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', E'  ', 'الجيران', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12c NBSP only: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', E'Ѕettings', 'الجيران', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12d Cyrillic lookalike: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'Neighbours', E'الجيرانَ', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12e tashkeel: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'Neighbours', 'الجيران', '<b>Hi</b>', null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12f markup in title: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('community', 'Neighbours', 'Neighbours', null, null)$q$);
  if msg is distinct from 'BAD_CHARS' then raise exception 'FAIL L12g Latin in the AR name: %', msg; end if;
  -- an accented Latin name and a mixed AR title are fine
  v := jc_admin_module_label_set('community', 'Café Corner', 'المقهى', 'Café & Co.', 'مقهى Jubail، أهلا؟');
  if v #>> '{community,title,ar}' <> 'مقهى Jubail، أهلا؟' then raise exception 'FAIL L12h allowed text: %', v; end if;
  k := k + 8;

  -- ---------- L13 reserved names (security M2) ----------
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'Account', 'الحيوانات', null, null)$q$);
  if msg is distinct from 'RESERVED_NAME' then raise exception 'FAIL L13a fixed label: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'events', 'الحيوانات', null, null)$q$);
  if msg is distinct from 'RESERVED_NAME' then raise exception 'FAIL L13b other built-in (renamed or not): %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'MyHome', 'الحيوانات', null, null)$q$);
  if msg is distinct from 'RESERVED_NAME' then raise exception 'FAIL L13c space/case: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'Animals', 'منزلي', null, null)$q$);
  if msg is distinct from 'RESERVED_NAME' then raise exception 'FAIL L13d AR fixed label: %', msg; end if;
  msg := pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'Animals', 'الملاعب', null, null)$q$);
  if msg is distinct from 'RESERVED_NAME' then raise exception 'FAIL L13e AR built-in: %', msg; end if;
  -- a module may take its own built-in name
  v := jc_admin_module_label_set('pets', 'Pets', 'الحيوانات الأليفة', null, null);
  if v #>> '{pets,name,en}' <> 'Pets' then raise exception 'FAIL L13f own built-in: %', v; end if;
  k := k + 6;

  -- ---------- L14 a refusal changes nothing; reset of an unset module is a no-op ----------
  v := jc_config_get('testville22') -> 'labels';
  perform pg_temp.s22_err($q$select jc_admin_module_label_set('pets', 'Organizer', 'الحيوانات', null, null)$q$);
  if jc_config_get('testville22') -> 'labels' is distinct from v then raise exception 'FAIL L14a refusal changed labels'; end if;
  execute 'reset role';
  update jc_communities set module_labels = module_labels - 'events' where id = 'testville22';
  execute 'set local role authenticated';
  perform pg_temp.s22_as(ca);
  v := jc_admin_module_label_set('events', null, null, null, null);
  if v ? 'events' or not v ? 'pets' then raise exception 'FAIL L14b reset unset: %', v; end if;
  k := k + 2;

  -- ---------- L15 jc_config_get keeps every other key (database review M2) ----------
  execute 'set local role anon';
  v := jc_config_get('testville22');
  if (select array_agg(x order by x) from jsonb_object_keys(v) x) is distinct from
     array['brand', 'broadcast', 'id', 'labels', 'links', 'map', 'modules', 'name_ar', 'name_en', 'tz', 'villages'] then
    raise exception 'FAIL L15a config keys: %', (select array_agg(x order by x) from jsonb_object_keys(v) x); end if;
  if jsonb_array_length(v -> 'villages') <> 1 or v #>> '{villages,0,key}' <> 'north' or v #>> '{map,zoom}' is null then
    raise exception 'FAIL L15b config values: %', v; end if;
  k := k + 2;
  execute 'reset role';

  -- ---------- L16 the column is size-capped (security L3) ----------
  msg := null;
  begin update jc_communities set module_labels = jsonb_build_object('x', repeat('y', 5000)) where id = 'testville22';
  exception when check_violation then msg := 'ok'; end;
  if msg is null then raise exception 'FAIL L16 oversized labels accepted'; end if;
  k := k + 1;

  -- ---------- L10 grants: authenticated only ----------
  if has_function_privilege('anon', 'public.jc_admin_module_label_set(text, text, text, text, text)', 'execute') then
    raise exception 'FAIL L10 anon can rename'; end if;
  k := k + 1;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's22_module_labels: % checks passed', k;
end
$t$;
