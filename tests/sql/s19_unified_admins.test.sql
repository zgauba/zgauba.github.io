-- R4a-3 — one admin model at every level: per-person invite links for 'community' and 'events' on top of R4a-2's
-- 'bookings' / 'pets'; the gates; who may invite; the last-admin guard; lists (via / idle); member removal ends every
-- admin right; existing code / per-event behaviour unchanged. Each UA check fails on the code live before R4a-3
-- (BAD_SCOPE for community / events, no guard, no via / idle) unless marked "unchanged".
-- Own communities (testville19 / testville19b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001901';  -- community admin (community code)
  ca uuid := '00000000-0000-4000-8000-000000001902';  -- community admin by invite
  ev uuid := '00000000-0000-4000-8000-000000001903';  -- events admin by invite
  bk uuid := '00000000-0000-4000-8000-000000001904';  -- courts admin by invite (later also community)
  r2 uuid := '00000000-0000-4000-8000-000000001905';  -- resident (has a home)
  ec uuid := '00000000-0000-4000-8000-000000001906';  -- holds the shared events code
  pe uuid := '00000000-0000-4000-8000-000000001907';  -- per-event admin only
  mx uuid := '00000000-0000-4000-8000-000000001908';  -- holds a bit of everything, then removed as a member
  oc uuid := '00000000-0000-4000-8000-000000001909';  -- testville19b: community code
  o1 uuid := '00000000-0000-4000-8000-000000001910';  -- testville19b: community by invite
  o2 uuid := '00000000-0000-4000-8000-000000001911';  -- testville19b: community code, gone stale
  ow uuid := '00000000-0000-4000-8000-000000001912';  -- testville19b member who is a platform owner
  v jsonb; k int := 0; msg text; q text; s text; tok text; tok2 text; l_id uuid; evt uuid; evt2 uuid; n int;
begin
  execute $f$create function pg_temp.s19_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s19_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s19_as(uuid), pg_temp.s19_err(text) to authenticated';

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (c1, 'c1@s19.test'), (ca, 'ca@s19.test'), (ev, 'ev@s19.test'),
    (bk, 'bk@s19.test'), (r2, 'r2@s19.test'), (ec, 'ec@s19.test'), (pe, 'pe@s19.test'), (mx, 'mx@s19.test'),
    (oc, 'oc@s19.test'), (o1, 'o1@s19.test'), (o2, 'o2@s19.test'), (ow, 'ow@s19.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville19', 'Testville 19', 24.53, 54.43,
     '{"bookings": {"enabled": true}, "pets": {"enabled": true}, "events": {"enabled": true}}'),
    ('testville19b', 'Testville 19b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville19', 'north', 'North'), ('testville19b', 'north', 'North');
  perform jc_code_set('testville19', 'join', 'S19-JOIN-CODE-01');
  perform jc_code_set('testville19', 'community', 'S19-COMMUNITY-01');
  perform jc_code_set('testville19', 'events', 'S19-EVENTS-CODE-1');
  perform jc_code_set('testville19b', 'join', 'S19B-JOIN-CODE-01');
  perform jc_code_set('testville19b', 'community', 'S19B-COMMUNITY-01');

  execute 'set local role authenticated';
  perform pg_temp.s19_as(c1); perform jc_join('testville19', 'S19-JOIN-CODE-01'); perform jc_admin_unlock('S19-COMMUNITY-01');
  foreach s in array array[ca::text, ev::text, bk::text, r2::text, pe::text, mx::text] loop
    perform pg_temp.s19_as(s::uuid); perform jc_join('testville19', 'S19-JOIN-CODE-01');
  end loop;
  perform pg_temp.s19_as(r2); perform jc_home_claim('north', 'villa', null, '91');
  perform pg_temp.s19_as(ec); perform jc_join('testville19', 'S19-JOIN-CODE-01'); perform jc_admin_unlock('S19-EVENTS-CODE-1');
  perform pg_temp.s19_as(oc); perform jc_join('testville19b', 'S19B-JOIN-CODE-01'); perform jc_admin_unlock('S19B-COMMUNITY-01');
  perform pg_temp.s19_as(o1); perform jc_join('testville19b', 'S19B-JOIN-CODE-01');
  perform pg_temp.s19_as(o2); perform jc_join('testville19b', 'S19B-JOIN-CODE-01'); perform jc_admin_unlock('S19B-COMMUNITY-01');
  perform pg_temp.s19_as(ow); perform jc_join('testville19b', 'S19B-JOIN-CODE-01');
  execute 'reset role';
  insert into jc_platform_owners (user_id) values (ow);
  insert into jc_events (community_id, slug, title_en, status) values ('testville19', 's19-night', 'S19 night', 'live') returning id into evt;
  insert into jc_events (community_id, slug, title_en, status) values ('testville19', 's19-fair', 'S19 fair', 'draft') returning id into evt2;
  insert into jc_event_admins (event_id, user_id, community_id, granted_by) values (evt, pe, 'testville19', c1);
  execute 'set local role authenticated';

  -- ---------- UA01 community admins invite at every level; 'join' and junk never ----------
  perform pg_temp.s19_as(c1);
  foreach s in array array['community', 'events', 'bookings', 'pets'] loop
    v := jc_module_admin_link_create(s);
    if v ->> 'scope' is distinct from s or length(v ->> 'token') < 20 then raise exception 'FAIL UA01a % link: %', s, v; end if;
    v := jc_module_admins_list(s);
    if v ->> 'scope' is distinct from s or jsonb_array_length(v -> 'links') is distinct from 1 then
      raise exception 'FAIL UA01b % list: %', s, v; end if;
  end loop;
  foreach s in array array['join', 'Community', 'EVENTS', 'owner', ''] loop
    if pg_temp.s19_err(format('select jc_module_admin_link_create(%L)', s)) is distinct from 'BAD_SCOPE'
       or pg_temp.s19_err(format('select jc_module_admins_list(%L)', s)) is distinct from 'BAD_SCOPE'
       or pg_temp.s19_err(format('select jc_module_admin_revoke(%L, %L, null)', s, r2)) is distinct from 'BAD_SCOPE' then
      raise exception 'FAIL UA01c scope % accepted', s; end if;
  end loop;
  k := k + 3;

  -- ---------- UA02 accept community + events invites ----------
  tok := jc_module_admin_link_create('community') ->> 'token';
  tok2 := jc_module_admin_link_create('events') ->> 'token';
  perform pg_temp.s19_as(ca);
  if jc_module_admin_accept(tok) is distinct from '{"scope": "community"}'::jsonb then raise exception 'FAIL UA02a community accept'; end if;
  perform pg_temp.s19_as(ev);
  if jc_module_admin_accept(tok2) is distinct from '{"scope": "events"}'::jsonb then raise exception 'FAIL UA02b events accept'; end if;
  perform pg_temp.s19_as(c1); tok := jc_module_admin_link_create('bookings') ->> 'token';
  perform pg_temp.s19_as(bk); perform jc_module_admin_accept(tok);
  execute 'reset role';
  if (select array_agg(scope order by scope) from jc_module_admins where community_id = 'testville19')
     is distinct from array['bookings', 'community', 'events'] then
    raise exception 'FAIL UA02c grants: %', (select array_agg(user_id || ':' || scope) from jc_module_admins where community_id = 'testville19'); end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- UA03 a per-person community grant satisfies every scope ----------
  perform pg_temp.s19_as(ca);
  if jc_me_get() -> 'admin_scopes' is distinct from '["community"]'::jsonb then raise exception 'FAIL UA03a scopes: %', jc_me_get() -> 'admin_scopes'; end if;
  if jsonb_typeof(jc_admin_homes_list()) is null or jsonb_typeof(jc_admin_facilities_list()) is distinct from 'array'
     or jsonb_typeof(jc_admin_pets_list()) is distinct from 'array'
     or jsonb_array_length(jc_admin_events_list()) is distinct from 2 then
    raise exception 'FAIL UA03b community-by-invite can''t run a module'; end if;
  -- runs the admin screens of every level: invites, lists, per-event links
  if jc_module_admin_link_create('pets') ->> 'token' is null or jc_module_admins_list('events') is null
     or jc_event_admin_link_create(evt2) ->> 'token' is null or jc_admin_code_rotate('pets') ->> 'code' is null then
    raise exception 'FAIL UA03c community-by-invite can''t manage admins'; end if;
  execute 'reset role';
  perform pg_temp.s19_as(ca);
  if not (jc_admin_has('community') and jc_admin_has('events') and jc_admin_has('bookings') and jc_admin_has('pets'))
     or not jc_events_organizer() or jc_assert_admin('bookings') is distinct from 'testville19' then
    raise exception 'FAIL UA03d gates for community-by-invite'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- UA04 a per-person events grant satisfies 'events' only ----------
  perform pg_temp.s19_as(ev);
  if jc_me_get() -> 'admin_scopes' is distinct from '["events"]'::jsonb then raise exception 'FAIL UA04a scopes'; end if;
  if jsonb_array_length(jc_admin_events_list()) is distinct from 2 then raise exception 'FAIL UA04b events admin sees all events'; end if;
  foreach q in array array['select jc_admin_homes_list()', 'select jc_admin_facilities_list()', 'select jc_admin_pets_list()',
                           'select jc_admin_log_list()', 'select jc_admin_code_rotate(''events'')',
                           format('select jc_event_admin_link_create(%L)', evt2)] loop
    msg := pg_temp.s19_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL UA04c events admin: % -> %', q, msg; end if;
  end loop;
  execute 'reset role';
  perform pg_temp.s19_as(ev);
  if not jc_admin_has('events') or jc_admin_has('community') or jc_admin_has('bookings') or jc_admin_has('pets')
     or not jc_events_organizer() or jc_assert_event_admin(evt2, true) is distinct from 'testville19' then
    raise exception 'FAIL UA04d gates for events-by-invite'; end if;
  if pg_temp.s19_err('select jc_assert_admin(''community'')') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL UA04e events grant passed the community gate'; end if;
  -- R4a-2 invariant kept: a bookings grant never satisfies community / events
  perform pg_temp.s19_as(bk);
  if jc_admin_has('community') or jc_admin_has('events') or jc_events_organizer()
     or pg_temp.s19_err('select jc_assert_admin(''events'')') is distinct from 'NOT_ADMIN'
     or pg_temp.s19_err('select jc_assert_admin(''community'')') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL UA04f bookings grant leaked into community / events'; end if;
  execute 'set local role authenticated';
  if pg_temp.s19_err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL UA04g bookings admin sees events'; end if;
  k := k + 7;

  -- ---------- UA05 no self-escalation: only community admins invite / list / revoke, at any level ----------
  foreach s in array array[ev::text, bk::text, ec::text, pe::text, r2::text] loop
    perform pg_temp.s19_as(s::uuid);
    foreach q in array array['community', 'events', 'bookings', 'pets'] loop
      if pg_temp.s19_err(format('select jc_module_admin_link_create(%L)', q)) is distinct from 'NOT_ADMIN'
         or pg_temp.s19_err(format('select jc_module_admins_list(%L)', q)) is distinct from 'NOT_ADMIN'
         or pg_temp.s19_err(format('select jc_module_admin_revoke(%L, %L, null)', q, ca)) is distinct from 'NOT_ADMIN' then
        raise exception 'FAIL UA05a % reached % invites', s, q; end if;
    end loop;
  end loop;
  k := k + 1;

  -- ---------- UA06 a lower-scope admin redeems a community invite: gains community, keeps the lower grant ----------
  perform pg_temp.s19_as(c1); tok := jc_module_admin_link_create('community') ->> 'token';
  perform pg_temp.s19_as(bk); perform jc_module_admin_accept(tok);
  if jc_me_get() -> 'admin_scopes' is distinct from '["bookings", "community"]'::jsonb then raise exception 'FAIL UA06a scopes'; end if;
  if jsonb_typeof(jc_admin_homes_list()) is null then raise exception 'FAIL UA06b no community rights'; end if;
  -- someone who already holds community can't burn a community link
  perform pg_temp.s19_as(c1); tok := jc_module_admin_link_create('community') ->> 'token';
  perform pg_temp.s19_as(ca);
  if pg_temp.s19_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'ALREADY_ADMIN' then
    raise exception 'FAIL UA06c second community accept'; end if;
  -- a community code holder converts to a named grant with the same flow
  perform pg_temp.s19_as(c1); perform jc_module_admin_accept(tok);
  perform pg_temp.s19_as(ca);
  select x into v from jsonb_array_elements(jc_module_admins_list('community') -> 'admins') x where (x ->> 'user_id')::uuid = c1;
  if v -> 'via' is distinct from '["code", "invite"]'::jsonb then raise exception 'FAIL UA06d code + invite holder: %', v; end if;
  -- removing bk's community grant leaves their courts grant
  perform jc_module_admin_revoke('community', bk, null);
  perform pg_temp.s19_as(bk);
  if jc_me_get() -> 'admin_scopes' is distinct from '["bookings"]'::jsonb
     or pg_temp.s19_err('select jc_admin_homes_list()') is distinct from 'NOT_ADMIN'
     or jsonb_typeof(jc_admin_facilities_list()) is distinct from 'array' then
    raise exception 'FAIL UA06e community revoke touched the courts grant'; end if;
  k := k + 5;

  -- ---------- UA07 lists: every holder of the scope, via code / invite, idle flag, no new PII ----------
  perform pg_temp.s19_as(ca);
  v := jc_module_admins_list('community');
  if (select array_agg((x ->> 'user_id') || ':' || (x -> 'via')::text order by x ->> 'user_id') from jsonb_array_elements(v -> 'admins') x)
     is distinct from array[c1 || ':["code", "invite"]', ca || ':["invite"]'] then
    raise exception 'FAIL UA07a community list: %', v -> 'admins'; end if;
  v := jc_module_admins_list('events');
  if (select array_agg((x ->> 'user_id') || ':' || (x -> 'via')::text order by x ->> 'user_id') from jsonb_array_elements(v -> 'admins') x)
     is distinct from array[ev || ':["invite"]', ec || ':["code"]'] then
    raise exception 'FAIL UA07b events list: %', v -> 'admins'; end if;
  select x into v from jsonb_array_elements(v -> 'admins') x where (x ->> 'user_id')::uuid = ev;
  if (select array_agg(key order by key) from jsonb_object_keys(v) key)
     is distinct from array['building', 'granted_at', 'idle', 'last_used_at', 'name', 'number', 'type', 'user_id', 'via', 'village']
     or v ->> 'name' is distinct from 'e•••@s19.test' or (v ->> 'idle')::boolean then
    raise exception 'FAIL UA07c row: %', v; end if;
  if jc_module_admins_list('events')::text ~ '(ev|ec)@s19' then raise exception 'FAIL UA07d full email listed'; end if;
  if jc_module_admins_list('community')::text ~ '(c1|ca)@s19' then raise exception 'FAIL UA07e full email listed'; end if;
  execute 'reset role';
  update jc_module_admins set last_used_at = now() - interval '91 days' where user_id = ev;
  execute 'set local role authenticated';
  select x into v from jsonb_array_elements(jc_module_admins_list('events') -> 'admins') x where (x ->> 'user_id')::uuid = ev;
  if not (v ->> 'idle')::boolean then raise exception 'FAIL UA07f a 91-day-idle grant not flagged'; end if;
  -- the idle grant still works (no lapse) and the use clears the flag
  perform pg_temp.s19_as(ev); perform jc_admin_events_list();
  perform pg_temp.s19_as(ca);
  select x into v from jsonb_array_elements(jc_module_admins_list('events') -> 'admins') x where (x ->> 'user_id')::uuid = ev;
  if (v ->> 'idle')::boolean then raise exception 'FAIL UA07g use did not refresh last_used_at'; end if;
  -- community admins are listed once, under 'community' (not repeated per scope)
  if jsonb_array_length(jc_module_admins_list('pets') -> 'admins') is distinct from 0 then raise exception 'FAIL UA07h pets list'; end if;
  k := k + 8;

  -- ---------- UA08 one "Remove" ends a code holder's unlock too; the code itself still works ----------
  v := jc_module_admin_revoke('events', ec, null);
  if exists (select 1 from jsonb_array_elements(v -> 'admins') x where (x ->> 'user_id')::uuid = ec) then
    raise exception 'FAIL UA08a removed code holder still listed'; end if;
  perform pg_temp.s19_as(ec);
  if pg_temp.s19_err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then raise exception 'FAIL UA08b removed code holder kept events'; end if;
  perform jc_admin_unlock('S19-EVENTS-CODE-1');   -- documented: the shared code unlocks again until it is retired
  if jsonb_array_length(jc_admin_events_list()) is distinct from 2 then raise exception 'FAIL UA08c the events code stopped working'; end if;
  perform pg_temp.s19_as(ca);
  if pg_temp.s19_err(format('select jc_module_admin_revoke(''events'', %L, null)', r2)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL UA08d revoke of a non-holder'; end if;
  k := k + 4;

  -- ---------- UA09 last-admin guard (testville19b) ----------
  -- oc (code), o2 (code, will go stale); o1 joins by invite
  perform pg_temp.s19_as(oc); tok := jc_module_admin_link_create('community') ->> 'token';
  perform pg_temp.s19_as(o1); perform jc_module_admin_accept(tok);
  -- self-removal is fine while another remains, and returns the list (o1 no longer passes its gate)
  v := jc_module_admin_revoke('community', o1, null);
  if v ->> 'scope' is distinct from 'community'
     or exists (select 1 from jsonb_array_elements(v -> 'admins') x where (x ->> 'user_id')::uuid = o1) then
    raise exception 'FAIL UA09a self-removal: %', v; end if;
  if pg_temp.s19_err('select jc_admin_homes_list()') is distinct from 'NOT_ADMIN' then raise exception 'FAIL UA09b o1 kept community'; end if;
  -- back in by invite; then the code holders are removed one by one
  perform pg_temp.s19_as(oc); tok := jc_module_admin_link_create('community') ->> 'token';
  perform pg_temp.s19_as(o1); perform jc_module_admin_accept(tok);
  perform jc_module_admin_revoke('community', o2, null);
  perform jc_module_admin_revoke('community', oc, null);
  -- o1 is now the only community admin: can't remove themselves
  if pg_temp.s19_err(format('select jc_module_admin_revoke(''community'', %L, null)', o1)) is distinct from 'LAST_ADMIN' then
    raise exception 'FAIL UA09c the last admin removed themselves'; end if;
  if jsonb_typeof(jc_admin_homes_list()) is null then raise exception 'FAIL UA09d LAST_ADMIN did not roll back'; end if;
  -- a stale code unlock (61 days) and the platform owner don't count as another admin
  perform pg_temp.s19_as(o2); perform jc_admin_unlock('S19B-COMMUNITY-01');
  execute 'reset role';
  update jc_admin_grants set last_used_at = now() - interval '61 days' where user_id = o2;
  if jc_community_admin_count('testville19b') <> 1 then raise exception 'FAIL UA09e count with a stale unlock: %', jc_community_admin_count('testville19b'); end if;
  execute 'set local role authenticated';
  perform pg_temp.s19_as(ow);
  if not (jc_me_get() ->> 'is_owner')::boolean or pg_temp.s19_err('select jc_admin_homes_list()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL UA09f the owner is not an admin'; end if;
  perform pg_temp.s19_as(o1);
  if pg_temp.s19_err(format('select jc_module_admin_revoke(''community'', %L, null)', o1)) is distinct from 'LAST_ADMIN' then
    raise exception 'FAIL UA09g stale unlock / owner counted as another admin'; end if;
  -- an active code unlock does count: o2 unlocks fresh, then o1 may leave; o2 then can't remove their own unlock
  perform pg_temp.s19_as(o2); perform jc_admin_unlock('S19B-COMMUNITY-01');
  perform pg_temp.s19_as(o1); perform jc_module_admin_revoke('community', o1, null);
  perform pg_temp.s19_as(o2);
  if pg_temp.s19_err(format('select jc_module_admin_revoke(''community'', %L, null)', o2)) is distinct from 'LAST_ADMIN' then
    raise exception 'FAIL UA09h the last code holder removed their own unlock'; end if;
  -- removing a non-community scope is never guarded
  tok := jc_module_admin_link_create('events') ->> 'token';
  perform pg_temp.s19_as(o1); perform jc_module_admin_accept(tok);
  perform pg_temp.s19_as(o2);
  if jc_module_admin_revoke('events', o1, null) ->> 'scope' is distinct from 'events' then raise exception 'FAIL UA09i events revoke'; end if;
  k := k + 9;

  -- ---------- UA10 removing a member ends every admin right they hold ----------
  perform pg_temp.s19_as(c1);
  tok := jc_module_admin_link_create('community') ->> 'token';
  tok2 := jc_module_admin_link_create('pets') ->> 'token';
  perform pg_temp.s19_as(mx); perform jc_module_admin_accept(tok); perform jc_module_admin_accept(tok2);
  perform jc_admin_unlock('S19-EVENTS-CODE-1');
  perform pg_temp.s19_as(c1); tok := jc_event_admin_link_create(evt) ->> 'token';
  perform pg_temp.s19_as(mx); perform jc_event_admin_accept(tok);
  if jc_me_get() -> 'admin_scopes' is distinct from '["community", "events", "pets"]'::jsonb
     or jc_me_get() -> 'admin_events' is distinct from to_jsonb(array[evt]) then
    raise exception 'FAIL UA10a setup: %', jc_me_get(); end if;
  perform pg_temp.s19_as(ca); perform jc_admin_member_remove(mx, false);
  perform pg_temp.s19_as(mx);
  if jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb or jc_me_get() -> 'admin_events' is distinct from '[]'::jsonb
     or pg_temp.s19_err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL UA10b removed member kept admin rights: %', jc_me_get(); end if;
  execute 'reset role';
  if not exists (select 1 from jc_admin_log where community_id = 'testville19' and action = 'member_remove'
                  and (target ->> 'user_id')::uuid = mx and actor = ca
                  and target -> 'module_admin_removed' = '["community", "pets"]'::jsonb
                  and target -> 'code_unlocks_removed' = '["events"]'::jsonb
                  and (target ->> 'event_admin_removed')::int = 1) then
    raise exception 'FAIL UA10c member_remove log: %', (select target from jc_admin_log where action = 'member_remove' and actor = ca); end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- UA11 unchanged: codes unlock, 60-day lapse, rotation and exit leave per-person grants alone ----------
  perform pg_temp.s19_as(c1); perform jc_admin_code_rotate('community');
  perform pg_temp.s19_as(ca);
  if jsonb_typeof(jc_admin_homes_list()) is null then raise exception 'FAIL UA11a rotation dropped a community invitee'; end if;
  perform jc_admin_exit();
  if jsonb_typeof(jc_admin_homes_list()) is null then raise exception 'FAIL UA11b exit dropped a community invitee'; end if;
  -- unchanged: a code unlock lapses after 60 days unused (ec, code only)
  execute 'reset role';
  update jc_admin_grants set last_used_at = now() - interval '61 days' where user_id = ec;
  execute 'set local role authenticated';
  perform pg_temp.s19_as(ec);
  if pg_temp.s19_err('select jc_admin_events_list()') is distinct from 'NOT_ADMIN' then raise exception 'FAIL UA11c 60-day lapse'; end if;
  -- unchanged: per-event links (community admins only; an event admin runs only their event)
  perform pg_temp.s19_as(ca); tok := jc_event_admin_link_create(evt2) ->> 'token';
  perform pg_temp.s19_as(pe); perform jc_event_admin_accept(tok);
  if (select array_agg(e order by e) from jsonb_array_elements_text(jc_me_get() -> 'admin_events') e)
     is distinct from (select array_agg(x::text order by x::text) from unnest(array[evt, evt2]) x)
     or jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb then
    raise exception 'FAIL UA11d per-event admin: %', jc_me_get(); end if;
  execute 'reset role';
  perform pg_temp.s19_as(pe);
  if jc_events_organizer() or jc_admin_has('events') then raise exception 'FAIL UA11e per-event admin became organizer'; end if;
  execute 'set local role authenticated';
  k := k + 5;

  -- ---------- UA12 audit log at every scope; snapshots count community / events invitees ----------
  execute 'reset role';
  if (select count(distinct target ->> 'scope') from jc_admin_log
       where community_id = 'testville19' and action = 'module_admin_link') is distinct from 4::bigint
     or (select count(distinct target ->> 'scope') from jc_admin_log
          where community_id = 'testville19' and action = 'module_admin_accept'
            and target ->> 'scope' in ('community', 'events')) is distinct from 2::bigint
     or not exists (select 1 from jc_admin_log where community_id = 'testville19' and action = 'module_admin_revoke'
                     and actor = ca and target ->> 'scope' = 'events' and (target ->> 'user_id')::uuid = ec
                     and (target ->> 'code_unlock_removed')::boolean)
     or not exists (select 1 from jc_admin_log where community_id = 'testville19b' and action = 'module_admin_revoke'
                     and actor = o1 and target ->> 'scope' = 'community' and (target ->> 'user_id')::uuid = o1
                     and not (target ->> 'code_unlock_removed')::boolean) then
    raise exception 'FAIL UA12a audit log'; end if;
  -- LAST_ADMIN attempts rolled back and logged nothing
  if (select count(*) from jc_admin_log where community_id = 'testville19b' and action = 'module_admin_revoke') is distinct from 5::bigint then
    raise exception 'FAIL UA12b revoke log rows: %', (select count(*) from jc_admin_log where community_id = 'testville19b' and action = 'module_admin_revoke'); end if;
  perform jc_snapshot_run(now());
  -- testville19b: o2 (fresh code unlock) + o1 (events invite revoked; no grants) + oc (code removed) = o2 only;
  -- o2's stale-then-refreshed unlock counts once
  if (select (metrics ->> 'admins')::int from jc_snapshots
       where community_id = 'testville19b' and module = 'accounts' and bucket = date_trunc('hour', now())) is distinct from 1 then
    raise exception 'FAIL UA12c snapshot admins 19b'; end if;
  -- testville19: c1 (code + invite), ca (invite), ev (invite), bk (invite), ec (lapsed code: not counted) = 4
  if (select (metrics ->> 'admins')::int from jc_snapshots
       where community_id = 'testville19' and module = 'accounts' and bucket = date_trunc('hour', now())) is distinct from 4 then
    raise exception 'FAIL UA12d snapshot admins 19: %', (select metrics from jc_snapshots
       where community_id = 'testville19' and module = 'accounts' and bucket = date_trunc('hour', now())); end if;
  k := k + 4;

  -- ---------- G01 helpers stay internal; gates unchanged in kind ----------
  if has_function_privilege('authenticated', 'public.jc_community_admin_count(text)', 'execute')
     or has_function_privilege('anon', 'public.jc_community_admin_count(text)', 'execute')
     or has_function_privilege('authenticated', 'public.jc_admins_payload(text, text)', 'execute')
     or has_function_privilege('anon', 'public.jc_admins_payload(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.jc_events_organizer()', 'execute') then
    raise exception 'FAIL G01a an internal helper is callable'; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('jc_community_admin_count', 'jc_admins_payload')
        and p.prosecdef and 'search_path=public, pg_temp' = any(p.proconfig)) <> 2 then
    raise exception 'FAIL G01b helpers not definer / pinned'; end if;
  if (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jc\_module\_admin%')
     is distinct from 'jc_module_admin_accept(p_token text), jc_module_admin_link_create(p_scope text), '
                      'jc_module_admin_revoke(p_scope text, p_user uuid, p_link uuid), jc_module_admins_list(p_scope text)' then
    raise exception 'FAIL G01c an invite RPC signature changed'; end if;
  k := k + 3;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's19_unified_admins: % checks passed', k;
end
$t$;
