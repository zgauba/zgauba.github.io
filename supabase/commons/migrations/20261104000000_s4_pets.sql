-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T2 / S4 — Pets of Jubail: owned pets (wanderer = attribute), strays under the Pets
-- admin's care, missing alerts, sightings, care log, and pet photos in Supabase Storage.
-- Plan: docs/plans/T2-schema-batch.md. Builds on S1–S3 rules.
--
-- Storage is the one place the RPC-only rule cannot hold: files go through the Storage
-- API, which is governed by RLS on storage.objects. So this slice adds exactly two
-- policies (INSERT, SELECT) on one private bucket, each delegating to a SECURITY DEFINER
-- predicate in schema jc_private. jc_private is NOT in PostgREST's exposed schemas
-- (verified live: "Only the following schemas are exposed: public, graphql_public") —
-- never add it there. No UPDATE/DELETE policies: objects are write-once at a
-- server-chosen random path; replacing a photo writes a new object.
--
-- Photo ledger: every path ever issued is a row in jc_pet_photos (pending → current →
-- retired). T4's cleanup deletes objects for 'retired' rows and for 'pending' rows older
-- than an hour, via the Storage API (SQL deletes are blocked by Storage), then stamps
-- purged_at. Known residual until then: a signed URL minted while a photo was current
-- keeps working until its TTL or the purge — clients mint short TTLs.
--
-- Upload flow: jc_pet_photo_begin → client uploads to the returned path (non-upsert)
-- → jc_pet_photo_commit, all within 15 minutes. Limits: 20 begins per account per day;
-- a new begin is refused while someone else's upload for the same pet is < 60 s old.
--
-- Also: a BEFORE DELETE trigger on auth.users runs the offboarding path, so deleting a
-- user from the dashboard (not via jc_account_delete) still vacates the home properly.
-- It must be on auth.users, not jc_accounts: a cascade deletes the auth row FIRST, so a
-- trigger further down would run after the user it's offboarding is already gone.
-- Lock order: membership → admin grant → pet row.

-- ---------- 1. tables ----------
create table public.jc_pets (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null,
  kind          text not null check (kind in ('owned', 'stray')),
  home_id       uuid,
  species       text not null check (species in ('cat', 'dog', 'bird', 'rabbit', 'other')),
  name          text not null check (char_length(name) between 1 and 40),
  description   text check (description is null or char_length(description) <= 280),
  wanderer      boolean not null default false,   -- owned only: "known to roam, don't worry"
  microchipped  boolean not null default false,
  missing       boolean not null default false,   -- owned only: the emergency banner
  missing_since timestamptz,
  last_seen_note text check (last_seen_note is null or char_length(last_seen_note) <= 200),
  care_state    text check (care_state in ('under_care', 'needs_help', 'rehomed')),  -- strays only
  status        text not null default 'active' check (status in ('active', 'archived')),
  photo_path    text,
  pending_photo_path text,
  pending_photo_by   uuid references auth.users(id) on delete set null,
  pending_photo_at   timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  check ((kind = 'owned') = (home_id is not null)),
  check (kind = 'owned' or (not wanderer and not missing)),
  check ((kind = 'stray') = (care_state is not null)),
  check (missing = (missing_since is not null)),
  -- an archived pet has nothing live: no banner, no photo, no upload in flight
  check (status = 'active' or (not missing and photo_path is null and pending_photo_path is null
                               and last_seen_note is null)),
  unique (id, community_id),
  foreign key (home_id, community_id) references public.jc_homes(id, community_id),
  foreign key (community_id) references public.jc_communities(id)
);
alter table public.jc_pets enable row level security;
create index jc_pets_board on public.jc_pets (community_id, status, missing desc, name);
create index jc_pets_home on public.jc_pets (home_id) where home_id is not null;
create unique index jc_pets_pending_path on public.jc_pets (pending_photo_path) where pending_photo_path is not null;
create unique index jc_pets_photo_path on public.jc_pets (photo_path) where photo_path is not null;
create index jc_pets_created_by on public.jc_pets (created_by) where created_by is not null;
create index jc_pets_updated_by on public.jc_pets (updated_by) where updated_by is not null;
create index jc_pets_pending_by on public.jc_pets (pending_photo_by) where pending_photo_by is not null;

