# Pages declare themselves dark — review (2026-11-05)

**Report (Zee, screenshot):** on the e2e events list, the one-place event's green "Sign Up" button showed
no label; greens looked brighter than the Commons palette.

**Investigation:** the live code has the label (`ev_signup_cta: "Sign Up"`, verified on commons.ae);
locally the button renders dark ink (#06231b) on mangrove (#3e9b76); neither community has custom brand
tokens. The colours in the screenshot (brighter teal, re-tinted Admin badges) are not ours → most likely a
browser repaint (Chrome auto-dark, Samsung Internet, or an extension such as Dark Reader / the mobile-view
extension). Cannot confirm which on Zee's machine. Gap found: no Commons page declared `color-scheme`,
which is what those tools key off.

**Change:** every Commons page gets `<meta name="color-scheme" content="dark">` + `<meta name="darkreader-lock">`;
`tokens.css` sets `color-scheme: dark` on `:root` (light theme declares `light`). No logic change.

**Review:** self-check (markup + one CSS property; no data, auth or logic): CSP unaffected (meta names,
no scripts); native form controls already dark (admin date inputs had `color-scheme:dark`) — now
consistent everywhere. Test asserts both metas + computed `color-scheme` on all five pages.

**Tests:** Playwright **181 passed ×2**.
