# SYNTHESIS — 2026-11-06

> Inputs: the 33 review files in `docs/qa/` written since `SYNTHESIS-2026-11-03.md` (T3 → T5.2 hardening),
> the 8 open Known Gaps in `docs/architecture.md` (KG 1, 3, 7, 8, 11, 13, 14 + the drift notes in the
> layers), and `docs/plans/ROADMAP.md` (the plan of record, R1–R8). Manifest LAST VERIFIED 2026-11-06 (fresh).
> Every "deferred to PR X" item was checked against the code before being counted as open.
> This repo is public: nothing here names codes, residents or ops detail.

## Executive summary

The 33 reviews hold ~200 finding rows. **Almost all were fixed in the PR that found them.** The residue is small:
**17 findings still open**, plus 7 open Known Gaps. Nothing open is High. The residue clusters into six themes.
Each one rides an existing roadmap phase that already touches the same code, so **no new phase is added**.
The roadmap's order stays R1 → R8. Two items are added to R2, an accessibility pass is added to R3, a
WebKit (iPhone engine) test lane goes in front of R1, and R7 gets a structural audit.
R8 gets an explicit, enumerated verification run in place of "check everything".

**Approach change:** the last synthesis committed to a `/qa-feature` audit per module after it ships. **None has
run.** Every input this cycle is a diff-scoped PR review, and those can't see flows that span PRs. The missed
ones show it: the organizer can move a household's pin but the household is never told, and a no-show's place
can't be freed. Fix: a `/qa-feature` on Events runs before R2 is planned. The same rule applies after each
later module.

## Reflection summary (Step 3)

**KG edits (applied to `docs/architecture.md` in this PR):**
- **RESOLVE KG13** (reviews not persisted). CI `review-saved.yml` has enforced it since T5.2, and all 28 reviews
  since then landed on their PR branch.
