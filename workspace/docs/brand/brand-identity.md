# Brand Identity — Crawford Young

**Status:** Living reference
**Last verified against code:** 2026-06-09 (`component-library/src/styles/tokens.css`)
**Scope:** Portfolio + `@crawfordyoung/ui` + all personal projects (Cybond / scheduling-advisor, instrumenttuner, future)

> Product-specific brand layers extend this spec, they don't replace it:
> - Cybond naming, logo, voice, splash → [`docs/scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md`](../scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md) (logo uses these exact tokens — no color changes)

---

## 1. Brand Concept

**"Precision built. Naturally."**

Vercel-precision engineering is the foundation — surgical grid, restrained motion, minimal chrome. The nature element lives in the accent color only, not in backgrounds or textures. It signals who the person is: someone who codes with the same intentionality they bring to a campfire or a folk song. The craft impression lands first. The curiosity about the person follows.

Dark mode is the primary surface. It looks like a premium modern product. Light mode is a first-class polished alternative, not an afterthought.

---

## 2. Color System

### Source palette

| Name | Hex | Role |
|---|---|---|
| Emerald | `#10b981` | Primary brand accent — universal across both modes |
| Emerald Light | `#34d399` | Hover state |
| Emerald Dim | `#6ee7b7` | Active/selected indicator |
| Emerald Deep | `#022c22` | Ambient fills (dark mode), ghost tints |
| Emerald Tint | `#d1fae5` | Ambient fills (light mode) |

### Design tokens

CSS custom property format: `R G B` channels (enables opacity utilities via `rgb(var(--token) / 0.5)`).

#### Light mode (`:root`)

| Token | Hex | RGB |
|---|---|---|
| `--background` | `#ffffff` | `255 255 255` |
| `--surface` | `#fafafa` | `250 250 250` |
| `--surface-raised` | `#f4f4f5` | `244 244 245` |
| `--border` | `#e4e4e7` | `228 228 231` |
| `--border-subtle` | `#f4f4f5` | `244 244 245` |
| `--input` | `#e4e4e7` | `228 228 231` |
| `--foreground` | `#09090b` | `9 9 11` |
| `--muted` | `#f4f4f5` | `244 244 245` |
| `--muted-foreground` | `#71717a` | `113 113 122` |
| `--accent` | `#10b981` | `16 185 129` |
| `--accent-foreground` | `#000000` | `0 0 0` |
| `--accent-hover` | `#34d399` | `52 211 153` |
| `--accent-hover-foreground` | `#000000` | `0 0 0` |
| `--accent-subtle` | `#d1fae5` | `209 250 229` |
| `--accent-subtle-foreground` | `#064e3b` | `6 78 59` |
| `--accent-active` | `#6ee7b7` | `110 231 183` |
| `--accent-active-foreground` | `#022c22` | `2 44 34` |
| `--ring` | `#10b981` | `16 185 129` |
| `--item-hover` | `#f4f4f5` | `244 244 245` |
| `--destructive` | `#dc2626` | `220 38 38` |
| `--destructive-foreground` | `#fafafa` | `250 250 250` |
| `--success` | `#22c55e` | `34 197 94` |
| `--success-foreground` | `#000000` | `0 0 0` |
| `--warning` | `#f59e0b` | `245 158 11` |
| `--warning-foreground` | `#000000` | `0 0 0` |
| `--info` | `#0ea5e9` | `14 165 233` |
| `--info-foreground` | `#fafafa` | `250 250 250` |

#### Dark mode (`.dark`)

| Token | Hex | RGB |
|---|---|---|
| `--background` | `#09090b` | `9 9 11` |
| `--surface` | `#18181b` | `24 24 27` |
| `--surface-raised` | `#27272a` | `39 39 42` |
| `--border` | `#27272a` | `39 39 42` |
| `--border-subtle` | `#18181b` | `24 24 27` |
| `--input` | `#27272a` | `39 39 42` |
| `--foreground` | `#fafafa` | `250 250 250` |
| `--muted` | `#18181b` | `24 24 27` |
| `--muted-foreground` | `#a1a1aa` | `161 161 170` |
| `--accent` | `#10b981` | `16 185 129` |
| `--accent-foreground` | `#000000` | `0 0 0` |
| `--accent-hover` | `#34d399` | `52 211 153` |
| `--accent-hover-foreground` | `#000000` | `0 0 0` |
| `--accent-subtle` | `#022c22` | `2 44 34` |
| `--accent-subtle-foreground` | `#6ee7b7` | `110 231 183` |
| `--accent-active` | `#6ee7b7` | `110 231 183` |
| `--accent-active-foreground` | `#022c22` | `2 44 34` |
| `--ring` | `#10b981` | `16 185 129` |
| `--item-hover` | `#27272a` | `39 39 42` |
| `--destructive` | `#dc2626` | `220 38 38` |
| `--destructive-foreground` | `#fafafa` | `250 250 250` |
| `--success` | `#22c55e` | `34 197 94` |
| `--success-foreground` | `#000000` | `0 0 0` |
| `--warning` | `#f59e0b` | `245 158 11` |
| `--warning-foreground` | `#000000` | `0 0 0` |
| `--info` | `#0ea5e9` | `14 165 233` |
| `--info-foreground` | `#fafafa` | `250 250 250` |

