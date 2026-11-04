-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.2 PR A — per-event admins (plan docs/plans/T5-2-per-event-admins-plan.md, D1–D4):
--   1. a community admin makes a single-use GRANT LINK for one event; the member who opens it
--      (signed in, same community) becomes that event's admin (D1);
--   2. an event admin runs THEIR event — edit, sign-ups, entries, pins, banner while it's live,
--      close — but never creates or publishes (community admin = the approval step) (D2);
--   3. a grant is valid while the event is open and READ-ONLY for 5 days after it closes
--      (jc_events.archived_at — computed at call time, nothing to clean up); revocable; gone
--      with the account (D4);
--   4. jc_me_get gains admin_events (additive) — the events list's Admin badge reads it.
-- LEGACY: the shared `events` code scope still counts as "organizer" (= today's behaviour) so
-- cached admin pages keep working; PR C removes it.
-- Bodies of replaced functions are the live ones (pg_get_functiondef, 2026-11-04) plus the
-- marked "T5.2b" lines only.

-- ---------- 1. tables ----------
create table public.jc_event_admins (
  event_id      uuid not null,
  user_id       uuid not null,
  community_id  text not null,
  granted_by    uuid references auth.users(id) on delete set null,
  granted_at    timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, community_id) references public.jc_events(id, community_id) on delete cascade,
  -- gone with the account (jc_account_delete / auth.users trigger → jc_accounts cascade)
  foreign key (user_id, community_id) references public.jc_accounts(user_id, community_id) on delete cascade
);
alter table public.jc_event_admins enable row level security;
create index jc_event_admins_user on public.jc_event_admins (user_id);
create index jc_event_admins_granted_by on public.jc_event_admins (granted_by) where granted_by is not null;

create table public.jc_event_admin_links (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null,
  community_id  text not null,
  token_hash    text not null unique,  -- sha256; the token itself is shown once, never stored
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '72 hours',
  used_by       uuid references auth.users(id) on delete set null,
  used_at       timestamptz,
  revoked_at    timestamptz,
  foreign key (event_id, community_id) references public.jc_events(id, community_id) on delete cascade
);
alter table public.jc_event_admin_links enable row level security;
create index jc_event_admin_links_event on public.jc_event_admin_links (event_id);
-- account deletion sets these null: index them so it doesn't scan (database review M4)
create index jc_event_admin_links_created_by on public.jc_event_admin_links (created_by) where created_by is not null;
create index jc_event_admin_links_used_by on public.jc_event_admin_links (used_by) where used_by is not null;

-- Who posted the community banner: null = an organizer (or nobody); an event id = that event's
-- admins, and it clears when the event closes (security review M1).
alter table public.jc_communities add column broadcast_event uuid references public.jc_events(id) on delete set null;

-- ---------- 2. internal checks (never callable from the app) ----------

-- Community-level events organizer: the community admin — or, until PR C, the legacy shared
-- `events` code. Like jc_assert_admin (minus the raise) it SLIDES the 60-day unlock: an
-- organizer who only uses event screens must not lapse (database review H1). Not
-- jc_admin_has — that one is read-only on purpose (S4 visibility predicates).
create function public.jc_events_organizer() returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update jc_admin_grants g set last_used_at = now()
   where g.user_id = auth.uid()
     and g.scope in ('events', 'community')
     and g.last_used_at > now() - interval '60 days'
     and g.code_version = (select c.version from jc_codes c
                            where c.community_id = g.community_id and c.scope = g.scope);
  return found;
end;
$$;

