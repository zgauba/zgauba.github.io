-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R4a — courts schema to spec (plan docs/plans/R4-courts.md, "Decisions (Zee, 2026-11-08)" override the
-- recommendations). Builds on S3 (20261103210000_s3_courts.sql), which is live and unused (0 facilities,
-- 0 bookings, 0 blocks on 2026-11-08). Every replaced body starts from the LIVE definition
-- (pg_get_functiondef, 2026-11-08, identical to the S3 file); changes are marked "R4a".
--
-- ZERO-PII PROMISE AMENDMENT (Zee, 2026-11-08, decision 7 — disclosed, not silent):
--   A court booking shows the BOOKING HOME's label (village, type, building, number) to other residents BY
--   DEFAULT. The household can mark a booking private (jc_booking_book(..., true) or jc_booking_privacy_set);
--   others then see only "Booked". A home the admins suppressed from the directory always shows as "Booked".
--   NEVER a person's name: S3's opt-in display_name is gone (create ignores it, the grid drops it, and
--   check (display_name is null) makes it a data rule). The server decides what other homes see; the client
--   cannot leak it. Admins always see the home. Trade-off accepted by Zee: with the 90-day retention below,
--   any resident can see which homes play when. The booking screen and the privacy text say so (R4c).
--
-- What changes
--   (a) kind: tennis | basketball only (raises first if any other kind exists: 0 rows today).
--   (b) no names on bookings (above). Left in place for the R7 grant audit: the display_name column,
--       jc_admin_booking_name_clear, and the null-out line in jc_home_vacated (not re-created here).
--   (c) Unpublish: published -> draft, cancels the court's future bookings ("Court temporarily unavailable").
--   (d) per-home ACTIVE cap: modules.bookings.per_home_active (default 2, set on every community that has a
--       bookings module), upcoming booked slots across all courts, checked under the home row lock ->
--       ACTIVE_CAP_REACHED. A malformed value falls back to 2 (the strict default), like per_home_per_day.
--   (e) walk_on per court: listed (pin, hours) with no grid; jc_facility_day / booking -> WALK_ON. Switching a
--       court to walk-on while it holds future bookings -> RULES_LOCKED. No fees (no fee_note).
--   (f) is_private per booking (amendment above). New RPCs, no overloads (frozen signatures untouched):
--       jc_booking_book(p_facility, p_starts, p_private) — the booking RPC R4c uses (null p_private ->
--       BAD_FIELDS, never public by accident);
--       jc_booking_create(p_facility, p_starts, p_display_name) keeps its signature and calls it with false;
--       jc_booking_privacy_set(p_booking, p_private) — the owning home flips it before the slot starts.
--   (g) block reasons are resident-facing: the grid shows the reason on a blocked slot to everyone (they were
--       already cleaned with jc_clean_line and capped 3–200 on write; unchanged).
--   (h) retention: daily cron jc-courts-purge (03:45 UTC) runs jc_courts_retention(): first rolls every ended
--       booking up into jc_court_hours (per court, per hour: booked / cancelled counts; NO home, NO user, kept
--       indefinitely), then deletes bookings whose hour is more than 90 days old, removed blocks that ended
--       more than 90 days ago, and the booking / booking_cancel jc_state_log rows older than 90 days (these
--       carry the booker's user id). Logged to jc_maintenance_log as courts_purge.
--   (i) effective rules for admins: jc_admin_booking_rules() returns the values after fallback next to the
--       raw config, so a typo in the hand-edited jsonb is visible (premortem 2b(i)).
--   Kill switch unchanged: module off -> every resident RPC (incl. the two new ones) raises MODULE_OFF;
--   bookings are kept and come back when it is switched on. Admin RPCs still work while it is off.
--
-- Module admins (Zee decision 10): already general on the server. jc_codes / jc_admin_grants carry one code
-- per module scope (community, events, bookings, pets); a community admin rotates a module's code
-- (jc_admin_code_rotate) and hands it to that module's admin; jc_assert_admin(scope) accepts that scope OR
-- community; rotation revokes every holder. All courts admin RPCs (old and new) use jc_assert_admin('bookings').
-- Per-person assignment by invite link (like per-event admins) is NOT in R4a — see the PR.
--
-- Accepted (reviews 2026-11-08): "upcoming" for the active cap = not yet started (a slot in progress doesn't
-- count); never-removed blocks are kept as the history of closures (only REMOVED blocks are purged, per the
-- decision; they carry the admin's id, never a resident's); jc_admin_log (admin acts: booking ids, admin
-- reasons, admin ids; no home id, no resident id) keeps its own no-expiry policy.
--
-- Lock order unchanged: facility -> home -> membership -> booking rows (by id).
--
-- Rollback (manual; the tables are empty until R4c ships):
--   select cron.unschedule('jc-courts-purge'); drop function jc_courts_retention(), jc_booking_book(uuid,
--   timestamptz, boolean), jc_booking_privacy_set(uuid, boolean), jc_admin_booking_rules(),
--   jc_booking_active_cap(text); drop table jc_court_hours; alter table jc_bookings drop constraint
--   jc_bookings_no_name, drop column is_private; alter table jc_facilities drop column walk_on; swap
--   jc_facilities_kind_check back to ('padel','tennis','other'); restore jc_maintenance_log_job_check without
--   'courts_purge'; re-create jc_facility_grid, jc_booking_create, jc_facilities_list, jc_facility_day,
--   jc_my_bookings, jc_admin_facilities_list, jc_admin_facility_save, jc_admin_facility_status from the S3 file.

-- ---------- 1. tables ----------
-- (a) kind swap, guarded
do $g$
begin
  if exists (select 1 from public.jc_facilities where kind not in ('tennis', 'basketball')) then
    raise exception 'R4a: jc_facilities has rows of another kind; migrate them first';
  end if;
end
$g$;
alter table public.jc_facilities
  drop constraint jc_facilities_kind_check,
  add constraint jc_facilities_kind_check check (kind in ('tennis', 'basketball'));

-- (e) walk-on courts
alter table public.jc_facilities add column walk_on boolean not null default false;

-- (b) + (f) no names; per-booking privacy (scrub first, so the constraint can't fail on a stray name)
update public.jc_bookings set display_name = null where display_name is not null;
alter table public.jc_bookings
  add constraint jc_bookings_no_name check (display_name is null),
  add column is_private boolean not null default false;

-- (h) per-court, per-hour counts: no home, no user, kept indefinitely
create table public.jc_court_hours (
  facility_id   uuid not null,
  community_id  text not null,
  hour          timestamptz not null,  -- date_trunc('hour', starts_at)
  booked        int not null default 0 check (booked >= 0),
  cancelled     int not null default 0 check (cancelled >= 0),
  updated_at    timestamptz not null default now(),
  primary key (facility_id, hour),
  foreign key (facility_id, community_id) references public.jc_facilities(id, community_id)
);
alter table public.jc_court_hours enable row level security;
revoke all on table public.jc_court_hours from public, anon, authenticated;
create index jc_court_hours_community on public.jc_court_hours (community_id, hour);

alter table public.jc_maintenance_log drop constraint jc_maintenance_log_job_check;
alter table public.jc_maintenance_log add constraint jc_maintenance_log_job_check
  check (job in ('orphan_users', 'photo_purge', 'feedback_notify', 'feedback_purge', 'courts_purge'));

-- (d) the active cap lives with the module flag (public rule, public config), like per_home_per_day
update public.jc_communities
   set modules = jsonb_set(modules, '{bookings,per_home_active}', '2')
 where modules ? 'bookings' and not (modules -> 'bookings' ? 'per_home_active');

-- ---------- 2. internal helpers (no grants) ----------
-- R4a (d): upcoming booked slots a home may hold across all courts
create function public.jc_booking_active_cap(p_comm text) returns int
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when (modules -> 'bookings' ->> 'per_home_active') ~ '^[1-9][0-9]?$'
              then (modules -> 'bookings' ->> 'per_home_active')::int else 2 end
    from jc_communities where id = p_comm;
$$;

-- One day's grid for a facility. Takes an id, never a caller-supplied row.
-- R4a: no display_name for anyone; residents see another home's label only when the booking is not private
-- and the home is not directory-suppressed; everyone sees a block's reason; admins see homes, ids, privacy.
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
                        when b.home_id is distinct from p_home and not b.is_private and not h.directory_suppressed then
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

-- (h) daily retention (cron, as postgres; no grants)
-- Hour keys are UTC hours whatever the calling session's time zone (a :30-offset session would otherwise
-- re-key the same bookings into different hours of a table kept forever).
create function public.jc_courts_retention() returns int
language plpgsql security definer set search_path = public, pg_temp set timezone = 'UTC'
as $$
declare v_cut timestamptz := date_trunc('hour', now() - interval '90 days'); n int;
begin
  -- 1. roll every ended booking still held up into its hour (idempotent: recomputed from the rows; an hour
  --    is only ever deleted whole, below, so a recount never sees a partial hour)
  insert into jc_court_hours as c (facility_id, community_id, hour, booked, cancelled)
  select b.facility_id, b.community_id, date_trunc('hour', b.starts_at),
         count(*) filter (where b.status = 'booked'), count(*) filter (where b.status = 'cancelled')
    from jc_bookings b
   where b.ends_at <= now()
   group by 1, 2, 3
  on conflict (facility_id, hour) do update
    -- ended rows never change, so a recount only grows (partial hours); greatest() keeps a kept count from
    -- ever shrinking (e.g. rows deleted by hand)
    set booked = greatest(c.booked, excluded.booked), cancelled = greatest(c.cancelled, excluded.cancelled),
        updated_at = now()
   where excluded.booked > c.booked or excluded.cancelled > c.cancelled;
  -- 2. the individual rows go 90 days after their slot (v_cut is hour-aligned: whole hours only)
  with gone as (delete from jc_bookings where starts_at < v_cut returning 1)
  select count(*) into n from gone;
  delete from jc_booking_blocks where removed_at is not null and ends_at < v_cut;
  delete from jc_state_log where field in ('booking', 'booking_cancel') and at < now() - interval '90 days';
  insert into jc_maintenance_log (job, affected) values ('courts_purge', n);
  return n;
end;
$$;

-- ---------- 3. resident RPCs ----------
-- R4a: + walk_on
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
             'walk_on', f.walk_on)                                                      -- R4a
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm and f.status = 'published'), '[]'::jsonb);
end;
$function$;

