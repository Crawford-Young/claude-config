# Motion — Crawford Young

Living reference for all motion: page transitions, scroll choreography, arrival, loading, micro-interactions. Re-verified against code and updated in place. Decision record: [`specs/2026-06-10-motion-language-design.md`](./specs/2026-06-10-motion-language-design.md).

**Code source of truth:** `component-library/src/styles/tokens.css` (CSS vars) + `component-library/src/lib/motion.ts` (TS constants) — if doc and code disagree, code wins; fix the doc.

---

## 1. Principles

1. **Nothing snaps** — every state change animated, even 100ms ones.
2. **Choreography over simultaneity** — elements arrive in reading order, staggered; never all at once.
3. **Continuity** — user tracks where things came from; morph > cut > fade when an element persists across views.
4. **Scroll is sacred** — motion responds to scroll, never controls it. Native speed always.
5. **Motion is brand** — one easing family everywhere; wrong curve = off-brand same as wrong green.
6. **Respect the request** — `prefers-reduced-motion` degrades every pattern, never removes content.

---

## 2. Motion Tokens

CSS vars in library `tokens.css` + exported TS constants (`MOTION`, `EASE`, `STAGGER` — Framer array + CSS string forms).

```
--motion-instant: 100ms   micro feedback (press, toggle)
--motion-fast:    150ms   hover, exits
--motion-base:    250ms   standard transitions, crossfades
--motion-slow:    400ms   entrances, scene cuts
--motion-hero:    600ms   hero reveals — ceiling, nothing slower

--ease-out:    cubic-bezier(0.25, 1, 0.5, 1)    arrivals (ease-out-quart, existing brand standard)
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)   environment shifts, morphs
--ease-exit:   cubic-bezier(0.5, 0, 0.75, 0)    departures (accelerate out)

stagger: 30ms words / 40ms cards / cap 5 items   (existing §8 values, now canonical)
spring (Framer, magnetic only): stiffness 300, damping 25
```

---

## 3. Page Transitions

ProgressLine (loading Pattern 2) fires on any navigation taking >150ms (per §5 handoff sequence). Shared elements get `view-transition-name`.

| Navigation | Transition | Detail |
|---|---|---|
| Card/list item → its detail page | **Continuity morph** | Card image+title morph to hero; rest of detail staggers in after morph lands |
| Sibling pages (nav links, tabs-as-routes) | **Scene cut** | Exit: fade + translateY(-8px), `--motion-fast`, `--ease-exit`. Enter: fade + translateY(12px)→0, `--motion-slow`, `--ease-out` |
| Detail → back to list | **Reverse morph** | Hero shrinks back into card position |
| Working-surface navigation (dashboard tabs, settings) | **Crossfade** | `--motion-base`, no translate; ProgressLine carries feedback |
| Same-page state (filters, sort) | **None route-level** | Arrival choreography on changed region only |

Rules: max **one** morphing element pair per navigation (focal point, not everything flying). Morph: `--motion-slow`, `--ease-in-out`. Reduced-motion: all rows → instant swap + opacity-only arrivals.

---

## 4. Scroll Choreography

**Layer 1 — Reveals (default, all surfaces):** sections animate in entering viewport — translateY(16px)→0 + fade, `--motion-slow`, `--ease-out`; children stagger 40ms in reading order, cap 5. Trigger at 20% visibility, fire **once** (no re-animate on scroll-up). Library: `<ScrollReveal>` (Framer `whileInView`).

**Layer 2 — Parallax depth (cinematic surfaces only):** ambient/aurora 0.3× scroll rate, decorative mid-layer 0.6×, content 1×. Max 80px total drift per viewport height — texture, not effect. Hero images: scale 1.05→1 + drift on scroll-out. Library: `<Parallax rate={0.3}>` (Framer `useScroll` + `useTransform`).

**Layer 3 — Scrollytelling (opt-in, landing pages only, content must justify):** pinned section via CSS `position: sticky` + Framer scroll progress scrubbing. Native scroll speed always. Bespoke per page; library provides `useScrollProgress` hook only, no prefab.

Reduced-motion: Layer 1 → opacity only; Layers 2–3 → static (scrollytelling content laid out linearly).

