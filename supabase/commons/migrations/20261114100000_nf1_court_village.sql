-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- NF-1 — courts get an optional village. Plan: docs/plans/nearest-first.md "NF-1" (Zee decisions 2026-11-14).
--
-- The village tells people WHERE a court is. It never limits who can book it (booking rules are unchanged).
-- null = "Whole community".
--
-- A. jc_facilities.village_key text null, with a foreign key on (community_id, village_key) → jc_villages, the
--    same pair homes use. Default MATCH SIMPLE: a null village is never checked. A village a court points at can't be
--    deleted (NO ACTION), and another community's village can't be set.
-- B. jc_admin_facility_save accepts 'village_key' (a key, or null / "" to clear). An unknown village gives BAD_FIELDS.
-- C. jc_admin_facilities_list and jc_facilities_list return 'village_key'. Server order unchanged
--    (the phone sorts: nearest-first for residents, A–Z by village for organizers — NF-2 / NF-3).
-- Bodies only, from the live definitions (2026-11-14); changes marked "-- NF-1". No signature change.

-- ---------- A ----------
alter table public.jc_facilities add column village_key text;
alter table public.jc_facilities add constraint jc_facilities_village_fk
  foreign key (community_id, village_key) references public.jc_villages(community_id, key);

-- ---------- B ----------
CREATE OR REPLACE FUNCTION public.jc_admin_facility_save(p_facility uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_id uuid := p_facility; v_status text;
begin
  v_comm := jc_assert_admin('bookings');
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('kind', 'name_en', 'name_ar', 'location_note', 'lat', 'lng',
                                 'open_time', 'close_time', 'slot_minutes', 'window_days', 'sort',
                                 'walk_on', 'village_key')) then                     -- R4a; NF-1 village_key
    raise exception 'BAD_FIELDS';
  end if;
  if p_fields ? 'name_en' and jc_clean_line(p_fields ->> 'name_en') is null then raise exception 'BAD_FIELDS'; end if;
  if p_fields ? 'walk_on' and jsonb_typeof(p_fields -> 'walk_on') <> 'boolean' then raise exception 'BAD_FIELDS'; end if;  -- R4a
  if p_fields ? 'village_key' and jsonb_typeof(p_fields -> 'village_key') not in ('string', 'null') then   -- NF-1
    raise exception 'BAD_FIELDS';
  end if;
  begin
    if v_id is null then
      if not p_fields ? 'name_en' or coalesce(p_fields ->> 'kind', '') = '' then raise exception 'BAD_FIELDS'; end if;
      insert into jc_facilities (community_id, kind, name_en)
      values (v_comm, p_fields ->> 'kind', jc_clean_line(p_fields ->> 'name_en'))
      returning id into v_id;
    else
      select status into v_status from jc_facilities where id = v_id and community_id = v_comm for update;
      if v_status is null then raise exception 'NOT_FOUND'; end if;
      if v_status = 'retired' then raise exception 'FACILITY_RETIRED'; end if;
      if ((p_fields ?| array['open_time', 'close_time', 'slot_minutes'])
          or (p_fields -> 'walk_on') = 'true'::jsonb)                                -- R4a
         and exists (select 1 from jc_bookings where facility_id = v_id and status = 'booked' and ends_at > now()) then
        raise exception 'RULES_LOCKED';
      end if;
    end if;
    update jc_facilities set
      kind          = coalesce(p_fields ->> 'kind', kind),
      name_en       = coalesce(jc_clean_line(p_fields ->> 'name_en'), name_en),
      name_ar       = case when p_fields ? 'name_ar' then jc_clean_line(p_fields ->> 'name_ar') else name_ar end,
      location_note = case when p_fields ? 'location_note' then jc_clean_text(p_fields ->> 'location_note') else location_note end,
      lat           = case when p_fields ? 'lat' then (p_fields ->> 'lat')::double precision else lat end,
      lng           = case when p_fields ? 'lng' then (p_fields ->> 'lng')::double precision else lng end,
      open_time     = case when p_fields ? 'open_time' then (p_fields ->> 'open_time')::time else open_time end,
      close_time    = case when p_fields ? 'close_time' then (p_fields ->> 'close_time')::time else close_time end,
      slot_minutes  = case when p_fields ? 'slot_minutes' then (p_fields ->> 'slot_minutes')::int else slot_minutes end,
      window_days   = case when p_fields ? 'window_days' then (p_fields ->> 'window_days')::int else window_days end,
      sort          = case when p_fields ? 'sort' then (p_fields ->> 'sort')::int else sort end,
      walk_on       = case when p_fields ? 'walk_on' then (p_fields ->> 'walk_on')::boolean else walk_on end,  -- R4a
      village_key   = case when p_fields ? 'village_key' then nullif(btrim(p_fields ->> 'village_key'), '')
                           else village_key end                                      -- NF-1 (null / "" = Whole community)
     where id = v_id;
  exception
    when check_violation or invalid_datetime_format or datetime_field_overflow
         or invalid_text_representation or numeric_value_out_of_range
         or foreign_key_violation then raise exception 'BAD_FIELDS';                -- NF-1: unknown / other community's village
  end;
  perform jc_admin_log_add(v_comm, 'facility_save', jsonb_build_object(
    'facility_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_admin_facilities_list();
end;
$function$;

-- ---------- C ----------
CREATE OR REPLACE FUNCTION public.jc_admin_facilities_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('bookings');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'name_en', f.name_en, 'name_ar', f.name_ar,
             'location_note', f.location_note, 'lat', f.lat, 'lng', f.lng, 'status', f.status,
             'open_time', f.open_time, 'close_time', f.close_time, 'slot_minutes', f.slot_minutes,
             'window_days', f.window_days, 'sort', f.sort, 'walk_on', f.walk_on,            -- R4a
             'village_key', f.village_key,                                                    -- NF-1
             'upcoming', (select count(*) from jc_bookings b
                           where b.facility_id = f.id and b.status = 'booked' and b.starts_at > now()))
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_facilities_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'name_en', f.name_en, 'name_ar', f.name_ar,
             'location_note', f.location_note, 'lat', f.lat, 'lng', f.lng,
             'open_time', f.open_time, 'close_time', f.close_time,
             'slot_minutes', f.slot_minutes, 'window_days', f.window_days,
             'walk_on', f.walk_on,                                                      -- R4a
             'village_key', f.village_key)                                              -- NF-1
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm and f.status = 'published'), '[]'::jsonb);
end;
$function$;