-- every storage path ever issued — the work queue for T4's object cleanup
create table public.jc_pet_photos (
  path          text primary key,
  community_id  text not null,
  pet_id        uuid not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  state         text not null default 'pending' check (state in ('pending', 'current', 'retired')),
  retired_at    timestamptz,
  purged_at     timestamptz,  -- set by T4 after the Storage API delete
  check ((state = 'retired') = (retired_at is not null)),
  foreign key (pet_id, community_id) references public.jc_pets(id, community_id)
);
alter table public.jc_pet_photos enable row level security;
create index jc_pet_photos_pet on public.jc_pet_photos (pet_id);
create index jc_pet_photos_by on public.jc_pet_photos (created_by, created_at) where created_by is not null;
create index jc_pet_photos_sweep on public.jc_pet_photos (state, created_at) where purged_at is null;

-- "I saw this pet": reassurance for a wanderer, an update for a stray, an alert for a missing pet
create table public.jc_pet_sightings (
  id            bigint generated always as identity primary key,
  community_id  text not null,
  pet_id        uuid not null,
  reporter      uuid references auth.users(id) on delete set null,
  note          text check (note is null or char_length(note) <= 280),
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  seen_at       timestamptz not null default now(),
  hidden        boolean not null default false,  -- admin moderation
  check ((lat is null) = (lng is null)),
  foreign key (pet_id, community_id) references public.jc_pets(id, community_id)
);
alter table public.jc_pet_sightings enable row level security;
create index jc_pet_sightings_pet on public.jc_pet_sightings (pet_id, seen_at desc);
create index jc_pet_sightings_reporter on public.jc_pet_sightings (reporter, seen_at) where reporter is not null;
create index jc_pet_sightings_seen on public.jc_pet_sightings (seen_at);  -- T4 retention

-- strays' feeding / vet record, written by the Pets admin
create table public.jc_pet_care_log (
  id            bigint generated always as identity primary key,
  community_id  text not null,
  pet_id        uuid not null,
  author        uuid references auth.users(id) on delete set null,
  kind          text not null check (kind in ('fed', 'vet', 'note', 'state')),
  note          text not null check (char_length(note) between 1 and 280),
  created_at    timestamptz not null default now(),
  foreign key (pet_id, community_id) references public.jc_pets(id, community_id)
);
alter table public.jc_pet_care_log enable row level security;
create index jc_pet_care_log_pet on public.jc_pet_care_log (pet_id, created_at desc);
create index jc_pet_care_log_author on public.jc_pet_care_log (author) where author is not null;

-- ---------- 2. internal helpers (public schema, no grants) ----------
-- Non-raising admin check (for "may this caller see owner-only data?").
create function public.jc_admin_has(p_scope text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from jc_admin_grants g
     where g.user_id = auth.uid() and g.scope in (p_scope, 'community')
       and g.last_used_at > now() - interval '60 days'
       and g.code_version = (select c.version from jc_codes c
                              where c.community_id = g.community_id and c.scope = g.scope));
$$;

-- One pet as residents see it. Home label hidden for directory-suppressed homes.
create function public.jc_pet_card(p_pet uuid, p_viewer_home uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'species', p.species, 'name', p.name,
    'description', p.description, 'wanderer', p.wanderer, 'microchipped', p.microchipped,
    'missing', p.missing, 'missing_since', p.missing_since, 'last_seen_note', p.last_seen_note,
    'care_state', p.care_state, 'photo_path', p.photo_path,
    'mine', p.home_id is not null and p.home_id = p_viewer_home,
    'home', case when h.id is not null and not h.directory_suppressed then
                   jsonb_build_object('village', h.village_key, 'building', h.building, 'number', h.number_raw) end)
  from jc_pets p left join jc_homes h on h.id = p.home_id
  where p.id = p_pet;
