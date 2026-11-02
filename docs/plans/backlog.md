# Jubail Commons — working backlog

> This is the technical, public-safe backlog. The **authoritative backlog + ops
> context live in the private ops reference doc** (Claude project "Jubail Villa")
> — community context, contacts, and priorities stay there, never in this public
> repo. When the two disagree, the private doc wins.

Last groomed: 2026-11-02

## Now / near-term

- [ ] **Backend hardening (private)** — scope and details tracked only in the
      private ops doc, deliberately not in this repo.
- [ ] **Commons foundation** (`commons/`): per-community config (villages, map
      center, branding, WhatsApp links, zero-PII default) + per-module feature
      flags (events / bookings / pets — flags double as the compliance kill
      switch). New, dedicated Supabase project (decision 2026-11-02); `jc_`
      tables via migrations in `supabase/migrations/`; folder-per-event URLs
      under /commons/; landing page.
- [ ] **Halloween season close-out** (deferred, in order): bake final dashboard
      numbers → Export CSV → delete season-2026 rows → new season label →
      unschedule hourly snapshot cron.
- [ ] Update stale stats on `/` and `/jubail/` with final event numbers.

## Commons platform features

- [ ] EN/AR toggle + RTL (centralized strings dictionary first).
- [ ] Identity model with optional-PII slots from day one (zero-PII default;
      deviations per-feature, opt-in, minimal, disclosed).
- [ ] Recovery PIN at sign-up (user-chosen 4–6 digits; recover via
      unit+village+PIN, rate-limited). Fallback: optional email magic-link
      (disclose if adopted).
- [ ] Control-panel UI rework: explicit-state controls (toggles / segmented
      groups), event-night mode where "Mine" collapses to one giant
      availability switch.
- [ ] Candy-level indicator: quantized four-level supply state; pin fill
      drains; top state = surplus signal.
- [ ] Crowd reporting "this home is out": 1 report → owner banner; 3+ →
      "reported out ❓" state, never auto-toggle; owner confirms or
      clears+locks 30 min; localStorage dedup.
- [ ] Suggested walking route: nearest-neighbor + 2-opt loop over stocked
      homes, polyline + optional Google Maps handoff; recompute as homes go out.
- [ ] Kilometers-walked counter: strictly client-side, localStorage,
      "at least X km" framing; community total only as explicit opt-in.
- [ ] **Facility booking module** (padel-first soft launch): per-facility slot
      grid; anti-squatting rules (advance window, max slot length, per-villa
      caps) mandatory; one-tap cancellation; admin slot-blocking; "official
      community-management bookings take precedence" on the booking screen;
      feature-flag kill switch. Prerequisite: facility inventory.
- [ ] Privacy-clean analytics: anonymous hit counter in our own backend — no
      cookies, no IPs, no third parties.
- [ ] Per-event safety info block (static: security number + agreed meeting
      point; stores nothing).
- [ ] Pet directory (concept canvas exists): owned / community / stray-under-care
      boards, care record, missing toggle; passcode-gated; no donations.
- [ ] Haq Al Laila event theme (~Sat Jan 23, 2027 ±1 day): indigo/gold lantern
      palette; native-speaker review before launch.
- [ ] December holiday-lights map re-skin (idea).

## Done

- [x] 2026-11-02 — Monorepo switchover: pushed, old repo Pages disabled +
      archived, folder serves identical URL.
- [x] 2026-11-02 — `jh_stats` RLS lockdown + `jh_snapshot` execute revoked
      (`supabase/migrations/20261102160000_jh_stats_rls_lockdown.sql`).
- [x] 2026-11-02 — dashboard.html escapes village names (stored-XSS hardening).
- [x] 2026-11-02 — Stack Manifest rewritten for the monorepo.
