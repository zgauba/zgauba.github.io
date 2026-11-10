# The Neighbourhood Edit — module brief (Zee, 2026-11-10)

> Status: **brief only** — placement decided (fast follower after launch); no `/plan-change` yet.
> This repo is public: the editor is "the curator" everywhere, never by name.

## What it is

A curated directory of local businesses and services recommended by Jubail residents. The curator built it on
Wix Spaces; Wix keeps dropping members' access, so she agreed to bring it into Commons.
**Terms:** its own section under its own brand; the curator stays the editor and decides what goes in; Zee
handles all tech.

## Naming

| What | Value |
|---|---|
| Internal module key (code, URLs, feature flag — never changes) | `directory` |
| Display name / tab label | "Services" (EN) / «الخدمات» (AR) — community-configurable via **Renamable modules** (ROADMAP RM) |
| Section brand / title | **"The Neighbourhood Edit"** (British spelling, exactly) |

## Requirements (the curator)

1. Her structure: **categories and subcategories** (names EN + AR; entries may be English-only to start).
2. Per business, separate buttons: **Call, WhatsApp, Website, Instagram, Flyer** (uploaded image or PDF).
3. **Mobile-first editor**: she adds and updates entries from her phone.
4. **Resident submissions → her moderation queue**; nothing appears until she approves.

## "Used this vendor" (Zee)

- One mark per **household** per business; any household member can undo it.
- Aggregate only: **"Used by N Jubail households" when N ≥ 3**, nothing below 3. No RPC (public or curator)
  ever returns marks per household; nobody — the curator included — sees who marked.
- Only verified households (joined with the community code, home claimed) can mark.
- Absence is silent: no "unused" state, no "least used" sort.
- **No negative path anywhere**: no ratings, stars, thumbs-down, free-text reviews, "not recommended".
  Reason: UAE online defamation is criminal (Federal Decree-Law 34/2021 Art. 43); a positive-only factual count
  is the safe design.
- Curator can **hide a business in one tap** (takedown requests).
- Footer: listings are never paid for; no money or gifts change hands (Decree-Law 34/2021 Art. 55).

## Design constraints (Commons rules)

- Own feature flag (`directory`), the compliance kill switch like events / bookings / pets.
- Curator = **scoped editor for this module only** — the R4a-3 per-person admin model with a new
  `directory` scope (invite link → named grant → removable), not community admin.
- Zero-PII: business contact details are allowed **with the vendor's consent** (below). Never store or show
  which resident recommended or submitted an entry. If moderation needs a contact path back to a submitter,
  that is an explicit opt-in PII decision for Zee — never silent.
- No payments, no paid listings, no money of any kind.
- EN/AR strings in `strings.js`; category names EN + AR; entries English-only to start.
- Flyers: Supabase Storage, size/type limits, images + PDFs only (same ledger + purge pattern as pet photos).
- `jc_` tables, RLS deny-all, SECURITY DEFINER RPCs; all curator/resident text cleaned on write.

## Vendor consent (Zee 2026-11-10: on the roadmap, details later)

Many "businesses" are individuals — a home baker's or tutor's **personal** mobile, sometimes a Jubail resident.
"Businesses aren't residents" doesn't hold for them, so **every listing needs the vendor's consent to be listed**,
recorded by the curator. To design at `/plan-change` time: how consent is captured (curator attests? vendor
confirms via a link?), what is stored (date + method, no extra PII), how a vendor withdraws (the one-tap hide),
and how imported Wix entries get consent retro-actively. A short UAE data-protection check before launch
(not legal advice from this repo).

## Data migration (needs the curator)

- **A. One-time import (preferred):** Wix CMS → collection → More Actions → Export to CSV → import script into
  the `jc_` tables. If her content is hand-built pages, not a CMS collection, it's manual transcription.
  **Action now (parallel to R5):** ask her which it is.
- B. Interim read-only mirror via the Wix Data API — only if she wants to keep editing in Wix for a while
  (needs a CMS collection + API credentials; free-plan API access unverified; two-way sync ruled out).
  Not built unless Zee asks. Schema designed so A's CSV maps cleanly.

## Follow-on (smaller, separate)

- **Community information** (bus routes / timetables, waste collection, other practical info) as
  curator-editable static content in **The Community** section (R6).

## Out of scope (backlog)

- "What's On in Abu Dhabi" off-island events calendar — blocked on who keeps it updated.
- Resident submissions for **events** (separate from recommendations).

## Supersedes

ROADMAP decision 2026-11-06 "Google Sheet + Update Commons Apps Script" — requirement 3 (phone editing) and
4 (moderation queue) need the in-app editor (option C in the ROADMAP's "where the data lives" table).