$$;

-- Who may edit / photograph a pet: its household (owned) or a Pets admin (strays).
-- Authorization happens BEFORE the row lock (membership / admin grant first), matching
-- jc_home_detach and every admin RPC; then the row is locked and re-checked.
create function public.jc_pet_manage(p_pet uuid) returns public.jc_pets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_kind text; v_owner uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  select kind, home_id into v_kind, v_owner from jc_pets where id = p_pet and community_id = v_comm and status = 'active';
  if v_kind is null then raise exception 'NOT_FOUND'; end if;
  if v_kind = 'owned' then
    if v_home is null or v_owner <> v_home then raise exception 'NOT_FOUND'; end if;
    perform jc_home_hold(v_user, v_home);
  else
    perform jc_assert_admin('pets');
  end if;
  select * into p from jc_pets where id = p_pet and status = 'active' for no key update;
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  return p;
end;
$$;

-- Take a pet off the board: no banner, no photo, uploads dead; the ledger keeps the paths
-- so T4 can delete the files.
create function public.jc_pet_retire(p_pet uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update jc_pet_photos set state = 'retired', retired_at = now()
   where pet_id = p_pet and state <> 'retired';
  update jc_pets
     set status = 'archived', missing = false, missing_since = null, last_seen_note = null,
         photo_path = null, pending_photo_path = null, pending_photo_by = null, pending_photo_at = null,
         updated_at = now()
   where id = p_pet and status = 'active';
$$;

-- S3's vacancy hook, extended: a family that leaves takes its pets off the board.
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
  -- S4: the family's pets leave with them
  perform jc_pet_retire(id) from jc_pets where home_id = p_home and status = 'active';
end;
$$;

-- Offboarding however the account goes — including a dashboard delete of auth.users,
-- which never passes through jc_account_delete. Runs while the user row still exists;
-- no-op when the RPC path already detached the member.
create function public.jc_users_before_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from jc_home_members where user_id = old.id) then
    perform jc_home_detach(old.id, false);
  end if;
  return old;
end;
$$;
create trigger jc_users_offboard before delete on auth.users
  for each row execute function public.jc_users_before_delete();

-- ---------- 3. storage: private bucket + two delegating policies ----------
create schema if not exists jc_private;
revoke all on schema jc_private from public;
grant usage on schema jc_private to authenticated;

-- Write: only the pending path the caller began, within 15 minutes, while the pets module
-- is on and the caller still belongs to the pet's household (owned) or is a Pets admin (stray).
create function jc_private.pet_photo_can_write(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.jc_pets p
      join public.jc_communities c on c.id = p.community_id
     where p.pending_photo_path = p_name and p.pending_photo_by = auth.uid()
       and p.pending_photo_at > now() - interval '15 minutes' and p.status = 'active'
       and coalesce((c.modules -> 'pets' ->> 'enabled')::boolean, false)
       and ((p.kind = 'owned' and exists (select 1 from public.jc_home_members m
                                           where m.user_id = auth.uid() and m.home_id = p.home_id))
            or (p.kind = 'stray' and public.jc_admin_has('pets'))));
$$;

