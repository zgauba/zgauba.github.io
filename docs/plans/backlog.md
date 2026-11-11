# Jubail Commons — working backlog

> **The plan of record is `docs/plans/ROADMAP.md` (2026-11-06).** This file is the raw idea log; when they
> disagree, the roadmap wins.

> This is the technical, public-safe backlog. The **authoritative backlog + ops
> context live in the private ops reference doc** (Claude project "Jubail Villa")
> — community context, contacts, and priorities stay there, never in this public
> repo. When the two disagree, the private doc wins.

Last groomed: 2026-11-02

## Now / near-term

- [ ] **Apply `jc_season_close` to JubailCommons** — part 2 of
      `supabase/commons/migrations/20261102180000_foundation.sql`; the local
      tooling's permission policy declines delete-bearing SQL, so paste that
      function block into the Supabase SQL editor once. Everything else in the
      migration is applied and verified.
- [ ] **Set the `jubail` community's passcode + admin code** (seeded NULL =
      fail-closed) via an out-of-band UPDATE — never committed here.

- [ ] **Backend hardening (private)** — scope and details tracked only in the
      private ops doc, deliberately not in this repo.
- [x] 2026-11-03 — ~~**Commons: edge-function gateway for admin/auth RPCs**~~ —
      superseded by T3: account-keyed limits in Postgres (failures return instead
      of raise, so the counter commits) + Supabase Auth per-IP limits. See
      `docs/plans/T3-rate-limits.md`.
- [ ] **Commons foundation** (`commons/`): per-community config (villages, map
      center, branding, WhatsApp links, zero-PII default) + per-module feature
      flags (events / bookings / pets — flags double as the compliance kill
      switch). New, dedicated Supabase project (decision 2026-11-02); `jc_`
      tables via migrations in `supabase/commons/migrations/`; folder-per-event URLs
      under /commons/; landing page.
- [x] 2026-11-03 — **Halloween season close-out** (T1): dashboard baked,
      final numbers in `docs/halloween-2026-final.md`, season-2026 rows deleted,
      cron unscheduled. Private CSV export to be deleted 2026-11-17.
- [ ] Update stale stats on `/` and `/jubail/` with final event numbers.

## Commons platform features

> **Launch rule (Zee 2026-11-06):** no launch to residents until the FULL app is built — Events, Courts,
> Pets, The Community (map + directory) and the planned backlog ideas (e.g. customizable main navigation).
> The T6 launch gate (`docs/qa/SYNTHESIS-2026-11-03.md`) is the LAST step, not the next one.

- [ ] EN/AR toggle + RTL (centralized strings dictionary first).
- [ ] Identity model with optional-PII slots from day one (zero-PII default;
      deviations per-feature, opt-in, minimal, disclosed).
