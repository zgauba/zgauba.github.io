-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.2 PR 3a (plan docs/plans/T5-2-plan.md, decisions Q2 / Q4):
--   1. organizers move pins — the HOME's pin (fixes it everywhere) or an EVENT-ONLY pin
--      for one sign-up (e.g. the garden gate for one night); both admin-logged with the
--      old and new spot, so a wrong move can be undone;
--   2. organizers set the community broadcast (the column + jc_config_get already exist);
--   3. jc_event_signup refuses a home with no pin (NO_PIN) — the screen turns it into
--      "pin your home" and back; signature unchanged (frozen);
--   4. jc_schema_check caps the builder's wording (labels / glyphs / pin) — PR #26/#27 reviews.
-- Scope: events organizers (or community admins) — jc_assert_admin('events').
-- Bodies of replaced functions are the live ones (verified identical to S2 / S4) plus the
-- marked T5.2 lines only.
-- Rollback (down):
--   drop function public.jc_admin_broadcast_set(text),
--     public.jc_admin_home_pin_set(uuid, double precision, double precision),
--     public.jc_admin_entry_pin_set(uuid, double precision, double precision);
--   re-create jc_event_get / jc_event_signup / jc_admin_entries_list / jc_schema_check from
--     20261103180000_s2_events.sql and jc_home_vacated from 20261104000000_s4_pets.sql;
--   alter table public.jc_communities drop constraint jc_communities_broadcast_len;
--   alter table public.jc_event_entries drop constraint jc_event_entries_event_pin,
--     drop column event_lat, drop column event_lng;

-- ---------- 1. columns ----------
alter table public.jc_event_entries
  add column event_lat double precision,
  add column event_lng double precision,
  add constraint jc_event_entries_event_pin check (
        (event_lat is null and event_lng is null)
     or (event_lat between -90 and 90 and event_lng between -180 and 180));
alter table public.jc_communities
  add constraint jc_communities_broadcast_len check (char_length(broadcast) <= 280);

-- ---------- 2. replaced functions (same signatures) ----------
create or replace function public.jc_event_get(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; ev public.jc_events%rowtype; v_mine jsonb;
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
           'reports_open', (select count(*) from jc_entry_reports r
                             where r.entry_id = en.id and r.cleared_at is null))
    into v_mine
    from jc_event_entries en where en.event_id = ev.id and en.home_id = v_home;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
      'description_en', ev.description_en, 'description_ar', ev.description_ar,
      'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
      'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
      'payload_schema', ev.payload_schema, 'safety', ev.safety),
    'mine', v_mine,
    'stats', case when ev.status = 'archived'
                  then (select st.snapshot from jc_event_stats st where st.event_id = ev.id) end,
    'entries', case when ev.status = 'live' then coalesce((
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
         and ((not en.hidden and not h.directory_suppressed) or en.home_id = v_home)), '[]'::jsonb) end);
end;
$$;

-- FROZEN SIGNATURE (see S2). Body adds the NO_PIN check only.
create or replace function public.jc_event_signup(p_event uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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
  if not exists (select 1 from jc_homes where id = v_home and lat is not null)
     and not exists (select 1 from jc_event_entries
                      where event_id = ev.id and home_id = v_home and event_lat is not null) then
    raise exception 'NO_PIN';
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
        updated_at = now(), updated_by = excluded.updated_by
  returning id into v_entry;
  perform jc_log(v_comm, ev.id, v_entry, 'signup', v_clean);
  return jc_event_get(ev.id);
end;
$$;

create or replace function public.jc_admin_entries_list(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');
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
             'reports_open', (select count(*) from jc_entry_reports r where r.entry_id = en.id and r.cleared_at is null),
             'created_at', en.created_at, 'updated_at', en.updated_at)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_event_entries en join jc_homes h on h.id = en.home_id
     where en.event_id = p_event), '[]'::jsonb);
