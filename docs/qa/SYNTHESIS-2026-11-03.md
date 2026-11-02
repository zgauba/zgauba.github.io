# SYNTHESIS — 2026-11-03

> Inputs: 5 open Known Gaps (manifest), the 2026-11-02 security remediation
> record, the 2026-11-02 Commons DB schema review (landed here — it previously
> existed only in session context), the Halloween reporting retrospective, the
> foundation-PR gate residuals, and the frozen Wireframes v4.1 + Use Cases
> decision set (wireframing stage closed 2026-11-03). No formal
> `docs/qa/<feature>` audits exist yet — first ones are scheduled per-module
> below. No prior synthesis. This repo is public: operationally sensitive
> detail stays in the private ops doc; this file references it generically.

## Executive summary

The Commons rebuild has finished its decision phase (accounts, PII-posture
pivot, archive-at-close, pin-drop/directory, module set incl. Pets at
launch) and everything now funnels through one dependency: the **pre-signup
schema batch**. The roadmap is six themes: retire the Halloween season
cleanly (producing the numbers Commons will archive), ship the schema batch
as a single migration while tables are empty, put the edge gateway in front
of it, wire day-one instrumentation (the retro's core lesson), build the
modules, and clear the human-dependent launch gate — Arabic review starts
now because it has human latency, not build latency. **Approach change:**
reviews and audits land in `docs/qa/` at creation from now on; keeping the
DB review only in session memory was a single point of context loss.

## Reflection summary (Step 3)

**KG edits (applied to `docs/architecture.md` in this PR):**
- **RESOLVE KG5** — `/jubail/` stats fixed to 124 in PR #5.
- **RE-SCOPE KG2** — close-out order gains a step: record the final
  per-village split (watch the one-off "Marsa Al jubail" spelling vs
  "Marfaa Al Jubail") *before* deleting rows — it seeds the Commons
  Halloween-2026 baseline stats row.
- **ADD KG6** — the foundation migration's part-2 close function is
  **obsolete — do not apply**; rewrite against archive-at-close (2026-11-03).
- **ADD KG7** — CLAUDE.md + backlog still state the zero-PII default,
  superseded 2026-11-03; update alongside the auth PR with public disclosure.
- **ADD KG8** — JubailCommons free-tier 7-day auto-pause; resolve before invites.
- **ADD KG9** — the admin-failure counter has no reader; fold into the
  Commons Reports panel / event-day checklist.
- No merges or splits — the existing KGs were distinct and correctly scoped.

**Theme edits:** instrumentation *tables* absorbed into T2 (one migration);
T4 keeps the cron/counter/panel wiring. T5 ships per-module PRs rather than
one unit. **Approach:** input diet under-covers UX/perf/accessibility —
first formal `/qa-feature` runs per module post-ship; KG-creation rate is up
(5→8) but all new-scope, closure path named for each.

## Themes (sequenced)

| # | Theme | Closes | Size | Gate |
|---|---|---|---|---|
| T1 | Halloween season close-out & SignalPost retirement | KG2, KG4 rides, part of KG9 | S | export + village split recorded before any delete |
| T2 | Commons schema batch (one migration, empty tables) | KG6, DB-review findings, decisions set | L | database-reviewer + security-reviewer before apply |
| T3 | Edge gateway (per-IP limits on auth/admin RPCs) | security residual (rate-limit) | M | must merge before invites; tar-pit stays as depth |
| T4 | Day-one instrumentation wiring | retro lessons, KG9 | S–M | snapshot-age canary visible in Reports |
| T5 | Module builds: Events(+event-day) → Courts → Community map → Pets | wireframes/use-cases build-out | L (per-module PRs) | Playwright stub harness with first module; /qa-feature after each |
| T6 | Launch gate | KG7, KG8, policy, AR review, codes | S | all items checked before invites go to the group |

**Ordering constraints:** T1 before the baseline stats row (T6 item);
T2 before T4/T5; T3 may start parallel to T2 but merges before public
exposure; AR review (T6) **starts immediately** — human latency, async to
everything. Each theme enters `/plan-change` as one invocation (T5 per
module).

## Per-theme detail

### T1 — Halloween close-out & SignalPost retirement
Bake final dashboard numbers → export CSV → **record final per-village
split** (spelling caveat) → delete season-2026 rows (fulfils the season
promise — the one deletion the PII pivot does not cancel, because it was
promised to residents) → new season label → unschedule the snapshot cron.
KG4's dead column/function can ride. **Premortem:** deletion is
irreversible → the export + recorded split are the rollback surrogate and a
hard precondition; catalog #7 satisfied. Do **not** touch KG3 (print
button) — community consensus pending (premortem: premature cleanup).

