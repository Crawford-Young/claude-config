---
name: new-component
description: "Creates a new UI component following strict TDD for a Radix UI + CVA + Tailwind CSS component library. Use this skill whenever the user says 'add a component', 'create a [name] component', 'build a button/dialog/input/badge/avatar/etc', 'new ui component', or any time a reusable React component needs to be added to the library. This skill enforces the full workflow: gather requirements → failing test → implement → export → story → full check. Never skip steps."
---

# New Component Workflow

You are creating a new UI component for a Radix UI + CVA + Tailwind CSS component library.
Read these files before starting — they contain the exact patterns to follow:
- `~/code/docs/web/COMPONENT-LIBRARY.md` — structure, CVA pattern, accessibility checklist
- `~/code/docs/web/PATTERNS.md` — cn() helper, CVA variant reference
- [`gotchas.md`](./gotchas.md) — test gotchas (V8 coverage gaps, dropdown testing) and story rules

<HARD-GATE>
Never move to the next step until the current step has passed. If a step fails, fix it before continuing — do not skip ahead.
</HARD-GATE>

---

## Step 1 — Gather Requirements

Ask the user all of these at once (not one at a time):

1. **Component name** — e.g. "Badge", "Avatar", "Tooltip"
2. **Radix primitive** — which `@radix-ui/react-*` primitive wraps this, if any? Simple display components (Badge, Skeleton) often use none.
3. **Variants** — what named visual styles? (e.g. `default`, `secondary`, `destructive`, `outline`, `ghost`)
4. **Sizes** — what size options? (e.g. `sm`, `md`, `lg`) — or none if not applicable
5. **Interactive?** — does it respond to click/keyboard? Determines whether focus and keyboard tests are required.
6. **Disabled state?** — should it accept a `disabled` prop?

Do not proceed to Step 2 until you have clear answers to all six.

---

## Step 2 — Write the Failing Test

Create `src/components/ui/<name>/<name>.test.tsx` (tests are colocated with the component).

Cover all of:
- Renders without crashing and shows content
- Each variant applies a distinctive class or data attribute
- Each size applies a distinctive class
- `disabled` prop (if applicable): element has `disabled` attribute, `pointer-events-none` class applied
- Keyboard interaction (if interactive): Tab focuses the element, Enter/Space triggers the action
- Accessibility: correct ARIA role, any required aria attributes, no redundant roles
- `displayName` equals the component name string

After writing the test, run it:
```bash
pnpm vitest run src/components/ui/<name>/<name>.test.tsx
```

**Confirm it fails.** If it passes before any implementation exists, the test has a bug — fix the test before continuing. A green test with no implementation means the assertion is not actually checking anything meaningful.

---

## Step 3 — Implement the Component

Create `src/components/ui/<name>/<name>.tsx`.

Follow the exact pattern in `~/code/docs/COMPONENT-LIBRARY.md`:
- `React.forwardRef` wrapping
- `ComponentName.displayName = 'ComponentName'`
- `cva()` for all variants and sizes
- `cn()` from `@/lib/utils` for className merging
- If using a Radix primitive, compose it — do not re-implement what Radix provides (focus management, ARIA, keyboard)
- Export: the component, its props type (`ComponentNameProps`), and the variants function (`componentNameVariants`)

Write the minimum implementation that makes the tests pass. Do not add features not covered by a test.

---

## Step 4 — Export

Create `src/components/ui/<name>/index.ts` (per-component barrel):

```ts
export { ComponentName, type ComponentNameProps, componentNameVariants } from './component-name'
```

Then add the component to the library barrel `src/index.ts`:

```ts
export * from './components/ui/component-name'
```

---

## Step 5 — Verify Tests at 100%

Run:
```bash
pnpm vitest run --coverage src/components/ui/<name>/<name>.test.tsx
```

All tests must pass. Coverage must be 100% on statements, branches, functions, and lines.

If coverage is below 100%: find the uncovered branch, write a test for it, make it pass. Do not lower the threshold or add `/* istanbul ignore */` comments.

---

## Step 6 — Write the Storybook Story

Create `stories/ui/<name>.stories.tsx`.

Required exports:
- `Default` — the component with controls (argTypes for variant and size), args set to defaults
- One named story per variant (e.g. `Destructive`, `Outline`)
- One named story per size if sizes exist (e.g. `Small`, `Large`)
- `Disabled` — the disabled state (if the component supports it)
- `AllVariants` — a render that shows all variants side by side for quick visual comparison

Include `tags: ['autodocs']` on the meta object so docs auto-generate.

---

## Step 7 — Full Check

Run:
```bash
just check
```

This runs lint → typecheck → all tests → e2e (which includes axe accessibility checks).

Do not declare the component done until this command exits with code 0.

---

## Step 8 — Report

Report the final status clearly:

```
Component: <Name>
✓/✗ All tests passing
✓/✗ Coverage: <N>% (must be 100%)
✓/✗ Storybook story created with all variants
✓/✗ just check passing
✓/✗ axe: zero violations

Public API:
  Props: <list the key props>
  Variants: <list variants>
  Sizes: <list sizes or "none">
```

If anything is ✗, fix it. Only mark complete when everything is ✓.
