-- R2a — Events audit fixes (docs/qa/events-qa-2026-11-06.md). Each check fails on the code live before R2a:
-- D1 + L1 vacating a home clears the hide + spot · D2 events end (sign-up / withdraw stop, read paths say so),
-- the hourly job notices + auto-closes 24 h later, one failure doesn't stop the rest · F2 NO_DATE ·
-- U1 mine.home_hidden (retired by HH) · U3 banner owner, revoke, tie-to-event. Own communities (testville14 / testville14b).
-- Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001401';  -- organizer (community code)
  e1 uuid := '00000000-0000-4000-8000-000000001402';  -- event admin of ev_h
  e2 uuid := '00000000-0000-4000-8000-000000001403';  -- event admin of ev_h too
  r1 uuid := '00000000-0000-4000-8000-000000001404';  -- resident: villa 1, leaves
  r2 uuid := '00000000-0000-4000-8000-000000001405';  -- resident: the next family in villa 1
  r3 uuid := '00000000-0000-4000-8000-000000001406';  -- resident: villa 3, stays
  o1 uuid := '00000000-0000-4000-8000-000000001407';  -- testville14b organizer
  v jsonb; k int := 0; n int; tok text; h1 uuid; h3 uuid;
  ev_h uuid; ev_h2 uuid; ev_v uuid; ev_old uuid; ev_past uuid; ev_ended uuid; ev_noend uuid; ev_noend5 uuid;
  ev_undated uuid; ev_draft uuid; ev_soon uuid; ev_fail uuid; ev_x uuid; en uuid;
  en_h1 uuid; en_h2 uuid; en_v1 uuid; en_h3 uuid; ev_s1 uuid; ev_s2 uuid; v_nid bigint;
