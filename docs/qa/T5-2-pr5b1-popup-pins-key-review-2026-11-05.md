# T5.2 PR 5b.1 — report link, same-size own pin, readable map key — review (2026-11-05)

**Asked by Zee (2026-11-05, testing 5b on the live e2e Halloween Test):**
1. "They're Out of Treats" was a big full-width button under Directions / Google Maps — easy to hit by mistake;
   make all three consistent text links.
2. Your own pin was bigger (40 vs 32 px) with an extra dark ring — make it look like every other pin.
3. The map key's gate / state labels were too small to read.

**Scope:** `events/events.js` (`reportHtml` → `canReport` / `reportLink` in the `.popacts` row / `reportedLine`
after it; `pinIcon` one size, no `mine` class — your pin still sits on top via `zIndexOffset`), `events.css`
(link-style `.rep` with `:disabled`; ~28 px tap height on all three popup links; key chips 14 px in `--jc-ink`, gate /
state dots 20 px, key icons 17 px; `.pin.mine` rules removed), tests.

**Live test data (not code, e2e community only):** demo home Villa 210 signed up to Halloween Test (no account
attached); Halloween Test's questions gained `allergy_friendly: ["non_food"]` + `ring_split: ["both"]`, Haq al Laila
Test's gained `ring_split: ["both"]` — both events were created before those ticks existed, which is why Villa 210's
pumpkin showed orange. Events created from the templates since 5a.1 already carry both.

**Reviewer:** code-reviewer on the popup change (working tree). Verdict: no High / Medium.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| — | — | Click wiring after the move into `.popacts`, escaping, RTL, test value | **Checked clean** — `popupopen` finds `[data-report]` anywhere in the popup; same gating; logical flex only |
| L1 | Low | ~19 px tall text links, 12 px apart — a thumb can still mis-tap | **Fixed** — 4 px vertical padding (~28 px); the confirm dialog remains the real guard |
| L2 | Low | In-flight report link had no disabled look | **Fixed** — `.pop .rep:disabled` |
| L3 | Low | `.popacts` wrap rule separated from its base rule | **Fixed** — merged |

Own-pin and key changes are CSS + one size constant, covered by tests rather than a second agent pass: own pin same
size + same shadow as a neighbor's, and on top (z-index); key chips ≥ 14 px in the ink colour, 5 dots ≥ 20 px.

**Tests:** stubbed Playwright **236 / 236** twice (234 after 5b; new: report link in the row and no bigger than the
others, key legibility; the "your pin is larger" assertion replaced by "same as the others, on top"). Screens checked
with `/shot` (popup, Halloween map + key).
