# T5.2 PR 5a.1 — gate rings, map key rows, "out of treats", 🌙 — review (2026-11-05)

**Asked by Zee (2026-11-05, after the "Commons Event Looks" wireframes):** gate rings weren't noticeable;
"both gates" should be a half/half ring as on the Halloween site; replace the Haq al Laila lantern (chose 🌙);
event-night wording. Found while building: the key's gate chips sat off-screen (sideways scroll), and treat
nights said "Done" where the Halloween copy rule says "out of treats".

**Scope:** `events/events.js` (`ringOf` — a choice in the schema's `ring_split` draws half in each of the first
two other choices' ring colours, inline `border-color` from integer indexes only; key in three wrapping rows;
`outKey` → "Out of treats" for halloween / haq_al_laila looks, "Done" otherwise; 🌙; ring 4 px, pins 32 / 40 px;
`fitMap` drops `evfit` when header + key can't fit above the tab bar so the page scrolls), `events.css`,
`admin/admin.js` + `admin.css` (per-choice "split ring" tick on ring questions; Halloween / Haq al Laila
"Both gates" pre-ticked), `strings.js` (EN + AR), tests.

**Reviewer:** code-reviewer (correctness + security), on the working tree. Verdict: approve; nothing Critical /
High / Medium.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S1 | — | Organizer values reaching the inline style / class | **None** — only `var(--jc-ring-N)` with N = index % 6; labels escaped; `TREAT_LOOKS` lookup via whitelisted `lookOf` |
| C1 | Low | A split tick that can't split (fewer than two other choices) silently draws one colour | **Accepted** — falls back safely (test); builder warning only if organizers trip on it |
| C2 | Low | > 6 ring choices: split halves can match an unrelated ring (pre-existing `% 6`) | **Accepted** — same as 5a C3 |
| C3 | Low | Split border stays on done / reported pins | **Accepted** — same as plain rings; the gate still matters when a home is out |
| C4 | Low | `evfit` toggle — loops / stale state | Checked by the reviewer: none |
| T1 | Low | Small-phone test used `waitForTimeout(100)` next to the 120 ms `fitSoon` | **Fixed** — `expect.poll` |
| T2 | Low | "No sideways overflow" measured `.legend`, not each `.row` | **Fixed** — every row checked |
| T3 | Low | No test for the split fallback / non-array `ring_split` | **Fixed** — two tests |

Deferred (unchanged): server-side checks for `ring_split` and `allergy_friendly` → next events DB PR.

**Tests:** stubbed Playwright **215 / 215** twice (207 after 5a; new: split ring pin + key, key rows, Done vs
Out of treats, ring ≥ 4 px, builder split round-trip, small-phone scroll, two fallback cases). Mutation check:
removing the `evfit` toggle fails the small-phone test. Screens checked with `/shot` (Halloween + Haq al Laila);
the Haq al Laila shot is what found the key hidden behind the tab bar.
