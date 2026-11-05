# Editor polish — required fields, tab label, Title Case, description formatting — review (2026-11-05)

**Asked by Zee (2026-11-05, testing a one-place event):** required fields need `*` and Save should say what's
missing (it saved, and only Publish complained); the own-entry tab shouldn't say "My home" on a one-place
event; Title Case for calls to action and headings everywhere; basic formatting in descriptions (heading,
bold, underline, bullets, numbers). Decisions (Zee): keep draft saves but prompt; "Sign Up" → "My Sign-Up";
Title Case for buttons / tabs / headings only; toolbar + markers + preview with an escape-first renderer (no
HTML stored). "Coming soon" is a separate DB PR.

**Scope:** `admin/admin.js` (REQ `*`, `missingForPublish` / `markMissing`, Save confirm, Publish explains),
`events/events.js` (tab label, description via `jcRich`), new `assets/rich.js` (`jcRich`, `jcRichToolbar`),
`app.css` / `admin.css` / `events.css`, `strings.js` (100 English strings → Title Case + new keys),
tests (wording updated by literal replacement; new tests below).

**Reviewers:** security-reviewer (renderer) + code-reviewer, on 855bbdf.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S1 | — | XSS / ReDoS in `jcRich` | **None found** — escape-first holds (reviewer ran crafted inputs); per-line lazy regexes on ≤ 2000 chars (DB check) |
| S2 | Low | Overlapping markers (`**a__b**c__`) mis-nest tags | **Accepted** — fixed literal tags around escaped text; the parser repairs it; the preview shows it before saving |
| S3 | Low | Bidi overrides pass through (descriptions are stored as typed, not `jc_clean_text`ed) | **Fixed** — `jcRich` drops U+202A–E / U+2066–9 |
| C1 | Med | Blank lines in a selection became list items / numbered | **Fixed** — blank lines untouched, numbering skips them; test |
| C2 | Med | Selection ending after a line break also formatted the next line | **Fixed**; test |
| C3 | Med | Toolbar inside the `<label>` (buttons in the box's accessible name) | **Fixed** — inserted before the label; test |
| C4 | Low | `s = 0` edge in `lines()` | **Fixed** |
| C5 | Low | B / U didn't toggle off with just the inner word selected | **Fixed**; test |
| C6 | Low | Toolbar didn't recognise `*` / `•` / Arabic-digit list markers the renderer reads | **Fixed** — shared patterns; `var n` moved to the top; test |
| C7 | Info | `missingForPublish` / publish message element | Checked: `#msg` is the shared message box; no change |
| C8 | Low | Clamp assumed line-height 1.6 | **Fixed** — set explicitly on `.desc` |
| — | Info | Title Case test rewrite changed no assertion's meaning | Checked by the reviewer |

**Screens (`/shot`):** editor — `*` was on its own line (labels stack their children) → wrapped with the label
text; fixed before review.

**Tests:** Playwright **180 passed ×2** (was 175; +5: required-field flow incl. Cancel / OK / Publish
explained, homes event needs only a title, tab label flips, description rendering incl. injection attempt,
toolbar basics + edge cases).