-- May the caller act on this event? Organizer: any event in their community. Event admin: their
-- event while it isn't closed — or, for reads only, up to 5 days after it closed (D4).
-- p_event null (the target row wasn't found): organizers pass so the caller can say NOT_FOUND;
-- everyone else gets NOT_ADMIN — a non-admin never learns whether an id exists.
create function public.jc_assert_event_admin(p_event uuid, p_write boolean) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if jc_events_organizer() then return v_comm; end if;
  if p_event is null or not exists (
       select 1 from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
        where ea.event_id = p_event and ea.user_id = v_user and ev.community_id = v_comm
          and (ev.status <> 'archived'
               or (not p_write and ev.archived_at > now() - interval '5 days'))) then
    raise exception 'NOT_ADMIN';
  end if;
  return v_comm;
end;
$$;

-- ---------- 3. grant links (community admin) + accept (any member) ----------

create function public.jc_event_admin_link_create(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_token text; v_exp timestamptz;
begin
  v_comm := jc_assert_admin('community');
  -- the event row lock serializes creators (the 10-link cap) and orders us against close
  perform 1 from jc_events where id = p_event and community_id = v_comm and status <> 'archived' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from jc_event_admin_links
       where event_id = p_event and used_at is null and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'TOO_MANY_LINKS';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into jc_event_admin_links (event_id, community_id, token_hash, created_by)
  values (p_event, v_comm, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning expires_at into v_exp;
  perform jc_admin_log_add(v_comm, 'event_admin_link', jsonb_build_object('event_id', p_event));
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end;
$$;

-- Single use. The link only says "help run an event"; the event is named after accepting.
create function public.jc_event_admin_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; l public.jc_event_admin_links%rowtype; ev public.jc_events%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  select * into l from jc_event_admin_links
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if l.id is null or l.community_id <> v_comm
     or l.used_at is not null or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'BAD_LINK';
  end if;
  select * into ev from jc_events where id = l.event_id for share;   -- a concurrent close waits / is seen
  if ev.status = 'archived' then raise exception 'BAD_LINK'; end if;
  insert into jc_event_admins (event_id, user_id, community_id, granted_by)
  values (l.event_id, v_user, v_comm, l.created_by)
  on conflict (event_id, user_id) do nothing;
  update jc_event_admin_links set used_by = v_user, used_at = now() where id = l.id;
  perform jc_admin_log_add(v_comm, 'event_admin_accept', jsonb_build_object('event_id', l.event_id, 'link_id', l.id));
  return jsonb_build_object('event_id', ev.id, 'title_en', ev.title_en, 'title_ar', ev.title_ar);
end;
$$;

-- Who runs this event, and which links are still open. Names: display name or masked email
-- (the household pattern) + the home's label — never the raw email.
create function public.jc_event_admins_list(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  if not exists (select 1 from jc_events where id = p_event and community_id = v_comm) then
    raise exception 'NOT_FOUND';
  end if;
  return jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', ea.user_id,
               'name', coalesce(a.display_name, jc_mask_email(u.email)),
               'village', h.village_key, 'type', h.home_type, 'building', h.building, 'number', h.number_raw,
               'granted_at', ea.granted_at) order by ea.granted_at)
        from jc_event_admins ea
        join jc_accounts a on a.user_id = ea.user_id
        join auth.users u on u.id = ea.user_id
        left join jc_home_members m on m.user_id = ea.user_id
        left join jc_homes h on h.id = m.home_id
       where ea.event_id = p_event), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'expires_at', l.expires_at)
                       order by l.created_at)
        from jc_event_admin_links l
       where l.event_id = p_event and l.used_at is null and l.revoked_at is null and l.expires_at > now()), '[]'::jsonb));
end;
$$;

