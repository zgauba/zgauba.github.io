-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R2a — Events audit fixes (docs/qa/events-qa-2026-11-06.md; plan docs/plans/R2-event-night.md; Zee 2026-11-06:
-- "fix all the bugs"). No signature changes: jc_event_signup, jc_entry_live_set, jc_event_close and
-- jc_admin_broadcast_set keep theirs. Replaced bodies start from the live definitions (2026-11-06).
--   D1 + L1  jc_home_vacated clears an organizer's hide and the spot on the home's live-event entries.
--   D2       an event ENDS at coalesce(ends_at, starts_at + 6 h) (undated: never; 6 h = the client's NO_END_MS):
--            sign-up and withdraw stop; read paths add `ended` + `ends_effective`; the Close button's work moves
--            to jc_private.event_close_core; an hourly job (jc-event-autoclose) posts one App Health notice when
--            an event ends and closes it 24 h after its end (a failure = its own notice, the rest still close).
--   F2       publishing / opening a homes event needs a start date (NO_DATE); a save can't clear it.
--   U1       jc_event_get.mine.home_hidden (own home hidden from the directory).
--   U3       jc_communities.broadcast_by; revoking an event admin takes their banner down; organizers can tie
--            a banner to an event (new jc_admin_broadcast_set_event) so the close takes it down.
-- Rollback (manual): select cron.unschedule('jc-event-autoclose'); re-create the replaced functions from
-- 20261106090000_t5_2_hardening.sql and earlier; drop function public.jc_admin_broadcast_set_event(text, uuid),
-- jc_private.events_autoclose(), jc_private.event_close_core(uuid), jc_private.event_ends(timestamptz, timestamptz);
-- alter table jc_communities drop column broadcast_by; restore the notices kind CHECK (after resolving /
-- deleting event_ended + autoclose_failed rows). Auto-closed events stay closed (close is irreversible).

-- ---------- 1. schema ----------
alter table public.jc_communities
  add column broadcast_by uuid references auth.users(id) on delete set null;   -- U3: who posted the banner
alter table public.jc_admin_notices drop constraint jc_admin_notices_kind_check;
alter table public.jc_admin_notices add constraint jc_admin_notices_kind_check
  check (kind = any (array['departure', 'over_cap', 'pin_flag', 'event_ended', 'autoclose_failed']));   -- D2

-- ---------- 2. D2: when an event ends, and the close itself ----------
create function jc_private.event_ends(p_starts timestamptz, p_ends timestamptz) returns timestamptz
language sql immutable security definer set search_path = public, pg_temp as $$   -- definer + pinned: the jc_private rule (G13)
  -- the client's event day uses the same rule (NO_END_MS = 6 h); undated events never end
  select case when p_starts is null then null else coalesce(p_ends, p_starts + interval '6 hours') end
$$;
revoke execute on function jc_private.event_ends(timestamptz, timestamptz) from public, anon, authenticated;

-- The close, wherever it starts (the Close button, the hourly job). Callers check who may close and log it.
create function jc_private.event_close_core(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev public.jc_events%rowtype; v_snap jsonb;
begin
  select * into ev from jc_events where id = p_event for update;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if ev.status <> 'live' then raise exception 'BAD_STATE'; end if;
  update jc_events set signups_open = false, coming_soon = false where id = ev.id;   -- T5.4: closed is never "coming soon"
  v_snap := jc_event_snapshot(ev.id);
  insert into jc_event_stats (event_id, community_id, snapshot, source)
  values (ev.id, ev.community_id, v_snap, 'snapshot')
  on conflict (event_id) do update set snapshot = excluded.snapshot, source = 'snapshot', taken_at = now();
  update jc_event_entries set archived_at = now() where event_id = ev.id and archived_at is null;
  update jc_events set status = 'archived', archived_at = now() where id = ev.id;
  -- T5.2b: a banner tied to the event goes with it (R2a: an organizer's tied banner too)
  update jc_communities set broadcast = '', broadcast_event = null, broadcast_by = null
   where id = ev.community_id and broadcast_event = ev.id;
  -- R2a: its "ended — closes automatically" notice has done its job
  update jc_admin_notices set resolved_at = now()
   where community_id = ev.community_id and kind in ('event_ended', 'autoclose_failed')
     and detail ->> 'event_id' = ev.id::text and resolved_at is null;
  return v_snap;
end;
$$;
revoke execute on function jc_private.event_close_core(uuid) from public, anon, authenticated;

-- ---------- 3. D1 + L1: vacating a home clears its moderation and spot ----------
CREATE OR REPLACE FUNCTION public.jc_home_vacated(p_home uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- R2a (D1 + L1): an organizer's hide and a spot belong to the family that leaves — any status, so a
  -- family that withdrew while hidden can't hand the flag to the next one. Archived events keep history.
  update jc_event_entries en set hidden = false, spot = null
   where en.home_id = p_home and en.archived_at is null and (en.hidden or en.spot is not null)
     and exists (select 1 from jc_events ev where ev.id = en.event_id and ev.status = 'live');
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
$function$;

-- ---------- 4. D2: sign-ups stop at the end (signature unchanged) ----------
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
  -- R2a (D2): an event that has ended takes no more sign-ups (computed: moving the end time reopens)
  if jc_private.event_ends(ev.starts_at, ev.ends_at) < now() then raise exception 'SIGNUPS_CLOSED'; end if;
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
declare v_user uuid; v_comm text; v_home uuid; v_entry uuid; v_starts timestamptz; v_ends timestamptz;   -- R2a
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  select starts_at, ends_at into v_starts, v_ends
    from jc_events where id = p_event and community_id = v_comm and status = 'live' for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- R2a (D2): after the end the night's sign-ups are its record — a household can't withdraw
  if jc_private.event_ends(v_starts, v_ends) < now() then raise exception 'SIGNUPS_CLOSED'; end if;
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

-- ---------- 5. D2 + U1: read paths say "ended"; My Sign-Up knows its home is hidden ----------
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
             -- R2a (D2)
             'ends_effective', jc_private.event_ends(ev.starts_at, ev.ends_at),
             'ended', coalesce(jc_private.event_ends(ev.starts_at, ev.ends_at) < now(), false),
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
           -- R2a (U1): the household's own home is hidden from the directory (so from event maps)
           'home_hidden', (select h.directory_suppressed from jc_homes h where h.id = en.home_id),
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
         -- admin-hidden entries and directory-suppressed homes: visible to their own household only
         and ((not en.hidden and not h.directory_suppressed) or en.home_id = v_home)), '[]'::jsonb)
      when ev.status = 'live' then '[]'::jsonb end);
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
             -- R2a (D2): Organizer Tools says "ended — closes automatically at …"
             'ends_effective', jc_private.event_ends(ev.starts_at, ev.ends_at),
             'ended', coalesce(jc_private.event_ends(ev.starts_at, ev.ends_at) < now(), false),
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

-- ---------- 7. D2: the Close button calls the core (signature + checks unchanged) ----------
CREATE OR REPLACE FUNCTION public.jc_event_close(p_event uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; ev public.jc_events%rowtype; v_snap jsonb;   -- R2a: the work is in jc_private.event_close_core
begin
  v_comm := jc_assert_event_admin(p_event, true);   -- T5.2b
  select * into ev from jc_events where id = p_event and community_id = v_comm for update;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if ev.status <> 'live' then raise exception 'BAD_STATE'; end if;
  if p_confirm is distinct from ev.slug then raise exception 'CONFIRM_REQUIRED'; end if;

  v_snap := jc_private.event_close_core(ev.id);   -- R2a (D2): the same close as the scheduled one
  perform jc_admin_log_add(v_comm, 'event_close', jsonb_build_object(
    'event_id', ev.id, 'slug', ev.slug, 'homes', v_snap -> 'homes'));
  return v_snap;
end;
$function$;

-- ---------- 8. F2: a homes event goes live only with a start date ----------
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
  -- R2a (F2): a homes event needs its date — event day (switch, supply, reports) and its end hang on it
  if exists (select 1 from jc_events where id = p_event and community_id = v_comm and status = 'draft'
                and kind = 'homes' and starts_at is null) then
    raise exception 'NO_DATE';
  end if;
  update jc_events set status = 'live', signups_open = true
   where id = p_event and community_id = v_comm and status = 'draft';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_publish', jsonb_build_object('event_id', p_event));
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
  -- R2a (F2): opening a coming-soon homes event is its publish — it needs its date too
  if coalesce(p_open, false) and exists (select 1 from jc_events where id = p_event and community_id = v_comm
       and status = 'live' and coming_soon and kind = 'homes' and starts_at is null) then
    raise exception 'NO_DATE';
  end if;
  update jc_events set signups_open = coalesce(p_open, false),
         coming_soon = coming_soon and not coalesce(p_open, false)
   where id = p_event and community_id = v_comm and status = 'live';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_signups', jsonb_build_object('event_id', p_event, 'open', coalesce(p_open, false)));
  return jc_admin_events_list();
end;
$function$;

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
    -- R2a (F2): an open homes event keeps its date (only a save that touches the date or kind is checked,
    -- so an older undated event can still be edited)
    if (p_fields ? 'starts_at' or p_fields ? 'kind')
       and ev.status <> 'draft' and not ev.coming_soon and ev.kind = 'homes' and ev.starts_at is null then
      raise exception 'NO_DATE';
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

-- ---------- 9. U3: who posted the banner; revoke takes that admin's banner down ----------
CREATE OR REPLACE FUNCTION public.jc_admin_broadcast_set(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_text text; v_user uuid; v_home uuid; v_org boolean; v_event uuid;   -- T5.2b
begin
  -- T5.2b: event admins may post the banner while an event they run is LIVE (event-day alerts),
  -- but never over an organizer's banner; theirs is tied to the event and clears at its close
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  v_org := jc_events_organizer();
  if not v_org then
    select ev.id into v_event from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
     where ea.user_id = v_user and ev.community_id = v_comm and ev.status = 'live'
     order by ev.starts_at nulls last, ev.created_at limit 1;
    if v_event is null then raise exception 'NOT_ADMIN'; end if;
    perform 1 from jc_communities c where c.id = v_comm for update;
    if exists (select 1 from jc_communities c where c.id = v_comm
                and c.broadcast_event is null and c.broadcast <> '') then
      raise exception 'BANNER_IN_USE';
    end if;
  end if;
  if length(p_text) > 2000 then raise exception 'TOO_LONG'; end if;
  -- every member sees this on every page: also drop marks that hide or reorder words
  -- (LRM / RLM / ALM, zero-width, line / paragraph separators) on top of jc_clean_text
  v_text := coalesce(jc_clean_text(regexp_replace(p_text, '[​-‏  ⁠﻿؜]', '', 'g')), '');
  -- jc_clean_text trims spaces only: a banner of just line breaks / tabs means "no banner"
  v_text := btrim(v_text, E' \t\n\r');
  if char_length(v_text) > 280 then raise exception 'TOO_LONG'; end if;
  update jc_communities set broadcast = v_text,
         broadcast_event = case when v_org or v_text = '' then null else v_event end,   -- T5.2b
         broadcast_by    = case when v_text = '' then null else v_user end              -- R2a (U3)
   where id = v_comm;
  perform jc_admin_log_add(v_comm, 'broadcast_set', jsonb_build_object('text', v_text, 'event_id', v_event));
  return jsonb_build_object('broadcast', v_text);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_event_admin_revoke(p_event uuid, p_user uuid, p_link uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  if (p_user is null) = (p_link is null) then raise exception 'BAD_FIELDS'; end if;
  if p_user is not null then
    delete from jc_event_admins where event_id = p_event and user_id = p_user and community_id = v_comm;
  else
    update jc_event_admin_links set revoked_at = now()
     where id = p_link and event_id = p_event and community_id = v_comm
       and used_at is null and revoked_at is null;
  end if;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- R2a (U3): the revoked admin's banner about this event goes with them
  if p_user is not null then
    update jc_communities set broadcast = '', broadcast_event = null, broadcast_by = null
     where id = v_comm and broadcast_event = p_event and broadcast_by = p_user;
  end if;
  perform jc_admin_log_add(v_comm, 'event_admin_revoke', jsonb_build_object(
    'event_id', p_event, 'user_id', p_user, 'link_id', p_link));
  return jc_event_admins_list(p_event);
end;
$function$;

-- ---------- 10. U3: an organizer's banner can be tied to an event (new; jc_admin_broadcast_set unchanged) ----------
create function public.jc_admin_broadcast_set_event(p_text text, p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm text; v_r jsonb;
begin
  v_comm := jc_assert_admin('events');                 -- organizer only, as jc_admin_event_publish
  if p_event is not null and not exists (select 1 from jc_events
       where id = p_event and community_id = v_comm and status = 'live') then
    raise exception 'NOT_FOUND';
  end if;
  v_r := jc_admin_broadcast_set(p_text);               -- same cleaning, caps and log
  update jc_communities set broadcast_event = case when broadcast = '' then null else p_event end
   where id = v_comm;
  perform jc_admin_log_add(v_comm, 'broadcast_tie', jsonb_build_object('event_id', p_event));
  return v_r;
end;
$$;
revoke execute on function public.jc_admin_broadcast_set_event(text, uuid) from public, anon;
grant execute on function public.jc_admin_broadcast_set_event(text, uuid) to authenticated;

-- ---------- 11. D2: the hourly job — tell organizers an event ended, close it 24 h later ----------
-- Condition-based (not "the hour after"), so a paused project catches up on its next run. Each close runs in
-- its own sub-transaction: one failure becomes an App Health notice and the rest still close.
create function jc_private.events_autoclose() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; v_snap jsonb;
begin
  -- an end time moved later: the "ended" notice no longer applies
  update jc_admin_notices nt set resolved_at = now()
    from jc_events ev
   where nt.kind = 'event_ended' and nt.resolved_at is null and ev.id::text = nt.detail ->> 'event_id'
     and ev.status = 'live'
     and not coalesce(jc_private.event_ends(ev.starts_at, ev.ends_at) < now(), false);
  -- ended: one notice per event (kept current if the end time changed while it was open)
  for r in select ev.id, ev.community_id, ev.slug, ev.title_en,
                  jc_private.event_ends(ev.starts_at, ev.ends_at) + interval '24 hours' as closes_at
             from jc_events ev
            where ev.status = 'live' and jc_private.event_ends(ev.starts_at, ev.ends_at) < now() loop
    update jc_admin_notices set detail = jsonb_build_object('event_id', r.id, 'slug', r.slug,
                                         'title', r.title_en, 'closes_at', r.closes_at)
     where community_id = r.community_id and kind = 'event_ended' and resolved_at is null
       and detail ->> 'event_id' = r.id::text and (detail ->> 'closes_at')::timestamptz is distinct from r.closes_at;
    if not exists (select 1 from jc_admin_notices where community_id = r.community_id and kind = 'event_ended'
                    and detail ->> 'event_id' = r.id::text and resolved_at is null) then
      insert into jc_admin_notices (community_id, kind, detail)
      values (r.community_id, 'event_ended', jsonb_build_object('event_id', r.id, 'slug', r.slug,
                                                                'title', r.title_en, 'closes_at', r.closes_at));
    end if;
  end loop;
  -- 24 h after the end: close
  for r in select ev.id, ev.community_id, ev.slug from jc_events ev
            where ev.status = 'live' and jc_private.event_ends(ev.starts_at, ev.ends_at) + interval '24 hours' < now()
            order by ev.created_at loop
    begin
      -- an organizer closing it this moment, or moving the end time, wins
      perform 1 from jc_events where id = r.id and status = 'live'
         and jc_private.event_ends(starts_at, ends_at) + interval '24 hours' < now()
       for update skip locked;
      if not found then continue; end if;
      v_snap := jc_private.event_close_core(r.id);
      -- actor NULL = the job (written directly: jc_admin_log_add would take auth.uid() of whatever session ran it)
      insert into jc_admin_log (community_id, actor, action, target)
      values (r.community_id, null, 'event_autoclose',
              jsonb_build_object('event_id', r.id, 'slug', r.slug, 'homes', v_snap -> 'homes'));
      n := n + 1;
    exception when others then
      if not exists (select 1 from jc_admin_notices where community_id = r.community_id and kind = 'autoclose_failed'
                      and detail ->> 'event_id' = r.id::text and resolved_at is null) then
        insert into jc_admin_notices (community_id, kind, detail)
        values (r.community_id, 'autoclose_failed',
                jsonb_build_object('event_id', r.id, 'slug', r.slug, 'error', left(sqlerrm, 200)));
      end if;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function jc_private.events_autoclose() from public, anon, authenticated;

select cron.schedule('jc-event-autoclose', '25 * * * *', 'select jc_private.events_autoclose()');