-- Read: same community, pets module on, active pet, its current photo — or the caller's
-- own pending upload (Storage's insert path reads the row back).
create function jc_private.pet_photo_can_read(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.jc_pets p
      join public.jc_accounts a on a.user_id = auth.uid() and a.community_id = p.community_id
      join public.jc_communities c on c.id = p.community_id
     where p.status = 'active'
       and coalesce((c.modules -> 'pets' ->> 'enabled')::boolean, false)
       and (p.photo_path = p_name
            or (p.pending_photo_path = p_name and p.pending_photo_by = auth.uid())));
$$;

revoke execute on function jc_private.pet_photo_can_write(text), jc_private.pet_photo_can_read(text) from public, anon;
grant execute on function jc_private.pet_photo_can_write(text), jc_private.pet_photo_can_read(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy jc_pet_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pet-photos' and jc_private.pet_photo_can_write(name));

create policy jc_pet_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'pet-photos' and jc_private.pet_photo_can_read(name));

-- ---------- 4. resident RPCs ----------
create function public.jc_pets_list(p_filter text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_filter text := coalesce(p_filter, 'all');
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if v_filter not in ('all', 'owned', 'wanderers', 'strays', 'missing') then raise exception 'BAD_FILTER'; end if;
  return coalesce((
    select jsonb_agg(jc_pet_card(p.id, v_home) order by p.missing desc, p.name, p.id)
      from jc_pets p
     where p.community_id = v_comm and p.status = 'active'
       and (v_filter = 'all'
            or (v_filter = 'owned' and p.kind = 'owned')
            or (v_filter = 'wanderers' and p.wanderer)
            or (v_filter = 'strays' and p.kind = 'stray')
            or (v_filter = 'missing' and p.missing))), '[]'::jsonb);
end;
$$;

-- The card plus its trail. Strays: care log + sightings for everyone. Owned pets:
-- sightings only for the household and Pets admins (they route to the owners).
create function public.jc_pet_get(p_pet uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype; v_see_sightings boolean;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  select * into p from jc_pets where id = p_pet and community_id = v_comm and status = 'active';
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  v_see_sightings := p.kind = 'stray' or p.home_id = v_home or jc_admin_has('pets');
  return jc_pet_card(p.id, v_home) || jsonb_build_object(
    'sightings', case when v_see_sightings then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'note', s.note, 'lat', s.lat, 'lng', s.lng,
                                          'seen_at', s.seen_at, 'by_me', s.reporter = v_user)
                       order by s.seen_at desc)
        from (select * from jc_pet_sightings where pet_id = p.id and not hidden
               order by seen_at desc limit 30) s), '[]'::jsonb) end,
    'care_log', case when p.kind = 'stray' then coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'note', c.note, 'at', c.created_at)
                       order by c.created_at desc)
        from (select * from jc_pet_care_log where pet_id = p.id order by created_at desc limit 20) c), '[]'::jsonb) end);
end;
$$;

-- The household adds or edits its own pets (cap 10 active per home).
create function public.jc_pet_save(p_pet uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_id uuid := p_pet; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if v_home is null then raise exception 'NO_HOME'; end if;
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('species', 'name', 'description', 'wanderer', 'microchipped'))
     or (p_fields ? 'species' and jsonb_typeof(p_fields -> 'species') <> 'string')
     or (p_fields ? 'name' and (jsonb_typeof(p_fields -> 'name') <> 'string' or jc_clean_line(p_fields ->> 'name') is null))
     or (p_fields ? 'wanderer' and jsonb_typeof(p_fields -> 'wanderer') <> 'boolean')
     or (p_fields ? 'microchipped' and jsonb_typeof(p_fields -> 'microchipped') <> 'boolean')
     or char_length(p_fields ->> 'description') > 400 then
    raise exception 'BAD_FIELDS';
  end if;
  begin
    if v_id is null then
      if not p_fields ? 'name' or not p_fields ? 'species' then raise exception 'BAD_FIELDS'; end if;
      perform 1 from jc_homes where id = v_home for update;  -- serializes the cap check
      perform jc_home_hold(v_user, v_home);
      if (select count(*) from jc_pets where home_id = v_home and status = 'active') >= 10 then
        raise exception 'TOO_MANY_PETS';
      end if;
      insert into jc_pets (community_id, kind, home_id, species, name, created_by, updated_by)
      values (v_comm, 'owned', v_home, p_fields ->> 'species', jc_clean_line(p_fields ->> 'name'), v_user, v_user)
      returning id into v_id;
    else
      p := jc_pet_manage(v_id);
      if p.kind <> 'owned' then raise exception 'NOT_FOUND'; end if;
    end if;
    update jc_pets set
      species      = coalesce(p_fields ->> 'species', species),
      name         = coalesce(jc_clean_line(p_fields ->> 'name'), name),
      description  = case when p_fields ? 'description' then jc_clean_text(p_fields ->> 'description') else description end,
      wanderer     = coalesce((p_fields ->> 'wanderer')::boolean, wanderer),
      microchipped = coalesce((p_fields ->> 'microchipped')::boolean, microchipped),
      updated_at = now(), updated_by = v_user
     where id = v_id;
  exception when check_violation or not_null_violation then raise exception 'BAD_FIELDS';
  end;
  return jc_pet_card(v_id, v_home);
