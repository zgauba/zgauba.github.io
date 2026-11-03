/* Commons icon family (docs/brand.md): dots only, shared radii, no strokes.
   Geometry copied from Wireframes v4.1 (hub cards, band 03) — the approved set.
   fill = currentColor, so tokens decide the color (CSS: .ico { color: … }).
   Below ~20px each icon needs a chunkier reduced cut (brand rule) — not drawn yet;
   don't render these smaller than 18px. */
var JC_ICONS = {
  events: { vb: 120, body:
    '<circle cx="36" cy="12" r="9"/><circle cx="60" cy="12" r="9"/><circle cx="84" cy="12" r="9"/>' +
    '<circle cx="36" cy="36" r="9"/><circle cx="84" cy="36" r="9"/><circle cx="48" cy="60" r="9"/>' +
    '<circle cx="72" cy="60" r="9"/><circle cx="60" cy="84" r="9"/>' },
  bookings: { vb: 120, body:
    '<circle cx="12" cy="12" r="8"/><circle cx="60" cy="12" r="8"/><circle cx="108" cy="12" r="8"/>' +
    '<circle cx="12" cy="36" r="8"/><circle cx="108" cy="36" r="8"/><circle cx="12" cy="60" r="8"/>' +
    '<circle cx="36" cy="60" r="8"/><circle cx="60" cy="60" r="8"/><circle cx="84" cy="60" r="8"/>' +
    '<circle cx="108" cy="60" r="8"/><circle cx="12" cy="84" r="8"/><circle cx="108" cy="84" r="8"/>' +
    '<circle cx="12" cy="108" r="8"/><circle cx="60" cy="108" r="8"/><circle cx="108" cy="108" r="8"/>' },
  pets: { vb: 120, body:
    '<circle cx="30" cy="40" r="10"/><circle cx="48" cy="22" r="10"/><circle cx="72" cy="22" r="10"/>' +
    '<circle cx="90" cy="40" r="10"/><circle cx="60" cy="74" r="19"/>' },
  /* the reduced cut of the Commons mark (brand.md: <24px / small UI) — stands for
     "a community" on the platform picker */
  mark: { vb: 96, body:
    '<circle cx="48" cy="48" r="15"/><g opacity=".75"><circle cx="48" cy="11" r="9"/><circle cx="80" cy="29.5" r="9"/>' +
    '<circle cx="80" cy="66.5" r="9"/><circle cx="48" cy="85" r="9"/><circle cx="16" cy="66.5" r="9"/>' +
    '<circle cx="16" cy="29.5" r="9"/></g>' },
  community: { vb: 96, body:
    '<circle cx="48" cy="48" r="11"/><g opacity=".55"><circle cx="48" cy="14" r="6"/><circle cx="78" cy="31" r="6"/>' +
    '<circle cx="78" cy="65" r="6"/><circle cx="48" cy="82" r="6"/><circle cx="18" cy="65" r="6"/>' +
    '<circle cx="18" cy="31" r="6"/></g>' }
};

function jcIcon(name, size){
  var ic = JC_ICONS[name];
  if (!ic) return "";
  size = Math.max(18, size || 22);
  return '<svg class="ico" width="' + size + '" height="' + size + '" viewBox="0 0 ' + ic.vb + ' ' + ic.vb +
    '" fill="currentColor" aria-hidden="true" focusable="false">' + ic.body + '</svg>';
}
