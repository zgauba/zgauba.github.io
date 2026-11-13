-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R5b-2b-0 — who sees a pet's sightings, "out on their own" reports, nearest-first order, hub alerts.
-- Plan: docs/plans/R5b-2-pets-maps.md "Re-plan 2026-11-13" (Zee approved 2026-11-13, Q1 = yes).
--
-- A. jc_pet_sight_from(pet, viewer home) — the ONE visibility rule: the time from which this viewer may see a pet's
--    sightings, or null for none.
--      stray · the pet's household · a Pets admin  → all (-infinity)
--      anyone else, while the owned pet is missing → from missing_since − 24 h (Q1: a report made just before the
--                                                     owner noticed is the most useful one)
--      anyone else otherwise                        → none (found = hidden again; missing_since is cleared on found
--                                                     and restamped on the next "missing")
--    Internal: not callable by clients.
-- B. jc_pet_sighting_add also opens for an owned pet that is not missing and not a wanderer ("seen out on their
--    own" — household-only under rule A). Wanderers stay closed unless missing. Caps unchanged.
-- C. jc_pet_card gains two additive keys, both under rule A:
--      last_seen    {lat, lng, at} newest visible sighting WITH a location (maps, nearest order), or null
--      last_seen_at newest visible sighting at all, or null ("seen out · 2 h ago")
-- D. jc_pets_list order: missing first → nearest the viewer's home pin → name. Owned pets are placed at their home
--    pin, strays at last_seen else territory. No coordinates of homes are returned. No home pin → name order.
--    Filters unchanged ('community' still accepted for cached pages).
-- E. jc_pets_alerts() → {missing: [{id, name}], seen_out: [{id, name, at}]} for the hub Pets card. seen_out = the
--    viewer household's pets, not missing, with a visible sighting in the last 24 h.
-- No signature changes, no table changes.
--
-- DOWN: re-run the previous bodies — jc_pet_card from 20261111160000_hh_remove_home_hiding.sql:233 (NOT the r5b
--       one: it reads columns HH dropped), jc_pet_get from
--       20261104000000_s4_pets.sql, jc_pet_sighting_add + jc_pets_list from 20261110090000_r5a_pets.sql — then
--       drop function public.jc_pets_alerts(); drop function public.jc_pet_sight_from(uuid, uuid);

-- ---------- A ----------
create or replace function public.jc_pet_sight_from(p_pet uuid, p_viewer_home uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
           when p.kind = 'stray'
             or (p.home_id is not null and p.home_id = p_viewer_home)
             or jc_admin_has('pets') then '-infinity'::timestamptz   -- assumes one community per account (jc_me); every
                                                                        -- caller has already filtered the pet to the viewer's community
           when p.missing then p.missing_since - interval '24 hours'
         end
    from jc_pets p
   where p.id = p_pet;
$$;
revoke execute on function public.jc_pet_sight_from(uuid, uuid) from public, anon, authenticated;

-- ---------- C ----------
create or replace function public.jc_pet_card(p_pet uuid, p_viewer_home uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'species', p.species, 'name', p.name,
    'description', p.description, 'wanderer', p.wanderer, 'microchipped', p.microchipped,
    'missing', p.missing, 'missing_since', p.missing_since, 'last_seen_note', p.last_seen_note,
    'care_state', p.care_state, 'photo_path', p.photo_path,
    'mine', p.home_id is not null and p.home_id = p_viewer_home,
    'home', case when h.id is not null then
                   jsonb_build_object('village', h.village_key, 'type', h.home_type,
                                      'building', h.building, 'number', h.number_raw) end,
    'territory', p.territory,
    'territory_lat', p.territory_lat, 'territory_lng', p.territory_lng,
    'care', case when p.kind = 'stray' then p.care end,
    'last_seen', (select jsonb_build_object('lat', s.lat, 'lng', s.lng, 'at', s.seen_at)            -- R5b-2b-0
                    from jc_pet_sightings s
                   where s.pet_id = p.id and not s.hidden and s.lat is not null and s.seen_at >= vis.since
                   order by s.seen_at desc limit 1),
    'last_seen_at', (select max(s.seen_at) from jc_pet_sightings s                                  -- R5b-2b-0
                      where s.pet_id = p.id and not s.hidden and s.seen_at >= vis.since))
  from jc_pets p
  left join jc_homes h on h.id = p.home_id
  cross join lateral (select jc_pet_sight_from(p.id, p_viewer_home) as since) vis
  where p.id = p_pet;
$$;

-- ---------- A, in the pet page ----------
create or replace function public.jc_pet_get(p_pet uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype; v_since timestamptz;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  select * into p from jc_pets where id = p_pet and community_id = v_comm and status = 'active';
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  v_since := jc_pet_sight_from(p.id, v_home);                                                       -- R5b-2b-0
  return jc_pet_card(p.id, v_home) || jsonb_build_object(
    'sightings', case when v_since is not null then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'note', s.note, 'lat', s.lat, 'lng', s.lng,
                                          'seen_at', s.seen_at, 'by_me', s.reporter = v_user)
                       order by s.seen_at desc)
        from (select * from jc_pet_sightings where pet_id = p.id and not hidden and seen_at >= v_since
               order by seen_at desc limit 30) s), '[]'::jsonb) end,
    'care_log', case when p.kind = 'stray' then coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'note', c.note, 'at', c.created_at)
                       order by c.created_at desc)
        from (select * from jc_pet_care_log where pet_id = p.id order by created_at desc limit 20) c), '[]'::jsonb) end);
