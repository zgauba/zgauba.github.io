/* Commons icon family (docs/brand.md): dots only, shared radii, no strokes.
   Geometry copied from Wireframes v4.1 (hub cards, band 03) — the approved set.
   fill = currentColor, so tokens decide the color (CSS: .ico { color: … }).
   Below ~20px each icon needs a chunkier reduced cut (brand rule) — not drawn yet;
   don't render these smaller than 18px.
   vb = a square drawn tight around each glyph's dots (Zee, 2026-11-04: at one size the
   icons looked different sizes — Events filled ~55% of its old box, the mark ~95%), and
   every glyph's small dot is the SAME share of its box: r = 8% of the side (Zee,
   2026-11-05: the dots looked uneven between icons — 7%…12% before; 8.5% merged the dense
   Courts grid). Accent dots (door, centre, paw pad) keep their ratio to the small dots.
   tests: landing.spec.js "icons". */
var JC_ICONS = {
  events: { vb: "17.14 5.14 85.71 85.71", body:
    '<circle cx="36" cy="12" r="6.86"/><circle cx="60" cy="12" r="6.86"/><circle cx="84" cy="12" r="6.86"/>' +
    '<circle cx="36" cy="36" r="6.86"/><circle cx="84" cy="36" r="6.86"/><circle cx="48" cy="60" r="6.86"/>' +
    '<circle cx="72" cy="60" r="6.86"/><circle cx="60" cy="84" r="6.86"/>' },
  bookings: { vb: "2.86 2.86 114.29 114.29", body:
    '<circle cx="12" cy="12" r="9.14"/><circle cx="60" cy="12" r="9.14"/><circle cx="108" cy="12" r="9.14"/>' +
    '<circle cx="12" cy="36" r="9.14"/><circle cx="108" cy="36" r="9.14"/><circle cx="12" cy="60" r="9.14"/>' +
    '<circle cx="36" cy="60" r="9.14"/><circle cx="60" cy="60" r="9.14"/><circle cx="84" cy="60" r="9.14"/>' +
    '<circle cx="108" cy="60" r="9.14"/><circle cx="12" cy="84" r="9.14"/><circle cx="108" cy="84" r="9.14"/>' +
    '<circle cx="12" cy="108" r="9.14"/><circle cx="60" cy="108" r="9.14"/><circle cx="108" cy="108" r="9.14"/>' },
  /* The paw is the one exception to the 8% dot rule (Zee 2026-11-11: "the current icon does not look like a paw
     because of the spacing" — brand direction §03: toes close, pad tucked under). Drawn tight to its box at 8%, four
     toes can only fill the width by spreading apart; here the toes are 10.5% of the side so they sit together. */
  pets: { vb: "2 -5 76 76", body:
    '<circle cx="10" cy="30" r="8"/><circle cx="28" cy="12" r="8"/><circle cx="52" cy="12" r="8"/>' +
    '<circle cx="70" cy="30" r="8"/><circle cx="40" cy="46" r="16"/>' },
  /* the reduced cut of the Commons mark (brand.md: <24px / small UI) — stands for
     "a community" on the platform picker */
  mark: { vb: "3.95 3.95 88.1 88.1", body:
    '<circle cx="48" cy="48" r="11.75"/><g opacity=".75"><circle cx="48" cy="11" r="7.05"/><circle cx="80" cy="29.5" r="7.05"/>' +
    '<circle cx="80" cy="66.5" r="7.05"/><circle cx="48" cy="85" r="7.05"/><circle cx="16" cy="66.5" r="7.05"/>' +
    '<circle cx="16" cy="29.5" r="7.05"/></g>' },
  /* NEW in T5.0b (not in the wireframes — review): My Home. Dots only; the door is
     the accented anchor dot (the form earns it, brand.md). */
  house: { vb: "5.24 5.24 109.52 109.52", body:
    '<circle cx="60" cy="14" r="8.76"/><circle cx="38" cy="34" r="8.76"/><circle cx="82" cy="34" r="8.76"/>' +
    '<circle cx="18" cy="54" r="8.76"/><circle cx="102" cy="54" r="8.76"/><circle cx="30" cy="80" r="8.76"/>' +
    '<circle cx="90" cy="80" r="8.76"/><circle cx="30" cy="106" r="8.76"/><circle cx="90" cy="106" r="8.76"/>' +
    '<circle cx="60" cy="96" r="13.63"/>' },
  /* NEW in R3a (not in the wireframes — review): Organizer Tools in the bar. Dots only: three
     slider rows, each with one larger dot as its knob. */
  tools: { vb: "2.5 0.5 95 95", body:
    '<circle cx="14" cy="18" r="7.6"/><circle cx="38" cy="18" r="7.6"/><circle cx="62" cy="18" r="11.5"/><circle cx="86" cy="18" r="7.6"/>' +
    '<circle cx="14" cy="48" r="11.5"/><circle cx="38" cy="48" r="7.6"/><circle cx="62" cy="48" r="7.6"/><circle cx="86" cy="48" r="7.6"/>' +
    '<circle cx="14" cy="78" r="7.6"/><circle cx="38" cy="78" r="7.6"/><circle cx="62" cy="78" r="7.6"/><circle cx="86" cy="78" r="11.5"/>' },
  community: { vb: "7.52 7.52 80.95 80.95", body:
    '<circle cx="48" cy="48" r="11.87"/><g opacity=".55"><circle cx="48" cy="14" r="6.48"/><circle cx="78" cy="31" r="6.48"/>' +
    '<circle cx="78" cy="65" r="6.48"/><circle cx="48" cy="82" r="6.48"/><circle cx="18" cy="65" r="6.48"/>' +
    '<circle cx="18" cy="31" r="6.48"/></g>' }
};

function jcIcon(name, size){
  var ic = JC_ICONS[name];
  if (!ic) return "";
  size = Math.max(18, size || 22);
  return '<svg class="ico" width="' + size + '" height="' + size + '" viewBox="' + ic.vb +
    '" fill="currentColor" aria-hidden="true" focusable="false">' + ic.body + '</svg>';
}
