-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R4a-2 — per-person module admins by invite link (Zee decision 10, docs/plans/R4-courts.md: "community admins, plus
-- assignable per-module admins (Courts now, Pets in R5), alongside per-event admins — a general model").
-- Mirrors per-event admins (20261105070000_t5_2b_event_admins.sql). Every replaced body starts from the LIVE
-- definition (pg_get_functiondef, 2026-11-08, after r4a_courts); changes are marked "R4a-2".
--
-- The model
--   1. A community admin makes a single-use invite link for ONE module scope: 'bookings' (courts) or 'pets'
--      (jc_module_admin_link_create). 72 h, sha256-stored (the token is shown once, never stored), at most 10 open
--      per community + scope. Never 'community' (community admin stays the shared community code = the root) and
--      never 'events' (organizers = community admins; per-event admins already cover "help run an event").
--   2. A member of the same community redeems it while signed in (jc_module_admin_accept) -> one row in
--      jc_module_admins (user, scope). Per account, not per device. Gone with the account (FK cascade).
--   3. jc_assert_admin(scope) and jc_admin_has(scope) — every module-admin gate — accept an active per-person grant
--      for exactly that scope, in addition to the existing codes (unchanged: that scope's code OR the community
--      code). jc_me_get.admin_scopes lists both (same shape: sorted, distinct scope names).
--   4. Community admins list a scope's admins + open links (jc_module_admins_list, identified exactly like the
--      per-event admin list: display name or masked email + home label; no new PII) and revoke one person or one
--      open link (jc_module_admin_revoke). Revocation is immediate: every gate reads the table on each call.
--   A per-person grant does not lapse with inactivity (unlike a code unlock's 60 days): it is a named
--   appointment that a community admin can see (last_used_at is shown) and revoke. It is NOT touched by code
--   rotation or jc_admin_exit ("lock" on a device drops code unlocks only).
--
-- Shared codes: kept working, unchanged (no existing admin breaks). Recommendation (for Zee, not done here): once
--   R4b-1 ships the invite screen, stop handing out the 'bookings' and 'pets' codes and rotate each to a fresh
--   value nobody holds (jc_admin_code_rotate) — that retires them without a schema change. The 'community' code
--   stays (it is the root that makes invites); 'events' is already scheduled to go (T5.2 PR C).
--
-- Also (R4a review deferred items, now resident-facing):
--   (a) bidi controls: verified LIVE that jc_clean_line already strips U+202A–U+202E and U+2066–U+2069 (through
--       jc_clean_text) and U+200B–U+200F (incl. LRM / RLM), U+061C, U+2028/2029, U+FEFF (its own class). The R4a
--       finding was a false positive: NO function change; s18 (BD01/BD02) pins the behaviour for every listed
--       character and for existing callers (block reasons, facility names, pet names). Event titles don't use
--       jc_clean_line: they go through jc_clean_text, which strips the embeddings / overrides / isolates
--       (U+202A–U+202E, U+2066–U+2069) but keeps the marks LRM / RLM / ALM — left as is (R2b-2's choice).
--   (b) block reasons: capped at 185 chars on the server (3–185, REASON_REQUIRED otherwise), so the copied
--       cancel reason 'Court blocked: ' (15) || reason is always complete and <= 200 (jc_bookings_cancel_range's
--       left(…, 200) used to cut the end off silently). jc_admin_booking_cancel keeps 3–200 (no prefix).
--
-- Lock order: link row (FOR UPDATE) -> jc_module_admins row. Link creation per community+scope is serialized by a
-- transaction-scoped advisory lock (the 10-open-link cap).
--
-- Rollback (manual): drop function jc_module_admin_link_create(text), jc_module_admin_accept(text),
--   jc_module_admins_list(text), jc_module_admin_revoke(text, uuid, uuid); drop table jc_module_admin_links,
--   jc_module_admins; re-create jc_assert_admin, jc_admin_has, jc_me_get, jc_snapshot_run, jc_admin_block_create
--   from their live 2026-11-08 bodies (r4a_courts / earlier files).

-- ---------- 1. tables ----------
create table public.jc_module_admins (
  user_id       uuid not null,
  community_id  text not null,
  scope         text not null check (scope in ('bookings', 'pets')),
  granted_by    uuid references auth.users(id) on delete set null,
  granted_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  primary key (user_id, scope),
  -- gone with the account (jc_account_delete / auth.users delete -> jc_accounts cascade)
  foreign key (user_id, community_id) references public.jc_accounts(user_id, community_id) on delete cascade
);
alter table public.jc_module_admins enable row level security;
revoke all on table public.jc_module_admins from public, anon, authenticated;
create index jc_module_admins_community on public.jc_module_admins (community_id, scope);
create index jc_module_admins_granted_by on public.jc_module_admins (granted_by) where granted_by is not null;

create table public.jc_module_admin_links (
  id            uuid primary key default gen_random_uuid(),
  community_id  text not null references public.jc_communities(id),
  scope         text not null check (scope in ('bookings', 'pets')),
  token_hash    text not null unique,  -- sha256; the token itself is shown once, never stored
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '72 hours',
  used_by       uuid references auth.users(id) on delete set null,
  used_at       timestamptz,
  revoked_at    timestamptz
);
alter table public.jc_module_admin_links enable row level security;
revoke all on table public.jc_module_admin_links from public, anon, authenticated;
create index jc_module_admin_links_open on public.jc_module_admin_links (community_id, scope)
  where used_at is null and revoked_at is null;
create index jc_module_admin_links_created_by on public.jc_module_admin_links (created_by) where created_by is not null;
create index jc_module_admin_links_used_by on public.jc_module_admin_links (used_by) where used_by is not null;

-- ---------- 2. the gates (internal; no new grants) ----------
CREATE OR REPLACE FUNCTION public.jc_assert_admin(p_scope text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  update jc_admin_grants g set last_used_at = now()
   where g.user_id = v_user
     and g.scope in (p_scope, 'community')
     and g.last_used_at > now() - interval '60 days'
     and g.code_version = (select c.version from jc_codes c
                            where c.community_id = g.community_id and c.scope = g.scope);
  if found then return v_comm; end if;                                          -- R4a-2
  -- R4a-2: a per-person grant for exactly this module scope (never 'community': the check constraint)
  update jc_module_admins m set last_used_at = now()
   where m.user_id = v_user and m.community_id = v_comm and m.scope = p_scope;
  if not found then raise exception 'NOT_ADMIN'; end if;
  return v_comm;
end;
$function$;

-- read-only on purpose (S4 visibility predicates: jc_pet_get, jc_private.pet_photo_can_write)
CREATE OR REPLACE FUNCTION public.jc_admin_has(p_scope text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from jc_admin_grants g
     where g.user_id = auth.uid() and g.scope in (p_scope, 'community')
       and g.last_used_at > now() - interval '60 days'
       and g.code_version = (select c.version from jc_codes c
                              where c.community_id = g.community_id and c.scope = g.scope))
  -- R4a-2: or a per-person grant for this module scope
  or exists (
    select 1 from jc_module_admins m
     where m.user_id = auth.uid() and m.scope = p_scope);
$function$;

-- ---------- 3. invite links (community admin) + accept (any member) ----------
create function public.jc_module_admin_link_create(p_scope text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text; v_token text; v_exp timestamptz;
begin
  v_comm := jc_assert_admin('community');
  if coalesce(p_scope, '') not in ('bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
  -- serializes creators for this community + scope (the 10-open-link cap)
  perform pg_advisory_xact_lock(hashtext('jc_module_admin_link'), hashtext(v_comm || ':' || p_scope));
  if (select count(*) from jc_module_admin_links
       where community_id = v_comm and scope = p_scope
         and used_at is null and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'TOO_MANY_LINKS';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into jc_module_admin_links (community_id, scope, token_hash, created_by)
  values (v_comm, p_scope, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning expires_at into v_exp;
  perform jc_admin_log_add(v_comm, 'module_admin_link', jsonb_build_object('scope', p_scope));
  return jsonb_build_object('token', v_token, 'scope', p_scope, 'expires_at', v_exp);
end;
$$;

-- Single use. Any failure (unknown, other community, used, revoked, expired) is the same BAD_LINK.
create function public.jc_module_admin_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; l public.jc_module_admin_links%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  select * into l from jc_module_admin_links
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if l.id is null or l.community_id <> v_comm
     or l.used_at is not null or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'BAD_LINK';
  end if;
  insert into jc_module_admins (user_id, community_id, scope, granted_by)
  values (v_user, v_comm, l.scope, l.created_by)
  on conflict (user_id, scope) do nothing;
  update jc_module_admin_links set used_by = v_user, used_at = now() where id = l.id;
  perform jc_admin_log_add(v_comm, 'module_admin_accept', jsonb_build_object('scope', l.scope, 'link_id', l.id));
  return jsonb_build_object('scope', l.scope);
end;
$$;

-- Identified like jc_event_admins_list (display name or masked email + home label) — no new PII.
create function public.jc_module_admins_list(p_scope text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  if coalesce(p_scope, '') not in ('bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
  return jsonb_build_object(
    'scope', p_scope,
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', ma.user_id,
               'name', coalesce(a.display_name, jc_mask_email(u.email)),
               'village', h.village_key, 'type', h.home_type, 'building', h.building, 'number', h.number_raw,
               'granted_at', ma.granted_at, 'last_used_at', ma.last_used_at) order by ma.granted_at, ma.user_id)
        from jc_module_admins ma
        join jc_accounts a on a.user_id = ma.user_id
        join auth.users u on u.id = ma.user_id
        left join jc_home_members m on m.user_id = ma.user_id
        left join jc_homes h on h.id = m.home_id
       where ma.community_id = v_comm and ma.scope = p_scope), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'expires_at', l.expires_at)
                       order by l.created_at, l.id)
        from jc_module_admin_links l
       where l.community_id = v_comm and l.scope = p_scope
         and l.used_at is null and l.revoked_at is null and l.expires_at > now()), '[]'::jsonb));
end;
$$;

-- Exactly one of p_user (remove that person's grant) / p_link (cancel an open link).
create function public.jc_module_admin_revoke(p_scope text, p_user uuid, p_link uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  if coalesce(p_scope, '') not in ('bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
  if (p_user is null) = (p_link is null) then raise exception 'BAD_FIELDS'; end if;
  if p_user is not null then
    delete from jc_module_admins where user_id = p_user and scope = p_scope and community_id = v_comm;
  else
    update jc_module_admin_links set revoked_at = now()
     where id = p_link and scope = p_scope and community_id = v_comm
       and used_at is null and revoked_at is null;
  end if;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform jc_admin_log_add(v_comm, 'module_admin_revoke', jsonb_build_object(
    'scope', p_scope, 'user_id', p_user, 'link_id', p_link));
  return jc_module_admins_list(p_scope);
end;
$$;

revoke all on function public.jc_module_admin_link_create(text), public.jc_module_admin_accept(text),
  public.jc_module_admins_list(text), public.jc_module_admin_revoke(text, uuid, uuid) from public, anon;
grant execute on function public.jc_module_admin_link_create(text), public.jc_module_admin_accept(text),
  public.jc_module_admins_list(text), public.jc_module_admin_revoke(text, uuid, uuid) to authenticated;

-- ---------- 4. jc_me_get: admin_scopes includes per-person grants ----------
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
    -- R4a-2: code unlocks + per-person module grants (distinct, sorted — same shape as before)
    'admin_scopes', coalesce((
      select jsonb_agg(s order by s) from (
        select g.scope as s
          from jc_admin_grants g
          join jc_codes c on c.community_id = g.community_id and c.scope = g.scope
                         and c.version = g.code_version
         where g.user_id = v_user and g.last_used_at > now() - interval '60 days'
        union
        select ma.scope from jc_module_admins ma
         where ma.user_id = v_user and ma.community_id = v_comm) x), '[]'::jsonb),
    -- T5.2b: events this person runs (incl. the 5-day read window after close)
    'admin_events', coalesce((
      select jsonb_agg(ea.event_id order by ev.created_at desc)
        from jc_event_admins ea join jc_events ev on ev.id = ea.event_id
       where ea.user_id = v_user and ev.community_id = v_comm
         and (ev.status <> 'archived' or ev.archived_at > now() - interval '5 days')), '[]'::jsonb),
    'is_owner', jc_is_owner());                                                  -- T5.3: the feedback inbox
end;
$function$;

-- ---------- 5. snapshots: the admin count includes per-person module admins ----------
CREATE OR REPLACE FUNCTION public.jc_snapshot_run(p_at timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; v_bucket timestamptz := date_trunc('hour', p_at); n int := 0;
begin
  for c in select id, modules from jc_communities loop
    insert into jc_snapshots as s (community_id, module, bucket, metrics)
    values
    (c.id, 'homes', v_bucket, (
       select jsonb_build_object(
         'total', count(*),
         'occupied', count(*) filter (where exists (select 1 from jc_home_members m where m.home_id = h.id)),
         'pinned', count(*) filter (where h.lat is not null),
         'by_village', coalesce((select jsonb_object_agg(village_key, k) from
                (select village_key, count(*) k from jc_homes where community_id = c.id group by village_key) v), '{}'::jsonb))
         from jc_homes h where h.community_id = c.id)),
    (c.id, 'accounts', v_bucket, (
       select jsonb_build_object(
         'total', count(*),
         'joined_24h', count(*) filter (where a.joined_at > p_at - interval '24 hours'),
         'admins', (select count(distinct x.user_id) from (                                -- R4a-2: + module admins
                      select g.user_id from jc_admin_grants g
                       where g.community_id = c.id and g.last_used_at > p_at - interval '60 days'
                      union all
                      select ma.user_id from jc_module_admins ma where ma.community_id = c.id) x))
         from jc_accounts a where a.community_id = c.id)),
    (c.id, 'events', v_bucket, jsonb_build_object(
       'enabled', (c.modules -> 'events' ->> 'enabled') is not distinct from 'true',
       'live_events', (select count(*) from jc_events e where e.community_id = c.id and e.status = 'live'),
       'entries_in', (select count(*) from jc_event_entries en join jc_events e on e.id = en.event_id
                       where en.community_id = c.id and e.status = 'live'
                         and en.status = 'in' and en.archived_at is null))),
    (c.id, 'bookings', v_bucket, jsonb_build_object(
       'enabled', (c.modules -> 'bookings' ->> 'enabled') is not distinct from 'true',
       'upcoming', (select count(*) from jc_bookings b where b.community_id = c.id
                     and b.status = 'booked' and b.starts_at > p_at),
       'next_24h', (select count(*) from jc_bookings b where b.community_id = c.id
                     and b.status = 'booked' and b.starts_at > p_at and b.starts_at <= p_at + interval '24 hours'),
       'created_24h', (select count(*) from jc_bookings b where b.community_id = c.id
                        and b.created_at > p_at - interval '24 hours'))),
    (c.id, 'pets', v_bucket, (
       select jsonb_build_object(
         'enabled', (c.modules -> 'pets' ->> 'enabled') is not distinct from 'true',
         'owned', count(*) filter (where p.kind = 'owned'),
         'strays', count(*) filter (where p.kind = 'stray'),
         'missing', count(*) filter (where p.missing))
         from jc_pets p where p.community_id = c.id and p.status = 'active')),
    (c.id, 'traffic', v_bucket, jsonb_build_object(
       'hour', v_bucket - interval '1 hour',
       'pages', coalesce((select jsonb_object_agg(page, count) from jc_hits
                           where community_id = c.id and hour = v_bucket - interval '1 hour'), '{}'::jsonb)))
    on conflict (community_id, module, bucket)
      do update set metrics = excluded.metrics, taken_at = now();
    n := n + 6;
  end loop;
  return n;
end;
$function$;

-- ---------- 6. block reasons: 3–185, so 'Court blocked: ' || reason fits cancel_reason (200) whole ----------
CREATE OR REPLACE FUNCTION public.jc_admin_block_create(p_facility uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_reason text; v_id uuid; v_ids uuid[];
begin
  v_comm := jc_assert_admin('bookings');
  if char_length(p_reason) > 400 then raise exception 'REASON_REQUIRED'; end if;
  v_reason := jc_clean_line(p_reason);
  -- R4a-2: 185, not 200 — the copied cancel reason adds the 15-char 'Court blocked: ' prefix
  if v_reason is null or char_length(v_reason) not between 3 and 185 then raise exception 'REASON_REQUIRED'; end if;
  if p_starts is null or p_ends is null or not isfinite(p_starts) or not isfinite(p_ends)
     or p_ends <= p_starts or p_ends <= now() or p_ends - p_starts > interval '31 days' then
    raise exception 'BAD_FIELDS';
  end if;
  -- FOR UPDATE (not SHARE): waits for in-flight bookings to commit so the cancel below
  -- sees them, and makes later bookings wait until this block is visible
  perform 1 from jc_facilities where id = p_facility and community_id = v_comm and status <> 'retired' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into jc_booking_blocks (community_id, facility_id, starts_at, ends_at, reason, created_by)
  values (v_comm, p_facility, p_starts, p_ends, v_reason, auth.uid())
  returning id into v_id;
  v_ids := jc_bookings_cancel_range(p_facility, null, greatest(p_starts, now()), p_ends, 'Court blocked: ' || v_reason);
  perform jc_admin_log_add(v_comm, 'block_create', jsonb_build_object(
    'block_id', v_id, 'facility_id', p_facility, 'starts_at', p_starts, 'ends_at', p_ends,
    'bookings_cancelled', to_jsonb(v_ids)));
  return jsonb_build_object('block_id', v_id, 'bookings_cancelled', cardinality(v_ids));
end;
$function$;