end;
$$;

create or replace function public.jc_home_vacated(p_home uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- a vacant home starts clean for the next family
  update jc_home_invites set expires_at = least(expires_at, now())
   where home_id = p_home and used_at is null;
  -- the house keeps WHICH events it joined (history, stats); the leaving family's
  -- answers and notes go with them
  update jc_event_entries set payload = '{}', note = null, org_note = null,
                              event_lat = null, event_lng = null  -- T5.2: the event-only pin too
   where home_id = p_home and (payload <> '{}' or note is not null or org_note is not null
                               or event_lat is not null);
  -- and it stops appearing in live events
  update jc_event_entries en set status = 'withdrawn', updated_at = now()
   where en.home_id = p_home and en.status = 'in' and en.archived_at is null
     and exists (select 1 from jc_events ev where ev.id = en.event_id and ev.status = 'live');
  update jc_entry_reports r set cleared_at = now()
    from jc_event_entries en
   where r.entry_id = en.id and en.home_id = p_home and r.cleared_at is null;
  -- S3: future court bookings are released, and no booking keeps the family's name
  perform jc_bookings_cancel_range(null, p_home, now(), 'infinity', 'Household left');
  update jc_bookings set display_name = null where home_id = p_home and display_name is not null;
  -- S4: the family's pets leave with them
  perform jc_pet_retire(id) from jc_pets where home_id = p_home and status = 'active';
end;
$$;

create or replace function public.jc_schema_check(p jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp
as $$
declare f record; mk text; lim int;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'BAD_SCHEMA'; end if;
  if jsonb_typeof(coalesce(p -> 'fields', '{}')) <> 'object' then raise exception 'BAD_SCHEMA'; end if;
  if (select count(*) from jsonb_object_keys(coalesce(p -> 'fields', '{}'))) > 12 then raise exception 'BAD_SCHEMA'; end if;
  for f in select key, value from jsonb_each(coalesce(p -> 'fields', '{}')) loop
    if f.key !~ '^[a-z][a-z0-9_]{0,30}$' or f.key = 'note' or jsonb_typeof(f.value) <> 'object' then
      raise exception 'BAD_SCHEMA';
    end if;
    if coalesce(f.value ->> 'type', '') not in ('enum', 'text', 'bool') then raise exception 'BAD_SCHEMA'; end if;
    if f.value ? 'required' and jsonb_typeof(f.value -> 'required') <> 'boolean' then raise exception 'BAD_SCHEMA'; end if;
    if f.value ->> 'type' = 'enum' then
      if jsonb_typeof(f.value -> 'values') is distinct from 'array' then raise exception 'BAD_SCHEMA'; end if;
      if jsonb_array_length(f.value -> 'values') not between 1 and 20
         or exists (select 1 from jsonb_array_elements(f.value -> 'values') x
                     where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and 40) then
        raise exception 'BAD_SCHEMA';
      end if;
    end if;
    -- T5.2: the wording the builder stores — bounded strings (PR #26/#27 reviews). Every
    -- screen escapes them; the caps keep a future slip from becoming stored XSS at scale.
    foreach mk in array array['label_en', 'label_ar'] loop
      if f.value ? mk and (jsonb_typeof(f.value -> mk) <> 'string'
                           or char_length(f.value ->> mk) not between 1 and 200) then
        raise exception 'BAD_SCHEMA';
      end if;
    end loop;
    foreach mk in array array['labels_en', 'labels_ar', 'glyphs'] loop
      lim := case when mk = 'glyphs' then 16 else 80 end;
      if f.value ? mk and (jsonb_typeof(f.value -> mk) <> 'object'
          or exists (select 1 from jsonb_each(f.value -> mk) x
                      where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') not between 1 and lim)) then
        raise exception 'BAD_SCHEMA';
      end if;
    end loop;
    if f.value ? 'pin' and (f.value ->> 'type' <> 'enum' or coalesce(f.value ->> 'pin', '') not in ('ring', 'glyph')) then
      raise exception 'BAD_SCHEMA';
    end if;
    if f.value ? 'max' then
      if jsonb_typeof(f.value -> 'max') <> 'number' then raise exception 'BAD_SCHEMA'; end if;
      if (f.value ->> 'max')::numeric not between 1 and 280
         or (f.value ->> 'max')::numeric <> trunc((f.value ->> 'max')::numeric) then
        raise exception 'BAD_SCHEMA';
      end if;
    end if;
  end loop;
end;
$$;

-- ---------- 3. new organizer RPCs ----------
-- The community banner every page shows (empty = none). Public text by design.
create function public.jc_admin_broadcast_set(p_text text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_text text;
begin
  v_comm := jc_assert_admin('events');
  v_text := coalesce(jc_clean_text(p_text), '');
  if char_length(v_text) > 280 then raise exception 'TOO_LONG'; end if;
  update jc_communities set broadcast = v_text where id = v_comm;
  perform jc_admin_log_add(v_comm, 'broadcast_set', jsonb_build_object('text', v_text));
  return jsonb_build_object('broadcast', v_text);
end;
$$;

-- Move a home's own pin (pin hygiene). Resolves any open pin flag on the home.
create function public.jc_admin_home_pin_set(p_home uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; h public.jc_homes%rowtype; v_far boolean;
begin
  v_comm := jc_assert_admin('events');
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BAD_PIN';
  end if;
  select * into h from jc_homes where id = p_home and community_id = v_comm for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  select jc_dist_m(p_lat, p_lng, c.map_lat, c.map_lng) > 10000 into v_far
    from jc_communities c where c.id = v_comm;
  update jc_homes
     set lat = p_lat, lng = p_lng, pin_set_at = now(),
         flags = (flags - 'pin_far' - 'pin_near') || case when v_far then '{"pin_far": true}'::jsonb else '{}'::jsonb end
   where id = p_home;
  update jc_admin_notices set resolved_at = now(), resolved_by = auth.uid()
   where community_id = v_comm and home_id = p_home and kind = 'pin_flag' and resolved_at is null;
  perform jc_admin_log_add(v_comm, 'home_pin_set', jsonb_build_object(
    'home_id', p_home,
    'from', case when h.lat is null then null else jsonb_build_array(h.lat, h.lng) end,
    'to', jsonb_build_array(p_lat, p_lng)));
  return jsonb_build_object('home_id', p_home, 'lat', p_lat, 'lng', p_lng, 'far', v_far);
end;
$$;

-- An event-only pin for one sign-up (null, null clears it → back to the home's pin).
create function public.jc_admin_entry_pin_set(p_entry uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; en public.jc_event_entries%rowtype;
begin
  v_comm := jc_assert_admin('events');
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'BAD_PIN';
  end if;
  select * into en from jc_event_entries
   where id = p_entry and community_id = v_comm and archived_at is null for update;
  if en.id is null then raise exception 'NOT_FOUND'; end if;
  update jc_event_entries set event_lat = p_lat, event_lng = p_lng, updated_at = now() where id = p_entry;
  perform jc_admin_log_add(v_comm, 'entry_pin_set', jsonb_build_object(
    'entry_id', p_entry, 'event_id', en.event_id,
    'from', case when en.event_lat is null then null else jsonb_build_array(en.event_lat, en.event_lng) end,
    'to', case when p_lat is null then null else jsonb_build_array(p_lat, p_lng) end));
  return jc_admin_entries_list(en.event_id);
end;
$$;

-- ---------- 4. grants (default privileges are closed: new functions start private) ----------
grant execute on function public.jc_admin_broadcast_set(text),
  public.jc_admin_home_pin_set(uuid, double precision, double precision),
  public.jc_admin_entry_pin_set(uuid, double precision, double precision) to authenticated;
