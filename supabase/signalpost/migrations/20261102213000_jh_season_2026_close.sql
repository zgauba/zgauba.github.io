-- Target: SignalPost (hrdmhifeynnokzjqtlsa). Applied 2026-11-02 ~21:25 UTC via
-- the SQL editor (local tooling declines delete-bearing SQL). Mirror only.
--
-- Halloween 2026 season close (KG2 / Theme T1). Honours the published
-- "data deleted after the season" promise. Preconditions, all done first:
-- final aggregates recorded in docs/halloween-2026-final.md and baked into
-- dashboard.html (PR #7); CSV exported to private storage; season relabelled
-- to '2027' and sign-up passcode rotated via the admin UI.
--
-- jh_stats (hourly aggregate counts, no unit numbers or pins) is kept.
-- Also retires KG4: the superseded jh_homes.non_food boolean. The `treats`
-- column (candy / non_food / both — the teal pumpkin) is untouched.

begin;

do $$
declare n int;
begin
  select count(*) into n from jh_homes where season = '2026';
  if n <> 127 then
    raise exception 'Expected 127 season-2026 rows, found % — aborting', n;
  end if;
  if (select value from jh_settings where key = 'season') <> '2027' then
    raise exception 'Soft close not in place — aborting';
  end if;
end $$;

delete from jh_homes where season = '2026';

drop function if exists public.jh_set_nonfood(uuid, uuid, boolean);
alter table public.jh_homes drop column if exists non_food;

commit;

-- Run separately after the delete:
select cron.unschedule('jh-hourly-snapshot');
