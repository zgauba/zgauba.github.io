# RM — Renamable modules (plan, 2026-11-10)

> Status: **Q1–Q5 approved (Zee 2026-11-10)**. RM-a applied (PR #88); RM-b client (this branch). AR name cap 18 (RM-a review).
> Scope tier: **cross-layer** (DB column + RPC + `jc_config_get` contract + 7 client files).

## Goal

Every module keeps a fixed key (`events`, `bookings`, `pets`, `community`; `directory` later). A community admin
can give it a **name** (short — the bar, tabs, Settings) and an optional **title** (the brand — page heading,
hub card), in EN + AR. Nothing is set = today's labels, so no screen changes until someone renames.

## Inventory (checks that ran)

| Layer | Touched? | Check |
|---|---|---|
| DB `jc_communities` | **Yes** — new column | live `information_schema.columns`: `modules jsonb` holds `{enabled, …caps}` per key; `brand jsonb` is `{}` on jubail; no names stored anywhere |
| RPC `jc_config_get(text)` | **Yes** — body only, adds `labels` | live `pg_get_functiondef`; 6 callers: landing, account, events, bookings, home, admin (grep `jc_config_get commons`) |
| Admin RPCs | **Yes** — one new | live `pg_proc`: no RPC writes names; `jc_admin_booking_rules` is the only one touching `modules` |
| Module flags | Not touched | flags are flipped **out-of-band** by UPDATE on `modules` (manifest); RM must survive that |
| Client — name surfaces | **Yes** | grep `module_*`/`feat_pets`/`ev_title`/`jcT(…label)`: `nav.js:11-14,101` (bar), `home.js:352,373` (Settings bar + start page), `landing.js:106-109` (hub cards), `events.js:210,1061` + `bookings.js:364-370,561` (H1 + document title), `admin.js:84-89,500` (Organizer Tools tabs), strings `scope_*`/`adm_ad_scope_*` (Admins screen), `help_*_title` |
| Client — sentences naming a module | **Judgement call (Q1)** | ~78 EN strings mention Events/Courts/Pets/Community inside a sentence (e.g. `bk_off` "Courts aren't open yet…", `ct_module_off`, `adm_ad_can_bookings`) |
| Web app manifest | Not touched | `commons/manifest.webmanifest` is platform-wide ("Commons"), names no module |
| Halloween site / SignalPost | Not touched | no `jc_` reads; RM is JubailCommons only |
| Cron / Storage / Edge | Not touched | no job or bucket reads module names (grep migrations) |
| Cost | none | no paid layer |

**Found along the way:** the default Pets title "Pets of Jubail" is Jubail-specific copy hard-coded in the
platform strings (`module_pets`), and the bar already uses a generic short form (`feat_pets` "Pets"). That is
exactly the name/title split — RM moves "Pets of Jubail" into Jubail's own config row and makes the
built-in default generic.

## Questions for Zee

| # | Question | Recommendation |
|---|---|---|
| Q1 | Where does a rename show? Module names sit inside ~78 sentences; templating them breaks Arabic grammar (gender/plural agreement) | **Headline places only** — bar, page heading, browser title, hub card, Settings, Organizer Tools tab, Admins screen scope names, Help sheet title. Reword the few "X aren't open yet" notices to name-free ("This section isn't open yet"). Other sentences keep the generic noun |
| Q2 | Arabic required? | **Yes — a name is EN + AR together, or neither** (no half-renamed bar in AR). Title: each language optional, falls back to the name |
| Q3 | Length caps | **Name ≤ 14 characters EN, ≤ 18 AR** (AR built-in «الحيوانات الأليفة» is already 17; bar fits 5 × 44 px buttons on a 360 px phone; longest today "The Community" = 13). **Title ≤ 40** |
| Q4 | Who renames | **Community admins only** (not Courts/Pets admins). Logged in the Admin Log |
| Q5 | Which modules | **Events, Courts, Pets, The Community** now; `directory` joins in its own migration |

## Design

- **Storage: a new column `module_labels jsonb`**, not inside `modules.<key>` (deviation from the ROADMAP note).
  Reason: flags are switched out-of-band by UPDATE on `modules`; a whole-object update would silently wipe the
  names (premortem #2b). Shape: `{ "<key>": { "name": {"en","ar"}, "title": {"en","ar"} } }`, check = object.
- **`jc_admin_module_label_set(p_module, p_name_en, p_name_ar, p_title_en, p_title_ar)`** — community scope;
  whitelisted keys; text cleaned (`jc_clean_line`); caps; name both-or-neither; all blank = reset to default;
  refuses a name another module already uses (case-insensitive, per language); per-key `jsonb_set` under a row
  lock; logs `module_label_set {module}` (no text in the log needed — the config shows it).
- **`jc_config_get`** adds `'labels', c.module_labels` (additive key; signature unchanged).
- **Migration seeds Jubail**: `pets.title = "Pets of Jubail" / «حيوانات الجبيل الأليفة»`; built-in `module_pets`
  becomes generic "Pets" / «الحيوانات الأليفة».
- **Client:** one helper pair in `api.js` — `jcModName(key, cfg)` / `jcModTitle(key, cfg)` → config value for
  the current language, else the built-in string. Last-seen labels cached per community in `localStorage` (same
  pattern as `jcCommunityName`, so no flash of the old name). Every headline call site above switches to the
  helper. Editor: Organizer Tools → Community → **Section Names** (one row per module: name EN/AR, title EN/AR,
  Reset). All output stays `esc()`-ed.

## PR split

| PR | Contents | Tier |
|---|---|---|
| **RM-a** | Migration (column, RPC, `jc_config_get` body, Jubail seed), SQL slice `s22`, grants | 3 — `/db-rehearse`, DB + security review |
| **RM-b** | Helpers + cache, call-site swaps, name-free off notices, Section Names editor, EN/AR strings, e2e | 2 — code review (bump to 3 if the editor touches auth paths) |

Size: RM-a ~120 SQL + ~180 test; RM-b ~250 lines across 7 files. RM-b overlaps R5b files (`strings.js`,
`nav.js`) → strictly before R5b, no parallel build agents.

## Regression surface

Bar shows the same five buttons with today's labels on a community with nothing set; saved custom bars
(`prefs.shell`) unaffected (keys, not labels); start page still opens; hub cards + Coming Soon unchanged;
Events/Courts headings and browser titles unchanged; Organizer Tools tabs unchanged; Admins screen scope names
unchanged; AR + RTL identical; config-failure path still shows defaults + error bar; module flags still hide
destinations; `jc_config_get` callers ignore the extra key.

## Premortem (§0.5)

| # | Exposed? | Mitigation |
|---|---|---|
| 1 Silent corruption | Renaming one module overwrites another's names | per-key `jsonb_set` + row lock; s22 test renames A then B and asserts A intact |
| 2 Silent zero-output | A screen still calls the built-in string, so a rename silently doesn't show there | e2e renames every module and asserts each headline surface; a static check fails if `jcT("module_…")` appears outside the helper |
| 2b Config drift | Out-of-band flag UPDATE wiping names; stale cached labels | separate column (flags never touch it); cache overwritten on every config load, keyed by community id |
| 3 Cost | No | — |
| 4 Contract drift | `jc_config_get` gains a key | additive; all 6 callers read named keys only (checked) |
| 5 Race | Two admins rename at once | row lock; last write wins per module — acceptable |
| 6 Auth | New write RPC; names readable by anon (like `brand`) | community scope via `jc_assert_admin('community')`; anon/public revoked; names are public by design and capped short — no secrets fit the shape |
| 7 Rollback | — | Reset per module from the editor; down: drop RPC, restore `jc_config_get` body, drop column, restore `module_pets` string |

Accepted gap: admin-typed Arabic is not native-reviewed (it is the community's own text, like event titles).

## Verification (RM-b)

e2e (stubbed): defaults unchanged EN + AR; rename Courts → bar, hub card, heading, browser title, Settings,
Organizer Tools tab, Admins screen all show it; AR shows the AR name; title set → heading/hub card use title,
bar uses name; Reset restores; 15-char name refused; non-community-admin doesn't see the editor.
Manual (phone): rename Courts to "Sports" on JubailCommons, check the bar at 5 buttons on a small phone, Reset.
