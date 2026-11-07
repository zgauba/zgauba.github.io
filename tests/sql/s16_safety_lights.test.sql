-- R2b-2 — safety block, holiday lights, clean event text (docs/plans/R2b-2-safety-lights.md). Each check fails on
-- the code live before R2b-2: holiday_lights refused by jc_events_look_check; safety accepted any key and any
-- string (no phone rule, stored raw); title / description stored raw (a whitespace-only title was accepted).
-- Own communities (testville16 / testville16b). Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001601';  -- organizer (community code)
  e1 uuid := '00000000-0000-4000-8000-000000001602';  -- event admin of ev
  r1 uuid := '00000000-0000-4000-8000-000000001603';  -- resident
  o1 uuid := '00000000-0000-4000-8000-000000001604';  -- testville16b organizer
  v jsonb; k int := 0; tok text; ev uuid; ev_old uuid; ev_b uuid; s jsonb; bad text; msg text;
begin
  execute $f$create function pg_temp.s16_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s16_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s16_ev(l jsonb, s text) returns uuid language sql as
    $b$ select (e ->> 'id')::uuid from jsonb_array_elements(l) e where e ->> 'slug' = s $b$$f$;
  execute 'grant execute on function pg_temp.s16_as(uuid), pg_temp.s16_err(text), pg_temp.s16_ev(jsonb, text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (c1, 'c1@s16.test'), (e1, 'e1@s16.test'), (r1, 'r1@s16.test'), (o1, 'o1@s16.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville16', 'Testville 16', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville16b', 'Testville 16b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville16', 'north', 'North'), ('testville16b', 'north', 'North');
  perform jc_code_set('testville16', 'join', 'S16-JOIN-CODE-01');
  perform jc_code_set('testville16', 'community', 'S16-COMMUNITY-01');
  perform jc_code_set('testville16b', 'join', 'S16B-JOIN-CODE-01');
  perform jc_code_set('testville16b', 'community', 'S16B-COMMUNITY-01');
  -- written before R2b-2 (raw text, a free-form safety object): the migration leaves stored rows as they are
  insert into jc_events (community_id, slug, title_en, description_en, status, signups_open, payload_schema, starts_at, safety)
  values ('testville16', 'old-night', E'  Old‮ night ', E'raw\u0007', 'live', true, '{"fields": {}}',
          now() + interval '5 days', '{"note": "free form"}') returning id into ev_old;

  execute 'set local role authenticated';
  perform pg_temp.s16_as(c1); perform jc_join('testville16', 'S16-JOIN-CODE-01'); perform jc_admin_unlock('S16-COMMUNITY-01');
  perform pg_temp.s16_as(e1); perform jc_join('testville16', 'S16-JOIN-CODE-01');
  perform pg_temp.s16_as(r1); perform jc_join('testville16', 'S16-JOIN-CODE-01');
  perform pg_temp.s16_as(o1); perform jc_join('testville16b', 'S16B-JOIN-CODE-01'); perform jc_admin_unlock('S16B-COMMUNITY-01');

  -- ---------- L01 holiday lights: a look the server keeps ----------
  perform pg_temp.s16_as(c1);
  v := jc_admin_event_save(null, '{"slug": "lights", "title_en": "Holiday Lights", "look": "holiday_lights",
                                   "features": {"giant_switch": true}, "starts_at": "2099-12-20T16:00:00Z"}');
  ev := pg_temp.s16_ev(v, 'lights');
  if ev is null or (v -> 0 ->> 'look') is distinct from 'holiday_lights' then
    raise exception 'FAIL L01a a holiday lights event was not saved with its look'; end if;
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"look": "disco"}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL L01b an unknown look is still refused'; end if;
  perform jc_admin_event_save(ev, '{"look": "plain"}');
  perform jc_admin_event_save(ev, '{"look": "holiday_lights"}');   -- and back again on an existing event
  execute 'reset role';
  if (select look from jc_events where id = ev) <> 'holiday_lights' then raise exception 'FAIL L01c look switched back'; end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.jc_events'::regclass and conname = 'jc_events_look_check')
     <> 'CHECK ((look = ANY (ARRAY[''plain''::text, ''halloween''::text, ''haq_al_laila''::text, ''gathering''::text, ''market''::text, ''yard_sale''::text, ''holiday_lights''::text])))' then
    raise exception 'FAIL L01d jc_events_look_check is not the seven looks'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- S01 safety: round trip, normalised ----------
  perform pg_temp.s16_as(c1);
  v := jc_admin_event_save(ev, jsonb_build_object('features', '{"giant_switch": true, "safety": true}'::jsonb,
         'safety', jsonb_build_object('phone', E' +971  2\t555 0100 ', 'meeting_en', E'  Gate B‮ kiosk\n ',
                                      'meeting_ar', E'البوابة ب⁦ ')));
  execute 'reset role';
  s := (select safety from jc_events where id = ev);
  if s <> jsonb_build_object('phone', '+971 2 555 0100', 'meeting_en', 'Gate B kiosk', 'meeting_ar', 'البوابة ب') then
    raise exception 'FAIL S01a safety not stored normalised: %', s; end if;
  if (select features from jc_events where id = ev) <> '{"giant_switch": true, "safety": true}'::jsonb then
    raise exception 'FAIL S01b the safety switch was not stored'; end if;
  if not exists (select 1 from jc_admin_log where community_id = 'testville16' and action = 'event_save'
                  and target -> 'fields' ? 'safety' and target ->> 'event_id' = ev::text) then
    raise exception 'FAIL S01c the safety save is not in the admin log'; end if;
  execute 'set local role authenticated';
  -- the list the editor reads, and the event page a resident reads, carry the stored block
  if (select e -> 'safety' from jsonb_array_elements(v) e where e ->> 'id' = ev::text) <> s then
    raise exception 'FAIL S01d jc_admin_events_list does not return the stored block'; end if;
  perform jc_admin_event_publish(ev);
  perform pg_temp.s16_as(r1);
  if (jc_event_get(ev) -> 'event' -> 'safety') <> s then raise exception 'FAIL S01e jc_event_get does not return the block'; end if;
  k := k + 5;

  -- ---------- S02 safety: only its own keys; phone format; meeting length ----------
  perform pg_temp.s16_as(c1);
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"safety": {"phone": "999", "child_name": "Sam"}}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL S02a a key outside phone / meeting_en / meeting_ar was accepted'; end if;
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"safety": {"phone": 999}}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL S02b a non-string phone was accepted'; end if;
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"safety": null}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL S02c a null safety was accepted'; end if;
  foreach bad in array array['javascript:alert(1)', '12', '1234567890123456', '+', '050-123-4567', '++971 50 123',
                             '050 1234567x', '+971 50 1234 5678 901', '٠٥٠١٢٣٤٥٦٧', '1 2 3 4 5 6 7 8 9 0 1 2 3', 'tel:999'] loop
    msg := pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, jsonb_build_object('safety', jsonb_build_object('phone', bad))));
    if msg is distinct from 'BAD_PHONE' then raise exception 'FAIL S02d phone % gave %', bad, coalesce(msg, 'no error'); end if;
  end loop;
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev,
       jsonb_build_object('safety', jsonb_build_object('meeting_en', repeat('x', 201))))) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL S02e a 201-character meeting point was accepted'; end if;
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev,
       jsonb_build_object('safety', jsonb_build_object('meeting_ar', repeat('ب', 201))))) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL S02f a 201-character Arabic meeting point was accepted'; end if;
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> s then raise exception 'FAIL S02g a refused save changed the block'; end if;
  execute 'set local role authenticated';
  -- short codes and the longest E.164 number pass
  perform jc_admin_event_save(ev, '{"safety": {"phone": "999", "meeting_en": "The clubhouse"}}');
  perform jc_admin_event_save(ev, '{"safety": {"phone": "+123456789012345"}}');
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> '{"phone": "+123456789012345"}'::jsonb then
    raise exception 'FAIL S02h the block is not replaced whole (or a 15-digit number was refused)'; end if;
  execute 'set local role authenticated';
  k := k + 8;

  -- ---------- S03 safety: blanks dropped, {} clears, untouched when not sent ----------
  perform jc_admin_event_save(ev, jsonb_build_object('safety', jsonb_build_object('phone', '  ', 'meeting_en', E' \u0007 ', 'meeting_ar', '')));
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> '{}'::jsonb then raise exception 'FAIL S03a blank values were stored'; end if;
  execute 'set local role authenticated';
  perform jc_admin_event_save(ev, '{"safety": {"phone": "800 123"}}');
  perform jc_admin_event_save(ev, '{"description_en": "Walk the lights"}');
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> '{"phone": "800 123"}'::jsonb then
    raise exception 'FAIL S03b a save without safety changed the block'; end if;
  execute 'set local role authenticated';
  perform jc_admin_event_save(ev, '{"safety": {}}');
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> '{}'::jsonb then raise exception 'FAIL S03c {} did not clear the block'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- S04 who may set it: the event's admin yes; a resident and another community no ----------
  perform pg_temp.s16_as(c1);
  tok := jc_event_admin_link_create(ev) ->> 'token';
  perform pg_temp.s16_as(e1); perform jc_event_admin_accept(tok);
  perform jc_admin_event_save(ev, '{"safety": {"phone": "02 555 0199", "meeting_ar": "النادي"}}');
  perform pg_temp.s16_as(r1);
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"safety": {"phone": "999"}}')) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL S04a a resident set the safety block'; end if;
  perform pg_temp.s16_as(o1);
  msg := pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev, '{"safety": {"phone": "999"}}'));
  if msg is null then raise exception 'FAIL S04b another community''s organizer set the safety block'; end if;
  execute 'reset role';
  if (select safety from jc_events where id = ev) <> '{"phone": "02 555 0199", "meeting_ar": "النادي"}'::jsonb then
    raise exception 'FAIL S04c the event admin''s block was not kept (or a refused call changed it)'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- C01 event text is cleaned on write ----------
  perform pg_temp.s16_as(c1);
  v := jc_admin_event_save(null, jsonb_build_object('slug', 'clean', 'title_en', E'  Lights\u0007\n night‮ ',
         'title_ar', E'⁦ليلة الأضواء⁩ ', 'description_en', E'Line one\r\n\n**Line two**\u0001x ',
         'description_ar', E' مرحبا‌بكم '));
  ev_b := pg_temp.s16_ev(v, 'clean');
  execute 'reset role';
  if (select title_en from jc_events where id = ev_b) <> 'Lights night' then raise exception 'FAIL C01a title_en not cleaned'; end if;
  if (select title_ar from jc_events where id = ev_b) <> 'ليلة الأضواء' then raise exception 'FAIL C01b title_ar not cleaned'; end if;
  if (select description_en from jc_events where id = ev_b) <> E'Line one\n\n**Line two**x' then
    raise exception 'FAIL C01c description_en not cleaned (or lost its newlines): %', (select description_en from jc_events where id = ev_b); end if;
  if (select description_ar from jc_events where id = ev_b) <> E'مرحبا‌بكم' then
    raise exception 'FAIL C01d description_ar lost its zero-width non-joiner or kept its outer whitespace'; end if;
  execute 'set local role authenticated';
  -- updates too; blank optional text is null
  perform jc_admin_event_save(ev_b, jsonb_build_object('title_en', E'‪New title ', 'title_ar', '   ',
                                                       'description_en', E' \u0001 ', 'description_ar', ''));
  execute 'reset role';
  if (select row(title_en, title_ar, description_en, description_ar)::text from jc_events where id = ev_b) <> '("New title",,,)' then
    raise exception 'FAIL C01e update not cleaned / blanks not null: %',
      (select row(title_en, title_ar, description_en, description_ar)::text from jc_events where id = ev_b); end if;
  execute 'set local role authenticated';
  k := k + 5;

  -- ---------- C02 a title that cleans to nothing is no title; null still means unchanged ----------
  if pg_temp.s16_err(format('select jc_admin_event_save(%L, %L)', ev_b, jsonb_build_object('title_en', E'  ‮ '))) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL C02a a blank title was accepted on update'; end if;
  if pg_temp.s16_err(format('select jc_admin_event_save(null, %L)', jsonb_build_object('slug', 'blank-title', 'title_en', E'\t \u0007'))) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL C02b a blank title was accepted on create'; end if;
  perform jc_admin_event_save(ev_b, '{"title_en": null, "description_en": "Kept"}');
  execute 'reset role';
  if (select title_en from jc_events where id = ev_b) <> 'New title' then raise exception 'FAIL C02c title_en null changed the title'; end if;
  if exists (select 1 from jc_events where community_id = 'testville16' and slug = 'blank-title') then
    raise exception 'FAIL C02d the blank-title event was created'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- C03 stored rows are left as they are (an unrelated save doesn't rewrite them) ----------
  perform jc_admin_event_save(ev_old, '{"starts_at": "2099-12-24T16:00:00Z"}');
  execute 'reset role';
  if (select row(title_en, description_en, safety::text)::text from jc_events where id = ev_old)
     <> row(E'  Old‮ night ', E'raw\u0007', '{"note": "free form"}')::text then
    raise exception 'FAIL C03a an older row was rewritten'; end if;
  k := k + 1;

  -- ---------- G01 contract: signatures, definer, grants ----------
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('jc_admin_event_save', 'jc_event_signup', 'jc_entry_live_set',
                                                     'jc_event_close', 'jc_admin_broadcast_set', 'jc_event_get'))
     <> 'jc_admin_broadcast_set(p_text text), jc_admin_event_save(p_event uuid, p_fields jsonb), '
        'jc_entry_live_set(p_event uuid, p_state text, p_supply integer), jc_event_close(p_event uuid, p_confirm text), '
        'jc_event_get(p_event uuid), jc_event_signup(p_event uuid, p_payload jsonb)' then
    raise exception 'FAIL G01a a frozen signature changed (or gained an overload)'; end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.jc_admin_event_save(uuid, jsonb)'::regprocedure
                  and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    raise exception 'FAIL G01b jc_admin_event_save is not security definer with a pinned search_path'; end if;
  if has_function_privilege('anon', 'public.jc_admin_event_save(uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.jc_admin_event_save(uuid, jsonb)', 'execute') then
    raise exception 'FAIL G01c jc_admin_event_save grants changed'; end if;
  k := k + 3;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's16_safety_lights: % checks passed', k;
end
$t$;
