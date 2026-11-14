# Jubail Commons — roadmap to launch

> **The plan of record (2026-11-06).** Synthesized from: Zee's ideas summary (Oct 4 – Nov 6 planning
> conversations, `commons-ideas-summary.md`, shared 2026-11-06), `docs/plans/backlog.md`, the T2–T5 plans,
> `docs/qa/SYNTHESIS-2026-11-03.md` (T6 launch gate) and Zee's decisions in session. **When this file and
> another plan disagree, this file wins; when this file and live infra disagree, live wins — fix this file.**
> The private Ops Reference still holds community context, contacts and codes (never this repo).
> Deferred review findings + Known Gaps folded in by `docs/qa/SYNTHESIS-2026-11-06.md` (marked "synthesis" below).
> Rule from that pass: a deferred finding ships with the phase that already touches its code.

## The launch rule

**No launch to residents until the full app is built** — Events, Courts, Pets, The Community, the
pre-launch phases below — and the launch gate (R8) passes. The launch gate is the **last** step.
The `e2e` test community stays the place to try everything; Jubail's modules stay OFF until R8.

## Done (as of 2026-11-10)

| Phase | What shipped |
|---|---|
| T1–T4 | Halloween close-out + baseline (124 homes); Commons schema for every module (identity/homes, events, courts, pets) — RPC-only, RLS deny-all; rate limits; snapshots, state-change log, visit counter, health probe, cleanup jobs, canary |
| T5.0–T5.1 | Accounts (email + password + reset), join code, home claim + required pin, household invites, tab bar, hub, auto-update; Events for residents with Halloween parity |
| T5.2 | Organizer Tools (templates, question builder, kinds homes / one place, looks, sign-ups tab, pin moves, banner, CSV, per-event admins), event looks + pins, **event day** (two-sided switch, supply gauge, crowd reports + "We're Not Out", 2-min refresh), App Health & Notices, page help "?", Organizer Tools sub-menu, event Admin button, DB hardening |
| T5.3–T5.4 | Feedback to the platform owner (email via Resend); Coming Soon stage |
| R0 | WebKit e2e lane in CI (non-blocking until green ×2); its first catch fixed (map buttons over pin popups) — PR #62 |
| R1 | Organizer Tools → Community → **Households**: list by village, invite Approve / Decline, home edit, directory hide, member remove, admin log, notice → home — PR #63 |
| R2a | Events audit fixes: events end + auto-close 24 h later (stats always taken), vacated homes start clean, treat-night templates, homes events need a date, hidden households told, banners go with their event — PR #64 (DB `r2a_events_audit`) |
| R1.1 | Households: fix / set a home's pin (map + confirm naming the home + Undo) — PR #67 |
| R2b-1 | Organizer event-night acts (mark a home done / open, set or clear its supply, remove a no-show; household told, never who) + event page polish (Admin button on the title line, full-screen map) — PR #68 (DB `r2b_1_organizer_acts`) |
| R2b-2 | Per-event safety box (security line + lost-child meeting point), holiday lights look + template, clean event text on write — PR #69 (DB `r2b_2_safety_lights`). **R2 complete.** |
| R3 | App shell: "Save as an app" (R3b), your bar + start page + Settings (R3a), accessibility pass with shared WAI-ARIA tabs (R3c). **R3 complete.** |
| R4 | Courts: schema to spec + module / unified per-person admins (R4a–R4a-3), Admins screen + court editor (R4b-1), admin Day view (R4b-2), residents book (R4c), My Bookings → Past (R4d) — PRs #71–#85. **R4 complete** (Courts stays off for Jubail until R8). |
| R5a | Pets DB to spec (known & fine, territory, care record, sightings rules + retention, missing-pet show-home opt-in, members-only WhatsApp group link) — DB `r5a_pets`, applied 2026-11-10. Clients next: R5b / R5c / R5d (`docs/plans/R5-pets.md`) |

Detail: `docs/architecture.md` (Stack Manifest) and the reviews in `docs/qa/`.

## Pre-launch phases (in order)