end;
$$;

-- The emergency switch: board-wide, danger-red in the UI.
create function public.jc_pet_missing_set(p_pet uuid, p_missing boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if p_missing is null or char_length(p_note) > 400 then raise exception 'BAD_FIELDS'; end if;
  p := jc_pet_manage(p_pet);
  if p.kind <> 'owned' then raise exception 'NOT_FOUND'; end if;
  update jc_pets
     set missing = p_missing,
         missing_since = case when p_missing then coalesce(missing_since, now()) end,
         last_seen_note = case when p_missing then left(jc_clean_text(p_note), 200) else null end,
         updated_at = now(), updated_by = v_user
   where id = p.id;
  perform jc_log(v_comm, null, null, 'pet_missing', jsonb_build_object('pet_id', p.id, 'missing', p_missing));
  return jc_pet_card(p.id, v_home);
end;
$$;

-- Passed away, rehomed, moved: the household takes the pet off the board.
create function public.jc_pet_archive(p_pet uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  p := jc_pet_manage(p_pet);
  if p.kind <> 'owned' then raise exception 'NOT_FOUND'; end if;
  perform jc_pet_retire(p.id);
  update jc_pets set updated_by = v_user where id = p.id;
  perform jc_log(v_comm, null, null, 'pet_archive', jsonb_build_object('pet_id', p.id));
  return jsonb_build_object('pet_id', p.id, 'archived', true);
end;
$$;

-- Any resident, any active pet in the community. 5 per pet and 30 overall per reporter per day.
create function public.jc_pet_sighting_add(p_pet uuid, p_note text, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if not exists (select 1 from jc_pets where id = p_pet and community_id = v_comm and status = 'active') then
    raise exception 'NOT_FOUND';
  end if;
  if char_length(p_note) > 400 or (p_lat is null) <> (p_lng is null) then raise exception 'BAD_FIELDS'; end if;
  -- serialize this reporter's own calls so the caps can't be raced
  perform pg_advisory_xact_lock(hashtext('jc_pet_sighting:' || v_user::text));
  if (select count(*) from jc_pet_sightings where reporter = v_user and seen_at > now() - interval '1 day') >= 30
     or (select count(*) from jc_pet_sightings
          where reporter = v_user and pet_id = p_pet and seen_at > now() - interval '1 day') >= 5 then
    raise exception 'TOO_MANY_SIGHTINGS';
  end if;
  begin
    insert into jc_pet_sightings (community_id, pet_id, reporter, note, lat, lng)
    values (v_comm, p_pet, v_user, left(jc_clean_text(p_note), 280), p_lat, p_lng);
  exception when check_violation then raise exception 'BAD_FIELDS';
  end;
  return jsonb_build_object('pet_id', p_pet, 'logged', true);
end;
$$;

-- Step 1 of a photo upload: a fresh, server-chosen path the caller may write for 15 min.
create function public.jc_pet_photo_begin(p_pet uuid, p_ext text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype; v_path text;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if coalesce(p_ext, '') not in ('jpg', 'png', 'webp') then raise exception 'BAD_FIELDS'; end if;
  p := jc_pet_manage(p_pet);
  if p.pending_photo_by is distinct from v_user and p.pending_photo_at > now() - interval '60 seconds' then
    raise exception 'PHOTO_PENDING';  -- someone else in the household is mid-upload
  end if;
  if (select count(*) from jc_pet_photos where created_by = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'TOO_MANY_UPLOADS';
  end if;
  -- the previous pending path (anyone's) is abandoned: unwritable now, swept by T4
  update jc_pet_photos set state = 'retired', retired_at = now() where pet_id = p.id and state = 'pending';
  v_path := v_comm || '/' || p.id || '/' || encode(extensions.gen_random_bytes(12), 'hex') || '.' || p_ext;
  insert into jc_pet_photos (path, community_id, pet_id, created_by) values (v_path, v_comm, p.id, v_user);
  update jc_pets set pending_photo_path = v_path, pending_photo_by = v_user, pending_photo_at = now()
   where id = p.id;
  return jsonb_build_object('bucket', 'pet-photos', 'path', v_path, 'expires_in_seconds', 900);
end;
$$;

-- Step 3: the uploaded object becomes the pet's photo (within the 15-minute window, and
-- only once Storage has recorded the finished file's size and type).
create function public.jc_pet_photo_commit(p_pet uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  p := jc_pet_manage(p_pet);
  if p.pending_photo_path is null or p.pending_photo_by is distinct from v_user then raise exception 'NO_PENDING_PHOTO'; end if;
  if p.pending_photo_at <= now() - interval '15 minutes' then raise exception 'PHOTO_EXPIRED'; end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'pet-photos' and o.name = p.pending_photo_path
                    and (o.metadata ->> 'size') is not null
                    and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')) then
    raise exception 'PHOTO_MISSING';
  end if;
  update jc_pet_photos set state = 'retired', retired_at = now() where pet_id = p.id and state = 'current';
  update jc_pet_photos set state = 'current' where path = p.pending_photo_path;
  update jc_pets
     set photo_path = pending_photo_path, pending_photo_path = null, pending_photo_by = null,
         pending_photo_at = null, updated_at = now(), updated_by = v_user
   where id = p.id;
  return jc_pet_card(p.id, v_home);
end;
$$;

-- ---------- 5. admin RPCs (pets scope or community) ----------
create function public.jc_admin_pets_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('pets');
  return coalesce((
    select jsonb_agg(jc_pet_card(p.id, null) || jsonb_build_object(
             'status', p.status, 'created_at', p.created_at, 'updated_at', p.updated_at,
             'sightings_7d', (select count(*) from jc_pet_sightings s
                               where s.pet_id = p.id and s.seen_at > now() - interval '7 days'))
           order by p.status, p.missing desc, p.name, p.id)
      from jc_pets p where p.community_id = v_comm), '[]'::jsonb);
end;
$$;

create function public.jc_admin_stray_save(p_pet uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_id uuid := p_pet; p public.jc_pets%rowtype;
begin
  v_comm := jc_assert_admin('pets');
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('species', 'name', 'description', 'care_state'))
     or (p_fields ? 'species' and jsonb_typeof(p_fields -> 'species') <> 'string')
     or (p_fields ? 'care_state' and jsonb_typeof(p_fields -> 'care_state') <> 'string')
     or (p_fields ? 'name' and (jsonb_typeof(p_fields -> 'name') <> 'string' or jc_clean_line(p_fields ->> 'name') is null))
     or char_length(p_fields ->> 'description') > 400 then
    raise exception 'BAD_FIELDS';
  end if;
  begin
    if v_id is null then
      if not p_fields ? 'name' or not p_fields ? 'species' then raise exception 'BAD_FIELDS'; end if;
      insert into jc_pets (community_id, kind, species, name, care_state, created_by, updated_by)
      values (v_comm, 'stray', p_fields ->> 'species', jc_clean_line(p_fields ->> 'name'),
              coalesce(p_fields ->> 'care_state', 'under_care'), auth.uid(), auth.uid())
      returning id into v_id;
    else
      p := jc_pet_manage(v_id);
      if p.kind <> 'stray' then raise exception 'NOT_FOUND'; end if;
    end if;
    update jc_pets set
      species     = coalesce(p_fields ->> 'species', species),
      name        = coalesce(jc_clean_line(p_fields ->> 'name'), name),
      description = case when p_fields ? 'description' then jc_clean_text(p_fields ->> 'description') else description end,
      care_state  = coalesce(p_fields ->> 'care_state', care_state),
      updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  exception when check_violation or not_null_violation then raise exception 'BAD_FIELDS';
  end;
  perform jc_admin_log_add(v_comm, 'stray_save', jsonb_build_object(
    'pet_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_pet_card(v_id, null);
end;
$$;

create function public.jc_admin_pet_care_add(p_pet uuid, p_kind text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_note text;
begin
  v_comm := jc_assert_admin('pets');
  if char_length(p_note) > 400 then raise exception 'BAD_FIELDS'; end if;
  v_note := left(jc_clean_text(p_note), 280);
  if v_note is null or coalesce(p_kind, '') not in ('fed', 'vet', 'note', 'state') then raise exception 'BAD_FIELDS'; end if;
  if not exists (select 1 from jc_pets where id = p_pet and community_id = v_comm and kind = 'stray' and status = 'active') then
    raise exception 'NOT_FOUND';
  end if;
  insert into jc_pet_care_log (community_id, pet_id, author, kind, note)
  values (v_comm, p_pet, auth.uid(), p_kind, v_note);
  perform jc_admin_log_add(v_comm, 'pet_care_add', jsonb_build_object('pet_id', p_pet, 'kind', p_kind));
  return jsonb_build_object('pet_id', p_pet, 'logged', true);
end;
$$;

-- Moderation: take any pet off the board (spam, impersonation, a stray that's gone).
create function public.jc_admin_pet_archive(p_pet uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_reason text;
begin
  v_comm := jc_assert_admin('pets');
  if char_length(p_reason) > 400 then raise exception 'REASON_REQUIRED'; end if;
  v_reason := jc_clean_line(p_reason);
  if v_reason is null or char_length(v_reason) not between 3 and 200 then raise exception 'REASON_REQUIRED'; end if;
  perform 1 from jc_pets where id = p_pet and community_id = v_comm and status = 'active' for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform jc_pet_retire(p_pet);
  update jc_pets set updated_by = auth.uid() where id = p_pet;
  perform jc_admin_log_add(v_comm, 'pet_archive', jsonb_build_object('pet_id', p_pet, 'reason', v_reason));
  return jc_admin_pets_list();
end;
$$;

-- Moderation: hide one sighting (spam, rude note) without touching the pet.
create function public.jc_admin_sighting_hide(p_sighting bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_pet uuid;
begin
  v_comm := jc_assert_admin('pets');
  update jc_pet_sightings set hidden = true
   where id = p_sighting and community_id = v_comm and not hidden
  returning pet_id into v_pet;
  if v_pet is null then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'sighting_hide', jsonb_build_object('sighting_id', p_sighting, 'pet_id', v_pet));
  return jsonb_build_object('sighting_id', p_sighting, 'hidden', true);
end;
$$;

-- ---------- 6. grants ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function
  public.jc_admin_has(text),
  public.jc_pet_card(uuid, uuid),
  public.jc_pet_manage(uuid),
  public.jc_pet_retire(uuid),
  public.jc_users_before_delete()
from public, anon, authenticated;

grant execute on function
  public.jc_pets_list(text),
  public.jc_pet_get(uuid),
  public.jc_pet_save(uuid, jsonb),
  public.jc_pet_missing_set(uuid, boolean, text),
  public.jc_pet_archive(uuid),
  public.jc_pet_sighting_add(uuid, text, double precision, double precision),
  public.jc_pet_photo_begin(uuid, text),
  public.jc_pet_photo_commit(uuid),
  public.jc_admin_pets_list(),
  public.jc_admin_stray_save(uuid, jsonb),
  public.jc_admin_pet_care_add(uuid, text, text),
  public.jc_admin_pet_archive(uuid, text),
  public.jc_admin_sighting_hide(bigint)
to authenticated;
