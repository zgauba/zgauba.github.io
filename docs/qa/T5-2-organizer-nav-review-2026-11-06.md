# Organizer Tools sub-menu + event Admin button — review (2026-11-06)

**Asked by Zee (2026-11-06):** Organizer Tools "getting really big" → a sub-menu (approved layout: Events · Banner ·
Community); on the event page an **Admin** button below the language button, only for community and event admins.

**Scope:** `admin/admin.js` — `VIEWS.home` renders one tab; `adminTabs()` (events: organizers or event admins;
banner: organizers, or event admins while an event they run is live; community: always — App Health & Notices and
Codes for community admins, the Feedback inbox for the platform owner, Add another code / Lock for everyone);
`?tab=` remembered, unknown / not-allowed values fall back to the first allowed tab; a half-typed banner survives a
tab switch; focus stays on the tapped tab. `events/events.js` — Admin link (`.evadminrow`, under the language button)
for community / events-scope admins and this event's own admins → `admin/?event=<id>`. Strings EN + AR. Tests: new
sub-menu / fallback / draft / Admin-visibility (4 roles) / RTL cases; existing tests now open the tab they use.

**Reviewer:** code-reviewer on commit 484385b. Verdict: approve; no Critical / High / Medium.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| — | — | Wiring when a tab's elements are absent; late feedback count; `?tab=` fallback; `?event=`; tab state across Exit / NOT_ADMIN / rotate / language; Admin link rule = admin page's rule | **Checked clean** |
| F1 | Low | No test for the `?tab=` fallback | **Fixed** — not-allowed + unknown tab tests |
| F2 | Low | Admin link tested only for community admin / resident; RTL untested | **Fixed** — event's own admin, other event's admin, events code, owner-only; Arabic side check |
| F3 | Low | Late-count test used a fixed wait | **Fixed** — polls the stub's reply |
| F4 | Info | Tab switch lost focus and a half-typed banner | **Fixed** — focus restored; banner draft kept |

**Tests:** stubbed Playwright **273 / 273** twice (263 before). Screens checked with `/shot`: Community tab, event
page Admin button.
