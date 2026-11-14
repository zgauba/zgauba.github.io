# Commons structural audit — 2026-11-13

**Verdict: some drift. Nothing is seriously wrong.** The scanners kept **44 findings**: 28 confirmed and 16 partly confirmed. That count includes one finding I restored and one I downgraded in my spot-checks (see "Refuted / merged"). 11 other reports were merged as duplicates or refuted. No finding breaks a feature today. The main pattern is that each of the 6 page scripts (Events, Courts, Pets, Home, Account, Admin) built its own copy of the same small helpers: message box, "Working…" button, tab URL and map setup. Those copies have now drifted apart. **16 findings are visible to users**, and none of them is serious. Examples:
- Events shows times on a 12-hour clock while Courts uses 24-hour.
- The Events venue-pin label is white in dark mode.
- Events has no "Try again" button.
- Courts popups are spaced differently from Pets popups.
- Admin's small buttons are smaller tap targets.
- Success messages scroll into view on some pages and not on others.

The fix is 5 PRs. Nearly all of the work moves code into the existing shared files in `commons/assets/`. Only 7 items are "leave" or "decide first".

> **Corrections from spot-checks (they change where code goes):**
> 1. **`account/index.html` does not load `nav.js`**, and the hub (`commons/index.html`) does not load `app.css`. Several scanner targets said "nav.js" for helpers that Account uses (msgBox, busy, on, setUrl). Those belong in **`api.js`**. Every page loads `api.js`, and it already holds `el()` and `esc()`.
> 2. **Events is not unguarded when the module is off.** The server raises `MODULE_OFF`, `jcErrText` turns it into `err_MODULE_OFF` ("This section isn't open yet…"), and `events.spec.js:76` "module off → explained, no blank page" tests this. What Events lacks is the *client-side* pre-check and a proper off view, and `ev_off` is never used. I downgraded the finding to "partly".
> 3. **Fit-to-pins** was merged into a "kept" finding that is missing from the verified list. I checked it again: `bookings.js:329`, `events.js:923` and `pets.js:774` all have their own copy. Padding is 40 / 30 / 40, and zoom for a single pin is 17 / 18 / `LABEL_ZOOM`. Pets `fitTo` has no guard for an empty pin list. It is restored as `fit-to-pins` and goes in SA-2.

---

## Zee decisions (2026-11-13)

1. **Clock: 12-hour (AM/PM) everywhere** — "people are more used to AM and PM times". SA-5 moves Courts, Pets, Admin, Home to Events' 12-hour format (the opposite of the report's default).
2. **Courts pin names: always shown** (not zoom-gated like Pets). SA-2 drops the optional change.
3. **Events can be switched off** → SA-3 adds the client pre-check + `ev_off` screen.
4. **Shared component CSS moves to `app.css`** → SA-4 goes ahead; the "pages carry their own CSS" note is retired.

Order: SA-1 → SA-2 → SA-3 → SA-4 → SA-5, one at a time.

## Fix plan

All five PRs touch the same page scripts (`pets.js`, `bookings.js`, `events.js`, `admin.js`). **Run them one after another, not in parallel** (the rule is "no parallel agents on the same area"). Every PR touches `commons/`, so each needs a review note at `docs/qa/<name>-review-<date>.md` or `review-saved.yml` fails. "Tier 2" means: affected specs run locally, the full suite runs in CI, and `code-reviewer` reviews it. "Tier 1" means: affected specs plus `/shot` screenshots in EN and AR, and a short QA note.

### SA-1 — Shared page helpers into `api.js` (do this first; the other PRs build on it)
- **What moves:** these helpers go into `commons/assets/api.js`, next to `el`/`esc`:
  - `jcMsgBox()` and `jcSay(cls, text)`, with the null guard and `scrollIntoView({block:"nearest"})`
  - `jcShowOk`, `jcShowErr`
  - `jcErrTextFor(prefix, code)`, which falls back to `jcErrText`
  - `jcBusy(id, on)`, `jcOn(id, fn)`, `jcEach(sel, fn, ev)`
  - `jcSetUrl(q)` (`q == null` means the bare path)
  - `jcObj`, `jcFinite`, `jcHasPos`, `jcIsAr`, `jcModuleOn(cfg, name)`, `jcHM`
  - `jcHomeFull(h, cfg)`, `jcMyHome(state)`

  `jcTzToday` is rewritten as `jcDateOf(new Date().toISOString(), cfg)`. Pages keep one-line aliases (`function showOk(t){ jcShowOk(t); }`) only where that cuts churn. `ctMsg`/`ctErrText` in admin collapse into one function. Skip `courtById`, which has only 2 copies tied to the courts list.