-- Remove a person (p_user) or cancel an unused link (p_link) — exactly one of the two.
create function public.jc_event_admin_revoke(p_event uuid, p_user uuid, p_link uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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
  perform jc_admin_log_add(v_comm, 'event_admin_revoke', jsonb_build_object(
    'event_id', p_event, 'user_id', p_user, 'link_id', p_link));
  return jc_event_admins_list(p_event);
end;
$$;

-- ---------- 4. the ten events-admin functions, now per event ----------

create or replace function public.jc_admin_events_list()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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

create or replace function public.jc_admin_event_save(p_event uuid, p_fields jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_comm text; v_event uuid := p_event; v_status text;
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
                                 'starts_at', 'ends_at', 'theme', 'features', 'payload_schema', 'safety')) then
    raise exception 'BAD_FIELDS';
  end if;
  if p_fields ? 'features' then perform jc_features_check(p_fields -> 'features'); end if;
  if p_fields ? 'payload_schema' then perform jc_schema_check(p_fields -> 'payload_schema'); end if;
  if p_fields ? 'theme' then perform jc_kv_check(p_fields -> 'theme', 'theme'); end if;
  if p_fields ? 'safety' then perform jc_kv_check(p_fields -> 'safety', 'safety'); end if;

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
      safety         = coalesce(p_fields -> 'safety', safety)
     where id = v_event;
  exception
    when unique_violation then raise exception 'SLUG_TAKEN';
    when check_violation or invalid_datetime_format or datetime_field_overflow
         or invalid_text_representation then raise exception 'BAD_FIELDS';
  end;
  perform jc_admin_log_add(v_comm, 'event_save', jsonb_build_object('event_id', v_event, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_admin_events_list();
end;
$function$;

-- publish stays with the community admin (the approval step) — unchanged check, kept explicit
create or replace function public.jc_admin_event_publish(p_event uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');   -- T5.2b: organizer only (legacy `events` until PR C)
  update jc_events set status = 'live', signups_open = true
   where id = p_event and community_id = v_comm and status = 'draft';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_publish', jsonb_build_object('event_id', p_event));
  return jc_admin_events_list();
end;
$function$;

create or replace function public.jc_admin_event_signups(p_event uuid, p_open boolean)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_comm text;
begin
  v_comm := jc_assert_event_admin(p_event, true);   -- T5.2b
  update jc_events set signups_open = coalesce(p_open, false)
   where id = p_event and community_id = v_comm and status = 'live';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_signups', jsonb_build_object('event_id', p_event, 'open', coalesce(p_open, false)));
  return jc_admin_events_list();
end;
$function$;

create or replace function public.jc_event_close(p_event uuid, p_confirm text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_comm text; ev public.jc_events%rowtype; v_snap jsonb;
begin
  v_comm := jc_assert_event_admin(p_event, true);   -- T5.2b
  select * into ev from jc_events where id = p_event and community_id = v_comm for update;
  if ev.id is null then raise exception 'NOT_FOUND'; end if;
  if ev.status <> 'live' then raise exception 'BAD_STATE'; end if;
  if p_confirm is distinct from ev.slug then raise exception 'CONFIRM_REQUIRED'; end if;

  update jc_events set signups_open = false where id = ev.id;
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

create or replace function public.jc_admin_entries_list(p_event uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
             'reports_open', (select count(*) from jc_entry_reports r where r.entry_id = en.id and r.cleared_at is null),
             'created_at', en.created_at, 'updated_at', en.updated_at)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_event_entries en join jc_homes h on h.id = en.home_id
     where en.event_id = p_event), '[]'::jsonb);
end;
$function$;

create or replace function public.jc_admin_entry_moderate(p_entry uuid, p_hidden boolean, p_org_note text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_comm text; v_event uuid;
begin
  -- T5.2b: the entry's own event decides (looked up in the caller's community only)
  select en.event_id into v_event from jc_event_entries en
   where en.id = p_entry and en.community_id = (select o_community from jc_me());
  v_comm := jc_assert_event_admin(v_event, true);
  v_event := null;
  if char_length(p_org_note) > 280 then raise exception 'BAD_NOTE'; end if;
  update jc_event_entries
     set hidden = coalesce(p_hidden, hidden),
         org_note = case when p_org_note is null then org_note else jc_clean_text(p_org_note) end,
         updated_at = now()
   where id = p_entry and community_id = v_comm and archived_at is null
  returning event_id into v_event;
  if v_event is null then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'entry_moderate', jsonb_build_object(
    'entry_id', p_entry, 'hidden', p_hidden, 'org_note_set', p_org_note is not null));
  return jc_admin_entries_list(v_event);
end;
$function$;

create or replace function public.jc_admin_entry_pin_set(p_entry uuid, p_lat double precision, p_lng double precision)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
  update jc_event_entries set event_lat = p_lat, event_lng = p_lng, updated_at = now() where id = p_entry;
  perform jc_admin_log_add(v_comm, 'entry_pin_set', jsonb_build_object(
    'entry_id', p_entry, 'event_id', en.event_id,
    'from', case when en.event_lat is null then null else jsonb_build_array(en.event_lat, en.event_lng) end,
    'to', case when p_lat is null then null else jsonb_build_array(p_lat, p_lng) end));
  return jc_admin_entries_list(en.event_id);
end;
$function$;

create or replace function public.jc_admin_home_pin_set(p_home uuid, p_lat double precision, p_lng double precision)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
  perform jc_admin_log_add(v_comm, 'home_pin_set', jsonb_build_object(
    'home_id', p_home,
    'from', case when h.lat is null then null else jsonb_build_array(h.lat, h.lng) end,
    'to', jsonb_build_array(p_lat, p_lng)));
  -- the old spot comes back so the screen can offer Undo (events organizers can't read the log)
  return jsonb_build_object('home_id', p_home, 'lat', p_lat, 'lng', p_lng,
    'from', case when h.lat is null then null else jsonb_build_array(h.lat, h.lng) end);
end;
$function$;

create or replace function public.jc_admin_broadcast_set(p_text text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
         broadcast_event = case when v_org or v_text = '' then null else v_event end   -- T5.2b
   where id = v_comm;
  perform jc_admin_log_add(v_comm, 'broadcast_set', jsonb_build_object('text', v_text, 'event_id', v_event));
  return jsonb_build_object('broadcast', v_text);
end;
$function$;

-- ---------- 5. jc_me_get: + admin_events (additive) ----------
create or replace function public.jc_me_get()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  return jsonb_build_object(
    'community', v_comm,
    'account', (select jsonb_build_object('email', u.email, 'display_name', a.display_name,
                                          'prefs', a.prefs, 'joined_at', a.joined_at)
                  from jc_accounts a join auth.users u on u.id = a.user_id
                 where a.user_id = v_user),
    'home', (select jsonb_build_object(
                      'id', h.id, 'village', h.village_key, 'type', h.home_type,
                      'building', h.building, 'number', h.number_raw,
                      'lat', h.lat, 'lng', h.lng, 'pin_set_at', h.pin_set_at,
                      'members', (select jsonb_agg(jsonb_build_object(
                                           'you', m.user_id = v_user,
                                           'name', coalesce(a2.display_name, jc_mask_email(u2.email)),
                                           'joined_at', m.joined_at) order by m.joined_at)
                                    from jc_home_members m
                                    join jc_accounts a2 on a2.user_id = m.user_id
                                    join auth.users u2 on u2.id = m.user_id
                                   where m.home_id = h.id))
               from jc_homes h where h.id = v_home),
    'admin_scopes', coalesce((
      select jsonb_agg(g.scope order by g.scope)
        from jc_admin_grants g
        join jc_codes c on c.community_id = g.community_id and c.scope = g.scope
                       and c.version = g.code_version
       where g.user_id = v_user and g.last_used_at > now() - interval '60 days'), '[]'::jsonb),
    -- T5.2b: events this person runs (incl. the 5-day read window after close)
    'admin_events', coalesce((
      select jsonb_agg(ea.event_id order by ev.created_at desc)
        from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
       where ea.user_id = v_user and ev.community_id = v_comm
         and (ev.status <> 'archived' or ev.archived_at > now() - interval '5 days')), '[]'::jsonb));
end;
$function$;

-- ---------- 6. grants (default privileges are closed: new functions start private) ----------
revoke execute on function public.jc_events_organizer(),
  public.jc_assert_event_admin(uuid, boolean) from public, anon, authenticated;
grant execute on function public.jc_event_admin_link_create(uuid), public.jc_event_admin_accept(text),
  public.jc_event_admins_list(uuid), public.jc_event_admin_revoke(uuid, uuid, uuid) to authenticated;
