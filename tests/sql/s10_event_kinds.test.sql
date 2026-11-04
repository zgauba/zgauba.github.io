-- T5.2 PR 3b — event kinds (homes / venue), looks, venue, capacity (households), spots.
-- Venue events: no home pin needed, residents see a count not the homes, FULL at capacity
-- (re-join counts as new, an update doesn't), spots unique + freed on withdraw / spots off,
-- kind fixed once anyone signs up, publish needs the venue. Own communities (testville10 /
-- testville10b) — never jubail. Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001001';  -- community admin (organizer)
  ea uuid := '00000000-0000-4000-8000-000000001002';  -- event admin of the market
  eb uuid := '00000000-0000-4000-8000-000000001003';  -- event admin of the homes event only
  r1 uuid := '00000000-0000-4000-8000-000000001004';  -- resident, home pinned
  r2 uuid := '00000000-0000-4000-8000-000000001005';  -- resident, home pinned
  r3 uuid := '00000000-0000-4000-8000-000000001006';  -- resident, home NOT pinned
  o1 uuid := '00000000-0000-4000-8000-000000001007';  -- testville10b community admin
  ev_m uuid; ev_h uuid; ev_g uuid; en1 uuid; en2 uuid; en3 uuid;
  v jsonb; k int := 0;
begin
  -- ---------- helpers (temp, dropped with the transaction) ----------
  execute $f$create function pg_temp.s10_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s10_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s10_ev(l jsonb, s text) returns uuid language sql as
    $b$ select (e ->> 'id')::uuid from jsonb_array_elements(l) e where e ->> 'slug' = s $b$$f$;
  execute 'grant execute on function pg_temp.s10_as(uuid), pg_temp.s10_err(text), pg_temp.s10_ev(jsonb, text) to authenticated';

  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values
    (c1, 'c1@s10.test'), (ea, 'ea@s10.test'), (eb, 'eb@s10.test'), (r1, 'r1@s10.test'),
    (r2, 'r2@s10.test'), (r3, 'r3@s10.test'), (o1, 'o1@s10.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville10', 'Testville 10', 24.53, 54.43, '{"events": {"enabled": true}}'),
    ('testville10b', 'Testville 10b', 25.00, 55.00, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville10', 'north', 'North'), ('testville10b', 'north', 'North');
  perform jc_code_set('testville10', 'join', 'S10-JOIN-CODE-01');
  perform jc_code_set('testville10', 'community', 'S10-COMMUNITY-01');
  perform jc_code_set('testville10b', 'join', 'S10B-JOIN-CODE-01');
  perform jc_code_set('testville10b', 'community', 'S10B-COMMUNITY-01');

  execute 'set local role authenticated';
  perform pg_temp.s10_as(c1); perform jc_join('testville10', 'S10-JOIN-CODE-01'); perform jc_admin_unlock('S10-COMMUNITY-01');
  perform pg_temp.s10_as(ea); perform jc_join('testville10', 'S10-JOIN-CODE-01');
  perform pg_temp.s10_as(eb); perform jc_join('testville10', 'S10-JOIN-CODE-01');
  perform pg_temp.s10_as(r1); perform jc_join('testville10', 'S10-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '1'); perform jc_home_pin_set(24.5310, 54.4310);
  perform pg_temp.s10_as(r2); perform jc_join('testville10', 'S10-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '2'); perform jc_home_pin_set(24.5320, 54.4320);
  perform pg_temp.s10_as(r3); perform jc_join('testville10', 'S10-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '3');                       -- no pin
  perform pg_temp.s10_as(o1); perform jc_join('testville10b', 'S10B-JOIN-CODE-01'); perform jc_admin_unlock('S10B-COMMUNITY-01');

  -- ---------- R01 defaults: a new event is a homes event with the plain look ----------
  perform pg_temp.s10_as(c1);
  v := jc_admin_event_save(null, '{"slug": "street-night", "title_en": "Street night"}');
  ev_h := pg_temp.s10_ev(v, 'street-night');
  execute 'reset role';
  if (select kind || '/' || look from jc_events where id = ev_h) <> 'homes/plain' then raise exception 'FAIL R01a defaults'; end if;
  execute 'set local role authenticated';
  -- venue fields on a homes event are a client bug: refused, not silently dropped (review L4)
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_h, '{"capacity": 5}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R01b homes event took a capacity'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_h, '{"capacity": null, "spots": false, "venue_name_en": ""}')) is not null then
    raise exception 'FAIL R01c homes event refused empty venue fields'; end if;
  k := k + 3;

  -- ---------- R02 save: a market (venue) — validation ----------
  v := jc_admin_event_save(null, '{"slug": "market", "title_en": "Market", "kind": "venue", "look": "market"}');
  ev_m := pg_temp.s10_ev(v, 'market');
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"look": "disco"}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02a unknown look'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"kind": "boat"}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02b unknown kind'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"capacity": "5"}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02c capacity as a string'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"capacity": 2.5}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02d fractional capacity'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"capacity": 0}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02e zero capacity'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"capacity": 99999999999}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02f huge capacity'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"spots": "yes"}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02g spots as a string'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"venue_lat": 24.53}')) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02h half a pin'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"venue_lat": 25.5, "venue_lng": 55.5}')) is distinct from 'BAD_PIN' then
    raise exception 'FAIL R02i venue outside the community'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m,
       json_build_object('venue_name_en', repeat('x', 121))::text)) is distinct from 'BAD_FIELDS' then
    raise exception 'FAIL R02j venue name too long'; end if;
  k := k + 10;

  -- ---------- R03 publish needs the place ----------
  if pg_temp.s10_err(format('select jc_admin_event_publish(%L)', ev_m)) is distinct from 'NO_VENUE' then
    raise exception 'FAIL R03a published without a venue'; end if;
  perform jc_admin_event_save(ev_m, '{"venue_name_en": "  Central Park  ", "venue_lat": 24.5305, "venue_lng": 54.4305, "capacity": 2}');
  execute 'reset role';
  if (select venue_name_en from jc_events where id = ev_m) <> 'Central Park' then raise exception 'FAIL R03b name not cleaned'; end if;
  execute 'set local role authenticated';
  perform jc_admin_event_publish(ev_m);
  perform jc_admin_event_publish(ev_h);
  execute 'reset role';
  if (select status from jc_events where id = ev_m) <> 'live' then raise exception 'FAIL R03c not live'; end if;
  execute 'set local role authenticated';
  -- a live one-place event keeps its place (reviews M1)
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"venue_name_en": ""}')) is distinct from 'NO_VENUE' then
    raise exception 'FAIL R03d live venue lost its name'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"venue_lat": null, "venue_lng": null}')) is distinct from 'NO_VENUE' then
    raise exception 'FAIL R03e live venue lost its pin'; end if;
  -- one coordinate at a time can't walk the venue out of the community (DB review M2)
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"venue_lng": 80}')) is distinct from 'BAD_PIN' then
    raise exception 'FAIL R03f one-coordinate edit dodged the 10 km rule'; end if;
  -- a live homes event (nobody in yet) can't become a place-less venue
  v := jc_admin_event_save(null, '{"slug": "quiz", "title_en": "Quiz"}');
  ev_g := pg_temp.s10_ev(v, 'quiz');
  perform jc_admin_event_publish(ev_g);
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_g, '{"kind": "venue"}')) is distinct from 'NO_VENUE' then
    raise exception 'FAIL R03g live homes → venue without a place'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_g, '{"kind": "venue", "venue_name_en": "Hall", "venue_lat": 24.531, "venue_lng": 54.431}')) is not null then
    raise exception 'FAIL R03h live homes → venue with a place'; end if;
  k := k + 8;

  -- event admins (as postgres: the grant-link flow is s9's job)
  execute 'reset role';
  insert into jc_event_admins (event_id, user_id, community_id) values (ev_m, ea, 'testville10'), (ev_h, eb, 'testville10');
  execute 'set local role authenticated';

  -- ---------- R04 pins: a venue needs none; a homes event still does ----------
  perform pg_temp.s10_as(r3);
  if pg_temp.s10_err(format('select jc_event_signup(%L, %L)', ev_h, '{}')) is distinct from 'NO_PIN' then
    raise exception 'FAIL R04a homes event without a pin'; end if;
  v := jc_event_signup(ev_m, '{}');
  if v -> 'mine' ->> 'status' <> 'in' then raise exception 'FAIL R04b venue sign-up without a pin'; end if;
  k := k + 2;

  -- ---------- R05 capacity (households): r3 + r1 fill 2; r2 is FULL ----------
  perform pg_temp.s10_as(r1); perform jc_event_signup(ev_m, '{}');
  perform pg_temp.s10_as(r2);
  if pg_temp.s10_err(format('select jc_event_signup(%L, %L)', ev_m, '{}')) is distinct from 'FULL' then
    raise exception 'FAIL R05a over capacity'; end if;
  perform pg_temp.s10_as(r1);
  if pg_temp.s10_err(format('select jc_event_signup(%L, %L)', ev_m, '{"note": "bringing chairs"}')) is not null then
    raise exception 'FAIL R05b updating my sign-up at capacity'; end if;
  perform jc_entry_withdraw(ev_m);
  perform pg_temp.s10_as(r2); perform jc_event_signup(ev_m, '{}');                 -- the freed place
  perform pg_temp.s10_as(r1);
  if pg_temp.s10_err(format('select jc_event_signup(%L, %L)', ev_m, '{}')) is distinct from 'FULL' then
    raise exception 'FAIL R05c re-join took a place that was gone'; end if;
  -- a hidden sign-up still holds its place
  execute 'reset role';
  update jc_event_entries set hidden = true where event_id = ev_m and home_id = (select home_id from jc_home_members where user_id = r2);
  execute 'set local role authenticated';
  perform pg_temp.s10_as(r1);
  if pg_temp.s10_err(format('select jc_event_signup(%L, %L)', ev_m, '{}')) is distinct from 'FULL' then
    raise exception 'FAIL R05d hidden entry freed a place'; end if;
  perform pg_temp.s10_as(ea);   -- capacity can't go under the households already in (security M2)
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"capacity": 1}')) is distinct from 'CAPACITY_BELOW' then
    raise exception 'FAIL R05e capacity under the sign-ups'; end if;
  k := k + 5;

  -- ---------- R06 residents see how many, never which ----------
  perform pg_temp.s10_as(r3);
  v := jc_event_get(ev_m);
  if jsonb_array_length(v -> 'entries') <> 0 then raise exception 'FAIL R06a venue listed homes'; end if;
  if (v -> 'event' ->> 'households_in')::int <> 2 or (v -> 'event' ->> 'places_left')::int <> 0
     or v -> 'event' ->> 'kind' <> 'venue' or v -> 'event' ->> 'venue_name_en' <> 'Central Park' then
    raise exception 'FAIL R06b counts / venue: %', v -> 'event'; end if;
  if (select e ->> 'full' from jsonb_array_elements(jc_events_list()) e where e ->> 'slug' = 'market') <> 'true' then
    raise exception 'FAIL R06c list not full'; end if;
  perform pg_temp.s10_as(r1); perform jc_event_signup(ev_h, '{}');
  perform pg_temp.s10_as(r2); perform jc_event_signup(ev_h, '{}');
  if jsonb_array_length(jc_event_get(ev_h) -> 'entries') <> 2 then raise exception 'FAIL R06d homes map lost entries'; end if;
  perform pg_temp.s10_as(ea);   -- the market's admin still sees who
  if jsonb_array_length(jc_admin_entries_list(ev_m)) <> 3 then raise exception 'FAIL R06e admin list'; end if;
  k := k + 5;

  -- ---------- R07 the kind is fixed once anyone has signed up ----------
  perform pg_temp.s10_as(c1);
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"kind": "homes"}')) is distinct from 'KIND_LOCKED' then
    raise exception 'FAIL R07a kind changed with sign-ups'; end if;
  if pg_temp.s10_err(format('select jc_admin_event_save(%L, %L)', ev_m, '{"kind": "venue", "capacity": 3}')) is not null then
    raise exception 'FAIL R07b same kind refused'; end if;
  k := k + 2;

  -- ---------- R08 spots ----------
  execute 'reset role';
  select id into en1 from jc_event_entries where event_id = ev_m and home_id = (select home_id from jc_home_members where user_id = r1);
  select id into en2 from jc_event_entries where event_id = ev_m and home_id = (select home_id from jc_home_members where user_id = r2);
  select id into en3 from jc_event_entries where event_id = ev_m and home_id = (select home_id from jc_home_members where user_id = r3);
  execute 'set local role authenticated';
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en3, 'A1')) is distinct from 'BAD_STATE' then
    raise exception 'FAIL R08a spot on an event without spots'; end if;
  perform jc_admin_event_save(ev_m, '{"spots": true}');
  perform pg_temp.s10_as(r3);
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en3, 'A1')) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL R08b resident set a spot'; end if;
  perform pg_temp.s10_as(eb);
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en3, 'A1')) is distinct from 'NOT_ADMIN' then
    raise exception 'FAIL R08c another event''s admin set a spot'; end if;
  perform pg_temp.s10_as(o1);
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en3, 'A1')) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL R08d another community''s admin set a spot'; end if;
  perform pg_temp.s10_as(ea);
  perform jc_admin_entry_spot_set(en3, ' a1 ');
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en2, 'A1')) is distinct from 'SPOT_TAKEN' then
    raise exception 'FAIL R08e two households, one spot (a1 = A1)'; end if;
  -- (stripped to A1 → taken, or kept → not a plain spot: either way never a second "A1")
  if coalesce(pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en2, 'A1' || chr(8203))), 'ok') not in ('SPOT_TAKEN', 'BAD_SPOT') then
    raise exception 'FAIL R08e2 zero-width twin of a taken spot'; end if;
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en2, 'A1!')) is distinct from 'BAD_SPOT' then
    raise exception 'FAIL R08e3 punctuation in a spot'; end if;
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en2, repeat('9', 13))) is distinct from 'BAD_SPOT' then
    raise exception 'FAIL R08f spot too long'; end if;
  perform jc_admin_entry_spot_set(en2, 'B2');
  perform pg_temp.s10_as(r3);
  if jc_event_get(ev_m) -> 'mine' ->> 'spot' <> 'A1' then raise exception 'FAIL R08g my spot not shown'; end if;
  perform jc_entry_withdraw(ev_m);
  execute 'reset role';
  if (select spot from jc_event_entries where id = en3) is not null then raise exception 'FAIL R08h withdraw kept the spot'; end if;
  execute 'set local role authenticated';
  perform pg_temp.s10_as(ea);
  if pg_temp.s10_err(format('select jc_admin_entry_spot_set(%L, %L)', en1, 'A1')) is distinct from 'NOT_FOUND' then
    raise exception 'FAIL R08i withdrawn entry got a spot'; end if;
  k := k + 11;

  -- ---------- R09 spots off frees them; switching kinds clears venue fields (no sign-ups) ----------
  perform pg_temp.s10_as(c1);
  perform jc_admin_event_save(ev_m, '{"spots": false}');
  execute 'reset role';
  if exists (select 1 from jc_event_entries where event_id = ev_m and spot is not null) then
    raise exception 'FAIL R09a spots off kept spots'; end if;
  execute 'set local role authenticated';
  v := jc_admin_event_save(null, '{"slug": "picnic", "title_en": "Picnic", "kind": "venue", "venue_name_en": "Beach", "capacity": 40}');
  ev_g := pg_temp.s10_ev(v, 'picnic');
  perform jc_admin_event_save(ev_g, '{"kind": "homes"}');
  execute 'reset role';
  if exists (select 1 from jc_events where id = ev_g and (kind <> 'homes' or venue_name_en is not null or capacity is not null)) then
    raise exception 'FAIL R09b switching to homes kept venue fields'; end if;
  if (select count(*) from jc_admin_log where community_id = 'testville10' and action = 'entry_spot_set') <> 2 then
    raise exception 'FAIL R09c spot changes not logged'; end if;
  if (select l.target -> 'was' ->> 'capacity' from jc_admin_log l
       where l.community_id = 'testville10' and l.action = 'event_save' and l.target ->> 'event_id' = ev_m::text
         and l.target -> 'fields' ? 'spots' order by l.id desc limit 1) <> '3' then
    raise exception 'FAIL R09d save log lacks the old values'; end if;
  execute 'set local role authenticated';
  k := k + 4;

  -- ---------- R10 stats: a venue says how many, never where from (security M1) ----------
  execute 'reset role';   -- r2's sign-up visible again, so there IS a village to leak
  update jc_event_entries set hidden = false where id = en2;
  execute 'set local role authenticated';
  perform pg_temp.s10_as(r2);
  v := jc_event_stats_get(ev_m);
  if (v ->> 'homes')::int <> 1 then raise exception 'FAIL R10a0 setup: %', v; end if;
  if v -> 'by_village' <> '{}'::jsonb or v -> 'by_type' <> '{}'::jsonb then raise exception 'FAIL R10a live venue stats by village: %', v; end if;
  if (jc_event_stats_get(ev_h) -> 'by_village' ->> 'north')::int <> 2 then raise exception 'FAIL R10b homes stats lost villages'; end if;
  perform pg_temp.s10_as(c1);
  perform jc_event_close(ev_m, 'market');
  perform pg_temp.s10_as(r2);
  v := jc_event_get(ev_m) -> 'stats';
  if v -> 'by_village' <> '{}'::jsonb or v -> 'by_type' <> '{}'::jsonb then raise exception 'FAIL R10c archived venue stats by village: %', v; end if;
  k := k + 4;
  execute 'reset role';   -- the role outlives this block: hand the next slice a clean session

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's10_event_kinds: % checks passed', k;
end
$t$;
