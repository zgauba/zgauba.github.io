-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R2b-1 — organizer event-night actions, and the household is told (plan docs/plans/R2b-1-organizer-acts.md,
-- approved by Zee 2026-11-06). No signature changes: jc_event_signup, jc_entry_live_set, jc_event_close and
-- jc_admin_broadcast_set keep theirs (null = unchanged in jc_entry_live_set stays, so clearing needs a new RPC).
-- Replaced bodies start from the live definitions (pg_get_functiondef, 2026-11-07, after R2a); changes marked "R2b-1".
--   (a) jc_admin_entry_live_set   organizers + that event's admins set a home's switch / supply, or clear the supply
--   (b) jc_admin_entry_withdraw   organizers + that event's admins free a no-show's place (no Undo: the confirm names the home)
--   (c) jc_event_entries.org_adjusted_at / org_withdrawn_at → jc_event_get.mine + jc_admin_entries_list; the household
--       sees "Adjusted by an organizer · time" / "An organizer removed your sign-up" — never who
--   (d) jc_entry_supply_clear     the household clears its own supply level (tap the pressed level again)
-- Decisions (Zee, 2026-11-06): organizers may act after the end until the event closes (households still can't
-- withdraw then); no Undo on withdraw; organizers get Clear supply too.
-- Rollback (manual): drop function public.jc_admin_entry_live_set(uuid, text, integer, boolean),
-- public.jc_admin_entry_withdraw(uuid), public.jc_entry_supply_clear(uuid); re-create the replaced functions from
-- 20261106120000_r2a_events_audit.sql and earlier; alter table jc_event_entries drop column org_adjusted_at,
-- drop column org_withdrawn_at. Organizer-withdrawn sign-ups stay withdrawn (the household can sign up again).

-- ---------- 1. schema: nullable, no default (no table rewrite) ----------
alter table public.jc_event_entries
  add column org_adjusted_at timestamptz,    -- an organizer changed this sign-up (switch / supply / pin); cleared when the household acts
  add column org_withdrawn_at timestamptz;   -- an organizer removed this sign-up; cleared on re-join

-- ---------- 2. (a) organizer sets a home's switch / supply ----------
create function public.jc_admin_entry_live_set(p_entry uuid, p_state text, p_supply integer, p_supply_clear boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm text; v_event uuid; ev public.jc_events%rowtype; en public.jc_event_entries%rowtype;
        v_clear boolean := coalesce(p_supply_clear, false);
begin
  -- the entry's own event decides (looked up in the caller's community only) — the jc_admin_entry_pin_set pattern
  select e.event_id into v_event from jc_event_entries e
   where e.id = p_entry and e.community_id = (select o_community from jc_me());
  v_comm := jc_assert_event_admin(v_event, true);
  if p_state is null and p_supply is null and not v_clear then raise exception 'BAD_STATE'; end if;
  if p_supply is not null and v_clear then raise exception 'BAD_SUPPLY'; end if;
  -- FOR SHARE: serializes against the close (manual or the hourly job). After the end is fine (decision 1).
  select * into ev from jc_events where id = v_event and community_id = v_comm and status = 'live' for share;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if p_state is not null and not coalesce((ev.features ->> 'giant_switch')::boolean, false) then raise exception 'FEATURE_OFF'; end if;
  if (p_supply is not null or v_clear) and not coalesce((ev.features ->> 'supply')::boolean, false) then raise exception 'FEATURE_OFF'; end if;
  if p_state is not null and p_state not in ('active', 'done') then raise exception 'BAD_STATE'; end if;
  if p_supply is not null and p_supply not between 0 and 3 then raise exception 'BAD_SUPPLY'; end if;
  select * into en from jc_event_entries
   where id = p_entry and event_id = ev.id and status = 'in' and archived_at is null for update;
  if en.id is null then raise exception 'NOT_FOUND'; end if;

  update jc_event_entries
     set live_state = coalesce(p_state, live_state),
         supply_level = case when v_clear then null else coalesce(p_supply, supply_level) end,
         org_adjusted_at = now(), updated_at = now()
   where id = en.id;
  -- state history: actor = the organizer (auth.uid())
  if p_state is not null then perform jc_log(v_comm, ev.id, en.id, 'live_state', to_jsonb(p_state)); end if;
  if p_supply is not null then perform jc_log(v_comm, ev.id, en.id, 'supply_level', to_jsonb(p_supply)); end if;
  if v_clear then perform jc_log(v_comm, ev.id, en.id, 'supply_level', 'null'::jsonb); end if;
  if p_state = 'done' then   -- as the household's own "done": neighbours' reports are answered
    update jc_entry_reports set cleared_at = now() where entry_id = en.id and cleared_at is null;
  end if;
  perform jc_admin_log_add(v_comm, 'entry_live_set', jsonb_build_object(
    'entry_id', en.id, 'event_id', ev.id, 'home_id', en.home_id,
    'from', jsonb_build_object('live_state', en.live_state, 'supply_level', en.supply_level),
    'state', p_state, 'supply', p_supply, 'supply_clear', v_clear));
  return jc_admin_entries_list(ev.id);
