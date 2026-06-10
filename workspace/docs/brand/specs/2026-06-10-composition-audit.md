# Composition Audit — 2026-06-10

Raw findings feeding `design-system.md`. Decision record — do not update after the wave.

## Portfolio (Crawford-Young.github.io)

### Page shell

- Home content shell: `mx-auto max-w-5xl px-6 pb-16` — `src/app/page.tsx:15`
- List pages (projects, hobbies): `mx-auto max-w-5xl px-6 py-16` — `src/app/projects/page.tsx:13`, `src/app/hobbies/page.tsx:12`
- Prose/detail pages (experience, project detail): `mx-auto max-w-3xl px-6 py-16` — `src/app/experience/page.tsx:14`, `src/app/projects/[slug]/page.tsx:27`
- Horizontal padding is `px-6` everywhere, no breakpoint variants

### Nav

- Desktop: centered floating pill, not full-width bar — `src/components/layout/nav.tsx:39-40`
  - Wrapper: `fixed top-4 inset-x-0 z-50 hidden md:flex justify-center pointer-events-none`
  - Pill: `flex items-center gap-0.5 rounded-full bg-surface/80 backdrop-blur-md border border-border px-2 py-1.5 shadow-lg shadow-black/20`
  - Link: `px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200`; active `bg-foreground text-background`; inactive `text-muted-foreground hover:text-foreground hover:bg-surface-raised`
- Mobile top bar: `fixed top-0 inset-x-0 z-50 px-5 py-4 bg-background/50 backdrop-blur-xl border-b border-border/60` — `nav.tsx:59`
- Mobile overlay menu: `fixed inset-0 z-40 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center gap-8`, links `text-3xl font-bold tracking-tight hover:text-accent` — `nav.tsx:72-79`

### Hero / grid overlay

- Section: `-mt-16 md:-mt-20 relative min-h-screen overflow-hidden flex flex-col` + `<Aurora intensity="subtle" />` — `src/components/home/hero.tsx:7-8`
- Grid overlay recipe (verbatim) — `hero.tsx:11-21`:
  - container `absolute inset-0 pointer-events-none opacity-[0.025]`
  - `backgroundImage: linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`
  - `backgroundSize: 64px 64px`
- Nav clearance spacer `h-16 md:h-20` — `hero.tsx:24`
- Content stack: `flex-1 flex flex-col items-center justify-center text-center px-6 gap-7 py-12` — `hero.tsx:27`
- H1: `text-5xl md:text-7xl lg:text-[5.5rem] font-bold tracking-[-0.04em] leading-none` — `hero.tsx:40`
- Ambient effects in use: aurora radial gradients (`effects/aurora.tsx:43-45`), spotlight `radial-gradient(700px circle …, rgba(16,185,129,0.07), transparent 50%)` (`effects/spotlight.tsx:39`), glow-card `rgba(16,185,129,0.13) transparent 70%` (`effects/glow-card.tsx:45`)

### Section rhythm

- Page vertical padding: `py-16` on every subpage; home uses hero (min-h-screen) + `pb-16`
- Card grids: `gap-4` (projects grid `projects/page.tsx:25`), `gap-5` (hobbies stack `hobbies/page.tsx:23`)
- Intra-page steps: `mt-3` title→subtitle, `mt-6`/`mt-8`/`mt-10` block separations (`projects/[slug]/page.tsx:30,36,43`)
- No `py-24`/`py-32` marketing rhythm in shipped code — portfolio is single-screen sections, not long-scroll marketing

### Footer

- `footer`: `mt-24 border-t border-border py-8` — `src/components/layout/footer.tsx:6`
- Inner: `mx-auto max-w-5xl px-6 flex items-center justify-between`
- Left: `© {year} Crawford Young` in `text-sm text-muted-foreground`
- Right: icon links `flex items-center gap-4`, Lucide icons `h-4 w-4`, `text-muted-foreground hover:text-foreground transition-colors`, each with `aria-label`

