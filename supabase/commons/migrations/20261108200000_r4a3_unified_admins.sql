-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R4a-3 — one admin model at every level (Zee, 2026-11-08: "We need to be consistent with how we handle admins at
-- any level ... simple and easy to manage at any level").
-- Every level now works the same way: per-person invite link -> named grant -> listed -> individually removable.
-- Extends R4a-2 (20261108150000_r4a2_module_admins.sql) to scopes 'community' and 'events'. No new tables, no new
-- callable functions (two internal helpers: jc_community_admin_count, jc_admins_payload), no signature changes: the jc_module_admin_* RPCs keep their names and arguments (the word
-- "module" is now historical — they cover every admin level; documented, not renamed). Every replaced body starts
-- from the LIVE definition (pg_get_functiondef, 2026-11-08, after r4a2_module_admins); changes are marked "R4a-3".
--
-- The model after this migration
--   scope       what it can do                                  how you get it
--   community   everything, incl. invites / removals            community code unlock (60-day lapse) OR invite
--   events      all events (organizer)                          events code unlock OR invite
--   bookings    courts                                          bookings code unlock OR invite
--   pets        pets                                            pets code unlock OR invite
--   per-event   one event                                       per-event invite (T5.2b; unchanged)
--   A per-person 'community' grant satisfies every scope (exactly like a community code unlock); a per-person
--   'events' grant satisfies 'events' only; 'bookings' / 'pets' grants satisfy only themselves (R4a-2, unchanged).
--
-- 1. Scope check on jc_module_admins / jc_module_admin_links widened to community / events / bookings / pets.
-- 2. Gates: jc_assert_admin, jc_admin_has (STABLE, read-only) and jc_events_organizer (the "all events" check
--    behind jc_assert_event_admin, jc_admin_events_list, jc_admin_broadcast_set, jc_admin_home_pin_set) accept a
--    per-person grant for the scope OR 'community'.
-- 3. Only community admins (code or per-person) create / list / revoke invites at any level (unchanged gate).
--    An events / bookings / pets admin can't mint a community invite (NOT_ADMIN). A lower-scope admin who redeems a
--    community invite gains community and keeps their lower grant (PK is user + scope).
-- 4. jc_module_admins_list(scope) lists everyone who holds that exact scope — invited (per-person) AND active
--    code unlocks — one row per person with `via` (['code'], ['invite'] or both) and `idle` (unused 90+ days).
--    Same identification as before (display name or masked email + home label; no new PII). Community admins
--    appear under 'community' only (they can do everything; they are not repeated under each scope).
-- 5. jc_module_admin_revoke(scope, user, null) removes that person's grant for the scope: the per-person grant AND
--    their code unlock for the scope (a code holder can unlock again while the shared code is in circulation —
--    retiring the code makes it stick). Last-admin guard: removing the last community admin raises LAST_ADMIN.
-- 6. Last-admin guard (community only). "Community admins" = distinct people with a per-person community grant or an
--    active community code unlock (current code version, used within 60 days) — jc_community_admin_count.
--    jc_module_admin_revoke('community', …) and jc_admin_member_remove refuse a change that leaves 0
--    (LAST_ADMIN), serialized per community by an advisory lock so two admins can't remove each other at once.
--    A community admin may remove themselves only if another remains.
--    The platform owner (jc_platform_owners / is_owner) is NOT counted and gets no admin rights: it is
--    platform-wide, not a community member, and only reads the feedback inbox. Break-glass recovery stays with
--    the owner through the Supabase SQL editor (see the PR / architecture.md runbook).
--    Not guarded, on purpose: jc_account_delete (deleting your own account always works — the privacy promise
--    outranks the guard), jc_admin_exit / the 60-day code lapse (code unlocks are ephemeral by design; the durable
--    floor is a per-person grant — keep at least two before retiring the community code).
-- 7. jc_admin_member_remove now ends every admin right the member holds (R4a-2 deferred item 2): per-person grants
--    (all scopes), code unlocks, per-event grants. Logged.
-- 8. jc_me_get.admin_scopes and jc_snapshot_run already read every jc_module_admins row (R4a-2): no change needed —
--    the s19 tests pin that community / events grants show up in both.
-- 9. Audit log: create / accept / revoke at every scope use the existing actions (module_admin_link /
--    module_admin_accept / module_admin_revoke); revoke adds `code_unlock_removed` (boolean).
--
-- Lapse: per-person community / events grants do NOT lapse with inactivity (same as R4a-2's module grants). A named,
-- listed appointment that a community admin removes is simpler than a silent timer, and a lapse on the last
-- community admin would itself be a lockout. The list flags `idle` (90+ days unused) instead.
--
-- Shared codes: unchanged, still work. Retirement (later, after R4b-1 ships the invite UI; Zee's call): see the PR.
--
-- Lock order: community-admin advisory lock (revoke 'community' / member_remove) -> grant rows. Link creation per
-- community + scope keeps its R4a-2 advisory lock; accept keeps link row FOR UPDATE -> jc_module_admins row.
--
-- Rollback (manual): delete from jc_module_admins / jc_module_admin_links where scope in ('community','events');
--   restore both scope checks to ('bookings','pets'); drop function jc_community_admin_count(text),
--   jc_admins_payload(text, text) AFTER re-creating jc_module_admins_list / jc_module_admin_revoke; re-create
--   jc_assert_admin, jc_admin_has, jc_events_organizer, jc_module_admin_link_create, jc_module_admins_list,
--   jc_module_admin_revoke, jc_admin_member_remove from 20261108150000_r4a2_module_admins.sql / their live
--   2026-11-08 bodies (jc_events_organizer: T5.2b).

-- ---------- 1. scopes ----------
alter table public.jc_module_admins drop constraint jc_module_admins_scope_check;
alter table public.jc_module_admins add constraint jc_module_admins_scope_check
  check (scope in ('community', 'events', 'bookings', 'pets'));
alter table public.jc_module_admin_links drop constraint jc_module_admin_links_scope_check;
alter table public.jc_module_admin_links add constraint jc_module_admin_links_scope_check
  check (scope in ('community', 'events', 'bookings', 'pets'));

-- ---------- 2. the gates (internal; no new grants) ----------
CREATE OR REPLACE FUNCTION public.jc_assert_admin(p_scope text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid; v_comm text; v_home uuid; v_ok boolean;   -- R4a-2
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  update jc_admin_grants g set last_used_at = now()
   where g.user_id = v_user
     and g.scope in (p_scope, 'community')
     and g.last_used_at > now() - interval '60 days'
     and g.code_version = (select c.version from jc_codes c
                            where c.community_id = g.community_id and c.scope = g.scope);
  v_ok := found;                                                                -- R4a-2
  -- R4a-2: a per-person grant. R4a-3: for this scope OR 'community' (a community grant satisfies every scope,
  -- exactly like a community code unlock). Touched even when a code also matched (true last_used_at).
  update jc_module_admins m set last_used_at = now()
   where m.user_id = v_user and m.community_id = v_comm and m.scope in (p_scope, 'community');
  if not (v_ok or found) then raise exception 'NOT_ADMIN'; end if;
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
  -- R4a-2: or a per-person grant; R4a-3: for this scope or 'community'
  or exists (
    select 1 from jc_module_admins m
     where m.user_id = auth.uid() and m.scope in (p_scope, 'community'));
$function$;

-- "all events" (organizer): events or community, code unlock or (R4a-3) per-person grant
CREATE OR REPLACE FUNCTION public.jc_events_organizer()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_ok boolean;                                                           -- R4a-3
begin
  update jc_admin_grants g set last_used_at = now()
   where g.user_id = auth.uid()
     and g.scope in ('events', 'community')
     and g.last_used_at > now() - interval '60 days'
     and g.code_version = (select c.version from jc_codes c
                            where c.community_id = g.community_id and c.scope = g.scope);
  v_ok := found;                                                                -- R4a-3
  update jc_module_admins m set last_used_at = now()
   where m.user_id = auth.uid() and m.scope in ('events', 'community');
  return v_ok or found;
end;
$function$;

-- ---------- 3. last-admin guard helper (internal; never callable by members) ----------
-- Distinct people who can act as community admin right now: a per-person community grant, or an active community
-- code unlock (current code version, used within 60 days — the same test as the gates). The owner is not counted.
create function public.jc_community_admin_count(p_comm text) returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select count(*)::int from (
    select ma.user_id from jc_module_admins ma
     where ma.community_id = p_comm and ma.scope = 'community'
    union
    select g.user_id from jc_admin_grants g
      join jc_codes c on c.community_id = g.community_id and c.scope = g.scope and c.version = g.code_version
     where g.community_id = p_comm and g.scope = 'community' and g.last_used_at > now() - interval '60 days') x;
$$;
revoke all on function public.jc_community_admin_count(text) from public, anon, authenticated;

-- ---------- 4. invite links: every admin level ----------
CREATE OR REPLACE FUNCTION public.jc_module_admin_link_create(p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_token text; v_exp timestamptz;
begin
  v_comm := jc_assert_admin('community');
  -- R4a-3: + community, events
  if coalesce(p_scope, '') not in ('community', 'events', 'bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
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
$function$;

-- jc_module_admin_accept: unchanged (it takes the scope from the link row; the widened check allows the insert).

-- R4a-3: the list payload, built by an internal helper so jc_module_admin_revoke can return it after a community
-- admin removes themselves (they no longer pass the list's gate). Identified like jc_event_admins_list (display
-- name or masked email + home label) — no new PII. Everyone holding exactly this scope — per-person grants and
-- active code unlocks — one row per person.
create function public.jc_admins_payload(p_comm text, p_scope text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'scope', p_scope,
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', x.user_id,
               'name', coalesce(a.display_name, jc_mask_email(u.email)),
               'village', h.village_key, 'type', h.home_type, 'building', h.building, 'number', h.number_raw,
               'granted_at', x.granted_at, 'last_used_at', x.last_used_at,
               'via', to_jsonb(x.via),
               'idle', x.last_used_at < now() - interval '90 days')
             order by x.granted_at, x.user_id)
        from (select y.user_id, array_agg(y.via order by y.via) as via,
                     min(y.granted_at) as granted_at, max(y.last_used_at) as last_used_at
                from (select ma.user_id, 'invite'::text as via, ma.granted_at, ma.last_used_at
                        from jc_module_admins ma
                       where ma.community_id = p_comm and ma.scope = p_scope
                      union all
                      select g.user_id, 'code', g.granted_at, g.last_used_at
                        from jc_admin_grants g
                        join jc_codes c on c.community_id = g.community_id and c.scope = g.scope
                                       and c.version = g.code_version
                       where g.community_id = p_comm and g.scope = p_scope
                         and g.last_used_at > now() - interval '60 days') y
               group by y.user_id) x
        join jc_accounts a on a.user_id = x.user_id
        join auth.users u on u.id = x.user_id
        left join jc_home_members m on m.user_id = x.user_id
        left join jc_homes h on h.id = m.home_id), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'expires_at', l.expires_at)
                       order by l.created_at, l.id)
        from jc_module_admin_links l
       where l.community_id = p_comm and l.scope = p_scope
         and l.used_at is null and l.revoked_at is null and l.expires_at > now()), '[]'::jsonb));
