-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- T5.0a (plan D6) — a dedicated community for real-backend smoke tests, so test
-- accounts never land in `jubail` (tests/sql/00_grants aborts once jubail has
-- residents). Selected client-side with ?community=e2e. Modules OFF like jubail.
-- Its join code is bootstrapped out-of-band (jc_code_bootstrap('e2e','join')) and
-- never committed. Smoke-test accounts delete themselves (jc_account_delete);
-- leftovers are caught by the 30-day orphan purge only if they never joined, so
-- the smoke test MUST clean up after itself.
-- Rollback: delete from jc_codes / jc_villages / jc_communities where community_id|id = 'e2e'
-- (only once no jc_accounts / jc_homes / jc_snapshots rows reference it).

insert into public.jc_communities (id, name_en, name_ar, map_lat, map_lng, map_zoom, links)
select 'e2e', 'E2E Test Commons', null, map_lat, map_lng, map_zoom, '{}'::jsonb
  from public.jc_communities where id = 'jubail'
on conflict (id) do nothing;

insert into public.jc_villages (community_id, key, name_en, status, sort)
values ('e2e', 'test-village', 'Test Village', 'delivered', 10)
on conflict do nothing;
