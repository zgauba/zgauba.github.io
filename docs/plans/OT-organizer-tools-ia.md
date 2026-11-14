# OT — Organizer Tools: how it's organized (proposal, 2026-11-14)

> Status: **proposal: awaiting Zee's answers (D1–D6)**. Each build PR gets its own `/plan-change` (premortem, tests) once the direction is set. R5d-2 / R5d-3 (Pets editor, care) are **paused** until D1 is answered, so they're built into the new structure rather than moved later.

## What Zee asked (2026-11-14)

1. Organizer Tools needs a sub-sub-menu or some way to navigate, rather than long scrolls.
2. A search bar on those pages, and maybe on some other pages.
3. The WhatsApp link on the Pets admin page is confusing for someone new.
4. Events: separate current, upcoming and completed events.
5. Courts: look at tennis vs basketball. Football (soccer) fields need adding, so Courts may become **Bookings** sooner.
6. Rename Banner to Alert?

## Today (read from `commons/admin/admin.js`, 2026-11-14)

| Tab | What's on it now | Problem |
|---|---|---|
| Events | New Event, then **one list** of every event (draft, coming soon, open, paused, ended, archived) with a status word on each row | Past and future mixed; it grows every season |
| Courts | Rules line, New Court, the courts list, then Retired | Fine at 2 courts. With 3 kinds and more places, no way to narrow |
| Pets | Switched-off notice, **WhatsApp group** panel, animals by village, Archived | The link panel sits first, with no "why" or "how to get it"; animals scroll below it |
| Community | Four big stacked buttons (Admins, App Health & Notices, Households, Section Names), the **Codes** panel inline, then Enter Another Code / Lock | Long, uneven: some items open screens, one (codes) is inline |
| Banner | One textarea, "tie to an event", Post / Clear | Fine, and now last. Arabic already calls it **الإعلان (announcement)**; the admin log says both "banner" and "alert" (تنبيه) |

Searchable today: only the resident **Events → List** (house number). Nothing in Organizer Tools.

## Proposal

### 1. One navigation pattern inside every tab (prior art: REUSE)
- **A row of filter chips** directly under the tab bar, with counts (e.g. `Now 1 · Upcoming 3 · Past 12`). This is the same component residents already use on Pets (`ptFilters`: buttons with `aria-pressed`). It is one shared piece (`jcChipsHtml` / `jcChipsWire`), not a third copy.
- **Settings-style rows** (a name, a one-line description, a chevron) for tabs that are a menu of screens, mainly Community. They replace the big stacked buttons.
- The choice is remembered in the URL (`?tab=events&show=past`), so Back and reloads land where you were (the `?show=` pattern from the Pets page).

### 2. Search (one shared box)
- **Organizer Tools:**
  - **Households**: by number, building, village or member name. The highest value: 124 homes.
  - **Events**: by title.
  - **Pets**: by name, home or territory.
  - Not Courts until there are many.
- **Residents:** **Pets** (by name). Events → List already has its own search, which moves onto the shared box. Courts / Bookings once there are more than ~8 places.
- Searching happens on the phone over the list already loaded. Nothing new is sent to the server.

### 3. Per tab

| Tab | Chips | Other changes |
|---|---|---|
| **Events** | **Now** (live, sign-ups open / paused, today) · **Upcoming** (drafts, coming soon, later dates) · **Past** (ended, archived) | Opens on Now, or Upcoming when nothing is on. Search by title. New Event stays at the top. |
| **Bookings** (was Courts) | **All · Tennis · Basketball · Football** (only kinds that exist) | New kind **Football** (DB: the `kind` check gains `football`; icon + EN/AR). Retired stays apart. See D3. |
| **Pets** | **Strays · Homes' pets · Missing · Archived** | Search. The WhatsApp link moves into a **Settings** row (below), with plain words. |
| **Community** | Settings rows: **Admins** · **Households** · **App Health & Notices** · **Section Names** · **Codes** · **Your Access** (enter another code / lock) | Codes become their own screen like the rest. Households gets search. |
| **Announcement** (was Banner) | — | Rename only; see D4. Stays last. |

### 4. The WhatsApp link, in plain words
- A Pets → **Settings** row: "**Pets WhatsApp group** — where residents report a missing pet or a stray."
- **Screen:**
  - **What it does:** "When a pet goes missing, or someone spots a stray, residents get a button that opens your pets group in WhatsApp with the message already written. Without a link, they can only send it to one person."
  - **How to get the link** (click by click): WhatsApp → open the group → tap its name → **Invite to group via link** → **Copy link** → paste here.
  - **Who sees it:** "Only signed-in residents of this community. It never appears on public pages."
  - The field, **Save Link**, **Remove Link**, and a **Test it** link that opens the group.

## Decisions for Zee

- **D1 — Navigation pattern:** filter chips inside each tab, plus settings-style rows for Community (recommended). The alternative is a second row of tabs (more taps, a crowded top on a phone).
- **D2 — Search:** Organizer Tools Households, Events and Pets; residents' Pets. Courts / Bookings only once it grows (recommended).
- **D3 — Courts → Bookings now:** recommended **yes**.
  - The module becomes **Bookings** in every label: bar, tab, page title, help. Each place keeps its own kind: Tennis court, Basketball court, **Football pitch** ("Football" is the usual UAE English; "Soccer field" if you prefer).
  - Needs a small DB change (the new kind) and the copy sweep.
  - Communities that renamed the section in Section Names keep their name.
- **D4 — Banner → ?** Recommended **"Announcement"**, not "Alert":
  - "Alert" promises urgency. People learn to ignore alerts that aren't urgent, and screen readers already announce it as an alert.
  - "Announcement" fits both "Road closed tomorrow" and "Fireworks at 8".
  - The Arabic is already الإعلان (announcement), so the two languages would finally match.
  - If you want a separate urgent mode later, add an **Urgent** switch on an announcement (red, top of every page) rather than naming the whole feature after it.
- **D5 — Order of work** (recommended):
  1. **OT-1:** the chips + search pieces, Community rows, Codes screen, Banner → Announcement.
  2. **OT-2:** Events Now / Upcoming / Past + search.
  3. **OT-3:** Pets chips + search + the WhatsApp Settings screen. Then **R5d-2 / R5d-3** inside it.
  4. **B-1:** Bookings rename + Football (DB, its own `/db-rehearse`). It can run any time after OT-1, never in parallel with OT work (same files).
- **D6 — Residents' Pets search:** in OT-3 (recommended), or later.

## Risks to plan for (full premortem per PR)

- **"Behaves differently from…":** chips must look and work the same on all tabs and on the residents' Pets page, one shared piece. The URL (`?show=`) must survive the existing deep links (`?tab=courts&court=`, `?tab=pets&pet=`, `?event=`).
- **Rename drift (Bookings, Announcement):** labels live in strings, help, admin-log words, tests and Section Names defaults. Do a grep sweep plus a test that no old word is left in English or Arabic.
- **Football kind:** a DB check change with 0 rows affected. The client must show an unknown kind safely, so older cached pages don't break on a football row.
