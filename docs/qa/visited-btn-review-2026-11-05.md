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
