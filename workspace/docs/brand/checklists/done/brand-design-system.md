# Brand Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `docs/brand/` and ship `design-system.md` — the composition layer (layout, elevation, density, states, icons, data viz, voice) that keeps all workspace apps visually identical in structure.

**Architecture:** Docs-only wave, audit-then-codify. First the file reorg + pointer fixes, then a composition audit of shipped code (portfolio, Cybond, component-library), then `design-system.md` written from audit findings with specified fallback defaults where the audit finds nothing.

**Tech Stack:** Markdown only. No code, no tests, no TDD. `~/code/docs` is **not a git repository** — there are no commit steps; file writes are the deliverable.

**Spec:** `docs/brand/specs/2026-06-10-design-system-design.md`

---

### Task 1: Create issue log

**Files:**
- Create: `C:\Users\young\code\docs\brand\issues\2026-06-10-design-system-issues.md`

- [x] **Step 1: Write the issue log file**

```markdown
# Design System Wave — Issue Log

**Wave:** brand-design-system (2026-06-10)
**Spec:** ../specs/2026-06-10-design-system-design.md

Living log of wrong assumptions, missing behaviors, and bugs discovered during the wave. Reviewed at reflect, then moved to `done/`.

---

(no entries yet)
```

---

### Task 2: Reorganize docs/brand/ files

**Files:**
- Move: `docs\brand\profilePic.jpg` → `docs\brand\assets\profilePic.jpg`
- Move: `docs\brand\cybond.png` → `docs\brand\assets\cybond.png`
- Rename: `docs\brand\spec-brand-identity.md` → `docs\brand\brand-identity.md`

- [x] **Step 1: Create assets dir and move files**

```powershell
New-Item -ItemType Directory -Force C:\Users\young\code\docs\brand\assets
Move-Item C:\Users\young\code\docs\brand\profilePic.jpg C:\Users\young\code\docs\brand\assets\profilePic.jpg
Move-Item C:\Users\young\code\docs\brand\cybond.png C:\Users\young\code\docs\brand\assets\cybond.png
Move-Item C:\Users\young\code\docs\brand\spec-brand-identity.md C:\Users\young\code\docs\brand\brand-identity.md
```

- [x] **Step 2: Verify**

```powershell
Get-ChildItem C:\Users\young\code\docs\brand -Recurse -Name
```
Expected: `assets\cybond.png`, `assets\profilePic.jpg`, `brand-identity.md`, `checklists\...`, `issues\...`, `specs\...` — no `spec-brand-identity.md`, no loose images.

- [x] **Step 3: Check nothing references the image paths**