begin
  execute $f$create function pg_temp.s14_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s14_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s14_ev(l jsonb, i uuid) returns jsonb language sql as
    $b$ select e from jsonb_array_elements(l) e where e ->> 'id' = i::text $b$$f$;
  execute 'grant execute on function pg_temp.s14_as(uuid), pg_temp.s14_err(text), pg_temp.s14_ev(jsonb, uuid) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (c1, 'c1@s14.test'), (e1, 'e1@s14.test'), (e2, 'e2@s14.test'),
    (r1, 'r1@s14.test'), (r2, 'r2@s14.test'), (r3, 'r3@s14.test'), (o1, 'o1@s14.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville14', 'Testville 14', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville14b', 'Testville 14b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville14', 'north', 'North'), ('testville14b', 'north', 'North');
  perform jc_code_set('testville14', 'join', 'S14-JOIN-CODE-01');
  perform jc_code_set('testville14', 'community', 'S14-COMMUNITY-01');
  perform jc_code_set('testville14b', 'join', 'S14B-JOIN-CODE-01');
  perform jc_code_set('testville14b', 'community', 'S14B-COMMUNITY-01');
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'next-week', 'Next week', 'live', true, '{"fields": {}}', now() + interval '7 days', now() + interval '7 days 4 hours')
    returning id into ev_h;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at) values
    ('testville14', 'next-month', 'Next month', 'live', true, '{"fields": {}}', now() + interval '30 days') returning id into ev_h2;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, kind,
                         venue_name_en, venue_lat, venue_lng, spots) values
    ('testville14', 'market', 'Market', 'live', true, '{"fields": {}}', now() + interval '3 days', 'venue',
     'The square', 24.531, 54.431, true) returning id into ev_v;
  -- ended more than 24 h ago / ended 1 h ago / no end, started 7 h ago (ended) / no end, started 5 h ago (not yet)
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'last-week', 'Last week', 'live', true, '{"fields": {}}', now() - interval '30 hours', now() - interval '26 hours')
    returning id into ev_past;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'tonight', 'Tonight', 'live', true, '{"fields": {}}', now() - interval '3 hours', now() - interval '1 hour')
    returning id into ev_ended;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at) values
    ('testville14', 'no-end', 'No end', 'live', true, '{"fields": {}}', now() - interval '7 hours') returning id into ev_noend;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at) values
    ('testville14', 'no-end-5', 'No end 5', 'live', true, '{"fields": {}}', now() - interval '5 hours') returning id into ev_noend5;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, created_at) values
    ('testville14', 'undated', 'Undated', 'live', true, '{"fields": {}}', now() - interval '90 days') returning id into ev_undated;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'old-draft', 'Old draft', 'draft', true, '{"fields": {}}', now() - interval '60 days', now() - interval '59 days')
    returning id into ev_draft;
  insert into jc_events (community_id, slug, title_en, status, signups_open, coming_soon, payload_schema, starts_at) values
    ('testville14', 'never-opened', 'Never opened', 'live', false, true, '{"fields": {}}', now() - interval '10 days')
    returning id into ev_soon;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'will-fail', 'Will fail', 'live', true, '{"fields": {}}', now() - interval '50 hours', now() - interval '48 hours')
    returning id into ev_fail;
  insert into jc_events (community_id, slug, title_en, status, payload_schema, archived_at) values
    ('testville14', 'old-night', 'Old night', 'archived', '{"fields": {}}', now() - interval '200 days') returning id into ev_old;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at) values
    ('testville14b', 'elsewhere', 'Elsewhere', 'live', true, '{"fields": {}}', now() + interval '2 days') returning id into ev_x;

  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_join('testville14', 'S14-JOIN-CODE-01'); perform jc_admin_unlock('S14-COMMUNITY-01');
  perform pg_temp.s14_as(e1); perform jc_join('testville14', 'S14-JOIN-CODE-01');
  perform pg_temp.s14_as(e2); perform jc_join('testville14', 'S14-JOIN-CODE-01');
  perform pg_temp.s14_as(r1); perform jc_join('testville14', 'S14-JOIN-CODE-01');
  h1 := (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5301, 54.4301);
  perform jc_event_signup(ev_h, '{}'); perform jc_event_signup(ev_h2, '{}'); perform jc_event_signup(ev_v, '{}');
  perform pg_temp.s14_as(r3); perform jc_join('testville14', 'S14-JOIN-CODE-01');
  h3 := (jc_home_claim('north', 'villa', null, '3') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5303, 54.4303);
  perform jc_event_signup(ev_h, '{}');
  perform pg_temp.s14_as(o1); perform jc_join('testville14b', 'S14B-JOIN-CODE-01'); perform jc_admin_unlock('S14B-COMMUNITY-01');
  -- e1 + e2 run ev_h
  perform pg_temp.s14_as(c1);
  tok := jc_event_admin_link_create(ev_h) ->> 'token';
  perform pg_temp.s14_as(e1); perform jc_event_admin_accept(tok);
  perform pg_temp.s14_as(c1);
  tok := jc_event_admin_link_create(ev_h) ->> 'token';
  perform pg_temp.s14_as(e2); perform jc_event_admin_accept(tok);

  execute 'reset role';
  select id into en_h1 from jc_event_entries where event_id = ev_h and home_id = h1;
  select id into en_h2 from jc_event_entries where event_id = ev_h2 and home_id = h1;
  select id into en_v1 from jc_event_entries where event_id = ev_v and home_id = h1;
  select id into en_h3 from jc_event_entries where event_id = ev_h and home_id = h3;
  execute 'set local role authenticated';

  -- ---------- A01 D1 + L1: the organizer's hide and the spot leave with the family ----------
  perform pg_temp.s14_as(c1);
  perform jc_admin_entry_moderate(en_h1, true, null);
  perform jc_admin_entry_moderate(en_h2, true, null);
  perform jc_admin_entry_spot_set(en_v1, 'A1');
  perform pg_temp.s14_as(r1); perform jc_entry_withdraw(ev_h2);   -- withdrew while hidden: the flag must not wait
  execute 'reset role';
  insert into jc_event_entries (event_id, community_id, home_id, status, hidden, archived_at)
  values (ev_old, 'testville14', h1, 'in', true, now() - interval '200 days');   -- history
  execute 'set local role authenticated';
  perform pg_temp.s14_as(r1); perform jc_home_leave();
  execute 'reset role';
  if (select hidden from jc_event_entries where event_id = ev_h and home_id = h1) then
    raise exception 'FAIL A01a hide survived the household leaving'; end if;
  if (select hidden from jc_event_entries where event_id = ev_h2 and home_id = h1) then
    raise exception 'FAIL A01b hide on a withdrawn sign-up survived the household leaving'; end if;
  if (select spot from jc_event_entries where event_id = ev_v and home_id = h1) is not null then
    raise exception 'FAIL A01c spot kept by a vacated home (L1)'; end if;
  if not (select hidden from jc_event_entries where event_id = ev_old and home_id = h1) then
    raise exception 'FAIL A01d an archived event''s history changed'; end if;
  execute 'set local role authenticated';
  -- the next family signs up and is on the map
  perform pg_temp.s14_as(r2); perform jc_join('testville14', 'S14-JOIN-CODE-01');
  if (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid is distinct from h1 then
    raise exception 'FAIL A01e the next family got a different home'; end if;
  v := jc_event_signup(ev_h, '{}');
  if (v -> 'mine' ->> 'hidden')::boolean then raise exception 'FAIL A01f the next family starts hidden'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'entries') x where (x ->> 'mine')::boolean) then
    raise exception 'FAIL A01g the next family is not on the map'; end if;
  k := k + 7;

  -- ---------- A02 the same household withdrawing + re-joining stays hidden (unchanged) ----------
  perform pg_temp.s14_as(c1);
  perform jc_admin_entry_moderate(en_h3, true, null);
  perform pg_temp.s14_as(r3); perform jc_entry_withdraw(ev_h);
  v := jc_event_signup(ev_h, '{}');
  if not (v -> 'mine' ->> 'hidden')::boolean then raise exception 'FAIL A02 a re-join dropped the organizer''s hide'; end if;
  k := k + 1;

  -- ---------- A03 U1 retired (HH 2026-11-11): homes can't be hidden, so mine carries no home_hidden ----------
  if (v -> 'mine') ? 'home_hidden' then raise exception 'FAIL A03a home_hidden still sent: %', v -> 'mine'; end if;
  perform pg_temp.s14_as(r3);
  if (jc_event_get(ev_h) -> 'mine') ? 'home_hidden' then raise exception 'FAIL A03b home_hidden still sent'; end if;
  k := k + 2;

  -- ---------- A04 D2: an ended event takes no sign-ups and no withdrawals ----------
  perform pg_temp.s14_as(r3);
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_ended)) is distinct from 'SIGNUPS_CLOSED' then
    raise exception 'FAIL A04a signed up after the end'; end if;
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_noend)) is distinct from 'SIGNUPS_CLOSED' then
    raise exception 'FAIL A04b signed up 7 h after an end-less start'; end if;
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_noend5)) is not null then
    raise exception 'FAIL A04c refused 5 h after an end-less start'; end if;
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_undated)) is not null then
    raise exception 'FAIL A04d refused an undated event'; end if;
  execute 'reset role';
  insert into jc_event_entries (event_id, community_id, home_id) values (ev_ended, 'testville14', h3);   -- signed up on the night
  execute 'set local role authenticated';
  if pg_temp.s14_err(format('select jc_entry_withdraw(%L)', ev_ended)) is distinct from 'SIGNUPS_CLOSED' then
    raise exception 'FAIL A04e withdrew after the end'; end if;
  k := k + 5;

  -- ---------- A05 D2: the read paths say "ended" and when ----------
  v := jc_events_list();
  if (pg_temp.s14_ev(v, ev_ended) ->> 'ended')::boolean is not true then raise exception 'FAIL A05a list: ended event not ended'; end if;
  if (pg_temp.s14_ev(v, ev_h) ->> 'ended')::boolean is not false then raise exception 'FAIL A05b list: next week ended'; end if;
  if (pg_temp.s14_ev(v, ev_undated) ->> 'ended')::boolean is not false or pg_temp.s14_ev(v, ev_undated) -> 'ends_effective' <> 'null'
    then raise exception 'FAIL A05c list: undated %', pg_temp.s14_ev(v, ev_undated); end if;
  if (pg_temp.s14_ev(v, ev_noend) ->> 'ends_effective')::timestamptz
       <> now() - interval '1 hour' then   -- started 7 h ago + 6 h
    raise exception 'FAIL A05d no end = start + 6 h (the client''s NO_END_MS)'; end if;
  v := jc_event_get(ev_ended);
  if (v -> 'event' ->> 'ended')::boolean is not true or (v -> 'event' ->> 'ends_effective') is null then
    raise exception 'FAIL A05e event_get: %', v -> 'event'; end if;
  perform pg_temp.s14_as(c1);
  if (pg_temp.s14_ev(jc_admin_events_list(), ev_ended) ->> 'ended')::boolean is not true then raise exception 'FAIL A05f admin list'; end if;
  k := k + 6;

  -- ---------- A06 D2: moving the end time later reopens sign-ups ----------
  perform jc_admin_event_save(ev_noend5, jsonb_build_object('ends_at', now() - interval '1 minute'));
  perform pg_temp.s14_as(r3);
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_noend5)) is distinct from 'SIGNUPS_CLOSED' then
    raise exception 'FAIL A06a an end time in the past didn''t close it'; end if;
  perform pg_temp.s14_as(c1);
  perform jc_admin_event_save(ev_noend5, jsonb_build_object('ends_at', now() + interval '2 hours'));
  perform pg_temp.s14_as(r3);
  if pg_temp.s14_err(format('select jc_event_signup(%L, ''{}'')', ev_noend5)) is not null then
    raise exception 'FAIL A06b a later end time didn''t reopen it'; end if;
  k := k + 2;

  -- ---------- A07 D2: the hourly job ----------
  execute 'reset role';
  -- two identical events (same household, same answers): one closes by the job, one by the button
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'stats-auto', 'Stats auto', 'live', true, '{"fields": {}}', now() - interval '40 hours', now() - interval '36 hours')
    returning id into ev_s1;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at) values
    ('testville14', 'stats-button', 'Stats button', 'live', true, '{"fields": {}}', now() + interval '5 days', now() + interval '5 days 3 hours')
    returning id into ev_s2;
  insert into jc_event_entries (event_id, community_id, home_id, live_state, supply_level) values
    (ev_s1, 'testville14', h3, 'done', 2), (ev_s2, 'testville14', h3, 'done', 2);
  -- one event's close fails (a trigger that refuses its stats row): the rest must still close
  execute format($f$create function pg_temp.s14_refuse() returns trigger language plpgsql as
    $b$ begin if new.event_id = %L then raise exception 'BOOM'; end if; return new; end $b$$f$, ev_fail);
  create trigger s14_refuse before insert on jc_event_stats for each row execute function pg_temp.s14_refuse();
  perform jc_private.events_autoclose();
  n := (select count(*) from jc_admin_log where community_id = 'testville14' and action = 'event_autoclose');
  if n <> 3 then raise exception 'FAIL A07a closed % events, expected 3 (last-week, never-opened, stats-auto)', n; end if;
  if (select status from jc_events where id = ev_past) <> 'archived'
     or not exists (select 1 from jc_event_stats where event_id = ev_past) then
    raise exception 'FAIL A07b overdue event not closed with its stats'; end if;
  if (select status from jc_events where id = ev_soon) <> 'archived' then raise exception 'FAIL A07c past coming-soon event not closed'; end if;
  if (select status from jc_events where id = ev_fail) <> 'live' then raise exception 'FAIL A07d the failing event half-closed'; end if;
  if not exists (select 1 from jc_admin_notices where community_id = 'testville14' and kind = 'autoclose_failed'
                  and detail ->> 'event_id' = ev_fail::text and detail ->> 'error' = 'P0001' and resolved_at is null) then   -- the error code, never its text
    raise exception 'FAIL A07e no notice for the failed close'; end if;
  if exists (select 1 from jc_events where id in (ev_ended, ev_noend, ev_undated, ev_h) and status <> 'live')
     or (select status from jc_events where id = ev_draft) <> 'draft' then
    raise exception 'FAIL A07f closed something not yet due (or a draft)'; end if;
  if not exists (select 1 from jc_admin_log where community_id = 'testville14' and action = 'event_autoclose'
                  and actor is null and target ->> 'event_id' = ev_past::text) then
    raise exception 'FAIL A07g no admin-log row for the automatic close'; end if;
  -- the grace notice: once per event, with its close time; closing resolves it
  if (select count(*) from jc_admin_notices where kind = 'event_ended' and detail ->> 'event_id' = ev_ended::text and resolved_at is null) <> 1
     or (select (detail ->> 'closes_at')::timestamptz from jc_admin_notices
          where kind = 'event_ended' and detail ->> 'event_id' = ev_ended::text) <> (select ends_at + interval '24 hours' from jc_events where id = ev_ended) then
    raise exception 'FAIL A07h ended notice missing or wrong close time'; end if;
  if exists (select 1 from jc_admin_notices where kind = 'event_ended' and detail ->> 'event_id' = ev_past::text and resolved_at is null) then
    raise exception 'FAIL A07i a closed event kept its ended notice'; end if;
  -- the notice is in App Health
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1);
  if not exists (select 1 from jsonb_array_elements(jc_admin_notices_list()) x
                  where x ->> 'kind' = 'event_ended' and x -> 'detail' ->> 'event_id' = ev_ended::text and x -> 'home' = 'null') then
    raise exception 'FAIL A07j ended notice not listed'; end if;
  execute 'reset role';
  -- the button's close of an identical event keeps the same numbers as the job's
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_event_close(ev_s2, 'stats-button');
  execute 'reset role';
  if (select snapshot - 'taken_at' from jc_event_stats where event_id = ev_s1)
     is distinct from (select snapshot - 'taken_at' from jc_event_stats where event_id = ev_s2)
     or (select snapshot ->> 'homes' from jc_event_stats where event_id = ev_s1) <> '1' then
    raise exception 'FAIL A07q job vs button stats differ: % / %', (select snapshot from jc_event_stats where event_id = ev_s1),
      (select snapshot from jc_event_stats where event_id = ev_s2); end if;
  -- a second run: nothing new, nothing duplicated
  perform jc_private.events_autoclose();
  if (select count(*) from jc_admin_log where community_id = 'testville14' and action = 'event_autoclose') <> 3 then
    raise exception 'FAIL A07k second run closed more events'; end if;
  if (select count(*) from jc_admin_notices where kind in ('event_ended', 'autoclose_failed') and community_id = 'testville14'
       and resolved_at is null) <> 3 then   -- tonight + no-end (ended) and will-fail (failed: overdue, so no "ended" notice)
    raise exception 'FAIL A07l notices duplicated: %', (select count(*) from jc_admin_notices where community_id = 'testville14' and resolved_at is null); end if;
  drop trigger s14_refuse on jc_event_stats;
  perform jc_private.events_autoclose();
  if (select count(*) from jc_admin_log where community_id = 'testville14' and action = 'event_autoclose') <> 4
     or (select status from jc_events where id = ev_fail) <> 'archived'
     or exists (select 1 from jc_admin_notices where detail ->> 'event_id' = ev_fail::text and resolved_at is null) then
    raise exception 'FAIL A07m the failed event didn''t close (and clear its notices) once fixed'; end if;
  -- an organizer who dismisses the "ended" notice isn't asked again every hour (same close time)
  select id into v_nid from jc_admin_notices
   where kind = 'event_ended' and detail ->> 'event_id' = ev_noend::text and resolved_at is null;
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_admin_notice_resolve(v_nid);
  execute 'reset role';
  perform jc_private.events_autoclose();
  if exists (select 1 from jc_admin_notices where kind = 'event_ended' and detail ->> 'event_id' = ev_noend::text and resolved_at is null) then
    raise exception 'FAIL A07r a dismissed ended notice came back on the next run'; end if;
  -- an end time moved later takes its "ended" notice down
  update jc_events set ends_at = now() + interval '3 hours' where id = ev_ended;
  perform jc_private.events_autoclose();
  if exists (select 1 from jc_admin_notices where kind = 'event_ended' and detail ->> 'event_id' = ev_ended::text and resolved_at is null) then
    raise exception 'FAIL A07n a reopened event kept its ended notice'; end if;
  -- residents can't run the job or the core
  if has_function_privilege('authenticated', 'jc_private.events_autoclose()', 'execute')
     or has_function_privilege('authenticated', 'jc_private.event_close_core(uuid)', 'execute') then
    raise exception 'FAIL A07o jc_private close functions callable by members'; end if;
  if not exists (select 1 from cron.job where jobname = 'jc-event-autoclose' and command = 'select jc_private.events_autoclose()') then
    raise exception 'FAIL A07p cron job missing'; end if;
  k := k + 18;

  -- ---------- A08 the Close button: same close, refuses an already-closed event ----------
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1);
  if pg_temp.s14_err(format('select jc_event_close(%L, ''last-week'')', ev_past)) is distinct from 'BAD_STATE' then
    raise exception 'FAIL A08a closed an auto-closed event again'; end if;
  v := jc_event_close(ev_noend, 'no-end');
  execute 'reset role';
  if v ->> 'homes' is null or (select status from jc_events where id = ev_noend) <> 'archived'
     or not exists (select 1 from jc_event_stats where event_id = ev_noend) then
    raise exception 'FAIL A08b manual close: %', v; end if;
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1);
  if pg_temp.s14_err(format('select jc_event_close(%L, ''wrong'')', ev_ended)) is distinct from 'CONFIRM_REQUIRED' then
    raise exception 'FAIL A08c close without the slug'; end if;
  k := k + 3;

  -- ---------- A09 F2: a homes event needs its date ----------
  v := jc_admin_event_save(null, '{"slug": "no-date", "title_en": "No date"}');
  en := (select (x ->> 'id')::uuid from jsonb_array_elements(v) x where x ->> 'slug' = 'no-date');
  if pg_temp.s14_err(format('select jc_admin_event_publish(%L)', en)) is distinct from 'NO_DATE' then
    raise exception 'FAIL A09a published a homes event without a date'; end if;
  perform jc_admin_event_save(en, jsonb_build_object('starts_at', now() + interval '1 day'));
  if pg_temp.s14_err(format('select jc_admin_event_publish(%L)', en)) is not null then raise exception 'FAIL A09b dated publish refused'; end if;
  if pg_temp.s14_err(format('select jc_admin_event_save(%L, ''{"starts_at": null}'')', en)) is distinct from 'NO_DATE' then
    raise exception 'FAIL A09c cleared the date of a live homes event'; end if;
  if pg_temp.s14_err(format('select jc_admin_event_save(%L, ''{"title_en": "Undated, renamed"}'')', ev_undated)) is not null then
    raise exception 'FAIL A09d an older undated event can''t be edited'; end if;
  v := jc_admin_event_save(null, '{"slug": "a-place", "title_en": "A place", "kind": "venue", "venue_name_en": "Hall", "venue_lat": 24.532, "venue_lng": 54.432}');
  if pg_temp.s14_err(format('select jc_admin_event_publish(%L)', (select (x ->> 'id')::uuid from jsonb_array_elements(v) x where x ->> 'slug' = 'a-place'))) is not null then
    raise exception 'FAIL A09e a one-place event needed a date'; end if;
  k := k + 5;

  -- ---------- A10 U3: banners go with their reason ----------
  perform pg_temp.s14_as(e1); perform jc_admin_broadcast_set('Road closed by the gate');
  execute 'reset role';
  if (select broadcast_by from jc_communities where id = 'testville14') is distinct from e1 then raise exception 'FAIL A10a poster not recorded'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_event_admin_revoke(ev_h, e2, null);   -- someone else: the banner stays
  execute 'reset role';
  if (select broadcast from jc_communities where id = 'testville14') = '' then raise exception 'FAIL A10b revoking e2 took e1''s banner'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_event_admin_revoke(ev_h, e1, null);
  execute 'reset role';
  if exists (select 1 from jc_communities where id = 'testville14' and (broadcast <> '' or broadcast_event is not null or broadcast_by is not null)) then
    raise exception 'FAIL A10c the revoked admin''s banner stayed up'; end if;
  execute 'set local role authenticated';
  -- an organizer ties their banner to an event; the close takes it down
  perform pg_temp.s14_as(c1);
  v := jc_admin_broadcast_set_event('Parking on the north road tonight', ev_h);
  if v ->> 'broadcast' <> 'Parking on the north road tonight' then raise exception 'FAIL A10d tie returned %', v; end if;
  execute 'reset role';
  if (select broadcast_event from jc_communities where id = 'testville14') is distinct from ev_h
     or not (select broadcast_org from jc_communities where id = 'testville14') then raise exception 'FAIL A10e banner not tied'; end if;
  execute 'set local role authenticated';
  -- an event admin still can't replace (or clear) an organizer's banner just because it is tied to their event
  perform pg_temp.s14_as(c1); tok := jc_event_admin_link_create(ev_h) ->> 'token';
  perform pg_temp.s14_as(e2); perform jc_event_admin_accept(tok);
  if pg_temp.s14_err('select jc_admin_broadcast_set(''mine now'')') is distinct from 'BANNER_IN_USE' then
    raise exception 'FAIL A10e2 an event admin replaced the organizer''s tied banner'; end if;
  if pg_temp.s14_err('select jc_admin_broadcast_set('''')') is distinct from 'BANNER_IN_USE' then
    raise exception 'FAIL A10e3 an event admin cleared the organizer''s tied banner'; end if;
  perform pg_temp.s14_as(c1); perform jc_event_admin_revoke(ev_h, e2, null);
  execute 'reset role';
  if (select broadcast from jc_communities where id = 'testville14') <> 'Parking on the north road tonight' then
    raise exception 'FAIL A10e4 revoking an event admin took down the organizer''s tied banner'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s14_as(e2);   -- e2 was revoked above: not an organizer, not an event admin
  if pg_temp.s14_err(format('select jc_admin_broadcast_set_event(''x'', %L)', ev_h)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL A10f a non-organizer tied a banner'; end if;
  perform pg_temp.s14_as(r3);
  if pg_temp.s14_err(format('select jc_admin_broadcast_set_event(''x'', %L)', ev_h)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL A10g a resident tied a banner'; end if;
  perform pg_temp.s14_as(c1);
  if pg_temp.s14_err(format('select jc_admin_broadcast_set_event(''x'', %L)', ev_x)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL A10h tied to another community''s event'; end if;
  if pg_temp.s14_err(format('select jc_admin_broadcast_set_event(''x'', %L)', ev_past)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL A10i tied to a closed event'; end if;
  perform jc_event_close(ev_h, 'next-week');
  execute 'reset role';
  if exists (select 1 from jc_communities where id = 'testville14' and (broadcast <> '' or broadcast_event is not null)) then
    raise exception 'FAIL A10j the tied banner survived the close'; end if;
  -- an untied organizer banner is untouched by a close
  execute 'set local role authenticated';
  perform pg_temp.s14_as(c1); perform jc_admin_broadcast_set('Pool closed Friday');
  perform jc_event_close(ev_h2, 'next-month');
  execute 'reset role';
  if (select broadcast from jc_communities where id = 'testville14') <> 'Pool closed Friday' then
    raise exception 'FAIL A10k a close took down an unrelated banner'; end if;
  k := k + 14;

  -- ---------- A11 frozen signatures ----------
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('jc_event_signup', 'jc_entry_live_set', 'jc_event_close', 'jc_admin_broadcast_set'))
     <> 'jc_admin_broadcast_set(p_text text), jc_entry_live_set(p_event uuid, p_state text, p_supply integer), '
        'jc_event_close(p_event uuid, p_confirm text), jc_event_signup(p_event uuid, p_payload jsonb)' then
    raise exception 'FAIL A11 a frozen signature changed (or gained an overload)'; end if;
  k := k + 1;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's14_events_audit: % checks passed', k;
end
$t$;