## Cybond (scheduling-advisor)

### App shell

- Shell: library `AppShell` + `Sidebar` from `@/lib/ui`, content wrapped in `p-6` — `src/app/(app)/layout.tsx:90-110`
- Sidebar header: `h-14 border-b border-border px-4 gap-2.5`, logo 28px rounded-lg + `text-sm font-bold` — `layout.tsx:38`
- Sidebar nav items: Lucide icons `h-4 w-4` — `layout.tsx:20-26`
- Page container widths by content type (all `mx-auto`, all `space-y-4`/`space-y-6` vertical rhythm):
  - `max-w-5xl space-y-4` calendar — `src/app/(app)/calendar/page.tsx:53`
  - `max-w-4xl space-y-6` goals/habits/tasks/reflections — `src/app/(app)/goals/page.tsx:19` et al.
  - `max-w-2xl space-y-6` feed/settings (narrow reading surfaces) — `src/app/(app)/feed/page.tsx:11`, `settings/page.tsx:11`
- Auth/marketing-ish pages: centered `max-w-sm gap-8` (login `src/app/login/page.tsx:7`), `max-w-3xl gap-12` (upgrade `upgrade/page.tsx:37`)
- Toast/notification region: `fixed inset-x-0 bottom-0 z-40 p-4 sm:right-4 sm:left-auto sm:max-w-sm` — `calendar-client.tsx:160`

### Forms

Representative: `src/components/tasks/task-form-dialog.tsx` (goal/habit dialogs identical pattern):

- Labels above fields; label→field gap `space-y-2` (`task-form-dialog.tsx:145`)
- Field→field gap `space-y-4` on the `<form>` (`task-form-dialog.tsx:144`)
- Side-by-side fields: `grid grid-cols-2 gap-3` (`task-form-dialog.tsx:180`)
- Form width: constrained by `DialogContent` (library), no explicit `max-w-*` on form
- Footer: `DialogFooter` with Cancel (`variant="outline"`) + primary submit; submit disabled until valid; pending label `Saving…`

### Calendar / chat density

- Calendar rows/cells owned by library `WeekCalendarView` (`@/lib/ui`) — no app-level density classes; event colors mapped to library named colors: task→blue, goal→amber, habit→green (`calendar-client.tsx:46-51`)
- Chat messages: bubble `rounded-lg px-3 py-2`, max width `max-w-[85%]`; user `bg-accent`, assistant `bg-surface-raised` — `chat-messages-panel.tsx:59-69`
- Message list: `space-y-4 p-4 overflow-y-auto` — `chat-messages-panel.tsx:50`
- Input row: `flex gap-2` — `chat-messages-panel.tsx:109`

### Chart colors

- Only chart: recharts PieChart in `src/components/cards/life-balance-view.tsx:33-57` — colors arrive per-category in props (AI-supplied), **no fixed series palette shipped anywhere**
- Tooltip surface uses tokens: `hsl(var(--card))` bg + `hsl(var(--border))` border (`life-balance-view.tsx:50-53`)
- Conclusion: no audited series palette exists → design-system.md uses the fallback ordered series from the plan

## component-library

### Shadows in shipped components

All paths `component-library/src/components/ui/`:

