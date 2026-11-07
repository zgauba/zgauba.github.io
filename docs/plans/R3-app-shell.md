# R3: App shell (your bottom bar, your start page, "Save as an app", accessibility). Plan (`/plan-change`, 2026-11-07)

> Sources: `docs/plans/ROADMAP.md` R3 and its Decisions ("Navigation: users choose bottom-bar buttons + start
> page"), `docs/qa/SYNTHESIS-2026-11-06.md` S3 (a11y pass), `docs/qa/T5-2-polish-review-2026-11-04.md` #6 (tab
> rows). Live facts were read **read-only** from JubailCommons (`qrpxfssdeeuzmsmlbtbu`) on 2026-11-07 with
> `supabase db query --linked "select …"` (SELECT only) and `curl -sI` against commons.ae / zgauba.github.io.
> **Build order:** R2b-2 is being built now and edits `admin/admin.js`, `events/events.js`, `assets/strings.js`
> and a migration. Any R3 PR that touches one of those files waits until R2b-2 merges (one build agent per
> hotspot file, Decisions 2026-11-06). Planning and the read-only a11y audit can run alongside.

## Step 0: Scope and manifest freshness

**Tier: cross-layer → full protocol.** No migration and no server change, but R3 introduces a **new data
contract** (the shape of `jc_accounts.prefs`, read by the tab bar, the landing page and Settings: ≥ 2 callers),
adds a **new hosting surface** (web manifest + icons served by two hosts), and edits **shared utilities**
(`assets/nav.js`, `assets/api.js`, `assets/app.css`). The split rule fires (Step 4).

**Manifest:** `docs/architecture.md` LAST VERIFIED **2026-11-06** (1 day old, inside 14 days). R3 reads a
`[live]` DB contract, so that part was re-queried today (Step 1, DB rows). Results match the manifest. One note:
the manifest's function count (82 authenticated) predates R2b-1 (#68, merged); I did not re-count, because R3
adds no function. The R2b-1 closeout owns that update.

## Step 1: Inventory (every manifest layer)