end;
$$;
revoke execute on function public.jc_admin_entry_live_set(uuid, text, integer, boolean) from public, anon;
grant execute on function public.jc_admin_entry_live_set(uuid, text, integer, boolean) to authenticated;

-- ---------- 3. (b) organizer withdraws a no-show ----------
create function public.jc_admin_entry_withdraw(p_entry uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm text; v_event uuid; ev public.jc_events%rowtype; en public.jc_event_entries%rowtype;
begin
  select e.event_id into v_event from jc_event_entries e
   where e.id = p_entry and e.community_id = (select o_community from jc_me());
  v_comm := jc_assert_event_admin(v_event, true);
  -- live, ended or not (decision 1: the record is correctable until the close); FOR SHARE vs the close
  select * into ev from jc_events where id = v_event and community_id = v_comm and status = 'live' for share;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  select * into en from jc_event_entries
   where id = p_entry and event_id = ev.id and status = 'in' and archived_at is null for update;
  if en.id is null then raise exception 'NOT_FOUND'; end if;
  -- the place frees itself: capacity counts status = 'in' (the count only goes down, so no capacity lock)
  update jc_event_entries set status = 'withdrawn', spot = null, org_withdrawn_at = now(), updated_at = now()
   where id = en.id;
  update jc_entry_reports set cleared_at = now() where entry_id = en.id and cleared_at is null;
  perform jc_log(v_comm, ev.id, en.id, 'status', '"withdrawn"');
  perform jc_admin_log_add(v_comm, 'entry_withdraw', jsonb_build_object(
    'entry_id', en.id, 'event_id', ev.id, 'home_id', en.home_id, 'spot', en.spot));
  return jc_admin_entries_list(ev.id);
end;
$$;
revoke execute on function public.jc_admin_entry_withdraw(uuid) from public, anon;
grant execute on function public.jc_admin_entry_withdraw(uuid) to authenticated;

-- ---------- 4. (d) the household clears its own supply level ----------
create function public.jc_entry_supply_clear(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_comm text; v_home uuid; ev public.jc_events%rowtype; v_entry uuid;
begin
  -- mirrors jc_entry_live_set (module, home hold, live event, feature, own 'in' entry)
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  perform jc_home_hold(v_user, v_home);
  select * into ev from jc_events where id = p_event and community_id = v_comm and status = 'live' for share;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if not coalesce((ev.features ->> 'supply')::boolean, false) then raise exception 'FEATURE_OFF'; end if;
  update jc_event_entries
     set supply_level = null, org_adjusted_at = null,   -- the household acted: an organizer's change is seen
         updated_at = now(), updated_by = v_user
   where event_id = p_event and home_id = v_home and status = 'in'
  returning id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  perform jc_log(v_comm, p_event, v_entry, 'supply_level', 'null'::jsonb);
  return jc_event_get(p_event);
end;
$$;
revoke execute on function public.jc_entry_supply_clear(uuid) from public, anon;
grant execute on function public.jc_entry_supply_clear(uuid) to authenticated;

-- ---------- 5. household's own switch / supply clears "adjusted" (signature frozen) ----------
CREATE OR REPLACE FUNCTION public.jc_entry_live_set(p_event uuid, p_state text, p_supply integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; ev public.jc_events%rowtype; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  perform jc_home_hold(v_user, v_home);
  if p_state is null and p_supply is null then raise exception 'BAD_STATE'; end if;
  select * into ev from jc_events where id = p_event and community_id = v_comm and status = 'live' for share;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if p_state is not null and not coalesce((ev.features ->> 'giant_switch')::boolean, false) then raise exception 'FEATURE_OFF'; end if;
  if p_supply is not null and not coalesce((ev.features ->> 'supply')::boolean, false) then raise exception 'FEATURE_OFF'; end if;
  if p_state is not null and p_state not in ('active', 'done') then raise exception 'BAD_STATE'; end if;
  if p_supply is not null and p_supply not between 0 and 3 then raise exception 'BAD_SUPPLY'; end if;

  update jc_event_entries
     set live_state = coalesce(p_state, live_state), supply_level = coalesce(p_supply, supply_level),
         org_adjusted_at = null,                                   -- R2b-1: the household acted
         updated_at = now(), updated_by = v_user
   where event_id = p_event and home_id = v_home and status = 'in'
  returning id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  if p_state is not null then perform jc_log(v_comm, p_event, v_entry, 'live_state', to_jsonb(p_state)); end if;
  if p_supply is not null then perform jc_log(v_comm, p_event, v_entry, 'supply_level', to_jsonb(p_supply)); end if;
  if p_state = 'done' then
    update jc_entry_reports set cleared_at = now() where entry_id = v_entry and cleared_at is null;
  end if;
  return jc_event_get(p_event);
end;
$function$;

-- ---------- 6. re-join starts clean (signature frozen) ----------
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
        -- R2b-1: a re-join is the household's own sign-up again — no "adjusted" / "removed" line carries over
        org_adjusted_at = case when jc_event_entries.status = 'withdrawn' then null else jc_event_entries.org_adjusted_at end,
        org_withdrawn_at = null,
        updated_at = now(), updated_by = excluded.updated_by
  returning id into v_entry;
  perform jc_log(v_comm, ev.id, v_entry, 'signup', v_clean);
  return jc_event_get(ev.id);
end;
$function$;

-- ---------- 7. organizer pin moves tell the household ----------
CREATE OR REPLACE FUNCTION public.jc_admin_entry_pin_set(p_entry uuid, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; en public.jc_event_entries%rowtype; v_event uuid;
begin
  -- T5.2b: the entry's own event decides (looked up in the caller's community only)
  select e.event_id into v_event from jc_event_entries e
   where e.id = p_entry and e.community_id = (select o_community from jc_me());
  v_comm := jc_assert_event_admin(v_event, true);
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'BAD_PIN';
  end if;
  if p_lat is not null and coalesce((select jc_dist_m(p_lat, p_lng, c.map_lat, c.map_lng) > 10000
                                        from jc_communities c where c.id = v_comm), false) then
    raise exception 'BAD_PIN';
  end if;
  select * into en from jc_event_entries
   where id = p_entry and community_id = v_comm and status = 'in' and archived_at is null for update;
  if en.id is null then raise exception 'NOT_FOUND'; end if;
  update jc_event_entries set event_lat = p_lat, event_lng = p_lng, updated_at = now(),
                              org_adjusted_at = now()                      -- R2b-1: the household is told
   where id = p_entry;
  perform jc_admin_log_add(v_comm, 'entry_pin_set', jsonb_build_object(
    'entry_id', p_entry, 'event_id', en.event_id,
    'from', case when en.event_lat is null then null else jsonb_build_array(en.event_lat, en.event_lng) end,
    'to', case when p_lat is null then null else jsonb_build_array(p_lat, p_lng) end));
  return jc_admin_entries_list(en.event_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_admin_home_pin_set(p_home uuid, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; h public.jc_homes%rowtype; v_user uuid; v_home uuid;    -- T5.2b
begin
  -- T5.2b: an event admin may move the pin of a home signed up to an event they run (open
  -- events only); organizers, any home in the community
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if not jc_events_organizer() and not exists (
       select 1 from jc_event_entries en
         join jc_event_admins ea on ea.event_id = en.event_id and ea.user_id = v_user
         join jc_events ev on ev.id = en.event_id
        where en.home_id = p_home and en.status = 'in' and en.archived_at is null
          and ev.community_id = v_comm and ev.status <> 'archived') then
    raise exception 'NOT_ADMIN';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BAD_PIN';
  end if;
  -- an organizer fixes pins inside the community: more than 10 km from its centre is refused
  -- (a resident's own far pin is only flagged; this is someone else's home)
  if coalesce((select jc_dist_m(p_lat, p_lng, c.map_lat, c.map_lng) > 10000
                 from jc_communities c where c.id = v_comm), false) then
    raise exception 'BAD_PIN';
  end if;
  select * into h from jc_homes where id = p_home and community_id = v_comm for update;
  if h.id is null then raise exception 'NOT_FOUND'; end if;
  update jc_homes
     set lat = p_lat, lng = p_lng, pin_set_at = now(), flags = flags - 'pin_far' - 'pin_near'
   where id = p_home;
  update jc_admin_notices set resolved_at = now(), resolved_by = auth.uid()
   where community_id = v_comm and home_id = p_home and kind = 'pin_flag' and resolved_at is null;
  -- R2b-1: the home's sign-ups to live homes events show "Adjusted by an organizer" (the home pin IS their pin
  -- there; a one-place event doesn't use it). Withdrawn / archived sign-ups and drafts are left alone.
  update jc_event_entries en set org_adjusted_at = now()
   where en.home_id = p_home and en.status = 'in' and en.archived_at is null
     and exists (select 1 from jc_events ev where ev.id = en.event_id and ev.status = 'live' and ev.kind = 'homes');
  perform jc_admin_log_add(v_comm, 'home_pin_set', jsonb_build_object(
    'home_id', p_home,
    'from', case when h.lat is null then null else jsonb_build_array(h.lat, h.lng) end,
    'to', jsonb_build_array(p_lat, p_lng)));
  -- the old spot comes back so the screen can offer Undo (events organizers can't read the log)
  return jsonb_build_object('home_id', p_home, 'lat', p_lat, 'lng', p_lng,
    'from', case when h.lat is null then null else jsonb_build_array(h.lat, h.lng) end);
end;
$function$;

-- ---------- 8. a new family starts without the last one's lines ----------
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
  -- R2b-1: so do "adjusted by an organizer" / "an organizer removed your sign-up".
  update jc_event_entries en set hidden = false, spot = null, org_adjusted_at = null, org_withdrawn_at = null
   where en.home_id = p_home and en.archived_at is null
     and (en.hidden or en.spot is not null or en.org_adjusted_at is not null or en.org_withdrawn_at is not null)
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

-- ---------- 9. read paths: two additive keys ----------
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
           -- R2b-1: an organizer changed / removed this sign-up (when, never who)
           'org_adjusted_at', en.org_adjusted_at, 'org_withdrawn_at', en.org_withdrawn_at,
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
             'org_adjusted_at', en.org_adjusted_at, 'org_withdrawn_at', en.org_withdrawn_at,   -- R2b-1
             'reports_open', (select count(*) from jc_entry_reports r where r.entry_id = en.id and r.cleared_at is null),
             'created_at', en.created_at, 'updated_at', en.updated_at)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_event_entries en join jc_homes h on h.id = en.home_id
     where en.event_id = p_event), '[]'::jsonb);
end;
$function$;
