# R1 — Households (Organizer Tools → Community) — plan

> ROADMAP R1. App only: no migration. Every RPC below was read live on JubailCommons
> (`pg_get_functiondef`, read-only, 2026-11-06) before building; all date from S1 and no screen used them until now.

## RPC shapes (live, 2026-11-06)

| RPC | Args | Returns | Guard |
|---|---|---|---|
| `jc_admin_homes_list()` | none | `{ homes: [{id, village, type, building, number, lat, lng, pin_set_at, suppressed, flags, created_at, members: [{user_id, name, joined_at, via}]}], pending: [{invite_id, home_id, requester, created_at}] }` | `jc_assert_admin('community')` |
| `jc_admin_invite_decide(p_invite uuid, p_approve boolean)` | | homes list | community; `NOT_FOUND`, `ALREADY_HAS_HOME`; resolves the matching `over_cap` notice |
| `jc_admin_home_edit(p_home, p_village, p_type, p_building, p_number)` | | homes list | community; `jc_home_validate` errors (`BAD_VILLAGE`, `VILLAGE_NOT_DELIVERED`, `BAD_HOME_TYPE`, `BUILDING_REQUIRED`, `BAD_BUILDING`, `BAD_NUMBER`), `HOME_TAKEN`, `NOT_FOUND` |
| `jc_admin_home_suppress(p_home, p_on boolean)` | | homes list | community |
| `jc_admin_member_remove(p_user, p_delete_account boolean)` | | homes list | community; `USE_ACCOUNT_DELETE` (self), `NOT_FOUND`. Detaches via `jc_home_detach` (→ `jc_home_vacated` when the last member goes; departure notice). `p_delete_account` deletes the auth user: **irreversible** |
| `jc_admin_log_list()` | none | `[{at, action, target (jsonb), actor}]`, newest 100 | community |
| `jc_admin_notices_list()` | none | notices carry `home.id` → the "Open Home" link | community |

`name` / `requester` / `actor` = `coalesce(display_name, jc_mask_email(email))` server-side; mask = first letter + `•••@domain`.
`flags`: `pin_far: true` and/or `pin_near: <other home id>`.

## Surfaces

- Community tab → **Households** button (community admins only, like App Health).
- **Households view**: pending over-limit requests first (requester · home · Approve / Decline), then homes grouped
  by village, each heading with counts (homes · pinned · members). Per home: label, flags (no pin, pin far, pin
  close to another home, hidden from directory), members (name + joined date), actions Edit · Hide from / Show in
  directory · Remove (per member, inline confirm, optional "also delete their account").
- **Edit** inline form: village (delivered only) · type · building (apartments) · number. Sends all five args.
- **Admin Log view**: newest 100 — when, who (name), what (in words), which home (label looked up from the homes
  list). Never prints `target` raw (it holds user ids).
- **App Health notices** gain an "Open Home" button when the notice has a home → Households, scrolled to it.

## Rules

- PII: member / requester names are what the server sends (display name or masked email). The screen never shows a
  user id, a full email, coordinates or the log's raw target. Everything typed by residents is `esc()`'d.
- EN + AR strings for every key, RTL via the shared `dir`; admin-context error wording where the resident wording
  would mislead (`HOME_TAKEN`, `ALREADY_HAS_HOME`, `NOT_FOUND` says "event").
- Hotspots: `admin.js`, `strings.js` — R2 is planned in parallel but builds after this merges.

## Premortem

| Mode | Exposure | Mitigation |
|---|---|---|
| 1 Wrong data written | Edit sends the wrong home's id, or nulls building on a villa | tests assert the exact RPC args; form starts from the home's current values |
| 1 Irreversible delete | "Remove member + delete account" by mis-tap | off by default; separate checkbox; confirm step names the person; test asserts `p_delete_account: false` unless ticked |
| 6 PII leak | user ids / full emails / log target rendered | render from named fields only; test asserts a user id and an email in the stub never appear |
| 5 Ordering | a slow answer redraws over another view | late answers update data, redraw only if still on the view (the sign-ups pattern) |
| 7 Rollback | hide has Show; edit can be re-edited; remove has none (resident re-claims / re-joins by invite) | said in the confirm text |
| Known, not here | D1 (hidden flag survives a vacated home) is reachable via Remove — fixed in R2a | noted in the review |
