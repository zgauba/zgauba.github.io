-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.2 PR 3b — event kinds, looks, venue, capacity, spots (plan docs/plans/T5-2-plan.md,
-- amendment A1–A5). Decisions (Zee, 2026-11-04):
--   1. kind: 'homes' (each signed-up home is a stop on the map — today's behaviour, the
--      default for every existing event) or 'venue' (one place; signing up = "my household
--      is coming / wants a spot");
--   2. look: a built-in preset key (colours / icons / header art live in the app); no uploads;
--   3. venue events carry a name + pin (required to publish), optional CAPACITY counted in
--      HOUSEHOLDS (sign-ups stop at N → FULL) and optional organizer-assigned SPOTS;
--   4. on a venue event residents see HOW MANY households are coming, never WHICH — organizers
--      and the event's admins still see the list (jc_admin_entries_list);
--   5. a venue event needs no home pin to sign up (the place is the pin).
-- jc_event_signup's signature is frozen (cached pages) — body only. Every other change is
-- additive output keys + one new RPC (jc_admin_entry_spot_set).
-- Bodies of replaced functions are the live ones (pg_get_functiondef, 2026-11-04) plus the
-- marked "T5.2 3b" lines only.
--
-- DOWN (if ever needed, one transaction): re-create the 9 replaced functions from
-- 20261105070000 / 20261105060000 / earlier; drop function jc_admin_entry_spot_set(uuid, text);
-- drop index jc_event_entries_spot_unique; alter table jc_event_entries drop column spot;
-- alter table jc_events drop constraint jc_events_kind_fields, drop column kind, look,
-- venue_name_en, venue_name_ar, venue_lat, venue_lng, capacity, spots.

-- ---------- 1. columns ----------
alter table public.jc_events
  add column kind          text not null default 'homes' check (kind in ('homes', 'venue')),
  add column look          text not null default 'plain'
    check (look in ('plain', 'halloween', 'haq_al_laila', 'gathering', 'market', 'yard_sale')),
  add column venue_name_en text check (venue_name_en is null or char_length(venue_name_en) between 1 and 120),
  add column venue_name_ar text check (venue_name_ar is null or char_length(venue_name_ar) between 1 and 120),
  add column venue_lat     double precision,
  add column venue_lng     double precision,
  add column capacity      integer check (capacity is null or capacity between 1 and 5000),
  add column spots         boolean not null default false;
alter table public.jc_events add constraint jc_events_kind_fields check (
  -- a pin is both coordinates or neither, in range
  ((venue_lat is null and venue_lng is null)
   or (venue_lat is not null and venue_lng is not null      -- (NULL in a CHECK passes — say it)
       and venue_lat between -90 and 90 and venue_lng between -180 and 180))
  -- venue, capacity and spots belong to one-place events only
  and (kind = 'venue' or (venue_name_en is null and venue_name_ar is null and venue_lat is null
                          and capacity is null and not spots)));

alter table public.jc_event_entries
  -- one plain form per spot (uppercase letters, digits, space, dash) so "a1", "A1" and
  -- "A1<zero-width>" can't be three different stalls (reviews)
  add column spot text check (spot is null or spot ~ '^[A-Z0-9][A-Z0-9 -]{0,11}$');
-- a spot is held by one signed-up household per event; withdraw also nulls it (the status
-- predicate keeps an archived/withdrawn row from ever blocking a spot)
create unique index jc_event_entries_spot_unique on public.jc_event_entries (event_id, spot)
  where spot is not null and status = 'in';

-- ---------- 2. organizer: save (new fields) + publish (venue required) ----------
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
    if ev.status <> 'draft' and ev.kind = 'venue' and (ev.venue_name_en is null or ev.venue_lat is null) then
      raise exception 'NO_VENUE';                        -- a live one-place event keeps its place
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

CREATE OR REPLACE FUNCTION public.jc_admin_event_publish(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');   -- T5.2b: organizer only (legacy `events` until PR C)
  -- T5.2 3b: a one-place event can't go live without its place
  perform 1 from jc_events where id = p_event and community_id = v_comm for update;   -- no save slips in
  if exists (select 1 from jc_events where id = p_event and community_id = v_comm and status = 'draft'
                and kind = 'venue' and (venue_name_en is null or venue_lat is null)) then
    raise exception 'NO_VENUE';
  end if;
  update jc_events set status = 'live', signups_open = true
   where id = p_event and community_id = v_comm and status = 'draft';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_publish', jsonb_build_object('event_id', p_event));
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
             'capacity', ev.capacity, 'spots', ev.spots,
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

CREATE OR REPLACE FUNCTION public.jc_admin_entries_list(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_event_admin(p_event, false);   -- T5.2b: a read — the 5-day window applies
  if not exists (select 1 from jc_events where id = p_event and community_id = v_comm) then
    raise exception 'NOT_FOUND';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', en.id, 'home_id', en.home_id, 'village', h.village_key, 'type', h.home_type,
             'building', h.building, 'number', h.number_raw, 'status', en.status,
             'home_lat', h.lat, 'home_lng', h.lng, 'event_lat', en.event_lat, 'event_lng', en.event_lng,
             'payload', en.payload, 'note', en.note, 'live_state', en.live_state,
             'supply_level', en.supply_level, 'hidden', en.hidden, 'org_note', en.org_note,
             'spot', en.spot,                                                    -- T5.2 3b
             'reports_open', (select count(*) from jc_entry_reports r where r.entry_id = en.id and r.cleared_at is null),
             'created_at', en.created_at, 'updated_at', en.updated_at)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_event_entries en join jc_homes h on h.id = en.home_id
     where en.event_id = p_event), '[]'::jsonb);