> `--destructive` is red-600 (`#dc2626`), not red-500 — bumped so `--destructive-foreground` passes WCAG AA on it (red-500 fails at ~3.9:1). `--item-hover` is the semantic token for list/menu item hover backgrounds.

### WCAG AA contrast (≥ 4.5:1)

| Combination | Mode | Ratio | Pass |
|---|---|---|---|
| `--foreground` on `--background` | Dark | 19.6:1 | ✓ |
| `--muted-foreground` on `--background` | Dark | 7.9:1 | ✓ |
| `--accent` on `--background` | Dark | 8.5:1 | ✓ |
| `--accent-foreground` on `--accent` | Both | 8.7:1 | ✓ |
| `--accent-hover` on `--background` | Dark | 10.9:1 | ✓ |
| `--accent-active` on `--background` | Dark | 13.8:1 | ✓ |
| `--destructive-foreground` on `--destructive` | Both | 4.6:1 | ✓ |

---

## 3. Typography

Sans-serif only. No display serif.

| Token | Font | Usage |
|---|---|---|
| `--font-sans` | Geist Sans | All UI, headings, body |
| `--font-mono` | Geist Mono | Code, technical labels, stats |

| Scale | Tailwind | Weight | Tracking | Usage |
|---|---|---|---|---|
| Display | `text-7xl–text-9xl` | `font-bold` | `-0.04em` | Hero H1 only |
| Headline | `text-3xl–text-4xl` | `font-semibold` | `-0.02em` | Section titles |
| Title | `text-xl–text-2xl` | `font-semibold` | default | Card headings |
| Body | `text-base` | `font-normal` | default | Paragraphs, `leading-relaxed` |
| Small | `text-sm` | `font-medium` | default | Labels, metadata |
| Micro | `text-xs` | `font-medium` | `0.04em uppercase` | Tags, badges |

---

## 4. Surface & Material Language

Build dark first, invert to light.

**Dark:** Zinc near-black. Cold and clean — the green pops harder against cold neutral than warm. Surfaces layer in 10-point luminance steps.

**Light:** Standard zinc white. Not warm — warmth is the person, not the palette.

**Avoid:**
- True black (`#000`) or true white (`#fff`) as bg/surface
- Glassmorphism with cool/blue tints — use `background/80` not `white/80`
- Colored shadows — `black/20` only
- Heavy gradients — 2-stop max, subtle

**Keep:**
- Fine grid overlay on hero — adds precision
- Frosted glass nav — Vercel signature

---

## 5. Radius & Spacing

| Token | Value |
|---|---|
| `--radius-sm` | `0.25rem` |
| `--radius` | `0.5rem` |
| `--radius-lg` | `0.75rem` |
| `--radius-xl` | `1rem` |
| `--radius-full` | `9999px` |

---

## 6. Component Philosophy

Infrastructure with no visual opinion gets installed: Radix UI, Lucide, next/font, next-themes, Framer Motion. Invisible plumbing.

Anything with a visual opinion — buttons, cards, inputs, effects, motion — gets built in `@crawfordyoung/ui`. Study how Cult UI, Magic UI, and Aceternity achieve their feel. Implement the same *principle*, not the same code. Components should be recognizably ours.

**Ambient backgrounds** (Aurora etc.) are acceptable as direct deps — they're scenery, not UI. Keep them isolated to section backdrops, never inside interactive components.

### Visual components

