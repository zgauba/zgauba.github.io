-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T2 / S3 — courts: facility inventory, slot bookings, admin blocks.
-- Plan: docs/plans/T2-schema-batch.md. Builds on S1/S2 rules (RPC-only, community from
-- jc_me, default privileges closed, user references ON DELETE SET NULL).
--
-- Booking rules (wireframes v3/v4.1 + backlog): fixed slot grid per facility
-- (slot_minutes, default 60) between open and close time (same day, whole minutes);
-- bookable from now to window_days ahead (default 7, today counts as day 1); ONE booking
-- per home per local day across all courts (modules.bookings.per_home_per_day, default 1);
-- a booking is exactly one slot (that is the max-length rule); residents cancel any time
-- before the slot starts; admins cancel with a reason; an admin block cancels the bookings
-- it covers. Days are the community's local days (jc_communities.tz). "Official JICM
-- bookings take precedence" is screen copy, not data.
-- Module flag modules.bookings.enabled is the compliance kill switch for every resident RPC.
--
-- Lock order (deadlock-free with S1/S2): facility → home → membership → booking rows (by id).

-- ---------- 1. tables ----------
create table public.jc_facilities (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null references public.jc_communities(id),
  kind          text not null check (kind in ('padel', 'tennis', 'other')),
  name_en       text not null check (char_length(name_en) between 1 and 60),
  name_ar       text check (name_ar is null or char_length(name_ar) <= 60),
  location_note text check (location_note is null or char_length(location_note) <= 200),
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  status        text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  open_time     time not null default '07:00',
  close_time    time not null default '22:00',
  slot_minutes  int not null default 60 check (slot_minutes in (30, 45, 60, 90, 120)),
  window_days   int not null default 7 check (window_days between 1 and 30),
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  -- whole minutes, same-day hours, room for at least one slot (the grid and the slot
  -- validator must never disagree)
  check (extract(second from open_time) = 0 and extract(second from close_time) = 0),
  check (close_time <= '23:59'),
  check (extract(epoch from (close_time - open_time)) >= slot_minutes * 60),
  unique (id, community_id)
);
alter table public.jc_facilities enable row level security;
create index jc_facilities_community on public.jc_facilities (community_id, sort);

