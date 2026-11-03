-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T2 / S1 — identity, homes, household, admin. Plan: docs/plans/T2-schema-batch.md
--
-- Access model (D2): RLS on with zero policies, no table grants — every read
-- and write goes through a security-definer RPC. Community is derived from the
-- caller's membership (jc_me), never trusted from a client parameter; the only
-- exceptions are jc_config_get, jc_code_check and jc_join.
-- Admin unlock is account-bound (D3): a grant row per (user, scope), valid while
-- its code_version matches the live code and it was used in the last 60 days.
--
-- Codes stay unset after this migration: jc_join fails closed until the join
-- code is set out-of-band (after S4), which keeps every table empty mid-batch.
-- Bootstrap (SQL editor; the code is generated server-side and shown once):
--   select jc_code_bootstrap('jubail', 'community');
--
-- Standing rules this migration creates:
--   * Email is never an authorization key — confirmation is off, so it proves nothing.
--   * Remove accounts only through jc_account_delete / jc_admin_member_remove;
--     deleting a user from the dashboard skips offboarding (notices, invite expiry).
--   * jc_norm feeds stored generated columns + a unique index: changing it later
--     needs a rewrite of jc_homes (update ... set number_raw = number_raw) + REINDEX.
--   * Later slices: every user-reference column on history tables is
--     `references auth.users(id) on delete set null`, or account deletion fails.

-- ---------- 0. close the default doors ----------
-- Live default ACLs grant anon/authenticated everything in public. The schema-level
-- revokes undo those per-schema grants; the global one removes Postgres's built-in
-- EXECUTE-to-PUBLIC (which anon inherits), which a per-schema revoke cannot touch.
-- Side effect (intended): any function postgres creates later, in ANY schema, starts
-- closed — grant explicitly. Watch for this when enabling extensions (T4: pg_cron).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------- 1. pure helpers ----------
-- Arabic-Indic and Persian digits fold to ASCII so "١٢" and "12" are the same house.
create function public.jc_norm(p text) returns text
language sql immutable set search_path = public, pg_temp
as $$
  select nullif(upper(regexp_replace(
           translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
           '[^A-Za-z0-9]', '', 'g')), '')
$$;

create function public.jc_code_canon(p text) returns text
language sql immutable set search_path = public, pg_temp
as $$ select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) $$;

create function public.jc_mask_email(p text) returns text
language sql immutable set search_path = public, pg_temp
as $$ select case when p is null then null else left(p, 1) || '•••@' || split_part(p, '@', 2) end $$;

-- metres, equirectangular — accurate to well under 1% at island scale
create function public.jc_dist_m(a_lat double precision, a_lng double precision,
                                 b_lat double precision, b_lng double precision)
returns double precision
language sql immutable set search_path = public, pg_temp
as $$ select 6371000 * sqrt(power(radians(b_lat - a_lat), 2)
                          + power(radians(b_lng - a_lng) * cos(radians((a_lat + b_lat) / 2)), 2)) $$;

create sequence public.jc_join_fail_count;

-- ---------- 2. communities: secrets + villages move out; purge deferred (D5) ----------
alter table public.jc_communities add column tz text not null default 'Asia/Dubai';
alter table public.jc_communities
  drop column villages,        -- → jc_villages
  drop column passcode,        -- → jc_codes (hashed)
  drop column admin_code,      -- → jc_codes (hashed)
  drop column retention_days;  -- no purge path ships; don't advertise an unenforced policy

drop function public.jc_assert_admin(text, text);  -- replaced by account-bound grants

-- ---------- 3. villages (status + sub-areas) ----------
create table public.jc_villages (
  community_id  text not null references public.jc_communities(id),
  key           text not null check (key ~ '^[a-z][a-z0-9-]{1,40}$'),
  name_en       text not null,
  name_ar       text,
  status        text not null default 'delivered' check (status in ('delivered', 'upcoming')),
  delivery_label text,
  parent_key    text check (parent_key is distinct from key),  -- sub-area (Marsa ⊂ Marfaa)
  glyph         text,
  etymology_en  text,
  etymology_ar  text,
  sort          int not null default 0,
  primary key (community_id, key),
  foreign key (community_id, parent_key) references public.jc_villages(community_id, key)
);
alter table public.jc_villages enable row level security;

