-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.4b — back to "coming soon" (Zee, 2026-11-05): an organizer may also move a PUBLISHED event back to
-- coming soon, as long as nobody has signed up yet (anyone "in" → HAS_SIGNUPS; pause sign-ups instead).
-- Replaces jc_admin_event_announce (T5.4, same signature): draft → coming soon as before, plus
-- live (open or paused) with no "in" sign-ups → coming soon. Withdrawn sign-ups don't count.
--
-- Rollback: restore jc_admin_event_announce from 20261105100000_t5_4_coming_soon.sql.

CREATE OR REPLACE FUNCTION public.jc_admin_event_announce(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_status text;
begin
  v_comm := jc_assert_admin('events');                 -- organizer only, as jc_admin_event_publish
  select status into v_status from jc_events where id = p_event and community_id = v_comm for update;
  if v_status is null or v_status not in ('draft', 'live') then raise exception 'BAD_STATE'; end if;
  -- T5.4b: a published event goes back only while nobody is signed up (the lock above holds
  -- sign-ups off: jc_event_signup reads the event row FOR SHARE)
  if v_status = 'live' and exists (select 1 from jc_event_entries where event_id = p_event and status = 'in') then
    raise exception 'HAS_SIGNUPS';
  end if;
  update jc_events set status = 'live', signups_open = false, coming_soon = true
   where id = p_event and community_id = v_comm;
  perform jc_admin_log_add(v_comm, 'event_announce', jsonb_build_object('event_id', p_event, 'from', v_status));
  return jc_admin_events_list();
end;
$function$;