- [x] ~~Recovery PIN at sign-up~~ — **dropped 2026-11-06** (accounts use email + password + reset). Was: (user-chosen 4–6 digits; recover via
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
- [ ] **Facility booking module** — **tennis + basketball courts only, NO padel (Zee 2026-11-06;
      the schema's `jc_facilities.kind` still says padel|tennis|other → change in the Courts migration)**: per-facility slot
      grid; anti-squatting rules (advance window, max slot length, per-villa
      caps) mandatory; one-tap cancellation; admin slot-blocking; "official
      community-management bookings take precedence" on the booking screen;
      feature-flag kill switch. Prerequisite: facility inventory.
- [ ] Privacy-clean analytics: anonymous hit counter in our own backend — no
      cookies, no IPs, no third parties.
- [ ] Per-event safety info block (static: security number + agreed meeting
      point; stores nothing).
- [ ] Pet directory (concept canvas exists): owned / community / stray-under-care
      boards, care record, missing toggle; passcode-gated; no donations. → ROADMAP R5 (R5a done 2026-11-10).
- [ ] Haq Al Laila event theme (~Sat Jan 23, 2027 ±1 day): indigo/gold lantern
      palette; native-speaker review before launch.
- [ ] December holiday-lights map re-skin (idea).

- [ ] Per-event admin grant link `?eventadmin=` → fragment (`#eventadmin=`) like R4b-1a's invites, so the token stays out of logs / Referer and the sign-in `next` (Zee 2026-11-08, R4b-1 plan Q2: "later, own small PR").
- [ ] Launch prep: move the SQL suite's fixtures off `jubail` (a test community) and drop the `00_grants` abort — required before any real Jubail account (R4b-1 plan, super-admin track).

- [ ] 2026-11-09 (Zee) **Parcel for another home**: a finder tells the household "I have your parcel" without
      WhatsApp. Leaning: structured, not free chat — sender picks the home + one of "collect from <my home>" / "left at
      your door" / "with security"; the household answers "Thanks, coming" / "Collected"; 72 h expiry, rate-limited,
      the sender's home shown only to that household; "this home isn't on Commons yet" said BEFORE writing.
      **Blocker: a notification channel** (Web Push for the installed app on iOS 16.4+, and/or email after SMTP) —
      without it, the note sits unread while the WhatsApp post gets seen. Post-launch; /plan-change first.
- [ ] 2026-11-09 **Codes section after code retirement**: once codes are retired (manifest R4a-3 "Code retirement"
      steps; needs ≥ 2 invite-made community admins in different homes), hide the admin / organizer code rows and
      "Enter Another Code", and make `jc_admin_code_rotate` refuse retired scopes. The join code stays. Pre-launch.

- [ ] 2026-11-10 (Zee) **Organizers rename modules** → scheduled as ROADMAP **RM**, next (before R5b). RM-a applied (PR #88); RM-b client.
- [ ] 2026-11-10 (Zee) **Buttons follow a renamed section**: hub-card buttons ("See Events", "Book a Court", "Add a Pet") and
      the Events back label still use the built-in words after a rename (RM Q1 kept sentences generic). Option: per-module
      button text in `module_labels` (EN + AR, same allow-lists), or name-free verbs ("Open", "Book Now").
- [ ] 2026-11-10 (RM-a security L1) **`jc_assert_admin` cross-community filter**: the code-grant lookup doesn't check
      `g.community_id = v_comm`. Latent while an account belongs to one community; fix in its own migration + test before
      any multi-community account (super-admin track).
- [ ] 2026-11-11 **Flaky WebKit lane**: `courts.spec.js:271` "a failed Private switch puts the tick back and says why" fails
      ~2 in 5 on WebKit (macOS), independent of RM-b; on CI Linux WebKit also `courts.spec.js:475` / `:589` ("navigation
      interrupted by another navigation to /commons/home/"). The lane is non-blocking, so flakes hide real findings (RM-b
      finding 11 was nearly missed). Fix the races, then make the lane blocking.
- [ ] 2026-11-10 "**What's On in Abu Dhabi**" off-island events calendar — blocked on who keeps it updated.
- [ ] 2026-11-10 **Resident submissions for events** (separate from Neighbourhood Edit recommendations).
- [ ] 2026-11-09 (R4c security L5) **"No third parties" vs map tiles**: map pages fetch tiles from OpenStreetMap / Esri (IP + tile coordinates). Soften `join_privacy` ("map tiles load from OpenStreetMap / Esri") or self-host tiles. Pre-launch.

## Done

- [x] 2026-11-02 — Monorepo switchover: pushed, old repo Pages disabled +
      archived, folder serves identical URL.
- [x] 2026-11-02 — `jh_stats` RLS lockdown + `jh_snapshot` execute revoked
      (`supabase/signalpost/migrations/20261102160000_jh_stats_rls_lockdown.sql`).
- [x] 2026-11-02 — dashboard.html escapes village names (stored-XSS hardening).
- [x] 2026-11-02 — Stack Manifest rewritten for the monorepo.
- [x] 2026-11-02 — jh_admin_* brute-force tar-pit + failure counter
      (`supabase/signalpost/migrations/20261102170000_jh_admin_tarpit.sql`).
