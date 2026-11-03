-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T2 / S2 — events, event-day state, crowd reports, archive-at-close,
-- instrumentation tables, Halloween 2026 baseline. Plan: docs/plans/T2-schema-batch.md
--
-- Builds on S1's rules (RPC-only, community from jc_me, default privileges closed —
-- new functions here start private; only the grants at the bottom open anything).
-- Module flag is the compliance kill switch: every resident events RPC raises
-- MODULE_OFF while jc_communities.modules.events.enabled is false. Admins can still
-- prepare drafts.
--
-- Event lifecycle: draft → live → archived. jc_event_close snapshots jc_event_stats,
-- marks entries archived and deletes NOTHING (archive-at-close; closes KG6).
-- STANDING RULE: jc_event_signup(uuid, jsonb) is frozen at launch — new per-event
-- fields go in the payload (validated against the event's payload_schema).

-- ---------- 0. module flags: drop the pre-accounts 'read' key (everything needs sign-in now) ----------
alter table public.jc_communities alter column modules
  set default '{"events": {"enabled": false}, "bookings": {"enabled": false}, "pets": {"enabled": false}}';
update public.jc_communities set modules = (
  select coalesce(jsonb_object_agg(m.key, m.value - 'read'), '{}') from jsonb_each(modules) m);

-- ---------- 1. events: replace the per-person entries model with home-scoped entries ----------
drop table public.jc_entries;  -- 0 rows; superseded by jc_event_entries (identity is the home now)

alter table public.jc_events drop constraint jc_events_status_check;
alter table public.jc_events add constraint jc_events_status_check check (status in ('draft', 'live', 'archived'));
alter table public.jc_events
  add column description_en text,
  add column description_ar text,
  add column features       jsonb not null default '{}' check (jsonb_typeof(features) = 'object'),
  add column payload_schema jsonb not null default '{"fields": {}}' check (jsonb_typeof(payload_schema) = 'object'),
  add column safety         jsonb not null default '{}' check (jsonb_typeof(safety) = 'object'),
  add column signups_open   boolean not null default true,
  add column archived_at    timestamptz,
  add column created_by     uuid references auth.users(id) on delete set null;
alter table public.jc_events
  add constraint jc_events_window check (ends_at is null or starts_at is null or ends_at >= starts_at),
  add constraint jc_events_archived check ((status = 'archived') = (archived_at is not null)),
  add constraint jc_events_id_community unique (id, community_id),
  add constraint jc_events_text_caps check (
        char_length(title_en) between 1 and 120
    and (title_ar is null or char_length(title_ar) <= 120)
    and (description_en is null or char_length(description_en) <= 2000)
    and (description_ar is null or char_length(description_ar) <= 2000)),
  add constraint jc_events_json_caps check (
        octet_length(theme::text) <= 2048 and octet_length(safety::text) <= 2048
    and octet_length(payload_schema::text) <= 8192);

create table public.jc_event_entries (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null,
  community_id  text not null,
  home_id       uuid not null,
  status        text not null default 'in' check (status in ('in', 'withdrawn')),
  payload       jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  note          text check (note is null or char_length(note) <= 280),
  live_state    text not null default 'active' check (live_state in ('active', 'done')),  -- the giant switch
  supply_level  smallint check (supply_level between 0 and 3),
  reports_locked_until timestamptz,
  hidden        boolean not null default false,  -- admin moderation
  org_note      text check (org_note is null or char_length(org_note) <= 280),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  unique (event_id, home_id),  -- one entry per home: household members edit the same row
  unique (id, community_id),
  foreign key (event_id, community_id) references public.jc_events(id, community_id),
  foreign key (home_id, community_id) references public.jc_homes(id, community_id)
);
alter table public.jc_event_entries enable row level security;
create index jc_event_entries_home on public.jc_event_entries (home_id);
create index jc_event_entries_updated_by on public.jc_event_entries (updated_by) where updated_by is not null;
create index jc_events_created_by on public.jc_events (created_by) where created_by is not null;

-- crowd reports: one open report per reporting HOME (throwaway accounts can't stack;
-- homeless accounts can't report at all). "3+" means three distinct households.
create table public.jc_entry_reports (
  id            bigint generated always as identity primary key,
  entry_id      uuid not null references public.jc_event_entries(id),
  reporter      uuid not null references auth.users(id) on delete cascade,
  reporter_home uuid not null references public.jc_homes(id),
  created_at    timestamptz not null default now(),
  cleared_at    timestamptz
);
alter table public.jc_entry_reports enable row level security;
create unique index jc_entry_reports_open on public.jc_entry_reports (entry_id, reporter_home) where cleared_at is null;
create index jc_entry_reports_by_home on public.jc_entry_reports (reporter_home) where cleared_at is null;
create index jc_entry_reports_entry on public.jc_entry_reports (entry_id);
create index jc_entry_reports_reporter on public.jc_entry_reports (reporter);

-- ---------- 2. instrumentation (Halloween retro: capture from day one) ----------
-- append-only entry state changes: "when did homes actually run out?"
create table public.jc_state_log (
  id            bigint generated always as identity primary key,
  community_id  text not null references public.jc_communities(id),
  event_id      uuid,
  entry_id      uuid,
  field         text not null,
  value         jsonb,
  actor         uuid references auth.users(id) on delete set null,
  at            timestamptz not null default now(),
  foreign key (event_id, community_id) references public.jc_events(id, community_id)
);
alter table public.jc_state_log enable row level security;
create index jc_state_log_event on public.jc_state_log (event_id, at);
create index jc_state_log_actor on public.jc_state_log (actor) where actor is not null;

create table public.jc_event_stats (
  event_id      uuid primary key,
  community_id  text not null,
  snapshot      jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source        text not null check (source in ('snapshot', 'manual')),
  taken_at      timestamptz not null default now(),
  foreign key (event_id, community_id) references public.jc_events(id, community_id)
);
alter table public.jc_event_stats enable row level security;

-- first-party traffic counter: page × hour, no cookies, no IPs. Written by jc_hit (anon).
create table public.jc_hits (
  community_id  text not null references public.jc_communities(id),
  page          text not null check (page in ('landing', 'events', 'courts', 'pets', 'community', 'home', 'admin', 'stats')),
  hour          timestamptz not null,
  count         bigint not null default 0,
  primary key (community_id, page, hour)
);
alter table public.jc_hits enable row level security;

-- generic periodic snapshots; the cron that writes them is T4. One row per
-- (community, module, bucket) so a retried or double-fired job upserts, never duplicates.
create table public.jc_snapshots (
  id            bigint generated always as identity primary key,
  community_id  text not null references public.jc_communities(id),
  module        text not null check (module in ('homes', 'accounts', 'events', 'bookings', 'pets', 'traffic')),
  bucket        timestamptz not null,  -- the period start the cron is snapshotting (e.g. the hour)
  taken_at      timestamptz not null default now(),
  metrics       jsonb not null check (jsonb_typeof(metrics) = 'object'),
  unique (community_id, module, bucket)
);
alter table public.jc_snapshots enable row level security;

-- ---------- 3. internal helpers (no grants) ----------
create function public.jc_module_on(p_comm text, p_module text) returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce((select (modules -> p_module ->> 'enabled')::boolean
                     from jc_communities where id = p_comm), false) then
    raise exception 'MODULE_OFF';
  end if;
end;
$$;

create function public.jc_log(p_comm text, p_event uuid, p_entry uuid, p_field text, p_value jsonb) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into jc_state_log (community_id, event_id, entry_id, field, value, actor)
  values (p_comm, p_event, p_entry, p_field, p_value, auth.uid());
$$;

create function public.jc_features_check(p jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'BAD_FEATURES'; end if;
  if exists (select 1 from jsonb_each(p) f
              where f.key not in ('giant_switch', 'supply', 'crowd_reports', 'route', 'safety')
                 or jsonb_typeof(f.value) <> 'boolean') then
    raise exception 'BAD_FEATURES';
  end if;
end;
$$;

-- payload_schema: {"fields": {"<key>": {"type": "enum"|"text"|"bool", "values": [...], "max": 1..280, "required": bool}}}
create function public.jc_schema_check(p jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp
as $$
declare f record;
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

-- theme = {token: "#RRGGBB"} (layer-3 colour overlay); safety = {key: short text}
create function public.jc_kv_check(p jsonb, p_kind text) returns void
language plpgsql immutable set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'BAD_FIELDS'; end if;
  if exists (select 1 from jsonb_each(p) f
              where f.key !~ '^[a-z][a-z0-9_-]{0,30}$'
                 or jsonb_typeof(f.value) <> 'string'
                 or (p_kind = 'theme' and (f.value #>> '{}') !~ '^#[0-9a-fA-F]{6}$')
                 or (p_kind = 'safety' and char_length(f.value #>> '{}') > 500)) then
    raise exception 'BAD_FIELDS';
  end if;
end;
$$;

-- Free text shown to other residents: strip control chars (keep newline/tab) and
-- bidi overrides that can spoof how a note reads.
create function public.jc_clean_text(p text) returns text
language sql immutable set search_path = public, pg_temp
as $$ select nullif(trim(regexp_replace(p, '[\x01-\x08\x0B-\x1F\x7F‪-‮⁦-⁩]', '', 'g')), '') $$;

-- Validates a signup payload against the event schema; returns it minus the reserved 'note'.
create function public.jc_payload_check(p_schema jsonb, p_payload jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp
as $$
declare k text; v jsonb; spec jsonb; v_out jsonb := '{}';
begin
  p_payload := coalesce(p_payload, '{}');
  if jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 2048 then
    raise exception 'BAD_PAYLOAD';
  end if;
  for k, v in select key, value from jsonb_each(p_payload) loop
    continue when k = 'note';
    spec := p_schema -> 'fields' -> k;
    if spec is null then raise exception 'BAD_PAYLOAD'; end if;
    if (spec ->> 'type' = 'enum' and (jsonb_typeof(v) <> 'string' or not (spec -> 'values') ? (v #>> '{}')))
       or (spec ->> 'type' = 'text' and (jsonb_typeof(v) <> 'string'
                                         or char_length(v #>> '{}') > coalesce((spec ->> 'max')::int, 200)))
       or (spec ->> 'type' = 'bool' and jsonb_typeof(v) <> 'boolean') then
      raise exception 'BAD_PAYLOAD';
    end if;
    if spec ->> 'type' = 'text' then
      v := to_jsonb(jc_clean_text(v #>> '{}'));
      continue when v is null;  -- text that was only control chars counts as absent
    end if;
    v_out := v_out || jsonb_build_object(k, v);
  end loop;
  if exists (select 1 from jsonb_each(coalesce(p_schema -> 'fields', '{}')) f
              where coalesce((f.value ->> 'required')::boolean, false) and not v_out ? f.key) then
    raise exception 'PAYLOAD_INCOMPLETE';
  end if;
  return v_out;
end;
$$;

-- Re-check, under a row lock, that the caller still belongs to v_home. jc_home_detach
-- deletes the membership row, so it serializes against this.
create function public.jc_home_hold(p_user uuid, p_home uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_home is null then raise exception 'NO_HOME'; end if;
  perform 1 from jc_home_members where user_id = p_user and home_id = p_home for share;
  if not found then raise exception 'NO_HOME'; end if;
end;
$$;

-- Aggregate an event's live entries. Sub-areas roll up to their parent village
-- (Marsa counts as Marfaa); only enum/bool payload fields are tallied, never free text.
create function public.jc_event_snapshot(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_schema jsonb; r jsonb;
begin
  select payload_schema into v_schema from jc_events where id = p_event;
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
    'by_village', coalesce((select jsonb_object_agg(village, n)
                              from (select village, count(*) n from e group by village) a), '{}'),
    'by_type',    coalesce((select jsonb_object_agg(home_type, n)
                              from (select home_type, count(*) n from e group by home_type) b), '{}'),
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
$$;

-- What happens when a home's last member leaves. Its own function so later slices
-- extend THIS body (S3: cancel future bookings) instead of re-copying jc_home_detach.
create function public.jc_home_vacated(p_home uuid) returns void
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
end;
$$;

-- S1's single offboarding path, now delegating vacancy to jc_home_vacated.
create or replace function public.jc_home_detach(p_user uuid, p_self_serve boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_home uuid; v_comm text; v_left int;
begin
  select home_id, community_id into v_home, v_comm from jc_home_members where user_id = p_user;
  if v_home is null then return null; end if;
  perform 1 from jc_homes where id = v_home for update;
  delete from jc_home_members where user_id = p_user and home_id = v_home;
  if not found then return null; end if;  -- moved concurrently; nothing of ours to undo
  -- invites die with the membership that issued them
  update jc_home_invites set expires_at = least(expires_at, now())
   where home_id = v_home and created_by = p_user and used_at is null;
  select count(*) into v_left from jc_home_members where home_id = v_home;
  if v_left = 0 then perform jc_home_vacated(v_home); end if;
  perform jc_notice(v_comm, 'departure', v_home,
                    jsonb_build_object('vacant', v_left = 0, 'self_serve', p_self_serve));
  return v_home;
end;
$$;

-- ---------- 4. resident RPCs ----------
create function public.jc_events_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
$$;

-- Live: the map/list. Archived: stats only — archive keeps rows for each home's own
-- history, not for browsing other households' past entries.
create function public.jc_event_get(p_event uuid) returns jsonb
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
               'number', h.number_raw, 'lat', h.lat, 'lng', h.lng,
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

-- FROZEN SIGNATURE. Sign up or update the home's entry (household members share one row).
create function public.jc_event_signup(p_event uuid, p_payload jsonb) returns jsonb
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

create function public.jc_entry_withdraw(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  perform 1 from jc_events where id = p_event and community_id = v_comm and status = 'live' for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  update jc_event_entries set status = 'withdrawn', updated_at = now(), updated_by = v_user
   where event_id = p_event and home_id = v_home and status = 'in'
  returning id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  update jc_entry_reports set cleared_at = now() where entry_id = v_entry and cleared_at is null;
  perform jc_log(v_comm, p_event, v_entry, 'status', '"withdrawn"');
  return jc_event_get(p_event);
end;
$$;

-- The giant switch (active/done) and the supply level, each behind its event feature flag.
-- Going "done" confirms any crowd reports, so they clear.
create function public.jc_entry_live_set(p_event uuid, p_state text, p_supply int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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
$$;

-- Report a home "out". 1 → private banner to the owner; 3+ → public ❓. Never auto-toggles.
create function public.jc_entry_report(p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; en public.jc_event_entries%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  select e.* into en from jc_event_entries e
    join jc_events ev on ev.id = e.event_id
    join jc_homes h on h.id = e.home_id
   where e.id = p_entry and e.community_id = v_comm and e.status = 'in' and not e.hidden
     and not h.directory_suppressed
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
$$;

-- Owner: "we're not out" — clears reports and locks new ones for 30 minutes.
create function public.jc_entry_reports_clear(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then raise exception 'NO_HOME'; end if;
  update jc_event_entries en set reports_locked_until = now() + interval '30 minutes', updated_at = now()
   where en.event_id = p_event and en.home_id = v_home and en.status = 'in' and en.archived_at is null
     and exists (select 1 from jc_events ev where ev.id = en.event_id and ev.status = 'live')
  returning en.id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  update jc_entry_reports set cleared_at = now() where entry_id = v_entry and cleared_at is null;
  perform jc_log(v_comm, p_event, v_entry, 'reports_cleared', 'true');
  return jc_event_get(p_event);
end;
$$;

-- "Our year": the home's participation history (home-scoped: it stays with the house).
create function public.jc_my_history() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  if v_home is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'event_id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
             'starts_at', ev.starts_at, 'event_status', ev.status)
           order by coalesce(ev.starts_at, ev.created_at) desc)
      from jc_event_entries en join jc_events ev on ev.id = en.event_id
     where en.home_id = v_home and en.status = 'in' and ev.status in ('live', 'archived')), '[]'::jsonb);
end;
$$;

-- Aggregates only. Archived → the stored snapshot; live → computed now.
create function public.jc_event_stats_get(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_status text;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  select status into v_status from jc_events where id = p_event and community_id = v_comm;
  if v_status is null or v_status = 'draft' then raise exception 'NOT_FOUND'; end if;
  if v_status = 'archived' then
    return (select snapshot || jsonb_build_object('source', source) from jc_event_stats where event_id = p_event);
  end if;
  return jc_event_snapshot(p_event) || '{"source": "live"}';
end;
$$;

-- Anon page-hit counter. Abuse ceiling: counts can be inflated, rows cannot grow beyond
-- communities × 8 pages × hours.
create function public.jc_hit(p_community text, p_page text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from jc_communities where id = p_community) then raise exception 'NOT_FOUND'; end if;
  if p_page is null then raise exception 'BAD_PAGE'; end if;
  insert into jc_hits (community_id, page, hour, count)
  values (p_community, p_page, date_trunc('hour', now()), 1)
  on conflict (community_id, page, hour) do update set count = jc_hits.count + 1;
exception when check_violation then raise exception 'BAD_PAGE';
end;
$$;

-- ---------- 5. admin RPCs (events scope or community) ----------
create function public.jc_admin_events_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
             'description_en', ev.description_en, 'description_ar', ev.description_ar,
             'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
             'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
             'payload_schema', ev.payload_schema, 'safety', ev.safety, 'created_at', ev.created_at,
             'entries', (select count(*) from jc_event_entries en where en.event_id = ev.id and en.status = 'in'))
           order by ev.created_at desc)
      from jc_events ev where ev.community_id = v_comm), '[]'::jsonb);
end;
$$;

-- Create (p_event null) or edit. Field allowlist; schema locked once the event has entries.
create function public.jc_admin_event_save(p_event uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_event uuid := p_event; v_status text;
begin
  v_comm := jc_assert_admin('events');
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
$$;

create function public.jc_admin_event_publish(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');
  update jc_events set status = 'live', signups_open = true
   where id = p_event and community_id = v_comm and status = 'draft';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_publish', jsonb_build_object('event_id', p_event));
  return jc_admin_events_list();
end;
$$;

create function public.jc_admin_event_signups(p_event uuid, p_open boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('events');
  update jc_events set signups_open = coalesce(p_open, false)
   where id = p_event and community_id = v_comm and status = 'live';
  if not found then raise exception 'BAD_STATE'; end if;
  perform jc_admin_log_add(v_comm, 'event_signups', jsonb_build_object('event_id', p_event, 'open', coalesce(p_open, false)));
  return jc_admin_events_list();
end;
$$;

-- List-first admin view: everything, including hidden and withdrawn.
create function public.jc_admin_entries_list(p_event uuid) returns jsonb
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
             'payload', en.payload, 'note', en.note, 'live_state', en.live_state,
             'supply_level', en.supply_level, 'hidden', en.hidden, 'org_note', en.org_note,
             'reports_open', (select count(*) from jc_entry_reports r where r.entry_id = en.id and r.cleared_at is null),
             'created_at', en.created_at, 'updated_at', en.updated_at)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_event_entries en join jc_homes h on h.id = en.home_id
     where en.event_id = p_event), '[]'::jsonb);
end;
$$;

create function public.jc_admin_entry_moderate(p_entry uuid, p_hidden boolean, p_org_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_event uuid;
begin
  v_comm := jc_assert_admin('events');
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
$$;

-- Archive-at-close (UC-F4): type-to-confirm with the slug → lock → close signups →
-- snapshot jc_event_stats → mark entries archived → status archived. Deletes nothing.
create function public.jc_event_close(p_event uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; ev public.jc_events%rowtype; v_snap jsonb;
begin
  v_comm := jc_assert_admin('events');
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
  perform jc_admin_log_add(v_comm, 'event_close', jsonb_build_object(
    'event_id', ev.id, 'slug', ev.slug, 'homes', v_snap -> 'homes'));
  return v_snap;
end;
$$;

-- ---------- 6. seed: Halloween 2026 archive baseline (decision D6) ----------
-- Hand-written from docs/halloween-2026-final.md (recorded before SignalPost's rows
-- were deleted). No jh_ data is imported. Times are the calendar day — the event's
-- exact hours were never recorded.
insert into public.jc_events
  (community_id, slug, title_en, starts_at, ends_at, status, archived_at, signups_open, features, payload_schema)
values (
  'jubail', 'halloween-2026', 'Halloween 2026',
  '2026-10-31 00:00+04', '2026-10-31 23:59+04', 'archived', '2026-11-03 00:00+04', false,
  '{"giant_switch": true}',
  '{"fields": {
     "treats":   {"type": "enum", "values": ["candy", "non_food", "both"], "required": true},
     "handout":  {"type": "enum", "values": ["door", "self_serve"], "required": true},
     "entrance": {"type": "enum", "values": ["front", "garden", "both"], "required": true}}}');

insert into public.jc_event_stats (event_id, community_id, snapshot, source, taken_at)
select id, 'jubail', '{
  "homes": 124,
  "done": 33,
  "by_village": {"souk-al-jubail": 44, "nad-al-dhabi": 31, "seef-al-jubail": 26,
                 "ain-al-maha": 21, "marfaa-al-jubail": 2},
  "by_type": {"villa": 96, "townhouse": 28},
  "supply": {},
  "payload": {"treats":   {"candy": 102, "both": 19, "non_food": 3},
              "handout":  {"door": 86, "self_serve": 38},
              "entrance": {"front": 111, "garden": 8, "both": 5}},
  "legacy": {"entries_total": 127, "removed": 3, "peak_snapshot_homes": 128,
             "signup_window": ["2026-10-04", "2026-10-31"],
             "traffic": {"unique_visitors": 355, "map_loads": 4947,
                         "peak_hour": "17:00", "peak_visitors": 175},
             "source": "SignalPost jh_ tables, recorded in docs/halloween-2026-final.md"}
}'::jsonb, 'manual', '2026-11-03 00:00+04'
  from public.jc_events where community_id = 'jubail' and slug = 'halloween-2026';

-- ---------- 7. grants (new functions start closed — S1's default privileges) ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant execute on function public.jc_hit(text, text) to anon, authenticated;

grant execute on function
  public.jc_events_list(),
  public.jc_event_get(uuid),
  public.jc_event_signup(uuid, jsonb),
  public.jc_entry_withdraw(uuid),
  public.jc_entry_live_set(uuid, text, int),
  public.jc_entry_report(uuid),
  public.jc_entry_reports_clear(uuid),
  public.jc_my_history(),
  public.jc_event_stats_get(uuid),
  public.jc_admin_events_list(),
  public.jc_admin_event_save(uuid, jsonb),
  public.jc_admin_event_publish(uuid),
  public.jc_admin_event_signups(uuid, boolean),
  public.jc_admin_entries_list(uuid),
  public.jc_admin_entry_moderate(uuid, boolean, text),
  public.jc_event_close(uuid, text)
to authenticated;