$$;
revoke all on function public.jc_admins_payload(text, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.jc_module_admins_list(p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text;
begin
  v_comm := jc_assert_admin('community');
  -- R4a-3: + community, events
  if coalesce(p_scope, '') not in ('community', 'events', 'bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
  return jc_admins_payload(v_comm, p_scope);                                     -- R4a-3 (body moved, + via / idle)
end;
$function$;

-- Exactly one of p_user (remove that person from this scope) / p_link (cancel an open link).
CREATE OR REPLACE FUNCTION public.jc_module_admin_revoke(p_scope text, p_user uuid, p_link uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_grant boolean := false; v_code boolean := false;          -- R4a-3
begin
  v_comm := jc_assert_admin('community');
  -- R4a-3: + community, events
  if coalesce(p_scope, '') not in ('community', 'events', 'bookings', 'pets') then raise exception 'BAD_SCOPE'; end if;
  if (p_user is null) = (p_link is null) then raise exception 'BAD_FIELDS'; end if;
  if p_user is not null then
    -- R4a-3: removing a community admin is serialized per community (the last-admin guard below)
    if p_scope = 'community' then
      perform pg_advisory_xact_lock(hashtext('jc_community_admins'), hashtext(v_comm));
    end if;
    delete from jc_module_admins where user_id = p_user and scope = p_scope and community_id = v_comm;
    v_grant := found;
    -- R4a-3: and their code unlock for this scope (one "Remove" ends both; the shared code itself is untouched)
    delete from jc_admin_grants where user_id = p_user and scope = p_scope and community_id = v_comm;
    v_code := found;
    if not (v_grant or v_code) then raise exception 'NOT_FOUND'; end if;
    if p_scope = 'community' and jc_community_admin_count(v_comm) = 0 then
      raise exception 'LAST_ADMIN';                                               -- rolls the deletes back
    end if;
  else
    update jc_module_admin_links set revoked_at = now()
     where id = p_link and scope = p_scope and community_id = v_comm
       and used_at is null and revoked_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  perform jc_admin_log_add(v_comm, 'module_admin_revoke', jsonb_build_object(
    'scope', p_scope, 'user_id', p_user, 'link_id', p_link,
    'code_unlock_removed', v_code));                                              -- R4a-3
  -- R4a-3: not via jc_module_admins_list — a community admin who just removed themselves (allowed while another
  -- remains) no longer passes its gate. Same payload either way.
  return jc_admins_payload(v_comm, p_scope);
end;
$function$;

-- ---------- 5. removing a member ends every admin right they hold (R4a-2 deferred item 2) ----------
-- Per-person grants (every scope, incl. community / events), code unlocks and per-event grants. Leaving or moving
-- home still doesn't (the person is still a member). The last-admin guard can't fire from here today (self-removal
-- is USE_ACCOUNT_DELETE and the caller is a community admin), but it stays as a backstop.
CREATE OR REPLACE FUNCTION public.jc_admin_member_remove(p_user uuid, p_delete_account boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comm text; v_home uuid; v_scopes text[]; v_codes text[]; v_events int;  -- R4a-2, R4a-3
begin
  v_comm := jc_assert_admin('community');
  if p_user = auth.uid() then raise exception 'USE_ACCOUNT_DELETE'; end if;
  if not exists (select 1 from jc_accounts where user_id = p_user and community_id = v_comm) then
    raise exception 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtext('jc_community_admins'), hashtext(v_comm));  -- R4a-3
  v_home := jc_home_detach(p_user, false);
  -- R4a-2
  with gone as (delete from jc_module_admins where user_id = p_user and community_id = v_comm returning scope)
  select array_agg(scope order by scope) into v_scopes from gone;
  -- R4a-3: code unlocks and per-event grants end too
  with gone as (delete from jc_admin_grants where user_id = p_user and community_id = v_comm returning scope)
  select array_agg(scope order by scope) into v_codes from gone;
  with gone as (delete from jc_event_admins where user_id = p_user and community_id = v_comm returning 1)
  select count(*) into v_events from gone;
  if jc_community_admin_count(v_comm) = 0 then raise exception 'LAST_ADMIN'; end if;   -- R4a-3
  if coalesce(p_delete_account, false) then
    delete from auth.users where id = p_user;
  end if;
  perform jc_admin_log_add(v_comm, 'member_remove', jsonb_build_object(
    'user_id', p_user, 'home_id', v_home, 'account_deleted', coalesce(p_delete_account, false),
    'module_admin_removed', to_jsonb(coalesce(v_scopes, '{}')),                  -- R4a-2
    'code_unlocks_removed', to_jsonb(coalesce(v_codes, '{}')),                   -- R4a-3
    'event_admin_removed', v_events));                                           -- R4a-3
  return jc_admin_homes_list();
end;
$function$;