---

## 5. Arrival & Loading

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

### Arrival is universal

Pattern 5 (Staggered Arrival) applies after *every* content appearance — page load, route transition, scroll reveal, data refresh, optimistic-update reconciliation. Same curve, same stagger.

### Transition/loading handoff

Navigation sequence = `exit (−8px fade) → ProgressLine if >150ms → arrival stagger`. Skeleton (Pattern 1) only when layout shape is known, renders only if fetch exceeds 300ms, then displays min 500ms — kills the skeleton-flash anti-pattern.

---

## 6. Micro-interactions

| Interaction | Spec |
|---|---|
| Hover (cards, list items) | translateY(-2px) + elevation step up, `--motion-fast`, `--ease-out`; background → `--item-hover` |
| Hover (buttons) | `--accent` → `--accent-hover`, `--motion-fast`; no translate — buttons stay planted |
| Press | scale(0.98), `--motion-instant`; release springs back `--ease-out` |
| Focus | Ring fades in `--motion-fast` — never instant ring pop |
| Magnetic (hero CTAs, cinematic surfaces only) | Spring stiffness 300 / damping 25, max pull 8px |
| Toggle / switch / checkbox | Thumb/check animates `--motion-base`, `--ease-in-out` |
| Accordion / collapse | Height + opacity `--motion-base`; chevron rotates same duration |
| Tooltip / popover | Fade + scale(0.96→1) from trigger side, `--motion-fast` |
| Number changes | NumberTicker 800ms (existing) |

Rules: micro never exceeds `--motion-base`. Hover effects gated on `@media (hover: hover)`. Reduced-motion: transforms off, color/opacity changes stay.

---

## 7. Surface Tiers

Tier is per **surface type**, not per app. Working tier is still fully animated — nothing snaps anywhere — it skips spatial theatrics only.

| Pattern | Cinematic (landing, hero, marketing, portfolio, auth/onboarding) | Working (dashboards, tables, forms, settings, CRUD) |
|---|---|---|
| Continuity morph / scene cut | ✅ | ❌ (crossfade) |
| Scroll reveals (Layer 1) | ✅ | ✅ |
| Parallax (Layer 2) | ✅ | ❌ |
| Scrollytelling (Layer 3) | opt-in | ❌ |
| Arrival choreography | ✅ | ✅ |
| All loading patterns | ✅ | ✅ |
| Micro-interactions | ✅ | ✅ |
| Magnetic | ✅ | ❌ |
| Environment shift (Pattern 4) | ✅ | ❌ |

Defaults: landing/auth routes = cinematic; in-app authed routes = working. Judgment call: surface's job is to impress → cinematic; daily use → working.

---

## 8. Library API & Implementation Order

### Library API (`@crawfordyoung/ui`)

- `tokens.css`: add `--motion-*` + `--ease-*` vars
- TS exports: `MOTION`, `EASE`, `STAGGER`
- New primitives: `ScrollReveal`, `Parallax`, `StaggerReveal`, `ProgressLine`, `TypewriterStream`, `Skeleton` shimmer variant, `MagneticButton`, `useScrollProgress`, `useReducedMotionSafe`
- Move in from portfolio: `SplitText`, `Spotlight` (existing Phase 3 plan, unchanged)
- `framer-motion` = **peer dependency**
- Every primitive: reduced-motion baked in, 100% coverage + story + axe per library standards

Apps own: `viewTransition` flag in `next.config.ts`, route wiring, `view-transition-name` assignment, per-surface composition.

### Implementation Order

1. 🟡 **Tokens** — `tokens.css` vars + TS constants *(in progress)*
2. **Core primitives** — `ScrollReveal`, `StaggerReveal`, `ProgressLine`, `Skeleton` shimmer (clears existing Phase 4 backlog)
3. **Transitions** — VT flag in portfolio, scene cuts, card→detail morph
4. **Cinematic extras** — `Parallax`, `MagneticButton`, `TypewriterStream`, `useScrollProgress`
5. **Per-app compliance** — joins deferred design-system compliance waves

Absorbs `brand-identity.md` §10 Phases 3–4.
