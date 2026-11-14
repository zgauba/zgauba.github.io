# Shared footer + Halloween link removed: review note (2026-11-14)

Zee asked: "remove Halloween 2026 from the footer… and ensure the footer shows up on all pages, not just the commons page." Tier: **cosmetic** (layout + copy; no data, auth or server change). Per tiered verification: a review note, tests, screenshots, CI. No reviewer agent.

## What changed

- **The Halloween 2026 link is gone** from the footer. Gone with it:
  - its strings (`archive_halloween`, `archive_halloween_desc`)
  - the `halloween_archive` default in `landing.js`
  - the https fallback that guarded it

  The `jc_communities.links.halloween_archive` config value is left in the database, unread. The Halloween site itself stays live until it is retired (memory: Halloween retirement).
- **One footer on every Commons page:** home, account / sign-in, Events, Courts, Pets, My Home, Organizer Tools.
  - Built by `jcFooter(root)` in `assets/api.js`, which every page loads; each page's `paint()` calls it.
  - Ideas & Feedback for members, then the credit ("Made by Zeeshan, your neighbor in Jubail Island", linked to the career page in its own tab).
  - It updates in place on a language switch or sign-in, so there is never a second footer.
- **Styles** live in `assets/tabbar.css`, the page frame that every page loads. The sign-in page now loads it too; its tab-bar rules apply only with `body.has-tabbar`. The home page's own footer CSS is removed.
- **Not under a full map:** Events, Courts and Pets maps fill the screen above the tab bar by design (Zee 2026-11-04), so `body:has(.evmapwrap)` hides the footer there. It shows on those modules' other tabs (List, Sign Up, My Bookings, …).
- **Not changed:** `404.html` (static, no scripts) has no footer.

## Verification

- **New tests:**
  - The footer on home, My Home, Organizer Tools and Pets: one footer, the credit and link, Ideas & Feedback with the right path per page, and Arabic after a language switch.
  - Courts list: footer visible.
  - Sign-in page: credit, no feedback link when signed out.
  - Hidden under the event map, back on the List tab.
  - Landing: no Halloween link even when the config still names one. This replaces the old "non-https archive link falls back" test.
- **Specs:** shell, landing, feedback and account specs pass. The full suite was run locally in both browsers (see the PR).
