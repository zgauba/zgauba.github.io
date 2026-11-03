# Vendored third-party code

Served first-party — no CDN, so no third party sees residents' requests and no
upstream change reaches them without a commit here. Upgrade deliberately:
`npm pack <pkg>@<version>`, compare `dist.integrity` with `npm view <pkg>@<version>
dist.integrity`, copy the file, update this table.

| File | Package | Version | npm integrity (tarball) | sha256 (file) | License |
|---|---|---|---|---|---|
| `supabase-2.118.0.js` | `@supabase/supabase-js` `dist/umd/supabase.js` | 2.118.0 | `sha512-FxI8UXMVC2UG7IkeiI8fuQZqq2oI3JeSuN8MPIC2RLVaoEAxKS0nqE6kii9Ewpq8f9gNPM6git1Y8f0vN/QLFw==` | `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3` | MIT (`supabase-LICENSE`) |
| `leaflet-1.9.4/` (`leaflet.js`, `leaflet.css`, `images/`, `LICENSE`) | `leaflet` `dist/` | 1.9.4 | `sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==` | js `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a`, css `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6` | BSD-2-Clause (`LICENSE`) |

Checked at vendoring (2026-11-03): no hardcoded hosts beyond documentation links, no
`eval` / `new Function` — runs under the pages' `script-src 'self'` CSP. Leaflet (2026-11-03): same checks; its only hosts are documentation links. Map tiles come from Esri World Imagery + OSM (keyless; allowed in the map pages' `img-src`).
