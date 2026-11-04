# zgauba.github.io — Jubail Commons monorepo — agent bootstrap

If you're a Claude Code session starting work in this repo, read this file first.

## What this repo is

ONE repo, served by GitHub Pages as the user site, holding three things:

| Path | What | URL |
|---|---|---|
| `/` + `jubail/` | Zee's personal networking pages | zgauba.github.io, /jubail/ |
| `jubail-halloween/` | 2026 Halloween trick-or-treat site (legacy, live) | /jubail-halloween/ |
| `commons/` | **Jubail Commons** — the community platform rebuild (events, court bookings, pet directory) | /commons/ (when built) |

**Jubail Commons** is the product: community-run events, facility booking, and pet directory for Jubail Island, Abu Dhabi. Platform name "Commons"; multi-community pattern is "⟨Community⟩ Commons". Backends: the legacy Halloween site uses Supabase project "SignalPost" (`hrdmhifeynnokzjqtlsa`, tables prefixed `jh_`); **Commons gets its own dedicated Supabase project** (**JubailCommons**, `qrpxfssdeeuzmsmlbtbu`, ap-south-1 — never put `jc_` tables in SignalPost). Schema SQL lives per-project in this repo: `supabase/signalpost/migrations/` and `supabase/commons/migrations/`.

## How to work in this repo

1. **Read `~/.claude/docs/BUILDING_APPS_WITH_AI.md`** — universal operating protocols.
2. **Read `docs/architecture.md`** — the Stack Manifest. If LAST VERIFIED is stale, run `/manifest` first.
3. The authoritative backlog + ops context live in the private Claude project doc "Jubail Trick-or-Treat Site — Ops Reference" (project "Jubail Villa") — never in this public repo.

## Workflow rules

- **Reviews are saved in the repo, on the PR branch, before merge.** Every reviewer agent's report → `docs/qa/<name>-review-<YYYY-MM-DD>.md` (findings + disposition). CI (`review-saved.yml`) fails any PR touching `commons/` or `supabase/` without one; label `review-not-needed` only for trivial copy changes.
- **Branches + PRs, even solo** — standing exception: live-event-day hotfixes go straight to `main` (deployed sites auto-reload in users' hands ~2 min after CDN refresh).
- **Live infra wins over docs.** Update the doc when they disagree.
- **This repo is PUBLIC and served verbatim.** Never commit: organizer/admin codes, sign-up passcodes, service-role keys, resident data. Supabase publishable (anon) keys in HTML are public by design.
- **Zero-PII is the default promise** across all community tools: no names/emails/phones unless a feature adds one per-feature, opt-in, minimal, and disclosed. Never a silent schema change.
- **One Pages build serves everything** — the career page shares a blast radius with community-app pushes. Check what a commit touches before pushing.
- **Never change `jh_signup`'s signature** (cached pages + PostgREST overload ambiguity). Follow-up RPCs instead. Same discipline applies to `jc_` signup-class RPCs once live.

## Section rules

**Personal pages (`index.html`, `jubail/`):** the two pages are the SAME networking page differing ONLY in the middle section (root: "Where I operate"; /jubail/: "The neighborhood test"). No phone number anywhere, ever — LinkedIn + email only. Brand: dark cover #0A0E1A + light interior #F7F9FC, Manrope, cyan #22D3EE on dark / teal #0E7490 on light, lockups in `assets/`. Segmint = "exit", never "acquired by".

**Halloween site (`jubail-halloween/`):** legacy but live; vanilla JS, string concat (no template literals), no build. Pin encoding is orthogonal: fill = availability, ring = entrance, glyph = treats type. Copy says "out of treats". Superseded by `commons/` — no structural investment here.

**Commons (`commons/`):** the rebuild. Per-community config (villages, map center, branding, WhatsApp links) + per-module feature flags (events / bookings / pets — flags are also the compliance kill switch for the booking module). EN/AR strings dictionary + RTL. Identity model with optional-PII slots. Booking module carries "official JICM bookings take precedence" on the booking screen (MCD §15.10).

## Conventions

- No package manager, no build step. Deploy = push to `main` → Pages → ~10 min CDN. Verify: `gh api repos/zgauba/zgauba.github.io/actions/runs`.
- Local verification: Playwright with stubbed RPCs (CORS headers + OPTIONS 204 on stubs; chainable-Proxy `window.L` shim when the Leaflet CDN is unreachable).
- Supabase changes via migrations; mirror each into `supabase/<project>/migrations/` here (signalpost or commons — every migration's header comment names its target project ref).

## Where docs live

- `docs/architecture.md` — Stack Manifest (refresh via `/manifest`)
- `docs/qa/`, `docs/incidents/`, `docs/plans/` — audits, incidents, multi-PR plans
