-- Throttle organizer-code guessing on the jh_admin_* RPCs.
--
-- Why a tar-pit and not an attempts-per-window counter: a wrong code must keep
-- raising BAD_ADMIN (the deployed client matches on that string), and a raised
-- exception rolls back the same transaction that would have recorded the failed
-- attempt — so an in-database counter of failures can never persist. The
-- single-database answer is to make each failure slow (pg_sleep before the
-- raise) and count failures via a sequence, which is non-transactional and
-- survives the rollback. A real per-IP limiter belongs in an edge function in
-- front of the API — planned for Commons, overkill here.
--
-- jh_signup's signature is untouched (standing rule); only jh_admin_* bodies
-- change, signatures identical.

create sequence if not exists public.jh_admin_fail_count;
revoke all on sequence public.jh_admin_fail_count from public, anon, authenticated;

create or replace function public.jh_assert_admin(p_code text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from jh_settings where key = 'admin_code' and value = trim(p_code)) then
    perform pg_sleep(1.5);
    perform nextval('public.jh_admin_fail_count');
    raise exception 'BAD_ADMIN';
  end if;
end;
$$;
-- Internal helper: reachable only through the definer-owned jh_admin_* RPCs.
revoke execute on function public.jh_assert_admin(text) from public, anon, authenticated;

create or replace function public.jh_admin_list(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_season text;
begin
  perform jh_assert_admin(p_code);
  select value into v_season from jh_settings where key = 'season';
  return jsonb_build_object(
    'season', v_season,
    'passcode', (select value from jh_settings where key = 'passcode'),
    'homes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'home_type', home_type, 'unit', unit, 'village', village,
        'details', details, 'handout', handout, 'lat', lat, 'lng', lng,
        'out_of_candy', out_of_candy, 'removed', removed, 'org_note', org_note,
        'entrance', entrance, 'treats', treats, 'edit_token', edit_token, 'created_at', created_at
      ) order by village, unit)
      from jh_homes where season = v_season), '[]'::jsonb)
  );
end;
$$;

create or replace function public.jh_admin_new_season(p_code text, p_label text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  if coalesce(trim(p_label),'') = '' then raise exception 'MISSING_FIELDS'; end if;
  update jh_settings set value = trim(p_label) where key = 'season';
  return trim(p_label);
end;
$$;

create or replace function public.jh_admin_set_broadcast(p_code text, p_text text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  update jh_settings set value = coalesce(trim(p_text), '') where key = 'broadcast';
  return true;
end;
$$;

create or replace function public.jh_admin_set_candy(p_code text, p_id uuid, p_out boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  update jh_homes set out_of_candy = p_out where id = p_id;
  return found;
end;
$$;

create or replace function public.jh_admin_set_entrance(p_code text, p_id uuid, p_entrance text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  if p_entrance not in ('front','garden','both') then
    raise exception 'MISSING_FIELDS';
  end if;
  update jh_homes set entrance = p_entrance where id = p_id;
  return found;
end;
$$;

create or replace function public.jh_admin_set_location(p_code text, p_id uuid, p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'BAD_COORDS';
  end if;
  update jh_homes set lat = p_lat, lng = p_lng where id = p_id;
  return found;
end;
$$;

create or replace function public.jh_admin_set_note(p_code text, p_id uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  update jh_homes set org_note = nullif(trim(coalesce(p_note,'')),'') where id = p_id;
  return found;
end;
$$;

create or replace function public.jh_admin_set_passcode(p_code text, p_new text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  if coalesce(trim(p_new),'') = '' then raise exception 'MISSING_FIELDS'; end if;
  update jh_settings set value = trim(p_new) where key = 'passcode';
  return true;
end;
$$;

create or replace function public.jh_admin_set_removed(p_code text, p_id uuid, p_removed boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform jh_assert_admin(p_code);
  update jh_homes set removed = p_removed where id = p_id;
  return found;
end;
$$;