| Component | Principle | Status |
|---|---|---|
| `CountUp` | Animated number reveal with easing (spec'd as `NumberTicker`) | ✅ Shipped in `@crawfordyoung/ui` (wave 5a) |
| `SplitText` | Staggered character reveal | ⚠️ Lives in portfolio `src/components/effects/` — still needs moving into library |
| `Spotlight` / `SpotlightCard` | Cursor-following radial gradient within card bounds | ⚠️ Lives in portfolio `src/components/effects/` — still needs moving into library |
| `Marquee` | Infinite scroll — CSS linear infinite, pause on hover, bidirectional | ❌ Not built |
| `BorderTrail` | Animated gradient tracing the border | ❌ Not built |
| `MagneticButton` | Button attracted toward cursor via Framer `useMotionValue`; hero CTA only | ❌ Not built (optional) |

---

## 7. Motion

- **Default:** Tailwind `transition-*` for micro-interactions
- **Framer Motion:** page transitions, shared layout, magnetic/physics
- **Always:** `motion-safe:` prefix on all Tailwind animations; check `prefers-reduced-motion` in Framer hooks
- **Speed:** 150–250ms exits, 200–400ms entrances, 500–600ms hero reveals max

---

## 8. Loading & Transition States — Cinematic Model

**Principle:** Loading is experience, not apology. No spinners, ever. Loading states give the user something to *be in* while the system works — Naughty Dog rule: disguise loading as content arriving.

### Pattern 1 — Skeleton Reveal

Skeleton blocks match the exact content shape. Background: `--surface` with shimmer sweep using `--accent-subtle` as glow. On arrival, crossfade over skeleton in 200ms. Grid cards stagger 40ms per card.

```
skeleton → content crossfade: 200ms ease-out
grid stagger: 40ms × index, capped at 5 cards
shimmer: 1.5s linear infinite, emerald-deep glow
```

### Pattern 2 — Cinematic Progress

2px line at top of viewport. Fills with `--accent`. Fast start (0→60% in 300ms), slow crawl (60→90% over real load time), snaps to 100% and fades on complete.

```
phase 1: 0→60% in 300ms, ease-out-quart
phase 2: 60→90% over real duration, linear
phase 3: 90→100% in 150ms, then fade 200ms
```

### Pattern 3 — Ambient Typewriter

Monospace ghost text (`--font-mono`, `--muted-foreground` at 60% opacity) streams curated context phrases while real response is pending. Examples: `initializing context...`, `reading repositories`, `cross-referencing`. Real content streams in via same component on arrival — seamless handoff.

```
typewriter: 40ms/char
ghost fade out: 150ms ease-in on arrival
```

### Pattern 4 — Environment Shift

Ambient background increases intensity ~20% during loading. Settles back on complete. 400ms ease-in-out both directions. Never runs alone — always alongside Pattern 2 or 3.

### Pattern 5 — Staggered Arrival

Content arrives, it doesn't snap. Hero text: SplitText 30ms word stagger, `translateY(12px) → 0`, 400ms ease-out-quart. Cards: 40ms stagger, `translateY(8px) → 0`. Numbers: NumberTicker 800ms. Images: opacity fade 300ms after container settles.

### When each pattern fires

| Situation | Pattern |
|---|---|
| Page navigation | 2 + 4 |
| RSC data fetch / card load | 1 + 4 |
| AI / long API call (>1.5s) | 3 + 4 |
| Any content arrival | 5 |
| Short API call (<1.5s) | 5 only |

### Never

- Spinners
- Percentage text on progress
- "Loading..." text
- Opacity-only pulsing skeletons
- Blocking overlays over existing content

### `prefers-reduced-motion`

- Pattern 1: shimmer off, skeleton static, crossfade still fires
- Pattern 2: no easing curve, linear fill
- Pattern 3: speed 0ms (text appears in chunks instantly)
- Pattern 4: disabled entirely
- Pattern 5: transforms off, opacity fades only

### Component library additions

| Component | Pattern | Status |
|---|---|---|
| `Skeleton` | 1 — shimmer variant | ⚠️ Shipped, but current implementation is `animate-pulse` — the shimmer variant this spec requires is not built yet (pulse-only is on the "Never" list above) |
| `ProgressLine` | 2 — top-of-viewport bar | ❌ Not built |
| `TypewriterStream` | 3 — ghost text + stream handoff | ❌ Not built |
| `StaggerReveal` | 5 — stagger wrapper | ❌ Not built |

### Known divergence — `Spinner`

`@crawfordyoung/ui` ships a `Spinner` component (wave 1, predates this spec). That conflicts with the "no spinners, ever" rule. Unresolved — either deprecate `Spinner` once Pattern 1–3 components exist, or scope the rule to page/content loading and keep `Spinner` for inline button-level pending states. Decide before Phase 4 work starts.

---

## 9. Dark / Light Mode

- `defaultTheme="dark"` everywhere
- Both modes QA'd before any feature ships
- Never hardcode colors — always semantic tokens so dark mode is automatic

---

## 10. Implementation Order

### Phase 1 — Token extension ✅ Done
Shipped in `tokens.css`: `--accent-hover`/`--accent-subtle`/`--accent-active` families, plus two post-spec additions — `--destructive` bumped to red-600 for WCAG AA, and `--item-hover` for list/menu hover backgrounds.

### Phase 2 — Portfolio skin 🟡 Partial
1. ✅ Hardcoded colors removed from components (only remaining hex values are in the Sentry boilerplate example page, not a brand surface)
2. ❌ Wire new accent token variants to Aurora intensity/color — `aurora.tsx` doesn't reference `--accent-hover/-subtle/-active` yet

### Phase 3 — Visual components 🟡 Partial
`CountUp` shipped (wave 5a). Remaining: move `SplitText` + `Spotlight` from portfolio `effects/` into the library; build `Marquee`, `BorderTrail`, `MagneticButton`.

### Phase 4 — Cinematic loading ❌ Not started
`Skeleton` shimmer variant, `ProgressLine`, `TypewriterStream`, `StaggerReveal`. Resolve the `Spinner` divergence (§8) first.