Each phase ships as one or more PRs through `/plan-change` → `/ship-pr` (and `/db-rehearse` when it has a
migration). "DB" = needs a migration.

### R0 — WebKit test lane (synthesis S1, KG 17)  ·  tests only  ·  ✓ done 2026-11-06 (PR #62)
- Add a Playwright `webkit` project to the e2e suite and CI — three shipped bugs were iPhone-Safari-only and
  Chromium CI passed them. Non-blocking until green twice, then blocking. Flakes beyond one PR → their own
  test-only PR. Real-iPhone checks stay in R8.

### R1 — Households (Organizer Tools → Community)  ·  app only  ·  ✓ done 2026-11-06 (PR #63)
Community admins have database functions for homes but **no screen** — and invite requests over a
household's member limit currently have nowhere to go.
- Households list by village: home label, pin status, members (display name or masked email — never the
  full address), hidden-from-directory flag, pin flags; per-village counts (adoption).
- **Pending invites over the limit → Approve / Decline** (`jc_admin_invite_decide`).
- Fix a home's village / type / number (`jc_admin_home_edit`); ~~hide / show in the directory~~ (removed by HH,
  2026-11-12); remove a member, optionally deleting the account (`jc_admin_member_remove`).
- Admin log (`jc_admin_log_list`); links from App Health notices ("household left", "pin far away") to the home.
- Verify each RPC's live shape before building (they date from S1, never exercised by a screen).

### R1.1 — Households: fix a home's pin  ·  app only  ·  ✓ done 2026-11-06 (PR #67)
- Zee 2026-11-06: "Fix pin" / "Set pin" per home in Households, reusing the Sign-ups tab pin move (map +
  confirm naming the home + Undo) and the existing `jc_admin_home_pin_set` (clears pin flags, resolves the
  "pin far away" notice).

### Event page polish  ·  app only  ·  ✓ done 2026-11-07 (shipped inside R2b-1, PR #68)
- **Admin button on the title line**, not its own row (Zee 2026-11-06 screenshot: it pushes the title down).
- **Full-screen map button** — a CSS expand with a close ✕ (iOS Safari has no element Fullscreen API);
  Leaflet `invalidateSize` after resize; pins, popups, Find Me, Map Labels / Street keep working.
- Check the thin horizontal line across the map in iOS Safari (likely a tile seam); fix if it reproduces.

### R2 — Event-night extras + Events audit fixes  ·  DB  ·  ✓ done 2026-11-07 (R2a PR #64, R2b-1 PR #68, R2b-2 PR #69)
**R2a — Events audit fixes** (`docs/qa/events-qa-2026-11-06.md`; Zee 2026-11-06: fix all of them). Ships first:
it changes existing behaviour, and R2b builds on the same functions.
- **D1 + L1** — when a household leaves a home, its sign-ups lose the organizer's "hidden" flag and their spot,
  so the next family starts clean. The same household withdrawing + re-joining stays hidden.
- **D2** — at an event's end time sign-ups stop and the event moves to Past; a scheduled job closes it
  24 h after the end time, so its stats snapshot is always taken. Undated events are exempt. Needs a
  test that fails today (the live `e2e/halloween-test` row is the example).
- **F1** — the Halloween + Haq al Laila templates turn on switch, supply and crowd reports.
- **F2** — publishing a homes event asks for a start date (event day needs one).
- **U1** — a hidden or directory-hidden household sees "Your home isn't shown on the map" on My Sign-Up.
- **U3** — closing an event clears any banner about it; revoking an event admin clears their banner.