-- Arabic names + etymologies pending native review (T6).
insert into public.jc_villages (community_id, key, name_en, status, delivery_label, parent_key, sort) values
  ('jubail', 'ain-al-maha',      'Ain Al Maha',      'delivered', null,        null,               10),
  ('jubail', 'bada-al-jubail',   'Bada Al Jubail',   'upcoming',  'Late 2027', null,               20),
  ('jubail', 'marfaa-al-jubail', 'Marfaa Al Jubail', 'delivered', null,        null,               30),
  ('jubail', 'marsa-al-jubail',  'Marsa Al Jubail',  'delivered', null,        'marfaa-al-jubail', 31),
  ('jubail', 'nad-al-dhabi',     'Nad Al Dhabi',     'delivered', null,        null,               40),
  ('jubail', 'rimas',            'Rimas',            'upcoming',  '2030',      null,               50),
  ('jubail', 'seef-al-jubail',   'Seef Al Jubail',   'delivered', null,        null,               60),
  ('jubail', 'souk-al-jubail',   'Souk Al Jubail',   'delivered', null,        null,               70);

-- ---------- 4. codes (bcrypt-hashed; join + community admin + per-module admins) ----------
create table public.jc_codes (
  community_id  text not null references public.jc_communities(id),
  scope         text not null check (scope in ('join', 'community', 'events', 'bookings', 'pets')),
  code_hash     text not null,
  version       int not null default 1,
  rotated_at    timestamptz not null default now(),
  primary key (community_id, scope)
);
alter table public.jc_codes enable row level security;

-- ---------- 5. accounts, homes, household ----------
create table public.jc_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  community_id  text not null references public.jc_communities(id),
  display_name  text check (display_name is null or char_length(display_name) between 1 and 40),
  prefs         jsonb not null default '{}' check (jsonb_typeof(prefs) = 'object'),
  joined_at     timestamptz not null default now(),
  unique (user_id, community_id)
);
alter table public.jc_accounts enable row level security;

create table public.jc_homes (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null,
  village_key   text not null,
  home_type     text not null check (home_type in ('villa', 'townhouse', 'apartment')),
  building      text check (building is null or char_length(building) between 1 and 20),
  number_raw    text not null check (char_length(number_raw) between 1 and 12),
  building_norm text generated always as (coalesce(public.jc_norm(building), '')) stored,
  number_norm   text generated always as (public.jc_norm(number_raw)) stored,
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  pin_set_at    timestamptz,
  directory_suppressed boolean not null default false,
  flags         jsonb not null default '{}' check (jsonb_typeof(flags) = 'object'),
  created_at    timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check ((home_type = 'apartment') = (building is not null)),
  check (number_norm is not null),
  unique (id, community_id),
  foreign key (community_id, village_key) references public.jc_villages(community_id, key)
);
alter table public.jc_homes enable row level security;
-- the identity of a home: 12-A, 12a, "12 A" and "١٢A" are the same house
create unique index jc_homes_identity on public.jc_homes
  (community_id, village_key, building_norm, number_norm);

create table public.jc_home_members (
  user_id       uuid primary key,  -- one home per account
  community_id  text not null,
  home_id       uuid not null,
  via           text not null check (via in ('claim', 'invite')),
  joined_at     timestamptz not null default now(),
  foreign key (user_id, community_id) references public.jc_accounts(user_id, community_id) on delete cascade,
  foreign key (home_id, community_id) references public.jc_homes(id, community_id)
);
alter table public.jc_home_members enable row level security;
create index jc_home_members_home on public.jc_home_members (home_id);

create table public.jc_home_invites (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null,
  home_id       uuid not null,
  token_hash    text not null unique,  -- sha256; the token itself is shown once, never stored
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '72 hours',
  requested_by  uuid references auth.users(id) on delete set null,  -- accepted at cap → awaits admin
  used_by       uuid references auth.users(id) on delete set null,
  used_at       timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  declined_at   timestamptz,
  foreign key (home_id, community_id) references public.jc_homes(id, community_id)
);
alter table public.jc_home_invites enable row level security;
create index jc_home_invites_home on public.jc_home_invites (home_id);

-- ---------- 6. admin: account-bound grants, notices, action log ----------
create table public.jc_admin_grants (
  user_id       uuid not null,
  community_id  text not null,
  scope         text not null check (scope in ('community', 'events', 'bookings', 'pets')),
  code_version  int not null,
  granted_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  primary key (user_id, scope),
  foreign key (user_id, community_id) references public.jc_accounts(user_id, community_id) on delete cascade
);
alter table public.jc_admin_grants enable row level security;

