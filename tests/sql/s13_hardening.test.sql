-- T5.2 hardening tests: allergy_friendly / ring_split validation, jc_entry_reports_clear holds the home,
-- jc_admin_report's whole-platform rows are owner-only, the cron failure text keeps its first line, and no
-- client-callable function returns who reported a home. Own community (testville13). Rolls back.

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001301';  -- community admin (not the platform owner)
  o1 uuid := '00000000-0000-4000-8000-000000001302';  -- platform owner, also a community admin
  r1 uuid := '00000000-0000-4000-8000-000000001303';  -- resident, signed up, reported
  r2 uuid := '00000000-0000-4000-8000-000000001304';  -- neighbor who reports
  v jsonb; v_err text; k int := 0; ev uuid; en uuid; bad text; job bigint;
  ring jsonb := '{"type": "enum", "values": ["front", "garden", "both"], "pin": "ring"}';
  icon jsonb := '{"type": "enum", "values": ["candy", "non_food"], "pin": "glyph"}';
begin
  execute $f$create function pg_temp.s13_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s13_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s13_schema(f jsonb) returns text language plpgsql as
    $b$ begin perform jc_schema_check(jsonb_build_object('fields', jsonb_build_object('q', f))); return null;
        exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s13_as(uuid), pg_temp.s13_err(text), pg_temp.s13_schema(jsonb) to authenticated';

  -- ---------- H01 the ticks the builder writes are accepted ----------
  if pg_temp.s13_schema(icon || '{"allergy_friendly": ["non_food"]}') is not null then raise exception 'FAIL H01a allergy'; end if;
  if pg_temp.s13_schema(ring || '{"ring_split": ["both"]}') is not null then raise exception 'FAIL H01b split'; end if;
  if pg_temp.s13_schema(icon || '{"allergy_friendly": []}') is not null then raise exception 'FAIL H01c empty'; end if;
  k := k + 3;

  -- ---------- H02 anything else is BAD_SCHEMA ----------
  foreach bad in array array[
    (ring || '{"allergy_friendly": ["front"]}')::text,                 -- tint on the ring question
    (icon || '{"ring_split": ["candy"]}')::text,                       -- split on the icon question
    '{"type": "enum", "values": ["a"], "ring_split": ["a"]}',          -- not a pin question
    '{"type": "text", "allergy_friendly": []}',                        -- not a choice question
    (icon || '{"allergy_friendly": "non_food"}')::text,                -- not an array
    (icon || '{"allergy_friendly": ["gummies"]}')::text,               -- not one of its choices
    (icon || '{"allergy_friendly": [1]}')::text,                       -- not a string
    (icon || jsonb_build_object('allergy_friendly', (select jsonb_agg('candy'::text) from generate_series(1, 21))))::text  -- > 20
  ] loop
    if pg_temp.s13_schema(bad::jsonb) is distinct from 'BAD_SCHEMA' then raise exception 'FAIL H02 accepted: %', bad; end if;
    k := k + 1;
  end loop;

  -- ---------- H03 every event already in the database still passes (live data stays valid) ----------
  for v in select payload_schema from jc_events loop
    begin perform jc_schema_check(v); exception when others then raise exception 'FAIL H03 existing schema rejected: %', v; end;
  end loop;
  k := k + 1;

  -- fixtures
  insert into auth.users (id, email) values (c1, 'c1@s13.test'), (o1, 'o1@s13.test'), (r1, 'r1@s13.test'), (r2, 'r2@s13.test');
  insert into jc_platform_owners (user_id) values (o1);
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville13', 'Testville 13', 24.53, 54.43, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville13', 'north', 'North');
  perform jc_code_set('testville13', 'join', 'S13-JOIN-CODE-01');
  perform jc_code_set('testville13', 'community', 'S13-COMMUNITY-01');
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, features)
  values ('testville13', 'night', 'Night', 'live', true, '{"fields": {}}', '{"crowd_reports": true}') returning id into ev;

  execute 'set local role authenticated';
  perform pg_temp.s13_as(c1); perform jc_join('testville13', 'S13-JOIN-CODE-01'); perform jc_admin_unlock('S13-COMMUNITY-01');
  perform pg_temp.s13_as(o1); perform jc_join('testville13', 'S13-JOIN-CODE-01'); perform jc_admin_unlock('S13-COMMUNITY-01');
  perform pg_temp.s13_as(r1); perform jc_join('testville13', 'S13-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '1'); perform jc_home_pin_set(24.5301, 54.4301);
  en := (jc_event_signup(ev, '{}') -> 'mine' ->> 'id')::uuid;
  perform pg_temp.s13_as(r2); perform jc_join('testville13', 'S13-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '2'); perform jc_home_pin_set(24.5302, 54.4302);
  perform jc_entry_report(en);

  -- ---------- H04 "we're not out" still works for a member, and now holds the home ----------
  perform pg_temp.s13_as(r1);
  v := jc_entry_reports_clear(ev);
  if (v -> 'mine' ->> 'reports_open')::int <> 0 then raise exception 'FAIL H04a not cleared: %', v -> 'mine'; end if;
  execute 'reset role';
  if position('jc_home_hold' in pg_get_functiondef('public.jc_entry_reports_clear(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL H04b no jc_home_hold'; end if;
  -- no longer a member of the home → NO_HOME (security review F4: behaviour, not just the text)
  delete from jc_home_members where user_id = r1;
  execute 'set local role authenticated';
  perform pg_temp.s13_as(r1);
  v_err := pg_temp.s13_err(format('select jc_entry_reports_clear(%L)', ev));
  if v_err is distinct from 'NO_HOME' then raise exception 'FAIL H04c ex-member cleared: %', v_err; end if;
  execute 'reset role';
  k := k + 3;

  -- ---------- H05 the report: whole-platform rows for the owner only ----------
  execute 'set local role authenticated';
  perform pg_temp.s13_as(c1);
  v := jc_admin_report();
  if v ? 'storage' or v ? 'failures_since_baseline' or (v -> 'rate_limited_now') ? 'join_pre_membership' then
    raise exception 'FAIL H05a community admin sees platform rows: %', v; end if;
  if not (v -> 'rate_limited_now') ? 'admin_unlock' or not v ?& array['snapshot', 'cron', 'traffic', 'notices_open', 'maintenance'] then
    raise exception 'FAIL H05b community rows missing: %', v; end if;
  perform pg_temp.s13_as(o1);
  v := jc_admin_report();
  if not (v ?& array['storage', 'failures_since_baseline']) or not (v -> 'rate_limited_now') ? 'join_pre_membership' then
    raise exception 'FAIL H05c owner missing platform rows: %', v; end if;
  if not (v -> 'maintenance' -> 'photo_purge') ?& array['affected', 'error'] then raise exception 'FAIL H05d owner cleanup detail'; end if;
  perform pg_temp.s13_as(c1);
  v := jc_admin_report() -> 'maintenance' -> 'photo_purge';
  if v ? 'affected' or v ? 'error' or not v ?& array['last_at', 'stale', 'never_run', 'failed'] then
    raise exception 'FAIL H05e non-owner cleanup detail: %', v; end if;
  k := k + 5;

  -- ---------- H06 a cron failure keeps its first line only (no DETAIL / CONTEXT), ≤ 120 chars ----------
  execute 'reset role';
  select jobid into job from cron.job where jobname = 'jc-hourly-snapshot';
  if job is not null then
    insert into cron.job_run_details (jobid, runid, status, return_message, start_time, end_time)
    values (job, 999999901, 'failed', E'ERROR:  duplicate key value violates unique constraint "x"\nDETAIL:  Key (user_id)=(secret-uuid) already exists.\nCONTEXT:  SQL statement "insert into jc_x"',
            now() + interval '1 minute', now() + interval '1 minute');
    execute 'set local role authenticated';
    perform pg_temp.s13_as(c1);
    v := jc_admin_report() -> 'cron' -> 'last_failure';
    if v ->> 'message' <> 'ERROR:  duplicate key value violates unique constraint "x"' then
      raise exception 'FAIL H06a message not trimmed: %', v; end if;
    execute 'reset role';
    insert into cron.job_run_details (jobid, runid, status, return_message, start_time, end_time)
    values (job, 999999902, 'failed', repeat('x', 500), now() + interval '2 minutes', now() + interval '2 minutes');
    execute 'set local role authenticated';
    v := jc_admin_report() -> 'cron' -> 'last_failure';
    if char_length(v ->> 'message') <> 120 then raise exception 'FAIL H06b not capped: %', char_length(v ->> 'message'); end if;
    execute 'reset role';
    insert into cron.job_run_details (jobid, runid, status, return_message, start_time, end_time)
    values (job, 999999903, 'failed', E'ERROR:  boom\nsecond line with a value 42', now() + interval '3 minutes', now() + interval '3 minutes');
    execute 'set local role authenticated';
    if jc_admin_report() -> 'cron' -> 'last_failure' ->> 'message' <> 'ERROR:  boom' then
      raise exception 'FAIL H06c extra line kept: %', jc_admin_report() -> 'cron' -> 'last_failure'; end if;
    execute 'reset role';
  else
    raise exception 'FAIL H06 no jc-hourly-snapshot job to test against';
  end if;
  k := k + 3;

  -- ---------- H07 nothing a client can call hands out who reported a home (security review F1) ----------
  -- (a) only these client-callable functions mention a reporter column at all: the one that records a report,
  --     and the pets pair that use jc_pet_sightings.reporter for "by me"
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'jc_private') and p.prokind = 'f'
                and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
                and pg_get_functiondef(p.oid) ~* '\mreporter(_home)?\M'
                and p.proname not in ('jc_entry_report', 'jc_pet_get', 'jc_pet_sighting_add')) then
    raise exception 'FAIL H07a a new client function touches reporter: %',
      (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'jc_private') and p.prokind = 'f'
          and has_function_privilege('authenticated', p.oid, 'execute') and pg_get_functiondef(p.oid) ~* '\mreporter(_home)?\M'
          and p.proname not in ('jc_entry_report', 'jc_pet_get', 'jc_pet_sighting_add'));
  end if;
  -- (b) no table access to the reports, no policy, and no client function returns their rows
  if has_table_privilege('anon', 'public.jc_entry_reports', 'select') or has_table_privilege('authenticated', 'public.jc_entry_reports', 'select')
     or has_any_column_privilege('authenticated', 'public.jc_entry_reports', 'select') then raise exception 'FAIL H07b table readable'; end if;
  if exists (select 1 from pg_policies where tablename = 'jc_entry_reports') then raise exception 'FAIL H07c policy'; end if;
  if exists (select 1 from pg_proc p where p.prorettype = 'public.jc_entry_reports'::regtype
                and has_function_privilege('authenticated', p.oid, 'execute')) then raise exception 'FAIL H07d returns rows'; end if;
  k := k + 4;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's13_hardening: % checks passed', k;
end
$t$;
