-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T3 — rate limits on the join and admin-unlock paths. Plan: docs/plans/T3-rate-limits.md.
--
-- Replaces the planned per-IP edge gateway (decision 2026-11-03): every guarded path
-- needs an account, so limits are keyed by account inside Postgres; strangers are
-- limited upstream by Supabase Auth's own per-IP sign-up/sign-in limits. No IPs stored.
--
-- Why failures now RETURN instead of RAISE: a raise rolls back the whole call,
-- counter included, so a counter written by a raising function never counts. The
-- two guarded functions therefore return {"error": "BAD_CODE" | "BAD_ADMIN"} on a
-- wrong code (HTTP 200 — clients must check `error`). Over the limit still raises
-- RATE_LIMITED: by then the count is already at the limit, so losing the increment
-- changes nothing.
--
-- Limits count ATTEMPTS (increment before the code check). Counting failures would
-- let parallel calls all read "0 so far". Join clears on success (the account is then
-- a member and jc_join short-circuits). Admin unlock never clears — the window just
-- expires — because success is per scope: an events admin's own valid unlock must not
-- reset their guesses at the community code (security review, 2026-11-03).
-- The admin tar-pit is unconditional (every attempt that passes the limit, right or
-- wrong): a failure-only delay leaks the answer by timing, and a caller who cancels
-- mid-sleep would roll back the count. One attempt per
-- account per bucket may be in flight (non-blocking advisory lock): a parallel call
-- gets RATE_LIMITED at once instead of queueing on the counter row, which would pin
-- a connection exactly like the tar-pit does.
--
--   join          10 attempts / hour     per account   (jc_join)
--   admin_unlock   5 attempts / 15 min   per account   (jc_admin_unlock; 1.5 s on every attempt)
--
-- jc_code_check (anon pre-check) is retired: its grants are revoked. jc_join re-checks
-- the code, so the code-first screen keeps the code locally and submits it with jc_join
-- after sign-up. The function stays (uncallable) until a later cleanup drops it.
--
-- Rollback (pre-invite, tables empty): re-run sections 9 and 12 of
-- 20261103120000_s1_identity_homes.sql for jc_join / jc_admin_unlock, re-grant
-- jc_code_check to anon + authenticated, then drop jc_rate_take, jc_rate_clear,
-- jc_fail_return and table jc_rate.

-- ---------- 1. counter ----------
create table public.jc_rate (
  user_id       uuid not null references auth.users(id) on delete cascade,
  bucket        text not null check (bucket in ('join', 'admin_unlock')),
  window_start  timestamptz not null default now(),
  n             int not null check (n >= 0),
  primary key (user_id, bucket)
);
alter table public.jc_rate enable row level security;
revoke all on table public.jc_rate from public, anon, authenticated;

-- ---------- 2. internal helpers (no grants) ----------
create function public.jc_rate_take(p_user uuid, p_bucket text, p_limit int, p_window interval)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('jc_rate:' || p_bucket), hashtext(p_user::text)) then
    raise exception 'RATE_LIMITED';
  end if;
  insert into jc_rate as r (user_id, bucket, window_start, n)
  values (p_user, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
    set window_start = case when r.window_start <= now() - p_window then now() else r.window_start end,
        n            = case when r.window_start <= now() - p_window then 1 else r.n + 1 end
  returning n into v_n;
  if v_n > p_limit then raise exception 'RATE_LIMITED'; end if;
end;
$$;

create function public.jc_rate_clear(p_user uuid, p_bucket text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from jc_rate where user_id = p_user and bucket = p_bucket;
$$;

-- jc_fail's counting, but returns so the caller's writes (the counter) commit.
-- No delay here: jc_admin_unlock sleeps on every attempt itself.
create function public.jc_fail_return(p_err text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_err = 'BAD_ADMIN' then
    perform nextval('public.jc_admin_fail_count');
  else
    perform nextval('public.jc_join_fail_count');
  end if;
  return jsonb_build_object('error', p_err);
end;
$$;

revoke execute on function
  public.jc_rate_take(uuid, text, int, interval),
  public.jc_rate_clear(uuid, text),
  public.jc_fail_return(text)
from public, anon, authenticated;

-- ---------- 3. guarded paths (same signatures: existing grants carry over) ----------
create or replace function public.jc_join(p_community text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_existing text;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  select community_id into v_existing from jc_accounts where user_id = v_uid;
  if v_existing is not null then
    if v_existing = p_community then return jc_me_get(); end if;
    raise exception 'ALREADY_MEMBER_ELSEWHERE';
  end if;
  perform jc_rate_take(v_uid, 'join', 10, interval '1 hour');
  if not jc_code_ok(p_community, 'join', p_code) then return jc_fail_return('BAD_CODE'); end if;
  perform jc_rate_clear(v_uid, 'join');
  begin
    insert into jc_accounts (user_id, community_id) values (v_uid, p_community);
  exception when unique_violation then null;  -- double-submit: the other call won
  end;
  return jc_me_get();
end;
$$;

create or replace function public.jc_admin_unlock(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; s text; v_ver int; v_scopes text[] := '{}';
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_rate_take(v_user, 'admin_unlock', 5, interval '15 minutes');
  perform pg_sleep(1.5);
  foreach s in array array['community', 'events', 'bookings', 'pets'] loop
    v_ver := null;
    select version into v_ver from jc_codes
     where community_id = v_comm and scope = s
       and code_hash = extensions.crypt(jc_code_canon(p_code), code_hash);
    if v_ver is not null then
      insert into jc_admin_grants (user_id, community_id, scope, code_version)
      values (v_user, v_comm, s, v_ver)
      on conflict (user_id, scope) do update
        set code_version = excluded.code_version, granted_at = now(), last_used_at = now();
      v_scopes := v_scopes || s;
    end if;
  end loop;
  if cardinality(v_scopes) = 0 then return jc_fail_return('BAD_ADMIN'); end if;
  return to_jsonb(v_scopes);
end;
$$;

-- ---------- 4. retire the anon pre-check ----------
revoke execute on function public.jc_code_check(text, text) from public, anon, authenticated;
comment on function public.jc_code_check(text, text) is
  'Retired by T3 (no grants): jc_join re-checks the code. Drop in a later cleanup.';
