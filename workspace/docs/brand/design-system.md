# Design System — Crawford Young

**Status:** Living reference
**Last verified against code:** 2026-06-10 (composition audit: `specs/2026-06-10-composition-audit.md`)
**Scope:** All personal projects — portfolio, Cybond, instrumenttuner, future apps. Identity, tokens, motion → [`brand-identity.md`](./brand-identity.md).

Composition layer: how pages are assembled. Exact values only — agents build from this without judgment calls.

---

## §0 Space — when to spend it, when to save it

Classify every surface before laying it out: the same spacing is right on one mode and wrong on the other.

| Mode | Surfaces | Space is | Goal |
|---|---|---|---|
| **Expressive** | Hero, landing, about, splash, auth/focus, empty and error states | the design | One idea per screen; emptiness reads as confidence |
| **Data** | Dashboards, tables, lists, calendars, detail views, search results, settings, admin | a cost | Most information per viewport, fewest clicks and scrolls to reach it |

A page can hold both: the portfolio home's hero is expressive; everything below it is data.

### Reach (all surfaces)

- **3-click ceiling.** Every piece of content and every action is ≤3 clicks from the site or app entry. Each nav link, tab, menu open, expand and "show more" counts as one. Needing a 4th means flatten the structure: lift the item to its parent, add it to nav, or show it inline.
- **Scroll brings more of the same, never something different.** Scrolling may reveal more rows or older items; it never gates a different kind of information. If the second thing a user looks for sits below the fold, move it up.
- Expressive surfaces still obey the ceiling: a hero always shows a visible path (nav or CTA) onward.

### Data surfaces

- **The first screen answers the question.** At 1280×800 the primary data (the numbers, rows or items the user came for) is visible without scrolling: nothing above it but a one-line page header and at most one control row (filters, actions). No hero, banner or intro paragraph. At 390px wide, the primary data starts within the first screen.
- **Summary first.** Lead with a stat/KPI row when the data has totals or status, so the page is answerable at a glance before any reading.
- **Show, don't gate.** Information users scan or compare stays on the page — no accordions, carousels, or "show more" hiding it. Tabs split separate tasks, never one dataset.
- **Drill down in place.** Detail opens inline first (expanded row, side `Sheet`, popover) rather than as a new page — the list stays visible and it costs one click instead of open + back.
- **Use the width.** Wide container (`max-w-5xl` or full-bleed, §1); at `lg` and up, summaries and side-by-side panels go multi-column instead of one long stack.
- **Dense variants.** Tables, dashboards and calendar views take the dense value wherever this doc offers one: rows `h-10`, cards `p-4`, grids `gap-4`, page rhythm `space-y-4`.

### Expressive surfaces

- Space is deliberate: one focal element, generous margins, `min-h-screen` heroes allowed. Never densify them to "use the space" — the restraint is the brand (`brand-identity.md` §1).

---

## §1 Layout anatomy

### Surface types

| Surface | Container | Vertical rhythm | Source |
|---|---|---|---|
| Marketing page (standard) | `mx-auto max-w-5xl px-6` | `py-16` (`pb-16` when hero owns the top) | portfolio shipped |
| Marketing page (prose/detail) | `mx-auto max-w-3xl px-6` | `py-16` | portfolio shipped |
| App page (standard) | `mx-auto max-w-4xl` | `space-y-6` | Cybond goals/habits/tasks/reflections |
| App page (wide/data) | `mx-auto max-w-5xl` | `space-y-4` | Cybond calendar |
| App page (reading) | `mx-auto max-w-2xl` | `space-y-6` | Cybond feed/settings |
| Auth/focus page | centered `max-w-sm gap-8` | — | Cybond login |
| Full-bleed (chat, calendar grid) | no max-width; internal padding only (chat list `space-y-4 p-4`) | — | Cybond |

- Horizontal padding on marketing pages is `px-6` at every breakpoint — no breakpoint variants.
- App shell wraps page content in `p-6`; page containers add no extra horizontal padding.

### Nav

**Marketing (portfolio pattern) — floating pill, not a full-width bar:**

