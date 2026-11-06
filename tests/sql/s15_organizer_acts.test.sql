-- R2b-1 — organizer event-night actions (docs/plans/R2b-1-organizer-acts.md). Each check fails on the code live
-- before R2b-1: jc_admin_entry_live_set (switch / supply / clear supply), jc_admin_entry_withdraw (frees the place,
-- spot, reports), jc_entry_supply_clear, and org_adjusted_at / org_withdrawn_at (set by organizers + pin moves,
-- cleared by the household acting, re-join and a new family). Who may act, and until when (decision 1: organizers
-- until the close, households not after the end). Own communities (testville15 / testville15b).
-- Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001501';  -- organizer (community code)
  e1 uuid := '00000000-0000-4000-8000-000000001502';  -- event admin of ev
  e2 uuid := '00000000-0000-4000-8000-000000001503';  -- event admin of ev_b only
  r1 uuid := '00000000-0000-4000-8000-000000001504';  -- resident: villa 1 (leaves at the end)
  r2 uuid := '00000000-0000-4000-8000-000000001505';  -- resident: villa 2
  r3 uuid := '00000000-0000-4000-8000-000000001506';  -- resident: the next family in villa 1
  o1 uuid := '00000000-0000-4000-8000-000000001507';  -- testville15b organizer
  v jsonb; k int := 0; n int; tok text; h1 uuid; h2 uuid;
  ev uuid; ev_b uuid; ev_end uuid; ev_off uuid; ev_arch uuid; ev_draft uuid; ev_m uuid; ev_v uuid;
  en1 uuid; en2 uuid; en1_b uuid; en1_end uuid; en1_off uuid; en1_arch uuid; en1_draft uuid; en1_m uuid; en1_v uuid;
