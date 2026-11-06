# Jubail Commons — roadmap to launch

> **The plan of record (2026-11-06).** Synthesized from: Zee's ideas summary (Oct 4 – Nov 6 planning
> conversations, `commons-ideas-summary.md`, shared 2026-11-06), `docs/plans/backlog.md`, the T2–T5 plans,
> `docs/qa/SYNTHESIS-2026-11-03.md` (T6 launch gate) and Zee's decisions in session. **When this file and
> another plan disagree, this file wins; when this file and live infra disagree, live wins — fix this file.**
> The private Ops Reference still holds community context, contacts and codes (never this repo).
> Next check: a `/synthesize-audits` pass to fold every "deferred" review finding (`docs/qa/`) and Known Gap
> into the phases below.

## The launch rule

**No launch to residents until the full app is built** — Events, Courts, Pets, The Community, the
pre-launch phases below — and the launch gate (R8) passes. The launch gate is the **last** step.
The `e2e` test community stays the place to try everything; Jubail's modules stay OFF until R8.

## Done (as of 2026-11-06)

| Phase | What shipped |
|---|---|
| T1–T4 | Halloween close-out + baseline (124 homes); Commons schema for every module (identity/homes, events, courts, pets) — RPC-only, RLS deny-all; rate limits; snapshots, state-change log, visit counter, health probe, cleanup jobs, canary |
| T5.0–T5.1 | Accounts (email + password + reset), join code, home claim + required pin, household invites, tab bar, hub, auto-update; Events for residents with Halloween parity |
| T5.2 | Organizer Tools (templates, question builder, kinds homes / one place, looks, sign-ups tab, pin moves, banner, CSV, per-event admins), event looks + pins, **event day** (two-sided switch, supply gauge, crowd reports + "We're Not Out", 2-min refresh), App Health & Notices, page help "?", Organizer Tools sub-menu, event Admin button, DB hardening |
| T5.3–T5.4 | Feedback to the platform owner (email via Resend); Coming Soon stage |

Detail: `docs/architecture.md` (Stack Manifest) and the reviews in `docs/qa/`.

## Pre-launch phases (in order)

Each phase ships as one or more PRs through `/plan-change` → `/ship-pr` (and `/db-rehearse` when it has a
migration). "DB" = needs a migration.

### R1 — Households (Organizer Tools → Community)  ·  app only
Community admins have database functions for homes but **no screen** — and invite requests over a
household's member limit currently have nowhere to go.
- Households list by village: home label, pin status, members (display name or masked email — never the
  full address), hidden-from-directory flag, pin flags; per-village counts (adoption).
- **Pending invites over the limit → Approve / Decline** (`jc_admin_invite_decide`).
- Fix a home's village / type / number (`jc_admin_home_edit`); hide / show in the directory
  (`jc_admin_home_suppress`); remove a member, optionally deleting the account (`jc_admin_member_remove`).
- Admin log (`jc_admin_log_list`); links from App Health notices ("household left", "pin far away") to the home.
- Verify each RPC's live shape before building (they date from S1, never exercised by a screen).

