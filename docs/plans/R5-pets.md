# R5 — Pets of Jubail: plan (`/plan-change`, 2026-11-10)

> Status: **approved 2026-11-10 (W1 = a). R5a applied 2026-11-10** (`20261110090000_r5a_pets`, 1159 checks live,
> review `docs/qa/R5a-review-2026-11-10.md`). Next: **RM renamable modules** (Zee 2026-11-10), then R5b residents. Client carry-overs from review: sighting copy says
> "within 48 h"; WhatsApp link set as an attribute with `rel="noopener noreferrer"`.

## Decisions (Zee, 2026-11-10)

- **Q1 = C** (store sightings only for missing pets + strays/community; reporter never shown, erased after 24 h; rows deleted after 30 days) **plus a configurable WhatsApp button**: a community admin enters the pets group's invite link in Organizer Tools; residents' button opens that group with the message ready (see W1).
- **Q2, Q3, Q5, Q6:** as recommended.
- **Q4:** as recommended. **The map is secondary**: List and My Pets are the module; Map is a supporting tab (last tab, can slip to its own PR without blocking launch).
- **Q7:** My Pets tab inside Pets **and** a visible entry in My Home (required, not optional).
- **Photo shrink:** confirmed as part of R5c (on-device resize before upload).

### W1 — the WhatsApp group button (verified constraints)
- WhatsApp's documented links take a draft only for a **phone number** (`wa.me/<number>?text=`) or the **chat picker** (`wa.me/?text=`). Group invite links (`chat.whatsapp.com/<code>`) open the group but **take no draft**; no supported way found to do both in one tap.
- **The invite link must never go in `jc_communities.links`**: `jc_config_get` is anon-callable and returns `links` (verified live) → anyone could join the group. Store it in a members-only place (new column or `modules.pets` config read only through an authenticated RPC); set/cleared by community or pets admins; validated `https://chat.whatsapp.com/…`.
- Options: (a) **recommended** one tap = copy the message to the clipboard + open the group, toast "Message copied — paste it in the group"; plus a small "Send to someone else" (chat picker with the draft). (b) chat picker only (draft ready, user picks the group). (c) group link only (no draft).
> Sources: ROADMAP.md §R5, concept PDF "Jubail-Pets-Concept" (Oct 2026, 6 pages), live S4 schema
> (`20261104000000_s4_pets.sql`), R4 Courts (pattern to mirror), memory: cross-module consistency.

## Step 0 — Scope & freshness

- **Tier: cross-layer.** DB (schema + RPCs + a new cron), Storage (first client use of the
  `pet-photos` bucket), client (new `pets/` page, Organizer Tools, nav, CSP), auth (pets admins).
- **Manifest:** LAST VERIFIED 2026-11-09 (1 day). Pets layer **re-queried live today** (below) — matches the repo.

## Step 1 — Inventory

