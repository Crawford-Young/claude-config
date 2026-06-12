# Brand & Design Docs

Single source for how everything Crawford Young ships looks, moves, and speaks. Three living references below are re-verified against code and updated in place.

> **Reference docs only.** This directory is junctioned from the `claude-config` repo. Brand project working artifacts — specs, checklists, issues, screenshots, continuation handoffs, assets — live in `~/code/docs/brand-design/` (local-private docs repo), never here.

| Doc | Covers | Load when |
|---|---|---|
| [`brand-identity.md`](./brand-identity.md) | Identity, color tokens, typography, surface language | Styling, theming |
| [`design-system.md`](./design-system.md) | Layout anatomy, elevation, density, empty/error states, iconography, data viz, voice & copy | Building pages, composing components, writing UI copy |
| [`motion.md`](./motion.md) | Page transitions, scroll choreography, arrival, loading, micro-interactions, motion tokens | Animating anything — transitions, loading states, hover/press |

**Code source of truth for tokens:** `component-library/src/styles/tokens.css` — if doc and code disagree, code wins; fix the doc.

**Product brand layers** extend these docs, never replace them:

- Cybond (naming, logo, voice, splash) → [`docs/scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md`](../scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md)

**Assets:** `~/code/docs/brand-design/assets/` (profile photo, Cybond logo).