begin
  execute $f$create function pg_temp.s15_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s15_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s15_en(l jsonb, i uuid) returns jsonb language sql as
    $b$ select e from jsonb_array_elements(l) e where e ->> 'id' = i::text $b$$f$;
  execute 'grant execute on function pg_temp.s15_as(uuid), pg_temp.s15_err(text), pg_temp.s15_en(jsonb, uuid) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (c1, 'c1@s15.test'), (e1, 'e1@s15.test'), (e2, 'e2@s15.test'),
    (r1, 'r1@s15.test'), (r2, 'r2@s15.test'), (r3, 'r3@s15.test'), (o1, 'o1@s15.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville15', 'Testville 15', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville15b', 'Testville 15b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville15', 'north', 'North'), ('testville15b', 'north', 'North');
  perform jc_code_set('testville15', 'join', 'S15-JOIN-CODE-01');
  perform jc_code_set('testville15', 'community', 'S15-COMMUNITY-01');
  perform jc_code_set('testville15b', 'join', 'S15B-JOIN-CODE-01');
  perform jc_code_set('testville15b', 'community', 'S15B-COMMUNITY-01');
  -- tonight: started 1 h ago, ends in 3 h, every feature on
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at, features) values
    ('testville15', 'tonight', 'Tonight', 'live', true, '{"fields": {}}', now() - interval '1 hour', now() + interval '3 hours',
     '{"giant_switch": true, "supply": true, "crowd_reports": true}') returning id into ev;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at, features) values
    ('testville15', 'other-night', 'Other night', 'live', true, '{"fields": {}}', now() - interval '1 hour', now() + interval '3 hours',
     '{"giant_switch": true, "supply": true}') returning id into ev_b;
  -- ended 2 h ago: inside the 24 h before it closes itself
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at, features) values
    ('testville15', 'last-night', 'Last night', 'live', true, '{"fields": {}}', now() - interval '6 hours', now() - interval '2 hours',
     '{"giant_switch": true, "supply": true}') returning id into ev_end;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, ends_at, features) values
    ('testville15', 'plain', 'Plain', 'live', true, '{"fields": {}}', now() - interval '1 hour', now() + interval '3 hours', '{}')
    returning id into ev_off;
  insert into jc_events (community_id, slug, title_en, status, payload_schema, archived_at, features) values
    ('testville15', 'old-night', 'Old night', 'archived', '{"fields": {}}', now() - interval '20 days', '{"giant_switch": true, "supply": true}')
    returning id into ev_arch;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, features) values
    ('testville15', 'a-draft', 'A draft', 'draft', true, '{"fields": {}}', now() + interval '9 days', '{"giant_switch": true}')
    returning id into ev_draft;
  -- one place, one household's room, numbered spots
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, kind,
                         venue_name_en, venue_lat, venue_lng, capacity, spots) values
    ('testville15', 'market', 'Market', 'live', true, '{"fields": {}}', now() + interval '3 days', 'venue',
     'The square', 24.531, 54.431, 1, true) returning id into ev_m;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema, starts_at, kind,
                         venue_name_en, venue_lat, venue_lng) values
    ('testville15', 'fair', 'Fair', 'live', true, '{"fields": {}}', now() + interval '4 days', 'venue',
     'The park', 24.532, 54.432) returning id into ev_v;

  execute 'set local role authenticated';
  perform pg_temp.s15_as(c1); perform jc_join('testville15', 'S15-JOIN-CODE-01'); perform jc_admin_unlock('S15-COMMUNITY-01');
  perform pg_temp.s15_as(e1); perform jc_join('testville15', 'S15-JOIN-CODE-01');
  perform pg_temp.s15_as(e2); perform jc_join('testville15', 'S15-JOIN-CODE-01');
  perform pg_temp.s15_as(r1); perform jc_join('testville15', 'S15-JOIN-CODE-01');
  h1 := (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5301, 54.4301);
  perform jc_event_signup(ev, '{}'); perform jc_event_signup(ev_b, '{}'); perform jc_event_signup(ev_off, '{}');
  perform jc_event_signup(ev_m, '{}'); perform jc_event_signup(ev_v, '{}');
  perform pg_temp.s15_as(r2); perform jc_join('testville15', 'S15-JOIN-CODE-01');
  h2 := (jc_home_claim('north', 'villa', null, '2') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5302, 54.4302);
  perform jc_event_signup(ev, '{}');
  perform jc_entry_live_set(ev, null, 3);
  perform pg_temp.s15_as(o1); perform jc_join('testville15b', 'S15B-JOIN-CODE-01'); perform jc_admin_unlock('S15B-COMMUNITY-01');
  perform pg_temp.s15_as(c1);
  tok := jc_event_admin_link_create(ev) ->> 'token';
  perform pg_temp.s15_as(e1); perform jc_event_admin_accept(tok);
  perform pg_temp.s15_as(c1);
  tok := jc_event_admin_link_create(ev_b) ->> 'token';
  perform pg_temp.s15_as(e2); perform jc_event_admin_accept(tok);

  execute 'reset role';
  -- signed up on the night (before the end), and history / a draft written directly
  insert into jc_event_entries (event_id, community_id, home_id) values (ev_end, 'testville15', h1) returning id into en1_end;
  insert into jc_event_entries (event_id, community_id, home_id, archived_at) values (ev_arch, 'testville15', h1, now() - interval '20 days')
    returning id into en1_arch;
  insert into jc_event_entries (event_id, community_id, home_id) values (ev_draft, 'testville15', h1) returning id into en1_draft;
  select id into en1 from jc_event_entries where event_id = ev and home_id = h1;
  select id into en2 from jc_event_entries where event_id = ev and home_id = h2;
  select id into en1_b from jc_event_entries where event_id = ev_b and home_id = h1;
  select id into en1_off from jc_event_entries where event_id = ev_off and home_id = h1;
  select id into en1_m from jc_event_entries where event_id = ev_m and home_id = h1;
  select id into en1_v from jc_event_entries where event_id = ev_v and home_id = h1;
  update jc_event_entries set spot = 'A1' where id = en1_m;
  -- a neighbour says villa 1 is out (tonight), and about its market place
  insert into jc_entry_reports (entry_id, reporter, reporter_home) values (en1, r2, h2), (en1_m, r2, h2);
  execute 'set local role authenticated';

  -- ---------- O01 who may act: residents, another event's admin, another community, anon ----------
  perform pg_temp.s15_as(r2);
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en1)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O01a a resident set another home''s switch'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O01b a resident withdrew another home'; end if;
  perform pg_temp.s15_as(e2);   -- runs ev_b, not ev
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en1)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O01c another event''s admin set this event''s switch'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O01d another event''s admin withdrew this event''s home'; end if;
  perform pg_temp.s15_as(o1);   -- an organizer, of another community
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en1)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O01e another community''s organizer reached the entry'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O01f another community''s organizer withdrew the entry'; end if;
  execute 'reset role';
  if exists (select 1 from jc_event_entries where id = en1 and (status <> 'in' or live_state <> 'active' or org_adjusted_at is not null)) then
    raise exception 'FAIL O01g a refused call changed the entry'; end if;
  if has_function_privilege('anon', 'public.jc_admin_entry_live_set(uuid, text, integer, boolean)', 'execute')
     or has_function_privilege('anon', 'public.jc_admin_entry_withdraw(uuid)', 'execute')
     or has_function_privilege('anon', 'public.jc_entry_supply_clear(uuid)', 'execute') then
    raise exception 'FAIL O01h anon can call an R2b-1 function'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('jc_admin_entry_live_set', 'jc_admin_entry_withdraw', 'jc_entry_supply_clear')
              and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))) then
    raise exception 'FAIL O01i an R2b-1 function is not security definer with a pinned search_path'; end if;
  execute 'set local role authenticated';
  k := k + 9;

  -- ---------- O02 organizer marks a home out: state, reports cleared, told, logged ----------
  perform pg_temp.s15_as(c1);
  v := jc_admin_entry_live_set(en1, 'done', null, false);
  if pg_temp.s15_en(v, en1) ->> 'live_state' <> 'done' then raise exception 'FAIL O02a returned %', pg_temp.s15_en(v, en1); end if;
  if (pg_temp.s15_en(v, en1) ->> 'org_adjusted_at') is null then raise exception 'FAIL O02b the list does not say adjusted'; end if;
  if (pg_temp.s15_en(v, en1) ->> 'reports_open')::int <> 0 then raise exception 'FAIL O02c reports stayed open'; end if;
  execute 'reset role';
  if not exists (select 1 from jc_admin_log where community_id = 'testville15' and action = 'entry_live_set' and actor = c1
                  and target ->> 'entry_id' = en1::text and target ->> 'state' = 'done'
                  and target -> 'from' ->> 'live_state' = 'active') then
    raise exception 'FAIL O02d no admin log row'; end if;
  if not exists (select 1 from jc_state_log where entry_id = en1 and field = 'live_state' and value = '"done"' and actor = c1) then
    raise exception 'FAIL O02e no state log row with the organizer as actor'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(r1);
  v := jc_event_get(ev);
  if (v -> 'mine' ->> 'org_adjusted_at') is null or v -> 'mine' ->> 'live_state' <> 'done' then
    raise exception 'FAIL O02f the household is not told: %', v -> 'mine'; end if;
  -- never who: the household's view carries no organizer id
  if v::text like '%' || c1::text || '%' then raise exception 'FAIL O02g the organizer''s id reached the household'; end if;
  if (v -> 'mine' ->> 'reports_open')::int <> 0 then raise exception 'FAIL O02h the household still sees the report'; end if;
  k := k + 8;

  -- ---------- O03 the event's own admin: supply, clear supply; validation ----------
  perform pg_temp.s15_as(e1);
  v := jc_admin_entry_live_set(en2, null, 1, false);
  if (pg_temp.s15_en(v, en2) ->> 'supply_level')::int is distinct from 1 then raise exception 'FAIL O03a supply not set'; end if;
  v := jc_admin_entry_live_set(en2, null, null, true);
  if pg_temp.s15_en(v, en2) -> 'supply_level' <> 'null' then raise exception 'FAIL O03b supply not cleared: %', pg_temp.s15_en(v, en2); end if;
  if pg_temp.s15_en(v, en2) ->> 'live_state' <> 'active' then raise exception 'FAIL O03c clearing supply touched the switch'; end if;
  execute 'reset role';
  if not exists (select 1 from jc_state_log where entry_id = en2 and field = 'supply_level' and value = 'null'::jsonb and actor = e1) then
    raise exception 'FAIL O03d no state log for the clear'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(e1);
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, 2, true)', en2)) is distinct from 'BAD_SUPPLY' then
    raise exception 'FAIL O03e supply + clear together'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, null, false)', en2)) is distinct from 'BAD_STATE' then
    raise exception 'FAIL O03f nothing to do'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, null, null)', en2)) is distinct from 'BAD_STATE' then
    raise exception 'FAIL O03g nothing to do (null clear)'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''maybe'', null, false)', en2)) is distinct from 'BAD_STATE' then
    raise exception 'FAIL O03h a made-up state'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, 4, false)', en2)) is distinct from 'BAD_SUPPLY' then
    raise exception 'FAIL O03i supply 4'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, 2, false)', gen_random_uuid())) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O03j an unknown entry (event admin)'; end if;
  perform pg_temp.s15_as(c1);
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en1_off)) is distinct from 'FEATURE_OFF' then
    raise exception 'FAIL O03k switch on an event without it'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, null, true)', en1_off)) is distinct from 'FEATURE_OFF' then
    raise exception 'FAIL O03l clear supply on an event without supply'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, null, 2, false)', gen_random_uuid())) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O03m an unknown entry (organizer)'; end if;
  k := k + 13;

  -- ---------- O04 decision 1: after the end, organizers until the close; households can't withdraw ----------
  perform pg_temp.s15_as(r1);
  if pg_temp.s15_err(format('select jc_entry_withdraw(%L)', ev_end)) is distinct from 'SIGNUPS_CLOSED' then
    raise exception 'FAIL O04a the household withdrew after the end'; end if;
  perform pg_temp.s15_as(c1);
  v := jc_admin_entry_live_set(en1_end, 'done', null, false);
  if pg_temp.s15_en(v, en1_end) ->> 'live_state' <> 'done' then raise exception 'FAIL O04b organizer refused after the end'; end if;
  v := jc_admin_entry_withdraw(en1_end);
  if pg_temp.s15_en(v, en1_end) ->> 'status' <> 'withdrawn' then raise exception 'FAIL O04c organizer withdraw refused after the end'; end if;
  -- an archived (closed) event: nothing to change
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en1_arch)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O04d changed a closed event'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1_arch)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O04e withdrew from a closed event'; end if;
  -- a withdrawn sign-up can't be withdrawn again or set
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1_end)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O04f withdrew twice'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''active'', null, false)', en1_end)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O04g set a withdrawn sign-up'; end if;
  k := k + 7;

  -- ---------- O05 withdraw frees a place: capacity, spot, reports, snapshot, household told ----------
  perform pg_temp.s15_as(r2);
  if pg_temp.s15_err(format('select jc_event_signup(%L, ''{}'')', ev_m)) is distinct from 'FULL' then
    raise exception 'FAIL O05a fixture: the market should be full'; end if;
  perform pg_temp.s15_as(e1);   -- runs ev, not the market
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en1_m)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O05b ev''s admin withdrew a market sign-up'; end if;
  perform pg_temp.s15_as(c1);
  v := jc_admin_entry_withdraw(en1_m);
  if pg_temp.s15_en(v, en1_m) ->> 'status' <> 'withdrawn' or pg_temp.s15_en(v, en1_m) -> 'spot' <> 'null'
     or (pg_temp.s15_en(v, en1_m) ->> 'org_withdrawn_at') is null or (pg_temp.s15_en(v, en1_m) ->> 'reports_open')::int <> 0 then
    raise exception 'FAIL O05c withdraw returned %', pg_temp.s15_en(v, en1_m); end if;
  perform pg_temp.s15_as(r1);
  v := jc_event_get(ev_m);
  if v -> 'mine' ->> 'status' <> 'withdrawn' or (v -> 'mine' ->> 'org_withdrawn_at') is null then
    raise exception 'FAIL O05d the household is not told it was removed: %', v -> 'mine'; end if;
  if (v -> 'event' ->> 'places_left')::int <> 1 then raise exception 'FAIL O05e the place was not freed: %', v -> 'event'; end if;
  perform pg_temp.s15_as(r2);
  if pg_temp.s15_err(format('select jc_event_signup(%L, ''{}'')', ev_m)) is not null then
    raise exception 'FAIL O05f the freed place could not be taken'; end if;
  execute 'reset role';
  if (jc_event_snapshot(ev_m) ->> 'homes')::int <> 1 then raise exception 'FAIL O05g snapshot counts the withdrawn home: %', jc_event_snapshot(ev_m); end if;
  if not exists (select 1 from jc_admin_log where action = 'entry_withdraw' and actor = c1 and target ->> 'entry_id' = en1_m::text
                  and target ->> 'spot' = 'A1') then
    raise exception 'FAIL O05h no admin log row for the withdraw'; end if;
  if not exists (select 1 from jc_state_log where entry_id = en1_m and field = 'status' and value = '"withdrawn"' and actor = c1) then
    raise exception 'FAIL O05i no state log row for the withdraw'; end if;
  execute 'set local role authenticated';
  k := k + 9;

  -- ---------- O06 re-join clears both lines ----------
  perform pg_temp.s15_as(c1);
  perform jc_admin_entry_withdraw(en1);   -- adjusted at O02, now removed too
  perform pg_temp.s15_as(r1);
  v := jc_event_get(ev);
  if (v -> 'mine' ->> 'org_withdrawn_at') is null or (v -> 'mine' ->> 'org_adjusted_at') is null then
    raise exception 'FAIL O06a fixture: %', v -> 'mine'; end if;
  v := jc_event_signup(ev, '{}');
  if v -> 'mine' -> 'org_withdrawn_at' <> 'null' or v -> 'mine' -> 'org_adjusted_at' <> 'null' then
    raise exception 'FAIL O06b a re-join kept an organizer line: %', v -> 'mine'; end if;
  if v -> 'mine' ->> 'live_state' <> 'active' then raise exception 'FAIL O06c a re-join kept the organizer''s done'; end if;
  -- an update while still in keeps "adjusted" (the household changed its answers, not the organizer's change)
  perform pg_temp.s15_as(c1); perform jc_admin_entry_live_set(en1, null, 2, false);
  perform pg_temp.s15_as(r1); v := jc_event_signup(ev, '{}');
  if (v -> 'mine' ->> 'org_adjusted_at') is null then raise exception 'FAIL O06d an answers update dropped adjusted'; end if;
  k := k + 4;

  -- ---------- O07 the household acting clears "adjusted"; supply clear ----------
  v := jc_entry_live_set(ev, null, 1);
  if v -> 'mine' -> 'org_adjusted_at' <> 'null' then raise exception 'FAIL O07a own supply tap kept adjusted'; end if;
  perform pg_temp.s15_as(c1); perform jc_admin_entry_live_set(en1, 'done', null, false);
  perform pg_temp.s15_as(r1); v := jc_entry_live_set(ev, 'active', null);
  if v -> 'mine' -> 'org_adjusted_at' <> 'null' then raise exception 'FAIL O07b own switch kept adjusted'; end if;
  perform pg_temp.s15_as(c1); perform jc_admin_entry_live_set(en1, null, 0, false);
  perform pg_temp.s15_as(r1);
  v := jc_entry_supply_clear(ev);
  if v -> 'mine' -> 'supply_level' <> 'null' then raise exception 'FAIL O07c supply not cleared: %', v -> 'mine'; end if;
  if v -> 'mine' -> 'org_adjusted_at' <> 'null' then raise exception 'FAIL O07d supply clear kept adjusted'; end if;
  execute 'reset role';
  if not exists (select 1 from jc_state_log where entry_id = en1 and field = 'supply_level' and value = 'null'::jsonb and actor = r1) then
    raise exception 'FAIL O07e no state log for the household''s clear'; end if;
  if (select supply_level from jc_event_entries where id = en2) is not null then
    -- en2 was cleared at O03; give it a level to prove the next clear leaves it alone
    raise exception 'FAIL O07f fixture'; end if;
  update jc_event_entries set supply_level = 3 where id = en2;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(r1); perform jc_entry_live_set(ev, null, 2); perform jc_entry_supply_clear(ev);
  execute 'reset role';
  if (select supply_level from jc_event_entries where id = en2) is distinct from 3::smallint then
    raise exception 'FAIL O07g another home''s supply changed'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(r1);
  if pg_temp.s15_err(format('select jc_entry_supply_clear(%L)', ev_off)) is distinct from 'FEATURE_OFF' then
    raise exception 'FAIL O07h supply clear without the supply feature'; end if;
  if pg_temp.s15_err(format('select jc_entry_supply_clear(%L)', ev_end)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O07i supply clear with no sign-up (withdrawn)'; end if;
  if pg_temp.s15_err(format('select jc_entry_supply_clear(%L)', ev_arch)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O07j supply clear on a closed event'; end if;
  perform pg_temp.s15_as(c1);   -- no home of their own
  if pg_temp.s15_err(format('select jc_entry_supply_clear(%L)', ev)) is null then
    raise exception 'FAIL O07k an organizer with no home cleared something'; end if;
  k := k + 11;

  -- ---------- O08 organizer pin moves tell the household (live homes events only) ----------
  execute 'reset role';
  update jc_event_entries set org_adjusted_at = null where home_id in (h1, h2);
  execute 'set local role authenticated';
  perform pg_temp.s15_as(e1);
  v := jc_admin_entry_pin_set(en2, 24.5312, 54.4312);
  if (pg_temp.s15_en(v, en2) ->> 'org_adjusted_at') is null then raise exception 'FAIL O08a event-only pin move not told'; end if;
  perform pg_temp.s15_as(c1);
  v := jc_admin_home_pin_set(h1, 24.5311, 54.4311);
  if jsonb_typeof(v -> 'from') <> 'array' or jsonb_array_length(v -> 'from') <> 2 then raise exception 'FAIL O08b home pin Undo value changed: %', v; end if;
  execute 'reset role';
  if (select org_adjusted_at from jc_event_entries where id = en1) is null
     or (select org_adjusted_at from jc_event_entries where id = en1_b) is null then
    raise exception 'FAIL O08c home pin move not told on live homes events'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en1_m) is not null then
    raise exception 'FAIL O08d told a withdrawn sign-up'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en1_arch) is not null then
    raise exception 'FAIL O08e told an archived sign-up'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en1_draft) is not null then
    raise exception 'FAIL O08f told a draft event''s sign-up'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en1_v) is not null then
    raise exception 'FAIL O08g told a one-place event (it doesn''t use the home pin)'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en2) is null
     or (select count(*) from jc_event_entries where home_id = h2 and org_adjusted_at is not null) <> 1 then
    raise exception 'FAIL O08h the home pin move touched another home'; end if;
  execute 'set local role authenticated';
  k := k + 8;

  -- ---------- O09 a new family starts without the last one's lines ----------
  perform pg_temp.s15_as(c1); perform jc_admin_entry_withdraw(en1_b);
  execute 'reset role';
  update jc_event_entries set org_adjusted_at = now() where id = en1_arch;   -- history
  if (select org_withdrawn_at from jc_event_entries where id = en1_b) is null then raise exception 'FAIL O09a fixture'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(r1); perform jc_home_leave();
  execute 'reset role';
  if exists (select 1 from jc_event_entries en join jc_events e on e.id = en.event_id
              where en.home_id = h1 and e.status = 'live' and (en.org_adjusted_at is not null or en.org_withdrawn_at is not null)) then
    raise exception 'FAIL O09b a vacated home kept an organizer line'; end if;
  if (select org_adjusted_at from jc_event_entries where id = en1_arch) is null then
    raise exception 'FAIL O09c an archived event''s history changed'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s15_as(r3); perform jc_join('testville15', 'S15-JOIN-CODE-01');
  if (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid is distinct from h1 then
    raise exception 'FAIL O09d the next family got a different home'; end if;
  v := jc_event_get(ev_b);
  if v -> 'mine' -> 'org_withdrawn_at' <> 'null' or v -> 'mine' -> 'org_adjusted_at' <> 'null' then
    raise exception 'FAIL O09e the next family is told about the last one: %', v -> 'mine'; end if;
  -- the keys are there (additive, null when nothing happened)
  if not (v -> 'mine' ? 'org_adjusted_at' and v -> 'mine' ? 'org_withdrawn_at') then raise exception 'FAIL O09f mine lacks the keys'; end if;
  k := k + 6;

  -- ---------- O10 once the event closes, its admin can't act; the organizer finds nothing ----------
  perform pg_temp.s15_as(c1); perform jc_event_close(ev, 'tonight');
  perform pg_temp.s15_as(e1);
  if pg_temp.s15_err(format('select jc_admin_entry_live_set(%L, ''done'', null, false)', en2)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O10a event admin acted on a closed event'; end if;
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en2)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL O10b event admin withdrew from a closed event'; end if;
  perform pg_temp.s15_as(c1);
  if pg_temp.s15_err(format('select jc_admin_entry_withdraw(%L)', en2)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL O10c organizer withdrew from a closed event'; end if;
  k := k + 3;

  -- ---------- O11 frozen signatures + the new ones ----------
  execute 'reset role';
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('jc_event_signup', 'jc_entry_live_set', 'jc_event_close', 'jc_admin_broadcast_set',
                                                     'jc_admin_entry_pin_set', 'jc_admin_home_pin_set', 'jc_event_get', 'jc_admin_entries_list'))
     <> 'jc_admin_broadcast_set(p_text text), jc_admin_entries_list(p_event uuid), '
        'jc_admin_entry_pin_set(p_entry uuid, p_lat double precision, p_lng double precision), '
        'jc_admin_home_pin_set(p_home uuid, p_lat double precision, p_lng double precision), '
        'jc_entry_live_set(p_event uuid, p_state text, p_supply integer), '
        'jc_event_close(p_event uuid, p_confirm text), jc_event_get(p_event uuid), jc_event_signup(p_event uuid, p_payload jsonb)' then
    raise exception 'FAIL O11a a frozen signature changed (or gained an overload)'; end if;
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('jc_admin_entry_live_set', 'jc_admin_entry_withdraw', 'jc_entry_supply_clear'))
     <> 'jc_admin_entry_live_set(p_entry uuid, p_state text, p_supply integer, p_supply_clear boolean), '
        'jc_admin_entry_withdraw(p_entry uuid), jc_entry_supply_clear(p_event uuid)' then
    raise exception 'FAIL O11b the new signatures'; end if;
  k := k + 2;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's15_organizer_acts: % checks passed', k;
end
$t$;