- **RE-SCOPE KG8** (free-tier auto-pause) → **free-tier envelope**. It now also covers event-night egress
  (5b measured ≈ 0.5 GB per event night; the plan's allowance was never verified) and the canary workflow's
  60-day auto-disable. One decision (stay free vs. upgrade) settles most of it.
- **RE-SCOPE KG11** (manual pre-launch checks). It now lists every manual check a review deferred to it, with
  sources: T3 advisory lock, PR A link-cap + accept-vs-close races, 3b capacity concurrency (needed **before
  the first capacity event**, not just before launch), the Storage smoke test, and real-iPhone checks.
- **RE-SCOPE KG14** (platform defaults bypass the grant model). It gains the 3a note (`jc_assert_admin`
  doesn't re-check the grant's community; safe via the foreign key) and the T5.3 note (Resend auth header sits
  in `net.http_request_queue`). Both were already parked "for the structural audit".
- **ADD KG15**: Auth dashboard drift. Email confirmation has been ON since 2026-11-03 against the decision. Rate
  limits are unrecorded and anonymous sign-ins are unverified. It was only an inline ⚠ in the Auth layer, not
  a tracked gap.
- **ADD KG16**: event titles / descriptions aren't cleaned server-side (`jc_clean_text`). Defence is client-only
  (`esc()` everywhere; `jcRich` strips bidi overrides). The writer pool widened with per-event admins (PR A #8).
- **ADD KG17**: the e2e suite runs Chromium only. iPhone-Safari-only bugs pass CI. There are three precedents:
  the event-fold viewport #1/#2 and the editor date spill (map-buttons #3, which "passes without the fix").
- **Manifest drift fixed inline:** the personal-pages ⚠ "`/jubail/` says 122 homes" is stale. The live page
  says 124 (KG5, resolved 2026-11-02).
- No merges or splits. The open KGs are distinct.

**Theme edits (3b):**
- **ABSORB** "server-side text hygiene" (KG16) into the R2 migration. It's one function call in the events
  save path, not a theme.
- **ADD** an accessibility theme. The input diet has **zero** a11y coverage: one deferred finding (polish #6,
  tab ARIA) and no audit. It rides R3 because R3 rebuilds the tab bar and nav it would touch.
- **ADD** the WebKit test lane. It is a test-debt theme visible only across reviews (KG17).
- **RE-SEQUENCE:** the structural audit (KG14) moves from "before invites" to **after the last migration
  (R6), inside R7**, so it audits the final schema once instead of twice.
- Nothing retired.

**Approach (3c):**
- **Ratio:** over 90% of findings were fixed inline. The deferred residue is 17 findings, split ≈ 6 hardening,
  6 user-facing, 5 verification. That's healthy. Hardening isn't piling up.
- **Cadence:** 33 review files in 4 days. Micro-PRs (5a → 5a.1 → 5b → 5b.1 → 5b.2) each pay the review tax. That's
  acceptable, because self-check files for CSS-only PRs keep it cheap. No change.
- **Diet:** under-covered are **cross-PR flows** (no `/qa-feature` ran), **accessibility** (none), **iPhone
  Safari** (Zee's phone found what CI couldn't), and **Arabic** (every AR string is DRAFT).
- **Trajectory:** since the last synthesis 4 KGs were closed (6, 9, 10, 12) and 2 added (13, 14). This pass
  closes 1 and adds 3, so 9 are open. **Risk: closure is back-loaded into R7/R8.** Mitigation: KG17 closes first,
  and KG16 closes in R2.
- **Sequencing principle:** the roadmap's product order still governs. Deferred findings follow a **ride-along**
  rule: each one ships with the phase that already touches its code. No standalone cleanup phase.
- **User signal:** KG13 (reviews missed twice) is now solved by CI. Zee's on-phone testing found ~10 issues
  the suite didn't, which is the WebKit lane's justification.

## Themes (sequenced)

| # | Theme | Rides | Closes | Size | Gate |
|---|---|---|---|---|---|
| S1 | WebKit (iPhone engine) e2e lane | before R1 | KG17; event-fold #1/#2, map-buttons #3 class | S | starts non-blocking; blocking once green ×2 |
| S2 | Organizer acts → household knows (events loop) | R2 | 3b #9 + PR 4 (free a no-show's place), 3a Low (pin moved, household not told), KG16 (PR A #8), R2's "mark a home out" | S–M (one migration) | `/qa-feature` Events **before** `/plan-change` R2; `/db-rehearse` |
| S3 | Accessibility pass on the shell | R3 | polish #6 (tab ARIA / focus); first a11y audit | S | `design:accessibility-review` on hub, events, My Home, Organizer Tools |
| S4 | Grant-model structural audit | R7 (after R6) | KG14 incl. 3a info, T4 service_role default, T5.3 S4 | M (audit) + S (fixes) | runs after the last migration; findings → one hardening migration |
| S5 | Free-tier envelope + event-night load | R7 decision → R8 | KG8 (re-scoped: auto-pause, egress, canary 60-day), tile provider, Resend key | S (decision-heavy) | **Zee decision:** stay free or upgrade, before R8 |
| S6 | Launch verification run | R8 | KG11 (re-scoped), KG15, AR DRAFT strings (2c, PR 4, all PRs), `_headers` + real-iPhone checks | S (human time) | every line ticked with date + who |

## Per-theme detail

### S1 — WebKit e2e lane (before R1)
**Pattern:** three shipped bugs were iOS-Safari-only, and the suite runs Chromium. Phones are the primary
device. **Shape:** add a Playwright `webkit` project (WebKit ≈ Safari's engine, not identical). Run it
non-blocking in CI until it is green twice, then make it blocking. **Why first:** it's cheap, and R1–R3 are
all screen work. R3 (`Save as an app`, iOS storage split) needs it most.
**Premortem:** *cost blowout*: WebKit may expose a pile of Leaflet-timing flakes. Cap: one PR; flakes beyond
it become their own test-only PR, not R1 scope. *False assurance*: WebKit on Linux isn't iPhone Safari.
Real-device checks stay in S6.

### S2 — Organizer acts → household knows (R2)
**Pattern:** organizer actions on a household's entry are logged but not surfaced to the household, and the
one action organizers asked for (free a no-show's place) doesn't exist. **Adds to R2:** (a) organizer
withdraw / free a place, a new RPC (hidden sign-ups hold their place today; Zee deferred it to a DB PR);
(b) when an organizer moves a household's pin, My Sign-Up says "adjusted by an organizer" (the
optional organizer note exists; the automatic line doesn't); (c) `jc_clean_text` on event title / description
in `jc_admin_event_save` (KG16); (d) R2's existing "mark a home out" follows the same told-and-logged rule.
**Precondition:** `/qa-feature` Events (organizer + event-day flows) first. It is the missing cross-PR audit
and may add to this list.
**Premortem:** *contract drift*: never change `jc_entry_live_set` / `jc_event_signup` signatures; new RPCs only.
*Sequencing*: KG16 cleaning must not alter already-stored text (apply on write only).
*Privacy*: the "adjusted" line names no organizer.

### S3 — Accessibility pass (R3)
**Pattern:** the input diet has never covered a11y. The one finding (role=tab without tabpanel / arrow keys;
focus lost on re-render) sits in code R3 rebuilds anyway (tab bar, sub-tabs, start page). **Shape:** run
`design:accessibility-review` on the four main screens, fix inside R3's PRs, and add axe-style assertions
to e2e where cheap. **Premortem:** *premature cleanup*: R3 rewrites the nav, so fixing ARIA before R3 would
be thrown away. Hence it rides R3, not earlier.

### S4 — Grant-model structural audit (R7)
**Pattern:** Supabase platform defaults keep re-granting (service_role EXECUTE on every new function; anon
SELECT on `net.*`; `CREATE EXTENSION` re-runs grants). Defence today = schema exposure + canary + pins
G16–G18. **Shape:** `/structural-audit` over `supabase/commons/` after R6's migration (the last one), then
one hardening migration through `/db-rehearse`. Include `jc_assert_admin`'s community re-check.
**Premortem:** *sequencing failure*: auditing before R4–R6 would miss their new functions, so it goes last.
*Cost*: workflow-scale. Size it before running (explicit opt-in).

### S5 — Free-tier envelope (decision in R7, done by R8)
> **Corrected 2026-11-06 (Supabase pricing, same day):** egress is *not* a constraint — Free includes 5 GB
> (+ 5 GB cached), ≈ 10 event nights. The deciding gap is **no automatic backups on Free**; leaked-password
> protection is Pro-only. Recommendation: Pro at R8 ($25/month; $35 if SignalPost stays in the org), spend cap on.
> Original text below.
**Pattern:** five separate items all hinge on free-tier limits: 7-day auto-pause (KG8), event-night egress
(≈ 0.5 GB/night estimated in 5b, allowance unverified), OSM tiles with no SLA, the canary's 60-day
auto-disable, and the Resend key still unset (feedback email inactive). **Shape:** Zee checks the Supabase
plan's egress line and decides stay free or upgrade. A paid plan removes auto-pause and egress worry in
one move and turns "cost-bearing layers: none" into one. Tile provider is chosen in the same sitting.
**Premortem:** *cost blowout* is the theme itself. The decision is reversible month to month.
*Mitigation-becomes-permanent*: a keep-alive ping instead of upgrading would need its own canary.

### S6 — Launch verification run (R8)
**Pattern:** everything one rolled-back SQL transaction or Chromium can't prove. **Checklist** (KG11 + KG15):
two-tab concurrency (T3 lock, PR A link cap + accept/close, 3b capacity; **3b before the first capacity
event**), Storage smoke test with a real JWT, Auth dashboard (email confirmation OFF, leaked-password ON,
anonymous sign-ins OFF, rate limits recorded + raised, Site URL / redirects), `curl -sI commons.ae` framing
headers, real-iPhone pass (date fields, Save as an app), native Arabic review of every DRAFT string, and the
password-reset email end to end. **Premortem:** *rollback path*: each item is reversible except invites going
out. They go last, after every line is ticked.

## Deliberately not fixing

- **KG1** jh_ migration backfill: legacy, convenience only.
- **KG3** print button: parked on community consensus, by request.
- **PR 2b**: API-written schemas without English labels can't be re-saved. The builder is the only writer.
- **2c #2 / 3b #11**: kind lock counts withdrawn sign-ups. Intended; the server explains.
- **2c #9**: `GRANT` concatenated into `next`. It's regex-limited and not exploitable.
- **3a**: admin log keeps coordinates after a household leaves. Admin-only, and pins are visible anyway.
- **3b #10**: list vs. event counts reveal *how many* sign-ups were moderated, never which.
- **5a C3/C4, 5a.1 C2**: ring colours repeat after 6 choices. No template uses more than 3.
- **5b.2 F3**: "Almost out" lights one bar. It's intended, battery-style.
- **PR B #6, #10, #11**: revoked admin keeps the UI until the first refusal; grant link across devices; token in
  history. All are single use with 72 h expiry and server-enforced.
- **T3**: fixed-window 2× burst; stale `jc_rate` rows. Bounded.
- **Visited R2**: a previous community's name flashes for a moment. Rare.
- **PR B #9 (event title before accepting a grant)**: nice-to-have. The accept screen already states the role.
- **`docs/plans/backlog.md` grooming**: the roadmap supersedes it (the file says so). Not worth a pass.

## KG cross-links

KG7 → R8 (privacy policy; never silent) · KG8 → S5 · KG11 → S6 · KG13 → resolved · KG14 → S4 ·
KG15 → S6 · KG16 → S2 · KG17 → S1 · KG1, KG3 → deliberately open.

**Confidence 0.8.** Coverage is complete (all 33 files read; deferrals checked against code). The main
uncertainty was the egress number. The plan allowance has since been checked (5 GB on Free) and egress is not
a constraint; the per-night figure is still an estimate from one payload measurement.
