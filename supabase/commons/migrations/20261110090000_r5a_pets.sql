-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R5a — Pets of Jubail to spec (plan docs/plans/R5-pets.md; Zee decisions 2026-11-10, W1 = option a).
-- Every replaced function starts from its live body (all last defined in 20261104000000_s4_pets.sql);
-- changes are marked "R5a". Live rows before this migration: jc_pets / photos / sightings / care log = 0.
--
-- 1. "Community animal · known & fine" = a 4th care_state on the existing stray kind ('known_fine').
--    jc_pets_list filters: 'strays' now means strays NOT known_fine; new 'community' = known_fine.
-- 2. Strays / community animals get a usual TERRITORY (text ≤ 120 + optional map spot) and a structured
--    CARE record: {sterilized|dewormed|vaccination|treatment: {s: done|due|ongoing, d: 'YYYY-MM-DD'|null,
--    n: note|null}} set item by item by Pets admins (jc_admin_pet_care_set; status 'unknown' removes the item).
--    Owned pets never carry either (check constraint).
-- 3. Sightings — ZERO-PII AMENDMENT (disclosed; Zee Q1 = C): a sighting is accepted only for a MISSING pet or a
--    stray / community animal that is not rehomed (else SIGHTINGS_CLOSED). The reporter is never shown to anyone
--    (unchanged) and is erased by the nightly job once the sighting is older than 24 h — i.e. WITHIN 48 h, at the
--    first nightly run after the 24 h mark (it is kept only so the per-reporter caps, which look back exactly
--    1 day, stay exact). Consequence: "by_me" on a sighting disappears once its reporter is erased.
--    Every sighting is DELETED 30 days after it was seen.
--    Job: cron jc-pets-purge 50 3 * * * → jc_pets_retention(), logged 'pets_purge' (in jc_maintenance_status, so
--    the canary / App Health see a stale or failed run).
-- 4. Missing pet from a directory-hidden home (Zee Q6): the household may opt in to show its home WHILE the pet
--    is missing (jc_pet_missing_home_set). Found (missing → false) or archived clears it, so every new "missing"
--    starts hidden again and needs a fresh opt-in. jc_pet_missing_set keeps its signature (frozen-class discipline).
--    An admin hiding a home (jc_admin_home_suppress on) ends any opt-in of that home's pets — moderation wins
--    (security review M1). show_home is returned only to the pet's own household (security L2).
-- 5. The pets WhatsApp group (Zee W1): the invite link lives in its OWN column, jc_communities.pets_group_link —
--    NEVER in links / modules, which the anon-callable jc_config_get returns. Read by members (module on) via
--    jc_pets_group_get(); set / cleared by community or Pets admins via jc_admin_pets_group_set (https://chat.
--    whatsapp.com/<code> only). The link itself is never written to the admin log — only an 8-character md5
--    fingerprint, so a change of group is traceable (security L3).
-- +4 authenticated fns: jc_pet_missing_home_set, jc_admin_pet_care_set, jc_pets_group_get, jc_admin_pets_group_set.
-- 1 internal (no grants): jc_pets_retention. Replaced (signatures unchanged): jc_pet_card, jc_pet_retire, jc_pets_list,
-- jc_pet_missing_set, jc_pet_sighting_add, jc_admin_stray_save (all from s4), jc_maintenance_status (t4c),
-- jc_admin_home_suppress (s1).
--
-- Rollback (pre-launch), in this order: (1) select cron.unschedule('jc-pets-purge'); (2) drop the 5 new functions;
-- (3) re-create the 6 s4 functions from 20261104000000_s4_pets.sql; jc_admin_home_suppress = this file's body
-- without the R5a update; jc_maintenance_status = this file's body with values ('orphan_users'), ('photo_purge')
-- only; (4) delete or convert known_fine rows, then restore jc_pets_care_state_check without 'known_fine';
-- (5) alter table jc_pets drop column territory, territory_lat, territory_lng, care, missing_show_home (their
-- multi-column checks drop with them); (6) alter table jc_communities drop column pets_group_link; (7) delete
-- pets_purge rows from jc_maintenance_log, then restore its job check without 'pets_purge'.
-- Purged sightings cannot be restored (by design).

-- ---------- 1. schema ----------
alter table public.jc_maintenance_log drop constraint jc_maintenance_log_job_check;
alter table public.jc_maintenance_log add constraint jc_maintenance_log_job_check
  check (job in ('orphan_users', 'photo_purge', 'feedback_notify', 'feedback_purge', 'courts_purge', 'pets_purge'));