create table public.jc_admin_notices (
  id            bigint generated always as identity primary key,
  community_id  text not null references public.jc_communities(id),
  kind          text not null check (kind in ('departure', 'over_cap', 'pin_flag')),
  home_id       uuid,
  detail        jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id) on delete set null,
  foreign key (home_id, community_id) references public.jc_homes(id, community_id)
);
alter table public.jc_admin_notices enable row level security;
create index jc_admin_notices_open on public.jc_admin_notices (community_id) where resolved_at is null;
-- one open notice per home per kind (re-pinning or leave/rejoin can't flood the queue);
-- over_cap is per invite, so it is excluded
create unique index jc_admin_notices_one_open on public.jc_admin_notices (home_id, kind)
  where resolved_at is null and kind <> 'over_cap';

-- append-only record of admin actions (who removed whom, who rotated what — never the code)
create table public.jc_admin_log (
  id            bigint generated always as identity primary key,
  community_id  text not null references public.jc_communities(id),
  actor         uuid references auth.users(id) on delete set null,
  action        text not null,
  target        jsonb not null default '{}' check (jsonb_typeof(target) = 'object'),
  at            timestamptz not null default now()
);
alter table public.jc_admin_log enable row level security;
create index jc_admin_log_recent on public.jc_admin_log (community_id, at desc);

-- ---------- 7. internal functions (no grants) ----------
-- Who is calling? Raises rather than returning empty: an authz failure must
-- never look like "no data".
create function public.jc_me(out o_user uuid, out o_community text, out o_home uuid)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  o_user := auth.uid();
  if o_user is null then raise exception 'NOT_SIGNED_IN'; end if;
  select a.community_id, m.home_id into o_community, o_home
    from jc_accounts a left join jc_home_members m on m.user_id = a.user_id
   where a.user_id = o_user;
  if o_community is null then raise exception 'NOT_MEMBER'; end if;
end;
$$;

-- Count every failure; slow only admin unlock. Codes are 10+ random chars, so a
-- delay buys no guessing protection — on the join paths (anon / open signup) it
-- would only let anyone pin DB connections. Admin unlock needs a resident
-- account, so its delay is attributable. Per-IP limits arrive with T3.
create function public.jc_fail(p_err text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- sequences are non-transactional: the count survives the raise below
  if p_err = 'BAD_ADMIN' then
    perform pg_sleep(1.5);
    perform nextval('public.jc_admin_fail_count');
  else
    perform nextval('public.jc_join_fail_count');
  end if;
  raise exception using message = p_err;
end;
$$;

create function public.jc_code_ok(p_community text, p_scope text, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from jc_codes
                  where community_id = p_community and scope = p_scope
                    and code_hash = extensions.crypt(jc_code_canon(p_code), code_hash));
$$;

-- Returns the new version (rotation kills grants on older versions).
-- 10+ characters: the guess-rate defence is entropy, not delay.
create function public.jc_code_set(p_community text, p_scope text, p_code text) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ver int;
begin
  if char_length(jc_code_canon(p_code)) < 10 then raise exception 'CODE_TOO_SHORT'; end if;
  insert into jc_codes as c (community_id, scope, code_hash)
  values (p_community, p_scope, extensions.crypt(jc_code_canon(p_code), extensions.gen_salt('bf', 8)))
  on conflict (community_id, scope) do update
    set code_hash = excluded.code_hash, version = c.version + 1, rotated_at = now()
  returning c.version into v_ver;
  return v_ver;
end;
$$;

-- 10 chars from an unambiguous 31-symbol alphabet (~8e14 combinations)
create function public.jc_code_new() returns text
language sql volatile set search_path = public, pg_temp
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(r.b, i) % 31) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(10) as b) r, generate_series(0, 9) i;
$$;

-- Out-of-band bootstrap: generates, stores, returns once. Never type a code into SQL.
create function public.jc_code_bootstrap(p_community text, p_scope text) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_code text := jc_code_new();
begin
  perform jc_code_set(p_community, p_scope, v_code);
  return v_code;
end;
$$;

