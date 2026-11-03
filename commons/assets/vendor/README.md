# Vendored third-party code

Served first-party — no CDN, so no third party sees residents' requests and no
upstream change reaches them without a commit here. Upgrade deliberately:
`npm pack <pkg>@<version>`, compare `dist.integrity` with `npm view <pkg>@<version>
dist.integrity`, copy the file, update this table.

| File | Package | Version | npm integrity (tarball) | sha256 (file) | License |
|---|---|---|---|---|---|
| `supabase-2.118.0.js` | `@supabase/supabase-js` `dist/umd/supabase.js` | 2.118.0 | `sha512-FxI8UXMVC2UG7IkeiI8fuQZqq2oI3JeSuN8MPIC2RLVaoEAxKS0nqE6kii9Ewpq8f9gNPM6git1Y8f0vN/QLFw==` | `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3` | MIT (`supabase-LICENSE`) |

Checked at vendoring (2026-11-03): no hardcoded hosts beyond documentation links, no
`eval` / `new Function` — runs under the pages' `script-src 'self'` CSP.