-- Residents with a home only: the grid carries neighbours' home labels.
CREATE OR REPLACE FUNCTION public.jc_facility_day(p_facility uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; v_window int; v_tz text; v_today date; v_walk boolean;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then raise exception 'NO_HOME'; end if;
  select window_days, walk_on into v_window, v_walk from jc_facilities
   where id = p_facility and community_id = v_comm and status = 'published';
  if v_window is null then raise exception 'NOT_FOUND'; end if;
  if v_walk then raise exception 'WALK_ON'; end if;                                 -- R4a: no grid
  select tz into v_tz from jc_communities where id = v_comm;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date < v_today or p_date > v_today + (v_window - 1) then
    raise exception 'OUT_OF_WINDOW';
  end if;
  return jsonb_build_object('facility_id', p_facility, 'date', p_date,
                            'slots', jc_facility_grid(p_facility, v_tz, p_date, v_home, false));
end;
$function$;

-- R4a: the booking RPC (S3's jc_booking_create body, minus the name, plus walk-on, the active cap and
-- p_private). New name, so no PostgREST overload with the frozen jc_booking_create.
create function public.jc_booking_book(p_facility uuid, p_starts timestamptz, p_private boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; f public.jc_facilities%rowtype;
        v_tz text; v_ends timestamptz; v_day date; v_id uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then raise exception 'NO_HOME'; end if;
  -- FOR SHARE on the facility: conflicts with retire / unpublish / re-grid / block creation (FOR UPDATE)
  select * into f from jc_facilities
   where id = p_facility and community_id = v_comm and status = 'published' for share;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  if f.walk_on then raise exception 'WALK_ON'; end if;
  if p_private is null then raise exception 'BAD_FIELDS'; end if;   -- fail closed: never public by accident
  -- home row first (serializes the household's caps), then membership — same order as detach
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
  if (select count(*) from jc_bookings
       where home_id = v_home and status = 'booked' and starts_at > now()) >= jc_booking_active_cap(v_comm) then
    raise exception 'ACTIVE_CAP_REACHED';
  end if;

  begin
    insert into jc_bookings (community_id, facility_id, home_id, booked_by, starts_at, ends_at, is_private)
    values (v_comm, f.id, v_home, v_user, p_starts, v_ends, p_private)
    returning id into v_id;
  exception when unique_violation then raise exception 'SLOT_TAKEN';
  end;
  perform jc_log(v_comm, null, null, 'booking', jsonb_build_object('booking_id', v_id, 'facility_id', f.id, 'starts_at', p_starts));
  return jsonb_build_object('booking_id', v_id, 'starts_at', p_starts, 'ends_at', v_ends,
                            'day', jc_facility_grid(f.id, v_tz, v_day, v_home, false));
end;
$$;

-- Frozen signature (signup-class). R4a: the name argument is ignored; same rules as jc_booking_book.
CREATE OR REPLACE FUNCTION public.jc_booking_create(p_facility uuid, p_starts timestamp with time zone, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return jc_booking_book(p_facility, p_starts, false);
end;
$function$;

-- R4a (f): the owning household marks a booking private (or shows it again) until the slot starts.
create function public.jc_booking_privacy_set(p_booking uuid, p_private boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_id uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  perform jc_home_hold(v_user, v_home);
  if p_private is null then raise exception 'BAD_FIELDS'; end if;
  update jc_bookings set is_private = p_private
   where id = p_booking and home_id = v_home and status = 'booked' and starts_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;
  return jc_my_bookings();
end;
$$;

-- Upcoming bookings for the home, plus admin cancellations made since the caller joined (with the reason).
-- R4a: no display_name; + is_private.
CREATE OR REPLACE FUNCTION public.jc_my_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
             'is_private', b.is_private,                                                -- R4a
             'cancel_reason', b.cancel_reason)
           order by b.starts_at)
      from jc_bookings b join jc_facilities f on f.id = b.facility_id
     where b.home_id = v_home and b.ends_at > now()
       and (b.status = 'booked'
            or (b.cancel_reason is not null
                and b.cancelled_at > greatest(now() - interval '7 days', v_joined)))), '[]'::jsonb);
end;
$function$;

-- ---------- 4. admin RPCs (bookings scope or community) ----------
-- R4a: + walk_on
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
             'upcoming', (select count(*) from jc_bookings b
                           where b.facility_id = f.id and b.status = 'booked' and b.starts_at > now()))
           order by f.sort, f.name_en)
      from jc_facilities f where f.community_id = v_comm), '[]'::jsonb);