**R2b — Event-night extras** (plan: `docs/plans/R2-event-night.md` — R2b-1 = organizer acts → household told,
R2b-2 = safety block, holiday lights, clean text)
- **Organizer marks a home out** (Zee 2026-11-06: yes) — organizers + that event's admins set a home's
  live state / supply on event night; admin-logged; the household sees it on My Sign-Up. New RPC (never
  change `jc_entry_live_set`'s signature).
- **Per-event safety block** — community security number + agreed lost-child meeting point, set in the
  editor (`jc_events.safety` + the `safety` feature flag already exist); shown on the event page.
  Stores nothing about people; children are never named or matched to homes.
- **Holiday lights template** (Zee 2026-11-06: "just another event template") — a homes event: each
  decorated home is a stop; its own look (needs `holiday_lights` added to the `jc_events.look` CHECK — same
  migration) + template questions (e.g. best viewed from: street / garden; lights on until …).
- **Free a no-show's place** (synthesis; T5.2 3b #9 / PR 4, deferred by Zee to a DB PR) — organizers / that
  event's admins withdraw a sign-up; admin-logged. New RPC.
- **The household is told** (synthesis; 3a) — when an organizer moves its pin or marks it out, My Sign-Up says
  "adjusted by an organizer" (no organizer named).
- **Clear a supply level** (Zee 2026-11-06; R2b-1) — tapping the selected "How much is left" level again clears it.
  New RPC; `jc_entry_live_set`'s signature unchanged (its null means "leave as is").
- **Clean event text on write** (synthesis; KG 16) — `jc_clean_text` on event title / description in the save
  path; stored text left as is.

### R3 — App shell: your navigation, your start page, "Save as an app"  ·  app only
Plan: `docs/plans/R3-app-shell.md` (approved 2026-11-08). Three PRs: **R3b** "Save as an app" (static: manifest,
icons, head tags; installed name "Commons"; no service worker) → **R3a** bar + start page + Settings → **R3c**
accessibility.
- **Settings (My Home → Account):** choose which buttons appear in the bottom bar and their order
  (My Home always stays — Settings lives there); choose the **start page** the app opens on. Saved to the
  account (`jc_accounts.prefs` via `jc_prefs_set`, ≤ 2 KB — exists, unused), so it follows the person
  across phones. Modules that are off for the community never appear.
- **"Save as an app":** web manifest + icons + iOS meta. Gotcha: iOS home-screen apps keep separate
  storage from Safari (sign in again once) and bake in the name at install.
- **Accessibility pass** (synthesis S3) — first a11y audit (`design:accessibility-review`: hub, events, My Home,
  Organizer Tools); fix the tab rows (role=tab without tabpanel / arrow keys, focus lost on re-render — T5.2
  polish #6) as part of the nav rebuild, not before it.

### News on the Commons home  ·  sequenced after R3a
- Zee 2026-11-08 (R3 Decision 2): a **News** section on the Commons home (hub) for community and household
  information. Needs its own `/plan-change` (who may post, how long items stay, EN + AR, zero-PII default).

### R4 — Courts: tennis + basketball  ·  DB
Zee 2026-11-06: **no padel**; households book; **no outside coaches** for now; **community admins add the
courts and their location**.
- Migration: `jc_facilities.kind` → `tennis | basketball` (today `padel | tennis | other`; no rows yet).
- Organizer Tools → Courts: add / edit a court (name EN/AR, kind, pin on the map, open–close hours, slot
  length 30–120 min), publish / unpublish, block slots (maintenance, official events, known official
  bookings).
- Residents: per-court day grid, book, one-tap cancel, My bookings; **"Official community-management
  bookings take precedence."** on the booking screen (Master Community Declaration §15.10).
- Anti-squatting (mandatory): advance window (~7 days), max slot length, per-home cap
  (`modules.bookings.per_home_per_day`, default 1) — **values to confirm with Zee**.
- Module flag = kill switch (off the same day if official management ships its own system or asks).
- **Prerequisite: facility inventory (Zee is compiling)** — which courts, where, walk-on vs booked, fees.
  If any court charges, Commons coordinates intent only; payment stays with management.
- Open: no-show handling — wait for real data (booking accountability is a candidate opt-in PII slot).

### RM — Renamable modules (platform)  ·  DB + app  ·  RM-a ✓ applied 2026-11-10 (PR #88); RM-b client in review (`docs/plans/RM-renamable-modules.md`)
Every module has a **fixed internal key** (code, URLs, flag — never changes), a **display name per community**
(EN + AR, in community config) and an optional **brand name** shown as the section title. Applies to events,
bookings, pets now and `directory` (The Neighbourhood Edit) later; **today's labels become the defaults**, so
nothing changes on screen until an admin renames. Names are public-safe → `modules.<key>` config (read via
`jc_config_get`). Needs its own `/plan-change`: where names show (bar, page titles, hub cards, Settings, app
install), length caps for the bar, AR required or falling back, who renames (community admins).

### R5 — Pets of Jubail  ·  R5a ✓ applied 2026-11-10 (PR #86); R5b-1 ✓ (#90, #92)
**Order (Zee 2026-11-11):** remove home hiding (`HH-remove-home-hiding.md`) → **R5c photos** (a photo matters more
than a map for finding a missing pet) → R5b-2a shared map kit → R5b-2b Pets maps / tabs / badges
(`R5b-2-pets-maps.md`) → R5d Organizer Tools. (`docs/plans/R5-pets.md`)
**Re-plan 2026-11-13:** R5b-2b = R5b-2b-0 DB ✓ (#102, applied) → R5b-2b-2a Pets · Strays · My Pets → R5b-2b-2b pet
page (Map tab, mini maps, Add Location Pin, out-alone reports + disclosure) → **scoped `/structural-audit`**
(duplication + cross-module consistency, `commons/` client only, ~4–5 agents; Zee 2026-11-13: once all four modules
are stable, so it compares settled code) ✓ SA-1 #105, SA-2 #106, NF-1 #107, NF-2 #108 → NF-3 → R5d; SA-3–SA-5 slot in between.
Schema exists (S4: pets, photos, care log, sightings, missing). Concept: canvas "Jubail Pets Concept" + PDF.
- Directory: **owned** · **community "known & fine"** · **stray under care** (care record: sterilized,
  dewormed, vaccination, under treatment — kept by the carer group).
- Photo, name, species, home. No owner names or phones. Members only (accounts replaced the old
  "viewing passcode" idea).
- **Missing** toggle: card turns red, tops the list.
- Never collects money.
- **Discuss in detail at the start of R5 (Zee 2026-11-06):** the ideas say "report a sighting only
  pre-fills a WhatsApp message — nothing stored", but the schema **stores** sightings (`jc_pet_sightings`:
  reporter, note, location).
- Carer-group access: "one shared link" in the ideas → in Commons terms a per-group admin grant (like
  per-event admins). Confirm.

### Events: village-only events + sign-up limits  ·  DB + app  (idea, Zee 2026-11-11 — needs `/plan-change`)
- An event open to selected villages only. Default: **only those villages see it**; optional "everyone sees it, only
  these villages can sign up" (the page says why you can't join). Enforced on the server in `jc_event_signup` (body
  only — frozen signature); new refusal code.
- Sign-up limit for every event kind (today only one-place events have a capacity).

### R6 — The Community: map + directory  ·  app (+ DB if needed)
- Find any villa on the island and get directions (`jc_directory_list` exists; hidden homes stay hidden).
- Optional per-home extras stay opt-in (zero-PII default).
- **Community information** (Zee 2026-11-10): bus routes / timetables, waste collection, other practical info as
  editor-maintained static content in this section (`docs/plans/neighbourhood-edit-brief.md` → follow-on).
- **Meetups** (Zee 2026-11-11: "maybe they should live in The Community … a sub-section called Meet ups? I don't want
  to create another module"): a tab inside The Community — regular gatherings (what · weekly day + time · place pin ·
  how to join, e.g. a WhatsApp group link). No sign-ups, no capacity. Residents **suggest** a meetup (or an event) →
  it lands in Organizer Tools → an admin approves with one tap → published. Direct resident posting later, once
  moderation and the contact-person (PII) question are settled. Needs its own `/plan-change`.
- **"Hidden homes stay hidden" above is void** — home hiding was removed 2026-11-12 (`docs/plans/HH-remove-home-hiding.md`).

### Light mode  ·  fast follower (Zee 2026-11-11)
- The light palette already exists in `tokens.css` (`[data-theme="light"]`, contrast-checked); every page pins
  `color-scheme: dark` today. Follow the phone's setting (`prefers-color-scheme`), every screen checked in both, map
  tiles and event looks included. After R5b-2.
- Kept on purpose: the blue "you are here" dot (Zee 2026-11-11 — the convention people recognise), tokenised in R5b-2a.

### Nearest first — one distance rule for every list  ·  DB + app  (planned 2026-11-14, `docs/plans/nearest-first.md`)
- Zee 2026-11-14: one unified way of showing distance and one set of buttons. Default origin = **your household pin**;
  the phone only after **Use Where I Am** (lists) or **Find Me** (maps), for that visit; never sent or stored.
- One control everywhere: "Sorted by: nearest your home [Use Where I Am]" ↔ "nearest where you are now [Use My Home]";
  "≈ 300 m" on rows. Courts list, Events List (your village first; By House Number kept), Strays cards. Owned pets:
  server order from your home pin, no phone re-sort (their homes never reach the phone).
- Organizer Tools never by distance: A–Z by village, then name (events stay by date).
- PRs: **NF-1** courts get an optional village (where it is, not who may book; none = Whole community) ✓ #107 → **NF-2** the
  shared control on Courts / Events / Strays ✓ #108 → **NF-3** Organizer A–Z (in review; Pets organizer lists come with R5d).

### Bookings (long term, Zee 2026-11-14)
- Courts grow into general **Bookings** for any community's shared spaces (rooms, BBQ areas, halls). The code is
  already "bookings" (module flag, folder) and a court is a facility with a `kind`, so it is mostly new kinds + labels.
  Not scheduled.

### R7 — Launch prep (not features)
- **Retire the shared `events` organizer code** (Step C, parked until testing is done) → per-event admins only.
- **Retire the Halloween site** into Commons (`jubail-halloween/` stays at its URL forever — a pointer page).
- Per-community split of App Health's platform numbers (needed before a second community admin exists).
- Teardown of `e2e` test data when Zee says testing is done.
- **Commons into its own private repo** (Zee 2026-11-14), done with the commons.ae move (a custom domain means its own
  repo anyway); Cloudflare Pages deploys from private repos. Why: this repo is public, and `docs/qa/` reviews plus the
  manifest's "Known gaps" list accepted / deferred weaknesses; the plans show product direction. A history scan
  (2026-11-14, 345 commits) found no secrets: publishable keys only, and none of the 84 test codes matches a live code.
  Making it private later doesn't erase what was public, so nothing secret goes in meanwhile. `zgauba.github.io`
  stays public (personal pages, Halloween site).
- **Structural audit of the grant model** (synthesis S4, KG 14) — `/structural-audit` over `supabase/commons/`
  after the last migration (R6), then one hardening migration via `/db-rehearse`.
- **Free-tier decision** (synthesis S5, KG 8) — pricing checked 2026-11-06: egress is fine on Free (5 GB vs
  ≈ 0.5 GB per event night); the reasons to upgrade are **no automatic backups on Free**, Pro-only leaked-password
  protection, and the 1-week auto-pause. Plan: **Pro at R8** ($25/month, spend cap on) — retire or move SignalPost
  out of the org first, or it adds $10/month. Same sitting: choose the tile provider, set the Resend key, plan for
  the canary's 60-day auto-disable.

### R8 — Launch gate (last)
From `docs/qa/SYNTHESIS-2026-11-03.md` T6, plus items found since:
- Privacy policy + the promise rewritten everywhere it appears (never silent).
- Native Arabic review (strings; **Haq al Laila wording + design by an Emirati speaker**).
- Fresh Jubail codes (join, community admin) — never the Halloween code; rotate at invite time.
- Password-reset email tested end to end.
- Free-tier auto-pause resolved.
- **Map tile provider** chosen for event-night load (OSM's volunteer tiles have no SLA; Esri imagery date
  over Jubail unverified).
- **Upgrade JubailCommons to Supabase Pro** (backups; KG 8) before any resident data, spend cap on.
- Supabase dashboard: **email confirmation OFF** (drift: still on), **leaked-password protection ON** (Pro-only —
  after the upgrade),
  Auth rate limits raised for the invite burst, Site URL + redirect allowlist for commons.ae.
- **Manual verification run** (synthesis S6, KG 11 + KG 15) — two-tab concurrency (rate-limit lock, event-admin
  link cap + accept vs close, capacity at the last place — **this one before the first capacity event**),
  Storage smoke test with a real sign-in, real-iPhone pass (editor dates, Save as an app), `curl -sI` framing
  headers on commons.ae, every Arabic string still marked DRAFT reviewed. Each line ticked with date + who.
- Jubail modules switched on one at a time; invites go out.

## After launch

- **The Neighbourhood Edit — FAST FOLLOWER, first after launch** (Zee 2026-11-10: "launch without it, fast
  follower"). Module key `directory`, tab "Services" / «الخدمات», brand "The Neighbourhood Edit". Curated local
  vendors: categories + subcategories, Call / WhatsApp / Website / Instagram / Flyer buttons, the curator's
  phone editor (scoped `directory` admin), resident submissions → moderation queue, household "used by N ≥ 3"
  signal, no negative path, one-tap hide. Brief: `docs/plans/neighbourhood-edit-brief.md`.
  - **Vendor consent to be listed** (many vendors are individuals with personal numbers) — required before any
    listing goes live; **how** is designed at its `/plan-change` (Zee: details later).
  - **Start now, in parallel:** ask the curator whether her Wix content is a CMS collection (CSV export → import)
    or hand-built pages (manual transcription) — that sets the size of the import.
  - Depends on RM (renamable modules).
- **Suggested walking route** (nearest-neighbor + 2-opt loop over stocked homes; `route` flag off) and
  **kilometers walked** (on-device only, "at least X km", nothing sent).
- **Second community / B2B** — trigger: a second community asks. Needs the platform console + per-community
  numbers (R7).
- **Print maps** — parked on community privacy consensus; never re-enable without Zee.

## Event calendar

**Haq al Laila ≈ Sat 23 Jan 2027** (15 Sha'ban 1448, ±1 day on moon sighting) — **Zee 2026-11-06: dev work
will be done well before then**, so it runs on the launched Commons. Working back: the Emirati native review
of its wording + design (R8) and the event itself need to be ready by early January.

## Decisions (2026-11-06)

- Launch only when the full app is built; launch gate last.
- Recovery PIN: **dropped** (accounts use email + password + reset email).
- Organizers / event admins **can mark a home out** on event night (R2).
- Recommendations directory: **not before launch**.
- Walking route + km walked: **after launch**.
- Courts: tennis + basketball, no padel; households book; no outside coaches; community admins add courts
  + locations.
- Navigation: users choose bottom-bar buttons + start page (R3).
- Holiday lights = an event template (R2), not a separate feature.
- Recommendations directory (after launch): Google Sheet + an "Update Commons" Apps Script menu that pushes
  to Commons.
- Haq al Laila runs on the launched Commons — dev done well before 23 Jan 2027.
- Pet sightings (stored vs WhatsApp-only): discuss at the start of R5.
- Events audit (all four answered yes): treat-night templates turn on supply + crowd reports; events stop
  sign-ups at their end time and auto-close 24 h later; hidden households are told; the hidden flag resets
  when a new family moves in. Every audit finding is fixed in R2a.
- Order: R0 → R1 → R2 as listed; R2 is planned (`/plan-change`) while R1 is built, and built after R1 merges.
- **Verification is tiered** (2026-11-06): cosmetic → suite once + CI + screenshots, a short review note, no
  reviewer agent; screen logic → + `code-reviewer`; data / auth / PII → rehearse, suite twice, database +
  security + code review (`/ship-pr` step 1b).
- **No two build agents on overlapping files** (2026-11-06) — `admin.js`, `strings.js`, `events.js` are shared
  by almost every phase, so builds run one at a time; planning, reviews and audits may run alongside.

## Decisions (2026-11-10)

- **Renamable modules (RM) next, then R5b** — fixed keys, per-community display names (EN + AR), optional brand.
- **The Neighbourhood Edit: launch without it, fast follower** (first after launch); in-app phone editor +
  moderation queue (supersedes the 2026-11-06 Google Sheet sync decision).
- **Vendor consent** to be listed is a requirement of the Edit; its mechanics are planned later.
- Pets: sightings stored only for missing pets / strays (reporter erased within 48 h, rows gone after 30 days);
  map secondary; My Pets inside Pets **and** in My Home; WhatsApp button = copy message + open the group.

## Superseded ideas (from the Oct–Nov planning conversations)

| Earlier idea | What we do instead |
|---|---|
| Serve Commons from Vercel | Cloudflare Pages serves commons.ae from `commons/` |
| Crowd reports auto-flip a home at 3 | Never auto-flip: 3+ → "?" on the map; the household confirms or clears (30-min lock) |
| One giant switch; pin fill drains with supply | Two-sided switch (all values visible) + four supply levels; supply is a 4-bar gauge in the popup / list, not on the pin |
| An "Organizer" tab inside the event | Event **Admin** button → Organizer Tools (Sign-ups tab) |
| Courts: padel first | Tennis + basketball only |
| Haq al Laila lantern / bag icon, teal bag | 🌙 mark; nut-free = 🧡 tinted teal |
| Pets behind a viewing passcode | Members only (accounts) |
| Recovery PIN | Dropped |
| Organizer copies a home's control link | Obsolete — accounts replaced edit links |
| Halloween baseline "125 homes" | 124 (127 entries, 3 removed) — `docs/halloween-2026-final.md` |
| Recommendations via Google Sheet + "Update Commons" script (2026-11-06) | The Neighbourhood Edit: in-app phone editor + moderation queue (2026-11-10) |

## Recommendations: where the data lives (options for the post-launch directory)

> **Superseded 2026-11-10** by the in-app editor (option C) — see `docs/plans/neighbourhood-edit-brief.md`.
> Kept for the record.

Zee's question: could the database be a Google Sheet she edits?

| Option | For | Against |
|---|---|---|
| **A. Google Sheet → Commons sync** (she edits a Sheet; a scheduled job copies it, validated, into a `jc_` table; the app reads only Commons) | She already knows spreadsheets; Google's sharing + version history; the app stays members-only and escapes / validates everything | Needs a sync job (pg_cron + pg_net, like the feedback email) and a published-CSV or service-account read; a bad edit shows up after the next sync; "who can edit" lives in Google, outside Commons' admin log |
| B. App reads the Sheet directly (published to web) | Simplest | **The list becomes public to anyone with the link** (not members-only); no validation; Google outages / rate limits hit residents directly — not recommended |
| C. In-app editor + a "directory editor" grant (like per-event admins) | Members-only, validated, logged, one system | Most work; she learns a new tool |
| D. Wix stays the source, Commons mirrors it | No change for her | Needs her content in a Wix CMS collection + API access on her plan (unverified); the access problems residents have today stay |

**Recommendation:** start with **A** (her comfort, Commons controls what residents see), keep the table
shape compatible with **C** so it can become an in-app editor later.

**Zee 2026-11-06 — the trigger is hers:** a Google Apps Script on the Sheet adds an **"Update Commons"**
menu; choosing it sends the rows to Commons. Shape (to plan when this phase starts):
- A dedicated endpoint (an Edge Function or a narrow RPC) that does exactly one thing: **replace the
  directory's rows** in one transaction — validated (lengths, https-only links, no HTML), never touching
  anything else.
- Authenticated by a **scoped, rotatable token** kept in the script's Script Properties (not in a cell);
  rotating it is a Community-tab action. Rate-limited; every update logged (when, how many rows) and the
  previous version kept so a bad update can be undone.
- The menu shows the result ("Updated: 42 listings" / what was rejected and why), so she never wonders.
- Members-only on the Commons side; the Sheet's own sharing stays hers. Zero-PII: no "which resident
recommended this" column unless deliberately opted in; vendor business contacts are fine.
