-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.4 — "Coming soon": a stage between Draft and Open (Zee, 2026-11-05). An organizer can put an
-- event on the residents' list before it's ready — a card with a Coming soon badge, no sign-up — and
-- needs only the title for that. Everything an open event needs (a one-place event's name + pin) is
-- checked when sign-ups OPEN, which also ends "coming soon".
--   Draft ──jc_admin_event_announce──▶ Coming soon (live, sign-ups closed) ──jc_admin_event_signups(true)──▶ Open
--   Draft ──jc_admin_event_publish (unchanged)──────────────────────────────────────────────────────▶ Open
-- Replaced from their live bodies (marked T5.4): jc_admin_event_save (NO_VENUE not while coming soon),
-- jc_admin_event_signups (NO_VENUE on open; clears coming_soon), and the three event reads (+ coming_soon).
-- jc_event_close clears the flag (a closed event is never "coming soon" — database review).
-- Signatures unchanged; one new RPC. Note (reviews): an event admin may open sign-ups on a coming-soon
-- event (they could already open / pause live ones; the place check still applies); announcing makes
-- everything saved so far visible to residents — the organizer's confirm says so.
--
-- Rollback, IN THIS ORDER: 0. revert announced events: update jc_events set status = 'draft',
--   coming_soon = false where coming_soon and status = 'live' (or open them); 1. restore
--   jc_admin_event_save / jc_admin_event_signups / jc_admin_events_list (20261105080000 / 20261105070000
--   bodies), jc_event_get (20261105080000), jc_events_list (20261105090000), jc_event_close
--   (20261105070000); 2. drop function public.jc_admin_event_announce(uuid);
--   3. alter table public.jc_events drop constraint jc_events_coming_soon_check, drop column coming_soon.

set local lock_timeout = '3s';

-- ---------- 1. the stage ----------
alter table public.jc_events add column coming_soon boolean not null default false;
alter table public.jc_events add constraint jc_events_coming_soon_check check (not coming_soon or not signups_open);

-- ---------- 2. announce a draft as coming soon (organizers, like publish) ----------
create function public.jc_admin_event_announce(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');                 -- organizer only, as jc_admin_event_publish
  update jc_events set status = 'live', signups_open = false, coming_soon = true
   where id = p_event and community_id = v_comm and status = 'draft';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_announce', jsonb_build_object('event_id', p_event));
  return jc_admin_events_list();
end;
$$;
grant execute on function public.jc_admin_event_announce(uuid) to authenticated;

-- ---------- 3. replaced functions (live bodies + T5.4 changes) ----------
CREATE OR REPLACE FUNCTION public.jc_admin_event_save(p_event uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_event uuid := p_event; v_status text;
        v_kind text; v_was jsonb; v_cleared int := 0; ev public.jc_events%rowtype;  -- T5.2 3b
begin
  -- T5.2b: creating is the community admin's (organizer); editing, the event's admins too
  if p_event is null then
    v_comm := jc_assert_admin('events');
  else
    v_comm := jc_assert_event_admin(p_event, true);
  end if;
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('slug', 'title_en', 'title_ar', 'description_en', 'description_ar',
                                 'starts_at', 'ends_at', 'theme', 'features', 'payload_schema', 'safety',
                                 -- T5.2 3b
                                 'kind', 'look', 'venue_name_en', 'venue_name_ar', 'venue_lat', 'venue_lng',
                                 'capacity', 'spots')) then
    raise exception 'BAD_FIELDS';
  end if;
  if p_fields ? 'features' then perform jc_features_check(p_fields -> 'features'); end if;
  if p_fields ? 'payload_schema' then perform jc_schema_check(p_fields -> 'payload_schema'); end if;
  if p_fields ? 'theme' then perform jc_kv_check(p_fields -> 'theme', 'theme'); end if;
  if p_fields ? 'safety' then perform jc_kv_check(p_fields -> 'safety', 'safety'); end if;
  -- T5.2 3b: typed values only (a string "5" or "true" is a client bug, not a value)
  if (p_fields ? 'spots' and jsonb_typeof(p_fields -> 'spots') <> 'boolean')
     or (p_fields ? 'capacity' and jsonb_typeof(p_fields -> 'capacity') not in ('number', 'null'))
     or (jsonb_typeof(p_fields -> 'capacity') = 'number' and (p_fields ->> 'capacity')::numeric % 1 <> 0)
     or (p_fields ? 'venue_lat' and jsonb_typeof(p_fields -> 'venue_lat') not in ('number', 'null'))
     or (p_fields ? 'venue_lng' and jsonb_typeof(p_fields -> 'venue_lng') not in ('number', 'null'))
     or (p_fields ? 'kind' and jsonb_typeof(p_fields -> 'kind') <> 'string')
     or (p_fields ? 'look' and jsonb_typeof(p_fields -> 'look') <> 'string') then
    raise exception 'BAD_FIELDS';
  end if;

  begin
    if v_event is null then
      if coalesce(p_fields ->> 'slug', '') = '' or coalesce(p_fields ->> 'title_en', '') = '' then
        raise exception 'BAD_FIELDS';
      end if;
      insert into jc_events (community_id, slug, title_en, created_by)
      values (v_comm, p_fields ->> 'slug', p_fields ->> 'title_en', auth.uid())
      returning id into v_event;
    else
      select status into v_status from jc_events where id = v_event and community_id = v_comm for update;
      if v_status is null then raise exception 'NOT_FOUND'; end if;
      if v_status = 'archived' then raise exception 'EVENT_ARCHIVED'; end if;
      -- a published slug is in shared links and is the close-confirmation word
      if v_status <> 'draft' and p_fields ? 'slug' then raise exception 'SLUG_LOCKED'; end if;
      if p_fields ? 'payload_schema'
         and exists (select 1 from jc_event_entries where event_id = v_event) then
        raise exception 'SCHEMA_LOCKED';
      end if;
    end if;

    -- T5.2 3b: the row is locked (FOR UPDATE above / just inserted), so sign-ups wait for us
    select * into ev from jc_events where id = v_event;
    v_kind := coalesce(p_fields ->> 'kind', ev.kind);
    -- the kind is what a sign-up MEANS — fixed once anyone has signed up (withdrawn included:
    -- that household signed up to the old meaning)
    if v_kind is distinct from ev.kind
       and exists (select 1 from jc_event_entries where event_id = v_event) then
      raise exception 'KIND_LOCKED';
    end if;
    -- venue / capacity / spots are one-place settings: on a homes event they're a client bug
    if v_kind = 'homes'
       and exists (select 1 from jsonb_each(p_fields) f
                    where f.key in ('venue_name_en', 'venue_name_ar', 'venue_lat', 'venue_lng', 'capacity', 'spots')
                      and f.value not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb)) then
      raise exception 'BAD_FIELDS';
    end if;
    -- capacity can't go under the households already in: it removes nobody, and "pause
    -- sign-ups" is the way to stop new ones (security review M2)
    if jsonb_typeof(p_fields -> 'capacity') = 'number'
       and (p_fields ->> 'capacity')::numeric
           < (select count(*) from jc_event_entries where event_id = v_event and status = 'in') then
      raise exception 'CAPACITY_BELOW';
    end if;
    v_was := jsonb_build_object('kind', ev.kind, 'capacity', ev.capacity, 'spots', ev.spots,
                                'venue', case when ev.venue_lat is null then null
                                              else jsonb_build_array(ev.venue_lat, ev.venue_lng) end,
                                'venue_name_en', ev.venue_name_en);

    update jc_events set
      slug           = coalesce(p_fields ->> 'slug', slug),
      title_en       = coalesce(p_fields ->> 'title_en', title_en),
      title_ar       = case when p_fields ? 'title_ar' then p_fields ->> 'title_ar' else title_ar end,
      description_en = case when p_fields ? 'description_en' then p_fields ->> 'description_en' else description_en end,
      description_ar = case when p_fields ? 'description_ar' then p_fields ->> 'description_ar' else description_ar end,
      starts_at      = case when p_fields ? 'starts_at' then (p_fields ->> 'starts_at')::timestamptz else starts_at end,
      ends_at        = case when p_fields ? 'ends_at' then (p_fields ->> 'ends_at')::timestamptz else ends_at end,
      theme          = coalesce(p_fields -> 'theme', theme),
      features       = coalesce(p_fields -> 'features', features),
      payload_schema = coalesce(p_fields -> 'payload_schema', payload_schema),
      safety         = coalesce(p_fields -> 'safety', safety),
      -- T5.2 3b: switching to homes clears the one-place settings
      kind           = v_kind,
      look           = coalesce(p_fields ->> 'look', look),
      venue_name_en  = case when v_kind = 'homes' then null
                           when p_fields ? 'venue_name_en' then nullif(jc_clean_text(p_fields ->> 'venue_name_en'), '')
                           else venue_name_en end,
      venue_name_ar  = case when v_kind = 'homes' then null
                           when p_fields ? 'venue_name_ar' then nullif(jc_clean_text(p_fields ->> 'venue_name_ar'), '')
                           else venue_name_ar end,
      venue_lat      = case when v_kind = 'homes' then null
                           when p_fields ? 'venue_lat' then (p_fields ->> 'venue_lat')::float8 else venue_lat end,
      venue_lng      = case when v_kind = 'homes' then null
                           when p_fields ? 'venue_lng' then (p_fields ->> 'venue_lng')::float8 else venue_lng end,
      capacity       = case when v_kind = 'homes' then null
                           when p_fields ? 'capacity' then (p_fields ->> 'capacity')::numeric::integer else capacity end,
      spots          = case when v_kind = 'homes' then false
                           when p_fields ? 'spots' then (p_fields ->> 'spots')::boolean else spots end
     where id = v_event
    returning * into ev;
    -- T5.2 3b: rules on the SAVED row, so a one-coordinate edit can't dodge them (reviews)
    if ev.venue_lat is not null
       and coalesce((select jc_dist_m(ev.venue_lat, ev.venue_lng, c.map_lat, c.map_lng) > 10000
                       from jc_communities c where c.id = v_comm), false) then
      raise exception 'BAD_PIN';                         -- the venue is in the community (10 km, as a home pin)
    end if;
    if ev.status <> 'draft' and not ev.coming_soon                                  -- T5.4: coming soon may lack it
       and ev.kind = 'venue' and (ev.venue_name_en is null or ev.venue_lat is null) then
      raise exception 'NO_VENUE';                        -- an open one-place event keeps its place
    end if;
    -- turning spots off frees every assigned spot (counted in the log)
    if not ev.spots then
      update jc_event_entries set spot = null where event_id = v_event and spot is not null;
      get diagnostics v_cleared = row_count;
    end if;
  exception
    when unique_violation then raise exception 'SLUG_TAKEN';
    when check_violation or invalid_datetime_format or datetime_field_overflow
         or invalid_text_representation or numeric_value_out_of_range then raise exception 'BAD_FIELDS';  -- T5.2 3b: + out of range
  end;
  perform jc_admin_log_add(v_comm, 'event_save', jsonb_build_object('event_id', v_event, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k),
    'was', v_was, 'spots_cleared', v_cleared));                                     -- T5.2 3b
  return jc_admin_events_list();
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_admin_event_signups(p_event uuid, p_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_event_admin(p_event, true);   -- T5.2b
  -- T5.4: opening sign-ups is when everything must be there (a coming-soon one-place event may
  -- still lack its place); it also ends "coming soon"
  perform 1 from jc_events where id = p_event and community_id = v_comm for update;
  if coalesce(p_open, false) and exists (select 1 from jc_events where id = p_event and community_id = v_comm
       and status = 'live' and kind = 'venue' and (venue_name_en is null or venue_lat is null)) then
    raise exception 'NO_VENUE';
  end if;
  update jc_events set signups_open = coalesce(p_open, false),
         coming_soon = coming_soon and not coalesce(p_open, false)
   where id = p_event and community_id = v_comm and status = 'live';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_signups', jsonb_build_object('event_id', p_event, 'open', coalesce(p_open, false)));
  return jc_admin_events_list();
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_admin_events_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_user uuid; v_home uuid; v_all boolean;          -- T5.2b
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();   -- T5.2b
  v_all := jc_events_organizer();                                                -- T5.2b
  -- T5.2b: an event admin sees their events (incl. the 5-day read window); nobody else gets in
  if not v_all and not exists (
       select 1 from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
        where ea.user_id = v_user and ev.community_id = v_comm
          and (ev.status <> 'archived' or ev.archived_at > now() - interval '5 days')) then
    raise exception 'NOT_ADMIN';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
             'description_en', ev.description_en, 'description_ar', ev.description_ar,
             'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
             'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
             'payload_schema', ev.payload_schema, 'safety', ev.safety, 'created_at', ev.created_at,
             -- T5.2 3b
             'kind', ev.kind, 'look', ev.look, 'venue_name_en', ev.venue_name_en,
             'venue_name_ar', ev.venue_name_ar, 'venue_lat', ev.venue_lat, 'venue_lng', ev.venue_lng,
             'capacity', ev.capacity, 'spots', ev.spots, 'coming_soon', ev.coming_soon,   -- T5.4
             'entries', (select count(*) from jc_event_entries en where en.event_id = ev.id and en.status = 'in'))
           order by ev.created_at desc)
      from jc_events ev
     where ev.community_id = v_comm
       and (v_all or exists (select 1 from jc_event_admins ea                    -- T5.2b
                              where ea.event_id = ev.id and ea.user_id = v_user
                                and (ev.status <> 'archived' or ev.archived_at > now() - interval '5 days')))),
    '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_event_get(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; ev public.jc_events%rowtype; v_mine jsonb;
        v_in int;                                                                -- T5.2 3b
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  select * into ev from jc_events
   where id = p_event and community_id = v_comm and status in ('live', 'archived');
  if ev.id is null then raise exception 'NOT_FOUND'; end if;

  select jsonb_build_object(
           'id', en.id, 'status', en.status, 'payload', en.payload, 'note', en.note,
           'live_state', en.live_state, 'supply_level', en.supply_level, 'org_note', en.org_note,
           'hidden', en.hidden, 'reports_locked_until', en.reports_locked_until,
           'spot', en.spot,                                                      -- T5.2 3b
           'reports_open', (select count(*) from jc_entry_reports r
                             where r.entry_id = en.id and r.cleared_at is null))
    into v_mine
    from jc_event_entries en where en.event_id = ev.id and en.home_id = v_home;

  -- T5.2 3b: households in (all of them — a hidden sign-up still holds its place)
  select count(*) into v_in from jc_event_entries where event_id = ev.id and status = 'in';

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
      'description_en', ev.description_en, 'description_ar', ev.description_ar,
      'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
      'signups_open', ev.signups_open, 'coming_soon', ev.coming_soon,               -- T5.4
      'features', ev.features, 'theme', ev.theme,
      'payload_schema', ev.payload_schema, 'safety', ev.safety,
      -- T5.2 3b
      'kind', ev.kind, 'look', ev.look, 'venue_name_en', ev.venue_name_en,
      'venue_name_ar', ev.venue_name_ar, 'venue_lat', ev.venue_lat, 'venue_lng', ev.venue_lng,
      'capacity', ev.capacity, 'spots', ev.spots, 'households_in', v_in,
      'places_left', case when ev.capacity is not null then greatest(ev.capacity - v_in, 0) end),
    'mine', v_mine,
    'stats', case when ev.status = 'archived'
                  then (select st.snapshot from jc_event_stats st where st.event_id = ev.id) end,
    -- T5.2 3b: a one-place event shows HOW MANY are coming (households_in), never WHICH homes
    'entries', case when ev.status = 'live' and ev.kind = 'homes' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', en.id, 'mine', en.home_id = v_home,
               'village', h.village_key, 'type', h.home_type, 'building', h.building,
               'number', h.number_raw,
               -- T5.2: an organizer's event-only pin wins over the home's own pin
               'lat', coalesce(en.event_lat, h.lat),
               'lng', case when en.event_lat is not null then en.event_lng else h.lng end,
               'event_pin', en.event_lat is not null,
               'payload', en.payload, 'note', en.note,
               'live_state', en.live_state, 'supply_level', en.supply_level,
               'reported_out', coalesce((ev.features ->> 'crowd_reports')::boolean, false)
                               and en.live_state <> 'done'
                               and (select count(*) from jc_entry_reports r
                                     where r.entry_id = en.id and r.cleared_at is null) >= 3)
             order by h.village_key, h.building_norm, h.number_norm)
        from jc_event_entries en join jc_homes h on h.id = en.home_id
       where en.event_id = ev.id and en.status = 'in'
         -- admin-hidden entries and directory-suppressed homes: visible to their own household only
         and ((not en.hidden and not h.directory_suppressed) or en.home_id = v_home)), '[]'::jsonb)
      when ev.status = 'live' then '[]'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_events_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
             'description_en', ev.description_en, 'description_ar', ev.description_ar,
             'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
             'signups_open', ev.signups_open, 'coming_soon', ev.coming_soon,        -- T5.4
             'features', ev.features, 'theme', ev.theme,
             -- T5.2 3b
             'kind', ev.kind, 'look', ev.look, 'venue_name_en', ev.venue_name_en,
             'venue_name_ar', ev.venue_name_ar, 'capacity', ev.capacity,
             'full', ev.status = 'live' and ev.capacity is not null
                     and (select count(*) from jc_event_entries en
                           where en.event_id = ev.id and en.status = 'in') >= ev.capacity,
             'homes_in', case when ev.status = 'archived'
                              then (select (st.snapshot ->> 'homes')::int from jc_event_stats st where st.event_id = ev.id)
                              else (select count(*) from jc_event_entries en
                                     where en.event_id = ev.id and en.status = 'in' and not en.hidden) end,
             -- T5.3 (PR 4b review M1): every "in" household, as jc_event_get counts — a hidden
             -- sign-up still holds its place, and the two screens must not disagree
             'households_in', case when ev.status = 'live'
                                   then (select count(*) from jc_event_entries en
                                          where en.event_id = ev.id and en.status = 'in') end,
             'my_status', (select en.status from jc_event_entries en
                            where en.event_id = ev.id and en.home_id = v_home))
           order by coalesce(ev.starts_at, ev.created_at) desc)
      from jc_events ev
     where ev.community_id = v_comm and ev.status in ('live', 'archived')), '[]'::jsonb);
