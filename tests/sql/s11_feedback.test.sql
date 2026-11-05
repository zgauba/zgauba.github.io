-- T5.3 behaviour tests: feedback send / list / mark read (owner only), the owner's email job
-- (Vault secrets present / absent), retention, jc_me_get.is_owner, jc_events_list.households_in.
-- Runs in its own community (testville11). Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  u1 uuid := '00000000-0000-4000-8000-000000001101';  -- platform owner (also a member)
  u2 uuid := '00000000-0000-4000-8000-000000001102';  -- resident with a home
  u3 uuid := '00000000-0000-4000-8000-000000001103';  -- member without a home
  v jsonb; v_err text; k int := 0; n int; v_id uuid; v_ev uuid; v_entry uuid; v_ref bigint; v_home9 uuid;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values (u1, 'u1@s11.test'), (u2, 'u2@s11.test'), (u3, 'u3@s11.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville11', 'Testville 11', 24.53, 54.43, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville11', 'north', 'North');
  perform jc_code_set('testville11', 'join', 'S11-JOIN-CODE-01');
  insert into jc_platform_owners (user_id) values (u1);
  -- the live project may already hold the real secrets: this run starts without them (rolled back)
  delete from vault.secrets where name in ('jc_resend_api_key', 'jc_feedback_to');
  delete from jc_feedback;                                               -- isolate counts (rolled back)
  delete from jc_maintenance_log where job like 'feedback%';             -- live sends must not throttle the test

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform jc_join('testville11', 'S11-JOIN-CODE-01');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_join('testville11', 'S11-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '7');
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_join('testville11', 'S11-JOIN-CODE-01');

  -- ---------- F01 send: stored with the home label; no account id column ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  v := jc_feedback_send('idea', E'  A dog park\nnear North?  ', '/events/?id=abc');
  if v ->> 'ok' is distinct from 'true' then raise exception 'FAIL F01a send: %', v; end if;
  execute 'reset role';
  select count(*) into n from jc_feedback where home_label = 'Villa 7 · North' and kind = 'idea'
     and body = E'A dog park\nnear North?' and page = '/events/?id=abc' and community_id = 'testville11';
  if n <> 1 then raise exception 'FAIL F01b stored row: %', (select jsonb_agg(to_jsonb(f)) from jc_feedback f); end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jc_feedback'
              and column_name in ('user_id', 'email', 'name')) then raise exception 'FAIL F01c feedback stores who'; end if;
  k := k + 3;

  -- ---------- F02 refusals ----------
  execute 'set local role authenticated';
  v_err := null; begin perform jc_feedback_send('rant', 'x'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_KIND' then raise exception 'FAIL F02a kind: %', v_err; end if;
  v_err := null; begin perform jc_feedback_send(null, 'x'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'BAD_KIND' then raise exception 'FAIL F02b null kind: %', v_err; end if;
  v_err := null; begin perform jc_feedback_send('idea', '   '); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'EMPTY' then raise exception 'FAIL F02d spaces: %', v_err; end if;
  v_err := null; begin perform jc_feedback_send('idea', repeat('a', 1001)); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'TOO_LONG' then raise exception 'FAIL F02e 1001: %', v_err; end if;
  v_err := null; begin perform jc_feedback_send('idea', repeat('a', 5000)); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'TOO_LONG' then raise exception 'FAIL F02f huge: %', v_err; end if;
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  v_err := null; begin perform jc_feedback_send('idea', 'hi'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_SIGNED_IN' then raise exception 'FAIL F02g signed out: %', v_err; end if;
  k := k + 6;

  -- ---------- F03 long page cut to 60; member without a home → no label ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform jc_feedback_send('problem', 'Map is slow', repeat('p', 300));
  execute 'reset role';
  if (select char_length(page) from jc_feedback where body = 'Map is slow') <> 60 then raise exception 'FAIL F03a page cap'; end if;
  if (select home_id is not null or home_label is not null from jc_feedback where body = 'Map is slow') then
    raise exception 'FAIL F03b homeless label'; end if;
  k := k + 2;

  -- ---------- F04 five a day ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_feedback_send('other', 'two'); perform jc_feedback_send('other', 'three');
  perform jc_feedback_send('other', 'four'); perform jc_feedback_send('other', 'five');
  v_err := null; begin perform jc_feedback_send('other', 'six'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL F04 sixth: %', v_err; end if;
  k := k + 1;

  -- ---------- F05 only owners read ----------
  v_err := null; begin perform jc_feedback_list(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_OWNER' then raise exception 'FAIL F05a resident list: %', v_err; end if;
  v_err := null; begin select id into v_id from jc_feedback limit 1; exception when others then v_err := sqlerrm; end;
  if v_err is null or v_err not like 'permission denied%' then raise exception 'FAIL F05b authenticated reads the table: %', v_err; end if;
  execute 'reset role';
  -- one transaction = one now(): stagger so "newest first" is testable
  update jc_feedback set created_at = now() - interval '1 hour' where body <> 'five';
  select id into v_id from jc_feedback where body = 'two';
  execute 'set local role authenticated';
  v_err := null; begin perform jc_feedback_mark_read(v_id); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_OWNER' then raise exception 'FAIL F05c resident mark: %', v_err; end if;
  if (jc_me_get() ->> 'is_owner')::boolean then raise exception 'FAIL F05d resident is_owner'; end if;
  k := k + 4;

  -- ---------- F06 owner: list newest first, unread count, mark read / unread ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  if not (jc_me_get() ->> 'is_owner')::boolean then raise exception 'FAIL F06a owner is_owner'; end if;
  v := jc_feedback_list();
  if (v ->> 'unread')::int <> 6 or jsonb_array_length(v -> 'items') <> 6 then raise exception 'FAIL F06b list: %', v; end if;
  if v -> 'items' -> 0 ->> 'body' <> 'five' then raise exception 'FAIL F06c order: %', v -> 'items' -> 0; end if;
  if v -> 'items' -> 0 ->> 'home' <> 'Villa 7 · North' or v -> 'items' -> 0 ->> 'community_name' <> 'Testville 11' then
    raise exception 'FAIL F06d fields: %', v -> 'items' -> 0; end if;
  v := jc_feedback_mark_read(v_id);
  if (v ->> 'unread')::int <> 5 then raise exception 'FAIL F06e mark read: %', v ->> 'unread'; end if;
  v := jc_feedback_mark_read(v_id, false);
  if (v ->> 'unread')::int <> 6 then raise exception 'FAIL F06f mark unread: %', v ->> 'unread'; end if;
  v_err := null; begin perform jc_feedback_mark_read(gen_random_uuid()); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL F06g unknown id: %', v_err; end if;
  k := k + 7;
  execute 'reset role';

  -- ---------- F07 the email job: nothing without secrets; one batched request with them ----------
  if has_function_privilege('authenticated', 'jc_private.feedback_notify()', 'execute')
     or has_function_privilege('anon', 'jc_private.feedback_notify()', 'execute') then
    raise exception 'FAIL F07a notify callable'; end if;
  if jc_private.feedback_notify() <> 0 then raise exception 'FAIL F07b sent without secrets'; end if;
  if exists (select 1 from jc_feedback where notified_at is not null) then raise exception 'FAIL F07c marked without secrets'; end if;
  perform vault.create_secret('re_test_key_s11', 'jc_resend_api_key');
  perform vault.create_secret('owner@s11.test', 'jc_feedback_to');
  select count(*) into n from net.http_request_queue;
  if jc_private.feedback_notify() <> 6 then raise exception 'FAIL F07d batch size'; end if;
  if (select count(*) from net.http_request_queue) <> n + 1 then raise exception 'FAIL F07e one request queued'; end if;
  if not exists (select 1 from net.http_request_queue q
                  where q.url = 'https://api.resend.com/emails'
                    and convert_from(q.body, 'utf8')::jsonb -> 'to' = '["owner@s11.test"]'
                    and convert_from(q.body, 'utf8')::jsonb ->> 'text' like '6 new (6 unread) from %Villa 7 · North%'
                    and convert_from(q.body, 'utf8')::jsonb ->> 'text' not like '%dog park%') then
    raise exception 'FAIL F07f request: %', (select jsonb_agg(convert_from(body, 'utf8')) from net.http_request_queue); end if;
  if jc_private.feedback_notify() <> 0 then raise exception 'FAIL F07g re-sent'; end if;
  select ref into v_ref from jc_maintenance_log where job = 'feedback_notify' and affected = 6;
  if v_ref is null then raise exception 'FAIL F07h not logged with its request id'; end if;
  -- one email an hour: a new message right after waits
  insert into jc_feedback (community_id, kind, body) values ('testville11', 'other', 'seven');
  if jc_private.feedback_notify() <> 0 then raise exception 'FAIL F07i throttle'; end if;
  -- the last email bounced (bad key): found next run, logged once, its batch goes again
  insert into net._http_response (id, status_code, content, created) values (v_ref, 401, 'invalid key', now());
  update jc_maintenance_log set at = now() - interval '2 hours' where ref = v_ref;
  update jc_feedback set notified_at = now() - interval '2 hours' where notified_at is not null;
  if jc_private.feedback_notify() <> 7 then raise exception 'FAIL F07j re-sent batch + new: %',
    (select count(*) from jc_feedback where notified_at is null); end if;
  if not exists (select 1 from jc_maintenance_log where job = 'feedback_notify' and error like 'email % failed: 401%') then
    raise exception 'FAIL F07k failure not logged'; end if;
  if (select count(*) from jc_maintenance_log where job = 'feedback_notify' and error is not null) <> 1 then
    raise exception 'FAIL F07l failure logged more than once'; end if;
  delete from jc_feedback where body = 'seven';
  k := k + 12;

  -- ---------- F08 retention: read > 12 months goes; unread and recent stay ----------
  update jc_feedback set read_at = now() - interval '400 days' where body = 'two';
  update jc_feedback set read_at = now() - interval '10 days' where body = 'three';
  update jc_feedback set created_at = now() - interval '900 days' where body = 'four';   -- old but unread
  if jc_purge_feedback() <> 2 then raise exception 'FAIL F08a purge count'; end if;   -- read > 12 mo + unread > 24 mo
  if exists (select 1 from jc_feedback where body in ('two', 'four'))
     or not exists (select 1 from jc_feedback where body = 'three') then raise exception 'FAIL F08b purged the wrong rows'; end if;
  if has_function_privilege('authenticated', 'public.jc_purge_feedback()', 'execute') then raise exception 'FAIL F08c purge callable'; end if;
  if (select count(*) from cron.job where jobname in ('jc-feedback-notify', 'jc-feedback-purge')) <> 2 then
    raise exception 'FAIL F08d cron jobs'; end if;
  k := k + 4;

  -- ---------- F09 deleting the home keeps the message, drops the link ----------
  delete from jc_home_members where home_id in (select id from jc_homes where community_id = 'testville11');
  delete from jc_homes where community_id = 'testville11';
  if exists (select 1 from jc_feedback where home_id is not null and community_id = 'testville11') then
    raise exception 'FAIL F09a home link survived'; end if;
  if (select count(*) from jc_feedback where home_label = 'Villa 7 · North') = 0 then raise exception 'FAIL F09b label lost'; end if;
  k := k + 2;

  -- ---------- F11 caps: 10 a day per home, 100 per community (other accounts can't bury the inbox) ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  v_home9 := (jc_home_claim('north', 'villa', null, '9') -> 'home' ->> 'id')::uuid;
  execute 'reset role';
  insert into jc_feedback (community_id, home_id, kind, body) select 'testville11', v_home9, 'other', 'x' || g from generate_series(1, 10) g;
  execute 'set local role authenticated';
  v_err := null; begin perform jc_feedback_send('idea', 'eleventh from the home'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL F11a home cap: %', v_err; end if;
  execute 'reset role';
  delete from jc_feedback where home_id = v_home9;
  insert into jc_feedback (community_id, kind, body) select 'testville11', 'other', 'y' || g from generate_series(1, 100) g;
  execute 'set local role authenticated';
  v_err := null; begin perform jc_feedback_send('idea', 'one too many'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'RATE_LIMITED' then raise exception 'FAIL F11b community cap: %', v_err; end if;
  execute 'reset role';
  delete from jc_feedback where body like 'y%';
  k := k + 2;

  -- ---------- F10 jc_events_list.households_in counts hidden sign-ups (as jc_event_get) ----------
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville11', 'picnic', 'Picnic', 'live', true, '{"fields": {}}') returning id into v_ev;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform jc_home_claim('north', 'villa', null, '8');
  perform jc_home_pin_set(24.5310, 54.4310);
  perform jc_event_signup(v_ev, '{}');
  execute 'reset role';
  update jc_event_entries set hidden = true where event_id = v_ev;
  execute 'set local role authenticated';
  select e into v from jsonb_array_elements(jc_events_list()) e where e ->> 'slug' = 'picnic';
  if (v ->> 'homes_in')::int <> 0 or (v ->> 'households_in')::int <> 1 then raise exception 'FAIL F10 counts: %', v; end if;
  k := k + 1;
  execute 'reset role';   -- the role outlives this block: hand the next slice a clean session

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's11_feedback: % checks passed', k;
end
$t$;