create table public.jc_bookings (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null,
  facility_id   uuid not null,
  home_id       uuid not null,
  booked_by     uuid references auth.users(id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  display_name  text check (display_name is null or char_length(display_name) <= 40),  -- opt-in; null = "Booked"
  status        text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  cancelled_by  uuid references auth.users(id) on delete set null,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (facility_id, community_id) references public.jc_facilities(id, community_id),
  foreign key (home_id, community_id) references public.jc_homes(id, community_id)
);
alter table public.jc_bookings enable row level security;
-- the double-booking guard: slots are grid-aligned and exactly one slot long, so
-- "one live booking per facility per start time" is the whole overlap rule
create unique index jc_bookings_slot on public.jc_bookings (facility_id, starts_at) where status = 'booked';
create index jc_bookings_home on public.jc_bookings (home_id, starts_at);
create index jc_bookings_community_time on public.jc_bookings (community_id, starts_at);  -- T4 snapshots
create index jc_bookings_booked_by on public.jc_bookings (booked_by) where booked_by is not null;
create index jc_bookings_cancelled_by on public.jc_bookings (cancelled_by) where cancelled_by is not null;

create table public.jc_booking_blocks (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null,
  facility_id   uuid not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text not null check (char_length(reason) between 3 and 200),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,  -- soft-remove: the history of why courts were closed stays
  check (ends_at > starts_at),
  foreign key (facility_id, community_id) references public.jc_facilities(id, community_id)
);
alter table public.jc_booking_blocks enable row level security;
create index jc_booking_blocks_facility on public.jc_booking_blocks (facility_id, starts_at) where removed_at is null;
create index jc_booking_blocks_created_by on public.jc_booking_blocks (created_by) where created_by is not null;

-- per-home daily quota lives with the module flag (public rule, public config)
update public.jc_communities
   set modules = jsonb_set(modules, '{bookings,per_home_per_day}', '1')
 where modules ? 'bookings';

-- ---------- 2. internal helpers (no grants; explicitly revoked at the bottom) ----------
-- A name other residents will read on the grid: one line, no invisible characters.
create function public.jc_clean_line(p text) returns text
language sql immutable set search_path = public, pg_temp
as $$ select nullif(trim(regexp_replace(jc_clean_text(p), '[\n\r\t​-‏؜  ﻿]', '', 'g')), '') $$;

-- Validates a slot start for a facility; returns its end. Raises BAD_SLOT / OUT_OF_WINDOW.
create function public.jc_slot_check(p_fac public.jc_facilities, p_tz text, p_starts timestamptz)
returns timestamptz
language plpgsql stable set search_path = public, pg_temp
as $$
declare v_local timestamp := p_starts at time zone p_tz;
        v_mins int;
begin
  if p_starts is null or not isfinite(p_starts) then raise exception 'BAD_SLOT'; end if;
  v_mins := extract(epoch from (v_local::time - p_fac.open_time))::int / 60;
  if v_local::time < p_fac.open_time
     or (v_local + make_interval(mins => p_fac.slot_minutes))::time > p_fac.close_time
     or (v_local + make_interval(mins => p_fac.slot_minutes))::date <> v_local::date
     or extract(second from v_local) <> 0
     or v_mins % p_fac.slot_minutes <> 0 then
    raise exception 'BAD_SLOT';
  end if;
  if p_starts <= now()
     or v_local::date > (now() at time zone p_tz)::date + (p_fac.window_days - 1) then
    raise exception 'OUT_OF_WINDOW';
  end if;
  return p_starts + make_interval(mins => p_fac.slot_minutes);
end;
$$;

-- Cancel live bookings in a range for ONE facility or ONE home (never everything).
-- Locks the rows in id order first so concurrent bulk cancels can't deadlock.
-- Returns the cancelled ids (callers log them).
create function public.jc_bookings_cancel_range(p_facility uuid, p_home uuid, p_from timestamptz,
                                                p_to timestamptz, p_reason text) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ids uuid[];
begin
  if p_facility is null and p_home is null then raise exception 'BAD_SCOPE'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from jc_bookings
     where status = 'booked'
       and (p_facility is null or facility_id = p_facility)
       and (p_home is null or home_id = p_home)
       and starts_at < p_to and ends_at > p_from
     order by id
       for update) s;
  update jc_bookings
     set status = 'cancelled', cancel_reason = left(p_reason, 200),
         cancelled_by = auth.uid(), cancelled_at = now()
   where id = any(v_ids);
  return v_ids;
end;
$$;

-- S2's vacancy hook, extended: a household that leaves frees its court slots and takes
-- its opt-in names with it.
create or replace function public.jc_home_vacated(p_home uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- a vacant home starts clean for the next family
  update jc_home_invites set expires_at = least(expires_at, now())
   where home_id = p_home and used_at is null;
  -- the house keeps WHICH events it joined (history, stats); the leaving family's
  -- answers and notes go with them
  update jc_event_entries set payload = '{}', note = null, org_note = null
   where home_id = p_home and (payload <> '{}' or note is not null or org_note is not null);
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
end;
$$;

-- One day's grid for a facility. p_admin adds homes, block ids and reasons; residents
-- see "booked"/"blocked", their own bookings, and opt-in names. Takes an id, never a
-- caller-supplied row.
create function public.jc_facility_grid(p_facility uuid, p_tz text, p_date date,
                                        p_home uuid, p_admin boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
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
           'display_name', case when bl.id is null or p_admin then b.display_name end,
           'home', case when p_admin and b.id is not null then
                     (select jsonb_build_object('id', h.id, 'village', h.village_key,
                                                'building', h.building, 'number', h.number_raw)
                        from jc_homes h where h.id = b.home_id) end,
           'block_id', case when p_admin then bl.id end,
           'block_reason', case when p_admin then bl.reason end)
         order by sl.s), '[]'::jsonb)
    from slots sl
    left join jc_bookings b on b.facility_id = p_facility and b.starts_at = sl.s and b.status = 'booked'
    left join lateral (select x.id, x.reason from jc_booking_blocks x
                        where x.facility_id = p_facility and x.removed_at is null
                          and x.starts_at < sl.s + make_interval(mins => sl.len)
                          and x.ends_at > sl.s
                        order by x.starts_at, x.id
                        limit 1) bl on true;
$$;

create function public.jc_booking_quota(p_comm text) returns int
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when (modules -> 'bookings' ->> 'per_home_per_day') ~ '^[1-9][0-9]?$'
              then (modules -> 'bookings' ->> 'per_home_per_day')::int else 1 end
    from jc_communities where id = p_comm;