end;
$function$;

-- R4a (i): the rules in force after fallback, next to what is configured (a typo shows as a mismatch)
create function public.jc_admin_booking_rules() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('bookings');
  return (select jsonb_build_object(
            'enabled', coalesce((c.modules -> 'bookings' ->> 'enabled')::boolean, false),  -- = jc_module_on's reading
            'per_home_per_day', jc_booking_quota(v_comm),
            'per_home_active', jc_booking_active_cap(v_comm),
            'configured', coalesce(c.modules -> 'bookings', '{}'::jsonb),
            'retention_days', 90,
            'defaults', jsonb_build_object('window_days', 7, 'slot_minutes', 60))
            from jc_communities c where c.id = v_comm);
end;
$$;

-- Create (p_facility null) or edit. The slot grid (open/close/slot length) is locked while future bookings
-- exist. R4a: + walk_on (a JSON boolean; turning it on is locked the same way).
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
                                 'walk_on')) then                                    -- R4a
    raise exception 'BAD_FIELDS';
  end if;
  if p_fields ? 'name_en' and jc_clean_line(p_fields ->> 'name_en') is null then raise exception 'BAD_FIELDS'; end if;
  if p_fields ? 'walk_on' and jsonb_typeof(p_fields -> 'walk_on') <> 'boolean' then raise exception 'BAD_FIELDS'; end if;  -- R4a
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
      walk_on       = case when p_fields ? 'walk_on' then (p_fields ->> 'walk_on')::boolean else walk_on end  -- R4a
     where id = v_id;
  exception
    when check_violation or invalid_datetime_format or datetime_field_overflow
         or invalid_text_representation or numeric_value_out_of_range then raise exception 'BAD_FIELDS';
  end;
  perform jc_admin_log_add(v_comm, 'facility_save', jsonb_build_object(
    'facility_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_admin_facilities_list();
end;
$function$;

-- R4a (c): published -> draft (Unpublish) cancels future bookings, like retire.
CREATE OR REPLACE FUNCTION public.jc_admin_facility_status(p_facility uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_from text; v_ids uuid[] := '{}';
begin
  v_comm := jc_assert_admin('bookings');
  select status into v_from from jc_facilities where id = p_facility and community_id = v_comm for update;
  if v_from is null then raise exception 'NOT_FOUND'; end if;
  if not ((v_from = 'draft' and p_status in ('published', 'retired'))
          or (v_from = 'published' and p_status in ('draft', 'retired'))) then          -- R4a: + draft
    raise exception 'BAD_STATE';
  end if;
  update jc_facilities set status = p_status where id = p_facility;
  if p_status = 'retired' then
    v_ids := jc_bookings_cancel_range(p_facility, null, now(), 'infinity', 'Court no longer available');
  elsif v_from = 'published' and p_status = 'draft' then                             -- R4a
    v_ids := jc_bookings_cancel_range(p_facility, null, now(), 'infinity', 'Court temporarily unavailable');
  end if;
  perform jc_admin_log_add(v_comm, 'facility_status', jsonb_build_object(
    'facility_id', p_facility, 'status', p_status, 'bookings_cancelled', to_jsonb(v_ids)));
  return jc_admin_facilities_list();
end;
$function$;

-- ---------- 5. grants + cron ----------
revoke execute on function public.jc_booking_active_cap(text), public.jc_courts_retention()
  from public, anon, authenticated;
revoke execute on function public.jc_booking_book(uuid, timestamptz, boolean),
  public.jc_booking_privacy_set(uuid, boolean), public.jc_admin_booking_rules() from public, anon;
grant execute on function public.jc_booking_book(uuid, timestamptz, boolean),
  public.jc_booking_privacy_set(uuid, boolean), public.jc_admin_booking_rules() to authenticated;

select cron.schedule('jc-courts-purge', '45 3 * * *', 'select public.jc_courts_retention()');
