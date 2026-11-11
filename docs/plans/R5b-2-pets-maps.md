# R5b-2 — Pets: maps, location pin, pet page tabs, badges — plan (`/plan-change`, 2026-11-11)

> Status: **DRAFT, for Zee's approval.** Source: Zee's phone review of R5b-1 on `e2e` (2026-11-11):
> "fun badges … pet vs Pet & Wanderer and Strays"; "'Add where I am now' → 'Add Location Pin' — a map in the modal with
> the person's current location, adjustable before saving"; "sightings should show a mini map with pin"; "the pet
> details page should have a sub-menu … learn the design language from previous module pages"; missing pets on the
> Commons page (→ News, separate plan). Supersedes R5-pets.md's R5b-2 line ("the Map tab").

## Step 0 — Scope & freshness

- **Tier: screen logic + shared-asset refactor.** Client only — **no migration**: sightings already carry `lat/lng`,
  strays carry `territory_lat/lng`, the pet card carries the home (now with its type, live since 2026-11-11).
- Manifest LAST VERIFIED 2026-11-10 (1 day). Inventory below re-read from the repo today.

## Step 1 — What the other modules already do (the design language to match)

| Pattern | Where it lives today | Pets today |
|---|---|---|
| Detail page = header block, then a tab row (`jcTabsHtml` / `jcTabsWire`, `?tab=`), Map tab full height | Event page: `map · list · mine` (`events.js:18-26, 276-312`, `fitMap` 847-866) | One long scroll |
| Map: Street / Satellite, Map Labels, Find Me (blue dot), Full Screen (CSS `.evmapwrap.full`), popups with walking Directions | `events.js renderMap` 892-973 and **a copy** in `bookings.js` 308-359 ("keep in step") | No map |
| Pin picker: map pans under a fixed centre ring, Find Me, paste coordinates, Save reads the centre | Home pin (full page, `home.js` 64-126); admin venue pin (`admin.js` 2203-2255, 240 px) | Bare geolocation button |
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

### R5b-2b — Pets on the kit
1. **Badges** (sketch A): a coloured pill per kind, with the species glyph on the card —
   **Pet** (accent) · **Pet · Wanderer** (info blue) · **Stray** (warn amber) · **Community animal** (good green) ·
   **Missing** (danger red, always first). Same pill shape as `.soon` / `.badge`; tokens only (community themes keep
   the signal colours locked). Shown on list cards and the pet page header.
2. **Pet page tabs** (sketch B), like the event page: header (name, badges, species · kind, alarm if missing) then
   - **About** — facts, description, care record (strays), *Your pet* box (owners), Share on WhatsApp
   - **Sightings** — "Report a sighting" + the list; each sighting with a location gets a **mini map** with its pin
     (tap → Map tab centred on it). Shown only where sightings are open today (missing pets, strays not rehomed).
   - **Map** — full height: sightings (newest highlighted), the stray's territory spot, and for a missing pet the home
     **only when the server sent it**. Find Me, Full Screen, Directions in popups.
   `?pet=<id>&tab=about|sightings|map`. Default **About**; a missing pet opens on **Sightings**.
3. **Add Location Pin** (sketch C): the sighting form's button opens a **sheet** with the pin picker, centred on the
   phone's current location (asked on tap; if refused or unavailable → centred on the community, with a line saying
   so). The resident pans to adjust, **Use this spot** returns to the form showing a mini map + Change / Remove.
   Rounded to 5 decimals as today.
4. **Pets Map tab (module level)**: List · **Map** · My Pets. Pins for **strays / community animals at their
   territory** and **missing pets at their latest sighting**. **Owned pets that are not missing are NOT on the map**
   (see premortem #1).
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
5. **Badge colours fight community themes** → tokens only; the signal colours are already locked against override.
6. **The hub's missing-pet line costs a read for every visit** → only when the pets flag is on; cached for the visit.

## Step 5 — Questions for Zee

- **Q1** Owned pets on the map only while missing? *(Recommended: yes.)*
- **Q2** Pet page tabs: **About · Sightings · Map** (+ Care folded into About for strays)? Missing pets open on Sightings?
- **Q3** Hub bridge ("1 missing pet" on the Pets card) now, full alert in News later?

## Step 6 — Executive summary

Two client PRs, no database change. **2a** pulls the map pieces Events and Courts copy today into one shared kit
(nothing changes on screen; the whole test suite guards it). **2b** builds Pets on it: kind badges, About / Sightings /
Map tabs on the pet page, mini maps on sightings, an "Add Location Pin" sheet that opens on your location, a Pets Map
tab, and a missing-pet line on the Commons Pets card until News exists. Biggest risk: a pet map that doubles as a list
of homes with valuable animals — owned pets stay off the map unless missing. Confidence the scope is right: 0.8.