### T2 — Commons schema batch
One migration while tables are empty: Supabase Auth linkage; homes (type,
pin, status incl. vacant, directory always-visible w/ admin suppression);
household members + invites (cap 4, then admin approval); facilities
(draft/published, location, hours, slot minutes, window); bookings
(display_name opt-in, cancel_reason) + blocks; events + signup payload
(signature-stability rule carried from jh); `jc_event_stats`;
archive-at-close function (replaces the obsolete part-2 paste — KG6);
instrumentation tables (hits, state log); secrets table with hashed
community + per-module admin codes; house-number normalization; the DB
review's structural fixes (composite FKs, village `{key,en,ar}` objects,
range/uniqueness checks, FK indexes, row-locking order in any
delete-bearing path). RLS keyed `auth.uid → home`, per-community isolation.
**Premortem:** catalog #6 is the whole theme → both reviewer gates
mandatory before apply; #5 double-booking → unique constraint + `for update`
ordering; #7 → re-runnable while empty; schema **freezes at merge** — later
changes go through `/plan-change`, no drive-by migrations (sequencing-failure
mode). Context-split mode: the plan doc may subdivide, the migration ships
as one reviewed unit.

### T3 — Edge gateway
Per-IP rate limiting in front of community-code, auth-adjacent, and admin
RPCs — the designed answer to the tar-pit's pool-exhaustion residual.
Tar-pit remains as defense-in-depth (mitigation-becomes-permanent mode:
verified it is *kept*, not removed). Merge gate: before any invite leaves
the WhatsApp group.

### T4 — Instrumentation wiring
Snapshot cron live from first deploy; hit counter writing; state-change log
consumed; Reports panel shows **last-snapshot age** as the canary (catalog
#2 — the Halloween failure was silent zero-capture; the canary makes it
visible). `created_at` surfaces in growth reporting. KG9's counter gets its
reader here.

### T5 — Module builds
Events (+ event-day kit behind per-event flags) → Courts → Community map
(incl. estimated pins once normalization exists) → Pets (owned/wanderer/
stray taxonomy). Hub, nav, My Home woven through. Playwright stub harness
stands up with the first module (test-debt mode: close it before, not
after). `/qa-feature` per module after ship feeds the next synthesis.

### T6 — Launch gate (checklist, start AR now)
Privacy policy drafted + promise rewrite across landing/CLAUDE.md/backlog
(KG7, never silent); Arabic native review — strings, name, etymologies →
feeds village glyphs (**kick off immediately**); set community + admin codes
(fresh, never the Halloween code); test the password-reset email path;
resolve free-tier auto-pause (KG8); write the Halloween-2026 baseline stats
row from T1's recorded numbers; rotate the community code at invite time.

## Deliberately not fixing

- **KG1** (historical jh_ migrations backfill) — convenience only, legacy system.
- **KG3** (print button) — parked on community consensus, by request.
- **Vision-based pin check** — geometry checks suffice at 124 homes; backlogged by decision.
- **jh_ data import into Commons** — decided against; baseline row only.
- **Public preview tier** — config flag, off for Jubail.
- **Custom SMTP** — cancelled while email verification is off; only the reset path gets tested.
- **Esri tile dependency** (catalog #4) — keyless terms could change; accepted, swap-able tile URL is a one-line config.

## KG cross-links

KG2 → T1 · KG4 → T1 · KG6 → T2 · KG7 → T6 · KG8 → T6 · KG9 → T4 ·
KG1, KG3 → deliberately open · KG5 → resolved 2026-11-02 (PR #5).
