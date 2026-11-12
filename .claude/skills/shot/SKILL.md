---
name: shot
description: Screenshot one Commons screen against the stubbed backend (phone size, EN or AR, any persona) and look at it. Use instead of writing a throwaway Playwright test to see a screen.
argument-hint: "<path under /commons/> [persona] [en|ar] [full]"
---

# /shot — see one Commons screen

Never reaches the real Supabase project: it runs on the same stubs as the specs
(`tests/e2e/specs/stub.js` + `specs/backends.js`), local server on :4173, iPhone 13 viewport.

## Arguments

`$ARGUMENTS` → `<path> [persona] [lang] [full]`, any order after the path:

- **path** — under `/commons/`: `""` (hub), `events/`, `events/?id=11111111-1111-4111-8111-111111111111` (live test event), `events/?id=22222222-2222-4222-8222-222222222222` (archived Halloween), `home/`, `account/`, `admin/`, `pets/` (list), `pets/?pet=22222222-bbbb-4bbb-8bbb-00000000000N` (N = 1 Rex · 2 Luna missing · 3 Ginger stray · 4 Sandy community · 6 Mochi mine) — Pets uses the Pets stub; 1–3 have photos
- **persona** — `member` (default), `anon`, `member-no-home`, `member-no-pin`, `organizer`, `community-admin`, `event-admin` (runs only the live test event)
- **lang** — `en` (default) or `ar`
- **full** — whole page instead of one screen
- **clicks** (optional, env `SHOT_CLICKS`) — `;`-separated selectors tapped in order before the picture, for screens behind a button, e.g. `SHOT_CLICKS='#newEv;[data-tpl="market"]'`

## Steps

1. Name the file from the args, in the session scratchpad (never in the repo): `<scratchpad>/shot-<path-slug>-<persona>-<lang>.png`.
2. Run from `tests/e2e/`:
   ```bash
   SHOT_PATH='<path>' SHOT_PERSONA=<persona> SHOT_LANG=<lang> SHOT_FULL=<1|0> SHOT_CLICKS='<sel;sel>' SHOT_OUT=<abs png> \
     npx playwright test -c playwright.shot.config.js 2>&1 | grep -v WebServer | tail -15
   ```
3. Read the PNG with the Read tool and describe what matters for the question at hand.
4. If the run failed with **"RPCs with no stub"**: the picture exists but probably shows an error state. Say which RPC is missing; add a handler to `specs/backends.js` (or `stub.js`) as a real fixture the specs can reuse — don't patch `shots/shot.spec.js` with one-off data.
5. To click into a state the URL can't reach (a form open, a tab selected), that's a real test — write it in `specs/`, not here.