- **Files:** `assets/api.js`, `pets/pets.js`, `bookings/bookings.js`, `events/events.js`, `home/home.js`, `account/account.js`, `admin/admin.js`.
- **User-visible:** success messages scroll into view on every page, not just Pets and Courts. Decide once: the review M3 reason for scrolling applies to all pages. Account gets the null guard. Nothing else visible.
- **Tier 2. Size: M.** About 7 files and roughly 150–250 lines touched, with a net reduction. Each step is a mechanical swap.
- **Guarding specs:** `account`, `home`, `events`, `event-day`, `courts`, `pets`, `admin*` (all 7), `feedback`, `a11y`, `section-names` (`#msg` is asserted in 20 specs).

### SA-2 — Map kit consolidation (`map.js` + `mapui.css`)
- **What moves into `assets/map.js`:**
  - `jcBigMap(mapId, {cfg, layer, onLayer, full})`: the `L.map` call, the default centre (24.53 / 54.43 / 14 written in one place), `jcMapLayers` and the full-screen button. Pets `bigMap` is the template.
  - `jcFitPins(m, pts, {padding, oneZoom})`: guards an empty list, and settles one padding value and one single-pin zoom.
  - `jcFindMe(btnId, m, {full, zoom, onPos, onError})`: carries Pets' stale-map guard (`map !== m`), and settles on 17 as the zoom.
  - `jcPopHtml({title, meta[], note, openBtn, lat, lng, extraActs, after})`: always uses `rel="noopener noreferrer"`.
  - `jcFitBox` / `jcFitSoon`: the viewport-height fit and its resize/orientation listeners.
  - A `hooks{open, close}` argument on `jcMapPopups`, so Events can drop its hand-written `popopen` toggle and keep only the `[data-report]` binding and the pending repaint.
  - A shared `JC_LABEL_ZOOM`.
- **CSS:**
  - Fold the `.pop` flex/gap rule from `bookings.css:36-37` into `mapui.css` (pick one rhythm).
  - Give the Events venue tooltip `className:"bklabel"`, radius 11 and fillOpacity .95.
  - Replace the `.ptmini` radius literal with `var(--jc-radius)`.
  - Leave `.pinmap` in `app.css`. Home and Admin don't load `mapui.css`, so moving it there means adding a `<link>` to both pages. That change is optional.
