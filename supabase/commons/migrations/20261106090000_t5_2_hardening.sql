-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.2 hardening — items deferred from the T5.2 reviews (Zee asked 2026-11-06). No signature changes.
--   1. jc_schema_check: `allergy_friendly` (icon question) and `ring_split` (ring question) are arrays of
--      ≤ 20 of that question's own choices (5a review S2, 5a.1).
--   2. jc_entry_reports_clear: jc_home_hold — the caller must still be a member of the home (5b review F3).
--   3. jc_admin_report: storage, failures_since_baseline and rate_limited_now.join_pre_membership are
--      whole-platform numbers → returned to the platform owner only (PR 6 review H-2 / Zee 2026-11-06); other
--      community admins get the nightly cleanups as ran / stale / failed only (no counts, no error text).
--   4. jc_admin_report_core: the cron failure text keeps its first line only, ≤ 120 chars (PR 6 review H-1).
--   Invariant (test only): no client-callable function returns reporter / reporter_home (5b review F2).
-- Down (functions only — no data to restore): CREATE OR REPLACE each with its previous body —
--   jc_schema_check: the definition in 20261105060000_t5_2a_pins_broadcast.sql;
--   jc_entry_reports_clear: the definition in 20261103180000_s2_events.sql;
--   jc_admin_report_core: the body of jc_admin_report in 20261105020000_t4a_snapshots.sql (t4c RENAMED that function
--     to _core — don't re-run t4a / t4c verbatim), with `left(return_message, 200)` restored;
--   jc_admin_report: the one-line wrapper in 20261105040000_t4c_cleanup.sql (`return jc_admin_report_core() ||
--     jsonb_build_object('maintenance', jc_maintenance_status());`).

CREATE OR REPLACE FUNCTION public.jc_schema_check(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare f record; mk text; lim int; want text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'BAD_SCHEMA'; end if;
  -- T5.2: the stored size cap (jc_events_json_caps), checked here so it reads BAD_SCHEMA
  if octet_length(p::text) > 8192 then raise exception 'BAD_SCHEMA'; end if;
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
    -- T5.2: the wording the builder stores — bounded strings (PR #26/#27 reviews). Every
    -- screen escapes them; the caps keep a future slip from becoming stored XSS at scale.
    foreach mk in array array['label_en', 'label_ar'] loop
      if f.value ? mk and (jsonb_typeof(f.value -> mk) <> 'string'
                           or char_length(f.value ->> mk) not between 1 and 200) then
        raise exception 'BAD_SCHEMA';
      end if;
    end loop;
    foreach mk in array array['labels_en', 'labels_ar', 'glyphs'] loop
      lim := case when mk = 'glyphs' then 16 else 80 end;
      if f.value ? mk then
        -- nested, so jsonb_each never sees a non-object (fails as BAD_SCHEMA, not 22023)
        if f.value ->> 'type' <> 'enum' or jsonb_typeof(f.value -> mk) <> 'object' then raise exception 'BAD_SCHEMA'; end if;
        if exists (select 1 from jsonb_each(f.value -> mk) x
                    where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') not between 1 and lim
                       or not (f.value -> 'values') ? x.key) then   -- only real choices carry wording
          raise exception 'BAD_SCHEMA';
        end if;
      end if;
    end loop;
    -- T5.2 hardening (5a S2 / 5a.1 reviews): per-choice ticks — an array of ≤ 20 of this question's own
    -- choices; the teal tint only on the icon question, the split ring only on the ring question
    foreach mk in array array['allergy_friendly', 'ring_split'] loop
      if f.value ? mk then
        want := case when mk = 'allergy_friendly' then 'glyph' else 'ring' end;   -- (an IF condition ends at its first THEN)
        if f.value ->> 'type' <> 'enum'
           or coalesce(f.value ->> 'pin', '') <> want
           or jsonb_typeof(f.value -> mk) <> 'array' or jsonb_array_length(f.value -> mk) > 20
           or exists (select 1 from jsonb_array_elements(f.value -> mk) x
                       where jsonb_typeof(x) <> 'string' or not (f.value -> 'values') @> jsonb_build_array(x)) then
          raise exception 'BAD_SCHEMA';
        end if;
      end if;
    end loop;
    if f.value ? 'pin' and (f.value ->> 'type' <> 'enum' or coalesce(f.value ->> 'pin', '') not in ('ring', 'glyph')) then
      raise exception 'BAD_SCHEMA';
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
$function$;

CREATE OR REPLACE FUNCTION public.jc_entry_reports_clear(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; v_entry uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  perform jc_home_hold(v_user, v_home);   -- T5.2 5b review F3: a current member of the home, as jc_entry_live_set
  update jc_event_entries en set reports_locked_until = now() + interval '30 minutes', updated_at = now()
   where en.event_id = p_event and en.home_id = v_home and en.status = 'in' and en.archived_at is null
     and exists (select 1 from jc_events ev where ev.id = en.event_id and ev.status = 'live')
  returning en.id into v_entry;
  if v_entry is null then raise exception 'NOT_FOUND'; end if;
  update jc_entry_reports set cleared_at = now() where entry_id = v_entry and cleared_at is null;
  perform jc_log(v_comm, p_event, v_entry, 'reports_cleared', 'true');
  return jc_event_get(p_event);
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_admin_report_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_last timestamptz; v_job record; v_fail record; v_last_run record;
        v_hits bigint; v_accounts bigint; v_bytes bigint;
begin
  v_comm := jc_assert_admin('community');
  select max(taken_at) into v_last from jc_snapshots where community_id = v_comm;
  select jobid, active into v_job from cron.job where jobname = 'jc-hourly-snapshot';
  select status, end_time into v_last_run from cron.job_run_details
   where jobid = v_job.jobid order by start_time desc limit 1;
  -- T5.2 PR 6 review: the first line only — DETAIL / CONTEXT / HINT / QUERY can carry row values or SQL
  select end_time, left(btrim(split_part(regexp_replace(return_message, '\s*(DETAIL|CONTEXT|HINT|QUERY|LINE \d+):.*$', '', 's'), E'\n', 1)), 120) as msg
    into v_fail from cron.job_run_details
   where jobid = v_job.jobid and status = 'failed' order by start_time desc limit 1;
  select coalesce(sum(count), 0) into v_hits from jc_hits
   where community_id = v_comm and hour > now() - interval '24 hours';
  select count(*) into v_accounts from jc_accounts where community_id = v_comm;
  select coalesce(sum((metadata ->> 'size')::bigint), 0) into v_bytes from storage.objects;

  return jsonb_build_object(
    'generated_at', now(),
    'snapshot', jsonb_build_object(
      'last_at', v_last,
      'age_minutes', floor(extract(epoch from now() - v_last) / 60),
      'stale', v_last is null or v_last < now() - interval '2 hours'),
    'cron', jsonb_build_object(
      'job_present', v_job.jobid is not null,
      'active', coalesce(v_job.active, false),
      'last_status', v_last_run.status,
      'last_run_at', v_last_run.end_time,
      'last_failure', case when v_fail.end_time is null then null
                           else jsonb_build_object('at', v_fail.end_time, 'message', v_fail.msg) end),
    'failures_since_baseline', jsonb_build_object(
      'admin_codes', (select coalesce(s.last_value, 0) - b.value from pg_sequences s, jc_counter_baseline b
                       where s.schemaname = 'public' and s.sequencename = 'jc_admin_fail_count' and b.name = 'admin_fail'),
      'join_codes',  (select coalesce(s.last_value, 0) - b.value from pg_sequences s, jc_counter_baseline b
                       where s.schemaname = 'public' and s.sequencename = 'jc_join_fail_count' and b.name = 'join_fail'),
      'baseline_at', (select min(at) from jc_counter_baseline),
      'scope', 'all communities'),
    'rate_limited_now', jsonb_build_object(
      'admin_unlock', (select count(*) from jc_rate r join jc_accounts a on a.user_id = r.user_id
                        where a.community_id = v_comm and r.bucket = 'admin_unlock'
                          and r.n >= 5 and r.window_start > now() - interval '15 minutes'),
      'join_pre_membership', (select count(*) from jc_rate r where r.bucket = 'join'
                                and r.n >= 10 and r.window_start > now() - interval '1 hour')),
    'state_changes_24h', coalesce((select jsonb_object_agg(field, k) from
        (select field, count(*) k from jc_state_log where community_id = v_comm
           and at > now() - interval '24 hours' group by field) x), '{}'::jsonb),
    'notices_open', (select count(*) from jc_admin_notices where community_id = v_comm and resolved_at is null),
    'traffic', jsonb_build_object(
      'hits_24h', v_hits,
      'counter_suspect', v_accounts > 0 and v_hits = 0),
    'storage', jsonb_build_object(
      'bytes', v_bytes,
      'limit_bytes', 1073741824,
      'pct', round(v_bytes * 100.0 / 1073741824, 1),
      'alert', v_bytes >= 0.8 * 1073741824,
      'scope', 'whole project'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.jc_admin_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  v := jc_admin_report_core() || jsonb_build_object('maintenance', jc_maintenance_status());
  -- whole-platform numbers (storage, wrong-code counters, join lockouts before membership): the platform
  -- owner only (Zee, 2026-11-06); a community admin sees their own community (T5.2 PR 6 deferral)
  if not jc_is_owner() then
    v := (v - 'storage' - 'failures_since_baseline')
         #- '{rate_limited_now,join_pre_membership}';
    -- the nightly cleanups are whole-platform too: whether they ran (and failed), not what they removed or
    -- the storage error text (security review F3)
    v := jsonb_set(v, '{maintenance}', coalesce((
      select jsonb_object_agg(j.key, jsonb_build_object(
               'last_at', j.value -> 'last_at', 'stale', j.value -> 'stale', 'never_run', j.value -> 'never_run',
               'failed', (j.value ->> 'error') is not null))
        from jsonb_each(v -> 'maintenance') j), '{}'::jsonb));
  end if;
  return v;
end;
$function$;