- Wrapper: `fixed top-4 inset-x-0 z-50 hidden md:flex justify-center pointer-events-none`
- Pill: `flex items-center gap-0.5 rounded-full bg-surface/80 backdrop-blur-md border border-border px-2 py-1.5 shadow-lg shadow-black/20`
- Link: `px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200`; active `bg-foreground text-background`; inactive `text-muted-foreground hover:text-foreground hover:bg-surface-raised`
- Mobile top bar: `fixed top-0 inset-x-0 z-50 px-5 py-4 bg-background/50 backdrop-blur-xl border-b border-border/60`
- Mobile overlay menu: `fixed inset-0 z-40 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center gap-8`; links `text-3xl font-bold tracking-tight hover:text-accent`
- Content under a fixed nav needs clearance: spacer `h-16 md:h-20`, or hero pulls itself up with `-mt-16 md:-mt-20`.

**App (Cybond pattern) — library `AppShell` + `Sidebar`:**

- Sidebar header: `h-14 border-b border-border px-4 gap-2.5`, logo 28px `rounded-lg` + `text-sm font-bold`
- Nav item icons: `h-4 w-4` (16px)

### Hero / grid overlay

Grid overlay recipe (verbatim from portfolio `hero.tsx`):

```tsx
<div
  className="absolute inset-0 pointer-events-none opacity-[0.025]"
  style={{
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
    backgroundSize: "64px 64px",
  }}
/>
```

- Hero section: `-mt-16 md:-mt-20 relative min-h-screen overflow-hidden flex flex-col` + subtle aurora
- Content stack: `flex-1 flex flex-col items-center justify-center text-center px-6 gap-7 py-12`
- H1: `text-5xl md:text-7xl lg:text-[5.5rem] font-bold tracking-[-0.04em] leading-none`
- Accent ambience stays faint: spotlight `rgba(16,185,129,0.07)`, glow-card `rgba(16,185,129,0.13)` — never above ~0.13 alpha

### Section rhythm

- Marketing pages: `py-16` page padding; single-screen sections, not long-scroll `py-24/py-32` marketing rhythm
- Card grids: `gap-4` (dense grids) to `gap-5` (stacked feature cards)
- Intra-page steps: `mt-3` title→subtitle; `mt-6`/`mt-8`/`mt-10` block separations
- App pages: `space-y-4` (data-dense) or `space-y-6` (standard) — see surface table

### Footer

- `<footer>`: `mt-24 border-t border-border py-8`
- Inner: `mx-auto max-w-5xl px-6 flex items-center justify-between`
- Left: `© {year} Crawford Young` in `text-sm text-muted-foreground`
- Right: icon links `flex items-center gap-4`, Lucide `h-4 w-4`, `text-muted-foreground hover:text-foreground transition-colors`, each with `aria-label`

### Breakpoints

Mobile-first. Only Tailwind defaults `sm md lg xl` — never `2xl`-specific layout.

## §2 Elevation

| Level | Use | Surface | Shadow | Border | z-band |
|---|---|---|---|---|---|
| 0 flat | page content | `--background` | none | none | auto |
| 1 card | cards, panels | `--card` (`bg-card rounded-xl`) | `shadow` | `border-border` | auto |
| 2 floating | popover, dropdown, select, toast | `--surface` | `shadow-lg` | `border-border` | 50 |
| 3 modal | dialog, alert-dialog, sheet | `--surface` | `shadow-lg` | `border-border` | 100 |

**Rule: elevation = surface step + shadow together, never shadow alone.**

- Shadows are plain Tailwind utilities — no color modifier (`shadow-black/20` is a portfolio marketing-shell exception, see divergences)
- Tooltip is the floating exception: `bg-surface-raised border border-border`, **no shadow** — it reads as a label, not a surface
- `TopBar` uses `shadow-sm`; `HeroCard` uses `shadow-md ring-1 ring-border`; `ChatFab` uses `shadow-xl shadow-accent/30` (intentional accent glow) — these are component-owned, don't generalize them

## §3 Density & spacing rhythm

### Allowed spacing steps

- Component internals: `1 1.5 2 3 4` (4–16px)
- Layout gaps: `4 6 8 12 16 24`
- Nothing off-scale.

### Forms

- Labels above fields. Label→field gap: `space-y-2`. Field→field gap: `space-y-4` on the `<form>`.
- Side-by-side fields: `grid grid-cols-2 gap-3`
- Section→section inside long forms: `space-y-8`
- Width: in dialogs the `DialogContent` constrains the form (no explicit `max-w-*`); standalone single-column forms `max-w-md`
- Footer: Cancel (`variant="outline"`) + primary submit; submit disabled until valid; pending label `Saving…`

### Component paddings (library-shipped — do not restyle)