| Component | Shadow | Source |
|---|---|---|
| Card | `shadow` (with `rounded-xl border border-border bg-card`) | `card/card.tsx:9` |
| Dialog / AlertDialog | `shadow-lg` (`bg-surface border border-border p-6 rounded-lg`) | `dialog/dialog.tsx:33`, `alert-dialog/alert-dialog.tsx:39` |
| Popover | `shadow-lg` (`bg-surface border border-border rounded-lg p-4`) | `popover/popover.tsx:19` |
| DropdownMenu / ContextMenu | `shadow-lg` (`bg-surface border border-border rounded-lg p-1`) | `dropdown-menu/dropdown-menu.tsx:43`, `context-menu/context-menu.tsx:43` |
| Select content / DatePicker popover | `shadow-lg` | `select/select.tsx:72`, `date-picker/date-picker.tsx:88` |
| Tooltip | **none** — `bg-surface-raised border border-border` only | `tooltip/tooltip.tsx:25-27` |
| Toast | `shadow-lg` (`bg-surface border-border`) | `toast/toast.tsx:13` |
| Sheet / ChatPanel | `shadow-lg` / `shadow-xl` | `sheet/sheet.tsx:33`, `chat-panel/chat-panel.tsx:31` |
| TopBar | `shadow-sm` (`h-14 border-b bg-surface px-4`) | `top-bar/top-bar.tsx:15` |
| HeroCard | `shadow-md` + `ring-1 ring-border` | `hero-card/hero-card.tsx:22` |
| ChatFab | `shadow-xl shadow-accent/30` (intentional accent glow) | `chat-fab/chat-fab.tsx:18` |

No `shadow-black/20` modifier anywhere in the library — plain Tailwind shadows + token borders.

### Padding scales

- Button: default `h-10 px-4 py-2`, sm `h-8 px-3`, lg `h-11 px-8`, icon `h-10 w-10` — `button/button.tsx:18-22`
- Input: `h-10 px-3 py-2 text-sm rounded` — `input/input.tsx:12`
- Card: header/content/footer all `p-6` (content/footer `pt-0`); header internal `space-y-1.5` — `card/card.tsx:20,45,52`
- Dialog/AlertDialog: `p-6 gap-4` — `dialog/dialog.tsx:33`
- Popover `p-4`; menus (dropdown/context/select) container `p-1`; tooltip `px-2.5 py-1.5 text-xs` — see table above
- TopBar height `h-14 px-4` (matches Cybond sidebar header `h-14 px-4`)

### Icon sizes

- Dominant: 16px — `size-4` / `h-4 w-4` in menus (`[&_svg]:size-4`), select chevrons, combobox, breadcrumb, pagination, accordion, sheet close, checkbox, radio, date-picker icons
- 20px (`h-5 w-5`): ChatFab icon, slider thumb lg, calendar event chip controls
- 24px (`h-6 w-6`): calendar event chip count badge only
- No icon larger than 24px ships in any component

## Conflicts found

| Topic | Portfolio | Cybond | Library | Picked |
|---|---|---|---|---|
| Card elevation | `bg-surface/40 backdrop-blur-md border-border/60`, no shadow (`project-card.tsx:10`) | library defaults | `shadow` + `rounded-xl border bg-card` | Library (component-internal); portfolio glass cards → divergence |
| Shadow color modifier | `shadow-lg shadow-black/20` on nav pill (`nav.tsx:40`) | — | plain `shadow-*`, no `/20` modifier | Library for components; portfolio nav keeps `shadow-black/20` (marketing shell) |
| Modal shadow | — | — | `shadow-lg` (plan fallback said `shadow-xl`) | Library `shadow-lg` — audit overrides fallback |
| Label→field gap | — | `space-y-2` (`task-form-dialog.tsx:145`) | Card header `space-y-1.5` | Cybond `space-y-2` (app density); fallback `space-y-1.5` dropped |
| Nav icon size | mobile menu `h-5 w-5` (`nav.tsx:66`) | sidebar `h-4 w-4` (`layout.tsx:20`) | menus `size-4` | Cybond/Library 16px for app chrome; portfolio mobile 20px → divergence |
| Marketing container | `max-w-5xl px-6` shipped | — | — | Portfolio `max-w-5xl px-6` — audit overrides fallback `max-w-6xl px-6 md:px-8` |
| App container | — | `max-w-4xl` standard, `max-w-5xl` calendar, `max-w-2xl` reading; shell `p-6` | — | Cybond audited widths — fallback `max-w-7xl px-4 md:px-6` dropped |
