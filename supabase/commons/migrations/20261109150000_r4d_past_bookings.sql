-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R4d — My Bookings: past bookings (plan docs/plans/R4d-booking-history.md; Zee "agree" 2026-11-09).
-- One new read-only function. jc_my_bookings() (upcoming) is NOT changed.
--
-- jc_my_bookings_past(): the caller's own home's ENDED bookings, newest first, at most 100:
--   * booked rows whose slot has ended ("Done"), and
--   * rows the ORGANIZERS cancelled (cancel_reason is set; a household's own cancel stores null — Zee Q1: left out).
--   Only bookings MADE after this member joined the home (created_at — security review M1: a slot the previous family
--   booked before a sale, played or cancelled "Household left" after it, must not reach the buyer; premortem #1),
--   and whose slot is within 90 days (the retention job, jc_courts_retention, deletes rows 90 days after their slot).
--   Never names or people: no booked_by / cancelled_by / display_name. [] without a home. MODULE_OFF when Courts is off.
-- Rollback: drop function public.jc_my_bookings_past();

create or replace function public.jc_my_bookings_past()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid; v_comm text; v_home uuid; v_joined timestamptz;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'bookings');
  if v_home is null then return '[]'::jsonb; end if;
  select joined_at into v_joined from jc_home_members where user_id = v_user and home_id = v_home;
  if v_joined is null then return '[]'::jsonb; end if;                -- fail closed: no join date, no history
  return coalesce((
    select jsonb_agg(r.j order by r.starts_at desc, r.id)
      from (select b.starts_at, b.id,
                   jsonb_build_object(
                     'id', b.id, 'facility_id', b.facility_id, 'facility', f.name_en, 'facility_ar', f.name_ar,
                     'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
                     'cancel_reason', b.cancel_reason) j
              from jc_bookings b join jc_facilities f on f.id = b.facility_id
             where b.home_id = v_home
               and b.community_id = v_comm
               and b.ends_at <= now()
               and b.created_at >= v_joined                                  -- made by this household as I know it (M1)
               and b.starts_at >= now() - interval '90 days'                 -- retention: rows go 90 days after the slot
               and (b.status = 'booked' or (b.status = 'cancelled' and b.cancel_reason is not null))   -- L2
             order by b.starts_at desc, b.id
             limit 100) r), '[]'::jsonb);
end;
$function$;

revoke execute on function public.jc_my_bookings_past() from public, anon;
grant execute on function public.jc_my_bookings_past() to authenticated;