- **Optional (needs Zee's yes):** Courts shows pin names only from zoom 17 up, as Pets does, instead of always.
- **Files:** `assets/map.js`, `assets/mapui.css`, `pets/pets.js`, `bookings/bookings.js`, `events/events.js`, `bookings/bookings.css`, `pets/pets.css`.
- **User-visible:** popups are spaced the same in all three map modules, the venue label follows the theme in dark mode, Find Me zooms the same everywhere, and Directions links send no referrer.
- **Tier 2. Size: M–L.** Three map pages, roughly 200 lines.
- **Guarding specs:** `courts`, `events`, `pets`, `looks-pins`, `home` (pin picker `locateBtn`), `event-day`.
- **Why now:** the build queue says "nearest-first" comes next. My inference is that it will reuse Find Me and `userPos`. Building it on `jcFindMe` avoids a fourth copy.

### SA-3 — Load / write / state rows (`nav.js` + `api.js`)
- **What moves:**
  - Into `api.js` (needs no page shell): `jcLatest()`, a stale-response token that replaces 8 `*Seq` counters, and `jcGuard({view, onCode, msg})`, which returns `write(b, call, done, fail)` with its busy state held inside the helper.
    - Start with `ptWrite` and `bkWrite`, which are swapped line for line.
    - Then admin `cdWrite` and the admins write, using an `onCode` hook for `NOT_ADMIN` / `NOT_FOUND`.
    - **Do not** fold in `hhWrite`, `suWrite`, `courtSetStatus` or `mnSave`. Those are different skeletons.
  - Into `nav.js`, next to `jcTabsHtml`: `jcRetryRow(id)`, `jcLoadingHtml()` (always `p.help role="status"`), `jcOffHtml(modKey)` and `jcNoHomeHtml(msgKey)`.
- **Behaviour changes:**
  - Events list, detail and boot errors get a Try Again button.
  - Events does the same client-side `jcModuleOn` pre-check as Courts and Pets, and shows the `ev_off` view. Decide explicitly whether Events can be switched off; `JC_DEST` already says it can.
  - Fix the `e.code` null guard in bookings `loadList` (`bookings.js:103`).
  - Bookings line 240 gets `role=status`.
- **Strings (EN+AR):** rename keys so no module borrows another's:
  - `adm_ad_retry` becomes a neutral `retry`.
  - The `bk_off` / `bk_go_home` keys that Pets borrows become neutral `mod_off` / `go_home`.
  - Pick one no-home wording and one button style.
- **Files:** `assets/nav.js`, `assets/api.js`, `assets/strings.js`, `events/events.js`, `bookings/bookings.js`, `pets/pets.js`, `admin/admin.js`, `home/home.js` (retry).
- **User-visible:** Events has Try Again and an off screen, screen readers announce loading lines on Events, Admin and Account, and the no-home prompt reads the same in every module.
- **Tier 2. Size: M.**
- **Guarding specs:** `events`, `courts`, `pets`, `home`, `admin-courtday`, `admin-admins`, `a11y`, `section-names` ("isn't open" is asserted in events, pets, courts and section-names).

### SA-4 — Shared component CSS into `app.css`
- **Decision first:** `pets.css:1` says "copied: pages carry their own CSS". This PR reverses that choice on purpose. Update the comment to match.
- **What moves into `assets/app.css`:**
  - One `.mini` (+`:disabled`, `.danger`). Choose between 36px and compact; admin keeps only the `.suform .seg4` override.
  - The module shell (`main` / `#view` / `[role=tabpanel]` gap 12, `#view > h1,p,.subtabs`).
  - **One `h2.group`.** Pick 12.5px/.08em or 13px/.06em; there are 3 sizes and 3 margins today.
  - `.notice`, `.row`, `fieldset/legend`, `.chip` with `.miss/.warn/.draft`, and `.status(.ok/.warn)`. Choose the flex or block layout.
  - `textarea`/`select` in the shared input rule (min-height 80, per-form overrides kept).
  - `.btn.danger` (outline) and `.btn.danger-fill`, dropping bare `.danger` in admin and home.
  - `.bklist` (Pets and Courts only, with `overflow-wrap:anywhere` on `li`).
  - `.optrow` for the three `.opts`/`.filters` rows only.
  - `.callout.danger/.warn` for Pets `.alarm`/`.seenbox` (Events `.alert` is optional).
- **Tokens and renames:**
  - Add `--jc-danger-ink` to `tokens.css` and use it at `app.css:60`, twice in `pets.css` and at `index.html:50`.
  - Rename the colliding `.choice` (admin vs home) and the hub's footer `.notice` (to `.fineprint`).
  - Fix `pets.css:111`: use `text-align:start` instead of `right`.
- **Files:** `assets/app.css`, `assets/tokens.css`, `pets/pets.css`, `bookings/bookings.css`, `events/events.css`, `admin/admin.css`, `home/home.css`, `commons/index.html` (token and rename only), plus admin and home JS/HTML for the `.choice` rename.
- **User-visible:** section headings look the same on every page, admin small buttons grow to 36px tap targets, and chip rows look the same on Events, Pets and Feedback. Check the Admin `.seg4` grid and Courts slot rows; `slots.css` loads *after* page CSS in admin and bookings.
- **Tier 1** (cosmetic; `/shot` each page in EN, AR and dark), but it covers 6 pages. **Size: M.**
- **Guarding specs:** `section-names`, `a11y`, `looks-pins`, `courts`, `pets`, `admin-courtday`, `feedback`, `shell`.

### SA-5 — Behaviour decisions (small; ship after Zee picks)
- **Dates:**
  - Add `jcDayTime(iso, cfg, opts)` to `api.js`. It always passes `timeZone: jcTz(cfg)`.
  - Migrate Events `fmtDate`/`fmtTime`/`fmtStamp`, Admin `fmtDate` and the Home invite expiry. **Home currently uses the phone's time zone**, which is a small real bug for a phone not set to Gulf time.
  - Pick the clock format: Events is 12-hour (`en-US`) and everything else is 24-hour.
- **Tab URL:** Admin and Events stop writing `?tab=` for the default tab (they would use `jcSetUrl` from SA-1). Incoming links that include `?tab=` keep working. Many specs assert `tab=` and need updating.
- **Help:** `jcHelp(key, modKey)` passes the module name instead of the key switch in `jcHelpOpen`. Optionally add help to Account.
- **Files:** `assets/api.js`, `assets/nav.js`, `events/events.js`, `admin/admin.js`, `home/home.js`.
- **Tier 2. Size: S–M.**
- **Guarding specs:** `events`, `events-audit`, `event-day`, `admin*`, `home`, `help`, `shell`.

---

## Findings

Verdict: C = confirmed, P = partly. "SA-n" = the PR it goes in.

| ID | Kind | Title | Locations | Recommendation | User-visible | Effort | Verdict |
|---|---|---|---|---|---|---|---|
| msg-helpers | js-dup | msgBox/showErr/showOk/say re-declared in 6 pages, scroll + null-guard drift | pets 47-57, events 36-38, bookings 28-34, home 26-28, account 42-44, admin 184-191 | SA-1: `jcMsgBox`/`jcSay`/`jcShowOk`/`jcShowErr` in **api.js** (Account lacks nav.js); Ok scrolls everywhere | Yes | S | C |
| module-err-text | js-dup | `jcT(prefix+code)` → `jcErrText` fallback copied 6× | pets 54, bookings 35, admin 1673/1773/1819/2045/1250 | SA-1: `jcErrTextFor(prefix, code)`; delete ctMsg/ctErrText twin; hhWrite keeps its per-screen branches | No | S | C |
| busy-button | js-dup | `busy(id,on)` "Working…" toggler ×4 | events 40, home 29, account 45, admin 193 | SA-1: `jcBusy` in api.js | No | S | C |
| on-each | js-dup | `on()` in all 6, `each()` in 3 | all page scripts; admin 192/2154 | SA-1: `jcOn`, `jcEach` | No | S | C |
| setUrl | js-dup | replaceState try/catch: 2 defs + ~11 inline | pets 66, bookings 67, events 295, account 295, home ×4, admin ×5 | SA-1: `jcSetUrl(q)` | No | S | C |
| pure-helpers | js-dup | hObj/hasPos/hm/moduleOn/ar duplicated | pets, events, bookings, admin (see scanner list) | SA-1: `jcObj`, `jcFinite`, `jcHasPos`, `jcIsAr`, `jcModuleOn`, `jcHM`; skip courtById | No | S | C |
| home-label | js-dup | Home label + village join built several ways | events 49-50, pets 84-94, admin 1173, home 36-38 | SA-1: `jcHomeFull`, `jcMyHome`; keep Pets `homeText` (card variant) | No | S | C |
| api-dateof | js-dup | jcTzToday and jcDateOf share one Intl block | api.js 208-215, 245-252 | SA-1: `jcTzToday = jcDateOf(now)` | No | S | C |
| big-map-setup | js-dup | Big-map bootstrap ×3 (centre literal, layers, full, locate) | pets 758-772, bookings 302-318, events ~890-921 | SA-2: `jcBigMap` from Pets template | No | M | C |
| fit-to-pins | js-dup | fitBounds/setView block ×3, padding 40/30/40, single-pin zoom 17/18/17; Pets no empty guard | bookings 329, events 923, pets 773-776 | SA-2: `jcFitPins` (restored in spot-check) | Slight | S | C |
| find-me | js-dup | Find Me handler ×3; stale-map guard only in Pets | pets 762-769, bookings 293-312, events 755-758/916-921 | SA-2: `jcFindMe`; picker flow in map.js:169 stays separate | Yes | S | C |
| popup-shell | markup-dup | `.pop`/`.popacts`/Directions shell ×4–5, rel drift | pets 745/816/827, bookings 268-277, events 786-799, 977 | SA-2: `jcPopHtml`, always `noopener noreferrer` | No | M | C |
| popup-wiring | js-dup | Events re-implements jcMapPopups class toggle | events 904-915; map.js 105-115 | SA-2: add hooks arg; split is deliberate (map.js:106), so use a hook rather than removing the Events wiring | No | S | P |
| fit-map-height | js-dup | fitMap/fitSoon + listeners ×2 | bookings 278-293, events 835-858 | SA-2: `jcFitBox`/`jcFitSoon`; Events keeps evfit in a callback | No | S | C |
| venue-tooltip-drift | inconsistency | Events venue tooltip has no `bklabel`, radius 12, fill .9 | events ~896-899 | SA-2: use `bklabel`, 11, .95 | Yes (dark mode) | S | C |
| pop-css-conflict | css-dup | bookings.css re-declares `.pop` as flex gap 4 | mapui.css 11-18, bookings.css 36-37, events.css 136 | SA-2: one rhythm in mapui.css; `.pop .rep` stays in events.css | Yes | S | C |
| map-labels-popups | inconsistency | Pin names: Courts always, Pets ≥ zoom 17, Events key sheet (venue pin does label) | bookings 322-329, pets 776-792, events 872-898 | SA-2 optional: Courts adopts labels-on-zoom with shared `JC_LABEL_ZOOM`; keep Events key sheet | Yes | M | P |
| ptmini-vs-pinmap-evmap | css-dup | Map box rules at 4 sizes, `.ptmini` radius literal | mapui.css 3, app.css 75-78, pets.css 112, admin.css 81 | SA-2: radius token only; the size differences are intentional | No | S | P |
| write-guard | js-dup | Write-in-flight guard re-implemented 7+× | pets 138-153, bookings 70-85, admin 2002/2089 | SA-3: `jcGuard`; pets+bookings, then cdWrite and the admins write only | No | M | P |
| list-seq | js-dup | Stale-response seq counters ×8; bookings/admin loadDay near-twins | pets 257-299, bookings 89-225, admin 1795-1817 | SA-3: `jcLatest()`; a shared loadFacilityDay is optional | No | M | C |
| retry-and-state-rows | markup-dup | Retry row, working line, no-home, msgBox as strings per page | bookings 189/239/240/350/390, pets 379/397/402/460 | SA-3: `jcRetryRow`, `jcLoadingHtml`, `jcNoHomeHtml` in nav.js; add the missing role=status | No | S | C |
| off-and-nohome-dup | markup-dup | Off/no-home blocks copied; Pets borrows `bk_off`/`bk_go_home` | bookings 189/335/363, pets 378-385, events 352 | SA-3: `jcOffHtml`/`jcNoHomeHtml`, neutral keys, one wording | Yes | S | C |
| events-no-retry | inconsistency | Events load failures have no Try Again | events 204-260, 985-1000, 1028-1032 | SA-3: wire `jcRetryRow`; Home/Account not checked | Yes | M | C |
| events-no-kill-switch | inconsistency | Events has no client-side module-off pre-check or off view; `ev_off` dead | events.js (no `cfg.modules`); strings 205 | SA-3: add `jcModuleOn` + off view. Server already raises MODULE_OFF (events.spec:76), so this is not a dead end today | Yes (minor) | S | P (downgraded) |
| inconsistency-module-off | inconsistency | bookings `loadList` reads `e.code` with no null guard | bookings 103 vs 225 | SA-3: guard it inside the shared loader; admin claim unverified | No | S | P |
| confirm-after-success-wording | inconsistency | Loading line: `.sub` with no role on Events (Admin/Account unchecked) | events 203/987 vs bookings/pets `role=status` | SA-3: `jcLoadingHtml()` | Yes (screen readers) | S | C |
| mini-btn-css | css-dup | `.mini` ×3; admin is smaller with no min-height | pets.css 11-13, bookings.css 5-8, admin.css 52-54 | SA-4: one `.mini` in app.css; reverses the "pages carry own CSS" choice | Yes | S | C |
| shell-css-copies | css-dup | Shell rules copied; `h2.group` at 3 sizes/margins | pets.css 2-6, bookings.css 2/36-41, events/admin/home | SA-4: one shell block + one `h2.group` | Yes | S | C |
| notice-row-fieldset-copies | css-dup | `.notice/.row/fieldset/.chip/.status` copied; `.status` layout drifts; hub `.notice` name collision | pets, bookings, admin, home, events css; index.html 56 | SA-4: into app.css; rename hub `.notice` to `.fineprint` | No | S | C |
| textarea-input-copies | css-dup | textarea styled ×4; app.css has no textarea/select rule | events, admin, pets, home css | SA-4: add to the shared input rule | No | S | C |
| danger-variants | inconsistency | Danger styling spelled 5 ways | admin.css 12/54, home.css ~27-34, pets.css 31-32, bookings.css 6 | SA-4: `.btn.danger`, `.btn.danger-fill`, `.mini.danger` | No | S | C |
| bklist-cards | css-dup | Card list rule repeated; overflow-wrap drift | pets.css 17-24, bookings.css 9-19 | SA-4: merge `.bklist` only; the other 6 lists differ by design | Yes (long text overflow) | M | P |
| pressed-pill-rows | css-dup | aria-pressed rows done 7 ways; `.opts` ×3 drift; `.choice` name clash | pets/events/home/bookings/admin css | SA-4: `.optrow` for the 3 `.opts`/`.filters` rows; rename `.choice` | Yes | M | P |
| callout-boxes | css-dup | Coloured callouts reimplemented | pets.css 30-33/107-111, events.css 115-117 … | SA-4: `.callout.danger/.warn` for `.alarm`/`.seenbox` (+`.alert`); leave orgnote/safety/codebox/adwarn | Yes | M | P |
| index-inline-styles | css-dup | Hub doesn't load app.css and re-declares base rules; raw `#2d0808` ×4 | index.html 35-117, app.css 59-60, pets.css | SA-4: add `--jc-danger-ink` token only; **leave** the hub split, which is deliberate (app.css:59) | Slight | S | P |
| key-sheet-legend-chip | css-dup | `.chip` vs `.legend .chip` | mapui.css 44-45, pets.css 12/56-58, admin.css 139/145 | SA-4: move `.chip` state variants to app.css; **leave** `.legend .chip` (scoped on purpose) | No | S | P |
| rtl-physical-css | css-dup | `pets.css:111` uses `text-align:right` under rtl | pets.css 111; mapui/app map buttons | SA-4: fix `pets.css:111` to `start`; **leave** map-button offsets (deliberate, commented) | No | S | C |
| date-format | js-dup | Raw `toLocale*` + locale ternary ×4; Events 12-hour; Home invite ignores community time zone | events 51-56/536-546, admin 208-213, home 460 | SA-5: `jcDayTime` with `timeZone:jcTz(cfg)`; decide 12 vs 24 hour | Yes | S | C |
| subtab-url-defaults | inconsistency | `?tab=` conventions differ (Admin/Events always write it) | events 69/264/295, admin 79/504/1566/1726 | SA-5: omit the default tab via `jcSetUrl`; Back behaviour is a UX choice, not a defect | No | S | P |
| help-wiring | inconsistency | `jcHelpOpen` hard-codes module keys; Account has no help | nav.js 258+, pages | SA-5: `jcHelp(key, modKey)` | No | S | P |
| whatsapp | js-dup | Two WhatsApp validators with different rules | events 75-78, pets 301-306/639 | **Leave pending decision.** They validate different sources (admin config link vs members-only group link); Pets is strict on purpose | Yes | S | P |
| sheet-dialog-markup | markup-dup | Map Labels button markup ×2 | events 872, pets 427 | **Leave**: 2 sites, minor; fold into `jcBigMap` only if it falls out naturally | No | S | P |
| css-load-order-inconsistency | inconsistency | Shared CSS set differs per page | each `*/index.html` | **Leave**: refactor note. Account lacks tabbar/mapui; the hub lacks app.css; slots.css loads after page CSS | No | S | C |
| confirm-dialogs | inconsistency | `window.confirm` everywhere; Home delete uses typed DELETE | home 193, bookings 444, pets, events, admin (~25) | **Leave**: consistent today; if replaced, add `jcConfirm` and swap all at once | No | L | P |

---

## Refuted / merged

| ID | Outcome | Note |
|---|---|---|
| fit-to-pins (×2) | Merged | Its "kept" target was missing from the verified list. **Restored** above after a code check. |
| css-mini-pop | Merged | Into mini-btn-css + pop-css-conflict |
| pop-shell-html | Merged | Into popup-shell. It also adds sites `pets.js:827` (territory) and `events.js:977-978` (list rows) |
| find-me-handler, map-find-me-handlers | Merged | Into find-me |
| map-init-boilerplate | Merged | Into big-map-setup. The named-pin circleMarker repeat is real but minor |
| fitmap-height | Merged | Into fit-map-height. The claim that Pets doesn't fit the viewport was not verified |
| error-text-mapping | Merged | Into msg-helpers + module-err-text |
| time-format-split | Merged | Into date-format. The bidi-isolate gap (Events/Admin lack U+2066/2069) is real; carry it in SA-5 |
| focus-after-actions | **Refuted** | events/home/admin `show()` all call `jcFocusKeep` |
| events-no-kill-switch | Downgraded C → P | The server enforces MODULE_OFF and a spec covers it; only the client pre-check and the off view are missing |

---

## Coverage & blind spots

- **Out of scope by design:**
  - DB/RPCs (`supabase/`). Whether each RPC enforces MODULE_OFF and admin rights is assumed, not checked.
  - Tests (`tests/e2e`). Only grepped, to map the guarding specs.
  - The personal pages, `jubail-halloween/` and `assets/vendor/`.
- **Static only:** nothing was run. Runtime-only issues were not observed: real RTL layout, dark mode, focus order, Leaflet behaviour on a device, and the double-tap side-effect of the mobile-view extension.
- **Read partially or not at all:**
  - `admin.js`: 3015 lines, about 30% of the client JS, sampled around helpers, errors, confirms and tabs only. The tail of `admin.css` (past line 147) was not read.
  - `home.js` and `account.js` bodies beyond grep hits.
  - Not read: `landing.js`, `rich.js`, `update.js`, `canonical.js`, the help-sheet internals in `nav.js`, the organizer venue-pin picker, and AR string quality.
- **Line numbers** come from main at `d12fc3d`. Several are off by 1–4 lines (events map ranges, textarea, .notice ranges). Re-grep before editing.
- **Plausibility:** the client is about 11.5K lines of page HTML/JS/CSS, plus about 3.9K in `assets/`, of which 2.4K is `strings.js`. 44 findings, mostly small helper duplicates, is in the expected range for a no-build ES5 app where each page boots on its own. **It probably undercounts `admin.js`**, given the sampling. Expect a few more helper copies and state-row copies there once SA-1 and SA-3 grep for them.

---

## Rules to prevent recurrence

1. **CI grep (cheap; add as a step in an existing workflow).** Fail when a page script under `commons/*/` (not `assets/`) contains any of:
   - `function (msgBox|showErr|showOk|busy|on|each|setUrl|hObj|ar)\(`
   - `history.replaceState`
   - `toLocale(Date|Time)?String\(`
   - `24\.53`

   Run the check after SA-1/SA-2 land, so it starts green.
2. **CSS ownership grep.** Fail when `commons/*/*.css` (page CSS) defines a selector that starts with `.mini`, `.pop`, `.notice`, `.chip`, `h2.group` or `textarea` once SA-2 and SA-4 have moved them to `app.css`/`mapui.css`.
3. **Reviewer brief line** (for `code-reviewer` on any `commons/` PR): "Flag any new helper, HTML-string block or CSS rule in a page folder that already exists in `commons/assets/` or in another module. Name the shared function to use instead." This puts the existing "inventory Events/Courts before building" lesson into the review itself.