- Button: default `h-10 px-4 py-2`, sm `h-8 px-3`, lg `h-11 px-8`, icon `h-10 w-10`
- Input: `h-10 px-3 py-2 text-sm rounded`
- Card: header/content/footer `p-6` (content/footer `pt-0`); header internal `space-y-1.5`
- Dialog: `p-6 gap-4`; Popover `p-4`; menus `p-1`; Tooltip `px-2.5 py-1.5 text-xs`
- TopBar / sidebar header: `h-14 px-4`

### Tables / lists

- Rows: `h-12` standard, `h-10` dense; cells `px-3`

### Cards

- `p-4` compact, `p-6` standard, `p-8` feature

### Chat density

- Bubble: `rounded-lg px-3 py-2`, `max-w-[85%]`; user `bg-accent`, assistant `bg-surface-raised`
- Message list: `space-y-4 p-4`; input row `flex gap-2`

## §4 Empty / error / zero states

### Empty state anatomy

Centered in the content area:

- Container: `flex flex-col items-center justify-center gap-2 py-16 text-center`
- Lucide icon 24px `text-muted-foreground`
- Headline: `text-sm font-medium text-foreground`
- Optional one-line detail: `text-sm text-muted-foreground`
- Optional single action button below

**Rule: every list/grid view ships its empty state — not optional.**

### Error pages (404/500)

Same anatomy. Headline states what happened. Action = "Back to home". No illustrations, no mascots.

### Inline errors

- Field-level: `text-sm text-destructive` directly under the field
- Form-level summary only when the error isn't attributable to one field

States never use spinners or "Loading..." (per `brand-identity.md` §8 — loading is its own system).

## §5 Iconography

- **Lucide only** — no other icon sets, no emoji in UI chrome
- Stroke width: default 2; never override per-icon
- Size scale (audit-verified):
  - 16px (`size-4` / `h-4 w-4`) — inline with body text, buttons, inputs, menu items, sidebar nav, footer links. The dominant size.
  - 20px (`size-5`) — large floating controls (ChatFab), large slider thumbs, calendar event-chip controls
  - 24px (`size-6`) — empty states, feature cards. Maximum — no icon larger than 24px ships anywhere.
- Color: `currentColor` inherit by default; `text-muted-foreground` for decorative; `text-accent` only for active/selected indicators
- Icon-only controls require `aria-label` + tooltip; default is icon + visible label

## §6 Data viz

No app ships a fixed series palette (Cybond's PieChart colors are AI-supplied per category). Ordered series for everything else — emerald-first, then existing semantic hues, never new hues:

| Order | Token/Hex | Note |
|---|---|---|
| 1 | `--accent` `#10b981` | primary series |
| 2 | `--info` `#0ea5e9` | |
| 3 | `--warning` `#f59e0b` | |
| 4 | `#a1a1aa` zinc-400 | neutral series |
| 5 | `#6ee7b7` emerald-300 | |

- Status coloring always reuses semantic tokens (`--success/--warning/--destructive/--info`) — never the series palette
- Grid lines `border-subtle`; axis labels `text-xs text-muted-foreground`; both modes
- Chart tooltips use surface tokens: `hsl(var(--card))` background + `hsl(var(--border))` border
- No gradients in chart fills beyond 2-stop `--accent` → transparent at ≤20% opacity

## §7 Voice & copy

- Tone: precise, calm. No exclamation marks. No apology theater ("Oops!", "Uh oh") — state what happened.
- Buttons: verb-first, ≤3 words ("Create event", not "Click here to create a new event")
- Errors: what happened + what to do next, one sentence each; never show raw codes/stack traces to users
- Casing: sentence case everywhere; uppercase only at Micro/tag scale (per brand-identity type table)
- Numbers/dates: `--font-mono` for stats and timestamps

## Known divergences

Non-picked values from the 2026-06-10 composition audit. One row per divergence.

| App | Current value | Spec value | Status |
|---|---|---|---|
| Portfolio | Glass cards: `bg-surface/40 backdrop-blur-md border-border/60`, no shadow | Card: `shadow` + `rounded-xl border border-border bg-card` | deferred to compliance wave |
| Portfolio | Nav pill shadow: `shadow-lg shadow-black/20` | Plain `shadow-lg`, no color modifier | deferred to compliance wave |
| Portfolio | Mobile menu icons: `h-5 w-5` (20px) | App-chrome nav icons: 16px | deferred to compliance wave |

> **Not covered here:** cinematic motion language (page transitions, scroll choreography) — follow-up brainstorm planned; loading states → `brand-identity.md` §8.
