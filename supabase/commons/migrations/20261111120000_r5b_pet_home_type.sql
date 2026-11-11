-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R5b-1b — the pet card's home says what kind of home it is (Zee 2026-11-11: "it should say Villa or Townhouse
-- or Apartment based on what someone selects their home to be").
--
-- jc_pet_card: the 'home' object gains 'type' = jc_homes.home_type (villa | townhouse | apartment). Body only;
-- signature, grants and every visibility rule unchanged — the home object is still sent only when the home is
-- in the directory, or while the pet is missing AND its household opted in (R5a). The type is part of the home
-- label residents already see elsewhere (court bookings, R4a), so no new kind of data leaves the server.
-- Start: the live body (pg_get_functiondef, 2026-11-11); the only change is marked R5b-1b.

create or replace function public.jc_pet_card(p_pet uuid, p_viewer_home uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'species', p.species, 'name', p.name,
    'description', p.description, 'wanderer', p.wanderer, 'microchipped', p.microchipped,
    'missing', p.missing, 'missing_since', p.missing_since, 'last_seen_note', p.last_seen_note,
    'care_state', p.care_state, 'photo_path', p.photo_path,
    'mine', p.home_id is not null and p.home_id = p_viewer_home,
    'home', case when h.id is not null
                  and (not h.directory_suppressed or (p.missing and p.missing_show_home)) then   -- R5a
                   jsonb_build_object('village', h.village_key, 'type', h.home_type,              -- R5b-1b: + type
                                      'building', h.building, 'number', h.number_raw) end,
    'show_home', case when p.home_id = p_viewer_home then p.missing_show_home end,                 -- R5a (own household only)
    'territory', p.territory,                                                                      -- R5a
    'territory_lat', p.territory_lat, 'territory_lng', p.territory_lng,                            -- R5a
    'care', case when p.kind = 'stray' then p.care end)                                            -- R5a
  from jc_pets p left join jc_homes h on h.id = p.home_id
  where p.id = p_pet;
$function$;
