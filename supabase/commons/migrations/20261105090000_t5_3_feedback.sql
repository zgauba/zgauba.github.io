-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.3 — resident feedback (ideas, problems, anything). Decisions (Zee, 2026-11-04):
--   * in-app form; ONLY the platform owner reads it — not community admins. Owners are rows in
--     jc_platform_owners, inserted by hand in the dashboard / CLI (never in this public repo);
--   * every message is linked to the sender's home (disclosed on the form) — stored as the home
--     plus a label snapshot ("Villa 12 · Ain Al Maha"); no name, email or account id is kept;
--   * the owner is told by EMAIL. The test suite pins that no public function touches net./vault.
--     (anon keeps EXECUTE on net.http_*), so the mail goes from a jc_private function on a
--     10-minute cron, at most ONE email an hour ("2 new feedback from Villa 12 · …" — counts and
--     home labels, never the text). Resend API key (sending-only) + recipient live in Supabase
--     Vault (jc_resend_api_key, jc_feedback_to) — not set = nothing sent, nothing lost. A failed
--     send is found on the next run (net._http_response), logged, and its batch re-queued.
--     ACCEPTED (security review): the request — Authorization header included — sits in
--     net.http_request_queue for seconds; anon/authenticated hold Supabase's unrevocable SELECT
--     on it (Known Gap 14), unreachable because schema net is not API-exposed (canary-probed);
--   * spam: 5 a day per account, 10 per home, 100 per community; the inbox lists unread first;
--   * retention: read feedback goes after 12 months, unread after 24 (nightly).
-- Also (PR 4b review M1): jc_events_list returns households_in — every "in" household, as
-- jc_event_get counts it — so a one-place event's list and page counts always match.
--
-- Rollback, IN THIS ORDER (review: jc_me_get calls jc_is_owner — restore it before dropping):
--   1. restore jc_me_get (body in 20261105070000) and jc_events_list (20261105080000);
--   2. select cron.unschedule('jc-feedback-notify'); select cron.unschedule('jc-feedback-purge');
--   3. drop function jc_private.feedback_notify(), public.jc_purge_feedback(),
--      public.jc_feedback_send(text, text, text), public.jc_feedback_list(),
--      public.jc_feedback_mark_read(uuid, boolean), public.jc_is_owner();
--      drop table public.jc_feedback, public.jc_platform_owners;
--   4. delete from jc_maintenance_log where job like 'feedback%'; delete from jc_rate where bucket = 'feedback';
--      alter table jc_maintenance_log drop column ref; then restore the job check to
--      ('orphan_users', 'photo_purge') and the jc_rate bucket check to ('join', 'admin_unlock').

set local lock_timeout = '3s';            -- two tiny tables get constraint swaps: never queue behind traffic

-- ---------- 1. who reads feedback ----------
create table public.jc_platform_owners (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.jc_platform_owners enable row level security;
revoke all on table public.jc_platform_owners from public, anon, authenticated;

create function public.jc_is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from jc_platform_owners where user_id = auth.uid()) $$;
revoke execute on function public.jc_is_owner() from public, anon, authenticated;

-- ---------- 2. the messages ----------
create table public.jc_feedback (
  id           uuid primary key default gen_random_uuid(),
  community_id text not null references public.jc_communities(id) on delete cascade,
  home_id      uuid references public.jc_homes(id) on delete set null,
  home_label   text check (home_label is null or char_length(home_label) <= 120),
  kind         text not null check (kind in ('idea', 'problem', 'other')),
  body         text not null check (char_length(body) between 1 and 1000),
  page         text check (page is null or char_length(page) <= 60),
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  read_at      timestamptz
);
create index jc_feedback_created_idx on public.jc_feedback (created_at desc);
create index jc_feedback_unnotified_idx on public.jc_feedback (created_at) where notified_at is null;
create index jc_feedback_community_idx on public.jc_feedback (community_id, created_at);
create index jc_feedback_home_idx on public.jc_feedback (home_id, created_at) where home_id is not null;
alter table public.jc_feedback enable row level security;
revoke all on table public.jc_feedback from public, anon, authenticated;

-- ---------- 3. send (any member; 5 a day, 10 per home, 100 per community) ----------
alter table public.jc_rate drop constraint if exists jc_rate_bucket_check;
alter table public.jc_rate add constraint jc_rate_bucket_check check (bucket in ('join', 'admin_unlock', 'feedback'));

