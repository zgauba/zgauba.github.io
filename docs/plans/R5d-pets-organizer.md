# R5d — Organizer Tools → Pets: plan (`/plan-change`, 2026-11-14)

> Status: **approved 2026-11-14** — Zee: Q1 = A (Organizer Tools), Q2 = yes, Q3 = yes; plus **Banner is the last Organizer Tools tab** (Events · Courts · Pets · Community · Banner), done in R5d-1. Parent plan: `R5-pets.md` row R5d. Organizer order: `nearest-first.md` NF-3 (Zee 2026-11-14).

## Step 0 — Scope and freshness

- **Tier: cross-layer, client only.**
  - Organizer Tools (a new tab, the Admins screen, who may enter), the Pets page (an Admin way in), a shared photo helper, and the CSP of the Organizer Tools page.
  - No database change. Every server function R5d needs already exists and is live (below).
- **Manifest:** LAST VERIFIED 2026-11-14 (today, NF-1 apply). The Pets layer was read from the repo migrations this session. No live re-query was needed: no `[live]` layer changes.

## Step 1 — Inventory

| Layer | Touched? | Evidence (check that ran) |
|---|---|---|
| Admin RPCs | **Used, not changed** | Latest definitions read: `jc_admin_pets_list()` (S4: every pet incl. archived, `jc_pet_card` + status, dates, `sightings_7d`), `jc_admin_stray_save(p_pet, p_fields)` (R5a: species, name, description, care_state, territory, territory_lat/lng), `jc_admin_pet_care_set(p_pet, p_item, p_status, p_date, p_note)` (R5a), `jc_admin_pet_care_add(p_pet, p_kind, p_note)` (S4: fed / vet / note / state), `jc_admin_pet_archive(p_pet, p_reason)` (S4: any pet, reason 3–200, logged), `jc_admin_sighting_hide(p_sighting)` (S4, logged), `jc_admin_pets_group_set(p_link)` (R5a, `chat.whatsapp.com` only, logged as a fingerprint). All `jc_assert_admin('pets')`, so pets **or** community admins. |
| Photos for strays | **Used, not changed** | `jc_pet_photo_begin` / `_commit` / `_remove` go through `jc_pet_manage`: owned = the household; stray = `jc_assert_admin('pets')`. So pets admins can already set a stray's photo. |
| Reads | **Used, not changed** | `jc_pet_get` returns sighting **ids** and the care log. `jc_pet_sight_from` gives pets admins every sighting (`jc_admin_has('pets')`). `jc_pets_group_get` returns the link to any member while Pets is on. |
| Database / cron / Storage / Edge | Not touched | No migration in this plan. Storage policies unchanged: uploads go through the same begin/commit RPCs. |
| Organizer Tools tabs | **Yes** | `admin.js:84` `ADM_TABS` (events · banner · courts · community); `admin.js:192` `canEnter()` has no `pets`; `admin.js:45` `AD_SCOPES` leaves pets off "until pets has admin screens"; `admin.js:2165` invite-accepted fallback for pets. |
| Admin log labels | **Yes** | `admin.js:1140` `LOG_KEYS` has no pet actions, so they show as "other: pet_archive". |
| Organizer Tools CSP | **Yes, blocker for photos** | `admin/index.html` `img-src` lacks the signed `pet-photos` origin. `pets/index.html` has it. |
| Pets page | **Yes** (small) | `pets.js`: the care record, the care log, sightings and the Strays map exist read-only. No admin controls; no "Admin" way into Organizer Tools (Courts cards and the court page have one: `bookings.js` `canAdmin` / `adminHref`). |
| Shared map kit | **Reused** | `jcPinPickerHtml(..., "vpin")` + `jcPinPicker` (the organizer venue pin, `admin.js:2242`) for the territory spot. |
| Photo code | **Yes (extract)** | `pets.js:143–240`: `shrinkPhoto`, `uploadPhoto`, signed-URL cache, `photoHtml` / `fillPhotos`. These exist only in `pets.js`. |
| Strings | **Yes** | EN + draft AR for the tab, editor, care, log, archive, link, log labels. |
| Tests | **Yes** | `admin.spec.js:899` already has a pets-only admin persona (`adminBackend({ scopes: ["pets"] })`); `backends.js` `petsBackend`. |
| Paid layers | Not touched | No API calls. Storage egress: organizer views load the same small photos. |

## Step 1b — Prior art

