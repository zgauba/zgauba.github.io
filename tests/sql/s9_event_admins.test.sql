-- T5.2 PR A — per-event admins: grant links, the per-event check on all ten events-admin
-- functions (own event / other event / resident / community admin), create + publish stay
-- with the community, the 5-day read-only window after close, revoke, legacy `events` code,
-- account deletion. Own communities (testville9 / testville9b) — never jubail.
-- Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000000901';  -- community admin
  e1 uuid := '00000000-0000-4000-8000-000000000902';  -- event admin of A (has a home)
  e2 uuid := '00000000-0000-4000-8000-000000000903';  -- event admin of B (no home)
  r1 uuid := '00000000-0000-4000-8000-000000000904';  -- resident, signed up to A
  r2 uuid := '00000000-0000-4000-8000-000000000905';  -- resident, signed up to B
  r3 uuid := '00000000-0000-4000-8000-000000000906';  -- resident, not signed up anywhere
  lg uuid := '00000000-0000-4000-8000-000000000907';  -- holds the legacy shared `events` code
  o1 uuid := '00000000-0000-4000-8000-000000000908';  -- testville9b member
  ev_a uuid; ev_b uuid; ev_d uuid; ev_x uuid; en_a uuid; en_b uuid; h_r1 uuid; h_r2 uuid; h_r3 uuid;
  tok text; tok2 text; v jsonb; v_err text; k int := 0; i int; l_id uuid;