| Layer | Touched? | Evidence (check that ran) |
|---|---|---|
| DB tables `jc_pets`, `jc_pet_photos`, `jc_pet_sightings`, `jc_pet_care_log` | **Yes** (Q1–Q3 change shape) | Live `count(*)` = **0 / 0 / 0 / 0**. Repo S4 migration read in full. |
| Pet RPCs (13, all `authenticated`) | **Yes**: card gains fields; new admin care / territory RPCs; sighting rules | Live `pg_proc` + `has_function_privilege`: `jc_pets_list`, `jc_pet_get`, `jc_pet_save`, `jc_pet_missing_set`, `jc_pet_archive`, `jc_pet_sighting_add`, `jc_pet_photo_begin/commit`, `jc_admin_pets_list`, `jc_admin_stray_save`, `jc_admin_pet_care_add`, `jc_admin_pet_archive`, `jc_admin_sighting_hide` |
| Admin gates | Not changed — **confirmed** | Live bodies of `jc_admin_has` / `jc_assert_admin` reference `jc_module_admins` (per-person `pets` grants accepted, R4a-3). Live `jc_module_admins where scope='pets'` = 0 |
| Module flag | **Yes (out-of-band)**: `e2e` pets → on for testing | Live: `e2e` and `jubail` both `pets.enabled = false` |
| Storage bucket + 2 policies | Not changed — **confirmed** | Live: `pet-photos` private, 2 MB, jpeg/png/webp; policies `jc_pet_photos_insert` / `_select` only |
| Cron | **Yes**: sightings retention (none exists) | `grep jc_pet_sightings` across all later migrations: **no purge**. T2 plan line 233 handed "sightings/care-log retention" to T4 — **never built**. `jc-photo-purge` exists (T4c) |
| `jc_home_vacated` / offboarding | Not changed — **confirmed** | Retires the family's pets (S4; carried through r2a/r2b_1 re-creates) |
| Snapshots | Not changed — **confirmed** | `t4a_snapshots` counts active pets per community |
| Community links (WhatsApp) | **Gap** | Live `jc_communities.links`: jubail = `halloween_archive` only; no WhatsApp link. Client: no `wa.me` / WhatsApp URL anywhere |
| Client nav | **Yes**: `page: false → true` | `assets/nav.js:13` Pets destination exists, held back |
| Strings | **Yes** (new EN + DRAFT AR) | `strings.js`: module_pets, feat_pets, cta_pets, admin scope strings exist |
| Organizer Tools | **Yes**: Pets tab; un-hide Pets on Admins screen | `admin.js:44` "pets stays off until pets has admin screens" |
| CSP | **Yes — blocker** | Page `<meta>` CSP `img-src 'self' data: <tile hosts>` — **Supabase origin missing**, so signed photo URLs would be blocked |
| Supabase JS | Not changed — **confirmed** | Vendored `supabase-2.118.0.js`, contains `createSignedUrls` |
| Map (shared) | **Maybe (Q4)** | `assets/map.js`, `mapui.css`, `jcMapRemove` shared by Events/Courts |
| Edge Functions / Resend | Not touched — confirmed | No pets email path; `jc-photo-purge` already handles pet objects |
| Paid layers | Storage/egress on Free tier only | see #3 |

## Concept vs. live schema (the real work of R5)

| Concept (PDF) | Live schema | Gap |
|---|---|---|
| 3 categories: owned · community "known & fine" · stray under care | `kind` owned \| stray; `care_state` under_care \| needs_help \| rehomed | No "known & fine" → **Q2** |
| Care record: sterilized / dewormed / vaccination / under treatment (status dots + note) | Free-text log, kinds fed / vet / note / state | No structured record → **Q3** |
| "Usual territory" (community / strays) | — | No field → **Q3** |
| Sighting = WhatsApp message, "nothing is stored here" | `jc_pet_sightings` stores reporter, note, lat/lng, **no retention** | → **Q1** |
| Map tab | Pets have no location (owned = home pin only) | → **Q4** |
| Control link, passcode viewing | Accounts replaced both | Superseded — no work |
| Carer group | Per-person `pets` admins (R4a-3), invite links | → **Q5** (confirm) |
| Missing card shows the home so finders can return it | Card hides the home for directory-hidden homes | → **Q6** |
| Owner's photo | Bucket + upload flow live, never used by a client | iPhone photos often > 2 MB; HEIC not allowed → client resize (no question) |

## Questions for Zee