alter table public.jc_communities add column pets_group_link text
  constraint jc_communities_pets_group_link_check
  check (pets_group_link is null or pets_group_link ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{16,40}$');

alter table public.jc_pets drop constraint jc_pets_care_state_check;
alter table public.jc_pets add constraint jc_pets_care_state_check
  check (care_state in ('known_fine', 'under_care', 'needs_help', 'rehomed'));

alter table public.jc_pets
  add column territory         text check (territory is null or char_length(territory) between 1 and 120),
  add column territory_lat     double precision check (territory_lat between -90 and 90),
  add column territory_lng     double precision check (territory_lng between -180 and 180),
  add column care              jsonb not null default '{}' check (jsonb_typeof(care) = 'object'),
  add column missing_show_home boolean not null default false;
alter table public.jc_pets
  add constraint jc_pets_territory_pair check ((territory_lat is null) = (territory_lng is null)),
  add constraint jc_pets_stray_only check (kind = 'stray' or (territory is null and territory_lat is null and care = '{}')),
  add constraint jc_pets_show_home_missing check (missing or not missing_show_home);

-- ---------- 2. internal helpers (no grants) ----------
-- R5a: + territory / care (strays only), show_home; the home is shown for a directory-hidden home only while the
-- pet is missing AND the household opted in.
create or replace function public.jc_pet_card(p_pet uuid, p_viewer_home uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'species', p.species, 'name', p.name,
    'description', p.description, 'wanderer', p.wanderer, 'microchipped', p.microchipped,
    'missing', p.missing, 'missing_since', p.missing_since, 'last_seen_note', p.last_seen_note,
    'care_state', p.care_state, 'photo_path', p.photo_path,
    'mine', p.home_id is not null and p.home_id = p_viewer_home,
    'home', case when h.id is not null
                  and (not h.directory_suppressed or (p.missing and p.missing_show_home)) then   -- R5a
                   jsonb_build_object('village', h.village_key, 'building', h.building, 'number', h.number_raw) end,
    'show_home', case when p.home_id = p_viewer_home then p.missing_show_home end,                 -- R5a (own household only)
    'territory', p.territory,                                                                      -- R5a
    'territory_lat', p.territory_lat, 'territory_lng', p.territory_lng,                            -- R5a
    'care', case when p.kind = 'stray' then p.care end)                                            -- R5a
  from jc_pets p left join jc_homes h on h.id = p.home_id
  where p.id = p_pet;
$$;

-- R5a: archiving also clears the show-home opt-in (the check constraint requires it once missing is false).
create or replace function public.jc_pet_retire(p_pet uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update jc_pet_photos set state = 'retired', retired_at = now()
   where pet_id = p_pet and state <> 'retired';
  update jc_pets
     set status = 'archived', missing = false, missing_since = null, last_seen_note = null,
         missing_show_home = false,                                                                -- R5a
         photo_path = null, pending_photo_path = null, pending_photo_by = null, pending_photo_at = null,
         updated_at = now()
   where id = p_pet and status = 'active';
$$;

-- R5a: nightly retention for sightings (see header §3). Returns the number of sightings deleted.
create function public.jc_pets_retention() returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  update jc_pet_sightings set reporter = null
   where reporter is not null and seen_at < now() - interval '24 hours';
  with gone as (delete from jc_pet_sightings where seen_at < now() - interval '30 days' returning 1)
  select count(*) into n from gone;
  insert into jc_maintenance_log (job, affected) values ('pets_purge', n);
  return n;
end;
$$;

-- R5a: + pets_purge (live body otherwise unchanged).
create or replace function public.jc_maintenance_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_object_agg(j.job, jsonb_build_object(
           'last_at', l.at, 'affected', l.affected, 'error', l.error,
           'stale', l.at is not null and l.at < now() - interval '36 hours',
           'never_run', l.at is null))
    from (values ('orphan_users'), ('photo_purge'), ('pets_purge')) j(job)
    left join lateral (select at, affected, error from jc_maintenance_log m
                        where m.job = j.job order by at desc, id desc limit 1) l on true;
$$;

-- ---------- 3. resident RPCs ----------
-- R5a: filter 'strays' excludes known_fine; new filter 'community' = known_fine.
create or replace function public.jc_pets_list(p_filter text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_filter text := coalesce(p_filter, 'all');
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if v_filter not in ('all', 'owned', 'wanderers', 'strays', 'community', 'missing') then raise exception 'BAD_FILTER'; end if;
  return coalesce((
    select jsonb_agg(jc_pet_card(p.id, v_home) order by p.missing desc, p.name, p.id)
      from jc_pets p
     where p.community_id = v_comm and p.status = 'active'
       and (v_filter = 'all'
            or (v_filter = 'owned' and p.kind = 'owned')
            or (v_filter = 'wanderers' and p.wanderer)
            or (v_filter = 'strays' and p.kind = 'stray' and p.care_state <> 'known_fine')       -- R5a
            or (v_filter = 'community' and p.kind = 'stray' and p.care_state = 'known_fine')     -- R5a
            or (v_filter = 'missing' and p.missing))), '[]'::jsonb);
end;
$$;

-- R5a: found (p_missing = false) clears the show-home opt-in; a new "missing" always starts hidden.
create or replace function public.jc_pet_missing_set(p_pet uuid, p_missing boolean, p_note text) returns jsonb
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
         missing_show_home = p_missing and missing_show_home,                                      -- R5a
         updated_at = now(), updated_by = v_user
   where id = p.id;
  perform jc_log(v_comm, null, null, 'pet_missing', jsonb_build_object('pet_id', p.id, 'missing', p_missing));
  return jc_pet_card(p.id, v_home);
end;
$$;

-- R5a (new): the household shows / hides its home on a MISSING pet's card (Q6). NOT_MISSING otherwise.
create function public.jc_pet_missing_home_set(p_pet uuid, p_show boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if p_show is null then raise exception 'BAD_FIELDS'; end if;
  p := jc_pet_manage(p_pet);
  if p.kind <> 'owned' then raise exception 'NOT_FOUND'; end if;
  if not p.missing then raise exception 'NOT_MISSING'; end if;
  update jc_pets set missing_show_home = p_show, updated_at = now(), updated_by = v_user where id = p.id;
  perform jc_log(v_comm, null, null, 'pet_missing_home', jsonb_build_object('pet_id', p.id, 'show', p_show));
  return jc_pet_card(p.id, v_home);
end;
$$;

-- R5a: only for a missing pet or a stray / community animal (SIGHTINGS_CLOSED otherwise). Caps unchanged.
create or replace function public.jc_pet_sighting_add(p_pet uuid, p_note text, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_open boolean;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  select (kind = 'stray' and care_state <> 'rehomed') or missing into v_open                         -- R5a
    from jc_pets where id = p_pet and community_id = v_comm and status = 'active';
  if v_open is null then raise exception 'NOT_FOUND'; end if;
  if not v_open then raise exception 'SIGHTINGS_CLOSED'; end if;                                    -- R5a
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

-- R5a (new): the pets WhatsApp group link, members only (never via jc_config_get).
create function public.jc_pets_group_get() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  return jsonb_build_object('link', (select pets_group_link from jc_communities where id = v_comm));
end;
$$;

-- ---------- 4. admin RPCs (pets scope or community) ----------
-- R5a: + territory / territory_lat / territory_lng (strays and community animals).
create or replace function public.jc_admin_stray_save(p_pet uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_id uuid := p_pet; p public.jc_pets%rowtype;
begin
  v_comm := jc_assert_admin('pets');
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('species', 'name', 'description', 'care_state',
                                 'territory', 'territory_lat', 'territory_lng'))                  -- R5a
     or (p_fields ? 'species' and jsonb_typeof(p_fields -> 'species') <> 'string')
     or (p_fields ? 'care_state' and jsonb_typeof(p_fields -> 'care_state') <> 'string')
     or (p_fields ? 'name' and (jsonb_typeof(p_fields -> 'name') <> 'string' or jc_clean_line(p_fields ->> 'name') is null))
     or char_length(p_fields ->> 'description') > 400
     -- R5a: territory = a string (cleaned, 1–120) or null to clear; the spot comes as a pair of numbers or nulls
     or (p_fields ? 'territory' and jsonb_typeof(p_fields -> 'territory') not in ('string', 'null'))
     or (p_fields ? 'territory' and jsonb_typeof(p_fields -> 'territory') = 'string'
         and (char_length(p_fields ->> 'territory') > 400 or jc_clean_line(p_fields ->> 'territory') is null
              or char_length(jc_clean_line(p_fields ->> 'territory')) > 120))
     or (p_fields ? 'territory_lat') <> (p_fields ? 'territory_lng')
     or (p_fields ? 'territory_lat' and (jsonb_typeof(p_fields -> 'territory_lat') not in ('number', 'null')
                                         or jsonb_typeof(p_fields -> 'territory_lng') not in ('number', 'null')
                                         or jsonb_typeof(p_fields -> 'territory_lat') <> jsonb_typeof(p_fields -> 'territory_lng'))) then
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
      territory   = case when p_fields ? 'territory' then jc_clean_line(p_fields ->> 'territory') else territory end,      -- R5a
      territory_lat = case when p_fields ? 'territory_lat' then (p_fields ->> 'territory_lat')::double precision else territory_lat end,
      territory_lng = case when p_fields ? 'territory_lng' then (p_fields ->> 'territory_lng')::double precision else territory_lng end,
      updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  -- R5a: + numeric_value_out_of_range (e.g. a territory_lat of 1e400 — db review L1)
  exception when check_violation or not_null_violation or numeric_value_out_of_range then raise exception 'BAD_FIELDS';
  end;
  perform jc_admin_log_add(v_comm, 'stray_save', jsonb_build_object(
    'pet_id', v_id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_fields) k)));
  return jc_pet_card(v_id, null);
end;
$$;

-- R5a (new): one item of a stray / community animal's care record. Status 'unknown' removes the item.
create function public.jc_admin_pet_care_set(p_pet uuid, p_item text, p_status text, p_date date, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_note text;
begin
  v_comm := jc_assert_admin('pets');
  if coalesce(p_item, '') not in ('sterilized', 'dewormed', 'vaccination', 'treatment')
     or coalesce(p_status, '') not in ('done', 'due', 'ongoing', 'unknown')
     or char_length(p_note) > 400
     or (p_date is not null and (p_date < date '2000-01-01' or p_date > (now() + interval '2 years')::date)) then
    raise exception 'BAD_FIELDS';
  end if;
  v_note := jc_clean_line(p_note);
  if char_length(v_note) > 120 then raise exception 'BAD_FIELDS'; end if;
  perform 1 from jc_pets where id = p_pet and community_id = v_comm and kind = 'stray' and status = 'active'
    for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update jc_pets
     set care = case when p_status = 'unknown' then care - p_item
                     else care || jsonb_build_object(p_item, jsonb_build_object('s', p_status, 'd', p_date, 'n', v_note)) end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_pet;
  perform jc_admin_log_add(v_comm, 'pet_care_set', jsonb_build_object('pet_id', p_pet, 'item', p_item, 'status', p_status));
  return jc_pet_card(p_pet, null);
end;
$$;

-- R5a (new): set (a chat.whatsapp.com invite link) or clear (null / blank) the pets WhatsApp group.
create function public.jc_admin_pets_group_set(p_link text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_link text := nullif(btrim(p_link), '');
begin
  v_comm := jc_assert_admin('pets');
  if char_length(v_link) > 200
     or (v_link is not null and v_link !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{16,40}$') then
    raise exception 'BAD_LINK';
  end if;
  update jc_communities set pets_group_link = v_link where id = v_comm;
  -- never the link itself; a short fingerprint makes a change of group traceable (security L3)
  perform jc_admin_log_add(v_comm, 'pets_group_set', jsonb_build_object(
    'set', v_link is not null, 'ref', case when v_link is not null then left(md5(v_link), 8) end));
  return jsonb_build_object('link', v_link);
end;
$$;

-- R5a: hiding a home also ends any "show my home while missing" opt-in of its pets (security M1: moderation wins).
-- Live body (s1) otherwise unchanged; signature unchanged.
create or replace function public.jc_admin_home_suppress(p_home uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  update jc_homes set directory_suppressed = coalesce(p_on, false)
   where id = p_home and community_id = v_comm;
  if not found then raise exception 'NOT_FOUND'; end if;
  if coalesce(p_on, false) then                                                                     -- R5a
    update jc_pets set missing_show_home = false, updated_at = now()
     where home_id = p_home and missing_show_home;
  end if;
  perform jc_admin_log_add(v_comm, 'home_suppress', jsonb_build_object('home_id', p_home, 'on', coalesce(p_on, false)));
  return jc_admin_homes_list();
end;
$$;

-- ---------- 5. grants + schedule ----------
revoke execute on function public.jc_pets_retention() from public, anon, authenticated;
revoke execute on function
  public.jc_pet_missing_home_set(uuid, boolean),
  public.jc_admin_pet_care_set(uuid, text, text, date, text),
  public.jc_pets_group_get(),
  public.jc_admin_pets_group_set(text)
from public, anon;
grant execute on function
  public.jc_pet_missing_home_set(uuid, boolean),
  public.jc_admin_pet_care_set(uuid, text, text, date, text),
  public.jc_pets_group_get(),
  public.jc_admin_pets_group_set(text)
to authenticated;

select cron.schedule('jc-pets-purge', '50 3 * * *', 'select public.jc_pets_retention()');
