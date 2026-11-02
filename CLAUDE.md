# zgauba.github.io — agent bootstrap (lite)

If you're a Claude Code session starting work in this repo, read this file first.

## What this project is

Zeeshan Gauba's personal networking site. Static HTML on GitHub Pages, no build step.

- `/` — career page (recruiters, operators)
- `/jubail/` — community variant (neighbors arriving from the trick-or-treat site footer)
- `assets/` — brand lockup SVGs

## How to work in this repo

1. Read `~/.claude/docs/BUILDING_APPS_WITH_AI.md` for the universal protocols (lite project — no Stack Manifest).
2. This is a public personal brand surface — every change is live within ~10 min of pushing to `main`.

## Hard rules

- **The two pages are the SAME professional networking page differing ONLY in the middle section** (root: "Where I operate" domain cards; /jubail/: "The neighborhood test" story). Any shared-section edit applies to both.
- **No phone number anywhere, ever.** Contact = LinkedIn + email only.
- Brand system: dark cover (#0A0E1A) + light interior (#F7F9FC), Manrope, cyan accent (#22D3EE) on dark / teal (#0E7490) on light, real lockup SVGs from assets/. Don't improvise off-brand.
- Copy conventions: Segmint is an "exit" (never "acquired by"); already in Abu Dhabi (never "relocating"); no compensation talk.

## Conventions

- No package manager, no build. Deploy = push to `main` (user-site repo: Pages auto-enabled). Verify via `gh api repos/zgauba/zgauba.github.io/actions/runs`.