$$;

-- ---------- 3. resident RPCs ----------
create function public.jc_facilities_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'name_en', f.name_en, 'name_ar', f.name_ar,
             'location_note', f.location_note, 'lat', f.lat, 'lng', f.lng,
             'open_time', f.open_time, 'close_time', f.close_time,
             'slot_minutes', f.slot_minutes, 'window_days', f.window_days)
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm and f.status = 'published'), '[]'::jsonb);
end;
$$;

-- Residents with a home only: the grid carries neighbours' opt-in names.
create function public.jc_facility_day(p_facility uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_window int; v_tz text; v_today date;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then raise exception 'NO_HOME'; end if;
  select window_days into v_window from jc_facilities
   where id = p_facility and community_id = v_comm and status = 'published';
  if v_window is null then raise exception 'NOT_FOUND'; end if;
  select tz into v_tz from jc_communities where id = v_comm;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date < v_today or p_date > v_today + (v_window - 1) then
    raise exception 'OUT_OF_WINDOW';
  end if;
  return jsonb_build_object('facility_id', p_facility, 'date', p_date,
                            'slots', jc_facility_grid(p_facility, v_tz, p_date, v_home, false));
end;
$$;

create function public.jc_booking_create(p_facility uuid, p_starts timestamptz, p_display_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; f public.jc_facilities%rowtype;
        v_tz text; v_ends timestamptz; v_day date; v_name text; v_id uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then raise exception 'NO_HOME'; end if;
  if char_length(p_display_name) > 200 then raise exception 'BAD_NAME'; end if;  -- cap before cleaning
  -- FOR SHARE on the facility: conflicts with retire / re-grid / block creation (FOR UPDATE)
  select * into f from jc_facilities
   where id = p_facility and community_id = v_comm and status = 'published' for share;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  -- home row first (serializes the household's quota), then membership — same order as detach
  perform 1 from jc_homes where id = v_home for update;
  perform jc_home_hold(v_user, v_home);
  select tz into v_tz from jc_communities where id = v_comm;
  v_ends := jc_slot_check(f, v_tz, p_starts);
  v_day := (p_starts at time zone v_tz)::date;

  if exists (select 1 from jc_booking_blocks
              where facility_id = f.id and removed_at is null
                and starts_at < v_ends and ends_at > p_starts) then
    raise exception 'SLOT_BLOCKED';
  end if;
  if (select count(*) from jc_bookings
       where home_id = v_home and status = 'booked'
         and (starts_at at time zone v_tz)::date = v_day) >= jc_booking_quota(v_comm) then
    raise exception 'QUOTA_REACHED';
  end if;

  v_name := jc_clean_line(p_display_name);
  if char_length(v_name) > 40 then raise exception 'BAD_NAME'; end if;
  begin
    insert into jc_bookings (community_id, facility_id, home_id, booked_by, starts_at, ends_at, display_name)
    values (v_comm, f.id, v_home, v_user, p_starts, v_ends, v_name)
    returning id into v_id;
  exception when unique_violation then raise exception 'SLOT_TAKEN';
  end;
  perform jc_log(v_comm, null, null, 'booking', jsonb_build_object('booking_id', v_id, 'facility_id', f.id, 'starts_at', p_starts));
  return jsonb_build_object('booking_id', v_id, 'starts_at', p_starts, 'ends_at', v_ends,
                            'day', jc_facility_grid(f.id, v_tz, v_day, v_home, false));
end;
$$;

-- One tap, any time before the slot starts.
create function public.jc_booking_cancel(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_id uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  perform jc_home_hold(v_user, v_home);
  update jc_bookings
     set status = 'cancelled', cancelled_by = v_user, cancelled_at = now(), cancel_reason = null
   where id = p_booking and home_id = v_home and status = 'booked' and starts_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;
  perform jc_log(v_comm, null, null, 'booking_cancel', jsonb_build_object('booking_id', v_id));
  return jc_my_bookings();
end;
$$;

-- Upcoming bookings for the home, plus admin cancellations made since the caller joined
-- (with the reason) so nobody walks to a court that was taken away. A new family never
-- sees the last family's bookings.
create function public.jc_my_bookings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_joined timestamptz;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then return '[]'::jsonb; end if;
  select joined_at into v_joined from jc_home_members where user_id = v_user;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'facility_id', b.facility_id, 'facility', f.name_en, 'facility_ar', f.name_ar,
             'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
             'display_name', case when b.status = 'booked' then b.display_name end,
             'cancel_reason', b.cancel_reason)
           order by b.starts_at)
      from jc_bookings b join jc_facilities f on f.id = b.facility_id
     where b.home_id = v_home and b.ends_at > now()
       and (b.status = 'booked'
            or (b.cancel_reason is not null
                and b.cancelled_at > greatest(now() - interval '7 days', v_joined)))), '[]'::jsonb);
