-- R4a-2 — per-person module admins by invite link (Zee decision 10) + two R4a deferred fixes (bidi controls in
-- jc_clean_line callers; block reasons capped at 185 so 'Court blocked: ' || reason fits cancel_reason whole).
-- Each module-admin check fails on the code live before R4a-2 (no jc_module_admin_* functions; the gates only read
-- codes). Own communities (testville18 / testville18b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001801';  -- community admin (community code)
  bk uuid := '00000000-0000-4000-8000-000000001802';  -- courts admin by invite (has a home)
  pt uuid := '00000000-0000-4000-8000-000000001803';  -- pets admin by invite
  ea uuid := '00000000-0000-4000-8000-000000001804';  -- per-event admin only
  r1 uuid := '00000000-0000-4000-8000-000000001805';  -- resident with a home (books, owns a pet)
  r2 uuid := '00000000-0000-4000-8000-000000001806';  -- resident, nothing else
  lg uuid := '00000000-0000-4000-8000-000000001807';  -- holds the shared `bookings` code
  b2 uuid := '00000000-0000-4000-8000-000000001808';  -- second courts admin by invite (deleted later)
  oc uuid := '00000000-0000-4000-8000-000000001809';  -- testville18b community admin
  o1 uuid := '00000000-0000-4000-8000-000000001810';  -- testville18b member
  tz text := 'Asia/Dubai';
  d1 date; v jsonb; k int := 0; i int; n int; msg text; q text; cp int; s text;
  tok text; tok2 text; tok3 text; l_id uuid; l_other uuid; ev uuid; ct uuid; bk1 uuid; h1 uuid; r185 text;
begin
  execute $f$create function pg_temp.s18_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s18_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute 'grant execute on function pg_temp.s18_as(uuid), pg_temp.s18_err(text) to authenticated';
  d1 := (now() at time zone tz)::date + 1;

  -- ---------- fixtures (as postgres) ----------
  insert into auth.users (id, email) values (c1, 'c1@s18.test'), (bk, 'bk@s18.test'), (pt, 'pt@s18.test'),
    (ea, 'ea@s18.test'), (r1, 'r1@s18.test'), (r2, 'r2@s18.test'), (lg, 'lg@s18.test'), (b2, 'b2@s18.test'),
    (oc, 'oc@s18.test'), (o1, 'o1@s18.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville18', 'Testville 18', 24.53, 54.43,
     '{"bookings": {"enabled": true, "per_home_per_day": 1, "per_home_active": 2}, "pets": {"enabled": true}, "events": {"enabled": true}}'),
    ('testville18b', 'Testville 18b', 25.00, 55.00, '{"bookings": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville18', 'north', 'North'), ('testville18b', 'north', 'North');
  perform jc_code_set('testville18', 'join', 'S18-JOIN-CODE-01');
  perform jc_code_set('testville18', 'community', 'S18-COMMUNITY-01');
  perform jc_code_set('testville18', 'bookings', 'S18-BOOKINGS-01');
  perform jc_code_set('testville18b', 'join', 'S18B-JOIN-CODE-01');
  perform jc_code_set('testville18b', 'community', 'S18B-COMMUNITY-01');

  execute 'set local role authenticated';
  perform pg_temp.s18_as(c1); perform jc_join('testville18', 'S18-JOIN-CODE-01'); perform jc_admin_unlock('S18-COMMUNITY-01');
  perform pg_temp.s18_as(bk); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '82');
  perform pg_temp.s18_as(pt); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  perform pg_temp.s18_as(ea); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  perform pg_temp.s18_as(r1); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  h1 := (jc_home_claim('north', 'villa', null, '81') -> 'home' ->> 'id')::uuid;
  perform pg_temp.s18_as(r2); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  perform pg_temp.s18_as(lg); perform jc_join('testville18', 'S18-JOIN-CODE-01'); perform jc_admin_unlock('S18-BOOKINGS-01');
  perform pg_temp.s18_as(b2); perform jc_join('testville18', 'S18-JOIN-CODE-01');
  perform pg_temp.s18_as(oc); perform jc_join('testville18b', 'S18B-JOIN-CODE-01'); perform jc_admin_unlock('S18B-COMMUNITY-01');
  perform pg_temp.s18_as(o1); perform jc_join('testville18b', 'S18B-JOIN-CODE-01');
  execute 'reset role';
  if h1 is null then raise exception 'FAIL setup: no home'; end if;
  update jc_home_members set joined_at = now() - interval '1 day' where user_id = r1;
  insert into jc_events (community_id, slug, title_en, status) values ('testville18', 's18-night', 'S18 night', 'live') returning id into ev;
  insert into jc_event_admins (event_id, user_id, community_id, granted_by) values (ev, ea, 'testville18', c1);
  execute 'set local role authenticated';

  -- ---------- MA01 invite links: community admin only, module scopes only ----------
  foreach q in array array['select jc_module_admin_link_create(''bookings'')', 'select jc_module_admins_list(''bookings'')',
                           format('select jc_module_admin_revoke(''bookings'', %L, null)', r2)] loop
    perform pg_temp.s18_as(r2);  msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA01a resident: % -> %', q, msg; end if;
    perform pg_temp.s18_as(lg);  msg := pg_temp.s18_err(q);   -- the shared bookings code runs courts, appoints nobody
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA01b bookings-code holder: % -> %', q, msg; end if;
    perform pg_temp.s18_as(ea);  msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA01c event admin: % -> %', q, msg; end if;
  end loop;
  perform pg_temp.s18_as(c1);
  -- R4a-3: 'community' and 'events' are now valid scopes (s19); 'join' is never an admin scope
  foreach s in array array['join', 'Bookings', 'Community', 'owner', ''] loop
    if pg_temp.s18_err(format('select jc_module_admin_link_create(%L)', s)) is distinct from 'BAD_SCOPE'
       or pg_temp.s18_err(format('select jc_module_admins_list(%L)', s)) is distinct from 'BAD_SCOPE' then
      raise exception 'FAIL MA01d scope % accepted', s; end if;
  end loop;
  if pg_temp.s18_err('select jc_module_admin_link_create(null)') is distinct from 'BAD_SCOPE' then
    raise exception 'FAIL MA01e null scope accepted'; end if;
  v := jc_module_admin_link_create('bookings');
  tok := v ->> 'token';
  if tok is null or length(tok) < 20 or v ->> 'scope' is distinct from 'bookings'
     or (v ->> 'expires_at')::timestamptz not between now() + interval '71 hours' and now() + interval '73 hours' then
    raise exception 'FAIL MA01f link: %', v; end if;
  execute 'reset role';
  if exists (select 1 from jc_module_admin_links where token_hash = tok)
     or not exists (select 1 from jc_module_admin_links where token_hash = encode(extensions.digest(tok, 'sha256'), 'hex')) then
    raise exception 'FAIL MA01g the token is stored in clear (or not at all)'; end if;
  execute 'set local role authenticated';
  k := k + 7;

  -- ---------- MA02 accept: same community, signed in, single use ----------
  perform pg_temp.s18_as(o1);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA02a another community accepted'; end if;
  perform pg_temp.s18_as(bk);
  if pg_temp.s18_err('select jc_module_admin_accept(''nonsense-token-nonsense'')') is distinct from 'BAD_LINK'
     or pg_temp.s18_err('select jc_module_admin_accept(null)') is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA02b junk / null token'; end if;
  execute 'reset role';   -- signed out: no account, nothing granted
  perform set_config('request.jwt.claims', '', true);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'NOT_SIGNED_IN' then
    raise exception 'FAIL MA02c signed-out accept'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s18_as(bk);
  v := jc_module_admin_accept(tok);
  if v is distinct from '{"scope": "bookings"}'::jsonb then raise exception 'FAIL MA02d accept returned %', v; end if;
  perform pg_temp.s18_as(r2);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA02e link reused'; end if;
  perform pg_temp.s18_as(bk);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA02f link reused by its own redeemer'; end if;
  execute 'reset role';
  if (select count(*) from jc_module_admins where user_id = bk) <> 1
     or not exists (select 1 from jc_module_admins where user_id = bk and scope = 'bookings'
                     and community_id = 'testville18' and granted_by = c1)
     or not exists (select 1 from jc_module_admin_links where used_by = bk and used_at is not null) then
    raise exception 'FAIL MA02g grant / link rows wrong'; end if;
  execute 'set local role authenticated';
  -- pets + a second courts admin
  perform pg_temp.s18_as(c1);
  tok := jc_module_admin_link_create('pets') ->> 'token';
  tok2 := jc_module_admin_link_create('bookings') ->> 'token';
  perform pg_temp.s18_as(pt); v := jc_module_admin_accept(tok);
  if v ->> 'scope' is distinct from 'pets' then raise exception 'FAIL MA02h pets accept: %', v; end if;
  perform pg_temp.s18_as(b2); perform jc_module_admin_accept(tok2);
  k := k + 8;

  -- ---------- MA03 a courts admin by invite runs courts, nothing else ----------
  perform pg_temp.s18_as(bk);
  v := jc_admin_facility_save(null, '{"kind": "tennis", "name_en": "Court 18"}');
  select (x ->> 'id')::uuid into ct from jsonb_array_elements(v) x where x ->> 'name_en' = 'Court 18';
  if ct is null then raise exception 'FAIL MA03a invited courts admin could not create a court: %', v; end if;
  perform jc_admin_facility_status(ct, 'published');
  if jc_admin_booking_rules() is null or jsonb_array_length(jc_admin_facilities_list()) is distinct from 1 then
    raise exception 'FAIL MA03b invited courts admin can''t read courts'; end if;
  foreach q in array array['select jc_admin_pets_list()', 'select jc_admin_events_list()',
                           'select jc_admin_code_rotate(''bookings'')', 'select jc_admin_homes_list()',
                           'select jc_module_admin_link_create(''bookings'')', 'select jc_module_admins_list(''bookings'')',
                           format('select jc_module_admin_revoke(''bookings'', %L, null)', b2)] loop
    msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA03c courts admin: % -> %', q, msg; end if;
  end loop;
  k := k + 3;

  -- ---------- MA04 a pets admin by invite runs pets, not courts ----------
  perform pg_temp.s18_as(pt);
  if jsonb_typeof(jc_admin_pets_list()) is distinct from 'array' then raise exception 'FAIL MA04a pets admin list'; end if;
  foreach q in array array['select jc_admin_facilities_list()', 'select jc_admin_booking_rules()',
                           format('select jc_admin_facility_save(%L, %L)', ct, '{"sort": 2}'),
                           format('select jc_admin_block_create(%L, %L, %L, %L)', ct,
                                  (d1 + 5 + time '08:00') at time zone tz, (d1 + 5 + time '09:00') at time zone tz, 'Nope')] loop
    msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA04b pets admin: % -> %', q, msg; end if;
  end loop;
  execute 'reset role';
  -- the read-only predicate (pet visibility, photo writes) follows the same rule
  perform pg_temp.s18_as(pt);
  if not jc_admin_has('pets') or jc_admin_has('bookings') or jc_admin_has('community') then
    raise exception 'FAIL MA04c jc_admin_has for the pets admin'; end if;
  perform pg_temp.s18_as(bk);
  if not jc_admin_has('bookings') or jc_admin_has('pets') then raise exception 'FAIL MA04d jc_admin_has for the courts admin'; end if;
  perform pg_temp.s18_as(r2);
  if jc_admin_has('bookings') or jc_admin_has('pets') then raise exception 'FAIL MA04e jc_admin_has for a resident'; end if;
  execute 'set local role authenticated';
  k := k + 5;

  -- ---------- MA05 residents and event admins stay out of courts ----------
  foreach q in array array['select jc_admin_facilities_list()', 'select jc_admin_booking_rules()', 'select jc_admin_pets_list()',
                           format('select jc_admin_facility_status(%L, %L)', ct, 'draft')] loop
    perform pg_temp.s18_as(r2); msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA05a resident: % -> %', q, msg; end if;
    perform pg_temp.s18_as(ea); msg := pg_temp.s18_err(q);
    if msg is distinct from 'NOT_ADMIN' then raise exception 'FAIL MA05b event admin: % -> %', q, msg; end if;
  end loop;
  k := k + 2;

  -- ---------- MA06 jc_me_get.admin_scopes: codes + per-person grants, distinct, sorted ----------
  perform pg_temp.s18_as(bk);
  if jc_me_get() -> 'admin_scopes' is distinct from '["bookings"]'::jsonb then raise exception 'FAIL MA06a courts admin scopes: %', jc_me_get() -> 'admin_scopes'; end if;
  perform pg_temp.s18_as(pt);
  if jc_me_get() -> 'admin_scopes' is distinct from '["pets"]'::jsonb then raise exception 'FAIL MA06b pets admin scopes'; end if;
  perform pg_temp.s18_as(r2);
  if jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb then raise exception 'FAIL MA06c resident scopes'; end if;
  -- the code holder also takes an invite: still one "bookings"; a pets invite on top sorts after it
  perform pg_temp.s18_as(c1);
  tok := jc_module_admin_link_create('bookings') ->> 'token';
  tok2 := jc_module_admin_link_create('pets') ->> 'token';
  perform pg_temp.s18_as(lg); perform jc_module_admin_accept(tok); perform jc_module_admin_accept(tok2);
  if jc_me_get() -> 'admin_scopes' is distinct from '["bookings", "pets"]'::jsonb then
    raise exception 'FAIL MA06d code + invite scopes: %', jc_me_get() -> 'admin_scopes'; end if;
  k := k + 4;

  -- ---------- MA07 list: identified like the per-event admin list, no new PII ----------
  perform pg_temp.s18_as(c1);
  v := jc_module_admins_list('bookings');
  if v ->> 'scope' is distinct from 'bookings' or jsonb_array_length(v -> 'admins') is distinct from 3 then
    raise exception 'FAIL MA07a list: %', v; end if;
  select x into v from jsonb_array_elements(jc_module_admins_list('bookings') -> 'admins') x where (x ->> 'user_id')::uuid = bk;
  if v ->> 'name' is distinct from 'b•••@s18.test' or v ->> 'number' is distinct from '82' or v ->> 'village' is distinct from 'north'
     or v ->> 'granted_at' is null or v ->> 'last_used_at' is null then
    raise exception 'FAIL MA07b admin row: %', v; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(v) key)
     is distinct from array['building', 'granted_at', 'idle', 'last_used_at', 'name', 'number', 'type', 'user_id', 'via', 'village'] then   -- R4a-3: + idle, via
    raise exception 'FAIL MA07c admin row keys: %', v; end if;
  if jc_module_admins_list('bookings')::text like '%bk@s18.test%' then raise exception 'FAIL MA07d full email listed'; end if;
  v := jc_module_admins_list('pets');
  if jsonb_array_length(v -> 'admins') is distinct from 2 or jsonb_array_length(v -> 'links') is distinct from 0 then
    raise exception 'FAIL MA07e pets list: %', v; end if;
  k := k + 5;

  -- ---------- MA08 expiry, link revoke, the 10-link cap ----------
  tok := jc_module_admin_link_create('bookings') ->> 'token';
  tok2 := jc_module_admin_link_create('bookings') ->> 'token';
  tok3 := jc_module_admin_link_create('bookings') ->> 'token';
  execute 'reset role';
  update jc_module_admin_links set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(tok, 'sha256'), 'hex');
  select id into l_id from jc_module_admin_links where token_hash = encode(extensions.digest(tok2, 'sha256'), 'hex');
  execute 'set local role authenticated';
  perform pg_temp.s18_as(c1);
  if jsonb_array_length(jc_module_admins_list('bookings') -> 'links') is distinct from 2 then raise exception 'FAIL MA08a expired link listed'; end if;
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''bookings'', %L, %L)', r2, l_id)) is distinct from 'BAD_FIELDS'
     or pg_temp.s18_err('select jc_module_admin_revoke(''bookings'', null, null)') is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL MA08b both / neither of user and link'; end if;
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''pets'', null, %L)', l_id)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA08c a bookings link revoked under pets'; end if;
  v := jc_module_admin_revoke('bookings', null, l_id);
  if jsonb_array_length(v -> 'links') is distinct from 1 then raise exception 'FAIL MA08d revoked link still listed: %', v -> 'links'; end if;
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''bookings'', null, %L)', l_id)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA08e a link revoked twice'; end if;
  perform pg_temp.s18_as(r2);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA08f expired link accepted'; end if;
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok2)) is distinct from 'BAD_LINK' then
    raise exception 'FAIL MA08g revoked link accepted'; end if;
  if jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb then raise exception 'FAIL MA08h a refused link granted something'; end if;
  -- at most 10 open links per community + scope (1 open now: tok3)
  perform pg_temp.s18_as(c1);
  -- someone who already holds the scope can't burn a link: ALREADY_ADMIN, the link stays open (2 open now)
  tok := jc_module_admin_link_create('bookings') ->> 'token';
  perform pg_temp.s18_as(bk);
  if pg_temp.s18_err(format('select jc_module_admin_accept(%L)', tok)) is distinct from 'ALREADY_ADMIN' then
    raise exception 'FAIL MA08k accept by a current admin'; end if;
  perform pg_temp.s18_as(c1);
  if jsonb_array_length(jc_module_admins_list('bookings') -> 'links') is distinct from 2 then
    raise exception 'FAIL MA08l the refused accept consumed the link'; end if;
  for i in 1..8 loop perform jc_module_admin_link_create('bookings'); end loop;
  if pg_temp.s18_err('select jc_module_admin_link_create(''bookings'')') is distinct from 'TOO_MANY_LINKS' then
    raise exception 'FAIL MA08i 11th open link'; end if;
  if jc_module_admin_link_create('pets') ->> 'token' is null then raise exception 'FAIL MA08j the cap leaked across scopes'; end if;
  k := k + 12;

  -- ---------- MA09 cross-community: another community's admin sees and touches nothing ----------
  execute 'reset role';
  select id into l_id from jc_module_admin_links where token_hash = encode(extensions.digest(tok3, 'sha256'), 'hex');
  execute 'set local role authenticated';
  perform pg_temp.s18_as(oc);
  v := jc_module_admins_list('bookings');
  if jsonb_array_length(v -> 'admins') is distinct from 0 or jsonb_array_length(v -> 'links') is distinct from 0 then
    raise exception 'FAIL MA09a cross-community list: %', v; end if;
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''bookings'', %L, null)', bk)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA09b revoked another community''s admin'; end if;
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''bookings'', null, %L)', l_id)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA09c revoked another community''s link'; end if;
  perform pg_temp.s18_as(c1);
  if pg_temp.s18_err(format('select jc_module_admin_revoke(''bookings'', %L, null)', r2)) is distinct from 'NOT_FOUND'
     or pg_temp.s18_err(format('select jc_module_admin_revoke(''pets'', %L, null)', bk)) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA09d revoked a grant that isn''t there'; end if;
  perform pg_temp.s18_as(bk);
  if jsonb_array_length(jc_admin_facilities_list()) is distinct from 1 then raise exception 'FAIL MA09e the failed revokes touched bk'; end if;
  -- an invited admin of testville18b is not ours: o1 takes a 18b courts invite
  perform pg_temp.s18_as(oc); tok := jc_module_admin_link_create('bookings') ->> 'token';
  perform pg_temp.s18_as(o1); perform jc_module_admin_accept(tok);
  if jsonb_array_length(jc_admin_facilities_list()) is distinct from 0 then raise exception 'FAIL MA09f 18b admin sees our courts'; end if;
  if pg_temp.s18_err(format('select jc_admin_facility_status(%L, %L)', ct, 'draft')) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL MA09g 18b admin touched our court'; end if;
  k := k + 7;

  -- ---------- MA10 revoking a person: access ends immediately ----------
  perform pg_temp.s18_as(c1);
  v := jc_module_admin_revoke('bookings', bk, null);
  if exists (select 1 from jsonb_array_elements(v -> 'admins') x where (x ->> 'user_id')::uuid = bk) then
    raise exception 'FAIL MA10a revoked admin still listed'; end if;
  perform pg_temp.s18_as(bk);
  if pg_temp.s18_err('select jc_admin_facilities_list()') is distinct from 'NOT_ADMIN'
     or pg_temp.s18_err(format('select jc_admin_facility_status(%L, %L)', ct, 'draft')) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL MA10b revoked admin kept access'; end if;
  if jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb then raise exception 'FAIL MA10c revoked admin still shows a scope'; end if;
  execute 'reset role';
  perform pg_temp.s18_as(bk);
  if jc_admin_has('bookings') then raise exception 'FAIL MA10d jc_admin_has after revoke'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- MA11 the shared codes keep working, and rotation leaves invited admins alone ----------
  perform pg_temp.s18_as(c1);
  if jsonb_array_length(jc_admin_facilities_list()) is distinct from 1 then raise exception 'FAIL MA11a community code lost courts'; end if;
  execute 'reset role';
  delete from jc_module_admins where user_id = lg;   -- lg back to "code only"
  execute 'set local role authenticated';
  perform pg_temp.s18_as(lg);
  if jsonb_array_length(jc_admin_facilities_list()) is distinct from 1 then raise exception 'FAIL MA11b bookings code lost courts'; end if;
  perform pg_temp.s18_as(c1); perform jc_admin_code_rotate('bookings');
  perform pg_temp.s18_as(lg);
  if pg_temp.s18_err('select jc_admin_facilities_list()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL MA11c rotation did not end the old code'; end if;
  perform pg_temp.s18_as(b2);
  if jsonb_array_length(jc_admin_facilities_list()) is distinct from 1 then raise exception 'FAIL MA11d rotation dropped an invited admin'; end if;
  -- "lock" on a device (jc_admin_exit) drops code unlocks, not the appointment
  perform pg_temp.s18_as(pt); perform jc_admin_exit();
  if jsonb_typeof(jc_admin_pets_list()) is distinct from 'array' then raise exception 'FAIL MA11e exit dropped the pets grant'; end if;
  k := k + 5;

  -- ---------- MA12 the audit log, gone with the account, 'community' can't be granted, snapshots count them ----------
  execute 'reset role';
  if (select count(*) from jc_admin_log where community_id = 'testville18' and action = 'module_admin_link') is distinct from 18::bigint
     or not exists (select 1 from jc_admin_log where community_id = 'testville18' and action = 'module_admin_accept'
                     and actor = bk and target ->> 'scope' = 'bookings')
     or not exists (select 1 from jc_admin_log where community_id = 'testville18' and action = 'module_admin_revoke'
                     and actor = c1 and (target ->> 'user_id')::uuid = bk) then
    raise exception 'FAIL MA12a audit log'; end if;
  if exists (select 1 from jc_admin_log l, jsonb_object_keys(l.target) key
              where l.action like 'module_admin%' and key not in ('scope', 'link_id', 'user_id', 'code_unlock_removed', 'grant_removed',
                                 'links_cancelled', 'expires_at')) then   -- R4a-3: + these
    raise exception 'FAIL MA12b the log holds more than scope / link / user (a token?)'; end if;
  delete from auth.users where id = b2;
  if exists (select 1 from jc_module_admins where user_id = b2) then raise exception 'FAIL MA12c grant outlived the account'; end if;
  begin
    insert into jc_module_admins (user_id, community_id, scope) values (r2, 'testville18', 'join');   -- R4a-3: community is now valid
    msg := null;
  exception when check_violation then msg := 'check';
  end;
  if msg is distinct from 'check' then raise exception 'FAIL MA12d a per-person join grant was stored'; end if;
  begin
    insert into jc_module_admins (user_id, community_id, scope) values (o1, 'testville18', 'pets');
    msg := null;
  exception when foreign_key_violation then msg := 'fk';
  end;
  if msg is distinct from 'fk' then raise exception 'FAIL MA12e a grant outside the member''s community was stored'; end if;
  perform jc_snapshot_run(now());
  if (select (metrics ->> 'admins')::int from jc_snapshots
       where community_id = 'testville18b' and module = 'accounts' and bucket = date_trunc('hour', now())) is distinct from 2 then
    raise exception 'FAIL MA12f snapshot admins (code + invite) for 18b'; end if;
  -- testville18: c1 + lg (code grants) + pt (invite) — bk revoked, b2 deleted
  if (select (metrics ->> 'admins')::int from jc_snapshots
       where community_id = 'testville18' and module = 'accounts' and bucket = date_trunc('hour', now())) is distinct from 3 then
    raise exception 'FAIL MA12g snapshot admins for 18'; end if;
  execute 'set local role authenticated';
  k := k + 7;

  -- ---------- MA13 removing a member ends their appointment (security review M1) ----------
  perform pg_temp.s18_as(c1);
  perform jc_admin_member_remove(pt, false);
  perform pg_temp.s18_as(pt);
  if pg_temp.s18_err('select jc_admin_pets_list()') is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL MA13a a removed member kept pets admin'; end if;
  if jc_me_get() -> 'admin_scopes' is distinct from '[]'::jsonb then raise exception 'FAIL MA13b removed member scopes'; end if;
  execute 'reset role';
  if not exists (select 1 from jc_admin_log where community_id = 'testville18' and action = 'member_remove'
                  and (target ->> 'user_id')::uuid = pt and target -> 'module_admin_removed' = '["pets"]'::jsonb) then
    raise exception 'FAIL MA13c member_remove log'; end if;
  execute 'set local role authenticated';
  k := k + 3;

  -- ---------- BD01 bidi controls: jc_clean_line strips every one; plain and Arabic text unchanged ----------
  execute 'reset role';   -- an internal helper (no member grant)
  foreach cp in array array[8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297, 8206, 8207, 1564, 8203, 8204, 8205, 8232, 8233, 65279] loop
    if jc_clean_line('Ab' || chr(cp) || 'cd') is distinct from 'Abcd' then
      raise exception 'FAIL BD01a U+% survives jc_clean_line', upper(to_hex(cp)); end if;
  end loop;
  if jc_clean_line('Court 1 — net') is distinct from 'Court 1 — net'
     or jc_clean_line('ملعب التنس') is distinct from 'ملعب التنس'
     or jc_clean_line('  Nets ' || chr(8238) || ' ') is distinct from 'Nets'
     or jc_clean_line(chr(8238) || chr(8294) || chr(8207)) is not null then
    raise exception 'FAIL BD01b ordinary / Arabic / bidi-only text'; end if;
  execute 'set local role authenticated';
  k := k + 2;

  -- ---------- BD02 the existing callers store the cleaned text ----------
  perform pg_temp.s18_as(c1);
  v := jc_admin_facility_save(null, jsonb_build_object('kind', 'basketball', 'name_en', 'Ho' || chr(8238) || 'ops'));
  if not exists (select 1 from jsonb_array_elements(v) x where x ->> 'name_en' = 'Hoops') then
    raise exception 'FAIL BD02a facility name kept a bidi control: %', v; end if;
  if pg_temp.s18_err(format('select jc_admin_block_create(%L, %L, %L, %L)', ct,
       (d1 + 6 + time '08:00') at time zone tz, (d1 + 6 + time '09:00') at time zone tz, 'a' || chr(8238) || chr(8294) || 'b'))
     is distinct from 'REASON_REQUIRED' then
    raise exception 'FAIL BD02b a 2-char reason padded with bidi controls passed'; end if;
  perform jc_admin_block_create(ct, (d1 + 6 + time '08:00') at time zone tz, (d1 + 6 + time '09:00') at time zone tz,
                                'Re' || chr(8237) || 'surf' || chr(8207) || 'acing');
  execute 'reset role';
  if not exists (select 1 from jc_booking_blocks where facility_id = ct and reason = 'Resurfacing') then
    raise exception 'FAIL BD02c block reason kept a bidi control'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s18_as(r1);
  perform jc_pet_save(null, jsonb_build_object('species', 'cat', 'name', 'Mi' || chr(8297) || 'lo' || chr(1564)));
  execute 'reset role';
  if not exists (select 1 from jc_pets where home_id = h1 and name = 'Milo') then
    raise exception 'FAIL BD02d pet name kept a bidi control'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- RC01 block reasons: 3–185, so the copied cancel reason is whole ----------
  perform pg_temp.s18_as(r1);
  bk1 := (jc_booking_book(ct, (d1 + time '09:00') at time zone tz, false) ->> 'booking_id')::uuid;
  execute 'reset role';
  if bk1 is null then select id into bk1 from jc_bookings where facility_id = ct and home_id = h1 and status = 'booked'; end if;
  execute 'set local role authenticated';
  if bk1 is null then raise exception 'FAIL RC01a setup: no booking'; end if;
  r185 := rpad('Tournament day ', 185, 'x');
  perform pg_temp.s18_as(c1);
  foreach n in array array[186, 200] loop
    if pg_temp.s18_err(format('select jc_admin_block_create(%L, %L, %L, %L)', ct,
         (d1 + time '08:00') at time zone tz, (d1 + time '10:00') at time zone tz, rpad('Long reason ', n, 'y')))
       is distinct from 'REASON_REQUIRED' then
      raise exception 'FAIL RC01b a % char block reason passed', n; end if;
  end loop;
  v := jc_admin_block_create(ct, (d1 + time '08:00') at time zone tz, (d1 + time '10:00') at time zone tz, r185);
  if (v ->> 'bookings_cancelled')::int <> 1 then raise exception 'FAIL RC01c the 185-char block cancelled %', v; end if;
  execute 'reset role';
  if (select cancel_reason from jc_bookings where id = bk1) is distinct from 'Court blocked: ' || r185
     or char_length('Court blocked: ' || r185) <> 200 then
    raise exception 'FAIL RC01d cancel reason not whole: %', (select cancel_reason from jc_bookings where id = bk1); end if;
  execute 'set local role authenticated';
  -- a direct admin cancel has no prefix and keeps 3–200
  perform pg_temp.s18_as(r1);
  perform jc_booking_book(ct, (d1 + 1 + time '11:00') at time zone tz, false);
  execute 'reset role';
  select id into bk1 from jc_bookings where facility_id = ct and home_id = h1 and status = 'booked';
  execute 'set local role authenticated';
  perform pg_temp.s18_as(c1);
  perform jc_admin_booking_cancel(bk1, rpad('Admin cancel ', 200, 'z'));
  execute 'reset role';
  if (select char_length(cancel_reason) from jc_bookings where id = bk1) is distinct from 200 then
    raise exception 'FAIL RC01e a 200-char admin cancel reason'; end if;
  k := k + 5;

  -- ---------- G01 the new functions: members only, definer, pinned ----------
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('jc_module_admin_link_create', 'jc_module_admin_accept', 'jc_module_admins_list', 'jc_module_admin_revoke')
        and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        and p.prosecdef and 'search_path=public, pg_temp' = any(p.proconfig)) <> 4 then
    raise exception 'FAIL G01a module-admin RPC grants / definer / search_path'; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jc\_module\_admin%') <> 4 then
    raise exception 'FAIL G01b an extra overload / function'; end if;
  if has_function_privilege('authenticated', 'public.jc_assert_admin(text)', 'execute')
     or has_function_privilege('authenticated', 'public.jc_admin_has(text)', 'execute') then
    raise exception 'FAIL G01c a gate became callable'; end if;
  -- jc_admin_has backs read-only visibility predicates: it must stay STABLE (no last_used_at write) and definer
  if (select provolatile::text || prosecdef::text from pg_proc where oid = 'public.jc_admin_has(text)'::regprocedure) is distinct from 'strue' then
    raise exception 'FAIL G01d jc_admin_has is no longer stable / definer'; end if;
  k := k + 4;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's18_module_admins: % checks passed', k;
end
$t$;