create function public.jc_feedback_send(p_kind text, p_body text, p_page text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; v_body text; v_page text; v_label text;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  if p_kind is null or p_kind not in ('idea', 'problem', 'other') then raise exception 'BAD_KIND'; end if;
  if length(p_body) > 4000 then raise exception 'TOO_LONG'; end if;      -- before any cleaning work
  v_body := jc_clean_text(p_body);                                       -- keeps line breaks
  if v_body is null then raise exception 'EMPTY'; end if;
  if char_length(v_body) > 1000 then raise exception 'TOO_LONG'; end if;
  v_page := left(jc_clean_text(left(p_page, 200)), 60);
  perform jc_rate_take(v_user, 'feedback', 5, interval '1 day');
  -- a home's other accounts, or a community full of them, can't bury the inbox (security review)
  if v_home is not null and (select count(*) from jc_feedback
                              where home_id = v_home and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;
  if (select count(*) from jc_feedback where community_id = v_comm and created_at > now() - interval '1 day') >= 100 then
    raise exception 'RATE_LIMITED';
  end if;
  if v_home is not null then
    -- one line, no control characters (it goes into the owner's email), ≤ 120
    select left(regexp_replace(
             initcap(coalesce(h.home_type, 'home')) || ' ' || coalesce(h.number_raw, '?') || coalesce(', ' || h.building, '')
             || ' · ' || coalesce(vl.name_en, h.village_key, ''), '[[:cntrl:]]+', ' ', 'g'), 120)
      into v_label
      from jc_homes h
      left join jc_villages vl on vl.community_id = h.community_id and vl.key = h.village_key
     where h.id = v_home;
  end if;
  insert into jc_feedback (community_id, home_id, home_label, kind, body, page)
  values (v_comm, v_home, v_label, p_kind, v_body, v_page);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- 4. read (platform owners only) ----------
create function public.jc_feedback_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform jc_me();                                                       -- signed in + a member
  if not jc_is_owner() then raise exception 'NOT_OWNER'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from jc_feedback where read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'community', f.community_id, 'community_name', c.name_en,
               'home', f.home_label, 'kind', f.kind, 'body', f.body, 'page', f.page,
               'created_at', f.created_at, 'read', f.read_at is not null)
             order by f.read_at is not null, f.created_at desc)
        -- unread first, so nothing unread is ever pushed out of the 200 (review)
        from (select * from jc_feedback order by read_at is not null, created_at desc limit 200) f
        join jc_communities c on c.id = f.community_id), '[]'::jsonb));
end;
$$;

create function public.jc_feedback_mark_read(p_id uuid, p_read boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform jc_me();
  if not jc_is_owner() then raise exception 'NOT_OWNER'; end if;
  update jc_feedback set read_at = case when coalesce(p_read, true) then coalesce(read_at, now()) end
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jc_feedback_list();
end;
$$;

grant execute on function public.jc_feedback_send(text, text, text), public.jc_feedback_list(),
  public.jc_feedback_mark_read(uuid, boolean) to authenticated;

-- ---------- 5. the owner's email (cron, not callable by anyone) ----------
alter table public.jc_maintenance_log drop constraint if exists jc_maintenance_log_job_check;
alter table public.jc_maintenance_log add constraint jc_maintenance_log_job_check
  check (job in ('orphan_users', 'photo_purge', 'feedback_notify', 'feedback_purge'));
-- the pg_net request id of each email, so the next run can see whether it went
alter table public.jc_maintenance_log add column ref bigint;

create function jc_private.feedback_notify() returns int
language plpgsql security definer set search_path = ''
as $$
declare v_key text; v_to text; v_new int; v_homes text; v_unread int;
        v_last_at timestamptz; v_last_ref bigint; v_status int; v_err text; v_found boolean; v_req bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'jc_resend_api_key';
  select decrypted_secret into v_to  from vault.decrypted_secrets where name = 'jc_feedback_to';
  if v_key is null or v_to is null then return 0; end if;               -- not set up: keep them for later

  -- did the last email go? pg_net only queues — a bad key / 4xx shows up in _http_response later
  select l.at, l.ref into v_last_at, v_last_ref from public.jc_maintenance_log l
   where l.job = 'feedback_notify' and l.ref is not null order by l.at desc limit 1;
  if v_last_ref is not null then
    select true, r.status_code, r.error_msg into v_found, v_status, v_err from net._http_response r where r.id = v_last_ref;
    if v_found and (v_status is null or v_status not between 200 and 299) then
      insert into public.jc_maintenance_log (job, affected, error)
      values ('feedback_notify', 0, left('email ' || v_last_ref || ' failed: ' || coalesce(v_status::text, '') || ' ' || coalesce(v_err, ''), 500));
      update public.jc_maintenance_log set ref = null where job = 'feedback_notify' and ref = v_last_ref;   -- checked once
      update public.jc_feedback set notified_at = null where notified_at = v_last_at;                  -- that batch again
      v_last_at := null;
    end if;
  end if;
  if v_last_at > now() - interval '1 hour' then return 0; end if;       -- one email an hour at most

  with n as (
    update public.jc_feedback set notified_at = now() where notified_at is null
    returning coalesce(home_label, 'no home yet') as h)
  select count(*), string_agg(distinct h, '; ') into v_new, v_homes from n;
  if v_new = 0 then return 0; end if;
  select count(*) into v_unread from public.jc_feedback where read_at is null;
  -- the message text stays in Commons: the email says who and how many, not what
  select net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from', 'Commons <onboarding@resend.dev>',
      'to', jsonb_build_array(v_to),
      'subject', 'Commons: ' || v_new || ' new feedback',
      'text', v_new || ' new (' || v_unread || ' unread) from ' || left(v_homes, 400) || E'.\n\n'
              || 'Read them in Organizer tools: https://commons.ae/admin/'),
    timeout_milliseconds := 10000) into v_req;
  insert into public.jc_maintenance_log (job, affected, ref) values ('feedback_notify', v_new, v_req);
  return v_new;
