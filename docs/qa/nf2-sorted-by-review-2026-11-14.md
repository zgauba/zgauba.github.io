# NF-2 — the shared "Sorted by" control: review (2026-11-14)

Tier 2 (screen logic, no database change). Plan: `docs/plans/nearest-first.md` § NF-2. Reviewer: `code-reviewer` agent (read-only, on the uncommitted diff). Verdict: **APPROVE**. 0 critical, 0 high, 1 medium, 4 low. Confidence 0.8.

## What changed

- **Map kit (`commons/assets/map.js`):**
  - `jcHere`: this visit's phone position, in memory only. Find Me and Use Where I Am set it; Use My Home clears it.
  - `jcDist` (haversine, needs no Leaflet), `jcFmtDist`, `jcHomePin`, `jcOrigin`, `jcDistOf`.
  - `jcNear`: a stable sort with items that have no spot last.
  - `jcSortedHtml` / `jcSortedWire`: the line and its button.
- **Courts list:**
  - Nearest first from the household pin, or from the phone. With no origin, A–Z by name.
  - Each card shows its village, or "Whole community", plus "≈ distance".
- **Events List:**
  - Opens on Nearest First, with your village first when measured from home. From the phone it is strictly nearest.
  - By House Number is kept, with no distances.
  - The old `locate()` / `userPos` / Leaflet `distanceTo` path is gone (SA-2 finding #2).
  - The popup says "from you" or "from your home".
- **Pets:**
  - The Strays cards re-sort from the phone (Use Where I Am, or Find Me on the Strays map) without redrawing the map. Needs help stays first and rehomed stays last.
  - The owned-pets line is the shared one, with no button.
- **Strings EN + AR:** `sort_*`, `ev_dist_from_home`, `ev_sorted_number`, and help lines on Event, Courts and Pets saying the location stays on the phone.

## Findings and disposition

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MEDIUM | Events: a late fix that lands after the event-night refresh redrew the List was dropped. The tap was lost, though the line and the order still agreed. | **Fixed.** `jcSortedWire` gained a `late()` hook. Events redraws the List on screen when a late fix lands. |
| 2 | LOW | The Strays card redraw dropped keyboard focus. | **Fixed.** `jcFocusKeep()` around the redraw. |
| 3 | LOW | The popup distance was not bidi-isolated in Arabic. | **Fixed.** The distance is wrapped in LRI/PDI. |
| 4 | LOW | Events with a home but no pin: the line says "house number" while your village is hoisted first. | **Kept.** Your village first is Zee's decision. The line names the order inside each village. |
| 5 | LOW | bfcache could keep `jcHere` across a back navigation. | **Kept.** The position stays on the device, and the line still names it truthfully. Clearing it on `pagehide` would leave the restored DOM saying "where you are now" with no position behind it. |

## Test gaps raised, and what was added

- **Events, Find Me on the Map then List** (the premortem #1 origin switch). **Added.** The popup says "≈ 0 m from you", the List says "where you are now", and Seef is first, not my village.
- **`jcNear` tie stability.** **Added.** Two courts on one spot keep the server's order.
- **Arabic distance rendering, and the Pets no-pin plus `jcHere` path.** Not added. The Arabic Events list was checked by screenshot instead: the line, the button and "≈ 150 m" all render correctly in RTL.

## Verification

- **New NF-2 tests:**
  - Courts ×5: the order, village and distance; Find Me then List; no pin, then by name and in Arabic; refused and late fixes; the tie.
  - Events ×3: the default order, By House Number and Use Where I Am; Find Me then List; no pin.
  - Pets ×3: Strays from the phone; Find Me re-sorts the cards under the map; the owned line with no button.
- **Updated tests:**
  - The Events house-number test now taps By House Number.
  - The Courts help count went from 5 to 6.
- **Affected specs locally:** events, event-day, courts, pets, help, a11y, looks-pins, safety-lights. The full suite runs in CI.