end;
$function$;
CREATE OR REPLACE FUNCTION public.jc_event_close(p_event uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; ev public.jc_events%rowtype; v_snap jsonb;
begin
  v_comm := jc_assert_event_admin(p_event, true);   -- T5.2b
  select * into ev from jc_events where id = p_event and community_id = v_comm for update;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if ev.status <> 'live' then raise exception 'BAD_STATE'; end if;
  if p_confirm is distinct from ev.slug then raise exception 'CONFIRM_REQUIRED'; end if;

  update jc_events set signups_open = false, coming_soon = false where id = ev.id;   -- T5.4: closed is never "coming soon"
  v_snap := jc_event_snapshot(ev.id);
  insert into jc_event_stats (event_id, community_id, snapshot, source)
  values (ev.id, v_comm, v_snap, 'snapshot')
  on conflict (event_id) do update set snapshot = excluded.snapshot, source = 'snapshot', taken_at = now();
  update jc_event_entries set archived_at = now() where event_id = ev.id and archived_at is null;
  update jc_events set status = 'archived', archived_at = now() where id = ev.id;
  -- T5.2b: a banner this event's admins posted goes with the event
  update jc_communities set broadcast = '', broadcast_event = null
   where id = v_comm and broadcast_event = ev.id;
  perform jc_admin_log_add(v_comm, 'event_close', jsonb_build_object(
    'event_id', ev.id, 'slug', ev.slug, 'homes', v_snap -> 'homes'));
  return v_snap;
end;
$function$;
