
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

## After apply (2026-11-05)

- Applied in one transaction with its history row; live suite **626 checks** green; advisors: no new categories
  (the new function appears only in the expected "signed-in users can execute SECURITY DEFINER" list).

## T5.4b — back to coming soon (Zee, 2026-11-05) — review

**Ask:** a published event should be able to go back to "coming soon" — decided: only while nobody has
signed up. Migration `20261105110000_t5_4b_back_to_soon.sql` replaces `jc_admin_event_announce` (same
signature): draft → coming soon as before; live (open or paused) with no "in" sign-ups → coming soon;
anyone in → `HAS_SIGNUPS`; archived / already coming soon → `BAD_STATE`. App: "Move to Coming Soon" on
published events with no sign-ups (organizers), its own confirm, `err_HAS_SIGNUPS`.

**Reviewer:** database-reviewer (combined database + security pass, gate) — **safe to apply; no High / Medium.**

| # | Sev | Finding | Disposition |
|---|---|---|---|
| B0 | — | Locking: announce FOR UPDATE vs sign-up / withdraw FOR SHARE, close / open FOR UPDATE | **Correct in every order** (READ COMMITTED); community-scoped select + update |
| B1 | Low | Re-announcing an already-coming-soon event logged a no-op | **Fixed** — `BAD_STATE`; test C11d |
| B2 | Low | Log couldn't tell open from paused | **Fixed** — `was_open` in the log |
| B3 | Low | Withdrawn entries keep payload / event pin — could they show while coming soon? | **Checked:** resident reads count / list only `status = 'in'`; re-sign-up resets pin, spot, state |
| B4 | Low | A resident mid-sign-up gets SIGNUPS_CLOSED | **Checked:** shown as the existing friendly "sign-ups are closed" message |

- SQL dry run: **631 checks** (626 + 5: C07a now `HAS_SIGNUPS`, C10b, C11a–d); live unchanged until apply.
- Playwright **187 ×2** (+1: offered with no sign-ups, hidden with sign-ups, refused if someone joins meanwhile).
