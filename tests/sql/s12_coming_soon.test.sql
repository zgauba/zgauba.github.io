-- T5.4 behaviour tests: "coming soon" — announce a draft (title only), residents see it but can't
-- sign up, saving may leave a one-place event's place empty, opening sign-ups checks the place and
-- ends coming soon. Own community (testville12). Run via tests/sql/build_dryrun.sh (rolls back).

do $t$
declare
  c1 uuid := '00000000-0000-4000-8000-000000001201';  -- organizer (community code)
  r1 uuid := '00000000-0000-4000-8000-000000001202';  -- resident, pinned home
  v jsonb; v_err text; k int := 0; ev_v uuid; ev_h uuid;
begin
  execute $f$create function pg_temp.s12_as(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$$f$;
  execute $f$create function pg_temp.s12_err(q text) returns text language plpgsql as
    $b$ begin execute q; return null; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.s12_ev(l jsonb, s text) returns jsonb language sql as
    $b$ select e from jsonb_array_elements(l) e where e ->> 'slug' = s $b$$f$;
  execute 'grant execute on function pg_temp.s12_as(uuid), pg_temp.s12_err(text), pg_temp.s12_ev(jsonb, text) to authenticated';

  insert into auth.users (id, email) values (c1, 'c1@s12.test'), (r1, 'r1@s12.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules) values
    ('testville12', 'Testville 12', 24.53, 54.43, '{"events": {"enabled": true}}');
  insert into jc_villages (community_id, key, name_en) values ('testville12', 'north', 'North');
  perform jc_code_set('testville12', 'join', 'S12-JOIN-CODE-01');
  perform jc_code_set('testville12', 'community', 'S12-COMMUNITY-01');

  execute 'set local role authenticated';
  perform pg_temp.s12_as(c1); perform jc_join('testville12', 'S12-JOIN-CODE-01'); perform jc_admin_unlock('S12-COMMUNITY-01');
  perform pg_temp.s12_as(r1); perform jc_join('testville12', 'S12-JOIN-CODE-01');
  perform jc_home_claim('north', 'villa', null, '1'); perform jc_home_pin_set(24.5301, 54.4301);

  -- a one-place draft with no place yet, and a homes draft
  perform pg_temp.s12_as(c1);
  v := jc_admin_event_save(null, '{"slug": "picnic", "title_en": "Picnic", "kind": "venue"}');
  ev_v := (pg_temp.s12_ev(v, 'picnic') ->> 'id')::uuid;
  v := jc_admin_event_save(null, '{"slug": "lights", "title_en": "Holiday lights"}');
  ev_h := (pg_temp.s12_ev(v, 'lights') ->> 'id')::uuid;

  -- ---------- C01 announce: live, sign-ups closed, coming soon — no place needed ----------
  v := pg_temp.s12_ev(jc_admin_event_announce(ev_v), 'picnic');
  if v ->> 'status' <> 'live' or (v ->> 'signups_open')::boolean or not (v ->> 'coming_soon')::boolean then
    raise exception 'FAIL C01 announce: %', v; end if;
  k := k + 1;

  -- ---------- C02 residents see it as coming soon and can't sign up ----------
  perform pg_temp.s12_as(r1);
  v := pg_temp.s12_ev(jc_events_list(), 'picnic');
  if not (v ->> 'coming_soon')::boolean then raise exception 'FAIL C02a list: %', v; end if;
  if not (jc_event_get(ev_v) -> 'event' ->> 'coming_soon')::boolean then raise exception 'FAIL C02b get'; end if;
  v_err := pg_temp.s12_err(format('select jc_event_signup(%L, %L)', ev_v, '{}'));
  if v_err is distinct from 'SIGNUPS_CLOSED' then raise exception 'FAIL C02c signup: %', v_err; end if;
  k := k + 3;

  -- ---------- C03 saving while coming soon may leave the place empty; pausing keeps it coming soon ----------
  perform pg_temp.s12_as(c1);
  v := pg_temp.s12_ev(jc_admin_event_signups(ev_v, false), 'picnic');
  if not (v ->> 'coming_soon')::boolean then raise exception 'FAIL C03a pause cleared coming soon: %', v; end if;
  k := k + 1;
  v := pg_temp.s12_ev(jc_admin_event_save(ev_v, '{"description_en": "Details soon"}'), 'picnic');
  if v ->> 'venue_name_en' is not null or not (v ->> 'coming_soon')::boolean then raise exception 'FAIL C03 save: %', v; end if;
  k := k + 1;

  -- ---------- C04 opening sign-ups needs the place; still coming soon after the refusal ----------
  v_err := pg_temp.s12_err(format('select jc_admin_event_signups(%L, true)', ev_v));
  if v_err is distinct from 'NO_VENUE' then raise exception 'FAIL C04a open without place: %', v_err; end if;
  if not (pg_temp.s12_ev(jc_admin_events_list(), 'picnic') ->> 'coming_soon')::boolean then raise exception 'FAIL C04b'; end if;
  k := k + 2;

  -- ---------- C05 with the place: opens, coming soon ends; residents can sign up ----------
  perform jc_admin_event_save(ev_v, '{"venue_name_en": "Central Park", "venue_lat": 24.531, "venue_lng": 54.432}');
  v := pg_temp.s12_ev(jc_admin_event_signups(ev_v, true), 'picnic');
  if not (v ->> 'signups_open')::boolean or (v ->> 'coming_soon')::boolean then raise exception 'FAIL C05a open: %', v; end if;
  perform pg_temp.s12_as(r1);
  if (jc_event_signup(ev_v, '{}') -> 'mine' ->> 'status') <> 'in' then raise exception 'FAIL C05b signup'; end if;
  k := k + 2;

  -- ---------- C06 once open, the place can't be removed; pausing doesn't bring coming soon back ----------
  perform pg_temp.s12_as(c1);
  v_err := pg_temp.s12_err(format('select jc_admin_event_save(%L, %L)', ev_v, '{"venue_name_en": null}'));
  if v_err is distinct from 'NO_VENUE' then raise exception 'FAIL C06a remove place when open: %', v_err; end if;
  v := pg_temp.s12_ev(jc_admin_event_signups(ev_v, false), 'picnic');
  if (v ->> 'signups_open')::boolean or (v ->> 'coming_soon')::boolean then raise exception 'FAIL C06b pause: %', v; end if;
  k := k + 2;

  -- ---------- C07 refusals ----------
  v_err := pg_temp.s12_err(format('select jc_admin_event_announce(%L)', ev_v));        -- live, r1 is in (T5.4b)
  if v_err is distinct from 'HAS_SIGNUPS' then raise exception 'FAIL C07a announce live with a sign-up: %', v_err; end if;
  perform pg_temp.s12_as(r1);
  v_err := pg_temp.s12_err(format('select jc_admin_event_announce(%L)', ev_h));
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL C07b resident announce: %', v_err; end if;
  k := k + 2;

  -- ---------- C08 a homes event: announce; turn it into a one-place event with no place (allowed while
  -- coming soon); back to homes; open (nothing extra needed) ----------
  perform pg_temp.s12_as(c1);
  perform jc_admin_event_announce(ev_h);
  v := pg_temp.s12_ev(jc_admin_event_save(ev_h, '{"kind": "venue"}'), 'lights');
  if v ->> 'kind' <> 'venue' then raise exception 'FAIL C08a kind change while coming soon: %', v; end if;
  perform jc_admin_event_save(ev_h, '{"kind": "homes"}');
  k := k + 1;
  v := pg_temp.s12_ev(jc_admin_event_signups(ev_h, true), 'lights');
  if not (v ->> 'signups_open')::boolean or (v ->> 'coming_soon')::boolean then raise exception 'FAIL C08: %', v; end if;
  k := k + 1;
  execute 'reset role';

  -- ---------- C11 (T5.4b) back to coming soon: allowed with no sign-ups, refused once anyone is in ----------
  perform pg_temp.s12_as(c1);
  v := pg_temp.s12_ev(jc_admin_event_announce(ev_h), 'lights');                 -- open, nobody in
  if (v ->> 'signups_open')::boolean or not (v ->> 'coming_soon')::boolean then raise exception 'FAIL C11a back to soon: %', v; end if;
  v_err := pg_temp.s12_err(format('select jc_admin_event_announce(%L)', ev_h));   -- already coming soon
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL C11d twice: %', v_err; end if;
  k := k + 1;
  v_err := pg_temp.s12_err(format('select jc_admin_event_announce(%L)', ev_v));   -- r1 is in (C05)
  if v_err is distinct from 'HAS_SIGNUPS' then raise exception 'FAIL C11b with a sign-up: %', v_err; end if;
  perform pg_temp.s12_as(r1); perform jc_entry_withdraw(ev_v);                  -- withdrawn doesn't count
  perform pg_temp.s12_as(c1);
  v := pg_temp.s12_ev(jc_admin_event_announce(ev_v), 'picnic');
  if not (v ->> 'coming_soon')::boolean then raise exception 'FAIL C11c after withdraw: %', v; end if;
  k := k + 3;

  -- ---------- C10 closing a coming-soon event clears the flag ----------
  perform pg_temp.s12_as(c1);
  v := jc_admin_event_save(null, '{"slug": "later", "title_en": "Later"}');
  perform jc_admin_event_announce((pg_temp.s12_ev(v, 'later') ->> 'id')::uuid);
  perform jc_event_close((pg_temp.s12_ev(jc_admin_events_list(), 'later') ->> 'id')::uuid, 'later');
  if (pg_temp.s12_ev(jc_admin_events_list(), 'later') ->> 'coming_soon')::boolean then raise exception 'FAIL C10 closed still coming soon'; end if;
  v_err := pg_temp.s12_err(format('select jc_admin_event_announce(%L)', (pg_temp.s12_ev(jc_admin_events_list(), 'later') ->> 'id')));
  if v_err is distinct from 'BAD_STATE' then raise exception 'FAIL C10b closed back to soon: %', v_err; end if;
  k := k + 2;
  execute 'reset role';

  -- ---------- C09 the table never holds "coming soon" with sign-ups open ----------
  v_err := null;
  begin update jc_events set coming_soon = true where id = ev_h; exception when others then v_err := sqlerrm; end;
  if v_err not like '%jc_events_coming_soon_check%' then raise exception 'FAIL C09 check: %', v_err; end if;
  k := k + 1;

  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's12_coming_soon: % checks passed', k;
end
$t$;