end;
$$;

-- ---------- B ----------
create or replace function public.jc_pet_sighting_add(p_pet uuid, p_note text, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_open boolean;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  select (kind = 'stray' and care_state <> 'rehomed')
      or (kind = 'owned' and (missing or not wanderer)) into v_open                                   -- R5b-2b-0
    from jc_pets where id = p_pet and community_id = v_comm and status = 'active';
  if v_open is null then raise exception 'NOT_FOUND'; end if;
  if not v_open then raise exception 'SIGHTINGS_CLOSED'; end if;
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

-- ---------- D ----------
create or replace function public.jc_pets_list(p_filter text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_filter text := coalesce(p_filter, 'all');
        v_lat double precision; v_lng double precision; v_cos double precision;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  if v_filter not in ('all', 'owned', 'wanderers', 'strays', 'community', 'missing') then raise exception 'BAD_FILTER'; end if;
  select h.lat, h.lng into v_lat, v_lng from jc_homes h where h.id = v_home;                        -- R5b-2b-0
  v_cos := cos(radians(coalesce(v_lat, 0)));
  return coalesce((
    select jsonb_agg(x.card order by x.missing desc, x.dist nulls last, x.name, x.id)
      from (select p.id, p.name, p.missing, c.card,
                   case when v_lat is not null then                                                 -- R5b-2b-0
                     power(pos.lat - v_lat, 2) + power((pos.lng - v_lng) * v_cos, 2) end as dist
              from jc_pets p
              left join jc_homes h on h.id = p.home_id
              cross join lateral (select jc_pet_card(p.id, v_home) as card) c
              cross join lateral (select case when p.kind = 'owned' then h.lat
                                              else coalesce((c.card -> 'last_seen' ->> 'lat')::double precision, p.territory_lat) end as lat,
                                         case when p.kind = 'owned' then h.lng
                                              else coalesce((c.card -> 'last_seen' ->> 'lng')::double precision, p.territory_lng) end as lng) pos
             where p.community_id = v_comm and p.status = 'active'
               and (v_filter = 'all'
                    or (v_filter = 'owned' and p.kind = 'owned')
                    or (v_filter = 'wanderers' and p.wanderer)
                    or (v_filter = 'strays' and p.kind = 'stray' and p.care_state <> 'known_fine')
                    or (v_filter = 'community' and p.kind = 'stray' and p.care_state = 'known_fine')
                    or (v_filter = 'missing' and p.missing))) x), '[]'::jsonb);
end;
$$;

-- ---------- E ----------
-- seen_out counts any visible sighting in 24 h, including one logged while the pet was missing if it has since been
-- found (missing_since is cleared on found; no table change here). Accepted: the household just marked it found, and
-- the client copy says "If {name} is home, you can ignore this". Pinned by s24 V08g.
create or replace function public.jc_pets_alerts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  return jsonb_build_object(
    'missing', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)
                                          order by p.missing_since desc, p.id)
                           from jc_pets p
                          where p.community_id = v_comm and p.status = 'active' and p.missing), '[]'::jsonb),
    'seen_out', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'at', s.at)
                                           order by s.at desc, p.id)
                            from jc_pets p
                            cross join lateral (select max(x.seen_at) as at from jc_pet_sightings x
                                                 where x.pet_id = p.id and not x.hidden
                                                   and x.seen_at > now() - interval '24 hours') s
                           where v_home is not null and p.home_id = v_home and p.community_id = v_comm
                             and p.status = 'active' and not p.missing and s.at is not null), '[]'::jsonb));
end;
$$;
revoke execute on function public.jc_pets_alerts() from public, anon;
grant execute on function public.jc_pets_alerts() to authenticated;