end;
$$;
revoke execute on function jc_private.feedback_notify() from public, anon, authenticated;

-- ---------- 6. retention: read feedback goes after 12 months, unread after 24 ----------
create function public.jc_purge_feedback() returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  with gone as (delete from jc_feedback
                 where read_at < now() - interval '365 days' or created_at < now() - interval '730 days' returning 1)
  select count(*) into n from gone;
  insert into jc_maintenance_log (job, affected) values ('feedback_purge', n);
  return n;
end;
$$;
revoke execute on function public.jc_purge_feedback() from public, anon, authenticated;

select cron.schedule('jc-feedback-notify', '*/10 * * * *', 'select jc_private.feedback_notify()');
select cron.schedule('jc-feedback-purge', '55 3 * * *', 'select public.jc_purge_feedback()');

-- ---------- 7. jc_me_get: is_owner (additive) ----------
CREATE OR REPLACE FUNCTION public.jc_me_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       where g.user_id = v_user and g.last_used_at > now() - interval '60 days'), '[]'::jsonb),
    -- T5.2b: events this person runs (incl. the 5-day read window after close)
    'admin_events', coalesce((
      select jsonb_agg(ea.event_id order by ev.created_at desc)
        from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
       where ea.user_id = v_user and ev.community_id = v_comm
         and (ev.status <> 'archived' or ev.archived_at > now() - interval '5 days')), '[]'::jsonb),
    'is_owner', jc_is_owner());                                                  -- T5.3: the feedback inbox
end;
$function$;

-- ---------- 8. jc_events_list: households_in (PR 4b review M1) ----------
CREATE OR REPLACE FUNCTION public.jc_events_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'events');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'slug', ev.slug, 'title_en', ev.title_en, 'title_ar', ev.title_ar,
             'description_en', ev.description_en, 'description_ar', ev.description_ar,
             'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'status', ev.status,
             'signups_open', ev.signups_open, 'features', ev.features, 'theme', ev.theme,
             -- T5.2 3b
             'kind', ev.kind, 'look', ev.look, 'venue_name_en', ev.venue_name_en,
             'venue_name_ar', ev.venue_name_ar, 'capacity', ev.capacity,
             'full', ev.status = 'live' and ev.capacity is not null
                     and (select count(*) from jc_event_entries en
                           where en.event_id = ev.id and en.status = 'in') >= ev.capacity,
             'homes_in', case when ev.status = 'archived'
                              then (select (st.snapshot ->> 'homes')::int from jc_event_stats st where st.event_id = ev.id)
                              else (select count(*) from jc_event_entries en
                                     where en.event_id = ev.id and en.status = 'in' and not en.hidden) end,
             -- T5.3 (PR 4b review M1): every "in" household, as jc_event_get counts — a hidden
             -- sign-up still holds its place, and the two screens must not disagree
             'households_in', case when ev.status = 'live'
                                   then (select count(*) from jc_event_entries en
                                          where en.event_id = ev.id and en.status = 'in') end,
             'my_status', (select en.status from jc_event_entries en
                            where en.event_id = ev.id and en.home_id = v_home))
           order by coalesce(ev.starts_at, ev.created_at) desc)
      from jc_events ev
     where ev.community_id = v_comm and ev.status in ('live', 'archived')), '[]'::jsonb);
end;
$function$;