| Building block | Existing version | Decision |
|---|---|---|
| Organizer tab + panel | `ADM_TABS` + `jcTabsHtml` (Courts tab, R4b) | **REUSE**: one `ADM_TABS` entry, `show: isPetsAdmin` |
| Organizer list rows (chips, acts row of `mini` buttons) | `courtRow` (`admin.js`) | **REUSE** the markup pattern + `sulist` CSS |
| List order | NF-3 `jcVillageCmp` / A–Z | **REUSE**: strays first (no village, as "Whole community" is first for courts), then villages A–Z by the owner's home, then name |
| Editor form (fields, Save / Cancel, only-changed-fields sent) | Court editor (`ct` views, `admin.js`) | **REUSE** the pattern |
| Territory spot picker | `jcPinPickerHtml("vmap", "vpin")` venue pin | **REUSE** |
| Photo shrink / upload / signed URLs / tile | `pets.js` only | **EXTRACT** into `assets/photo.js`, used by Pets and Organizer Tools |
| Care record display | `pets.js careHtml` | **REUSE** the look; the editor is NEW (4 rows × status select + date + note) |
| Confirm with a typed reason | Event cancel / remove with reason (`admin.js` organizer acts, R2b-1) | **REUSE** |
| "Admin" way in from the resident page | Courts card badge + court page `#bkAdmin` → `../admin/?tab=courts&court=` | **REUSE**: `../admin/?tab=pets&pet=<id>` |
| Admins screen level | `AD_SCOPES` (community / events / bookings) | **REUSE**: add `pets` |
| Busy lock, one write at a time | `hhBusy` / `ctBusy` pattern | **REUSE** |

## Questions for Zee

**Q1 — Where organizers edit animals.**
- **(A) Recommended: in Organizer Tools → Pets**, as Courts and Events do. The Pets page gets the same **Admin** button that court cards have, leading to that animal in Organizer Tools. Cost: the photo code moves into one shared file, and Organizer Tools gets the photo address in its security header.
- (B) On the Pets page itself: Edit / Care / Archive buttons appear on an animal's page for pets admins. This is smaller (the pet form and photo code are already there), but it is the one module edited somewhere other than Organizer Tools. You flagged that kind of difference twice.

**Q2 — Can organizers archive a household's own pet** (not just strays)? The server already allows it, with a reason, and logs it. Recommended: **yes, as moderation** (a wrong photo, a joke entry, a pet that has passed and the family left). The confirm names the household and says they'll no longer see it. The household gets no message; there's no notification system.

**Q3 — Archived animals.** There is no "restore" on the server, and the reason lives only in the admin log. Recommended: Organizer Tools shows an **Archived (n)** group with names, read-only. The reason shows in the admin log, which now names pet actions. A restore would be a database change: not now.

## Step 2 — Impact map

| Change | Who else uses it | Could break | Assumption → how verified |
|---|---|---|---|
| `canEnter()` + `has("pets")` | Every Organizer Tools entry, the invite-accept flow (`admin.js:2165`) | A pets-only admin sees tabs they can't use | Each tab's `show()` is per-scope (Courts precedent R4b-1); e2e with a pets-only persona sees only Pets + Community |
| `AD_SCOPES` + `pets` | Admins screen lists / invites / Remove; `LAST_ADMIN` rule | A pets level with no admins renders oddly | The server already lists pets (`jc_module_admins_list`); e2e invite + remove at the pets level |
| Photo code → `assets/photo.js` | Pets list, pet page, edit form, My Pets | Photos stop loading or uploading on the Pets page | Existing pets.spec photo tests (upload, signed URL retry, too-big refusal) must pass unchanged. Pure move first, then use. |
| Admin CSP `img-src` | Organizer Tools only | A missed or typo'd origin = blank photos (premortem 2b) | e2e asserts the stray's photo `<img>` loads in Organizer Tools |
| Admin badge on the Pets page | Pets list cards, pet page | Shown to non-admins | Same rule as Courts: `admin_scopes` has pets or community; e2e for a resident (none) and a pets admin (shown) |
| `LOG_KEYS` + pet actions | Households → admin log | None (labels only) | e2e for one pet action label |

## Step 3 — Regression surface

- **Pets page:** list, Strays (map + cards + NF-2 sorting), pet page tabs, My Pets add / edit / photo / remove, missing, sightings, WhatsApp share all unchanged. The full `pets.spec.js` stays green after the photo extract.
- **Organizer Tools:** events, banner, Courts, Community, Households, Admins (community / events / courts levels), invites, App Health. No change for organizers without pets rights.
- **Courts and Events resident pages:** untouched.

