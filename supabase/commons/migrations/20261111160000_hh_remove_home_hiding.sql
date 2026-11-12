-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- HH — remove "hide a home from the directory" (plan docs/plans/HH-remove-home-hiding.md; Zee 2026-11-11: "Remove the
-- hide a home functionality… nothing gets hidden on Jubail"; "we should not let the admin hide a household").
--
-- Live before this migration (2026-11-11): jc_homes.directory_suppressed = true on 0 rows; jc_pets.missing_show_home =
-- true on 0 rows. Nothing anyone sees changes.
--
-- 1. Eight bodies replaced (live pg_get_functiondef, 2026-11-11; signatures, grants, security unchanged), each minus the
--    hidden-home rule only: jc_admin_homes_list (drops key 'suppressed'), jc_directory_list, jc_entry_report,
--    jc_event_get (drops mine.home_hidden; frozen jc_event_signup returns jc_event_get — its signature is untouched),
--    jc_facility_grid, jc_pet_card (the home is always sent for an owned pet; drops 'show_home'),
--    jc_pet_missing_set, jc_pet_retire. Removed keys were read by truthiness in every client → an old page reads false.
-- 2. Dropped: jc_admin_home_suppress(uuid, boolean), jc_pet_missing_home_set(uuid, boolean).
-- 3. Dropped: jc_pets.missing_show_home (+ check jc_pets_show_home_missing), jc_homes.directory_suppressed.
-- Old admin-log rows ('home_suppress') and state-log rows ('pet_missing_home') stay as history.
--
-- DOWN (one transaction, in this order): (1) add jc_homes.directory_suppressed and jc_pets.missing_show_home back
-- (boolean not null default false) + check jc_pets_show_home_missing (missing or not missing_show_home); (2) re-create
-- the eight bodies from: jc_pet_card ← 20261111120000_r5b_pet_home_type; jc_pet_missing_set, jc_pet_retire ←
-- 20261110090000_r5a_pets; jc_facility_grid ← 20261108090000_r4a_courts; jc_event_get ← 20261107090000_r2b_1_organizer_acts;
-- jc_entry_report ← 20261103180000_s2_events; jc_directory_list, jc_admin_homes_list ← 20261103120000_s1_identity_homes;
-- (3) re-create jc_admin_home_suppress (r5a version) and jc_pet_missing_home_set (r5a) with their grants. Applied in
-- one transaction with its history row (/db-rehearse step 6).

CREATE OR REPLACE FUNCTION public.jc_admin_homes_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  return jsonb_build_object(
    'homes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'village', h.village_key, 'type', h.home_type, 'building', h.building,
               'number', h.number_raw, 'lat', h.lat, 'lng', h.lng, 'pin_set_at', h.pin_set_at,
               'flags', h.flags, 'created_at', h.created_at,
               'members', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'user_id', m.user_id,
                          'name', coalesce(a.display_name, jc_mask_email(u.email)),
                          'joined_at', m.joined_at, 'via', m.via) order by m.joined_at)
                   from jc_home_members m
                   join jc_accounts a on a.user_id = m.user_id
                   join auth.users u on u.id = m.user_id
                  where m.home_id = h.id), '[]'::jsonb))
             order by h.village_key, h.building_norm, h.number_norm)
        from jc_homes h where h.community_id = v_comm), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invite_id', i.id, 'home_id', i.home_id,
               'requester', coalesce(a.display_name, jc_mask_email(u.email)),
               'created_at', i.created_at))
        from jc_home_invites i
        join jc_accounts a on a.user_id = i.requested_by
        join auth.users u on u.id = i.requested_by
       where i.community_id = v_comm and i.used_at is null and i.declined_at is null), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_directory_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'village', h.village_key, 'type', h.home_type, 'building', h.building,
             'number', h.number_raw, 'lat', h.lat, 'lng', h.lng)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_homes h
     where h.community_id = v_comm), '[]'::jsonb);   -- HH: no hidden homes
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_entry_report(p_entry uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; en public.jc_event_entries%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  select e.* into en from jc_event_entries e
    join jc_events ev on ev.id = e.event_id
    join jc_homes h on h.id = e.home_id
   where e.id = p_entry and e.community_id = v_comm and e.status = 'in' and not e.hidden
     and ev.status = 'live' and coalesce((ev.features ->> 'crowd_reports')::boolean, false)
     for share of e;  -- serializes with the owner's clear / "done", so their lock is honoured
  if en.id is null then raise exception 'NOT_FOUND'; end if;
  if en.home_id = v_home then raise exception 'OWN_ENTRY'; end if;
  if en.live_state = 'done' then raise exception 'ALREADY_DONE'; end if;
  if en.reports_locked_until > now() then raise exception 'REPORTS_LOCKED'; end if;
  if (select count(*) from jc_entry_reports r join jc_event_entries x on x.id = r.entry_id
       where r.reporter_home = v_home and r.cleared_at is null and x.event_id = en.event_id) >= 10 then
    raise exception 'TOO_MANY_REPORTS';
  end if;
  insert into jc_entry_reports (entry_id, reporter, reporter_home) values (en.id, v_user, v_home)
  on conflict (entry_id, reporter_home) where cleared_at is null do nothing;
  if found then perform jc_log(v_comm, en.event_id, en.id, 'report', 'true'); end if;
  return jsonb_build_object('reported', true);
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
           -- R2b-1: an organizer changed / removed this sign-up (when, never who) — live events only: an archived
           -- event's row may belong to the family before a move-in (vacate keeps history) (security review L1)
           'org_adjusted_at', case when ev.status = 'live' then en.org_adjusted_at end,
           'org_withdrawn_at', case when ev.status = 'live' then en.org_withdrawn_at end,
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
      -- R2a (D2)
      'ends_effective', jc_private.event_ends(ev.starts_at, ev.ends_at),
      'ended', coalesce(jc_private.event_ends(ev.starts_at, ev.ends_at) < now(), false),
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
         -- organizer-hidden entries: visible to their own household only (HH: no hidden homes any more)
         and (not en.hidden or en.home_id = v_home)), '[]'::jsonb)
      when ev.status = 'live' then '[]'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_facility_grid(p_facility uuid, p_tz text, p_date date, p_home uuid, p_admin boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with f as (select * from jc_facilities where id = p_facility),
  slots as (
    select ((p_date + f.open_time) + make_interval(mins => f.slot_minutes * g)) at time zone p_tz as s,
           f.slot_minutes as len
      from f, generate_series(0, (extract(epoch from (f.close_time - f.open_time))::int / 60) / f.slot_minutes - 1) g)
  select coalesce(jsonb_agg(jsonb_build_object(
           'starts_at', sl.s,
           'ends_at', sl.s + make_interval(mins => sl.len),
           'state', case when bl.id is not null then 'blocked'
                         when b.id is not null and b.home_id = p_home then 'mine'
                         when b.id is not null then 'booked'
                         when sl.s <= now() then 'past'
                         else 'free' end,
           'booking_id', case when b.home_id = p_home or p_admin then b.id end,
           -- R4a: the home label (amendment in the header); never a name
           'home', case when b.id is null or bl.id is not null and not p_admin then null
                        when p_admin then
                          jsonb_build_object('id', h.id, 'village', h.village_key, 'type', h.home_type,
                                             'building', h.building, 'number', h.number_raw)
                        when b.home_id is distinct from p_home and not b.is_private then                       -- HH
                          jsonb_build_object('village', h.village_key, 'type', h.home_type,
                                             'building', h.building, 'number', h.number_raw) end,
           'is_private', case when b.home_id = p_home or p_admin then b.is_private end,
           'block_id', case when p_admin then bl.id end,
           'block_reason', bl.reason)                                    -- R4a: residents read it too
         order by sl.s), '[]'::jsonb)
    from slots sl
    left join jc_bookings b on b.facility_id = p_facility and b.starts_at = sl.s and b.status = 'booked'
    left join jc_homes h on h.id = b.home_id
    left join lateral (select x.id, x.reason from jc_booking_blocks x
                        where x.facility_id = p_facility and x.removed_at is null
                          and x.starts_at < sl.s + make_interval(mins => sl.len)
                          and x.ends_at > sl.s
                        order by x.starts_at, x.id
                        limit 1) bl on true;
$function$;

CREATE OR REPLACE FUNCTION public.jc_pet_card(p_pet uuid, p_viewer_home uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'species', p.species, 'name', p.name,
    'description', p.description, 'wanderer', p.wanderer, 'microchipped', p.microchipped,
    'missing', p.missing, 'missing_since', p.missing_since, 'last_seen_note', p.last_seen_note,
    'care_state', p.care_state, 'photo_path', p.photo_path,
    'mine', p.home_id is not null and p.home_id = p_viewer_home,
    'home', case when h.id is not null then                                                      -- HH: always
                   jsonb_build_object('village', h.village_key, 'type', h.home_type,              -- R5b-1b: + type
                                      'building', h.building, 'number', h.number_raw) end,
    'territory', p.territory,                                                                      -- R5a
    'territory_lat', p.territory_lat, 'territory_lng', p.territory_lng,                            -- R5a
    'care', case when p.kind = 'stray' then p.care end)                                            -- R5a
  from jc_pets p left join jc_homes h on h.id = p.home_id
  where p.id = p_pet;
$function$;

CREATE OR REPLACE FUNCTION public.jc_pet_missing_set(p_pet uuid, p_missing boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if p_missing is null or char_length(p_note) > 400 then raise exception 'BAD_FIELDS'; end if;
  p := jc_pet_manage(p_pet);
  if p.kind <> 'owned' then raise exception 'NOT_FOUND'; end if;
  update jc_pets
     set missing = p_missing,
         missing_since = case when p_missing then coalesce(missing_since, now()) end,
         last_seen_note = case when p_missing then left(jc_clean_text(p_note), 200) else null end,
         updated_at = now(), updated_by = v_user
   where id = p.id;
  perform jc_log(v_comm, null, null, 'pet_missing', jsonb_build_object('pet_id', p.id, 'missing', p_missing));
  return jc_pet_card(p.id, v_home);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_pet_retire(p_pet uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update jc_pet_photos set state = 'retired', retired_at = now()
   where pet_id = p_pet and state <> 'retired';
  update jc_pets
     set status = 'archived', missing = false, missing_since = null, last_seen_note = null,
         photo_path = null, pending_photo_path = null, pending_photo_by = null, pending_photo_at = null,
         updated_at = now()
   where id = p_pet and status = 'active';
$function$;

drop function public.jc_admin_home_suppress(uuid, boolean);
drop function public.jc_pet_missing_home_set(uuid, boolean);

alter table public.jc_pets drop constraint jc_pets_show_home_missing, drop column missing_show_home;
alter table public.jc_homes drop column directory_suppressed;