| Layer | Touched? | Check (what ran) |
|---|---|---|
| **Personal pages** (`/`, `/jubail/`) | Not touched | `ls` of the R3 file list (Step 4) has nothing outside `commons/`, `tests/`, `docs/`. Same Pages build: an R3 push redeploys them unchanged (shared blast radius, already the norm) |
| **Halloween site** (all layers) | Not touched | no `jh_` or `jubail-halloween/` path in scope; SignalPost not queried or written |
| **Commons frontend** | **Touched.** `assets/nav.js` (tab bar from prefs, shared sub-tab helper), `assets/api.js` (keep the last `jc_me_get`), `assets/landing.js` (start page), `home/home.js` (Settings in My Home → Account), `assets/strings.js` (EN + AR), `assets/app.css` / `tabbar.css`, every page `index.html` head (manifest + iOS tags), new `manifest.webmanifest` + PNG icons; R3c also `events/events.js`, `admin/admin.js` (sub-tab rows) | `grep -rn prefs commons/` → only a comment in `nav.js` L3 ("user-chosen slots … arrive with account prefs later"); no client reads or writes prefs today. `grep -rn 'manifest\|apple-touch\|theme-color\|serviceWorker' commons/` → none (only a data-URI SVG favicon per page). `grep -n jcTabBar` → 4 callers: `landing.js:111`, `events.js:1044`, `home.js:428`, `admin.js:1985`. `grep -n 'role="tab'` → 3 tab rows: `events.js:288`, `home.js:190`, `admin.js:373` |
| **DB / API: `jc_prefs_set`** | **Called (new caller), not changed** | `pg_get_functiondef`: `jc_prefs_set(p_prefs jsonb) returns jsonb`, SECURITY DEFINER, `search_path public, pg_temp`. Gets the caller via `jc_me()` (raises `NOT_SIGNED_IN` / `NOT_MEMBER`); raises `BAD_PREFS` unless the value is a JSON object ≤ 2048 bytes; **replaces the whole object** (`update jc_accounts set prefs = p_prefs where user_id = v_user`); returns `jc_me_get()`. Grants: `postgres, service_role, authenticated` (no anon); in `tests/sql/00_grants.test.sql` L16 allowlist. No rate limit (acceptable: it writes only the caller's own ≤ 2 KB row) |
| **DB / API: `jc_me_get`** | **Read (new key used), not changed** | body read: `account` = `{email, display_name, prefs, joined_at}`; `prefs` already returned. Grants same as above |
| **DB schema: `jc_accounts.prefs`** | Data written (per account), no DDL | `information_schema.columns`: `prefs jsonb NOT NULL DEFAULT '{}'`; constraint `jc_accounts_prefs_check` = `jsonb_typeof(prefs) = 'object'`. `select count(*) … filter (where prefs <> '{}')` → **1 account, 0 non-empty**: no existing data to migrate or collide with |
| **Other functions reading prefs** | Not touched | `select proname … where pg_get_functiondef(oid) ilike '%prefs%'` over `public` + `jc_private` → only `jc_me_get`, `jc_prefs_set`. No snapshot, report, purge or cron reads it |
| **Auth & sessions** | Not changed; **behaviour shifts in the installed app** | iOS home-screen apps get their own storage → separate Supabase session (one more sign-in). PKCE reset (`account.js:213`, `redirectTo: location.origin + location.pathname`) only completes in the browser that holds the verifier, and the email link opens in Safari, **not** the installed app → see premortem #6. Redirect allowlist (`https://commons.ae/**`) unchanged: same origin |
| **Storage** (`pet-photos`) | Not touched | no Storage call in scope |
| **Scheduled jobs + Edge Functions** | Not touched | no cron, `net.*` or `supabase/commons/functions/` path in scope; prefs not read by any job (query above) |
| **Observability** | Not touched | `jc_hit` pages unchanged (the start-page redirect still counts the landing visit, see Step 2) |
| **Tests** | **Touched.** New e2e specs; stub `jc_me_get` gains optional `account.prefs`; stub `jc_prefs_set` | `tests/e2e/specs/stub.js` L42: `MEMBER.account` has **no `prefs` key today** (the client must treat missing = default). `playwright.config.js` serves the repo root at `localhost:4173/commons/`: **path-prefixed**, like github.io, so the relative-URL manifest is exercised under a prefix in CI. No SQL test change (no server change) |
| **Hosting: commons.ae (Cloudflare Pages)** | **Touched (new static files)** | `curl -sI https://commons.ae/manifest.webmanifest` → `404` (no manifest today); `/` sends `cache-control: max-age=0, must-revalidate`, `x-frame-options: DENY`, `frame-ancestors 'none'`. `_headers` applies `/*`, so the manifest and icons get them too (harmless). Branch previews at `<branch>.commons-7ii.pages.dev` serve `commons/` at root: **R3b can be verified on a real host before merge** |
| **Hosting: zgauba.github.io/commons/** | Indirect | `curl -sI` → `200`. `canonical.js` (first script, every page) does `location.replace` to commons.ae, so nobody can install from github.io in practice. Relative `start_url` / `scope` resolve against the manifest URL, so they are correct on both hosts anyway |
| **CSP** | Not changed | every page's `<meta>` CSP has `default-src 'self'` and no `manifest-src`, so manifest fetch falls back to `'self'` (allowed); `img-src 'self' data:` covers same-origin PNG icons. Verify: no CSP console error in the R3b e2e |
| **Service worker / caching** | Not touched, **none exists, none added** | `grep serviceWorker` → none. `update.js` fingerprints page HTML + same-origin script/style ETags every 2 min, reloads when idle. A service worker would add a second cache that can serve stale code on event night; not needed for install (Q5) |
| **CI / CD** | Not changed | `commons-e2e.yml` runs on `commons/` + `tests/e2e/` paths (covers every R3 PR); `review-saved.yml` needs a `docs/qa/*review*.md` per PR |
| **Secrets** | Not touched | nothing new; the manifest holds no key |

## Step 2: Impact map

### A. Saved preferences contract (new, client-defined)

Stored under one namespaced key so future prefs (e.g. a language choice) can live beside it:

```json
{ "shell": { "v": 1, "tabs": ["events", "commons"], "start": "events", "known": ["commons", "events", "admin"] } }
```

- `tabs`: the chosen middle buttons, in order. **My Home is never stored**: it is always added last.
- `start`: one destination key.
- `known`: the destinations offered when the person saved. A destination that becomes available later (a module
  switched on) is **added to the bar automatically** if there's room, so a customised bar never hides a new module
  (premortem #2b).
- **Write path:** Settings → `jc_me_get` (fresh) → merge **only** `shell` into the returned `account.prefs`
  (unknown keys kept as they are) → `jc_prefs_set` → use the returned `jc_me_get`. `BAD_PREFS` (over 2 KB) shows
  an error and saves nothing.
- **Read path:** `jcState()` already calls `jc_me_get`. `api.js` keeps the last result (`JC_ME`), so `jcTabBar`
  reads prefs **without any caller changing its call** (the 4 callers, including `admin.js` / `events.js`, stay
  untouched in R3a). A strict reader (`jcShell(me, cfg)` in `nav.js`) validates on every render: the version is
  known, keys are in the registry, duplicates dropped, no more than 4 middle buttons, unavailable ones dropped.
  Anything odd falls back to the default. **Prefs strings are never rendered**, only mapped to registry entries
  (no self-XSS surface).

### B. Bottom bar from a registry (`nav.js`)

A destination **registry**: `commons` (hub), `events`, `bookings` (Courts), `pets`, `community`, `admin`
(Organizer Tools), `home` (fixed). Each entry has the page path, icon, label key, and an `available(me, cfg)`
rule:

- a module destination needs its flag **on** *and* its page to exist. Today only `events/` exists.
  **Secondary finding:** today's `jcTabBar` adds a Courts button whenever `bookings` is on, but there is no
  `bookings/` page, so it would 404. Not live (all modules off). The registry fixes it, and R4/R5/R6 add their
  entries when their pages ship.
- `admin` needs an organizer, event admin or owner. That's display only: the server gates every admin RPC.
- **Default (no prefs) = today's bar exactly:** Commons · live modules · My Home. Existing users see no change.
- **Consumers:** hub, Events (list + event page incl. full-screen map), My Home, Organizer Tools all draw the bar.
  The event page's `fitMap` sizes the map down to the bar (`innerHeight`), so the bar's height must not change.
  The bar keeps `aria-current="page"`. Organizer Tools passes `active="admin"`, which today highlights nothing
  and will highlight its button when chosen.
- **Could break:** an empty or broken bar (registry filter bug), the active highlight lost, or the event map
  height changing. Covered by Step 3 #1–#4.

### C. Start page (`landing.js`)

- When a signed-in member with a home opens the hub (`commons/`) as the **first page of this browser session**
  and has a start page that isn't `commons`, the hub sends them on with `location.replace` (no extra history
  entry, so Back doesn't loop). "First page of the session" = `sessionStorage` flag that `api.js` sets on every
  Commons page load. Tapping **Commons** in the bar later always shows the hub. Q2 has the alternatives.
- **Never applies to:** deep links (an event link from WhatsApp, an invite, a grant link: none of them land on
  the hub), a member without a home (the existing redirect to `home/` wins), signed-out visitors (picker), a
  start page whose module is off (stays on the hub).
- **Order:** it needs `jc_me_get` (prefs) **and** `jc_config_get` (module flags). The landing already waits for
  both before choosing hub vs picker, so the redirect happens before the hub paints (no flash). Cost: the target
  page runs its own `jcState()`, which is one more `jc_me_get` at app open (premortem #3).
- **Visit counter:** `jcHit('landing')` fires before the redirect, so landing hits still count app opens.
  Acceptable and documented.
- **Assumption to verify:** `sessionStorage` is new per cold launch of an iOS home-screen app and per new Safari
  tab. Verify on a real iPhone (R8 real-device pass already lists "Save as an app").

### D. Settings screen (My Home → Account)

- New section "Bottom bar and start page": each available destination is a row with a **Show** switch and
  **Move up / Move down** buttons (no drag: works with a keyboard and a screen reader, and works the same in RTL).
  My Home is shown as a fixed last row, "always shown". Start page is a radio group. One **Save** button.
- **Includes the install help** (R3a, since it needs strings): "Save as an app" steps for iPhone (Share → Add to
  Home Screen) and Android, plus the two gotchas in plain words: you sign in once more inside the app, and a
  password-reset link opens in Safari.
- **Interactions:** `update.js` treats an unsaved change as "busy" only for text inputs. The switches are
  buttons, so the reader must keep the pending state across a re-render the way `draftName` does (polish #1
  pattern). A tab switch or language toggle keeps unsaved choices.
- **Consumers:** `home.js` Account tab already holds display name, sign out, feedback, leave, delete, and the
  organizer link. The new section goes **above** feedback; nothing else moves.

### E. "Save as an app" (static)

- `commons/manifest.webmanifest`: `name`, `short_name` (Q3), `start_url: "./"`, `scope: "./"`,
  `display: "standalone"`, `background_color` / `theme_color` `#141210`, icons 192 / 512 (+ maskable 512). Every
  URL is **relative to the manifest file**: `/` on commons.ae and `/commons/` on github.io / local e2e. `id`:
  **I need to verify** the resolution rule against MDN at build time. It must be fixed before launch, because a
  changed `id` makes installed copies a different app.
- Every page `<head>` (`index.html`, `account/`, `admin/`, `events/`, `home/`; not `404.html`):
  `<link rel="manifest">`, `<link rel="apple-touch-icon">` (180 px PNG; iOS ignores SVG), `<meta name="theme-color">`,
  `<meta name="apple-mobile-web-app-title">`. Status-bar style **default / black, not black-translucent**:
  translucent would put content under the status bar, and only the full-screen map handles
  `safe-area-inset-top` today (`events.css:164`).
- Icons: PNGs made once from the existing mark (the reduced 6-dot cut used for the favicon) and committed. No
  build step is added; the PR records how they were made.
- **Standalone mode loses the browser's Back button and pull-to-refresh.** Every sub-screen already has an
  in-app back (`jcBack`) or the bar. New versions arrive via `update.js` (polls + on resume), so no refresh is
  needed. The 404 page has a home link. External links (Directions, WhatsApp, credit) leave the app scope and
  open in the system browser view, which is fine.
- **Content-type:** `.webmanifest` should be `application/manifest+json` on both hosts. **I cannot confirm**
  Cloudflare Pages' and GitHub Pages' mapping without a deploy. Check it on the R3b branch preview
  (`curl -sI <branch>.commons-7ii.pages.dev/manifest.webmanifest`). Fallback: name it `manifest.json`.

### F. Tab rows + accessibility (R3c)

- One shared helper in `nav.js` (`jcTabs`) used by the 3 tab rows (event Map · List · My Sign-Up; My Home;
  Organizer Tools): `role="tablist"` with an accessible name, `role="tab"` with `aria-controls` → a
  `role="tabpanel"` wrapper (`aria-labelledby`), roving `tabindex`, ←/→ (mirrored in RTL) + Home/End, and
  **focus restored to the selected tab after the re-render** (admin already does this, `admin.js:425`; events and
  My Home lose focus). URLs (`?tab=`) and `history.replaceState` behaviour unchanged.
- Other fixes come from the audit (preliminary code-read findings below). Strings that change go through
  `strings.js` EN + AR.

**Preliminary a11y findings (code read only, 2026-11-07, input to the R3c audit; not a substitute for it):**

| # | Where | Finding | Severity (WCAG 2.1 AA) |
|---|---|---|---|
| P1 | event / My Home / Organizer tab rows | `role="tab"` without `tabpanel`, `aria-controls`, roving tabindex or arrow keys; focus lost on re-render (events, My Home) | Med (4.1.2, 2.4.3) |
| P2 | `nav.js` tab bar | `<nav aria-label>` = "Commons", the same as its first button. Should be a distinct name ("Main") | Low (2.4.6) |
| P3 | `app.css:34` | `:focus-visible` outline covers `input, button, a` only, so `textarea`, `select` and `[tabindex]` (Leaflet markers, `keyboard: true`) rely on browser defaults on a dark surface | Med (2.4.7) |
| P4 | `.tabbar a` | 11 px labels; 44 px targets OK. Check 200 % text zoom doesn't clip | Low (1.4.4) |
| P5 | every view | whole-view `innerHTML` re-render: focus falls to `<body>` after most actions (save, publish, confirm) except where a `focus()` exists | Med (2.4.3), audit per screen |
| P6 | language button | the label is in the *other* language with no `lang` attribute on it, so screen readers mispronounce it | Low (3.1.2) |
| P7 | tokens | `--jc-muted` / `--jc-faint` / accent pass AA on `--jc-bg` (faint was fixed to 4.77:1). Not re-checked: `--jc-muted` on `--jc-surface-2` and event looks' accents (`data-look`) | verify in audit (1.4.3) |
| — | good | `aria-current` on the bar; `aria-pressed` on toggles; native `<dialog>` help; `role="alert"` messages; 44 px targets; no zoom lock | — |

## Step 3: Regression surface (must keep working)

1. **No prefs (every account today):** the bar is exactly Commons · Events (when on) · My Home on the hub, Events
   list, event page, My Home, Organizer Tools; the active button is highlighted (`aria-current`).
2. **Module off:** with every module off (the live state for `jubail`), the bar is Commons · My Home and the hub
   shows "coming soon" cards. A saved Events button or Events start page silently drops out.
3. **Event page map height** (`fitMap` to the bar) and **full-screen map** (Close stays visible, Escape) unchanged
   in EN + AR.
4. **Banner** (`jcBanner`) on every member page and the hub's own `#bcast`; **back** button and **"?" help** in
   the top bar.
5. **Hub routing:** a member without a home → `home/`; signed out → picker without a network wait; not a member →
   "Finish joining".
6. **Deep links:** `events/?id=…&tab=map|list|mine`, `home/?invite=…`, `admin/?eventadmin=…`, `admin/?event=…`,
   `home/?view=pin&next=…`, and sign-in `?next=` (`jcSafeNext`) all land where they do today, never on the start
   page.
7. **My Home Account tab:** display name (unsaved name survives a tab switch + language toggle), sign out,
   feedback (`#feedback` anchor from the hub link), leave, delete (typed DELETE), organizer button / "Have an
   organizer code?" link.
8. **`?tab=` deep links** on My Home (`home|household|account`), event page (`map|list|mine`), Organizer Tools;
   `replaceState` URLs unchanged; language toggle keeps the tab.
9. **Auto-update:** reload when idle, banner when mid-form / on the pin map. The Settings section counts as "mid-form"
   while unsaved.
10. **github.io → commons.ae forward** keeps path, query, fragment; the Cloudflare frame headers still sent; `404`
    still 404.
11. **Arabic / RTL** on every changed screen; Western digits.
12. **Event day:** 2-min refresh, switch / supply / reports, R2b-1 organizer acts. These are untouched files in
    R3a/R3b, but R3c changes the event tab row they live under.

## Step 4: Proposal: three PRs

The split rule fires: a new contract read by ≥ 2 callers (tab bar, landing, Settings), three layers (frontend,
data contract, hosting), and three independent goals. **Split Protocol** result:

| PR | What | Files | Hotspot overlap with R2b-2 | Risk | Diff budget | Tier (`/ship-pr` 1b) |
|---|---|---|---|---|---|---|
| **R3b**: Save as an app | manifest + PNG icons + head tags; no JS | new `commons/manifest.webmanifest`, `commons/assets/app-icons/*.png`; heads of `index.html`, `account/`, `admin/`, `events/`, `home/index.html`; new `tests/e2e/specs/app-manifest.spec.js`; `docs/architecture.md` hosting line | **None:** R2b-2 edits `admin.js` / `events.js` / `strings.js`, not the `index.html` files (**confirm with the R2b-2 agent before starting**) | L–M (static; the one irreversible part is the installed name/id) | ~40 LOC + ~70 test + binaries | screen logic: suite + CI + `code-reviewer` + branch-preview curl |
| **R3a**: Your bar + start page + Settings | registry, prefs reader/writer, start page, Settings UI, install help, standalone reset note | `assets/nav.js`, `assets/api.js`, `assets/landing.js`, `home/home.js`, `home/home.css`, `assets/strings.js`, `account/account.js` (reset note), `tests/e2e/specs/{shell,stub,backends}.js` | **`strings.js`**, so it waits for R2b-2 to merge. **Not** `admin.js` / `events.js`: the bar reads `JC_ME` from `api.js`, so no caller changes | M (new contract; per-account data written) | ~260 code + ~170 test ≈ **430** (over the 200 cap, see below) | screen logic: suite + CI + `code-reviewer` (+ `security-reviewer` light pass on the prefs reader, since it parses stored JSON) |
| **R3c**: Accessibility | audit doc, then the shared tabs helper + the 3 tab rows + audit fixes | `docs/qa/R3-a11y-audit-2026-11-xx.md`; `assets/nav.js`, `assets/app.css`, `events/events.js`, `home/home.js`, `admin/admin.js`, `assets/strings.js`; `tests/e2e/specs/a11y.spec.js` | **`events.js`, `admin.js`, `strings.js`**: after R2b-2 **and** after R3a (`nav.js`, `home.js`) | M (touches 3 busy screens) | ~150 code + ~120 test (fix list may grow; anything beyond the tab rows + P2/P3/P6 goes to a follow-up if > 300) | screen logic: suite + CI + `code-reviewer` |

**Order:** **R3b now** (in parallel with R2b-2, no shared files) → **R3a** after R2b-2 merges → **R3c** after R3a
merges. The **R3c audit** (a read-only document) can run any time, ideally *before* R3a is built so the Settings UI
is built to it; R3c's checks then re-cover Settings.

**Why R3a stays one PR at ~430 LOC:** splitting reader from writer ships either a reader nobody can feed or a
Settings screen that changes nothing (the same call as R2b-1). The pilot question (Split §5 #2) is answered
inside it: the hardest uncertainty is "start page fires exactly once and never on deep links", and R3a's tests
target that directly. Tests are ~40 % of the diff.

**Why the tab-row fix is not in R3a:** it touches `events.js` / `admin.js` (more waiting on R2b-2, more blast
radius on event-night screens) and is a different review lens. It still lands with the nav rebuild, as the
roadmap and S3 ask (after it, never before).

**Cost:** none (no paid layer). One more `jc_me_get` per app open when a start page is set (free tier).
**Migration / re-seed / cache invalidation:** none. No SQL. Installed home-screen apps can't be updated by us
(name and icon baked in at install), so Q3 is settled before R3b merges.

## Step 5: Premortem (catalog §0.5)

| # | Mode | Exposed? | Mitigation |
|---|---|---|---|
| **1** | **Silent data corruption** (mitigation required) | **Yes.** `jc_prefs_set` **replaces the whole object**: a Settings save from a stale copy wipes another key or another phone's change. A future client writing a new `v` could be misread by an old client. | Write = **fresh `jc_me_get` → merge only `shell` → `jc_prefs_set`**. e2e asserts the sent payload keeps an unrelated key (`{"x":1}`) untouched. The reader is strict on `v` (unknown version = default bar, never a guess) and on keys. e2e feeds junk (`tabs: "x"`, unknown keys, 50 entries, `start: "javascript:"`) and asserts the default bar. `BAD_PREFS` surfaces as an error (new `err_BAD_PREFS` string) |
| **2** | **Silent zero-output** (mitigation required) | **Yes.** (a) Save "succeeds" but the bar doesn't change (wrong key read, `JC_ME` not refreshed). (b) The start page never fires, or fires on every Commons tap (hub unreachable). (c) The registry filters everything out → empty bar. | (a) e2e: save → assert exact `jc_prefs_set` args → reload → assert bar order and `aria-current`. (b) e2e: first load of `commons/` with `start=events` lands on `events/`; tapping Commons then shows the hub; a deep link to an event never redirects; module off → hub. (c) **Invariant in code + test:** My Home is always rendered (it's added outside the filter); e2e with every module off and organizer-only prefs on a non-organizer |
| **2b** | **Out-of-band config drift** (mitigation required) | **Yes, three.** (a) The saved bar is a frozen copy of module availability: a module switched on later (Courts at R8) would never appear for someone who customised. (b) The installed app's name and icon are frozen on the phone at install. (c) The manifest isn't in `update.js`'s fingerprint. | (a) **`known` list**: new destinations get appended (room permitting), and every render re-filters against the **live** `jc_config_get` flags (never cached), so a module switched off disappears at once. e2e for both directions. (b) **Static-by-design note**: name/icon chosen once (Q3) before any resident installs (launch rule: none yet); the R3b PR description and manifest record it. (c) **Static-by-design**: browsers re-fetch the manifest themselves; nothing in the running page depends on it. No service worker (Q5), so there's no second cache to drift |
| 3 | Cost blowout | Minimal | +1 `jc_me_get` per app open with a start page. Bounded by app opens; free tier. No monitoring needed |
| 4 | Contract drift | Yes, small | Stub `MEMBER.account` has no `prefs` today, so a missing key = default (e2e runs both shapes). `jc_prefs_set` / `jc_me_get` signatures unchanged (both in the `00_grants` allowlist). iOS / Chrome install behaviour changes by OS version: verified on a real iPhone + Android Chrome in the R8 pass; `id` rule verified at build |
| 5 | Race / ordering | Yes, accepted | Two phones saving at once = last write wins (whole object). Read-before-write narrows the window; the loser's choice is visible and redoable. Start-page redirect vs `update.js` reload: the reload happens in a flagged session, so no redirect loop. Redirect vs sign-in: the account page sets the session flag, so sign-in returns to the hub or `next` (Q2) |
| **6** | **Auth / RLS regression** (mitigation required) | **No server change; two client-side auth-flow exposures.** (a) **Password reset from inside the installed iPhone app fails**: the email link opens in Safari, which lacks the PKCE verifier. (b) Organizer Tools as a bar button shown to a non-organizer. (c) Prefs of another account. | (a) R3a: in standalone mode (`navigator.standalone` / `display-mode: standalone`), the reset screen says to request the reset from Safari and then sign in here. The Settings install help says the same. **Gap window:** R3b ships before R3a, but no resident has an account (launch rule), so it is closed before launch. The **R8 checklist** gains "reset from an installed app" (Step 8). (b) The registry's `available` uses `admin_scopes` / `admin_events` / `is_owner`; display only, and every admin RPC still gates server-side (`jc_assert_*`). e2e: a plain member with `tabs:["admin"]` sees no Organizer button. (c) `jc_prefs_set` writes `where user_id = auth.uid()` (via `jc_me`), confirmed in Step 1; not reachable by anon (grants) |
| 7 | Rollback | Yes | Each PR = `git revert` (Cloudflare redeploys in ~1 min). Saved prefs left in `jc_accounts` are ignored by the old client (harmless, ≤ 2 KB each; clear with `update jc_accounts set prefs = prefs - 'shell'` only on Zee's say-so). **Can't roll back:** home-screen icons already installed. After a revert of R3b they still open `commons.ae/` as a plain bookmark-like window, which still works. Hence Q3 before merge |

## Step 8: Verification (outline, when built)

**R3b (Save as an app)**
- e2e (both browsers, path-prefixed server): every page links one manifest; the manifest fetches 200 and parses;
  `start_url` / `scope` resolve **inside** `/commons/` locally; each icon URL returns 200 `image/png` at its
  declared size; no CSP violation in the console; `apple-touch-icon`, `theme-color`, `apple-mobile-web-app-title`
  present on every page; the github.io forward test still passes.
- Branch preview (real host, before merge): `curl -sI https://<branch>.commons-7ii.pages.dev/manifest.webmanifest`
  → 200 + content-type recorded; Chrome DevTools → Application → Manifest shows no installability errors.
- Real devices (Zee, ~5 min, can wait for R8): iPhone Safari → Share → Add to Home Screen shows the chosen name +
  icon; opens without browser bars; sign in once; Back works via the in-app back on an event page. Android Chrome →
  Install app.

**R3a (bar + start page + Settings)**
- e2e: default bar unchanged for an account with no prefs and for `prefs: {}`; Settings shows available
  destinations only; hide / reorder / start → exact `jc_prefs_set` payload (merge keeps `{"x":1}`) → reload → bar
  order + `aria-current` match; My Home always last; organizer-only button hidden for a member; module off drops a
  saved button and the start page; a newly enabled module appears for a customised account (`known`); junk prefs →
  default; `BAD_PREFS` → error text, nothing changes; start page fires on the first `commons/` load only, never on
  a second Commons tap, a deep link, a sign-in `next`, or a member without a home; unsaved Settings survive the tab
  switch + language toggle; `update.js` shows the banner (not a reload) while Settings is unsaved; standalone
  emulation shows the reset note; EN + AR + RTL for every new string; WebKit lane.
- Manual (e2e community, real backend, Zee or smoke): save a bar on phone A, open on phone B → same bar. Read-only
  SQL after: `select prefs from jc_accounts where …` shows only `shell` added.

**R3c (accessibility)**
- Audit doc first (`design:accessibility-review` approach over hub, events list + event page, My Home, Organizer
  Tools, and R3a's Settings): every finding with severity + disposition, saved in `docs/qa/`.
- e2e: on each of the 3 tab rows, ←/→ (and mirrored in AR), Home/End move selection; focus stays on the selected
  tab after re-render; `aria-controls` points at an existing `tabpanel`; `?tab=` URLs unchanged; the tab bar has a
  distinct accessible name; `:focus-visible` outline on textarea/select. axe-style checks per Q4.
- Manual: VoiceOver on iPhone across the four screens (Zee or R8 real-device pass).

**Post-deploy (each PR):** `curl -sI https://commons.ae/` frame headers still present; R3b also checks
`/manifest.webmanifest` 200 on commons.ae; manifest closeout (Hosting layer: manifest + icons; Frontend: prefs
contract `shell` v1, registry; Known Gaps: installed-app reset in Safari) with LAST VERIFIED bumped. No cron or
Edge Function, so no firing check (§8c n/a).

## Open questions for Zee (each with a recommendation)

1. **Which buttons may go in the bar, and how many?** **Recommend:** up to 4 of Commons, Events, Courts, Pets,
   The Community (each only once its page exists and its module is on), plus **Organizer Tools for organizers
   only**, then My Home fixed last: 5 buttons max (the bar's width at 44 px targets). Commons may be hidden (the
   logo in the top bar still opens it).
2. **When does the start page apply?** **Recommend:** the first page of each visit (a new app launch or a new
   browser tab), applied only when that first page is the Commons home. A shared event link always opens the
   event, and tapping Commons in the bar always shows the hub. *Alternative:* only when launched from the
   home-screen icon (simpler, but people using Safari never get their start page).
3. **The installed app's name under the icon** (frozen on each phone at install). **Recommend: "Commons"**: it is
   short (iOS truncates at ~12 characters), matches commons.ae, and stays right when a second community arrives.
   "Jubail Commons" would be wrong for any other community on the same domain.
4. **Automated accessibility checker (axe) in the test suite?** **Recommend: yes, test-only.** Add
   `@axe-core/playwright` as a pinned dev dependency under `tests/e2e/` (never served, not in `commons/`), failing
   only on serious/critical issues on the four main screens. The new dependency gets a short security review in
   the R3c PR.
5. **Add a service worker (offline support)?** **Recommend: no.** Installing doesn't need one on current iPhone or
   Android Chrome (verify at R3b build), and a second cache can serve yesterday's code on event night, which
   undermines the auto-update and the 1-minute hotfix path. Revisit after launch if people ask for offline.

## Decisions (Zee, 2026-11-08: plan and three-PR split approved)

1. **Bar buttons:** agreed (up to 4 of Commons, Events, Courts, Pets, The Community, then My Home fixed last, 5 max).
   **Changed:** Organizer Tools is an addable button for **every kind of admin**: community admins, module admins
   (e.g. a Courts admin, see R4 Q10) and per-event admins. It is never shown to a plain member.
2. **Start page:** agreed: the first page of each visit only, never on deep links, and tapping Commons always shows
   the hub. **New roadmap item (not R3):** a "News" section on the Commons home for community and household
   information, sequenced after R3a.
3. **Installed name:** "Commons". This settles the one thing that can't be undone before R3b merges.
4. **axe:** yes, test-only, pinned under `tests/e2e/`.
5. **Service worker:** no.

**Adopted from the R4 plan (coordination):**
- C1: the registry's module list includes `bookings`, labelled **"Courts"**, at path `bookings/`.
- C2: the default bar is **Events + Courts** (then My Home).
- C3: Courts appears only while its module is on. A resident's saved choice is kept while it is off and comes back
  when it is switched on.
- C4: no per-module shortcuts in the web manifest.
- C5: the admin sub-tab component (R3c) treats Courts as one more entry.

## Executive summary

**What this change does:** Lets each resident choose which buttons sit in the app's bottom bar and which screen
the app opens on (saved to their account, so it follows them to any phone), lets them put Commons on their
phone's home screen like a real app, and fixes the places where keyboard and screen-reader users lose their way.
It ships as three small releases.

**Biggest risk:** The home-screen version on iPhone runs separately from Safari, so a password-reset email
(which always opens in Safari) won't work from inside it, and the app name chosen now is frozen on every phone
that installs it. Both get settled before any resident is invited.

**Recommended next step:** Approve the three-release split and answer the five questions (especially the
installed name). The "Save as an app" release can start now, alongside the work already in progress; the other
two wait until that work is finished.