## Step 4 — Proposal (split: ~600 client lines, over the 200 budget ⇒ 3 PRs, each tier 2 + security review)

| PR | What | Size |
|---|---|---|
| **R5d-1 — the way in** | `isPetsAdmin` + `canEnter`; **Pets** tab: active animals A–Z (strays first, then villages A–Z by the owner's home, then name), chips (missing, care state, no photo, sightings this week), Archived (n) group (Q3); **Pets WhatsApp group link** set / replace / clear; Admins screen: pets level; Pets page **Admin** button (cards + pet page) → `?tab=pets&pet=`; pet log labels | ~200 client, ~120 e2e |
| **R5d-2 — strays editor** | Add / edit a stray or community animal: name, species, description, care state, territory text + spot (venue pin picker), photo; **EXTRACT** `assets/photo.js` (pure move first); admin CSP | ~220 client (+ ~90 moved), ~120 e2e |
| **R5d-3 — care and moderation** | One animal's admin view: care record (4 items: status, date, note), add a care log line, sightings with **Hide**, **Archive with reason** (strays; owned pets per Q2) | ~180 client, ~120 e2e |

- **Cost:** none (no paid API; same Storage objects).
- **Migration / re-seed / cache:** none. Client cache: new `assets/photo.js` + changed `api.js`-class shared files. `update.js` reloads open pages after deploy; a post-deploy check opens Pets and Organizer Tools → Pets.
- **Out-of-band:** none. Pets stays **off for Jubail**; e2e has it on (manifest).

## Step 5 — Premortem (§0.5)

| # | Exposed? | Mitigation |
|---|---|---|
| 1 Silent corruption | **Yes**: the editor sends unchanged fields and overwrites a concurrent edit (two carers). The territory spot is saved from a stale map. | Send only changed fields (Courts pattern). The spot is sent only when the picker was moved (`lat`/`lng` pair or both null). e2e asserts the exact `p_fields`. |
| 2 Silent zero-output | **Yes**: the photo extract quietly breaks Pets photos. | Pure move PR step first. The existing photo tests are the gate. e2e asserts a rendered `<img>` on both pages. |
| 2b Config drift | **Yes**: the CSP is per page (hand-copied); the pets tab depends on a module flag. | e2e loads a photo in Organizer Tools (fails on a missed CSP). The Pets tab shows only while Pets is on, or says "Pets is off" (Courts `ctOff` precedent). |
| 3 Cost | No | — |
| 4 Contract drift | Low: card shape from `jc_admin_pets_list` (S4) vs `jc_pet_card` (R5b-2b-0) | Render with the same tolerant readers as `pets.js` (`isPet`, `hObj`); e2e fixture from `petsBackend` |
| 4b "Behaves differently from…" | **Yes**: archiving, hiding and care editing behave differently from Courts. The Admin button must look and land like the Courts one. | Reuse `courtRow` markup, the reason confirm, the badge. Q1 decides where editing lives. |
| 5 Race | **Yes**: double taps (Zee's mirror extension), two carers editing | One write at a time (busy lock); the server re-reads after each write; `NOT_FOUND` after an archive elsewhere → list re-read + message |
| 6 Auth / RLS | **Yes**: a pets-only admin entering Organizer Tools; Admin badge leaking to residents; hide / archive by a non-admin | Server-enforced `jc_assert_admin('pets')` on every call (unchanged). The client `show()` per scope. e2e personas: resident, pets-only, community, events-only. Security review on R5d-1. |
| 7 Rollback | Client only: `git revert` per PR. Pets kill switch = module flag. | — |

## Step 6 — Executive summary

**What this change does:** gives the cat-care group (pets admins) their own Pets section in Organizer Tools: one list of the community's animals, adding and editing strays with a photo and their usual spot, keeping each animal's care record and log, hiding a bad sighting, and archiving with a reason. It also makes Pets admins invitable from the Admins screen.
**Biggest risk:** moving the photo code into a shared piece could quietly break photos on the residents' Pets page. The existing photo tests are the gate, and that move ships as its own step.
**Recommended next step:** answer Q1 (where editing lives, recommended Organizer Tools), Q2 (archive a household's pet, recommended yes), Q3 (show archived names, recommended yes). Then R5d-1 starts.