### R2 — Event-night extras  ·  DB (one small migration)
- **Organizer marks a home out** (Zee 2026-11-06: yes) — organizers + that event's admins set a home's
  live state / supply on event night; admin-logged; the household sees it on My Sign-Up. New RPC (never
  change `jc_entry_live_set`'s signature).
- **Per-event safety block** — community security number + agreed lost-child meeting point, set in the
  editor (`jc_events.safety` + the `safety` feature flag already exist); shown on the event page.
  Stores nothing about people; children are never named or matched to homes.

### R3 — App shell: your navigation, your start page, "Save as an app"  ·  app only
- **Settings (My Home → Account):** choose which buttons appear in the bottom bar and their order
  (My Home always stays — Settings lives there); choose the **start page** the app opens on. Saved to the
  account (`jc_accounts.prefs` via `jc_prefs_set`, ≤ 2 KB — exists, unused), so it follows the person
  across phones. Modules that are off for the community never appear.
- **"Save as an app":** web manifest + icons + iOS meta. Gotcha: iOS home-screen apps keep separate
  storage from Safari (sign in again once) and bake in the name at install.

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

### R5 — Pets of Jubail  ·  app (+ small DB if the sightings decision changes)
Schema exists (S4: pets, photos, care log, sightings, missing). Concept: canvas "Jubail Pets Concept" + PDF.
- Directory: **owned** · **community "known & fine"** · **stray under care** (care record: sterilized,
  dewormed, vaccination, under treatment — kept by the carer group).
- Photo, name, species, home. No owner names or phones. Members only (accounts replaced the old
  "viewing passcode" idea).
- **Missing** toggle: card turns red, tops the list.
- Never collects money.
- **Decide before building:** the ideas say "report a sighting only pre-fills a WhatsApp message — nothing
  stored", but the schema **stores** sightings (`jc_pet_sightings`: reporter, note, location). Keep the
  stored version (useful for a missing pet's trail; reporter never shown) or drop to WhatsApp-only?
- Carer-group access: "one shared link" in the ideas → in Commons terms a per-group admin grant (like
  per-event admins). Confirm.

### R6 — The Community: map + directory  ·  app (+ DB if needed)
- Find any villa on the island and get directions (`jc_directory_list` exists; hidden homes stay hidden).
- Optional per-home extras stay opt-in (zero-PII default).

### R7 — Launch prep (not features)
- **Retire the shared `events` organizer code** (Step C, parked until testing is done) → per-event admins only.
- **Retire the Halloween site** into Commons (`jubail-halloween/` stays at its URL forever — a pointer page).
- Per-community split of App Health's platform numbers (needed before a second community admin exists).
- Teardown of `e2e` test data when Zee says testing is done.

### R8 — Launch gate (last)
From `docs/qa/SYNTHESIS-2026-11-03.md` T6, plus items found since:
- Privacy policy + the promise rewritten everywhere it appears (never silent).
- Native Arabic review (strings; **Haq al Laila wording + design by an Emirati speaker**).
- Fresh Jubail codes (join, community admin) — never the Halloween code; rotate at invite time.
- Password-reset email tested end to end.
- Free-tier auto-pause resolved.
- **Map tile provider** chosen for event-night load (OSM's volunteer tiles have no SLA; Esri imagery date
  over Jubail unverified).
- Supabase dashboard: **email confirmation OFF** (drift: still on), **leaked-password protection ON**,
  Auth rate limits raised for the invite burst, Site URL + redirect allowlist for commons.ae.
- Jubail modules switched on one at a time; invites go out.

## After launch

- **Recommendations directory** (neighbor's vendor list, today on Wix Spaces) — in discussion; needs the
  right controls for her. See "Recommendations: where the data lives" below.
- **Suggested walking route** (nearest-neighbor + 2-opt loop over stocked homes; `route` flag off) and
  **kilometers walked** (on-device only, "at least X km", nothing sent).
- December **holiday-lights map** (a homes event with its own look).
- **Second community / B2B** — trigger: a second community asks. Needs the platform console + per-community
  numbers (R7).
- **Print maps** — parked on community privacy consensus; never re-enable without Zee.

## Event calendar vs the launch rule — DECISION NEEDED

**Haq al Laila ≈ Sat 23 Jan 2027** (15 Sha'ban 1448, ±1 day on moon sighting). If the full app isn't
launched by then, either (a) run Haq al Laila on Commons as a **single-module early opening** (Events only),
(b) run it outside Commons (as Halloween was), or (c) skip it this year. Needs Zee's call by early
December so the event + native review can be prepared.

## Decisions (2026-11-06)

- Launch only when the full app is built; launch gate last.
- Recovery PIN: **dropped** (accounts use email + password + reset email).
- Organizers / event admins **can mark a home out** on event night (R2).
- Recommendations directory: **not before launch**.
- Walking route + km walked: **after launch**.
- Courts: tennis + basketball, no padel; households book; no outside coaches; community admins add courts
  + locations.
- Navigation: users choose bottom-bar buttons + start page (R3).

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

## Recommendations: where the data lives (options for the post-launch directory)

Zee's question: could the database be a Google Sheet she edits?

| Option | For | Against |
|---|---|---|
| **A. Google Sheet → Commons sync** (she edits a Sheet; a scheduled job copies it, validated, into a `jc_` table; the app reads only Commons) | She already knows spreadsheets; Google's sharing + version history; the app stays members-only and escapes / validates everything | Needs a sync job (pg_cron + pg_net, like the feedback email) and a published-CSV or service-account read; a bad edit shows up after the next sync; "who can edit" lives in Google, outside Commons' admin log |
| B. App reads the Sheet directly (published to web) | Simplest | **The list becomes public to anyone with the link** (not members-only); no validation; Google outages / rate limits hit residents directly — not recommended |
| C. In-app editor + a "directory editor" grant (like per-event admins) | Members-only, validated, logged, one system | Most work; she learns a new tool |
| D. Wix stays the source, Commons mirrors it | No change for her | Needs her content in a Wix CMS collection + API access on her plan (unverified); the access problems residents have today stay |

**Recommendation:** start with **A** (her comfort, Commons controls what residents see), keep the table
shape compatible with **C** so it can become an in-app editor later. Zero-PII: no "which resident
recommended this" column unless deliberately opted in; vendor business contacts are fine.
