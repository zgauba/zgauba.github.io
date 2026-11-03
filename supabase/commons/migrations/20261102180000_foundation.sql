-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- Jubail Commons foundation schema v1: per-community config, events, entries
-- (identity model), admin tar-pit, config RPC, built-in season deletion.
-- Security posture: RLS enabled in the same block as each CREATE TABLE, all
-- default grants revoked — RPCs are the only access path (jh_ lesson carried).

-- ---------- per-community config (DB is the ONLY source of truth) ----------
create table public.jc_communities (
  id            text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name_en       text not null,
  name_ar       text,
  map_lat       double precision not null check (map_lat between -90 and 90),
  map_lng       double precision not null check (map_lng between -180 and 180),
  map_zoom      int not null default 13 check (map_zoom between 3 and 20),
  villages      jsonb not null default '[]'  check (jsonb_typeof(villages) = 'array'),
  -- links/brand/modules/villages are PUBLIC BY DEFINITION (returned whole by
  -- jc_config_get) — private values get dedicated columns, never a jsonb key.
  links         jsonb not null default '{}'  check (jsonb_typeof(links) = 'object'),
  brand         jsonb not null default '{}'  check (jsonb_typeof(brand) = 'object'),
  -- per-module: {"enabled": bool, "read": "open"|"passcode"} — read-access flag
  -- exists because pets is residents-only while events maps are open-read.
  modules       jsonb not null default '{"events":{"enabled":false,"read":"open"},"bookings":{"enabled":false,"read":"passcode"},"pets":{"enabled":false,"read":"passcode"}}'
                check (jsonb_typeof(modules) = 'object'),
  passcode      text,
  admin_code    text,
  broadcast     text not null default '',
  retention_days int not null default 30 check (retention_days between 1 and 365),
  created_at    timestamptz not null default now()
);
alter table public.jc_communities enable row level security;
revoke all on table public.jc_communities from public, anon, authenticated;

-- ---------- events (one row per celebration/season) ----------
create table public.jc_events (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null references public.jc_communities(id),
  slug          text not null check (slug ~ '^[a-z][a-z0-9-]{1,40}$'),
  title_en      text not null,
  title_ar      text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  theme         jsonb not null default '{}' check (jsonb_typeof(theme) = 'object'),
  status        text not null default 'draft' check (status in ('draft','live','wrapped','closed')),
  created_at    timestamptz not null default now(),
  unique (community_id, slug)
);
alter table public.jc_events enable row level security;
revoke all on table public.jc_events from public, anon, authenticated;

-- ---------- entries (the identity model: a home's participation) ----------
create table public.jc_entries (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null references public.jc_communities(id),
  event_id      uuid not null references public.jc_events(id),
  home_type     text not null check (home_type in ('villa','townhouse','apartment')),
  unit          text not null,
  village       text not null,
  details       text,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  -- module-specific flags (treats type, out-of-stock, gate...) live here so the
  -- identity core stays stable across modules; modules may promote hot keys to
  -- real columns in their own migrations.
  state         jsonb not null default '{}' check (jsonb_typeof(state) = 'object'),
  edit_token    uuid not null default gen_random_uuid(),
  pin_hash      text,                                -- recovery PIN (hashed), optional
  pii           jsonb not null default '{}' check (jsonb_typeof(pii) = 'object'),
                                                     -- optional-PII slots: empty by default,
                                                     -- per-feature, opt-in, disclosed
  org_note      text,
  removed       boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.jc_entries enable row level security;
revoke all on table public.jc_entries from public, anon, authenticated;

-- duplicate guard as a constraint, not just an RPC check (jh lesson)
create unique index jc_entries_dedup on public.jc_entries
  (event_id, lower(trim(village)), regexp_replace(lower(unit), '\s+', '', 'g'))
  where not removed;

-- ---------- admin gate: tar-pit + rollback-surviving failure counter ----------
create sequence public.jc_admin_fail_count;
revoke all on sequence public.jc_admin_fail_count from public, anon, authenticated;

create or replace function public.jc_assert_admin(p_community text, p_code text)
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $$
begin
  if not exists (
    select 1 from jc_communities
    where id = p_community and admin_code is not null and admin_code = trim(p_code)
  ) then
    perform pg_sleep(1.5);
    perform nextval('public.jc_admin_fail_count');
    raise exception 'BAD_ADMIN';
  end if;
end;
$$;
revoke execute on function public.jc_assert_admin(text, text) from public, anon, authenticated;

-- ---------- public config read (whitelisted columns ONLY — never secrets) ----------
create or replace function public.jc_config_get(p_community text)
returns jsonb
language sql
security definer
set search_path to public, pg_temp
as $$
  select jsonb_build_object(
    'id', id, 'name_en', name_en, 'name_ar', name_ar,
    'map', jsonb_build_object('lat', map_lat, 'lng', map_lng, 'zoom', map_zoom),
    'villages', villages, 'links', links, 'brand', brand, 'modules', modules,
    'broadcast', broadcast, 'retention_days', retention_days
  )
  from public.jc_communities where id = p_community;
$$;

-- ---------- (removed) jc_season_close ----------
-- The delete-bearing close function that stood here was NEVER applied live
-- (tooling declined it; then superseded by archive-at-close, 2026-11-03 — KG6).
-- Removed from this mirror so the file matches apply history. Its replacement,
-- jc_event_close (snapshot → archive, deletes nothing), ships in T2 / S2.

-- Public RPCs granted explicitly: don't depend on default privileges staying
-- permissive if Supabase's defaults change.
grant execute on function public.jc_config_get(text) to anon, authenticated;

-- ---------- bootstrap: the flagship community ----------
-- passcode/admin_code seed as NULL and FAIL CLOSED (jc_assert_admin requires
-- admin_code is not null; future passcode checks must do the same). The real
-- codes are set by an out-of-band UPDATE that is never committed to this
-- public repo.
insert into public.jc_communities
  (id, name_en, name_ar, map_lat, map_lng, map_zoom, villages, links, passcode, admin_code)
values (
  'jubail',
  'Jubail Commons',
  null,  -- Arabic brand name pending the branding pass + native review
  24.552, 54.49, 13,
  '["Ain Al Maha","Bada Al Jubail","Marfaa Al Jubail","Nad Al Dhabi","Seef Al Jubail","Souk Al Jubail"]'::jsonb,
  '{"halloween_archive":"https://zgauba.github.io/jubail-halloween/"}'::jsonb,
  null,
  null
);