begin
  -- ---------- helpers (temp, dropped with the transaction) ----------
  execute $f$create function pg_temp.as_user(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  -- run one statement, return the error message (null = it worked)
  execute $f$create function pg_temp.err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.as_user(uuid), pg_temp.err(text) to authenticated';

  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (c1, 'c1@s9.test'), (e1, 'e1@s9.test'), (e2, 'e2@s9.test'), (r1, 'r1@s9.test'),
    (r2, 'r2@s9.test'), (r3, 'r3@s9.test'), (lg, 'lg@s9.test'), (o1, 'o1@s9.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville9', 'Testville 9', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville9b', 'Testville 9b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville9', 'north', 'North'), ('testville9b', 'north', 'North');
  perform jc_code_set('testville9', 'join', 'S9-JOIN-CODE-01');
  perform jc_code_set('testville9', 'community', 'S9-COMMUNITY-01');
  perform jc_code_set('testville9', 'events', 'S9-EVENTS-LEGACY-01');
  perform jc_code_set('testville9b', 'join', 'S9B-JOIN-CODE-01');
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville9', 'event-a', 'Event A', 'live', true, '{"fields": {}}') returning id into ev_a;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville9', 'event-b', 'Event B', 'live', true, '{"fields": {}}') returning id into ev_b;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville9', 'draft-d', 'Draft D', 'draft', true, '{"fields": {}}') returning id into ev_d;
  insert into jc_events (community_id, slug, title_en, status, signups_open, payload_schema)
  values ('testville9b', 'event-x', 'Event X', 'live', true, '{"fields": {}}') returning id into ev_x;

  execute 'set local role authenticated';
  perform pg_temp.as_user(c1); perform jc_join('testville9', 'S9-JOIN-CODE-01'); perform jc_admin_unlock('S9-COMMUNITY-01');
  perform pg_temp.as_user(e1); perform jc_join('testville9', 'S9-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '91');
  perform pg_temp.as_user(e2); perform jc_join('testville9', 'S9-JOIN-CODE-01');
  perform pg_temp.as_user(r1); perform jc_join('testville9', 'S9-JOIN-CODE-01');
  h_r1 := (jc_home_claim('north', 'villa', null, '1') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5310, 54.4310); perform jc_event_signup(ev_a, '{}');
  perform pg_temp.as_user(r2); perform jc_join('testville9', 'S9-JOIN-CODE-01');
  h_r2 := (jc_home_claim('north', 'villa', null, '2') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5320, 54.4320); perform jc_event_signup(ev_b, '{}');
  perform pg_temp.as_user(r3); perform jc_join('testville9', 'S9-JOIN-CODE-01');
  h_r3 := (jc_home_claim('north', 'villa', null, '3') -> 'home' ->> 'id')::uuid;
  perform jc_home_pin_set(24.5330, 54.4330);
  perform pg_temp.as_user(lg); perform jc_join('testville9', 'S9-JOIN-CODE-01'); perform jc_admin_unlock('S9-EVENTS-LEGACY-01');
  perform pg_temp.as_user(o1); perform jc_join('testville9b', 'S9B-JOIN-CODE-01');
  execute 'reset role';
  select id into en_a from jc_event_entries where event_id = ev_a;
  select id into en_b from jc_event_entries where event_id = ev_b;
  execute 'set local role authenticated';

  -- ---------- Q01 grant links: community admin only ----------
  perform pg_temp.as_user(r1);
  if pg_temp.err(format('select jc_event_admin_link_create(%L)', ev_a)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL Q01a resident made a link'; end if;
  perform pg_temp.as_user(lg);   -- the legacy events code runs events but does not appoint people
  if pg_temp.err(format('select jc_event_admin_link_create(%L)', ev_a)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL Q01b legacy events code made a link'; end if;
  perform pg_temp.as_user(c1);
  if pg_temp.err(format('select jc_event_admin_link_create(%L)', ev_x)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL Q01c link for another community''s event'; end if;
  tok := jc_event_admin_link_create(ev_a) ->> 'token';
  if tok is null or length(tok) < 20 then raise exception 'FAIL Q01d no token'; end if;
  k := k + 4;

  -- ---------- Q02 accept: same community, single use ----------
  perform pg_temp.as_user(o1);
  if pg_temp.err(format('select jc_event_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL Q02a other community accepted'; end if;
  perform pg_temp.as_user(e1);
  if pg_temp.err('select jc_event_admin_accept(''nonsense-token-nonsense'')') is distinct from 'BAD_LINK' then
    raise exception 'FAIL Q02b junk token'; end if;
  v := jc_event_admin_accept(tok);
  if v ->> 'title_en' is distinct from 'Event A' then raise exception 'FAIL Q02c accept returned %', v; end if;
  perform pg_temp.as_user(r1);
  if pg_temp.err(format('select jc_event_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL Q02d link reused'; end if;
  perform pg_temp.as_user(c1);
  tok2 := jc_event_admin_link_create(ev_b) ->> 'token';
  perform pg_temp.as_user(e2); perform jc_event_admin_accept(tok2);
  -- expired and revoked links refuse
  perform pg_temp.as_user(c1);
  tok := jc_event_admin_link_create(ev_b) ->> 'token';
  tok2 := jc_event_admin_link_create(ev_b) ->> 'token';
  execute 'reset role';
  update jc_event_admin_links set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(tok, 'sha256'), 'hex');
  select id into l_id from jc_event_admin_links where token_hash = encode(extensions.digest(tok2, 'sha256'), 'hex');
  execute 'set local role authenticated';
  perform pg_temp.as_user(c1);
  v := jc_event_admin_revoke(ev_b, null, l_id);
  if jsonb_array_length(v -> 'links') <> 0 then raise exception 'FAIL Q02e revoked/expired links still listed: %', v -> 'links'; end if;
  perform pg_temp.as_user(r3);
  if pg_temp.err(format('select jc_event_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL Q02f expired link accepted'; end if;
  if pg_temp.err(format('select jc_event_admin_accept(%L)', tok2)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL Q02g revoked link accepted'; end if;
  -- at most 10 open links per event
  perform pg_temp.as_user(c1);
  for i in 1..10 loop perform jc_event_admin_link_create(ev_d); end loop;
  if pg_temp.err(format('select jc_event_admin_link_create(%L)', ev_d)) is distinct from 'TOO_MANY_LINKS' then
    raise exception 'FAIL Q02h 11th open link'; end if;
  k := k + 8;

  -- ---------- Q03 jc_me_get.admin_events ----------
  perform pg_temp.as_user(e1);
  if jc_me_get() -> 'admin_events' is distinct from jsonb_build_array(ev_a) then
    raise exception 'FAIL Q03a e1 admin_events: %', jc_me_get() -> 'admin_events'; end if;
  perform pg_temp.as_user(r1);
  if jc_me_get() -> 'admin_events' is distinct from '[]'::jsonb then raise exception 'FAIL Q03b resident admin_events'; end if;
  k := k + 2;

  -- ---------- Q04 jc_admin_events_list is filtered ----------
  perform pg_temp.as_user(e1);
  v := jc_admin_events_list();
  if jsonb_array_length(v) <> 1 or v -> 0 ->> 'id' <> ev_a::text then raise exception 'FAIL Q04a e1 sees %', v; end if;
  perform pg_temp.as_user(c1);
  if jsonb_array_length(jc_admin_events_list()) <> 3 then raise exception 'FAIL Q04b community admin list'; end if;
  perform pg_temp.as_user(r1);
  if pg_temp.err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q04c resident list'; end if;
  k := k + 3;

  -- ---------- Q05 each function: own event ok / other event refused / resident refused ----------
  perform pg_temp.as_user(e1);
  if pg_temp.err(format('select jc_admin_event_save(%L, ''{"title_en": "Event A!"}'')', ev_a)) is not null then
    raise exception 'FAIL Q05a e1 edit own: %', pg_temp.err(format('select jc_admin_event_save(%L, ''{"title_en": "Event A!"}'')', ev_a)); end if;
  if pg_temp.err(format('select jc_admin_event_save(%L, ''{"title_en": "x"}'')', ev_b)) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL Q05b e1 edit other'; end if;
  if pg_temp.err('select jc_admin_event_save(null, ''{"slug": "new-e", "title_en": "New"}'')') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL Q05c event admin created an event'; end if;
  if pg_temp.err(format('select jc_admin_event_signups(%L, false)', ev_a)) is not null then raise exception 'FAIL Q05d signups own'; end if;
  if pg_temp.err(format('select jc_admin_event_signups(%L, false)', ev_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05e signups other'; end if;
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_a)) is not null then raise exception 'FAIL Q05f entries own'; end if;
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05g entries other'; end if;
  -- a non-admin can't tell a real id from a made-up one
  if pg_temp.err(format('select jc_admin_entries_list(%L)', gen_random_uuid())) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05h entries random'; end if;
  if pg_temp.err(format('select jc_admin_entry_moderate(%L, true, ''checked'')', en_a)) is not null then raise exception 'FAIL Q05i moderate own'; end if;
  if pg_temp.err(format('select jc_admin_entry_moderate(%L, true, null)', en_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05j moderate other'; end if;
  if pg_temp.err(format('select jc_admin_entry_moderate(%L, true, null)', gen_random_uuid())) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05k moderate random'; end if;
  if pg_temp.err(format('select jc_admin_entry_pin_set(%L, 24.5311, 54.4311)', en_a)) is not null then raise exception 'FAIL Q05l entry pin own'; end if;
  if pg_temp.err(format('select jc_admin_entry_pin_set(%L, 24.5321, 54.4321)', en_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05m entry pin other'; end if;
  -- home pins: only homes signed up to an event this person runs
  if pg_temp.err(format('select jc_admin_home_pin_set(%L, 24.5312, 54.4312)', h_r1)) is not null then raise exception 'FAIL Q05n home pin (signed up to A)'; end if;
  if pg_temp.err(format('select jc_admin_home_pin_set(%L, 24.5322, 54.4322)', h_r2)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05o home pin (B only)'; end if;
  if pg_temp.err(format('select jc_admin_home_pin_set(%L, 24.5332, 54.4332)', h_r3)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05p home pin (not signed up)'; end if;
  -- banner: allowed while an event they run is live
  if pg_temp.err('select jc_admin_broadcast_set(''Road closed by the souk'')') is not null then raise exception 'FAIL Q05q broadcast during live'; end if;
  if pg_temp.err(format('select jc_event_close(%L, ''event-b'')', ev_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05r close other'; end if;
  k := k + 18;
  -- publish is the community's step, even for that event's own admin
  perform pg_temp.as_user(c1);
  tok := jc_event_admin_link_create(ev_b) ->> 'token';
  execute 'reset role';
  delete from jc_event_admin_links where event_id = ev_d;   -- the Q02h links; make room
  execute 'set local role authenticated';
  tok := jc_event_admin_link_create(ev_d) ->> 'token';
  perform pg_temp.as_user(e2); perform jc_event_admin_accept(tok);
  if pg_temp.err(format('select jc_admin_event_publish(%L)', ev_d)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05s event admin published'; end if;
  if pg_temp.err(format('select jc_admin_event_save(%L, ''{"slug": "draft-dd"}'')', ev_d)) is not null then raise exception 'FAIL Q05t edit own draft'; end if;
  -- residents: every function refuses
  perform pg_temp.as_user(r1);
  if pg_temp.err(format('select jc_admin_event_save(%L, ''{"title_en": "x"}'')', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05u resident save'; end if;
  if pg_temp.err(format('select jc_admin_event_signups(%L, true)', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05v resident signups'; end if;
  if pg_temp.err(format('select jc_event_close(%L, ''event-a'')', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05w resident close'; end if;
  if pg_temp.err('select jc_admin_broadcast_set(''x'')') is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05x resident broadcast'; end if;
  if pg_temp.err(format('select jc_admin_home_pin_set(%L, 24.5312, 54.4312)', h_r1)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q05y resident home pin'; end if;
  -- community admin: everything, and a real NOT_FOUND for made-up / other-community ids
  perform pg_temp.as_user(c1);
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_x)) is distinct from 'NOT_FOUND' then raise exception 'FAIL Q05z other community event'; end if;
  if pg_temp.err(format('select jc_admin_entry_moderate(%L, true, null)', gen_random_uuid())) is distinct from 'NOT_FOUND' then raise exception 'FAIL Q05aa organizer random entry'; end if;
  if pg_temp.err(format('select jc_admin_event_signups(%L, true)', ev_b)) is not null then raise exception 'FAIL Q05ab community signups'; end if;
  if pg_temp.err(format('select jc_admin_home_pin_set(%L, 24.5332, 54.4332)', h_r3)) is not null then raise exception 'FAIL Q05ac community home pin'; end if;
  k := k + 13;

  -- ---------- Q06 close + the 5-day read-only window ----------
  perform pg_temp.as_user(e1);
  if pg_temp.err(format('select jc_event_close(%L, ''event-a'')', ev_a)) is not null then raise exception 'FAIL Q06a close own'; end if;
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_a)) is not null then raise exception 'FAIL Q06b read in window'; end if;
  if jsonb_array_length(jc_admin_events_list()) <> 1 then raise exception 'FAIL Q06c list in window'; end if;
  if pg_temp.err(format('select jc_admin_event_signups(%L, true)', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q06d write in window'; end if;
  if pg_temp.err(format('select jc_admin_event_save(%L, ''{"title_en": "late"}'')', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q06e edit in window'; end if;
  -- no live event of theirs → no banner
  if pg_temp.err('select jc_admin_broadcast_set(''late'')') is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q06f banner after close'; end if;
  if jc_me_get() -> 'admin_events' is distinct from jsonb_build_array(ev_a) then raise exception 'FAIL Q06g admin_events in window'; end if;
  -- no new links for a closed event
  perform pg_temp.as_user(c1);
  if pg_temp.err(format('select jc_event_admin_link_create(%L)', ev_a)) is distinct from 'NOT_FOUND' then raise exception 'FAIL Q06h link for closed event'; end if;
  execute 'reset role';
  update jc_events set archived_at = now() - interval '4 days' where id = ev_a;
  execute 'set local role authenticated';
  perform pg_temp.as_user(e1);
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_a)) is not null then raise exception 'FAIL Q06i read at day 4'; end if;
  execute 'reset role';
  update jc_events set archived_at = now() - interval '6 days' where id = ev_a;
  execute 'set local role authenticated';
  perform pg_temp.as_user(e1);
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_a)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q06j read at day 6'; end if;
  if pg_temp.err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q06k list at day 6'; end if;
  if jc_me_get() -> 'admin_events' is distinct from '[]'::jsonb then raise exception 'FAIL Q06l admin_events at day 6'; end if;
  k := k + 12;

  -- ---------- Q07 list + revoke ----------
  perform pg_temp.as_user(c1);
  v := jc_event_admins_list(ev_b);
  if jsonb_array_length(v -> 'admins') <> 1 or v -> 'admins' -> 0 ->> 'name' is distinct from 'e•••@s9.test' then
    raise exception 'FAIL Q07a admins list: %', v; end if;
  if (v -> 'admins' -> 0) ? 'email' then raise exception 'FAIL Q07b raw email exposed'; end if;
  v := jc_event_admin_revoke(ev_b, e2, null);
  if jsonb_array_length(v -> 'admins') <> 0 then raise exception 'FAIL Q07c revoke'; end if;
  if pg_temp.err(format('select jc_event_admin_revoke(%L, %L, null)', ev_b, e2)) is distinct from 'NOT_FOUND' then raise exception 'FAIL Q07d revoke twice'; end if;
  if pg_temp.err(format('select jc_event_admin_revoke(%L, %L, %L)', ev_b, e2, gen_random_uuid())) is distinct from 'BAD_FIELDS' then raise exception 'FAIL Q07e both args'; end if;
  perform pg_temp.as_user(e2);
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q07f revoked still reads'; end if;
  perform pg_temp.as_user(r1);
  if pg_temp.err(format('select jc_event_admins_list(%L)', ev_b)) is distinct from 'NOT_ADMIN' then raise exception 'FAIL Q07g resident lists admins'; end if;
  k := k + 7;

  -- ---------- Q08 legacy `events` code: still runs every event (until PR C) ----------
  perform pg_temp.as_user(lg);
  if pg_temp.err('select jc_admin_event_save(null, ''{"slug": "legacy-new", "title_en": "Legacy"}'')') is not null then raise exception 'FAIL Q08a legacy create'; end if;
  if pg_temp.err(format('select jc_admin_event_publish(%L)', ev_d)) is not null then raise exception 'FAIL Q08b legacy publish'; end if;
  if pg_temp.err(format('select jc_admin_entries_list(%L)', ev_b)) is not null then raise exception 'FAIL Q08c legacy entries'; end if;
  k := k + 3;

  -- ---------- Q09 account deletion takes the grant with it ----------
  execute 'reset role';
  if not exists (select 1 from jc_event_admins where user_id = e2 and event_id = ev_d) then raise exception 'FAIL Q09a setup'; end if;
  delete from auth.users where id = e2;
  if exists (select 1 from jc_event_admins where user_id = e2) then raise exception 'FAIL Q09b grant survived account deletion'; end if;
  if (select count(*) from jc_admin_log where community_id = 'testville9' and action like 'event_admin_%') < 5 then
    raise exception 'FAIL Q09c grant actions not logged'; end if;
  k := k + 3;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's9_event_admins: % checks passed', k;
end
$t$;
