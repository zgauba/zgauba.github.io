# Remove "hide a home from the directory" — plan (`/plan-change`, 2026-11-11)

> Status: **decision made (Zee 2026-11-11: "Remove the hide a home functionality… nothing gets hidden on Jubail")**;
> this plan is the how. DB + client + tests in **one PR**; the migration goes through `/db-rehearse` and waits for "apply".

## Why

An admin could hide any household's home from the directory, event maps, court booking labels and the pet list —
without the household asking. Nothing in the docs records a reason (it was in the T2 schema from day one; R1 added
the button). Hiding a home is the household's call, not an admin's; and Pets needed a whole opt-in feature
("show my home while my pet is missing") only to work around it. If a household-controlled privacy setting is ever
wanted, it is designed fresh, as the household's own choice.

## Live state (queried 2026-11-11)

`jc_homes.directory_suppressed = true`: **0** of 4 homes (`e2e`; Jubail has none). `jc_pets.missing_show_home = true`:
**0** of 10. Removing it changes nothing anyone sees today.

## What goes (inventory: full grep + function bodies, 2026-11-11)

| Layer | Change |
|---|---|
| Columns | drop `jc_homes.directory_suppressed`; drop `jc_pets.missing_show_home` (+ check `jc_pets_show_home_missing`) |
| Functions dropped | `jc_admin_home_suppress(uuid, bool)`, `jc_pet_missing_home_set(uuid, bool)` (authenticated allowlist −2) |
| Bodies replaced (live body minus the rule) | `jc_directory_list`, `jc_admin_homes_list` (drops key `suppressed`), `jc_event_get` (drops `mine.home_hidden`; also what frozen `jc_event_signup` returns — signature untouched), `jc_entry_report`, `jc_facility_grid`, `jc_pet_card` (home shown whenever the pet is owned; drops `show_home`), `jc_pet_retire`, `jc_pet_missing_set` |
| Client | Organizer Tools → Households: the Hidden flag + Hide / Show buttons; Events "not shown" note keeps only the organizer-hid-your-sign-up case; Pets: the opt-in checkbox, the switch, the two-step missing call, `homeHidden` / `myHomeKnownHidden`, "Not shown" fact; help text `help_admin_6` |
| Strings | 12 keys out (EN + AR); `adm_log_home_suppress` **kept** so old admin-log rows still read |
| Tests | SQL: s1, s2 E21, s14 A03, s17 P01h, s21 R06d–l, 00_grants (−2); e2e: admin-households, events-audit (one case), pets (opt-in tests) |
| Docs | manifest R2a / R4a / R5a / R5b paragraphs; ROADMAP R1 line; plan files keep their history |

## Order and old pages

Removed keys are read by truthiness (`mine.home_hidden`, `p.show_home`, `h.suppressed`), so a phone still holding the
old page reads them as false — safe. The two dropped RPCs are only called from the removed buttons; an old page
tapping one gets an "unknown error" message, nothing breaks. **Merge the client first, then apply** (pages
auto-reload within ~2 minutes), so the buttons are gone before the RPCs are.

## Premortem

1. **Missed a reader → a function errors on a dropped column.** → Replace every body before dropping columns (same
   transaction); the full SQL suite (1213 checks) and the full e2e suite run against it; the grep is re-run on the
   migration.
2. **A household that needed hiding has no recourse.** → None exist (0 live); recorded as a deliberate product
   decision; a household-owned setting can be designed later if asked.
3. **Pets loses the "finder can bring my pet back" path for hidden homes** → moot: no hidden homes; every owned pet now
   shows its home (as all other non-hidden pets already did).

## Reviews

`database-reviewer` + `security-reviewer` (privacy rule removed = data shown more widely; zero-PII promise text
checked — `join_privacy` does not mention hiding) + `code-reviewer`. Saved to `docs/qa/` on the PR branch.

**Confidence 0.85** the inventory is complete (two independent greps + body reads; the suite is the backstop).