end;
$$;

-- ---------- 4. admin RPCs (bookings scope or community) ----------
create function public.jc_admin_facilities_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('bookings');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'name_en', f.name_en, 'name_ar', f.name_ar,
             'location_note', f.location_note, 'lat', f.lat, 'lng', f.lng, 'status', f.status,
             'open_time', f.open_time, 'close_time', f.close_time, 'slot_minutes', f.slot_minutes,
             'window_days', f.window_days, 'sort', f.sort,
             'upcoming', (select count(*) from jc_bookings b
                           where b.facility_id = f.id and b.status = 'booked' and b.starts_at > now()))
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm), '[]'::jsonb);
end;
$$;

-- Create (p_facility null) or edit. The slot grid (open/close/slot length) is locked
-- while future bookings exist — re-gridding under live bookings would misalign them.
create function public.jc_admin_facility_save(p_facility uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_id uuid := p_facility; v_status text;
begin
  v_comm := jc_assert_admin('bookings');
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('kind', 'name_en', 'name_ar', 'location_note', 'lat', 'lng',
                                 'open_time', 'close_time', 'slot_minutes', 'window_days', 'sort')) then
    raise exception 'BAD_FIELDS';
  end if;
  if p_fields ? 'name_en' and jc_clean_line(p_fields ->> 'name_en') is null then raise exception 'BAD_FIELDS'; end if;
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
      if (p_fields ?| array['open_time', 'close_time', 'slot_minutes'])
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
      sort          = case when p_fields ? 'sort' then (p_fields ->> 'sort')::int else sort end
     where id = v_id;
  exception
    when check_violation or invalid_datetime_format or datetime_field_overflow
         or invalid_text_representation or numeric_value_out_of_range then raise exception 'BAD_FIELDS';
  end;
  perform jc_admin_log_add(v_comm, 'facility_save', jsonb_build_object(
    'facility_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_admin_facilities_list();
end;
$$;

-- draft → published; draft|published → retired (cancels every future booking, with the reason).
create function public.jc_admin_facility_status(p_facility uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_from text; v_ids uuid[] := '{}';
begin
  v_comm := jc_assert_admin('bookings');
  select status into v_from from jc_facilities where id = p_facility and community_id = v_comm for update;
  if v_from is null then raise exception 'NOT_FOUND'; end if;
  if not ((v_from = 'draft' and p_status in ('published', 'retired'))
          or (v_from = 'published' and p_status = 'retired')) then
    raise exception 'BAD_STATE';
  end if;
  update jc_facilities set status = p_status where id = p_facility;
  if p_status = 'retired' then
    v_ids := jc_bookings_cancel_range(p_facility, null, now(), 'infinity', 'Court no longer available');
  end if;
  perform jc_admin_log_add(v_comm, 'facility_status', jsonb_build_object(
    'facility_id', p_facility, 'status', p_status, 'bookings_cancelled', to_jsonb(v_ids)));
  return jc_admin_facilities_list();
end;
$$;

-- The admin grid: any facility (drafts included, so a court can be checked before
-- publishing), any date, with homes, block ids and block reasons.
create function public.jc_admin_facility_day(p_facility uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_tz text;
begin
  v_comm := jc_assert_admin('bookings');
  if not exists (select 1 from jc_facilities where id = p_facility and community_id = v_comm) then
    raise exception 'NOT_FOUND';
  end if;
  if p_date is null then raise exception 'BAD_FIELDS'; end if;
  select tz into v_tz from jc_communities where id = v_comm;
  return jsonb_build_object('facility_id', p_facility, 'date', p_date,
                            'slots', jc_facility_grid(p_facility, v_tz, p_date, null, true));
end;
$$;

create function public.jc_admin_booking_cancel(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_reason text; v_fac uuid;
begin
  v_comm := jc_assert_admin('bookings');
  if char_length(p_reason) > 400 then raise exception 'REASON_REQUIRED'; end if;
  v_reason := jc_clean_line(p_reason);
  if v_reason is null or char_length(v_reason) not between 3 and 200 then raise exception 'REASON_REQUIRED'; end if;
  update jc_bookings
     set status = 'cancelled', cancel_reason = v_reason, cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_booking and community_id = v_comm and status = 'booked' and ends_at > now()
  returning facility_id into v_fac;
  if v_fac is null then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'booking_cancel', jsonb_build_object('booking_id', p_booking, 'reason', v_reason));
  return jc_admin_facilities_list();
end;
$$;

-- A booked name that impersonates ("JICM Official") or offends: admins clear it, the booking stays.
create function public.jc_admin_booking_name_clear(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_id uuid;
begin
  v_comm := jc_assert_admin('bookings');
  update jc_bookings set display_name = null
   where id = p_booking and community_id = v_comm and display_name is not null
  returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'booking_name_clear', jsonb_build_object('booking_id', p_booking));
  return jsonb_build_object('booking_id', v_id, 'name_cleared', true);
end;
$$;

-- Block a range (maintenance, tournament, an official JICM booking). Bookings it covers
-- are cancelled with the reason attached, so residents see why.
create function public.jc_admin_block_create(p_facility uuid, p_starts timestamptz, p_ends timestamptz,
                                             p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_reason text; v_id uuid; v_ids uuid[];
begin
  v_comm := jc_assert_admin('bookings');
  if char_length(p_reason) > 400 then raise exception 'REASON_REQUIRED'; end if;
  v_reason := jc_clean_line(p_reason);
  if v_reason is null or char_length(v_reason) not between 3 and 200 then raise exception 'REASON_REQUIRED'; end if;
  if p_starts is null or p_ends is null or not isfinite(p_starts) or not isfinite(p_ends)
     or p_ends <= p_starts or p_ends <= now() or p_ends - p_starts > interval '31 days' then
    raise exception 'BAD_FIELDS';
  end if;
  -- FOR UPDATE (not SHARE): waits for in-flight bookings to commit so the cancel below
  -- sees them, and makes later bookings wait until this block is visible
  perform 1 from jc_facilities where id = p_facility and community_id = v_comm and status <> 'retired' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into jc_booking_blocks (community_id, facility_id, starts_at, ends_at, reason, created_by)
  values (v_comm, p_facility, p_starts, p_ends, v_reason, auth.uid())
  returning id into v_id;
  v_ids := jc_bookings_cancel_range(p_facility, null, greatest(p_starts, now()), p_ends, 'Court blocked: ' || v_reason);
  perform jc_admin_log_add(v_comm, 'block_create', jsonb_build_object(
    'block_id', v_id, 'facility_id', p_facility, 'starts_at', p_starts, 'ends_at', p_ends,
    'bookings_cancelled', to_jsonb(v_ids)));
  return jsonb_build_object('block_id', v_id, 'bookings_cancelled', cardinality(v_ids));
end;
$$;

create function public.jc_admin_block_remove(p_block uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_id uuid;
begin
  v_comm := jc_assert_admin('bookings');
  update jc_booking_blocks set removed_at = now()
   where id = p_block and community_id = v_comm and removed_at is null
  returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'block_remove', jsonb_build_object('block_id', p_block));
  return jsonb_build_object('block_id', v_id, 'removed', true);
end;
$$;

-- ---------- 5. grants (new functions start closed; helpers revoked explicitly too) ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function
  public.jc_clean_line(text),
  public.jc_slot_check(public.jc_facilities, text, timestamptz),
  public.jc_bookings_cancel_range(uuid, uuid, timestamptz, timestamptz, text),
  public.jc_facility_grid(uuid, text, date, uuid, boolean),
  public.jc_booking_quota(text)
from public, anon, authenticated;

grant execute on function
  public.jc_facilities_list(),
  public.jc_facility_day(uuid, date),
  public.jc_booking_create(uuid, timestamptz, text),
  public.jc_booking_cancel(uuid),
  public.jc_my_bookings(),
  public.jc_admin_facilities_list(),
  public.jc_admin_facility_save(uuid, jsonb),
  public.jc_admin_facility_status(uuid, text),
  public.jc_admin_facility_day(uuid, date),
  public.jc_admin_booking_cancel(uuid, text),
  public.jc_admin_booking_name_clear(uuid),
  public.jc_admin_block_create(uuid, timestamptz, timestamptz, text),
  public.jc_admin_block_remove(uuid)
to authenticated;
