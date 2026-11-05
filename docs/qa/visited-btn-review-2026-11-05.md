# Visited link-buttons — review (2026-11-05)

**Report (Zee):** the green Sign Up button showed no label on desktop (fine on phone); persisted with extensions removed.

**Root cause:** `commons/assets/app.css` has `a:visited{color:var(--jc-accent)}` (specificity 0,1,1), which beats
`.btn{color:var(--jc-accent-ink)}` (0,1,0). Any `<a class="btn">` the browser had already opened drew its label in
the accent color on the accent background → invisible. Desktop had visited `?id=…&tab=mine`; the phone hadn't.
Ghost buttons were unaffected only by accident (`.btn.ghost` is 0,2,0). Not the auto-dark issue fixed in #47.

**Affected:** every solid link-button — events list Sign Up (`events.js:128`), event detail links (`events.js:222, 248`),
account (`account.js:148`), home (`home.js:236`), 404 page.

**Fix:** `a.btn, a.btn:visited{color:var(--jc-accent-ink)}` and `a.btn.ghost, a.btn.ghost:visited{color:var(--jc-ink)}`.
No markup / JS change.

**Reviewer:** self-review (CSS-only, 4 lines) — no agent run.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R1 | Info | `:visited` can't be read via getComputedStyle (browser privacy), so a render test can't see the bug | Test asserts the loaded rules instead; **fails on the old CSS** (verified by reverting) |

**Tests:** Playwright 189 passed ×2 (188 + 1 new).

## Same PR — two more of Zee's reports (2026-11-05)

**Name flash:** every page painted `jcT("brand")` = "Jubail Commons" until `jc_config_get` answered, then the
member's community name ("E2E Test Commons"). Fix: `jcCommunityName(cfg, id)` in `assets/api.js` — saves the
loaded name (`localStorage.jc_name` = {id, en, ar}; names only, already public via the anon config RPC); before
the config loads it shows that saved name, else the neutral "Commons". Used by events, home, admin, account, hub.

**Tab bar too tall:** ~68px → ~51px (bar padding 6→3px, tab padding 6→5/4px, icon 22→20, label 11px/1.2);
each tab keeps `min-height:44px` (tap target). Page bottom padding 72→60px. The event map measures the bar,
so it grows into the freed space (fit test unchanged and green). Screenshot checked.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R2 | Low | A member who switches to another community sees the previous community's name for a moment on member pages (their community isn't known until sign-in state loads) | **Accepted** — rare (one community per resident today); account page + hub pass the community id, so a saved name for a different community is ignored there |
| R3 | Info | Saved name is rendered via `textContent` / `document.title` only — no HTML path | Checked |
| R4 | Info | CI flake: feedback "language switch" test clicked the toggle twice without waiting for the redraw | **Fixed** — waits for the Arabic label between clicks |

**Tests:** Playwright **191 passed ×2** (+ name-flash test — fails on the old code, verified by reverting; + tab bar ≤ 56px / tabs ≥ 44px).
