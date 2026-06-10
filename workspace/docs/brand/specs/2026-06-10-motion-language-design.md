# Cinematic Motion Language — Design Spec

**Date:** 2026-06-10
**Status:** Approved
**Outcome:** Third living doc `docs/brand/motion.md` owning all motion; `brand-identity.md` §7–8 become pointers; motion primitives ship from `@crawfordyoung/ui`.

---

## 1. Problem

Brand goal: software that feels like a marketing video. `brand-identity.md` §7 covers only timing rules, §8 covers loading states. Page transitions, scroll choreography, shared-element continuity, and micro-interaction motion are undocumented — each app invents its own, and the apps drift.

## 2. Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Scope | All apps, full cinematic — tiered by **surface type**, not per app |
| Transition character | Mixture — morph / scene cut / crossfade, mapped per situation (§5) |
| Scroll | Reveals + parallax as default language; scrollytelling opt-in for landing pages; scroll never hijacked |
| Micro-interactions | In scope — one doc owns all motion |
| Doc home | New living doc `docs/brand/motion.md`; brand-identity §7–8 shrink to pointers |
| Transition tech | **View Transitions API** (Next.js experimental `viewTransition` + React `<ViewTransition>`) for routes; Framer Motion for everything in-page. No-VT browsers fall back to instant swap + enter-only arrival choreography |
| Ownership | Library owns tokens + primitives; apps own route wiring + composition |

Rejected: Framer `AnimatePresence` for routes (App Router exit animations fragile, `layoutId` doesn't survive route changes); enter-only-everywhere (caps ceiling — no continuity morph); GSAP/scroll-jacking libs (never).

## 3. Principles

1. **Nothing snaps** — every state change animated, even 100ms ones.
2. **Choreography over simultaneity** — elements arrive in reading order, staggered; never all at once.
3. **Continuity** — user tracks where things came from; morph > cut > fade when an element persists across views.
4. **Scroll is sacred** — motion responds to scroll, never controls it. Native speed always.
5. **Motion is brand** — one easing family everywhere; wrong curve = off-brand same as wrong green.
6. **Respect the request** — `prefers-reduced-motion` degrades every pattern, never removes content.

## 4. Motion tokens

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

Values tokenize existing §7 speed rules + §8 stagger values — no behavior change.

## 5. Page transitions

ProgressLine (loading Pattern 2) fires on any navigation taking >150ms (per §7 handoff sequence). Shared elements get `view-transition-name`.

| Navigation | Transition | Detail |
|---|---|---|
| Card/list item → its detail page | **Continuity morph** | Card image+title morph to hero; rest of detail staggers in after morph lands |
| Sibling pages (nav links, tabs-as-routes) | **Scene cut** | Exit: fade + translateY(-8px), `--motion-fast`, `--ease-exit`. Enter: fade + translateY(12px)→0, `--motion-slow`, `--ease-out` |
| Detail → back to list | **Reverse morph** | Hero shrinks back into card position |
| Working-surface navigation (dashboard tabs, settings) | **Crossfade** | `--motion-base`, no translate; ProgressLine carries feedback |
| Same-page state (filters, sort) | **None route-level** | Arrival choreography on changed region only |

Rules: max **one** morphing element pair per navigation (focal point, not everything flying). Morph: `--motion-slow`, `--ease-in-out`. Reduced-motion: all rows → instant swap + opacity-only arrivals.

## 6. Scroll choreography

**Layer 1 — Reveals (default, all surfaces):** sections animate in entering viewport — translateY(16px)→0 + fade, `--motion-slow`, `--ease-out`; children stagger 40ms in reading order, cap 5. Trigger at 20% visibility, fire **once** (no re-animate on scroll-up). Library: `<ScrollReveal>` (Framer `whileInView`).

**Layer 2 — Parallax depth (cinematic surfaces only):** ambient/aurora 0.3× scroll rate, decorative mid-layer 0.6×, content 1×. Max 80px total drift per viewport height — texture, not effect. Hero images: scale 1.05→1 + drift on scroll-out. Library: `<Parallax rate={0.3}>` (Framer `useScroll` + `useTransform`).

**Layer 3 — Scrollytelling (opt-in, landing pages only, content must justify):** pinned section via CSS `position: sticky` + Framer scroll progress scrubbing. Native scroll speed always. Bespoke per page; library provides `useScrollProgress` hook only, no prefab.

Reduced-motion: Layer 1 → opacity only; Layers 2–3 → static (scrollytelling content laid out linearly).

## 7. Arrival + loading

Loading patterns 1–5, fire-table, never-list, and reduced-motion table migrate from `brand-identity.md` §8 into motion.md **unchanged**. Two extensions:

1. **Arrival is universal:** Pattern 5 (Staggered Arrival) applies after *every* content appearance — page load, route transition, scroll reveal, data refresh, optimistic-update reconciliation. Same curve, same stagger.
2. **Transition/loading handoff:** navigation sequence = `exit (−8px fade) → ProgressLine if >150ms → arrival stagger`. Skeleton (Pattern 1) only when layout shape is known, renders only if fetch exceeds 300ms, then displays min 500ms — kills the skeleton-flash anti-pattern.

Spinner divergence migrates as-is, unresolved (explicitly deferred by user).

## 8. Micro-interactions

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

## 9. Surface tiers

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

## 10. Library API (@crawfordyoung/ui)

- `tokens.css`: add `--motion-*` + `--ease-*` vars
- TS exports: `MOTION`, `EASE`, `STAGGER`
- New primitives: `ScrollReveal`, `Parallax`, `StaggerReveal`, `ProgressLine`, `TypewriterStream`, `Skeleton` shimmer variant, `MagneticButton`, `useScrollProgress`, `useReducedMotionSafe`
- Move in from portfolio: `SplitText`, `Spotlight` (existing Phase 3 plan, unchanged)
- `framer-motion` = **peer dependency**
- Every primitive: reduced-motion baked in, 100% coverage + story + axe per library standards

Apps own: `viewTransition` flag in `next.config.ts`, route wiring, `view-transition-name` assignment, per-surface composition.

## 11. Implementation order

1. **Tokens** — `tokens.css` vars + TS constants
2. **Core primitives** — `ScrollReveal`, `StaggerReveal`, `ProgressLine`, `Skeleton` shimmer (clears existing Phase 4 backlog)
3. **Transitions** — VT flag in portfolio, scene cuts, card→detail morph
4. **Cinematic extras** — `Parallax`, `MagneticButton`, `TypewriterStream`, `useScrollProgress`
5. **Per-app compliance** — joins deferred design-system compliance waves

Absorbs `brand-identity.md` §10 Phases 3–4.

## 12. Migration plan (doc work)

1. Create `docs/brand/motion.md` — principles, tokens, transitions, scroll, arrival+loading (migrated §8 content), micro, tiers, library API
2. `brand-identity.md` §7 and §8 → pointers to motion.md
3. `brand-identity.md` §10 Phases 3–4 → point at motion.md implementation order
4. Update CLAUDE.md companion-references line (`docs/brand/` entry) to list motion.md
5. Update `docs/brand/` index/README if present

## 13. Out of scope

- Spinner divergence resolution (deferred by user)
- Per-app compliance retrofits (own waves)
- Sound design / haptics
- Building motion.md content beyond what this spec decides — motion.md is assembled from this spec during implementation