-- Valid grant for p_scope (or community-wide); touches last_used_at. Returns the community.
create function public.jc_assert_admin(p_scope text) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  update jc_admin_grants g set last_used_at = now()
   where g.user_id = v_user
     and g.scope in (p_scope, 'community')
     and g.last_used_at > now() - interval '60 days'
     and g.code_version = (select c.version from jc_codes c
                            where c.community_id = g.community_id and c.scope = g.scope);
  if not found then raise exception 'NOT_ADMIN'; end if;
  return v_comm;
end;
$$;

create function public.jc_notice(p_comm text, p_kind text, p_home uuid, p_detail jsonb) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into jc_admin_notices (community_id, kind, home_id, detail)
  values (p_comm, p_kind, p_home, p_detail)
  on conflict (home_id, kind) where resolved_at is null and kind <> 'over_cap'
  do update set detail = excluded.detail, created_at = now();
$$;

create function public.jc_admin_log_add(p_comm text, p_action text, p_target jsonb) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into jc_admin_log (community_id, actor, action, target)
  values (p_comm, auth.uid(), p_action, p_target);
$$;

-- Shared validation for claim / edit. Returns the building to store (apartments only).
create function public.jc_home_validate(p_comm text, p_village text, p_type text,
                                        p_building text, p_number text) returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_status text; v_building text;
begin
  select status into v_status from jc_villages where community_id = p_comm and key = p_village;
  if v_status is null then raise exception 'BAD_VILLAGE'; end if;
  if v_status <> 'delivered' then raise exception 'VILLAGE_NOT_DELIVERED'; end if;
  if coalesce(p_type, '') not in ('villa', 'townhouse', 'apartment') then raise exception 'BAD_HOME_TYPE'; end if;
  v_building := case when p_type = 'apartment' then nullif(trim(p_building), '') end;
  if p_type = 'apartment' then
    if v_building is null then raise exception 'BUILDING_REQUIRED'; end if;
    if jc_norm(v_building) is null or char_length(v_building) > 20 then raise exception 'BAD_BUILDING'; end if;
  end if;
  if jc_norm(p_number) is null or char_length(trim(p_number)) > 12 then raise exception 'BAD_NUMBER'; end if;
  return v_building;
end;
$$;

-- The single offboarding path (self-serve leave, admin removal, account deletion).
-- S2/S3 extend this body: last member out cancels the home's future bookings + live entries.
create function public.jc_home_detach(p_user uuid, p_self_serve boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_home uuid; v_comm text; v_left int;
begin
  select home_id, community_id into v_home, v_comm from jc_home_members where user_id = p_user;
  if v_home is null then return null; end if;
  perform 1 from jc_homes where id = v_home for update;
  delete from jc_home_members where user_id = p_user and home_id = v_home;
  if not found then return null; end if;  -- moved concurrently; nothing of ours to undo
  -- invites die with the membership that issued them…
  update jc_home_invites set expires_at = least(expires_at, now())
   where home_id = v_home and created_by = p_user and used_at is null;
  select count(*) into v_left from jc_home_members where home_id = v_home;
  -- …and a vacant home starts clean for the next family
  if v_left = 0 then
    update jc_home_invites set expires_at = least(expires_at, now())
     where home_id = v_home and used_at is null;
  end if;
  perform jc_notice(v_comm, 'departure', v_home,
                    jsonb_build_object('vacant', v_left = 0, 'self_serve', p_self_serve));
  return v_home;
end;
$$;

-- ---------- 8. public config (contract: keys the landing reads are unchanged) ----------
create or replace function public.jc_config_get(p_community text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar,
    'map', jsonb_build_object('lat', c.map_lat, 'lng', c.map_lng, 'zoom', c.map_zoom),
    'tz', c.tz,
    'villages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', v.key, 'en', v.name_en, 'ar', v.name_ar, 'status', v.status,
               'delivery', v.delivery_label, 'parent', v.parent_key, 'glyph', v.glyph,
               'etymology_en', v.etymology_en, 'etymology_ar', v.etymology_ar)
             order by v.sort, v.key)
        from jc_villages v where v.community_id = c.id), '[]'::jsonb),
    'links', c.links, 'brand', c.brand, 'modules', c.modules, 'broadcast', c.broadcast)
  from jc_communities c where c.id = p_community;
$$;