end;
$function$;

-- ---------- 3. organizer: assign a spot (new) ----------
create function public.jc_admin_entry_spot_set(p_entry uuid, p_spot text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_comm text; v_event uuid; en public.jc_event_entries%rowtype; v_spot text;
begin
  -- the entry's own event decides (looked up in the caller's community only), as pin_set
  select e.event_id into v_event from jc_event_entries e
   where e.id = p_entry and e.community_id = (select o_community from jc_me());
  v_comm := jc_assert_event_admin(v_event, true);
  if v_event is null then raise exception 'NOT_FOUND'; end if;   -- an organizer, but no such entry here
  v_spot := nullif(upper(jc_clean_text(p_spot)), '');
  if v_spot !~ '^[A-Z0-9][A-Z0-9 -]{0,11}$' then raise exception 'BAD_SPOT'; end if;
  -- the event row first (same order as sign-up), then the entry
  perform 1 from jc_events where id = v_event and community_id = v_comm
     and status = 'live' and kind = 'venue' and spots for share;
  if not found then raise exception 'BAD_STATE'; end if;
  select * into en from jc_event_entries
   where id = p_entry and community_id = v_comm and status = 'in' and archived_at is null for update;
  if en.id is null then raise exception 'NOT_FOUND'; end if;
  begin
    update jc_event_entries set spot = v_spot, updated_at = now() where id = p_entry;
  exception when unique_violation then raise exception 'SPOT_TAKEN';
  end;
  perform jc_admin_log_add(v_comm, 'entry_spot_set', jsonb_build_object(
    'entry_id', p_entry, 'event_id', en.event_id, 'from', en.spot, 'to', v_spot));
  return jc_admin_entries_list(en.event_id);
end;
$function$;

