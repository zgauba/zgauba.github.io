# R5b-2 — Pets: maps, location pin, pet page tabs, badges — plan (`/plan-change`, 2026-11-11)

> Status: **approved 2026-11-11 (#93); runs after home-hiding removal and R5c photos (Zee 2026-11-11).** Source: Zee's phone review of R5b-1 on `e2e` (2026-11-11):
> **Re-planned 2026-11-13 (Zee):** the module gets **Pets · Strays · My Pets**, "Community animal" goes, and a database
> step R5b-2b-0 comes first. **The section "Re-plan 2026-11-13" at the end supersedes "R5b-2b — Pets on the kit"
> below.** R5b-2a (shared map kit) is done: #101, merged 2026-11-12.
> "fun badges … pet vs Pet & Wanderer and Strays"; "'Add where I am now' → 'Add Location Pin' — a map in the modal with
> the person's current location, adjustable before saving"; "sightings should show a mini map with pin"; "the pet
> details page should have a sub-menu … learn the design language from previous module pages"; missing pets on the
> Commons page (→ News, separate plan). Supersedes R5-pets.md's R5b-2 line ("the Map tab").

## Step 0 — Scope & freshness

- **Tier: screen logic + shared-asset refactor.** Client only — **no migration**: sightings already carry `lat/lng`,
  strays carry `territory_lat/lng`, the pet card carries the home (now with its type, live since 2026-11-11).
- Manifest LAST VERIFIED 2026-11-10 (1 day). Inventory below re-read from the repo today.

## Update 2026-11-12 — Zee after R5c photos

> "I think the pet list can be in two columns rather than 1… also, the pet details page itself just looks messy…"

- **List → two-column photo cards** (photo-led now that R5c is live): photo (or the paw on a soft tile) on top, name,
  species · kind, the badges; Missing cards keep the red edge and stay full-width at the top. Whole card is the tap
  target (no separate Details button). 360 px: still two columns (~160 px each); very long names wrap to 2 lines.
- **Pet page** gets the tabs + header of sketch B below — that is the "messy" fix (one long scroll today).
- **Proposed split (needs Zee's OK):** neither needs the map kit, so pull them forward as **R5b-2b-1 Pets layout**
  (two-column grid, badges, pet page header + About / Sightings tabs) → then **R5b-2a** map kit → **R5b-2b-2** (Map
  tab, Add Location Pin, mini maps, Pets Map tab, hub missing line).
- **Zee 2026-11-12: "yes fix the pets layout first"** → R5b-2b-1 built (branch `feat/r5b2b1-pets-layout`). As built,
  vs the sketch: the pet page header is **compact** (photo tile beside the name — a full-width photo pushed the tabs
  below the fold); **Share on WhatsApp lives on the Sightings tab** (with "Report a sighting" — reporting missing jumps
  there, matching "Share the alert below"); the owner's **"is back home" sits inside the alarm** (visible on every tab);
  no tab row when only About applies (owned, not missing, no sightings); `?show=about|sightings` (`?tab=` stays the list
  tab to return to). Species emoji skipped (the paw tile carries it). Kind glyph badges deferred to R5b-2b-2 — today
  "Cat · Stray" says the kind; colour only on Missing (red) / Needs help (amber).

## Step 1 — What the other modules already do (the design language to match)

| Pattern | Where it lives today | Pets today |
|---|---|---|
| Detail page = header block, then a tab row (`jcTabsHtml` / `jcTabsWire`, `?tab=`), Map tab full height | Event page: `map · list · mine` (`events.js:18-26, 276-312`, `fitMap` 847-866) | One long scroll |
| Map: Street / Satellite, Map Labels, Find Me (blue dot), Full Screen (CSS `.evmapwrap.full`), popups with walking Directions | `events.js renderMap` 892-973 and **a copy** in `bookings.js` 308-359 ("keep in step") | No map |
| Pin picker: map pans under a fixed centre ring, Find Me, Save reads the centre (paste-coordinates box removed 2026-11-12 — map only) | Home pin (full page, `home.js` 64-126); admin venue pin (`admin.js` 2203-2255, 240 px) | Bare geolocation button |
| Status pill | `.soon` (events), `.badge` (app.css), `.pill` (hub) | Plain grey chips |
| Mini (preview) map | **Nowhere** | — |

Two facts shape the plan: (1) the map code is **already duplicated** between Events and Courts — a third copy in Pets
would break the consistency rule; (2) three pin pickers exist and none is shared.

## Step 2 — Proposal: two PRs

### R5b-2a — shared map kit (no visible change)
- New `commons/assets/mapkit.js` (+ styles stay in `mapui.css`): `jcMap(el, opts)` → Street/Satellite toggle, Map
  Labels, Find Me, Full Screen, `jcMapPopup(...)` with Directions; `jcPinPicker(el, {center, onSave})` = the home
  picker's pan-under-ring pattern as a component; `jcMiniMap(el, lat, lng)` = non-interactive preview (no drag / zoom
  / tiles beyond one view), tap → callback.
- **Events, Courts, home pin, admin venue pin switch to it** in the same PR, with the full e2e suite as the guard
  (≈ 560 tests) + screenshots of every map before / after. Nothing should look different.
- **As built (2026-11-12, `feat/r5b2a-map-kit`):** the kit went into the existing `assets/map.js` (already loaded on
  every map page, so no new `<script>` tags), not a new `mapkit.js`. Pieces: `jcMapColors` (the Find Me dot is now the
  `--jc-me` token), `JC_POPUP`, `jcDirectionsUrl`, `jcMapLayers` (Street / Satellite), `jcLocate`, `jcMeDot`,
  `jcMapHtml` (the full map's buttons), `jcMapFull` (Full Screen + Escape), `jcPinPickerHtml` / `jcPinPicker`.
  **`jcMiniMap` deferred to R5b-2b-2** — its first user, so it isn't dead code until then; the Pets sighting button
  also moves to the kit there (Pets doesn't load Leaflet yet). Only behaviour difference: Escape on the Courts full
  map now leaves an open window's Escape alone, as Events already did. Map specs 283/283; before/after screenshots of
  the event map (EN, AR, full screen, Street) and the home pin (EN, AR) are byte-identical.

### R5b-2b — Pets on the kit
1. **Badges** (sketch A) — *corrected against the brand direction (2026-11-11)*: the four signal colours are
   semantics, not decoration (teal = allergy-friendly, reserved; amber = warning; green = available), so **kind is
   told by form, not hue**: a neutral pill with a dot-family glyph per kind — **Pet** (paw) · **Pet · Wanderer** (paw +
   roaming dots) · **Stray** (open-ring pin) · **Community animal** (ring of dots, the mark's motif) — plus the species
   emoji on the card for the fun. **Colour only for real states**: **Missing** = danger red (always first),
   **Needs help** = warn amber. Shown on list cards and the pet page header.
2. **Pet page tabs** (sketch B), like the event page: header (name, badges, species · kind, alarm if missing) then
   - **About** — who they are and what to do: description, facts (species, kind, home for owned pets / territory for
     strays, microchipped, the wanderer line), the stray's care status + care record + care log; for the owner the
     *Your pet* box (Report as missing / Edit details); while missing, Share on WhatsApp
   - **Sightings** — "Report a sighting" + the list; each sighting with a location gets a **mini map** with its pin
     (tap → Map tab centred on it). Shown only where sightings are open today (missing pets, strays not rehomed).
   - **Map** — full height: sightings (newest highlighted), the stray's territory spot, and for a missing pet the home
     **only when the server sent it**. Find Me, Full Screen, Directions in popups.
   `?pet=<id>&tab=about|sightings|map`. Default **About**; a missing pet opens on **Sightings**.
3. **Add Location Pin** (sketch C): the sighting form's button opens a **sheet** with the pin picker, centred on the
   phone's current location (asked on tap; if refused or unavailable → centred on the community, with a line saying
   so). The resident pans to adjust, **Use this spot** returns to the form showing a mini map + Change / Remove.
   Rounded to 5 decimals as today.
4. **Pets Map tab (module level)**: List · **Map** · My Pets. Two layer toggles (Zee 2026-11-11), both on by default:
   **Missing + sightings** (missing pets at their latest sighting, earlier sightings smaller) and **Strays + sightings**
   (strays / community animals at their territory, their sightings). **Owned pets that are not missing are NOT on the
   map** (Q1, Zee: correct).
5. **Bridge until News**: the Pets card on the Commons hub shows "1 missing pet" in red when any is missing (one
   `jc_pets_list` read on the hub, only when the module is on). News (its own plan) later carries the full alert.

```
A  list card                         B  pet page                       C  Add Location Pin (sheet)
┌──────────────────────────────┐    Biscuit                            ┌──────────────────────────────┐
│ 🐶 Biscuit                   │    [MISSING] [PET]                    │ Where did you see Biscuit?   │
│ [MISSING] [PET]              │    Dog · Pet · Villa 210, Test V.     │ ┌──────────────────────────┐ │
│ Villa 210 · Test Village     │    ┌ Missing since Tue 10:00 ────┐    │ │        map  ◎            │ │
│ Last seen: by the canal      │    └─────────────────────────────┘    │ │   (pan to move the ring) │ │
│ [Details]                    │    About | Sightings | Map            │ └──────────────────────────┘ │
└──────────────────────────────┘    ─────────                          │ [Find me]  [Street/Sat]      │
┌──────────────────────────────┐    Sightings (2)                      │ [   Use this spot   ]        │
│ 🐱 Ginger    [STRAY]         │    ┌ Tue 12:40 · Running along… ┐     │  Cancel                      │
│ Behind the community centre  │    │ ┌────────┐                 │     └──────────────────────────────┘
└──────────────────────────────┘    │ │ mini ● │  Open in map   │
                                    │ └────────┘                 │
                                    └────────────────────────────┘
```

## Step 3 — Regression surface

Events map + venue pin, Courts map + labels, home pin step (`?view=pin&next=`), admin venue picker, sighting privacy
(no reporter, 5-decimal rounding, location only after an explicit tap), the WhatsApp share, kill switch (no pets RPC
on the hub while the flag is off), RTL + Arabic, CSP (no new hosts), 360 px.

## Step 4 — Premortem (it shipped and went wrong — why?)

1. **A map of every pet at its home = a map of which villas have dogs / expensive cats.** The list already shows homes,
   but a map makes it a browsable target list. → Owned pets appear on the map **only while missing** (and only with
   what the server sends). *Decision for Zee (Q1).*
2. **The kit refactor breaks the live Events map on event night.** → R5b-2a ships alone, no visual change, full suite
   + before/after screenshots; not within 48 h of a live event; event-night hotfix rule applies.
3. **Mini maps make the sightings tab slow** (one tile set each). → Mini maps built only when scrolled into view, at
   most 10 on the page; older sightings show "Open in map" only.
4. **Location refused → the sheet opens on the middle of the sea.** → fall back to the community centre with a
   visible line; picker still works by panning.
5. **Badges misuse the signal colours** (first draft did: teal / amber / green as kind colours) → kind by glyph,
   colour only for Missing / Needs help; the Find Me dot (`#3a86ff`, hard-coded in two files) becomes a token in 2a.
6. **The hub's missing-pet line costs a read for every visit** → only when the pets flag is on; cached for the visit.

## Step 5 — Questions for Zee

- **Q1** Owned pets on the map only while missing — **yes (Zee 2026-11-11)**, plus the two layer toggles above.
- **Q2** Tabs About · Sightings · Map — About's contents spelled out above; awaiting Zee's OK.
- **Q3** **Both (Zee 2026-11-11)**: the missing line on the hub Pets card now; the full alert in News later.

## Step 6 — Executive summary

Two client PRs, no database change. **2a** pulls the map pieces Events and Courts copy today into one shared kit
(nothing changes on screen; the whole test suite guards it). **2b** builds Pets on it: kind badges, About / Sightings /
Map tabs on the pet page, mini maps on sightings, an "Add Location Pin" sheet that opens on your location, a Pets Map
tab, and a missing-pet line on the Commons Pets card until News exists. Biggest risk: a pet map that doubles as a list
of homes with valuable animals — owned pets stay off the map unless missing. Confidence the scope is right: 0.8.


---

# Re-plan 2026-11-13 — Pets · Strays · My Pets (`/plan-change`; supersedes "R5b-2b — Pets on the kit")

Zee 2026-11-13: "Instead of List and My Pets, we have Pets, Strays, My Pets… Pets sorted closest to your household,
filter by type, wanderer… Strays: the map with last known location of each stray, colour coded… cards below."
"Not sure what Community Animals are — either a person owns an animal (pet) or it's a stray." "A stray should not be
marked missing." "While a pet is missing, show all members the sightings made since it went missing; hide them again
when it's found." "Owned, not missing: maybe keep the Sightings tab — the owner may not know their pet is out."

## Step 0 — Scope & freshness

- **Tier: cross-layer** — RPC bodies, one new RPC, sighting visibility (who sees what = auth/PII), plus three screens.
- Manifest LAST VERIFIED **2026-11-12** (1 day). The touched [live] layer was re-queried **2026-11-13** (below).

## Step 1 — Inventory

| Layer | Touched? | Check that ran |
|---|---|---|
| DB functions | **Yes** — `jc_pet_get`, `jc_pet_card`, `jc_pet_sighting_add`, `jc_pets_list` (bodies only); new `jc_pets_alerts`; new helper | `pg_get_functiondef` on live, 2026-11-13 |
| DB tables / constraints | **No** — "strays can't be missing" **already enforced**: `jc_pets_check1` = `kind='owned' OR (NOT wanderer AND NOT missing)`; `jc_pet_missing_set` refuses non-owned (`NOT_FOUND`); live: 0 strays missing | `pg_constraint` on `jc_pets`; grep of function bodies writing `missing` (only `jc_pet_missing_set`, `jc_pet_retire`) |
| DB indexes | No — `jc_pet_sightings_pet (pet_id, seen_at desc)` serves "latest since X" | `s4_pets.sql:107` |
| Cron (sighting retention, reporter nulling) | No — reads `seen_at` / `reporter` only | `r5a_pets.sql:105-113` |
| Storage (pet photos) | No | no photo RPC in the change list |
| Edge function (1) | No | not pets-related (manifest) |
| Frontend | **Yes** — `pets/pets.js` + `pets.css`, `assets/strings.js` (EN+AR), `assets/landing.js` (hub Pets card), `assets/map.js` (kit, reuse) | grep `rpc("jc_pet` call sites; `landing.js:108` module cards |
| Hosting (Pages + Cloudflare Pages `commons`) | Deploy only | — |

Live facts this plan rests on (2026-11-13):
- `jc_pet_get` sightings: `kind='stray' OR home_id = viewer home OR jc_admin_has('pets')`, newest **30**; neighbours get
  **none** for a missing owned pet today.
- `jc_pet_sighting_add` open only when `(stray AND not rehomed) OR missing` → `SIGHTINGS_CLOSED`; caps 30/day per
  reporter, 5/day per reporter per pet; reporter nulled within 48 h; sightings deleted after 30 days.
- `jc_pets_list(p_filter)` returns **all** cards (client splits), order `missing desc, name`. Card has home village +
  number, **no home coordinates**; strays carry `territory_lat/lng`.
- Hub (`landing.js`) reads nothing from Pets today; the "1 missing pet" bridge from the earlier plan was never built.

## Step 1b — Prior art

| Building block | Existing version | Decision |
|---|---|---|
| Module sub-tabs + `?tab=` | `jcTabsHtml/jcTabsWire` (nav.js); Events map·list·mine, Courts list·map·mine | **REUSE** |
| Full map (Street/Sat, Find Me, Full Screen, popups, Directions) | `assets/map.js` kit (#101) | **REUSE** |
| Pin labels on a map | Courts' permanent tooltips (`bookings.js` `.bklabel`) | **REUSE** the pattern, plus show-when-zoomed-in (**NEW**: a zoom threshold) |
| Map key / legend | Events "Map Labels" sheet | **REUSE** for the stray colours |
| "N without a pin — see list" line | Events `ev_unpinned` | **REUSE** for strays with no location |
| Pin picker sheet (Add Location Pin) | `jcPinPicker` (kit) | **REUSE** |
| Mini map | none (grep `jcMiniMap` = 0) | **NEW**, in the kit (`jcMiniMap`) |
| Filter chips | Pets `#ptFilters` (`pets.js:362`) | **REUSE**, new values |
| Nearest-first sort | Events List "sort by distance" (phone-side, needs coordinates) | **DEPART**: owned pets sorted **on the server** — sending pet-home coordinates would rebuild the map of homes with pets |
| Alert box | Pets missing `.alarm` | **REUSE** for "seen out" (amber, not red) |
| Hub module card line | none on the Pets card | **NEW**, the same text style as other hub cards |
| WhatsApp share | Pets `drawShare` (missing alert) | **REUSE** for "Is this {name}?" |
| Colours | tokens: `--jc-warn` amber, `--jc-accent` (every map pin today), `--jc-muted`; red = danger | Needs help **amber** · Under care **accent** (the normal pin) · Known and fine **neutral** — no new colours, nothing reserved reused |

## Step 2 — Impact map

| Change | Who else reads it | What could break | Assumption → how verified |
|---|---|---|---|
| A. One visibility rule `jc_pet_sight_from(pet, viewer)` → the time from which a viewer may see a pet's sightings: all for stray / household / Pets admin; `missing_since − 24 h` for anyone else while missing (see Q1); none otherwise | `jc_pet_get` (pet page), `jc_pet_card` (every list + every write's return) | Neighbours see household-only sightings | SQL tests per persona × state (s24) |
| B. `jc_pet_sighting_add`: also open for **owned, not missing, not wanderer** | Pet page Sightings form | Wanderer owners get noise; spam on one household | Caps already 5/pet/day per reporter; admin hide exists (`s4_pets.sql:605`) |
| C. Card gains `last_seen {lat, lng, at}` — the newest sighting **this viewer may see** (rule A) | Lists, Strays map, My Pets alert, pet header | A neighbour learns a household-only sighting via the card | Same helper as A; test the card per persona |
| D. `jc_pets_list` order: missing first → nearest to the viewer's home pin (owned: their home pin; strays: last_seen else territory) → name | Pets / Strays lists | Viewer without a pin → today's name order (no error) | Test both |
| E. New `jc_pets_alerts()` → `{missing: [{id,name}], seen_out: [{id,name,at}]}` (seen_out = **your** not-missing pets seen in the last 24 h) | Hub Pets card only | One more read per hub visit | Called only when the pets flag is on |
| F. Client: Pets · Strays · My Pets; Strays map + cards; "Community animal" label gone; pet Map tab; Add Location Pin; mini maps; "seen out" alert; hub line | Shared links `?tab=list`, `?pet=` | Old links | `?tab=list` → Pets; `?pet=` unchanged |

Signatures: **none change** (frozen-signature rule). Old cached pages ignore the new card keys and still send
`p_filter='all'`; `'community'` stays accepted by the server.

## Step 3 — Regression surface

Pet page About / Sightings (R5b-2b-1), report missing → Sightings tab + WhatsApp share, "is back home", photos and Remove
Photo, My Pets add / edit / archive, strays' care record + care log, the sighting form's privacy line, 5-decimal
rounding, kill switch (no pets RPC anywhere while the flag is off, hub included), RTL + Arabic, 360 px two-column
cards, `/shot pets/`, Events + Courts maps (kit shared), CSP (no new hosts).

## Step 4 — Proposal: three PRs

### R5b-2b-0 — database (tier 3, `/db-rehearse`, ≈ 150 SQL + test slice `s24`)
A–E above. Body changes + one helper + one RPC, no table change. The migration header carries the "down" (the previous
bodies) as earlier R5 migrations do. Copy is disclosed in R5b-2b-2b, before any "out alone" button exists.

### R5b-2b-2a — the module's three tabs (tier 2, ≈ 250 LOC)

```
Pets of Jubail
[ Pets ] [ Strays ] [ My Pets ]
┌─ MISSING ───────────────────────────┐   ← always on top, full width, red
│ [photo] Biscuit · Dog · Villa 210   │
└─────────────────────────────────────┘
(All)(Dogs)(Cats)(Other)(Wanderers)        ← one chip row
Sorted by: nearest your home
┌──────────┐ ┌──────────┐
│ photo    │ │ photo    │                  ← today's two-column cards
│ Rex      │ │ Luna     │
│ Dog      │ │ Cat · W  │
└──────────┘ └──────────┘
```
- **Pets**: owned only. Missing pinned top. Chips **All · Dogs · Cats · Other · Wanderers** (no "Missing" chip — missing
  pets are always on top; see Q2). "Sorted by: nearest your home" (or "by name" without a home pin).
- **Strays**: the map (kit), **one pin per stray** at its latest sighting (≤ 30 days) else its territory; **names as
  labels from zoom 17 in** (tap a pin for the card at any zoom). Colours: Needs help amber · Under care accent · Known
  and fine neutral; Rehomed **off the map** (card stays, at the bottom). A "Map Labels" key. "N strays have no location
  yet — see below". Below the map: the stray cards, Needs help first, then nearest.
- **My Pets**: unchanged, plus the amber "Seen out on their own · 2 h ago" line on a card (24 h).
- "Community animal" label, filter and strings removed → "Stray · Known and fine".
- Hub Pets card: "1 missing pet" (red) and, for the household, "Biscuit was seen out · 2 h ago" (one `jc_pets_alerts`
  read, only when the flag is on).

### R5b-2b-2b — the pet page (tier 2, ≈ 300 LOC)

| Pet | Tabs |
|---|---|
| Owned, not missing, not wanderer | About · Sightings (neighbours: "Seen {name} out on their own?"; the household: the reports) |
| Owned wanderer, not missing | About only (+ Sightings for the household if any exist) |
| Owned, missing | About · Sightings · **Map** |
| Stray (not rehomed) | About · Sightings · **Map** |

- **Map tab**: missing pet → sightings it may show (rule A), newest big with "Latest · 20 min ago", the rest small,
  older than 48 h faded; stray → territory spot (ring) + sightings of the last 30 days, same styling. No lines between
  dots. No home pin (the server sends no home coordinates).
- **Sightings tab**: mini maps on the newest 10 sightings that have a location, built when scrolled into view; older →
  "Open in map". **Add Location Pin** sheet (kit picker; opens on the phone's location, or the community centre with a
  line saying so).
- **"Out on their own" report** (owned, not missing): privacy line "Only {name}'s household sees this. If they report
  {name} missing, neighbours helping to search see it too." Then **Share on WhatsApp**: "Is this {name}? Seen … ".
- **Household**: amber box on the pet page "{name} was seen out on their own · 2 h ago — by the canal" with **Report as
  missing** right there; "If {name} is home, you can ignore this."

**Cost**: none (no paid layer). Tiles: mini maps capped at 10 and lazy; Strays map = one map.
**Diff budget**: three PRs each near or above 200 LOC — split by layer and by screen; further splitting would ship
half a tab.

## Step 5 — Premortem

| # | Mode | Exposed? | Mitigation |
|---|---|---|---|
| 1 | Silent corruption | Card `last_seen` computed with a different rule than the page | One helper used by both; tests compare them |
| 2 | Silent zero-output | Strays map empty because no stray has a location; nearest sort silently name-ordered | Visible "no location yet" line; "Sorted by:" line names the real order |
| 2b | Config drift | Cached old pages | No signature change; old filter values accepted; new keys ignored by old pages |
| 3 | Cost | Mini-map tiles | ≤ 10, lazy |
| 4 | Contract drift | Card shape grows | Additive keys only |
| 5 | Race | Owner marks found / wanderer while someone writes a sighting | Server re-checks → `SIGHTINGS_CLOSED` (existing message) |
| 6 | **Auth / PII** | Household-only sightings leak to neighbours; pre-missing reports made public | Rule A in one helper; s24 tests for neighbour / household / admin × not missing / missing / found / found-then-missing-again; disclosure copy before the button exists |
| 7 | Rollback | — | Client: revert. DB: migration restoring previous bodies (in the header); drop helper + `jc_pets_alerts` |

Protocol-specific:
- **A sightings channel for harassment** (fake "seen out" reports against one household) → existing caps (5/pet/day
  per reporter), admin hide, the owner's "ignore this" line. Reporter never shown.
- **False alarm** (a look-alike seen out while the pet is home) → copy says so; nothing changes state without the owner.
- **The owner never opens the app** → the WhatsApp share is the fast path; the hub line is the slow path. Push
  notifications are out of scope (iOS needs the app installed). Watch whether people share.
- **Users notice it differs from Events / Courts**: Strays labels appear only when zoomed in (Courts shows them always —
  Courts has few pins); a tab named "Pets" inside the Pets module.
- **Nearest-first leaks distance**: the order hints which pets live near you. Every card already shows village + number,
  so it adds nothing a walk wouldn't.

## Questions for Zee

- **Q1** A neighbour reports "Biscuit is out" at 10:00; the owner reports Biscuit missing at 11:00. Should neighbours
  searching see the 10:00 report? **Recommend yes**: show sightings from **24 h before** the pet went missing, and say so
  in the report's privacy line (above).
- **Q2** Pets filter chips **All · Dogs · Cats · Other · Wanderers**, with no Missing chip (missing pets are always on
  top). OK?
- **Q3** The household's "seen out" line on the **Commons home** card too, or only in Pets? **Recommend both.**
- **Q4** Stray colours: Needs help amber, Under care the normal green pin, Known and fine grey. OK?