```powershell
# from C:\Users\young\code
```
Grep for `profilePic.jpg|cybond.png` across `C:\Users\young\code` (exclude `docs\brand\`). If hits exist outside docs/brand, update those paths to `docs/brand/assets/...`. Expected: zero hits (images were referenced nowhere as of planning).

---

### Task 3: Update the 7 pointer files

**Files:**
- Modify: `CLAUDE.md:14`
- Modify: `docs\agents\COMPONENT-AGENT.md:112`
- Modify: `docs\component-library\specs\spec-2026-04-26-wave4-design.md:92`
- Modify: `docs\component-library\specs\2026-06-09-loading-indicator-design.md:6,111`
- Modify: `docs\component-library\checklists\active\component-library-loading-indicators.md:1108,1114`
- Modify: `docs\component-library\checklists\done\component-library-wave4-plan-wave4-polish.md:597`
- Modify: `docs\component-library\checklists\done\plan-wave4-polish.md`

- [x] **Step 1: Replace CLAUDE.md line 14 (companion references list)**

Old:
```markdown
> - [`docs/brand/spec-brand-identity.md`](./docs/brand/spec-brand-identity.md) — brand identity, tokens, colors, typography (load when styling or theming)
```

New:
```markdown
> - [`docs/brand/`](./docs/brand/) — brand identity + design system (load `brand-identity.md` for tokens/colors/motion, `design-system.md` for layout/states/composition)
```

- [x] **Step 2: In each of the other 6 files, replace all occurrences** *(note: only 6 pointer files existed total — 7th was phantom, logged in issue log)*

In every file listed above except CLAUDE.md, replace all occurrences of the string `spec-brand-identity.md` with `brand-identity.md` (Edit tool, `replace_all: true`). Path prefixes (`docs/brand/`, `~/code/docs/brand/`) stay unchanged.

- [x] **Step 3: Verify zero stale references**

Grep `spec-brand-identity` across `C:\Users\young\code`. Expected hits ONLY in: `docs\brand\specs\2026-06-10-design-system-design.md` (historical decision record describing the rename) and this checklist. Any other hit = missed pointer, fix it.

---

### Task 4: Write docs/brand/README.md

**Files:**
- Create: `C:\Users\young\code\docs\brand\README.md`

- [x] **Step 1: Write the file with exactly this content**

```markdown
# Brand & Design Docs

Single source for how everything Crawford Young ships looks, moves, and speaks. Two living references below are re-verified against code and updated in place; dated decision records live in `specs/`.

| Doc | Covers | Load when |
|---|---|---|
| [`brand-identity.md`](./brand-identity.md) | Identity, color tokens, typography, motion timing, cinematic loading patterns | Styling, theming, animating, loading states |
| [`design-system.md`](./design-system.md) | Layout anatomy, elevation, density, empty/error states, iconography, data viz, voice & copy | Building pages, composing components, writing UI copy |

**Code source of truth for tokens:** `component-library/src/styles/tokens.css` — if doc and code disagree, code wins; fix the doc.

**Product brand layers** extend these docs, never replace them:

- Cybond (naming, logo, voice, splash) → [`docs/scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md`](../scheduling-advisor/specs/2026-06-03-cybond-rebrand-design.md)

**Assets:** `assets/` (profile photo, Cybond logo).
```

---

### Task 5: Update brand-identity.md header metadata

**Files:**
- Modify: `C:\Users\young\code\docs\brand\brand-identity.md:1-5`

- [x] **Step 1: Update title line and scope**

Old:
```markdown
# Brand Identity Spec — Crawford Young

**Status:** Approved
```

New:
```markdown
# Brand Identity — Crawford Young

**Status:** Living reference
```

Rest of header (Last verified, Scope) unchanged. No other content changes to this file this wave.

<!-- COMPACT POINT -->

---

### Task 6: Composition audit — portfolio

**Files:**
- Create: `C:\Users\young\code\docs\brand\specs\2026-06-10-composition-audit.md`
- Read: `Crawford-Young.github.io\src\app\layout.tsx`, nav/header component, footer component, home page hero

- [x] **Step 1: Create the audit file with this skeleton**

```markdown
# Composition Audit — 2026-06-10

Raw findings feeding `design-system.md`. Decision record — do not update after the wave.

## Portfolio (Crawford-Young.github.io)

### Page shell
### Nav
### Hero / grid overlay
### Section rhythm
### Footer

## Cybond (scheduling-advisor)

### App shell
### Forms
### Calendar / chat density
### Chart colors

## component-library

### Shadows in shipped components
### Padding scales
### Icon sizes

## Conflicts found

| Topic | Portfolio | Cybond | Library | Picked |
|---|---|---|---|---|
```

- [x] **Step 2: Audit and fill the Portfolio section**

For each heading, record exact Tailwind classes found (grep then read only matching files):
- **Page shell:** grep `max-w-` in `Crawford-Young.github.io\src` — record container widths and horizontal padding (`px-*`) per breakpoint
- **Nav:** find the header component (grep `backdrop-blur`) — record blur value, background opacity class, border, height, sticky classes
- **Hero / grid overlay:** find grid overlay (grep `bg-grid|grid-overlay|linear-gradient` in hero/home) — record full recipe
- **Section rhythm:** record `py-*` / `space-y-*` / `gap-*` between top-level page sections
- **Footer:** record structure + classes

Each finding: one bullet, `file:line` + classes. No screenshots needed — class extraction only.

---

### Task 7: Composition audit — Cybond

**Files:**
- Modify: `C:\Users\young\code\docs\brand\specs\2026-06-10-composition-audit.md` (Cybond section)

- [x] **Step 1: Audit and fill the Cybond section**

- **App shell:** layout.tsx + main app page — container widths, sidebar/nav pattern, full-bleed chat surface classes
- **Forms:** find a representative form (grep `<form|onSubmit` in `scheduling-advisor\src`) — label position, gap between label/field (`gap-*`/`space-y-*`), gap between fields, max form width
- **Calendar / chat density:** calendar event row height/padding classes; chat message padding + vertical gap
- **Chart colors:** grep `#[0-9a-fA-F]{6}` and `chart|recharts|stroke=|fill=` in `scheduling-advisor\src` — record any series colors in use

Same format: bullet per finding, `file:line` + classes. Conflicts with portfolio findings → add row to Conflicts table, pick winner, note runner-up.

---

### Task 8: Composition audit — component-library

**Files:**
- Modify: `C:\Users\young\code\docs\brand\specs\2026-06-10-composition-audit.md` (library section)

- [x] **Step 1: Audit and fill the library section**

- **Shadows:** grep `shadow-` in `component-library\src\components\ui` — table of component → shadow class (Card, Dialog, Popover, Dropdown, Tooltip, Toast especially)
- **Padding scales:** record `p-*`/`px-*`/`py-*` per sized component (Button sizes, Card, Input, Dialog)
- **Icon sizes:** grep `size=|h-4|h-5|h-6|w-4` in ui components — record icon size per context (button, input affix, menu item, empty state)

- [x] **Step 2: Complete the Conflicts table**

Every topic where the three sources disagree gets a row with a Picked value. Picking rule: library wins for component-internal values (shadows, padding, icons); portfolio wins for marketing-page shell; Cybond wins for app-surface shell and density. Divergences (the non-picked values) carry into the design-system.md divergence table in Task 12.

<!-- COMPACT POINT -->

---

### Task 9: Write design-system.md — skeleton + §1 Layout + §2 Elevation

**Files:**
- Create: `C:\Users\young\code\docs\brand\design-system.md`

- [x] **Step 1: Write file header + section skeleton**

```markdown
# Design System — Crawford Young

**Status:** Living reference
**Last verified against code:** 2026-06-10 (composition audit: `specs/2026-06-10-composition-audit.md`)
**Scope:** All personal projects — portfolio, Cybond, instrumenttuner, future apps. Identity, tokens, motion → [`brand-identity.md`](./brand-identity.md).

Composition layer: how pages are assembled. Exact values only — agents build from this without judgment calls.

---
```

Then seven `## §N` headings matching the spec outline.

- [x] **Step 2: Fill §1 Layout anatomy from audit**

Required content (values from audit Portfolio/Cybond sections; fallback defaults in parens if audit found nothing):

- Surface types table: marketing page (`max-w-6xl px-6 md:px-8`), app page (`max-w-7xl px-4 md:px-6`), full-bleed (chat/calendar: no max-width, internal padding only). Use audited values over defaults.
- Nav: frosted glass recipe — audited classes; fallback `sticky top-0 z-40 h-16 border-b border-border bg-background/80 backdrop-blur-md`
- Hero: grid overlay recipe verbatim from audit (portfolio is source of truth — copy actual classes)
- Section rhythm: audited; fallback `py-24 md:py-32` between marketing sections, `space-y-8` inside app pages
- Footer: audited structure
- Breakpoints: mobile-first; only Tailwind defaults `sm md lg xl`; never `2xl`-specific layout

- [x] **Step 3: Fill §2 Elevation**

Four-level table. Use audited shadow classes where library ships them; fallback defaults:

| Level | Use | Surface | Shadow | Border | z-band |
|---|---|---|---|---|---|
| 0 flat | page content | `--background` | none | none | auto |
| 1 card | cards, panels | `--surface` | `shadow-sm shadow-black/20` | `border-border` | auto |
| 2 floating | popover, dropdown, tooltip, toast | `--surface-raised` | `shadow-lg shadow-black/20` | `border-border` | 50 |
| 3 modal | dialog, sheet | `--surface-raised` | `shadow-xl shadow-black/20` | `border-border` | 100 |

Plus the rule line: "Elevation = surface step + shadow together, never shadow alone."

---

### Task 10: design-system.md — §3 Density + §4 States

**Files:**
- Modify: `C:\Users\young\code\docs\brand\design-system.md`

- [x] **Step 1: Fill §3 Density & spacing rhythm**

From audit (Cybond forms, library padding); fallbacks in parens:

- Allowed spacing steps: component internals `1 1.5 2 3 4` (4–16px); layout gaps `4 6 8 12 16 24`; nothing off-scale
- Forms: labels above fields (`space-y-1.5` label→field, `space-y-4` field→field, `space-y-8` section→section, `max-w-md` single-column forms)
- Tables/lists: rows `h-12` standard, `h-10` dense; cells `px-3`
- Cards: `p-4` compact, `p-6` standard, `p-8` feature

- [x] **Step 2: Fill §4 Empty / error / zero states**

Write exactly (no audit dependency — these are new patterns):

- Empty state anatomy: centered in content area — Lucide icon 24px `text-muted-foreground`, headline `text-sm font-medium text-foreground`, optional one-line `text-sm text-muted-foreground` detail, optional single action button below; container `flex flex-col items-center justify-center gap-2 py-16 text-center`
- Rule: **every list/grid view ships its empty state — not optional**
- Error pages (404/500): same anatomy, headline states what happened, action = "Back to home"; no illustrations, no mascots
- Inline errors: field-level `text-sm text-destructive` directly under field; form-level summary only when error isn't attributable to one field
- States never use spinners or "Loading..." (per brand-identity §8 — loading is its own system)

---

### Task 11: design-system.md — §5 Iconography + §6 Data viz

**Files:**
- Modify: `C:\Users\young\code\docs\brand\design-system.md`

- [x] **Step 1: Fill §5 Iconography**

- Lucide only — no other icon sets, no emoji in UI chrome
- Stroke width: default 2; never override per-icon
- Size scale (audit-verified, fallback): 16px (`size-4`) inline with Small/body text, buttons, inputs; 20px (`size-5`) nav items, titles; 24px (`size-6`) empty states, feature cards
- Color: `currentColor` inherit by default; `text-muted-foreground` for decorative; `text-accent` only for active/selected indicators
- Icon-only controls require `aria-label` + tooltip; default is icon + visible label

- [x] **Step 2: Fill §6 Data viz**

Use audited Cybond chart colors if any exist; otherwise this fallback ordered series (emerald-first, then existing semantic hues — never introduce new hues):

| Order | Token/Hex | Note |
|---|---|---|
| 1 | `--accent` `#10b981` | primary series |
| 2 | `--info` `#0ea5e9` | |
| 3 | `--warning` `#f59e0b` | |
| 4 | `#a1a1aa` zinc-400 | neutral series |
| 5 | `#6ee7b7` emerald-300 | |

- Status coloring always reuses semantic tokens (`--success/--warning/--destructive/--info`) — never the series palette
- Grid lines `border-subtle`, axis labels `text-xs text-muted-foreground`, both modes
- No gradients in chart fills beyond 2-stop `--accent` → transparent at ≤20% opacity

---

### Task 12: design-system.md — §7 Voice + divergence table + scope note

**Files:**
- Modify: `C:\Users\young\code\docs\brand\design-system.md`

- [x] **Step 1: Fill §7 Voice & copy**

Write exactly:

- Tone: precise, calm. No exclamation marks. No apology theater ("Oops!", "Uh oh") — state what happened.
- Buttons: verb-first, ≤3 words ("Create event", not "Click here to create a new event")
- Errors: what happened + what to do next, one sentence each; never show raw codes/stack traces to users
- Casing: sentence case everywhere; uppercase only at Micro/tag scale (per brand-identity type table)
- Numbers/dates: `--font-mono` for stats and timestamps

- [x] **Step 2: Add divergence table**

`## Known divergences` section at file end — one row per non-picked audit conflict (from audit Conflicts table): app, current value, spec value, status "deferred to compliance wave". If audit found no conflicts, write "None found at audit (2026-06-10)."

- [x] **Step 3: Add out-of-scope note**

End of file:

```markdown
> **Not covered here:** cinematic motion language (page transitions, scroll choreography) — follow-up brainstorm planned; loading states → `brand-identity.md` §8.
```

<!-- COMPACT POINT -->

---

### Task 13: Final verification + wave close

**Files:**
- Move: `docs\brand\checklists\active\brand-design-system.md` → `docs\brand\checklists\done\`
- Move: `docs\brand\issues\2026-06-10-design-system-issues.md` → `docs\brand\issues\done\` (after reflect)

- [x] **Step 1: Verify pointers**

Grep `spec-brand-identity` across workspace — hits only in dated decision records (design spec, this checklist, audit if mentioned). Grep `docs/brand/README|design-system.md` confirms CLAUDE.md companion line updated.

- [x] **Step 2: Verify design-system.md completeness**

Read the file top to bottom: all seven sections filled, no "TBD"/"audit pending" text, every table has values, divergence section present.

- [x] **Step 3: Spec-vs-shipped check**

Open `specs/2026-06-10-design-system-design.md` §3–4, confirm every listed item exists in shipped files (README rows, pointer files, seven sections).

- [x] **Step 4: Run reflect**

Run `claude-md-management:reflect` — mandatory at wave close. Review issue log, then move it to `issues/done/`. Move this checklist to `checklists/done/`.
