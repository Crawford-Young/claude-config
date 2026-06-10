# Design System Doc + Brand Docs Reorganization — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** `docs/brand/` reorganization + new `design-system.md` living reference (composition layer for all apps)

---

## 1. Problem

`spec-brand-identity.md` is deep on identity (tokens, contrast, typography, motion timing, cinematic loading) but silent on composition: layout anatomy, elevation, density, empty/error states, iconography, data viz, voice. Without these documented, each app invents its own structure and the apps drift apart visually. Brand docs are also loosely organized: living references carry a `spec-` prefix that implies dated decision records, assets sit loose in `docs/brand/`, and there is no index.

## 2. Goals

- Every app built in this workspace shares one distinct, recognizable composition language.
- Agents can build pages without judgment calls — exact values, not vibes.
- `docs/brand/` is self-explanatory: an index says what lives where and when to load it.

## 3. Doc reorganization

### Target state

```
docs/brand/
  README.md            # index, ~20 lines
  brand-identity.md    # renamed from spec-brand-identity.md — content unchanged
  design-system.md     # NEW — composition layer
  specs/               # dated decision records for brand work (this file)
  assets/
    profilePic.jpg
    cybond.png
```

### Naming rationale

`brand-identity.md` and `design-system.md` are **living references** — re-verified against code, updated in place. Dated `spec-*` files are decision records. The `spec-` prefix comes off the living doc to make that distinction real.

### README.md contents

- One-paragraph purpose
- Table of the two living docs: what each covers, when to load it
- Pointers to product brand layers (Cybond rebrand spec in `docs/scheduling-advisor/specs/`)
- Pointer to `component-library/src/styles/tokens.css` as code source of truth

### Pointer updates

Seven files reference `spec-brand-identity.md`; all get the new path (done checklists included — cheap, keeps grep clean):

1. `CLAUDE.md` (workspace)
2. `docs/agents/COMPONENT-AGENT.md`
3. `docs/component-library/specs/spec-2026-04-26-wave4-design.md`
4. `docs/component-library/specs/2026-06-09-loading-indicator-design.md`
5. `docs/component-library/checklists/active/component-library-loading-indicators.md`
6. `docs/component-library/checklists/done/component-library-wave4-plan-wave4-polish.md`
7. `docs/component-library/checklists/done/plan-wave4-polish.md`

CLAUDE.md companion line becomes:

> `docs/brand/` — brand identity + design system (load `brand-identity.md` for tokens/colors/motion, `design-system.md` for layout/states/composition)

### Header metadata

Both living docs carry the existing convention: `Status / Last verified against code / Scope`.

## 4. design-system.md contents

Seven sections. Exact-values rigor throughout — exact Tailwind classes, px values, named patterns — same discipline as the token tables in `brand-identity.md`. Values are filled by the audit (§5); the outline below fixes the shape.

### §1 Layout anatomy

- Page shell: max-widths per surface type (marketing page vs app page vs full-bleed chat), horizontal padding scale per breakpoint
- Nav spec: frosted glass recipe (`backdrop-blur` value, `background/80`, border treatment), height, sticky behavior
- Section rhythm: vertical spacing between page sections; hero structure (fine grid overlay recipe lives here)
- Footer pattern
- Breakpoints: which Tailwind defaults are in play, mobile-first rules

### §2 Elevation

- Four-level scale: flat → card → popover/dropdown → modal
- Each level: exact shadow value (`black/20` family per brand spec), border treatment, `--surface` layer, z-index band
- Rule: elevation = shadow + surface step together, never shadow alone

### §3 Density & spacing rhythm

- 4/8pt usage: which Tailwind spacing steps are allowed in component internals vs layout gaps
- Form layout: label position, field gap, section gap, max form width
- Table/list density: row heights, cell padding
- Card internals: padding scale by card size

### §4 Empty / error / zero states

- Empty state anatomy: muted icon + one-line headline + optional action, centered in content area — exact classes
- Error page (404/500) pattern
- Inline error pattern: form-level vs field-level
- Rule: every list/grid view ships its empty state — not optional

### §5 Iconography

- Lucide only; stroke width; size scale mapped to type scale (16/20/24); color rules (inherit vs muted vs accent)
- Icons paired with a label by default; icon-only requires `aria-label` + tooltip

### §6 Data viz

- Ordered series palette derived from emerald + neutrals (audit Cybond calendar for what exists)
- Status mapping reuses semantic tokens (`--success` / `--warning` / `--destructive` / `--info`)
- Grid/axis colors for dark + light

### §7 Voice & copy

- Tone: precise, calm; no exclamation marks; no apology language ("Oops")
- Button labels: verb-first, ≤3 words
- Error messages: what happened + what to do; no user-facing error codes
- Microcopy casing: sentence case everywhere except Micro/tag scale (uppercase per the type table in `brand-identity.md`)

## 5. Audit process (first implementation task)

Audit shipped code before writing any value:

- **Portfolio** (`Crawford-Young.github.io`): page shell, nav recipe, hero/grid overlay, section rhythm, footer
- **Cybond** (`scheduling-advisor`): app-surface layout, forms, calendar/chat density, any chart colors
- **component-library**: existing shadows, paddings, icon sizes in shipped components

Conflicts between apps: pick the best implementation, log the others in a divergence table inside `design-system.md` (same convention as the Spinner note in `brand-identity.md` §8).

## 6. Out of scope

- **Cinematic motion language** ("software feels like a marketing video" — page transitions, scroll choreography, shared-layout animation). Follow-up brainstorm after this wave; natural home is `brand-identity.md` §7–8 or a third living doc if it grows large.
- **Spinner divergence** (`brand-identity.md` §8) — explicitly deferred by user.
- **Retrofitting apps to comply** — this wave ships docs + reorg only; per-app compliance is later waves.
- **Content changes to `brand-identity.md`** beyond the rename and pointer fixes.

## 7. Follow-ups

1. Cinematic motion language brainstorm (above).
2. Per-app compliance waves once `design-system.md` ships.
