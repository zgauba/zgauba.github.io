-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R2b-2 — safety block, holiday lights, clean event text (plan docs/plans/R2b-2-safety-lights.md; Zee
-- pre-approved the build, open questions decided conservatively by the parent session and recorded there).
-- No signature changes: jc_admin_event_save(p_event uuid, p_fields jsonb) keeps its argument list and grants
-- (create or replace); jc_event_signup, jc_entry_live_set, jc_event_close, jc_admin_broadcast_set untouched.
-- The replaced body starts from the live definition (pg_get_functiondef, 2026-11-07, after R2b-1 — identical to
-- 20261106120000_r2a_events_audit.sql); changes marked "R2b-2".
--   (a) safety: only phone / meeting_en / meeting_ar; phone = digits, optional leading +, single spaces, 3–15 digits,
--       ≤ 24 chars, else BAD_PHONE; meeting points: whitespace runs → one space, then jc_clean_line, ≤ 200 chars;
--       blanks dropped; stored normalised.
--       Shown on the event page only when features.safety is on (client). Stores nothing about people.
--   (b) holiday_lights joins jc_events_look_check (one ALTER: no window without the check)
--   (c) jc_clean_text on title_en / title_ar / description_en / description_ar on write (titles are one line:
--       whitespace runs become one space first; descriptions keep their newlines); a title that cleans to nothing
--       is BAD_FIELDS; blank optional text is stored as null. Stored rows are left as they are.
-- Rollback (manual): update jc_events set look = 'plain' where look = 'holiday_lights'; then
--   alter table public.jc_events drop constraint jc_events_look_check, add constraint jc_events_look_check
--     check (look = any (array['plain', 'halloween', 'haq_al_laila', 'gathering', 'market', 'yard_sale']));
--   and re-create jc_admin_event_save from 20261106120000_r2a_events_audit.sql. Normalised safety objects and
--   cleaned text stay as stored (both are valid under the old rules).

-- ---------- 1. (b) holiday lights: a look the CHECK knows ----------
alter table public.jc_events
  drop constraint jc_events_look_check,
  add constraint jc_events_look_check
    check (look = any (array['plain', 'halloween', 'haq_al_laila', 'gathering', 'market', 'yard_sale', 'holiday_lights']));

-- ---------- 2. (a) + (c) jc_admin_event_save: body only ----------
CREATE OR REPLACE FUNCTION public.jc_admin_event_save(p_event uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_event uuid := p_event; v_status text;
        v_kind text; v_was jsonb; v_cleared int := 0; ev public.jc_events%rowtype;  -- T5.2 3b
        v_safety jsonb; v_phone text; v_title text;                                  -- R2b-2
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
  -- R2b-2 (a): the safety block's own keys only — the community security line and the lost-child meeting
  -- point (EN / AR). Rebuilt from those keys (never copied from input); blanks dropped, so {} clears it.
  if p_fields ? 'safety' then
    if exists (select 1 from jsonb_object_keys(p_fields -> 'safety') k
                where k not in ('phone', 'meeting_en', 'meeting_ar')) then
      raise exception 'BAD_FIELDS';
    end if;
    v_phone := nullif(btrim(regexp_replace(p_fields -> 'safety' ->> 'phone', '\s+', ' ', 'g')), '');
    if v_phone is not null
       and (v_phone !~ '^\+?[0-9]( ?[0-9])*$'
            or char_length(v_phone) > 24
            or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 3 and 15) then
      raise exception 'BAD_PHONE';
    end if;
    v_safety := jsonb_strip_nulls(jsonb_build_object(
      'phone', v_phone,
      -- one line: a newline between words becomes a space, not nothing (db review L1)
      'meeting_en', jc_clean_line(regexp_replace(p_fields -> 'safety' ->> 'meeting_en', '\s+', ' ', 'g')),
      'meeting_ar', jc_clean_line(regexp_replace(p_fields -> 'safety' ->> 'meeting_ar', '\s+', ' ', 'g'))));
    if char_length(coalesce(v_safety ->> 'meeting_en', '')) > 200
       or char_length(coalesce(v_safety ->> 'meeting_ar', '')) > 200 then
      raise exception 'BAD_FIELDS';
    end if;
  end if;
  -- R2b-2 (c): the title as it will be stored — one line (whitespace runs, tabs and newlines included, become one
  -- space); one that cleans to nothing is no title (null = unchanged, as before)
  v_title := jc_clean_text(regexp_replace(p_fields ->> 'title_en', '\s+', ' ', 'g'));
  if p_fields ? 'title_en' and jsonb_typeof(p_fields -> 'title_en') <> 'null' and v_title is null then
    raise exception 'BAD_FIELDS';
  end if;
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
      if coalesce(p_fields ->> 'slug', '') = '' or v_title is null then             -- R2b-2: the cleaned title
        raise exception 'BAD_FIELDS';
      end if;
      insert into jc_events (community_id, slug, title_en, created_by)
      values (v_comm, p_fields ->> 'slug', v_title, auth.uid())                     -- R2b-2: the cleaned title
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
      -- R2b-2 (c): event text is cleaned on write (controls, bidi overrides, outer whitespace); descriptions keep
      -- their newlines (the formatting markers need them); blank optional text is null
      title_en       = coalesce(v_title, title_en),
      title_ar       = case when p_fields ? 'title_ar' then jc_clean_text(regexp_replace(p_fields ->> 'title_ar', '\s+', ' ', 'g'))
                            else title_ar end,
      -- (only newlines / tabs → null too; inner newlines kept — db review L2)
      description_en = case when p_fields ? 'description_en'
                            then nullif(btrim(jc_clean_text(p_fields ->> 'description_en'), E' \n\t'), '') else description_en end,
      description_ar = case when p_fields ? 'description_ar'
                            then nullif(btrim(jc_clean_text(p_fields ->> 'description_ar'), E' \n\t'), '') else description_ar end,
      starts_at      = case when p_fields ? 'starts_at' then (p_fields ->> 'starts_at')::timestamptz else starts_at end,
      ends_at        = case when p_fields ? 'ends_at' then (p_fields ->> 'ends_at')::timestamptz else ends_at end,
      theme          = coalesce(p_fields -> 'theme', theme),
      features       = coalesce(p_fields -> 'features', features),
      payload_schema = coalesce(p_fields -> 'payload_schema', payload_schema),
      safety         = coalesce(v_safety, safety),                                   -- R2b-2 (a): the normalised block
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
