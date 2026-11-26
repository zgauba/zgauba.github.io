# zgauba.github.io — personal site — agent bootstrap

If you're a Claude Code session starting work in this repo, read this file first.

## What this repo is

The GitHub Pages **user site** for `zgauba.github.io`:

| Path | What | URL |
|---|---|---|
| `/` (`index.html`) | Zeeshan's personal networking page | zgauba.github.io |
| `jubail/` | Redirect stub to `/` (keep it so shared links don't 404) | /jubail/ |
| `jubail-halloween/` | 2026 Halloween trick-or-treat site (legacy, live, season closed) | /jubail-halloween/ |
| `404.html` | Not-found page; also forwards old `/commons/…` links to commons.ae | any missing path |

**Commons is not here.** It moved to its own repo, **zgauba/commons** (`~/code/commons`), on 2026-11-26 and is served at commons.ae. Do Commons work there, never here. PR numbers up to #226 in that repo's docs refer to this repo.

Backend for the Halloween site: Supabase project "SignalPost" (`hrdmhifeynnokzjqtlsa`, tables prefixed `jh_`). Its migrations live in `supabase/signalpost/migrations/`. Never put `jc_` tables in SignalPost.

## How to work in this repo

1. **Read `~/.claude/docs/BUILDING_APPS_WITH_AI.md`**: universal operating protocols.
2. **Read `docs/architecture.md`**: the Stack Manifest.
3. The Halloween ops context lives in the private Claude project doc "Jubail Trick-or-Treat Site — Ops Reference" (project "Jubail Villa"), never in this public repo.

## Workflow rules

- **Branches + PRs, even solo.** Required checks on main: `review-saved`, `plan-followed`, `secret-scan`, `repo-rules`.
- **Reviews are saved in the repo** for any change under `supabase/` → `docs/qa/<name>-review-<YYYY-MM-DD>.md` (CI `review-saved.yml`).
- **This repo is PUBLIC and served verbatim.** Never commit: organizer/admin codes, passcodes, service-role keys, resident data.
- **Never change `jh_signup`'s signature** (cached pages + PostgREST overload ambiguity). Follow-up RPCs instead.
- **One Pages build serves everything here**: the personal page shares a blast radius with Halloween-site pushes.

## Section rules

**Personal page (`index.html`):** one networking page. No phone number anywhere, ever — LinkedIn + email only. Brand: dark cover #0A0E1A + light interior #F7F9FC, Manrope, cyan #22D3EE on dark / teal #0E7490 on light, lockups in `assets/`. Segmint = "exit", never "acquired by". CI `repo-rules` enforces the phone / Segmint / relocating rules.

**Halloween site (`jubail-halloween/`):** legacy but live; vanilla JS, string concat (no template literals), no build. Pin encoding is orthogonal: fill = availability, ring = entrance, glyph = treats type. Copy says "out of treats". To be retired into Commons before launch (plan in zgauba/commons `docs/plans/ROADMAP.md`) — no structural investment here.

## Conventions

- No package manager, no build step. Deploy = push to `main` → Pages → ~10 min CDN. Verify: `gh api repos/zgauba/zgauba.github.io/actions/runs`.
- Local check before finishing: `bash .claude/verify.sh` (repo-rules + gate unit tests).