-- ---------- 9. join & account ----------
-- UX pre-check for the code-first join screen (anon). jc_join re-checks; this grants nothing.
create function public.jc_code_check(p_community text, p_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if jc_code_ok(p_community, 'join', p_code) then return true; end if;
  perform jc_fail('BAD_CODE');
  return false;
end;
$$;

create function public.jc_me_get() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
       where g.user_id = v_user and g.last_used_at > now() - interval '60 days'), '[]'::jsonb));
end;
$$;

-- After Supabase Auth sign-up: the community code turns an auth user into a resident.
create function public.jc_join(p_community text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_existing text;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  select community_id into v_existing from jc_accounts where user_id = v_uid;
  if v_existing is not null then
    if v_existing = p_community then return jc_me_get(); end if;
    raise exception 'ALREADY_MEMBER_ELSEWHERE';
  end if;
  if not jc_code_ok(p_community, 'join', p_code) then perform jc_fail('BAD_CODE'); end if;
  begin
    insert into jc_accounts (user_id, community_id) values (v_uid, p_community);
  exception when unique_violation then null;  -- double-submit: the other call won
  end;
  return jc_me_get();
end;
$$;

create function public.jc_display_name_set(p_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_name text := nullif(trim(p_name), '');
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if char_length(v_name) > 40 then raise exception 'BAD_NAME'; end if;
  update jc_accounts set display_name = v_name where user_id = v_user;
  return jc_me_get();
end;
$$;

create function public.jc_prefs_set(p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if jsonb_typeof(p_prefs) is distinct from 'object' or octet_length(p_prefs::text) > 2048 then
    raise exception 'BAD_PREFS';
  end if;
  update jc_accounts set prefs = p_prefs where user_id = v_user;
  return jc_me_get();
end;
$$;

-- ---------- 10. homes ----------
-- First claim is open; a claimed home is joined only by invite. A vacant home
-- (no members) is reclaimed in place — pin and history stay with the house.
create function public.jc_home_claim(p_village text, p_type text, p_building text, p_number text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_building text;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is not null then raise exception 'ALREADY_HAS_HOME'; end if;
  v_building := jc_home_validate(v_comm, p_village, p_type, p_building, p_number);

  select id into v_home from jc_homes
   where community_id = v_comm and village_key = p_village
     and building_norm = coalesce(jc_norm(v_building), '') and number_norm = jc_norm(p_number)
   for update;
  if v_home is not null then
    if exists (select 1 from jc_home_members where home_id = v_home) then
      raise exception 'HOME_TAKEN';
    end if;
  else
    begin
      insert into jc_homes (community_id, village_key, home_type, building, number_raw)
      values (v_comm, p_village, p_type, v_building, trim(p_number))
      returning id into v_home;
    exception when unique_violation then raise exception 'HOME_TAKEN';
    end;
  end if;

  begin
    insert into jc_home_members (user_id, community_id, home_id, via)
    values (v_user, v_comm, v_home, 'claim');
  exception when unique_violation then raise exception 'ALREADY_HAS_HOME';
  end;
  return jc_me_get();
end;
$$;

-- Self-serve typo fix only while the home has a single account (prevents silent identity swaps).
create function public.jc_home_edit(p_village text, p_type text, p_building text, p_number text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_building text;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is null then raise exception 'NO_HOME'; end if;
  perform 1 from jc_homes where id = v_home for update;
  if (select count(*) from jc_home_members where home_id = v_home) > 1 then
    raise exception 'ADMIN_ASSIST_REQUIRED';
  end if;
  v_building := jc_home_validate(v_comm, p_village, p_type, p_building, p_number);
  begin
    update jc_homes set village_key = p_village, home_type = p_type,
                        building = v_building, number_raw = trim(p_number)
     where id = v_home;
  exception when unique_violation then raise exception 'HOME_TAKEN';
  end;
  return jc_me_get();
end;
$$;

-- Deterministic pin checks: flag, never block. Apartments in one building share a pin legitimately.
create function public.jc_home_pin_set(p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_flags jsonb := '{}'; v_near uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is null then raise exception 'NO_HOME'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BAD_PIN';
  end if;

  if (select jc_dist_m(p_lat, p_lng, c.map_lat, c.map_lng) > 10000
        from jc_communities c where c.id = v_comm) then
    v_flags := v_flags || '{"pin_far": true}';
  end if;
  select o.id into v_near
    from jc_homes o, jc_homes me
   where me.id = v_home and o.community_id = v_comm and o.id <> v_home and o.lat is not null
     and jc_dist_m(p_lat, p_lng, o.lat, o.lng) < 10
     and not (me.home_type = 'apartment' and o.home_type = 'apartment'
              and o.village_key = me.village_key and o.building_norm = me.building_norm)
   limit 1;
  if v_near is not null then v_flags := v_flags || jsonb_build_object('pin_near', v_near); end if;

  update jc_homes
     set lat = p_lat, lng = p_lng, pin_set_at = now(),
         flags = (flags - 'pin_far' - 'pin_near') || v_flags
   where id = v_home;
  if v_flags <> '{}' then perform jc_notice(v_comm, 'pin_flag', v_home, v_flags); end if;
  return jc_me_get();
end;
$$;

-- Signed-in residents see every home (directory always visible); admins can suppress one.
create function public.jc_directory_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'village', h.village_key, 'type', h.home_type, 'building', h.building,
             'number', h.number_raw, 'lat', h.lat, 'lng', h.lng)
           order by h.village_key, h.building_norm, h.number_norm)
      from jc_homes h
     where h.community_id = v_comm and not h.directory_suppressed), '[]'::jsonb);
end;
$$;

-- ---------- 11. household ----------
create function public.jc_invite_create() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_token text; v_exp timestamptz;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is null then raise exception 'NO_HOME'; end if;
  if (select count(*) from jc_home_invites
       where home_id = v_home and used_at is null and requested_by is null and expires_at > now()) >= 10 then
    raise exception 'TOO_MANY_INVITES';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into jc_home_invites (community_id, home_id, token_hash, created_by)
  values (v_comm, v_home, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user)
  returning expires_at into v_exp;
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end;
$$;

-- Household soft cap is 4: past it, acceptance parks the request for admin approval.
-- An invite is only as good as its issuer's membership: if they've left, it's dead.
create function public.jc_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; inv public.jc_home_invites%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is not null then raise exception 'ALREADY_HAS_HOME'; end if;
  select * into inv from jc_home_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if inv.id is null or inv.community_id <> v_comm then raise exception 'BAD_INVITE'; end if;
  if inv.declined_at is not null and inv.requested_by = v_user then raise exception 'INVITE_DECLINED'; end if;
  if inv.used_at is not null or inv.declined_at is not null or inv.expires_at <= now()
     or (inv.requested_by is not null and inv.requested_by <> v_user)
     or not exists (select 1 from jc_home_members
                     where user_id = inv.created_by and home_id = inv.home_id) then
    raise exception 'BAD_INVITE';
  end if;

  perform 1 from jc_homes where id = inv.home_id for update;
  if (select count(*) from jc_home_members where home_id = inv.home_id) >= 4 then
    if inv.requested_by is null then
      update jc_home_invites set requested_by = v_user where id = inv.id;
      perform jc_notice(v_comm, 'over_cap', inv.home_id, jsonb_build_object('invite_id', inv.id));
    end if;
    return jsonb_build_object('status', 'pending_approval');
  end if;

  begin
    insert into jc_home_members (user_id, community_id, home_id, via)
    values (v_user, v_comm, inv.home_id, 'invite');
  exception when unique_violation then raise exception 'ALREADY_HAS_HOME';
  end;
  update jc_home_invites set used_by = v_user, used_at = now() where id = inv.id;
  return jsonb_build_object('status', 'joined', 'me', jc_me_get());
end;
$$;

create function public.jc_home_leave() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if v_home is null then raise exception 'NO_HOME'; end if;
  perform jc_home_detach(v_user, true);
  return jc_me_get();
end;
$$;

-- "I'm leaving Jubail": leave the home, then delete the auth identity
-- (cascades the account and grants; history keeps the home, loses the person).
create function public.jc_account_delete(p_confirm text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  if p_confirm is distinct from 'DELETE' then raise exception 'CONFIRM_REQUIRED'; end if;
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_home_detach(v_user, true);
  delete from auth.users where id = v_user;
end;
$$;

-- ---------- 12. admin ----------
create function public.jc_admin_unlock(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; s text; v_ver int; v_scopes text[] := '{}';
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  foreach s in array array['community', 'events', 'bookings', 'pets'] loop
    v_ver := null;
    select version into v_ver from jc_codes
     where community_id = v_comm and scope = s
       and code_hash = extensions.crypt(jc_code_canon(p_code), code_hash);
    if v_ver is not null then
      insert into jc_admin_grants (user_id, community_id, scope, code_version)
      values (v_user, v_comm, s, v_ver)
      on conflict (user_id, scope) do update
        set code_version = excluded.code_version, granted_at = now(), last_used_at = now();
      v_scopes := v_scopes || s;
    end if;
  end loop;
  if cardinality(v_scopes) = 0 then perform jc_fail('BAD_ADMIN'); end if;
  return to_jsonb(v_scopes);
end;
$$;

-- "Exit admin" ends the unlock on every device (account-bound).
create function public.jc_admin_exit() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  delete from jc_admin_grants where user_id = v_user;
end;
$$;

-- Community admin only. New code is generated server-side and returned once (never logged).
create function public.jc_admin_code_rotate(p_scope text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_code text; v_ver int;
begin
  v_comm := jc_assert_admin('community');
  if coalesce(p_scope, '') not in ('join', 'community', 'events', 'bookings', 'pets') then
    raise exception 'BAD_SCOPE';
  end if;
  v_code := jc_code_new();
  v_ver := jc_code_set(v_comm, p_scope, v_code);
  -- the rotating admin keeps any unlock they hold on this scope
  update jc_admin_grants set code_version = v_ver, last_used_at = now()
   where user_id = auth.uid() and scope = p_scope;
  if p_scope = 'join' then
    update jc_admin_notices set resolved_at = now(), resolved_by = auth.uid()
     where community_id = v_comm and kind = 'departure' and resolved_at is null;
  end if;
  perform jc_admin_log_add(v_comm, 'code_rotate', jsonb_build_object('scope', p_scope, 'version', v_ver));
  return jsonb_build_object('scope', p_scope, 'code', v_code, 'version', v_ver);
end;
$$;

-- The Homes queue.
create function public.jc_admin_homes_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  return jsonb_build_object(
    'homes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'village', h.village_key, 'type', h.home_type, 'building', h.building,
               'number', h.number_raw, 'lat', h.lat, 'lng', h.lng, 'pin_set_at', h.pin_set_at,
               'suppressed', h.directory_suppressed, 'flags', h.flags, 'created_at', h.created_at,
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
$$;

-- Detach a member (squatter, reported move-out); optionally delete the orphaned account.
create function public.jc_admin_member_remove(p_user uuid, p_delete_account boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_home uuid;
begin
  v_comm := jc_assert_admin('community');
  if p_user = auth.uid() then raise exception 'USE_ACCOUNT_DELETE'; end if;
  if not exists (select 1 from jc_accounts where user_id = p_user and community_id = v_comm) then
    raise exception 'NOT_FOUND';
  end if;
  v_home := jc_home_detach(p_user, false);
  if coalesce(p_delete_account, false) then
    delete from auth.users where id = p_user;
  end if;
  perform jc_admin_log_add(v_comm, 'member_remove', jsonb_build_object(
    'user_id', p_user, 'home_id', v_home, 'account_deleted', coalesce(p_delete_account, false)));
  return jc_admin_homes_list();
end;
$$;

create function public.jc_admin_home_edit(p_home uuid, p_village text, p_type text,
                                          p_building text, p_number text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_building text;
begin
  v_comm := jc_assert_admin('community');
  perform 1 from jc_homes where id = p_home and community_id = v_comm for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_building := jc_home_validate(v_comm, p_village, p_type, p_building, p_number);
  begin
    update jc_homes set village_key = p_village, home_type = p_type,
                        building = v_building, number_raw = trim(p_number)
     where id = p_home;
  exception when unique_violation then raise exception 'HOME_TAKEN';
  end;
  perform jc_admin_log_add(v_comm, 'home_edit', jsonb_build_object(
    'home_id', p_home, 'village', p_village, 'type', p_type, 'number', trim(p_number)));
  return jc_admin_homes_list();
end;
$$;

create function public.jc_admin_home_suppress(p_home uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  update jc_homes set directory_suppressed = coalesce(p_on, false)
   where id = p_home and community_id = v_comm;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'home_suppress', jsonb_build_object('home_id', p_home, 'on', coalesce(p_on, false)));
  return jc_admin_homes_list();
end;
$$;

-- Approve or decline an over-cap household request.
create function public.jc_admin_invite_decide(p_invite uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; inv public.jc_home_invites%rowtype;
begin
  v_comm := jc_assert_admin('community');
  select * into inv from jc_home_invites
   where id = p_invite and community_id = v_comm and requested_by is not null
     and used_at is null and declined_at is null
   for update;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;

  if coalesce(p_approve, false) then
    perform 1 from jc_homes where id = inv.home_id for update;
    begin
      insert into jc_home_members (user_id, community_id, home_id, via)
      values (inv.requested_by, v_comm, inv.home_id, 'invite');
    exception when unique_violation then raise exception 'ALREADY_HAS_HOME';
    end;
    update jc_home_invites set used_by = inv.requested_by, used_at = now(), approved_by = auth.uid()
     where id = inv.id;
  else
    update jc_home_invites set declined_at = now() where id = inv.id;
  end if;

  update jc_admin_notices set resolved_at = now(), resolved_by = auth.uid()
   where community_id = v_comm and kind = 'over_cap' and resolved_at is null
     and detail ->> 'invite_id' = inv.id::text;
  perform jc_admin_log_add(v_comm, case when coalesce(p_approve, false) then 'invite_approve' else 'invite_decline' end,
                           jsonb_build_object('invite_id', inv.id, 'home_id', inv.home_id, 'user_id', inv.requested_by));
  return jc_admin_homes_list();
end;
$$;

create function public.jc_admin_notices_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'kind', n.kind, 'detail', n.detail, 'created_at', n.created_at,
             'home', case when h.id is null then null else jsonb_build_object(
                       'id', h.id, 'village', h.village_key, 'building', h.building,
                       'number', h.number_raw) end)
           order by n.created_at desc)
      from jc_admin_notices n left join jc_homes h on h.id = n.home_id
     where n.community_id = v_comm and n.resolved_at is null), '[]'::jsonb);
end;
$$;

create function public.jc_admin_notice_resolve(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_kind text; v_home uuid;
begin
  v_comm := jc_assert_admin('community');
  update jc_admin_notices set resolved_at = now(), resolved_by = auth.uid()
   where id = p_id and community_id = v_comm and resolved_at is null
  returning kind, home_id into v_kind, v_home;
  if v_kind is null then raise exception 'NOT_FOUND'; end if;
  if v_kind = 'pin_flag' then
    update jc_homes set flags = flags - 'pin_far' - 'pin_near' where id = v_home;
  end if;
  perform jc_admin_log_add(v_comm, 'notice_resolve', jsonb_build_object('notice_id', p_id, 'kind', v_kind));
  return jc_admin_notices_list();
end;
$$;

create function public.jc_admin_log_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', l.at, 'action', l.action, 'target', l.target,
             'actor', coalesce(a.display_name, jc_mask_email(u.email))) order by l.at desc)
      from (select * from jc_admin_log where community_id = v_comm order by at desc limit 100) l
      left join jc_accounts a on a.user_id = l.actor
      left join auth.users u on u.id = l.actor), '[]'::jsonb);
end;
$$;

-- ---------- 13. grants: deny everything, then the allowlist ----------
-- tests/sql/s1_identity_homes.test.sql asserts the live set equals exactly this list.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.jc_config_get(text)       to anon, authenticated;
grant execute on function public.jc_code_check(text, text) to anon, authenticated;

grant execute on function
  public.jc_join(text, text),
  public.jc_me_get(),
  public.jc_display_name_set(text),
  public.jc_prefs_set(jsonb),
  public.jc_home_claim(text, text, text, text),
  public.jc_home_edit(text, text, text, text),
  public.jc_home_pin_set(double precision, double precision),
  public.jc_directory_list(),
  public.jc_invite_create(),
  public.jc_invite_accept(text),
  public.jc_home_leave(),
  public.jc_account_delete(text),
  public.jc_admin_unlock(text),
  public.jc_admin_exit(),
  public.jc_admin_code_rotate(text),
  public.jc_admin_homes_list(),
  public.jc_admin_member_remove(uuid, boolean),
  public.jc_admin_home_edit(uuid, text, text, text, text),
  public.jc_admin_home_suppress(uuid, boolean),
  public.jc_admin_invite_decide(uuid, boolean),
  public.jc_admin_notices_list(),
  public.jc_admin_notice_resolve(bigint),
  public.jc_admin_log_list()
to authenticated;
