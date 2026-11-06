-- T4a behaviour tests: hourly snapshot writer + the community admin's health report.
-- Runs entirely in community 'testville6' (not jubail), so it keeps working after launch.
-- Fixtures are inserted directly as postgres — this slice tests counting, not the RPCs
-- that create the rows (those are covered by s1–s4).

do $t$
declare
  t1 uuid := '00000000-0000-4000-8000-000000000601';
  t2 uuid := '00000000-0000-4000-8000-000000000602';
  v_at timestamptz := date_trunc('hour', now()) + interval '10 minutes';
  v_bucket timestamptz := date_trunc('hour', now());
  v jsonb; v_err text; n int; k int := 0; v_h1 uuid; v_h2 uuid; v_ev uuid; v_fac uuid;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, email) values (t1, 't1@t4.test'), (t2, 't2@t4.test');
  insert into jc_communities (id, name_en, map_lat, map_lng, modules)
  values ('testville6', 'Testville 6', 25.0, 55.0,
          '{"events": {"enabled": true}, "bookings": {"enabled": false}, "pets": {"enabled": false}}');
  insert into jc_villages (community_id, key, name_en) values ('testville6', 'north', 'North');
  insert into jc_accounts (user_id, community_id) values (t1, 'testville6'), (t2, 'testville6');
  insert into jc_homes (community_id, village_key, home_type, number_raw)
  values ('testville6', 'north', 'villa', '1') returning id into v_h1;
  insert into jc_homes (community_id, village_key, home_type, number_raw)
  values ('testville6', 'north', 'villa', '2') returning id into v_h2;
  insert into jc_home_members (user_id, community_id, home_id, via) values (t1, 'testville6', v_h1, 'claim');
  insert into jc_hits (community_id, page, hour, count) values ('testville6', 'landing', v_bucket - interval '1 hour', 7);
  -- one live event with one live entry + one withdrawn; one draft event with an entry
  insert into jc_events (community_id, slug, title_en, status) values ('testville6', 'fair', 'Fair', 'live') returning id into v_ev;
  insert into jc_event_entries (event_id, community_id, home_id) values (v_ev, 'testville6', v_h1);
  insert into jc_event_entries (event_id, community_id, home_id, status) values (v_ev, 'testville6', v_h2, 'withdrawn');
  insert into jc_events (community_id, slug, title_en, status) values ('testville6', 'later', 'Later', 'draft') returning id into v_ev;
  insert into jc_event_entries (event_id, community_id, home_id) values (v_ev, 'testville6', v_h1);
  -- bookings: one in 2 h, one in 3 days, one cancelled, one past
  insert into jc_facilities (community_id, kind, name_en, status) values ('testville6', 'padel', 'Court 1', 'published') returning id into v_fac;
  insert into jc_bookings (community_id, facility_id, home_id, starts_at, ends_at) values
    ('testville6', v_fac, v_h1, v_at + interval '2 hours', v_at + interval '3 hours'),
    ('testville6', v_fac, v_h1, v_at + interval '3 days', v_at + interval '3 days 1 hour'),
    ('testville6', v_fac, v_h1, v_at - interval '1 day', v_at - interval '23 hours');
  insert into jc_bookings (community_id, facility_id, home_id, starts_at, ends_at, status, cancelled_at) values
    ('testville6', v_fac, v_h2, v_at + interval '4 hours', v_at + interval '5 hours', 'cancelled', now());
  -- pets: owned + missing, a stray, an archived owned
  insert into jc_pets (community_id, kind, home_id, species, name, missing, missing_since) values
    ('testville6', 'owned', v_h1, 'cat', 'Mish', true, now());
  insert into jc_pets (community_id, kind, species, name, care_state) values ('testville6', 'stray', 'dog', 'Rex', 'under_care');
  insert into jc_pets (community_id, kind, home_id, species, name, status) values ('testville6', 'owned', v_h2, 'cat', 'Gone', 'archived');
  perform jc_code_set('testville6', 'community', 'T4-TV6-ADMIN-01');

  -- ---------- N01 one row per module per community per hour ----------
  n := jc_snapshot_run(v_at);
  if n <> 6 * (select count(*) from jc_communities) then raise exception 'FAIL N01a returned %', n; end if;
  if (select count(*) from jc_snapshots where community_id = 'testville6' and bucket = v_bucket) <> 6 then
    raise exception 'FAIL N01b testville6 rows'; end if;
  k := k + 2;

  -- ---------- N02 counts ----------
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'homes' and bucket = v_bucket);
  if (v ->> 'total')::int <> 2 or (v ->> 'occupied')::int <> 1 or (v ->> 'pinned')::int <> 0
     or (v -> 'by_village' ->> 'north')::int <> 2 then raise exception 'FAIL N02a homes: %', v; end if;
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'accounts' and bucket = v_bucket);
  if (v ->> 'total')::int <> 2 or (v ->> 'joined_24h')::int <> 2 then raise exception 'FAIL N02b accounts: %', v; end if;
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'traffic' and bucket = v_bucket);
  if (v -> 'pages' ->> 'landing')::int <> 7 then raise exception 'FAIL N02c traffic: %', v; end if;
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'events' and bucket = v_bucket);
  if (v ->> 'live_events')::int <> 1 or (v ->> 'entries_in')::int <> 1 then raise exception 'FAIL N02d events: %', v; end if;
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'bookings' and bucket = v_bucket);
  if (v ->> 'upcoming')::int <> 2 or (v ->> 'next_24h')::int <> 1 or (v ->> 'created_24h')::int <> 4 then
    raise exception 'FAIL N02e bookings: %', v; end if;
  v := (select metrics from jc_snapshots where community_id = 'testville6' and module = 'pets' and bucket = v_bucket);
  if (v ->> 'owned')::int <> 1 or (v ->> 'strays')::int <> 1 or (v ->> 'missing')::int <> 1 then
    raise exception 'FAIL N02f pets: %', v; end if;
  k := k + 6;

  -- ---------- N03 module flags are recorded, and off modules still get a row ----------
  if (select (metrics ->> 'enabled')::boolean from jc_snapshots
       where community_id = 'testville6' and module = 'events' and bucket = v_bucket) is not true
     or (select (metrics ->> 'enabled')::boolean from jc_snapshots
          where community_id = 'testville6' and module = 'pets' and bucket = v_bucket) is not false then
    raise exception 'FAIL N03 enabled flags'; end if;
  k := k + 1;

  -- ---------- N04 a re-run in the same hour overwrites (idempotent) ----------
  insert into jc_homes (community_id, village_key, home_type, number_raw) values ('testville6', 'north', 'villa', '3');
  perform jc_snapshot_run(v_at + interval '20 minutes');
  if (select count(*) from jc_snapshots where community_id = 'testville6' and bucket = v_bucket) <> 6 then
    raise exception 'FAIL N04a duplicate rows on re-run'; end if;
  if (select (metrics ->> 'total')::int from jc_snapshots
       where community_id = 'testville6' and module = 'homes' and bucket = v_bucket) <> 3 then
    raise exception 'FAIL N04b re-run did not refresh metrics'; end if;
  k := k + 2;

  -- ---------- N05 internals are unreachable ----------
  perform set_config('request.jwt.claims', json_build_object('sub', t2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin perform jc_snapshot_run(); exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL N05a jc_snapshot_run callable: %', v_err; end if;
  v_err := null; begin perform 1 from jc_counter_baseline; exception when others then v_err := sqlerrm; end;
  if v_err not like 'permission denied%' then raise exception 'FAIL N05b baseline readable: %', v_err; end if;
  -- ---------- N06 report is community-admin only ----------
  v_err := null; begin perform jc_admin_report(); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_ADMIN' then raise exception 'FAIL N06 non-admin report: %', v_err; end if;
  k := k + 3;

  -- ---------- N07 report contents (as the platform owner: the whole-platform rows are owner-only — T5.2 hardening) ----------
  execute 'reset role';
  insert into jc_platform_owners (user_id) values (t1);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  v := jc_admin_unlock('T4-TV6-ADMIN-01');
  v := jc_admin_report();
  if not (v ?& array['snapshot', 'cron', 'failures_since_baseline', 'rate_limited_now',
                     'state_changes_24h', 'notices_open', 'traffic', 'storage']) then
    raise exception 'FAIL N07a report keys: %', v; end if;
  if (v -> 'snapshot' ->> 'stale')::boolean then raise exception 'FAIL N07b fresh snapshot reported stale: %', v -> 'snapshot'; end if;
  if (v -> 'cron' ->> 'job_present')::boolean is not true then raise exception 'FAIL N07c cron job missing: %', v -> 'cron'; end if;
  if (v -> 'failures_since_baseline' ->> 'admin_codes')::bigint < 0 then raise exception 'FAIL N07d baseline'; end if;
  if (v -> 'traffic' ->> 'counter_suspect')::boolean then raise exception 'FAIL N07e counter suspect with hits'; end if;
  if (v -> 'storage' ->> 'limit_bytes')::bigint <> 1073741824 then raise exception 'FAIL N07f storage'; end if;
  k := k + 6;

  -- ---------- N08 the canary fires: stale snapshot, silent counter ----------
  execute 'reset role';
  update jc_snapshots set taken_at = now() - interval '3 hours' where community_id = 'testville6';
  delete from jc_hits where community_id = 'testville6';
  execute 'set local role authenticated';
  v := jc_admin_report();
  if (v -> 'snapshot' ->> 'stale')::boolean is not true then raise exception 'FAIL N08a stale not flagged: %', v -> 'snapshot'; end if;
  if (v -> 'traffic' ->> 'counter_suspect')::boolean is not true then raise exception 'FAIL N08b silent counter not flagged'; end if;
  k := k + 2;

  -- ---------- N09 outside probe (anon): stale → not ok; fresh → ok; thin payload ----------
  execute 'reset role'; execute 'set local role anon';
  v := jc_health('testville6');
  if (v ->> 'ok')::boolean is not false then raise exception 'FAIL N09a stale reported ok: %', v; end if;
  execute 'reset role';
  perform jc_snapshot_run();
  execute 'set local role anon';
  v := jc_health('testville6');
  if (v ->> 'ok')::boolean is not true or (v ->> 'cron_active')::boolean is not true then
    raise exception 'FAIL N09b fresh not ok: %', v; end if;
  if exists (select 1 from jsonb_object_keys(v) x
              where x not in ('ok', 'cron_active', 'snapshot_age_minutes', 'maintenance_ok')) then
    raise exception 'FAIL N09c probe leaks more than flags/age: %', v; end if;
  v_err := null; begin perform jc_health('no-such-place'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'NOT_FOUND' then raise exception 'FAIL N09d: %', v_err; end if;
  execute 'reset role';
  k := k + 4;

  -- ---------- N10 the report survives the very thing it watches for: no cron job ----------
  perform cron.unschedule('jc-hourly-snapshot');
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null; begin v := jc_admin_report(); exception when others then v_err := sqlerrm; end;
  if v_err is not null then raise exception 'FAIL N10a report raised with no job: %', v_err; end if;
  if (v -> 'cron' ->> 'job_present')::boolean is not false then raise exception 'FAIL N10b: %', v -> 'cron'; end if;
  execute 'reset role'; execute 'set local role anon';
  if (jc_health('testville6') ->> 'ok')::boolean is not false then raise exception 'FAIL N10c health ok with no job'; end if;
  execute 'reset role';
  k := k + 3;

  execute 'reset role';
  perform set_config('jc_test.checks', (coalesce(nullif(current_setting('jc_test.checks', true), ''), '0')::int + k)::text, true);
  raise notice 's6_snapshots: % checks passed', k;
end
$t$;