**Q1 — Sightings: store or WhatsApp-only?**
- (A) WhatsApp-only, as the concept says: nothing is stored, and a button opens WhatsApp with the message pre-written. Caveat (verified behaviour of WhatsApp links): a link **cannot post into a specific group**; it opens the chat picker and the person chooses the group.
- (B) Store as today (any active pet, kept forever): no.
- **(C) Recommended:** store **only for missing pets and strays/community animals**, show the owner / carers a time + optional map spot + note, **never who reported it**. The reporter link is erased after 24 h (it's only kept for the spam caps), and the rows are deleted 30 days after the sighting. The WhatsApp share stays as a second button. Why: a missing-pet sighting buried in a busy WhatsApp group is the exact failure this feature exists to fix. Cost: a disclosed zero-PII amendment (location + time of a sighting, no identity) and one retention job.

**Q2 — "Community animal · known & fine":** recommended: add `known_fine` as a 4th `care_state` on the existing stray kind (admin-managed, no owner). The alternative is a third `kind`, which touches more checks. Either way 0 rows exist, so it's a safe swap.

**Q3 — Care record + territory:** recommended: 4 fixed items on the animal (sterilized, dewormed, vaccination, treatment), each with a status (done / due / ongoing / unknown), a date and a short note, set by pets admins. Keep the free log for history ("fed", notes). Add **usual territory** (text ≤ 120 + optional map spot) for strays and community animals. Breed and similar details go in the description, with no new field.

**Q4 — Map tab:** recommended: in R5, show **missing pets (at their home pin)**, **their recent sightings** (if Q1 = C), and **strays / community animals at their territory spot**. No "every pet's home" map: the list already shows homes, and a map of which houses have dogs adds risk without value. Alternative: no map in R5 (list only).

**Q5 — Carer group = Pets admins:** the cat-care group members get per-person Pets admin invites (same screen as Courts admins), and Pets reappears on the Admins screen. One group per community. Confirm.

**Q6 — Missing pet from a directory-hidden home:** today the card would show no home, so a finder can't bring it back. Recommended: the "mark missing" confirm says *"While Luna is missing, your home (Villa 206 · Ain Al Maha) is shown so finders can bring her back."* The home is shown only while missing, and the household opts in on every toggle. Alternative: never show it, and rely on stored sightings (Q1 = C).

**Q7 — Where "My pets" lives:** recommended: a **My Pets** tab inside Pets (mirrors Courts → My Bookings), plus a link from My Home. No question unless you want it in My Home only.

## Step 2 — Impact map

| Change | Consumers of the same code/data | Could break | Assumption → how verified |
|---|---|---|---|
| `care_state` check + `known_fine` | `jc_pet_card`, `jc_admin_stray_save`, `jc_pets_list` filters, snapshot | `strays` filter must still include known_fine (or a new `community` filter) | 0 rows (verified live) → constraint swap safe |
| New columns (territory text/lat/lng, `care` jsonb) | `jc_pet_card` (residents + admins), `jc_pet_retire` (archived rows must clear nothing extra), archive check constraint | Card shape grows → both read paths (`jc_pets_list`, `jc_pet_get`) and `jc_admin_pets_list` | Additive keys; no client exists yet → no old reader |
| Sighting rules (Q1 C) | `jc_pet_get` (who sees sightings), `jc_admin_sighting_hide`, `jc_admin_pets_list.sightings_7d`, rate caps (need `reporter` for 24 h) | Caps break if reporter erased too early; `by_me` flag disappears after 24 h | Caps look back exactly 1 day → erase after 24 h keeps them exact (SQL test) |
| Retention cron | `cron.job`, `jc_maintenance_status`, `jc_state_log` | Silent no-run | Log `pets_purge` like `courts_purge`; add to maintenance status |
| Missing shows hidden home (Q6) | `jc_pet_card` home rule; directory suppression promise (R1 "hidden households") | Leaks a hidden home without consent | Shown only while `missing = true` AND the household opted in, stored server-side (`missing_show_home`). `jc_pet_missing_set`'s signature stays frozen (signup-class discipline), so the opt-in goes through a new follow-up RPC |
| CSP `img-src` + Supabase origin | `pets/`, `admin/` pages only | Other pages unchanged | grep meta CSP per page |
| Nav `page: true` | Bar, start page, Settings (R3a) | Pets appears only where flag on — `e2e` after flip; Jubail stays off | `nav.js` registry re-checks flags each render |
| Organizer Tools Pets tab | `ADM_TABS` registry, `canEnter()` (pets admins), Admins screen | Pets-only admins entering Organizer Tools see other tabs? | R4b-1 widened `canEnter` per scope — same pattern |
| Photo upload | Storage policies, `jc-photo-purge`, 1 GB quota | Oversize/HEIC refusals; EXIF rotation | Client resize to ≤ 1280 px JPEG ~0.8 (≈150–300 KB) |

## Step 3 — Regression surface (must keep working)

- Events: list, map, event-night acts, organizer tools — unchanged (shared map/tab code reused, not edited).
- Courts: book / cancel / My Bookings / Past; Organizer Tools → Courts + Day view.
- Admins screen: community / events / courts levels; invite links; LAST_ADMIN.
- Leaving a home / removing a member / deleting an account → that family's pets archived + photos retired (S4).
- Bar + start page + Settings: Pets offered only where the flag is on; saved bars with Pets survive flag flips (R4 C3).
- Hourly snapshot pets row; `jc-photo-purge` daily; App Health maintenance status.
- Jubail sees no Pets anywhere (flag off).

## Step 4 — Proposal (split: >2 layers + migration ⇒ 4 PRs)

| PR | What | Verification tier | Size |
|---|---|---|---|
| **R5a — DB** (`/db-rehearse`) | members-only pets WhatsApp group link (set / clear / read RPCs, W1); Q2 known_fine; Q3 care record + territory + admin RPCs; Q1 sighting rules + 24 h reporter erase + 30-day delete cron (`jc-pets-purge`, logged, in maintenance status); Q6 missing-home RPC; card fields; SQL slice s21 | Data / PII: full rigor (database + security reviews, suite ×2, apply only on "apply") | ~250 SQL + ~120 tests |
| **R5b — Residents** | New `commons/pets/`: List (missing on top, filters) · Map (Q4) · My Pets; pet page per category; add / edit / archive; missing switch with confirm; sighting + WhatsApp share; nav `page: true`; `e2e` pets flag on (out-of-band, recorded); EN + DRAFT AR | Screen logic + security (PII rules) | ~450 client, ~200 e2e — **over 200 LOC**: one screen family, same as R4c; split R5b-1 (list/page/my pets) and R5b-2 (map) if it runs long |
| **R5c — Photos** | Resize on device (≤ 1280 px JPEG, EXIF-rotated), begin → upload → commit, signed URLs (short TTL, cached per page view), species-icon fallback; CSP `img-src` + Supabase origin on pets/admin | Screen logic + security (Storage) | ~180 client, ~80 e2e |
| **R5d — Organizer Tools → Pets** | Strays / community animals: add / edit / territory / care record / care log; archive with reason; hide a sighting; un-hide Pets on Admins | Screen logic + security | ~350 client, ~150 e2e |

Order: R5a → R5b → R5c → R5d (R5d may run before R5c; **never in parallel with R5b**: both touch `strings.js`, per the no-parallel rule).

- **Cost:** no paid API. Storage: worst case 124 homes × 10 pets × 300 KB ≈ 370 MB (< 1 GB Free). Egress: a list view lazy-loads ~10 photos ≈ 2–3 MB; at 5 GB/month that's ~2,000 views. Fine pre-launch; watch at launch (R7 Pro decision already planned).
- **Migration:** yes (R5a). 0 rows, so no backfill. One new cron.
- **Out-of-band:** `e2e` pets flag on (record in manifest, like bookings).

## Step 5 — Premortem (§0.5)

| # | Exposed? | Mitigation |
|---|---|---|
| 1 Silent corruption | **Yes**: a resized photo comes out sideways or blank; commit only checks size metadata exists | Rotate via `createImageBitmap(..., {imageOrientation:'from-image'})`; refuse blobs < 1 KB client-side; e2e upload asserts rendered image; real-iPhone check in R8 list |
| 2 Silent zero-output | **Yes**: retention cron never runs; signed URLs fail → blank photos | Cron logs `pets_purge` + appears in `jc_maintenance_status` (App Health flags a stale run); photo failure shows the species icon **and** the e2e asserts the `<img>` actually loads |
| 2b Config drift | **Yes**: CSP is copied per page (meta), the `e2e` flag is set by hand, `page:false` is hand-flipped | e2e loads a photo on pets **and** admin pages (fails if a CSP copy is missed); flag state recorded in manifest; test asserts Pets hidden while flag off |
| 3 Cost | Low | Numbers above; resize caps object size |
| 4 Contract drift | Low: supabase-js pinned 2.118.0 (vendored) | — |
| 5 Race | Two household members edit/upload: `PHOTO_PENDING` 60 s guard exists; double-tap missing (Zee's mirror extension) is idempotent | Busy-lock buttons while sending (house pattern) |
| 6 Auth / RLS | **Yes**: sightings visibility, hidden-home exposure (Q6), new admin RPCs | Security review on R5a + R5b; SQL tests: residents never see `reporter`; owned-pet sightings only to household + pets admins; hidden home only while missing + opted in; new RPCs `jc_assert_admin('pets')`; grants file updated |
| 7 Rollback | Client: `git revert`. DB: flag off = kill switch (every pet RPC raises `MODULE_OFF`); migration down notes in header (constraint back, drop columns — 0 rows pre-launch) | Can't un-delete purged sightings (by design) |

## Step 6 — Executive summary

**What this change does:** builds the Pets directory on the database that has existed since early November: residents list their pets and can raise a "missing" alarm, the cat-care group keeps records for strays and community animals, and the old concept is brought in line with how Commons works now.
**Biggest risk:** privacy creep. Sightings (where and when an animal was seen) and showing a hidden home while a pet is missing are both new disclosures, so each needs your explicit yes, a retention limit and a security review.
**Recommended next step:** answer Q1–Q7 (or "agree with all recommendations"). Then R5a (database) gets built and rehearsed, and stops before applying.
