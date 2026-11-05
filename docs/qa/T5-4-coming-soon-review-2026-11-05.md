
## App code review (code-reviewer, 2026-11-05) — no High

| # | Sev | Finding | Disposition |
|---|---|---|---|
| A1 | Med | Events list still showed a count ("0 households coming") for a coming-soon event; the event page hides it | **Fixed** — no count until sign-ups open; test |
| A2 | Med | "Coming Soon" badge + "coming soon" in the line | **Fixed** — said once, by the badge; test |
| A3 | Med/Low | Coming-soon one-place event without a place opened on an empty map | **Fixed** — "📍 The place will be announced soon."; test |
| A4 | Low | Arabic confirm used straight quotes | **Fixed** — «…» like the publish confirm |
| A5 | Low | "Coming soon —" status vs Title Case buttons | **Fixed** — "Coming Soon — …" |
| A6–A9 | Tests | Event admin Open on coming soon; success path after adding the place; announce args; paused vs coming soon | **Added** |
| — | Checked | Open pre-check right for paused events too; event admins get Open / Pause, no announce; empty-map tab doesn't crash | No change |

- Playwright after fixes: **186 passed ×2**.
