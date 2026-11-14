# Nearest first: one distance rule for every list

Planned 2026-11-14 with `/plan-change`. Decisions are Zee's, from 2026-11-14. Roadmap entry: "Nearest first".

## The rule (one strategy, every module)

1. **Where "nearest" is measured from:**
   - Your **household pin**, always, by default. The pin is required when you claim a home (T5.2). Homes claimed before that, and test data, can lack one.
   - Your **phone's position** only after **Use Where I Am** (on a list) or **Find Me** (on a map). Both set the same position for that visit. It is forgotten when you leave the page, and it is never sent or stored.
2. **One control, identical on every resident list that has places:**
   - `Sorted by: nearest your home   [Use Where I Am]`
   - `Sorted by: nearest where you are now   [Use My Home]`
   - With no household pin: `Sorted by: name…` (the Pets wording), still with [Use Where I Am].
3. **Distance on each row:** "≈ 300 m". The "Sorted by" line says what it's measured from.
4. **Organizer Tools are never sorted by distance:**
   - A–Z by village, then by name, wherever a village applies (Arabic order in Arabic).
   - The Events list stays by date.

| List | Order | Use Where I Am | Distance |
|---|---|---|---|
| Courts list | Nearest first; courts without a pin last | Yes | Yes |
| Events → List (homes) | Your village first, then nearest; **By House Number** kept as the second choice | Yes | Yes |
| Pets → Strays cards | Nearest first, by last spot or territory | Yes | Yes |
| Pets → owned pets | Server order from your home pin (since R5b-2b-0) | **No.** The line shows with no button; their homes never reach the phone. | No |

**How Pets sorts on the server:** each phone asks for its own list. The server sorts it from the asking person's home pin, so every person gets their own order. Nothing is shared between requests.

## Zee decisions (2026-11-14)

1. Events keeps "By House Number" next to Nearest First.
2. Courts get an optional village. It tells people **where** a court is and never limits who can book it. No village means "Whole community".
3. The organizer Events list stays by date.
4. The Events List opens on Nearest First.
5. Organizer Tools are A–Z by village, then by item.
6. Long term (not scheduled): Courts grow into general **Bookings** for any shared space.

## PRs

### NF-1 — Courts get a village (DB, tier 3, `/db-rehearse`)

- **Table:** `jc_facilities.village_key text null`. It is a foreign key on `(community_id, village_key)` → `jc_villages(community_id, key)`, the same pair homes use. Null means Whole community.
- **Function bodies only** (no signature change):
  - `jc_admin_facility_save` accepts `village_key` (null or "" clears it). An unknown village gives `BAD_FIELDS`.
  - `jc_admin_facilities_list` and `jc_facilities_list` return `village_key`.
  - Server order is unchanged; sorting happens on the phone.
- **Organizer court editor:** a Village picker ("Whole community" plus the community's villages), reusing the Households village `<select>` (`admin.js` `hhVillage`).
- **Tests:**
  - A SQL slice: set, clear, unknown village, another community's village, a resident read.
  - e2e: the editor picker.

### NF-2 — the shared control (client, tier 2)

- **Map kit:**
  - `jcDist(a, b)`: plain distance, with no Leaflet needed.
  - `jcNear(items, origin)`: a stable sort with no-pin items last.
  - One remembered visit position, set by `jcFindMe` and Use Where I Am.
  - `jcSortedHtml` / `jcSortedWire`: the line and its button.
- **Courts list:** nearest first, plus the village line on the card.
- **Events List:**
  - Nearest First by default (from the household pin) and your village first.
  - By House Number is kept.
  - The old `locate()` path is replaced (SA-2 review finding #2).
- **Strays cards:** follow the visit position.
- **Help text:** EN + AR.

### NF-3 — Organizer A–Z (client, tier 2)

- **Lists:**
  - The Courts list goes by village (Whole community first), then name, ignoring the manual `sort` number for display.
  - Homes and households lists go by village, then number.
  - Pets lists come with R5d.
- Locale-aware compare (`localeCompare(…, jcLang())`).

## Premortem

| # | Failure mode | Where | Mitigation |
|---|---|---|---|
| 1 | Silent wrong output | The order is quietly from an old phone fix, or from home when the person expected their phone | The "Sorted by" line always names the origin. The phone position never outlives the visit. |
| 2 | Contract drift | Events tests assume number order by default. Admin court save tests list the allowed fields. | Number-order tests tap By House Number. SQL slice for the new field. `00_grants` signatures unchanged. |
| 2b | Out-of-band drift | A village is renamed or removed in config while a court points at it | The foreign key blocks deleting a village in use. The name is shown from the village config, as for homes. |
| 3 | Edge cases | No home pin; courts with no pin; being outside the community; an Arabic list order | No pin goes last. "Sorted by: name" fallback. Distances bidi-isolated as Events does today. |
| 4 | "Behaves differently from…" | The organizer court order no longer follows the manual `sort` number. The Events list no longer opens by number. | Zee chose A–Z. By House Number is one tap away. |
| 5 | Privacy | It might feel like tracking | No location prompt unless Use Where I Am or Find Me is tapped. Help text says the position stays on the phone. |
| 6 | Leaflet missing | The list sort used Leaflet's `distanceTo` | Plain `jcDist`. |
| 7 | Event-night refresh | The list re-sorts under the thumb | Same origin and order on redraw. The position is never re-asked. |
