-- T2 / S2 behaviour tests: events, event-day state, crowd reports, archive-at-close,
-- instrumentation, Halloween baseline. Run via tests/sql/build_dryrun.sh (rolls back).
-- Users u1..u8 are disjoint from S1's fixtures; homes avoid S1's (Ain Al Maha 12-A / 14).

do $t$
declare
  u1 uuid := '00000000-0000-4000-8000-000000000201';
  u2 uuid := '00000000-0000-4000-8000-000000000202';
  u3 uuid := '00000000-0000-4000-8000-000000000203';
  u4 uuid := '00000000-0000-4000-8000-000000000204';
  u5 uuid := '00000000-0000-4000-8000-000000000205';
  u6 uuid := '00000000-0000-4000-8000-000000000206';
  u7 uuid := '00000000-0000-4000-8000-000000000207';
  u8 uuid := '00000000-0000-4000-8000-000000000208';
  v jsonb; v_err text; v_tok text; n int; k int := 0;
  v_hw uuid; v_diwali uuid; v_quiet uuid; v_e1 uuid; v_e2 uuid; v_home1 uuid;
  v_schema jsonb := '{"fields": {"lamps": {"type": "enum", "values": ["yes", "no"], "required": true},
                                 "sweets": {"type": "text", "max": 20}}}';
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (u1, 'u1@s2.test'), (u2, 'u2@s2.test'), (u3, 'u3@s2.test'), (u4, 'u4@s2.test'),
    (u5, 'u5@s2.test'), (u6, 'u6@s2.test'), (u7, 'u7@s2.test'), (u8, 'u8@s2.test');
  perform jc_code_set('jubail', 'join', 'S2-JOIN-CODE-01');
  perform jc_code_set('jubail', 'events', 'S2-EVENTS-ADMIN-01');
  perform jc_code_set('jubail', 'community', 'S2-COMMUNITY-ADMIN-01');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules)
  values ('testville2', 'Testville 2', 25.0, 55.0, '{"events": {"enabled": true}}');
  perform jc_code_set('testville2', 'join', 'S2-TV2-JOIN-01');
  insert into jc_villages (community_id, key, name_en) values ('testville2', 'north', 'North');
  select id into v_hw from jc_events where community_id = 'jubail' and slug = 'halloween-2026';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  v_home1 := (jc_home_claim('seef-al-jubail', 'villa', null, '1') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5600, 54.5000);
  v_tok := jc_invite_create() ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform jc_invite_accept(v_tok);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform jc_home_claim('seef-al-jubail', 'villa', null, '2');
  perform jc_home_pin_set(24.5610, 54.5010);  -- T5.2: signing up needs a pin (NO_PIN)
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform jc_home_claim('marsa-al-jubail', 'villa', null, '7');
  perform jc_home_pin_set(24.5620, 54.5020);
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform jc_home_claim('nad-al-dhabi', 'villa', null, '3');
  perform jc_home_pin_set(24.5630, 54.5030);
  perform set_config('request.jwt.claims', json_build_object('sub', u6, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  perform jc_join('jubail', 'S2-JOIN-CODE-01');
  perform jc_home_claim('souk-al-jubail', 'villa', null, '9');
  perform jc_admin_unlock('s2-events-admin-01');
  perform set_config('request.jwt.claims', json_build_object('sub', u8, 'role', 'authenticated')::text, true);
  perform jc_join('testville2', 'S2-TV2-JOIN-01');
  perform jc_home_claim('north', 'villa', null, '1');  -- a resident WITH a home, so E13 tests isolation, not NO_HOME

  -- ---------- E01 module flag is the kill switch ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_events_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL E01 events visible with module off: %', v_err; end if;
  v_err := null; begin perform jc_my_history(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'MODULE_OFF' then raise exception 'FAIL E01b history visible with module off: %', v_err; end if;
  execute 'reset role';
  update jc_communities set modules = jsonb_set(modules, '{events,enabled}', 'true') where id = 'jubail';
  execute 'set local role authenticated';
  k := k + 2;

  -- ---------- E02 Halloween 2026 baseline ----------
  v := jc_events_list();
  if not exists (select 1 from jsonb_array_elements(v) x
                  where x ->> 'slug' = 'halloween-2026' and x ->> 'status' = 'archived' and (x ->> 'homes_in')::int = 124) then
    raise exception 'FAIL E02a baseline not listed: %', v; end if;
  v := jc_event_stats_get(v_hw);
  if (v ->> 'homes')::int <> 124 or (v -> 'by_village' ->> 'marfaa-al-jubail')::int <> 2
     or (v -> 'payload' -> 'treats' ->> 'non_food')::int <> 3 or v ->> 'source' <> 'manual' then
    raise exception 'FAIL E02b baseline stats: %', v; end if;
  v := jc_event_get(v_hw);
  if v -> 'entries' <> 'null'::jsonb or (v -> 'stats' ->> 'homes')::int <> 124 then raise exception 'FAIL E02c archived get: %', v; end if;
  k := k + 3;

  -- ---------- E03 admin gates + validation ----------
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "x-1", "title_en": "X"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL E03a resident created an event: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "features": {"fireworks": true}}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FEATURES' then raise exception 'FAIL E03b: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "payload_schema": {"fields": {"when": {"type": "date"}}}}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SCHEMA' then raise exception 'FAIL E03c: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "color": "red"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL E03d: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "starts_at": "2026-11-10", "ends_at": "2026-11-09"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL E03e reversed window: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "Diwali!", "title_en": "D"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL E03f bad slug: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, jsonb_build_object('slug', 'd-1', 'title_en', repeat('T', 121))); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL E03i long title: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "theme": {"accent": "url(x)"}}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_FIELDS' then raise exception 'FAIL E03j theme not a colour: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "payload_schema": {"fields": {"s": {"type": "text", "max": "abc"}}}}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SCHEMA' then raise exception 'FAIL E03k non-numeric max: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "d-1", "title_en": "D", "payload_schema": {"fields": {"s": {"type": "text", "max": 5000}}}}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SCHEMA' then raise exception 'FAIL E03l huge max: %', v_err; end if;
  v := jc_admin_event_save(null, jsonb_build_object(
         'slug', 'diwali-2026', 'title_en', 'Diwali 2026', 'starts_at', '2099-11-01T14:00:00Z',   -- R2a: a homes event needs its date
         'features', '{"giant_switch": true, "supply": true, "crowd_reports": true}'::jsonb,
         'payload_schema', v_schema));
  select (x ->> 'id')::uuid into v_diwali from jsonb_array_elements(v) x where x ->> 'slug' = 'diwali-2026';
  if v_diwali is null then raise exception 'FAIL E03g create: %', v; end if;
  v_err := null; begin perform jc_admin_event_save(null, '{"slug": "diwali-2026", "title_en": "Again"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SLUG_TAKEN' then raise exception 'FAIL E03h: %', v_err; end if;
  k := k + 12;

  -- ---------- E04 drafts are invisible to residents ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  if exists (select 1 from jsonb_array_elements(jc_events_list()) x where x ->> 'slug' = 'diwali-2026') then
    raise exception 'FAIL E04a draft listed'; end if;
  v_err := null; begin perform jc_event_get(v_diwali); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E04b: %', v_err; end if;
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E04c signup on draft: %', v_err; end if;
  k := k + 3;

  -- ---------- E05 publish; payload validation; signup ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  perform jc_admin_event_publish(v_diwali);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "maybe"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PAYLOAD' then raise exception 'FAIL E05a bad enum: %', v_err; end if;
  v_err := null; begin perform jc_event_signup(v_diwali, '{}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'PAYLOAD_INCOMPLETE' then raise exception 'FAIL E05b missing required: %', v_err; end if;
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes", "color": "red"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PAYLOAD' then raise exception 'FAIL E05c unknown field: %', v_err; end if;
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes", "sweets": "a very long sweets list indeed"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PAYLOAD' then raise exception 'FAIL E05d text max: %', v_err; end if;
  -- note carries a bidi override (U+202E) + a control char: both stripped
  v := jc_event_signup(v_diwali, jsonb_build_object('lamps', 'yes', 'sweets', 'ladoo',
                                                    'note', 'come ' || chr(8238) || 'by' || chr(7)));
  if v -> 'mine' ->> 'note' <> 'come by' or v -> 'mine' -> 'payload' ? 'note' then raise exception 'FAIL E05e: %', v -> 'mine'; end if;
  v_e1 := (v -> 'mine' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL E05f: %', v_err; end if;
  k := k + 6;

  -- ---------- E06 one entry per home: a household member edits the same row ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  v := jc_event_signup(v_diwali, '{"lamps": "no"}');
  if (v -> 'mine' ->> 'id')::uuid <> v_e1 or v -> 'mine' -> 'payload' ->> 'lamps' <> 'no' then raise exception 'FAIL E06: %', v -> 'mine'; end if;
  k := k + 1;

  -- ---------- E07 map/list ----------
  foreach v_tok in array array[u2::text, u3::text, u4::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_tok, 'role', 'authenticated')::text, true);
    perform jc_event_signup(v_diwali, '{"lamps": "yes"}');
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v := jc_event_get(v_diwali);
  v_e2 := (v -> 'mine' ->> 'id')::uuid;
  if jsonb_array_length(v -> 'entries') <> 4
     or not exists (select 1 from jsonb_array_elements(v -> 'entries') x where x ->> 'village' = 'marsa-al-jubail') then
    raise exception 'FAIL E07: %', v -> 'entries'; end if;
  k := k + 1;

  -- ---------- E08 crowd reports: 1 private, 3+ public, per-account dedup, never your own ----------
  perform jc_entry_report(v_e1);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_entry_report(v_e1);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v := jc_event_get(v_diwali);
  if (v -> 'mine' ->> 'reports_open')::int <> 2
     or (select (x ->> 'reported_out')::boolean from jsonb_array_elements(v -> 'entries') x where (x ->> 'id')::uuid = v_e1) then
    raise exception 'FAIL E08a: %', v -> 'mine'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  perform jc_entry_report(v_e1);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_entry_report(v_e1);  -- duplicate: absorbed
  v := jc_event_get(v_diwali);
  if not (select (x ->> 'reported_out')::boolean from jsonb_array_elements(v -> 'entries') x where (x ->> 'id')::uuid = v_e1) then
    raise exception 'FAIL E08b 3 reports not public'; end if;
  execute 'reset role';
  select count(*) into n from jc_entry_reports where entry_id = v_e1 and cleared_at is null;
  if n <> 3 then raise exception 'FAIL E08c dedup: % open reports', n; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_entry_report(v_e1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'OWN_ENTRY' then raise exception 'FAIL E08d household reported own home: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u6, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_entry_report(v_e1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL E08e homeless account reported: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  k := k + 5;

  -- ---------- E09 owner clears + 30-minute lock ----------
  v := jc_entry_reports_clear(v_diwali);
  if (v -> 'mine' ->> 'reports_open')::int <> 0 or v -> 'mine' ->> 'reports_locked_until' is null then raise exception 'FAIL E09a: %', v -> 'mine'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_entry_report(v_e1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'REPORTS_LOCKED' then raise exception 'FAIL E09b: %', v_err; end if;
  k := k + 2;

  -- ---------- E10 giant switch + supply, behind feature flags; concurrent live events ----------
  v := jc_entry_live_set(v_diwali, 'done', 1);
  if v -> 'mine' ->> 'live_state' <> 'done' or (v -> 'mine' ->> 'supply_level')::int <> 1 then raise exception 'FAIL E10a: %', v -> 'mine'; end if;
  v_err := null; begin perform jc_entry_live_set(v_diwali, 'gone', null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL E10b: %', v_err; end if;
  v_err := null; begin perform jc_entry_live_set(v_diwali, null, 7); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_SUPPLY' then raise exception 'FAIL E10c: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_entry_report(v_e2); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'ALREADY_DONE' then raise exception 'FAIL E10d: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v := jc_admin_event_save(null, '{"slug": "quiet-meet", "title_en": "Quiet meet", "starts_at": "2099-11-02T14:00:00Z"}');
  select (x ->> 'id')::uuid into v_quiet from jsonb_array_elements(v) x where x ->> 'slug' = 'quiet-meet';
  perform jc_admin_event_publish(v_quiet);
  -- withdraw + re-signup starts fresh on event-day state (u2 is 'done', supply 1)
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_entry_withdraw(v_diwali);
  v := jc_event_signup(v_diwali, '{"lamps": "yes"}');
  if v -> 'mine' ->> 'live_state' <> 'active' or v -> 'mine' ->> 'supply_level' is not null then
    raise exception 'FAIL E10g re-signup kept stale state: %', v -> 'mine'; end if;
  perform jc_entry_live_set(v_diwali, 'done', 1);  -- restore for the steps below
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select count(*) into n from jsonb_array_elements(jc_events_list()) x where x ->> 'status' = 'live';
  if n <> 2 then raise exception 'FAIL E10e live events=% (want 2, concurrent)', n; end if;
  perform jc_event_signup(v_quiet, null);
  v_err := null; begin perform jc_entry_live_set(v_quiet, 'done', null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'FEATURE_OFF' then raise exception 'FAIL E10f: %', v_err; end if;
  v_err := null; begin perform jc_entry_live_set(v_quiet, null, null); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL E10h empty live_set: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_entry_reports_clear(v_quiet); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E10i clear without an entry: %', v_err; end if;
  select (x ->> 'id')::uuid into v_tok from jsonb_array_elements(jc_event_get(v_quiet) -> 'entries') x where x ->> 'village' = 'seef-al-jubail';
  v_err := null; begin perform jc_entry_report(v_tok::uuid); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E10j report with crowd_reports off: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_event_save(v_diwali, jsonb_build_object('payload_schema', v_schema)); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SCHEMA_LOCKED' then raise exception 'FAIL E10k schema edited after signups: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(v_hw, '{"title_en": "Halloween!"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'EVENT_ARCHIVED' then raise exception 'FAIL E10l archived event edited: %', v_err; end if;
  k := k + 12;

  -- ---------- E11 signups closed; withdraw still allowed and clears open reports ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  perform jc_admin_event_signups(v_diwali, false);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select (x ->> 'id')::uuid into v_tok from jsonb_array_elements(jc_event_get(v_diwali) -> 'entries') x
   where x ->> 'village' = 'nad-al-dhabi';
  perform jc_entry_report(v_tok::uuid);
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  v := jc_entry_withdraw(v_diwali);
  if v -> 'mine' ->> 'status' <> 'withdrawn' or (v -> 'mine' ->> 'reports_open')::int <> 0 then
    raise exception 'FAIL E11a: %', v -> 'mine'; end if;
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SIGNUPS_CLOSED' then raise exception 'FAIL E11b: %', v_err; end if;
  k := k + 2;

  -- ---------- E12 moderation: hidden from others, visible to its own household ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  perform jc_admin_entry_moderate(v_e2, true, 'please fix your pin');
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_event_get(v_diwali) -> 'entries') <> 2 then raise exception 'FAIL E12a hidden/withdrawn still listed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v := jc_event_get(v_diwali);
  if jsonb_array_length(v -> 'entries') <> 3 or v -> 'mine' ->> 'org_note' <> 'please fix your pin' then raise exception 'FAIL E12b: %', v -> 'mine'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_entry_moderate(v_e1, null, repeat('x', 281)); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_NOTE' then raise exception 'FAIL E12c long org note: %', v_err; end if;
  v_err := null; begin perform jc_admin_event_save(v_quiet, '{"slug": "quiet-2"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SLUG_LOCKED' then raise exception 'FAIL E12d published slug edited: %', v_err; end if;
  k := k + 4;

  -- ---------- E13 community isolation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u8, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_events_list()) <> 0 then raise exception 'FAIL E13a testville2 sees jubail events'; end if;
  v_err := null; begin perform jc_event_get(v_diwali); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E13b: %', v_err; end if;
  v_err := null; begin perform jc_entry_report(v_e1); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E13c: %', v_err; end if;
  k := k + 3;

  -- ---------- E14 archive-at-close: type-to-confirm, snapshot, nothing deleted ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_close(v_diwali, 'diwali-2026'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL E14a: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_close(v_diwali, 'diwali'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'CONFIRM_REQUIRED' then raise exception 'FAIL E14b: %', v_err; end if;
  v := jc_event_close(v_diwali, 'diwali-2026');
  -- in: u1-home (lamps no), u3 Marsa (yes); u2 hidden, u4 withdrawn → excluded
  if (v ->> 'homes')::int <> 2 or (v ->> 'done')::int <> 0
     or (v -> 'by_village' ->> 'marfaa-al-jubail')::int <> 1 or (v -> 'by_village' ->> 'seef-al-jubail')::int <> 1
     or v -> 'payload' -> 'lamps' <> '{"no": 1, "yes": 1}'::jsonb or v -> 'payload' ? 'sweets' then
    raise exception 'FAIL E14c snapshot: %', v; end if;
  execute 'reset role';
  select count(*) into n from jc_event_entries where event_id = v_diwali;
  if n <> 4 then raise exception 'FAIL E14d rows deleted at close: % left', n; end if;
  if exists (select 1 from jc_event_entries where event_id = v_diwali and archived_at is null)
     or (select status from jc_events where id = v_diwali) <> 'archived'
     or (select source from jc_event_stats where event_id = v_diwali) <> 'snapshot' then
    raise exception 'FAIL E14e archive state'; end if;
  execute 'set local role authenticated';
  v_err := null; begin perform jc_event_close(v_diwali, 'diwali-2026'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL E14f double close: %', v_err; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_event_signup(v_diwali, '{"lamps": "yes"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'SIGNUPS_CLOSED' then raise exception 'FAIL E14g: %', v_err; end if;
  v := jc_event_get(v_diwali);
  if v -> 'entries' <> 'null'::jsonb or (v -> 'stats' ->> 'homes')::int <> 2 then raise exception 'FAIL E14h archived view: %', v; end if;
  k := k + 8;

  -- ---------- E15 home history ----------
  if jsonb_array_length(jc_my_history()) <> 2 then raise exception 'FAIL E15a: %', jc_my_history(); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u6, 'role', 'authenticated')::text, true);
  if jc_my_history() <> '[]'::jsonb then raise exception 'FAIL E15b'; end if;
  k := k + 2;

  -- ---------- E15b a non-last member leaving does not withdraw the home ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  perform jc_home_leave();
  execute 'reset role';
  if (select status from jc_event_entries where event_id = v_quiet and home_id = v_home1) <> 'in' then
    raise exception 'FAIL E15c household member leaving withdrew the home'; end if;
  execute 'set local role authenticated';
  k := k + 1;

  -- ---------- E16 last member out withdraws the home from live events (archived stays) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  perform jc_event_signup(v_quiet, '{"note": "bye"}');
  perform jc_home_leave();
  execute 'reset role';
  select count(*) into n from jc_event_entries en join jc_homes h on h.id = en.home_id
   where en.event_id = v_quiet and h.village_key = 'nad-al-dhabi' and h.number_raw = '3'
     and en.status = 'withdrawn' and en.note is null;
  if n <> 1 then raise exception 'FAIL E16 vacated home still live, or its note survived'; end if;
  select count(*) into n from jc_event_entries en join jc_homes h on h.id = en.home_id
   where en.event_id = v_diwali and h.village_key = 'nad-al-dhabi' and h.number_raw = '3'
     and en.archived_at is not null and en.payload = '{}';
  if n <> 1 then raise exception 'FAIL E16b archived row gone, or the old family''s answers survived'; end if;
  k := k + 2;

  -- ---------- E17 account deletion with history (FK set-null / cascade paths) ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_account_delete('DELETE');
  execute 'reset role';
  if exists (select 1 from jc_entry_reports where reporter = u2)
     or (select updated_by from jc_event_entries where id = v_e2) is not null
     or not exists (select 1 from jc_event_entries where id = v_e2) then
    raise exception 'FAIL E17 history not anonymized cleanly'; end if;
  k := k + 1;

  -- ---------- E18 hit counter (anon) ----------
  execute 'set local role anon';
  perform jc_hit('jubail', 'landing');
  perform jc_hit('jubail', 'landing');
  v_err := null; begin perform jc_hit('jubail', 'secret'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_PAGE' then raise exception 'FAIL E18a: %', v_err; end if;
  v_err := null; begin perform jc_hit('nowhere', 'landing'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E18b: %', v_err; end if;
  v_err := null; begin perform jc_events_list(); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL E18c anon called events_list: %', v_err; end if;
  execute 'reset role';
  if (select count from jc_hits where community_id = 'jubail' and page = 'landing'
        and hour = date_trunc('hour', now())) < 2 then raise exception 'FAIL E18d count'; end if;
  k := k + 4;

  -- ---------- E19 state log + admin log captured the night ----------
  select count(distinct field) into n from jc_state_log
   where event_id = v_diwali and field in ('signup', 'report', 'reports_cleared', 'live_state', 'supply_level', 'status');
  if n <> 6 then raise exception 'FAIL E19a state-log fields=% (want 6)', n; end if;
  if not exists (select 1 from jc_admin_log where action = 'event_close' and target ->> 'slug' = 'diwali-2026') then
    raise exception 'FAIL E19b close not logged'; end if;
  k := k + 2;

  -- ---------- E20 community admin can run events; events admin can't run the community ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_admin_unlock('S2-COMMUNITY-ADMIN-01');
  perform jc_admin_events_list();
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  v_err := null; begin perform jc_admin_homes_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL E20: %', v_err; end if;
  k := k + 2;

  -- ---------- E21 every signed-up home is on the event map, for everyone (HH 2026-11-11: no hidden homes) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_event_get(v_quiet) -> 'entries') <> 1 then raise exception 'FAIL E21a neighbor map'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  if jsonb_array_length(jc_event_get(v_quiet) -> 'entries') <> 1 then raise exception 'FAIL E21b owner lost own entry'; end if;
  if (jc_event_get(v_quiet) -> 'mine') ? 'home_hidden' then raise exception 'FAIL E21c home_hidden still sent'; end if;
  k := k + 3;

  -- ---------- E22 another community's events admin can't touch jubail events ----------
  execute 'reset role';
  perform jc_code_set('testville2', 'events', 'S2-TV2-EVENTS-01');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u8, 'role', 'authenticated')::text, true);
  perform jc_admin_unlock('S2-TV2-EVENTS-01');
  v_err := null; begin perform jc_admin_event_save(v_quiet, '{"title_en": "mine now"}'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E22a cross-community edit: %', v_err; end if;
  v_err := null; begin perform jc_event_close(v_quiet, 'quiet-meet'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E22b cross-community close: %', v_err; end if;
  v_err := null; begin perform jc_admin_entries_list(v_quiet); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL E22c cross-community entries: %', v_err; end if;
  if jsonb_array_length(jc_admin_events_list()) <> 0 then raise exception 'FAIL E22d cross-community list'; end if;
  k := k + 4;

  -- ---------- E23 deleting an admin anonymizes, never blocks or erases ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u7, 'role', 'authenticated')::text, true);
  perform jc_account_delete('DELETE');
  execute 'reset role';
  if exists (select 1 from jc_events where created_by = u7) or exists (select 1 from jc_admin_log where actor = u7)
     or exists (select 1 from jc_state_log where actor = u7) then raise exception 'FAIL E23a user id survived'; end if;
  if (select created_by from jc_events where id = v_diwali) is not null
     or not exists (select 1 from jc_admin_log where action = 'event_close' and actor is null)
     or not exists (select 1 from jc_state_log where event_id = v_diwali) then
    raise exception 'FAIL E23b history lost'; end if;
  k := k + 2;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's2_events: % checks passed', k;
end
$t$;
