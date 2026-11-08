# Jubail Commons — brand decisions

Ratified 2026-11-02. This is the durable record of the brand direction; the
visual review doc lived as a Claude artifact. Scope here is brand only —
product architecture (identity model, IA screens) lives in wireframes and
plans, not this file.

> ⚠️ **Arabic pending native review.** The Arabic name, module names and every
> string flagged `ar_draft` in `commons/assets/strings.js` rest on model
> language knowledge, not a native speaker. Nothing Arabic is final until an
> Emirati neighbor has reviewed it. Same for the village etymologies (below).

## Positioning

**Deliberately unofficial.** Commons must never be mistakable for JIIC, LEAD
or JICM — trust ("by neighbors, for neighbors"), compliance (the Courts
module's "official JICM bookings take precedence" disclaimer), and the repo's
standing rule all depend on it. Warm and handmade beats luxury-gloss. No
imitation of the developer's branding, ever.

## Naming

- Platform: **Commons**. Deployment: **⟨Community⟩ Commons** (Jubail Commons
  today; Yas/Saadiyat Commons unchanged tomorrow).
- Arabic: **«ساحة الجبيل»** (*Sāḥat Al Jubail*) — a *sāḥa* is the communal
  square where a neighborhood gathers. Never transliterate "Commons".
  `ar_draft` until reviewed.
- Modules — **nouns in the nav, verbs on the buttons**:

  | Nav (noun) | Primary action (verb) | Arabic (ar_draft) |
  |---|---|---|
  | Events | Sign your home up | الفعاليات |
  | Courts | Book a court | الملاعب |
  | Pets (module title stays "Pets of Jubail") | Add a pet | الحيوانات الأليفة |

## The mark

A circle of small dots around a center — the dots are homes, the center is
the commons; it also reads as a map pin-cluster. Inline SVG only, no asset
pipeline. **Two cuts, always:**

- **Full** — 8 dots r5.5 + center r9 (viewBox 96): ≥24px.
- **Reduced** — 6 dots r9 + center r15: favicon, map clusters, anything <24px.

Colorways: on sand/light — center `#1C6B52`, dots `#3E9B76`; on dark — center
`#6FCF8F`, dots `#3E9B76`.

**Icon family:** every icon is only dots (loose 5×5 rhythm, shared radii, no
strokes). The accented anchor dot appears **only where the form earns it**
(paw pad, key bow) — never forced; the mark is the only place the center-dot
motif is required. Each icon needs a chunkier reduced cut below ~20px.
Water is texture, never color — blue stays out of the palette.

## Palette

Deep mangrove green on warm sand neutrals. Dark is the product default.

| Token | Dark (default) | Light |
|---|---|---|
| `--jc-bg` | `#141210` | `#FBF7EF` |
| `--jc-surface` | `#1F1C17` | `#FFFFFF` |
| `--jc-surface-2` | `#2A2620` | `#F4EEE2` |
| `--jc-line` | `#3B352C` | `#E2D8C6` |
| `--jc-ink` | `#F6F2E9` | `#1B1A16` |
| `--jc-muted` | `#A9A294` | `#6A6456` |
| `--jc-faint` | `#9A9384` (R3c; was `#878072`) | `#7A6C50` |
| `--jc-accent` | `#3E9B76` | `#1C6B52` |
| `--jc-accent-ink` | `#06231B` | `#FBF7EF` |
| `--jc-brand-deep` | `#14453A` | (same) |

**The three greens are deliberate:** brand green is deep and sits still
(`#14453A`, chrome and the mark — never on an interactive element it doesn't
own); accent green moves (`#3E9B76`, the primary action); signal green means
available/confirmed (`#6FCF8F`, unchanged from Halloween). Value carries the
distinction, and availability is always also encoded in **form** (fill/glyph),
never hue alone. Sand is a neutral, not a signal.

## Locked semantics — no override, ever

| Token | Value | Meaning |
|---|---|---|
| `--jc-info` | `#58C4D4` | teal — informational / **allergy-friendly** (reserved since teal-pumpkin) |
| `--jc-danger` | `#EF7B7B` | red — alert, errors, missing pets |
| `--jc-warn` | `#F2B33C` | amber — warning (nudged from `#F0C060`, too close to sand) |
| `--jc-good` | `#6FCF8F` | green — available / confirmed |

Layers 2 (`[data-community]`) and 3 (`[data-theme]`) may restyle brand and
surface tokens but **never these four** — the config loader drops those keys
rather than trusting the row (`applyBrandTokens` in `commons/index.html`).

## Type and voice

- **System stack only** — one stack serves EN and AR
  (`-apple-system … "Noto Sans Arabic", "Geeza Pro"`). No webfonts: Manrope
  belongs to the personal pages and has no Arabic coverage. Display weight
  comes from weight and tracking.
- Contrast (WCAG AA, 2026-11-02 check): the proposal's faint values failed
  for fine print and were adjusted (dark `#7A7365`→`#878072`, light
  `#8A7A5C`→`#7A6C50`); `#06231B` fails on the light theme's deep-green
  accent, so light sets `--jc-accent-ink:#FBF7EF`. R3c (2026-11-08): faint
  text was in fact used on both surfaces (help lines in panels, Settings), so
  the dark value moved again `#878072`→`#9A9384`: 6.12 / 5.56 / 4.93:1 on
  bg / surface / surface-2, and ≥ 4.85:1 on every event look's surfaces.
- Voice: plain, warm, bilingual-first; signed **"your neighbor in Ain Al
  Maha"**.
- Never place `·` directly after Arabic-Indic digits (reads as `٠`); use
  `،` or parentheses. All Commons CSS uses logical properties so RTL flows
  from `dir`.

## Hierarchy rules (brand-adjacent, ratified)

- **One green action per screen** — the accent appears exactly once at most.
- **State lives in content, never chrome** — semantic colors only on slots,
  pins and pills.
- **No tab bar until two modules are live.**
- Admin mode: pinned `--jc-brand-deep` band naming the scope, dot badge on
  admin controls, type-to-confirm for destructive actions. No new colors.

## Unverified — do not publish

Village etymologies (Ain Al Maha ≈ "spring of the oryx", Seef ≈ shore,
Marfaa ≈ harbor) could not be confirmed by research. Village *characters*
are safe to design against (Souk connective hub, Ain Al Maha secluded/nature,
Seef wellness, Marfaa marina-social, Nad Al Dhabi family). Etymology copy
ships only after the same native review as the Arabic strings.