-- ---------- 4. resident: sign up (capacity, no pin for venues), withdraw (frees the spot) ----------
CREATE OR REPLACE FUNCTION public.jc_event_signup(p_event uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; ev public.jc_events%rowtype;
        v_clean jsonb; v_note text; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  perform jc_home_hold(v_user, v_home);
  -- FOR SHARE: serializes against jc_event_close's FOR UPDATE, so no signup lands mid-close
  select * into ev from jc_events
   where id = p_event and community_id = v_comm and status <> 'draft' for share;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if ev.status <> 'live' or not ev.signups_open then raise exception 'SIGNUPS_CLOSED'; end if;
  -- T5.2: a home is on the map by its pin, so it needs one to join (the screen turns
  -- NO_PIN into "pin your home" and back). An organizer's event-only pin counts.
  if ev.kind = 'homes'                                                          -- T5.2 3b: the venue is the pin
     and not exists (select 1 from jc_homes where id = v_home and lat is not null)
     and not exists (select 1 from jc_event_entries
                      where event_id = ev.id and home_id = v_home and status = 'in' and event_lat is not null) then
    raise exception 'NO_PIN';
  end if;
  -- T5.2 3b: capacity counts households. Sign-ups to one event queue on a transaction lock so
  -- two last-place sign-ups can't both see a free place (each count runs after the other commits).
  -- Updating an existing sign-up never counts as a new place.
  if ev.capacity is not null then
    perform pg_advisory_xact_lock(hashtextextended('jc_event_capacity:' || ev.id::text, 0));
    -- both checks AFTER the lock: a second member of the same home, a moment behind, is an update
    if not exists (select 1 from jc_event_entries where event_id = ev.id and home_id = v_home and status = 'in')
       and (select count(*) from jc_event_entries where event_id = ev.id and status = 'in') >= ev.capacity then
      raise exception 'FULL';
    end if;
  end if;

  v_clean := jc_payload_check(ev.payload_schema, p_payload);
  v_note := jc_clean_text(p_payload ->> 'note');
  if char_length(v_note) > 280 then raise exception 'BAD_PAYLOAD'; end if;

  insert into jc_event_entries (event_id, community_id, home_id, payload, note, updated_by)
  values (ev.id, v_comm, v_home, v_clean, v_note, v_user)
  on conflict (event_id, home_id) do update
    set payload = excluded.payload, note = excluded.note, status = 'in',
        -- coming back after a withdrawal starts fresh on the event-day state
        live_state   = case when jc_event_entries.status = 'withdrawn' then 'active' else jc_event_entries.live_state end,
        supply_level = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.supply_level end,
        reports_locked_until = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.reports_locked_until end,
        -- T5.2: an organizer's event-only pin doesn't come back with a re-join
        event_lat    = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.event_lat end,
        event_lng    = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.event_lng end,
        -- T5.2 3b: nor does a spot (withdraw already frees it; belt and braces)
        spot         = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.spot end,
        updated_at = now(), updated_by = excluded.updated_by
  returning id into v_entry;
  perform jc_log(v_comm, ev.id, v_entry, 'signup', v_clean);
  return jc_event_get(ev.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_entry_withdraw(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  perform 1 from jc_events where id = p_event and community_id = v_comm and status = 'live' for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  update jc_event_entries set status = 'withdrawn', updated_at = now(), updated_by = v_user,
         spot = null                                                             -- T5.2 3b: frees the spot
   where event_id = p_event and home_id = v_home and status = 'in'
  returning id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  update jc_entry_reports set cleared_at = now() where entry_id = v_entry and cleared_at is null;
  perform jc_log(v_comm, p_event, v_entry, 'status', '"withdrawn"');
  return jc_event_get(p_event);
end;
$function$;

-- ---------- 5. resident reads ----------
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
      'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
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
             'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
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
             'my_status', (select en.status from jc_event_entries en
                            where en.event_id = ev.id and en.home_id = v_home))
           order by coalesce(ev.starts_at, ev.created_at) desc)
      from jc_events ev
     where ev.community_id = v_comm and ev.status in ('live', 'archived')), '[]'::jsonb);
end;
$function$;

-- ---------- 5b. stats: venue events report totals only ----------
CREATE OR REPLACE FUNCTION public.jc_event_snapshot(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_schema jsonb; r jsonb; v_kind text;                                -- T5.2 3b
begin
  select payload_schema, kind into v_schema, v_kind from jc_events where id = p_event;   -- T5.2 3b
  with e as (
    select en.payload, en.live_state, en.supply_level, h.home_type,
           coalesce(vl.parent_key, vl.key) as village
      from jc_event_entries en
      join jc_homes h on h.id = en.home_id
      join jc_villages vl on vl.community_id = h.community_id and vl.key = h.village_key
     where en.event_id = p_event and en.status = 'in' and not en.hidden),
  tallied as (
    select f.key as fk from jsonb_each(coalesce(v_schema -> 'fields', '{}')) f
     where f.value ->> 'type' in ('enum', 'bool'))
  select jsonb_build_object(
    'homes',      (select count(*) from e),
    'done',       (select count(*) from e where live_state = 'done'),
    -- T5.2 3b: a one-place event says how many, never where from — small villages would
    -- name the household (residents read this live via jc_event_stats_get; security review M1)
    'by_village', case when v_kind = 'venue' then '{}'::jsonb else coalesce((select jsonb_object_agg(village, n)
                              from (select village, count(*) n from e group by village) a), '{}') end,
    'by_type',    case when v_kind = 'venue' then '{}'::jsonb else coalesce((select jsonb_object_agg(home_type, n)
                              from (select home_type, count(*) n from e group by home_type) b), '{}') end,
    'supply',     coalesce((select jsonb_object_agg(supply_level::text, n)
                              from (select supply_level, count(*) n from e
                                     where supply_level is not null group by supply_level) c), '{}'),
    'payload',    coalesce((select jsonb_object_agg(t.fk, t.dist) from (
                     select tl.fk, (select jsonb_object_agg(d.val, d.n)
                                      from (select e.payload ->> tl.fk as val, count(*) n
                                              from e where e.payload ? tl.fk group by 1) d) as dist
                       from tallied tl) t
                    where t.dist is not null), '{}'),
    'taken_at',   now())
  into r;
  return r;
end;
$function$;

-- ---------- 6. grants (default privileges are closed: new functions start private) ----------
grant execute on function public.jc_admin_entry_spot_set(uuid, text) to authenticated;
