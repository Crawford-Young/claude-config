<!-- ORCHESTRATOR ONLY — update checkboxes and Reflect Log as tasks complete. Subagents: read-only. -->
# Brand Motion — Phase 2: Core Primitives — Implementation Plan
**Branch:** feat/motion-primitives (component-library) · main (claude-config docs, wave close only)
**Workflow:** subagent-driven-development
**Model:** Fable (orch) · Opus (arch/review) · Sonnet (impl) · Haiku (recon)
**Spec:** docs/brand/specs/2026-06-10-motion-language-design.md §11 item 2 + docs/brand/motion.md §8

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core motion primitives from `@crawfordyoung/ui` — `ScrollReveal`, `StaggerReveal`, `ProgressLine`, `Skeleton` shimmer variant — plus preset animation-easing alignment, `Motion.mdx` token reference, and `framer-motion` as peer dependency.

**Architecture:** All library work in `component-library` on `feat/motion-primitives`. Pure Framer variant builders live in `src/lib/motion-variants.ts` (100% unit-testable, no DOM); components are thin wrappers. `framer-motion` becomes a peer dependency (>=12) + devDependency, externalized in tsup. Doc status flips in claude-config happen at wave close (`workspace/docs/brand/motion.md` — always edit the real claude-config path, Write/Edit refuse junctioned paths).

**Tech Stack:** React 19, framer-motion 12, CVA, Tailwind preset, Vitest (happy-dom), Storybook MDX, Changesets.

**Issue log:** orchestrator creates `docs/brand/issues/2026-06-11-motion-phase2-issues.md` at execution start (orchestrator only — never subagents).

**Decisions (user-confirmed 2026-06-10):**
- PR #51 merged; `@crawfordyoung/ui@0.9.0` (tokens) published — main has motion tokens.
- `Skeleton`: CVA `variant: 'shimmer' | 'pulse'`, **shimmer is default** (pulse kept as escape hatch; pulse alone is on the brand "Never" list).
- `ProgressLine`: controlled `active: boolean` prop; component runs the 3-phase machine internally. No imperative/singleton API.
- `useReducedMotionSafe` ships this phase (every primitive needs it). `Parallax`, `MagneticButton`, `TypewriterStream`, `useScrollProgress` stay in Phase 4.

**Repo conventions reminder (from Phase 1):** no semicolons, single quotes. Vitest `fakeTimers.toFake` is globally `['Date']` — always pass explicit `toFake` config when faking timers. Changeset written as file directly (CLI is interactive); backtick-wrap `*` globs in changeset text.

---

### Task 1: Branch + framer-motion dependency

**Files:**
- Modify: `C:\Users\young\code\component-library\package.json` (peerDependencies)
- Modify: `C:\Users\young\code\component-library\tsup.config.ts` (external list, first entry)

- [ ] **Step 1: Create feature branch**

```bash
git -C C:\Users\young\code\component-library checkout main
git -C C:\Users\young\code\component-library pull --rebase
git -C C:\Users\young\code\component-library checkout -b feat/motion-primitives
```

- [ ] **Step 2: Install framer-motion as devDependency**

Run: `pnpm --dir C:\Users\young\code\component-library add -D framer-motion`
Expected: `framer-motion ^12.40.0` (or newer 12.x) in devDependencies.

- [ ] **Step 3: Declare peer dependency**

In `package.json` `peerDependencies`, add (alphabetical position — after `date-fns`):

```json
    "framer-motion": ">=12",
```

- [ ] **Step 4: Externalize in tsup**

In `tsup.config.ts`, first config object, change the `external` array to:

```ts
    external: ['react', 'react-dom', 'tailwindcss', 'lucide-react', 'framer-motion'],
```

- [ ] **Step 5: Verify nothing breaks**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors; all tests pass, coverage 100%.

- [ ] **Step 6: Commit**

```bash
git -C C:\Users\young\code\component-library add package.json pnpm-lock.yaml tsup.config.ts
git -C C:\Users\young\code\component-library commit -m "chore(deps): add framer-motion as peer + dev dependency

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `useReducedMotionSafe` hook (TDD)

**Files:**
- Test: `C:\Users\young\code\component-library\src\lib\use-reduced-motion-safe.test.ts`
- Create: `C:\Users\young\code\component-library\src\lib\use-reduced-motion-safe.ts`
- Modify: `C:\Users\young\code\component-library\src\index.ts` (export, next to `./lib/motion`)

- [ ] **Step 1: Write the failing test**

```ts
import { renderHook } from '@testing-library/react'
import { useReducedMotion } from 'framer-motion'
import { describe, expect, it, vi } from 'vitest'
import { useReducedMotionSafe } from './use-reduced-motion-safe'

vi.mock('framer-motion', () => ({ useReducedMotion: vi.fn() }))

describe('useReducedMotionSafe', () => {
  it('returns false when framer reports null (SSR / pre-hydration)', () => {
    vi.mocked(useReducedMotion).mockReturnValue(null)
    const { result } = renderHook(() => useReducedMotionSafe())
    expect(result.current).toBe(false)
  })

  it('returns true when the user prefers reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { result } = renderHook(() => useReducedMotionSafe())
    expect(result.current).toBe(true)
  })

  it('returns false when the user has no reduced-motion preference', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { result } = renderHook(() => useReducedMotionSafe())
    expect(result.current).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/use-reduced-motion-safe.test.ts`
Expected: FAIL — `Cannot find module './use-reduced-motion-safe'`

- [ ] **Step 3: Write the implementation**

```ts
'use client'

/* src/lib/use-reduced-motion-safe.ts
   SSR-safe prefers-reduced-motion flag. Framer's useReducedMotion returns null
   until hydration — treat null as "no preference" so motion renders by default. */

import { useReducedMotion } from 'framer-motion'

export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/use-reduced-motion-safe.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Export from library entry**

In `src/index.ts`, directly after `export * from './lib/motion'`:

```ts
export * from './lib/use-reduced-motion-safe'
```

- [ ] **Step 6: Commit**

```bash
git -C C:\Users\young\code\component-library add src/lib/use-reduced-motion-safe.ts src/lib/use-reduced-motion-safe.test.ts src/index.ts
git -C C:\Users\young\code\component-library commit -m "feat(motion): add useReducedMotionSafe hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Motion variant builders (TDD)

**Files:**
- Test: `C:\Users\young\code\component-library\src\lib\motion-variants.test.ts`
- Create: `C:\Users\young\code\component-library\src\lib\motion-variants.ts`
- Modify: `C:\Users\young\code\component-library\src\index.ts` (export, after `./lib/motion`)

Pure functions — all reveal/stagger math lives here so components stay thin and the math is unit-testable without DOM or animation frames.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { TargetAndTransition } from 'framer-motion'
import { getRevealVariants, getStaggerDelayMs, getStaggerItemVariants } from './motion-variants'

describe('getRevealVariants', () => {
  it('hides 16px below with fade, reveals over 400ms on the brand out-curve', () => {
    const variants = getRevealVariants(false)
    expect(variants.hidden).toEqual({ opacity: 0, y: 16 })
    expect(variants.visible).toEqual({
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, delay: 0, ease: [0.25, 1, 0.5, 1] },
    })
  })

  it('converts delayMs to seconds', () => {
    const visible = getRevealVariants(false, 200).visible as TargetAndTransition
    expect(visible.transition?.delay).toBe(0.2)
  })

  it('drops the y transform under reduced motion (opacity only)', () => {
    const variants = getRevealVariants(true)
    expect(variants.hidden).toEqual({ opacity: 0, y: 0 })
  })
})

describe('getStaggerDelayMs', () => {
  it('steps 40ms per index by default', () => {
    expect(getStaggerDelayMs(0)).toBe(0)
    expect(getStaggerDelayMs(3)).toBe(120)
  })

  it('caps the delay at 5 items', () => {
    expect(getStaggerDelayMs(5)).toBe(200)
    expect(getStaggerDelayMs(12)).toBe(200)
  })

  it('accepts a custom step', () => {
    expect(getStaggerDelayMs(2, 30)).toBe(60)
  })
})

describe('getStaggerItemVariants', () => {
  it('hides 8px below; visible resolves per-item delay from custom', () => {
    const variants = getStaggerItemVariants(false)
    expect(variants.hidden).toEqual({ opacity: 0, y: 8 })
    const visible = variants.visible as (delayMs: number) => TargetAndTransition
    expect(visible(80)).toEqual({
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, delay: 0.08, ease: [0.25, 1, 0.5, 1] },
    })
  })

  it('drops the y transform under reduced motion', () => {
    expect(getStaggerItemVariants(true).hidden).toEqual({ opacity: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/motion-variants.test.ts`
Expected: FAIL — `Cannot find module './motion-variants'`

- [ ] **Step 3: Write the implementation**

```ts
/* src/lib/motion-variants.ts
   Pure Framer Motion variant builders for the motion primitives.
   Reveal = scroll choreography Layer 1; stagger items = arrival Pattern 5.
   See docs/brand/motion.md §4–5. */

import type { Variants } from 'framer-motion'
import { EASE, MOTION, STAGGER } from './motion'

const MS_PER_SECOND = 1000
const REVEAL_RISE_PX = 16
const ITEM_RISE_PX = 8

export function getRevealVariants(reducedMotion: boolean, delayMs = 0): Variants {
  return {
    hidden: { opacity: 0, y: reducedMotion ? 0 : REVEAL_RISE_PX },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: MOTION.slow / MS_PER_SECOND,
        delay: delayMs / MS_PER_SECOND,
        ease: [...EASE.out],
      },
    },
  }
}

export function getStaggerDelayMs(index: number, stepMs: number = STAGGER.cardMs): number {
  return Math.min(index, STAGGER.capItems) * stepMs
}

export function getStaggerItemVariants(reducedMotion: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reducedMotion ? 0 : ITEM_RISE_PX },
    visible: (delayMs: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: MOTION.slow / MS_PER_SECOND,
        delay: delayMs / MS_PER_SECOND,
        ease: [...EASE.out],
      },
    }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/motion-variants.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Export from library entry**

In `src/index.ts`, after the `./lib/use-reduced-motion-safe` line:

```ts
export * from './lib/motion-variants'
```

- [ ] **Step 6: Commit**

```bash
git -C C:\Users\young\code\component-library add src/lib/motion-variants.ts src/lib/motion-variants.test.ts src/index.ts
git -C C:\Users\young\code\component-library commit -m "feat(motion): add pure variant builders for reveal and stagger

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

<!-- COMPACT POINT -->

---

### Task 4: `ScrollReveal` (TDD + story)

**Files:**
- Test: `C:\Users\young\code\component-library\src\components\ui\scroll-reveal\scroll-reveal.test.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\scroll-reveal\scroll-reveal.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\scroll-reveal\index.ts`
- Create: `C:\Users\young\code\component-library\stories\ui\scroll-reveal.stories.tsx`
- Modify: `C:\Users\young\code\component-library\src\index.ts`

Layer 1 scroll reveal (motion.md §4): rise 16px + fade, fires once at 20% visibility, optional child stagger in reading order.

**happy-dom note:** framer's `whileInView` constructs an `IntersectionObserver` — stub it in the test file (happy-dom's support is unreliable). Assert the *initial hidden* inline styles framer applies on first render; don't try to drive the animation.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { ScrollReveal } from './scroll-reveal'

vi.mock('@/lib/use-reduced-motion-safe', () => ({ useReducedMotionSafe: vi.fn(() => false) }))

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
})

beforeEach(() => {
  vi.mocked(useReducedMotionSafe).mockReturnValue(false)
})

describe('ScrollReveal', () => {
  it('renders children', () => {
    render(<ScrollReveal>section content</ScrollReveal>)
    expect(screen.getByText('section content')).toBeInTheDocument()
  })

  it('starts hidden (opacity 0)', () => {
    const { container } = render(<ScrollReveal>content</ScrollReveal>)
    expect((container.firstChild as HTMLElement).style.opacity).toBe('0')
  })

  it('merges custom className', () => {
    const { container } = render(<ScrollReveal className="mt-8">content</ScrollReveal>)
    expect((container.firstChild as HTMLElement).className).toContain('mt-8')
  })

  it('forwards ref to the wrapper element', () => {
    const ref = { current: null as HTMLDivElement | null }
    render(<ScrollReveal ref={ref}>content</ScrollReveal>)
    expect(ref.current).toBeInstanceOf(HTMLElement)
  })

  it('renders children directly when staggerChildren is off', () => {
    const { container } = render(
      <ScrollReveal>
        <span>a</span>
        <span>b</span>
      </ScrollReveal>
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.querySelectorAll('div')).toHaveLength(0)
  })

  it('wraps each child for staggering when staggerChildren is on', () => {
    const { container } = render(
      <ScrollReveal staggerChildren>
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </ScrollReveal>
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.querySelectorAll(':scope > div')).toHaveLength(3)
  })

  it('respects reduced motion (no y offset in hidden state)', () => {
    vi.mocked(useReducedMotionSafe).mockReturnValue(true)
    const { container } = render(<ScrollReveal>content</ScrollReveal>)
    const el = container.firstChild as HTMLElement
    expect(el.style.transform === '' || el.style.transform === 'none').toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/scroll-reveal/scroll-reveal.test.tsx`
Expected: FAIL — `Cannot find module './scroll-reveal'`

- [ ] **Step 3: Write the implementation**

```tsx
'use client'

/* ScrollReveal — scroll choreography Layer 1 (docs/brand/motion.md §4).
   Section rises 16px + fades into view once, at 20% visibility.
   staggerChildren wraps direct children so they arrive in reading order. */

import * as React from 'react'
import { motion } from 'framer-motion'
import { STAGGER } from '@/lib/motion'
import { getRevealVariants, getStaggerDelayMs, getStaggerItemVariants } from '@/lib/motion-variants'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { cn } from '@/lib/utils'

const VIEWPORT_AMOUNT = 0.2

export interface ScrollRevealProps {
  readonly children: React.ReactNode
  readonly className?: string
  /** Delay before the reveal starts, in ms. */
  readonly delayMs?: number
  /** Stagger direct children in reading order (40ms steps, capped at 5). */
  readonly staggerChildren?: boolean
}

export const ScrollReveal = React.forwardRef<HTMLDivElement, ScrollRevealProps>(
  ({ children, className, delayMs = 0, staggerChildren = false }, ref) => {
    const reducedMotion = useReducedMotionSafe()
    return (
      <motion.div
        ref={ref}
        className={cn(className)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: VIEWPORT_AMOUNT }}
        variants={getRevealVariants(reducedMotion, delayMs)}
      >
        {staggerChildren
          ? React.Children.map(children, (child, index) => (
              <motion.div
                variants={getStaggerItemVariants(reducedMotion)}
                custom={getStaggerDelayMs(index, STAGGER.cardMs)}
              >
                {child}
              </motion.div>
            ))
          : children}
      </motion.div>
    )
  }
)
ScrollReveal.displayName = 'ScrollReveal'
```

(Child `motion.div`s carry no `initial`/`animate` of their own — framer variant propagation triggers them when the parent's `whileInView` fires.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/scroll-reveal/scroll-reveal.test.tsx`
Expected: PASS, 7 tests. If the reduced-motion transform assertion fails because framer normalizes the style differently in happy-dom, assert on the non-reduced case instead: default render has `style.transform` containing `translateY(16px)`, reduced render does not.

- [ ] **Step 5: Barrel + library exports**

Create `src/components/ui/scroll-reveal/index.ts`:

```ts
export * from './scroll-reveal'
```

In `src/index.ts`, add alongside the other component exports (alphabetical):

```ts
export * from './components/ui/scroll-reveal'
```

- [ ] **Step 6: Story**

Create `stories/ui/scroll-reveal.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { ScrollReveal } from '@/components/ui/scroll-reveal'

const meta: Meta<typeof ScrollReveal> = {
  title: 'Motion/ScrollReveal',
  component: ScrollReveal,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ScrollReveal>

const DemoCard = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border bg-surface p-6 text-foreground">{label}</div>
)

export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-[60vh]">
      <p className="text-muted-foreground">Scroll down — the section below reveals at 20% visibility.</p>
      <ScrollReveal>
        <DemoCard label="Revealed section" />
      </ScrollReveal>
    </div>
  ),
}

export const StaggeredChildren: Story = {
  render: () => (
    <div className="flex flex-col gap-[60vh]">
      <p className="text-muted-foreground">Scroll down — children arrive in reading order, 40ms apart.</p>
      <ScrollReveal staggerChildren className="flex flex-col gap-3">
        <DemoCard label="First" />
        <DemoCard label="Second" />
        <DemoCard label="Third" />
      </ScrollReveal>
    </div>
  ),
}
```

- [ ] **Step 7: Full unit suite + typecheck**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors, coverage 100%.

- [ ] **Step 8: Commit**

```bash
git -C C:\Users\young\code\component-library add src/components/ui/scroll-reveal stories/ui/scroll-reveal.stories.tsx src/index.ts
git -C C:\Users\young\code\component-library commit -m "feat(motion): add ScrollReveal primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `StaggerReveal` (TDD + story)

**Files:**
- Test: `C:\Users\young\code\component-library\src\components\ui\stagger-reveal\stagger-reveal.test.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\stagger-reveal\stagger-reveal.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\stagger-reveal\index.ts`
- Create: `C:\Users\young\code\component-library\stories\ui\stagger-reveal.stories.tsx`
- Modify: `C:\Users\young\code\component-library\src\index.ts`

Arrival Pattern 5 (motion.md §5): children rise 8px + fade **on mount** (not scroll-triggered), staggered in reading order, delay capped at 5 items.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { StaggerReveal } from './stagger-reveal'

vi.mock('@/lib/use-reduced-motion-safe', () => ({ useReducedMotionSafe: vi.fn(() => false) }))

beforeEach(() => {
  vi.mocked(useReducedMotionSafe).mockReturnValue(false)
})

describe('StaggerReveal', () => {
  it('renders all children', () => {
    render(
      <StaggerReveal>
        <span>a</span>
        <span>b</span>
      </StaggerReveal>
    )
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('wraps each child in its own animation wrapper', () => {
    const { container } = render(
      <StaggerReveal>
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </StaggerReveal>
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.querySelectorAll(':scope > div')).toHaveLength(3)
  })

  it('starts each item hidden (opacity 0)', () => {
    const { container } = render(
      <StaggerReveal>
        <span>a</span>
      </StaggerReveal>
    )
    const item = (container.firstChild as HTMLElement).firstChild as HTMLElement
    expect(item.style.opacity).toBe('0')
  })

  it('merges custom className on the container', () => {
    const { container } = render(
      <StaggerReveal className="grid grid-cols-3">
        <span>a</span>
      </StaggerReveal>
    )
    expect((container.firstChild as HTMLElement).className).toContain('grid-cols-3')
  })

  it('forwards ref to the container', () => {
    const ref = { current: null as HTMLDivElement | null }
    render(
      <StaggerReveal ref={ref}>
        <span>a</span>
      </StaggerReveal>
    )
    expect(ref.current).toBeInstanceOf(HTMLElement)
  })

  it('accepts a custom stagger step', () => {
    const { container } = render(
      <StaggerReveal staggerMs={30}>
        <span>a</span>
        <span>b</span>
      </StaggerReveal>
    )
    expect((container.firstChild as HTMLElement).querySelectorAll(':scope > div')).toHaveLength(2)
  })

  it('respects reduced motion (items fade only, no y offset)', () => {
    vi.mocked(useReducedMotionSafe).mockReturnValue(true)
    const { container } = render(
      <StaggerReveal>
        <span>a</span>
      </StaggerReveal>
    )
    const item = (container.firstChild as HTMLElement).firstChild as HTMLElement
    expect(item.style.transform === '' || item.style.transform === 'none').toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/stagger-reveal/stagger-reveal.test.tsx`
Expected: FAIL — `Cannot find module './stagger-reveal'`

- [ ] **Step 3: Write the implementation**

```tsx
'use client'

/* StaggerReveal — arrival Pattern 5 (docs/brand/motion.md §5).
   Direct children rise 8px + fade in on mount, staggered in reading order,
   delay capped at 5 items. For scroll-triggered reveals use ScrollReveal. */

import * as React from 'react'
import { motion } from 'framer-motion'
import { STAGGER } from '@/lib/motion'
import { getStaggerDelayMs, getStaggerItemVariants } from '@/lib/motion-variants'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { cn } from '@/lib/utils'

export interface StaggerRevealProps {
  readonly children: React.ReactNode
  readonly className?: string
  /** Per-item stagger step in ms. */
  readonly staggerMs?: number
}

export const StaggerReveal = React.forwardRef<HTMLDivElement, StaggerRevealProps>(
  ({ children, className, staggerMs = STAGGER.cardMs }, ref) => {
    const reducedMotion = useReducedMotionSafe()
    return (
      <div ref={ref} className={cn(className)}>
        {React.Children.map(children, (child, index) => (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={getStaggerItemVariants(reducedMotion)}
            custom={getStaggerDelayMs(index, staggerMs)}
          >
            {child}
          </motion.div>
        ))}
      </div>
    )
  }
)
StaggerReveal.displayName = 'StaggerReveal'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/stagger-reveal/stagger-reveal.test.tsx`
Expected: PASS, 7 tests

- [ ] **Step 5: Barrel + library exports**

Create `src/components/ui/stagger-reveal/index.ts`:

```ts
export * from './stagger-reveal'
```

In `src/index.ts`, add alphabetically:

```ts
export * from './components/ui/stagger-reveal'
```

- [ ] **Step 6: Story**

Create `stories/ui/stagger-reveal.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { StaggerReveal } from '@/components/ui/stagger-reveal'

const meta: Meta<typeof StaggerReveal> = {
  title: 'Motion/StaggerReveal',
  component: StaggerReveal,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof StaggerReveal>

const DemoCard = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border bg-surface p-6 text-foreground">{label}</div>
)

export const Default: Story = {
  render: () => (
    <StaggerReveal className="flex flex-col gap-3">
      <DemoCard label="First — arrives immediately" />
      <DemoCard label="Second — +40ms" />
      <DemoCard label="Third — +80ms" />
      <DemoCard label="Fourth — +120ms" />
    </StaggerReveal>
  ),
}

export const Grid: Story = {
  render: () => (
    <StaggerReveal className="grid grid-cols-3 gap-3">
      {Array.from({ length: 9 }, (_, i) => (
        <DemoCard key={i} label={`Card ${i + 1}`} />
      ))}
    </StaggerReveal>
  ),
}
```

- [ ] **Step 7: Full unit suite + typecheck**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors, coverage 100%.

- [ ] **Step 8: Commit**

```bash
git -C C:\Users\young\code\component-library add src/components/ui/stagger-reveal stories/ui/stagger-reveal.stories.tsx src/index.ts
git -C C:\Users\young\code\component-library commit -m "feat(motion): add StaggerReveal primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `ProgressLine` (TDD + story)

**Files:**
- Test: `C:\Users\young\code\component-library\src\components\ui\progress-line\progress-line.test.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\progress-line\progress-line.tsx`
- Create: `C:\Users\young\code\component-library\src\components\ui\progress-line\index.ts`
- Create: `C:\Users\young\code\component-library\stories\ui\progress-line.stories.tsx`
- Modify: `C:\Users\young\code\component-library\src\index.ts`

Loading Pattern 2, Cinematic Progress (motion.md §5). Controlled by `active`. Phase machine: `idle → fill (0→60%, 300ms, ease-out) → crawl (→90%, 8s linear, holds) → complete (→100%, 150ms) → fade (opacity→0, 200ms) → idle`. Plain CSS transitions + timers — no framer needed. Reduced motion: every phase linear (motion.md reduced-motion table: "no easing curve, linear fill").

**Fake-timer gotcha (repo CLAUDE.md):** global `fakeTimers.toFake` is `['Date']` — `vi.useFakeTimers()` without explicit config will NOT fake `setTimeout`. Always pass the full `toFake` list.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { ProgressLine } from './progress-line'

vi.mock('@/lib/use-reduced-motion-safe', () => ({ useReducedMotionSafe: vi.fn(() => false) }))

beforeEach(() => {
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.mocked(useReducedMotionSafe).mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

const bar = () => screen.getByRole('progressbar').firstChild as HTMLElement

describe('ProgressLine', () => {
  it('renders nothing while idle', () => {
    render(<ProgressLine active={false} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('fills to 60% with the brand out-curve when activated', () => {
    render(<ProgressLine active />)
    expect(bar().style.width).toBe('60%')
    expect(bar().style.transition).toContain('300ms')
    expect(bar().style.transition).toContain('cubic-bezier(0.25, 1, 0.5, 1)')
  })

  it('crawls to 90% linearly after the fill phase', () => {
    render(<ProgressLine active />)
    act(() => vi.advanceTimersByTime(300))
    expect(bar().style.width).toBe('90%')
    expect(bar().style.transition).toContain('linear')
  })

  it('snaps to 100% then fades out and unmounts when deactivated', () => {
    const { rerender } = render(<ProgressLine active />)
    act(() => vi.advanceTimersByTime(300))
    rerender(<ProgressLine active={false} />)
    expect(bar().style.width).toBe('100%')
    act(() => vi.advanceTimersByTime(150))
    const wrapper = screen.getByRole('progressbar') as HTMLElement
    expect(wrapper.style.opacity).toBe('0')
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('completes from the fill phase too (fast loads)', () => {
    const { rerender } = render(<ProgressLine active />)
    rerender(<ProgressLine active={false} />)
    expect(bar().style.width).toBe('100%')
  })

  it('restarts if reactivated mid-fade', () => {
    const { rerender } = render(<ProgressLine active />)
    rerender(<ProgressLine active={false} />)
    act(() => vi.advanceTimersByTime(150))
    rerender(<ProgressLine active />)
    expect(bar().style.width).toBe('60%')
  })

  it('uses linear fill under reduced motion', () => {
    vi.mocked(useReducedMotionSafe).mockReturnValue(true)
    render(<ProgressLine active />)
    expect(bar().style.transition).toContain('linear')
    expect(bar().style.transition).not.toContain('cubic-bezier')
  })

  it('exposes an accessible label', () => {
    render(<ProgressLine active label="Loading dashboard" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Loading dashboard')
  })

  it('merges custom className', () => {
    render(<ProgressLine active className="z-[60]" />)
    expect((screen.getByRole('progressbar') as HTMLElement).className).toContain('z-[60]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/progress-line/progress-line.test.tsx`
Expected: FAIL — `Cannot find module './progress-line'`

- [ ] **Step 3: Write the implementation**

```tsx
'use client'

/* ProgressLine — loading Pattern 2, Cinematic Progress (docs/brand/motion.md §5).
   2px line fixed at the top of the viewport, driven by the `active` prop:
   fill 0→60% fast, crawl →90% and hold, snap to 100% + fade when active drops. */

import * as React from 'react'
import { EASE_CSS } from '@/lib/motion'
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'fill' | 'crawl' | 'complete' | 'fade'
type ActivePhase = Exclude<Phase, 'idle'>

const FILL_MS = 300
const CRAWL_MS = 8000
const COMPLETE_MS = 150
const FADE_MS = 200

const PHASE_WIDTH_PCT: Record<ActivePhase, number> = {
  fill: 60,
  crawl: 90,
  complete: 100,
  fade: 100,
}

const PHASE_DURATION_MS: Record<ActivePhase, number> = {
  fill: FILL_MS,
  crawl: CRAWL_MS,
  complete: COMPLETE_MS,
  fade: FADE_MS,
}

const PHASE_FLOW: Partial<Record<Phase, { next: Phase; afterMs: number }>> = {
  fill: { next: 'crawl', afterMs: FILL_MS },
  complete: { next: 'fade', afterMs: COMPLETE_MS },
  fade: { next: 'idle', afterMs: FADE_MS },
}

export interface ProgressLineProps {
  /** True while navigation/loading is in flight. */
  readonly active: boolean
  readonly className?: string
  readonly label?: string
}

export function ProgressLine({ active, className, label = 'Loading' }: ProgressLineProps) {
  const reducedMotion = useReducedMotionSafe()
  const [phase, setPhase] = React.useState<Phase>('idle')

  React.useEffect(() => {
    if (active) {
      setPhase('fill')
      return
    }
    setPhase((prev) => (prev === 'fill' || prev === 'crawl' ? 'complete' : prev))
  }, [active])

  React.useEffect(() => {
    const flow = PHASE_FLOW[phase]
    if (!flow) return undefined
    const timer = setTimeout(() => setPhase(flow.next), flow.afterMs)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'idle') return null

  const easing = phase === 'fill' && !reducedMotion ? EASE_CSS.out : 'linear'

  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn('pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5', className)}
      style={{ opacity: phase === 'fade' ? 0 : 1, transition: `opacity ${FADE_MS}ms linear` }}
    >
      <div
        className="h-full bg-accent"
        style={{
          width: `${PHASE_WIDTH_PCT[phase]}%`,
          transition: `width ${PHASE_DURATION_MS[phase]}ms ${easing}`,
        }}
      />
    </div>
  )
}
```

(No `forwardRef`: it's a fixed full-width overlay — there is no layout use for a ref, and the element unmounts at idle.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/progress-line/progress-line.test.tsx`
Expected: PASS, 9 tests

- [ ] **Step 5: Barrel + library exports**

Create `src/components/ui/progress-line/index.ts`:

```ts
export * from './progress-line'
```

In `src/index.ts`, add alphabetically:

```ts
export * from './components/ui/progress-line'
```

- [ ] **Step 6: Story**

Create `stories/ui/progress-line.stories.tsx`:

```tsx
import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '@/components/ui/button'
import { ProgressLine } from '@/components/ui/progress-line'

const meta: Meta<typeof ProgressLine> = {
  title: 'Feedback/ProgressLine',
  component: ProgressLine,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ProgressLine>

export const Active: Story = {
  render: () => (
    <div className="h-24">
      <ProgressLine active />
      <p className="text-muted-foreground">Line crawls toward 90% at the top of the viewport.</p>
    </div>
  ),
}

const InteractiveDemo = () => {
  const [active, setActive] = React.useState(false)
  return (
    <div className="flex h-24 flex-col gap-4">
      <ProgressLine active={active} />
      <Button onClick={() => setActive((prev) => !prev)}>
        {active ? 'Finish loading' : 'Start loading'}
      </Button>
    </div>
  )
}

export const Interactive: Story = {
  render: () => <InteractiveDemo />,
}
```

- [ ] **Step 7: Full unit suite + typecheck**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors, coverage 100%.

- [ ] **Step 8: Commit**

```bash
git -C C:\Users\young\code\component-library add src/components/ui/progress-line stories/ui/progress-line.stories.tsx src/index.ts
git -C C:\Users\young\code\component-library commit -m "feat(motion): add ProgressLine primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

<!-- COMPACT POINT -->

---

### Task 7: Preset — shimmer keyframe + brand-curve animation easings

**Files:**
- Modify: `C:\Users\young\code\component-library\src\tailwind\preset.ts` (keyframes + animation blocks, lines 91–133)

Preset is excluded from unit coverage (config, not unit-tested) — verification is the Storybook gate in Task 9.

- [ ] **Step 1: Add the shimmer keyframe**

In `preset.ts` `keyframes`, after `'draw-check'`:

```ts
        shimmer: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
```

- [ ] **Step 2: Add the shimmer animation + align easings with brand curves**

Replace the whole `animation` block with (durations unchanged — scope is easings only, per motion.md §8 item 2; `draw-check`/`radio-dot`/accordion/collapsible are arrivals → `--ease-out`; `switch-thumb`/`progress-indeterminate` are bidirectional → `--ease-in-out`; shimmer is a constant sweep → linear):

```ts
      animation: {
        'draw-check': 'draw-check 150ms var(--ease-out) forwards',
        'radio-dot': 'radio-dot 120ms var(--ease-out)',
        shimmer: 'shimmer 1.5s linear infinite',
        'switch-thumb': 'switch-thumb 200ms var(--ease-in-out)',
        'progress-indeterminate': 'progress-indeterminate 1.4s var(--ease-in-out) infinite',
        'accordion-down': 'accordion-down 200ms var(--ease-out)',
        'accordion-up': 'accordion-up 200ms var(--ease-out)',
        'collapsible-down': 'collapsible-down 200ms var(--ease-out)',
        'collapsible-up': 'collapsible-up 200ms var(--ease-out)',
      },
```

- [ ] **Step 3: Typecheck + build sanity**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git -C C:\Users\young\code\component-library add src/tailwind/preset.ts
git -C C:\Users\young\code\component-library commit -m "feat(preset): shimmer keyframe; align animation easings with brand curves

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `Skeleton` shimmer variant (TDD + story update)

**Files:**
- Modify: `C:\Users\young\code\component-library\src\components\ui\skeleton\skeleton.test.tsx` (full rewrite below)
- Modify: `C:\Users\young\code\component-library\src\components\ui\skeleton\skeleton.tsx` (full rewrite below)
- Modify: `C:\Users\young\code\component-library\stories\ui\skeleton.stories.tsx`

Pattern 1 (motion.md §5): `--surface` background, `--accent-subtle` shimmer sweep, 1.5s linear infinite. **Shimmer becomes the default**; `pulse` stays as a variant. Reduced motion: shimmer pseudo-element hidden (static skeleton), pulse animation off.

- [ ] **Step 1: Check existing internal usages**

Run: `Grep` for `<Skeleton` in `src/` and `stories/` (exclude skeleton's own files).
Expected: any hits simply inherit the new shimmer default — intended. List them in the task report; do not change them.

- [ ] **Step 2: Rewrite the test file (failing for shimmer cases)**

Replace `skeleton.test.tsx` entirely:

```tsx
import * as React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from './skeleton'

const el = (ui: React.ReactElement) => render(ui).container.firstChild as HTMLElement

describe('Skeleton', () => {
  it('renders a div', () => {
    expect(el(<Skeleton />)).toBeInTheDocument()
  })

  it('defaults to the shimmer variant', () => {
    const node = el(<Skeleton />)
    expect(node.className).toContain('after:animate-shimmer')
    expect(node.className).toContain('bg-surface')
    expect(node.className).toContain('overflow-hidden')
    expect(node.className).not.toContain('animate-pulse')
  })

  it('hides the shimmer sweep under reduced motion', () => {
    expect(el(<Skeleton />).className).toContain('motion-reduce:after:hidden')
  })

  it('supports the legacy pulse variant', () => {
    const node = el(<Skeleton variant="pulse" />)
    expect(node.className).toContain('animate-pulse')
    expect(node.className).toContain('bg-muted')
    expect(node.className).not.toContain('after:animate-shimmer')
  })

  it('keeps the rounded base in both variants', () => {
    expect(el(<Skeleton />).className).toContain('rounded')
    expect(el(<Skeleton variant="pulse" />).className).toContain('rounded')
  })

  it('merges custom className', () => {
    const node = el(<Skeleton className="h-4 w-32" />)
    expect(node.className).toContain('h-4')
    expect(node.className).toContain('w-32')
  })

  it('forwards extra props', () => {
    expect(el(<Skeleton data-testid="skel" />).dataset.testid).toBe('skel')
  })
})
```

- [ ] **Step 3: Run test to verify the new cases fail**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/skeleton/skeleton.test.tsx`
Expected: FAIL — shimmer/variant assertions (component has no `variant` prop yet)

- [ ] **Step 4: Rewrite the implementation**

Replace `skeleton.tsx` entirely:

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* Loading Pattern 1 (docs/brand/motion.md §5): shimmer is the brand default —
   opacity-only pulse is on the "Never" list; the pulse variant is a legacy escape hatch. */
const skeletonVariants = cva('rounded', {
  variants: {
    variant: {
      shimmer:
        'relative overflow-hidden bg-surface after:absolute after:inset-0 after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:via-accent-subtle/60 after:to-transparent motion-reduce:after:hidden',
      pulse: 'animate-pulse bg-muted motion-reduce:animate-none',
    },
  },
  defaultVariants: {
    variant: 'shimmer',
  },
})

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

export function Skeleton({ className, variant, ...props }: SkeletonProps) {
  return <div className={cn(skeletonVariants({ variant }), className)} {...props} />
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/components/ui/skeleton/skeleton.test.tsx`
Expected: PASS, 7 tests

- [ ] **Step 6: Update the story**

In `stories/ui/skeleton.stories.tsx`, after the `Default` story add:

```tsx
export const Pulse: Story = {
  render: () => <Skeleton variant="pulse" className="h-4 w-48" />,
}
```

(Existing `Default`, `Card`, `Avatar` stories now render shimmer — no changes needed.)

- [ ] **Step 7: Full unit suite + typecheck**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors, coverage 100%.

- [ ] **Step 8: Commit**

```bash
git -C C:\Users\young\code\component-library add src/components/ui/skeleton stories/ui/skeleton.stories.tsx
git -C C:\Users\young\code\component-library commit -m "feat(skeleton): shimmer variant as brand default, pulse kept as escape hatch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Storybook visual gate + axe E2E registration

**Files:**
- Modify: `C:\Users\young\code\component-library\tests\e2e\accessibility.spec.ts` (stories array)

**Preview gate (workspace CLAUDE.md):** visual/token work needs eyes before sign-off — orchestrator task, uses Playwright MCP against `just dev` (localhost:6006).

- [ ] **Step 1: Start Storybook**

Run: `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library dev` (background)

- [ ] **Step 2: Visual verification — dark + light**

Via Playwright MCP, for each of: `motion-scrollreveal--default`, `motion-scrollreveal--staggered-children`, `motion-staggerreveal--default`, `feedback-progressline--interactive`, `display-skeleton--default`, `display-skeleton--card`, plus easing-alignment spot-checks `inputs-switch--default`, `disclosure-accordion--default`:
- Verify in **dark mode first**, then light mode
- Skeleton: shimmer sweep visible, emerald glow on `--surface`, no pulse
- ScrollReveal: scroll the story; section rises + fades once
- ProgressLine: click Start — fill then crawl; click Finish — snap + fade
- Save screenshots to `docs/brand/screenshots/brand-motion-phase2/<HH-mm-ss>-<description>.png` (pass full path as `filename`)

- [ ] **Step 3: Register stories for axe**

In `tests/e2e/accessibility.spec.ts`, append to the `stories` array:

```ts
  { name: 'ScrollReveal', id: 'motion-scrollreveal--default' },
  { name: 'StaggerReveal', id: 'motion-staggerreveal--default' },
  { name: 'ProgressLine', id: 'feedback-progressline--active' },
```

- [ ] **Step 4: Run E2E**

Run: `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library storybook-build` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library e2e`
Expected: all pass, zero axe violations (note: animated elements are mid-flight during axe runs — `aria-hidden` won't suppress contrast checks; if the shimmer gradient trips contrast, raise the gradient's via-opacity, don't hide it).

- [ ] **Step 5: Commit**

```bash
git -C C:\Users\young\code\component-library add tests/e2e/accessibility.spec.ts
git -C C:\Users\young\code\component-library commit -m "test(e2e): register motion primitives for axe checks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

<!-- COMPACT POINT -->

---

### Task 10: `Motion.mdx` foundation page

**Files:**
- Create: `C:\Users\young\code\component-library\stories\foundation\Motion.mdx`

Token reference page in the style of `Colors.mdx` (`Meta` from `@storybook/blocks`, inline export components). Content:

- [ ] **Step 1: Write the page**

```mdx
{/* stories/foundation/Motion.mdx */}
import { Meta } from '@storybook/blocks'

<Meta title="Foundation/Motion" />

# Motion

Motion tokens ship as CSS vars (`tokens.css`), TS constants (`MOTION`, `EASE`, `EASE_CSS`, `STAGGER`, `SPRING_MAGNETIC`), and Tailwind utilities via the preset. Canonical reference: `docs/brand/motion.md`.

## Durations

| Token | Value | Tailwind | Use |
|---|---|---|---|
| `--motion-instant` | 100ms | `duration-instant` | micro feedback (press, toggle) |
| `--motion-fast` | 150ms | `duration-fast` | hover, exits |
| `--motion-base` | 250ms | `duration-base` | standard transitions, crossfades |
| `--motion-slow` | 400ms | `duration-slow` | entrances, scene cuts |
| `--motion-hero` | 600ms | `duration-hero` | hero reveals — ceiling, nothing slower |

## Easing

| Token | Curve | Tailwind | Use |
|---|---|---|---|
| `--ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | `ease-out` | arrivals |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | `ease-in-out` | environment shifts, morphs |
| `--ease-exit` | `cubic-bezier(0.5, 0, 0.75, 0)` | `ease-exit` | departures |

`ease-out` / `ease-in-out` intentionally shadow Tailwind's defaults with brand curves.

export const EasingDemo = ({ token, label }) => (
  <div style={{ padding: '6px 0' }}>
    <code style={{ fontWeight: 600 }}>{label}</code>
    <div style={{ marginTop: 6, height: 8, borderRadius: 4, background: 'rgb(var(--surface-raised))', overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          borderRadius: 4,
          background: 'rgb(var(--accent))',
          animation: `mdx-fill 2s ${token} infinite alternate`,
        }}
      />
    </div>
  </div>
)

<style>{`@keyframes mdx-fill { from { width: 0; } to { width: 100%; } }`}</style>

<EasingDemo token="var(--ease-out)" label="--ease-out — arrivals" />
<EasingDemo token="var(--ease-in-out)" label="--ease-in-out — morphs" />
<EasingDemo token="var(--ease-exit)" label="--ease-exit — departures" />

## Stagger & spring

- Words: 30ms (`STAGGER.wordMs`) · Cards: 40ms (`STAGGER.cardMs`) · Delay capped at 5 items (`STAGGER.capItems`)
- Magnetic spring (Framer, cinematic CTAs only): stiffness 300 / damping 25 (`SPRING_MAGNETIC`)

## Usage

```tsx
import { MOTION, EASE, EASE_CSS, ScrollReveal, StaggerReveal, ProgressLine } from '@crawfordyoung/ui'

// Framer Motion — spread EASE (its ease prop rejects readonly tuples)
<motion.div transition={{ duration: MOTION.slow / 1000, ease: [...EASE.out] }} />

// CSS-in-JS / inline styles
element.style.transition = `opacity ${MOTION.fast}ms ${EASE_CSS.out}`
```

```html
<!-- Tailwind utilities from the preset -->
<div class="transition-transform duration-slow ease-out hover:-translate-y-0.5" />
```

## Primitives

| Component | Pattern | Docs |
|---|---|---|
| `ScrollReveal` | Scroll choreography Layer 1 | Motion/ScrollReveal |
| `StaggerReveal` | Arrival Pattern 5 | Motion/StaggerReveal |
| `ProgressLine` | Loading Pattern 2 | Feedback/ProgressLine |
| `Skeleton` (shimmer) | Loading Pattern 1 | Display/Skeleton |
```

- [ ] **Step 2: Verify the page renders**

Storybook still running from Task 9 — navigate to Foundation/Motion, confirm tables render and the three easing bars animate with visibly different curves (dark + light).

- [ ] **Step 3: Commit**

```bash
git -C C:\Users\young\code\component-library add stories/foundation/Motion.mdx
git -C C:\Users\young\code\component-library commit -m "docs(storybook): add Foundation/Motion token reference page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Repo docs + changeset

**Files:**
- Modify: `C:\Users\young\code\component-library\README.md`
- Modify: `C:\Users\young\code\component-library\CLAUDE.md` (wave table + peer dep note)
- Create: `C:\Users\young\code\component-library\.changeset\motion-core-primitives.md`

- [ ] **Step 1: README**

Add `ScrollReveal`, `StaggerReveal`, `ProgressLine` to the component table; document the Skeleton `variant` prop (shimmer default); extend the Motion-tokens section with primitive usage + the new peer dependency install line (`pnpm add framer-motion`).

- [ ] **Step 2: CLAUDE.md**

Add wave 9 row: `| 9 | Motion primitives: ScrollReveal, StaggerReveal, ProgressLine, Skeleton shimmer, Motion.mdx, framer-motion peer dep | In PR |`. Note `framer-motion` in the peer-dependencies/key-differences section.

- [ ] **Step 3: Changeset (write file directly — CLI is interactive; backtick-wrap globs)**

Create `.changeset/motion-core-primitives.md`:

```markdown
---
'@crawfordyoung/ui': minor
---

Add core motion primitives: `ScrollReveal` (scroll choreography Layer 1), `StaggerReveal` (arrival Pattern 5), `ProgressLine` (cinematic progress, Pattern 2), `useReducedMotionSafe`, and pure motion variant builders. `Skeleton` gains a `variant` prop — shimmer is the new default, `pulse` remains as an escape hatch. Tailwind preset animation easings now use brand curves, and a `shimmer` keyframe is added. `framer-motion` (>=12) is now a peer dependency.
```

- [ ] **Step 4: Commit**

```bash
git -C C:\Users\young\code\component-library add README.md CLAUDE.md .changeset/motion-core-primitives.md
git -C C:\Users\young\code\component-library commit -m "docs: document motion primitives; changeset for minor release

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Full check, PR, CI

- [ ] **Step 1: Full check**

Run: `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library check`
Expected: lint + typecheck + test + e2e all green. Watch for corepack re-adding `packageManager` to package.json — discard if it appears (known side effect, user ruled: discard).

- [ ] **Step 2: Push + PR (user approval per policy before push)**

```bash
git -C C:\Users\young\code\component-library push -u origin feat/motion-primitives
gh pr create --repo Crawford-Young/component-library --title "feat(motion): core motion primitives" --fill
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks <number> --watch`
Expected: all green — do not move on until green or user dismisses.

---

### Task 13: motion.md status flips + wave close

**Files:**
- Modify: `C:\Users\young\code\claude-config\workspace\docs\brand\motion.md` (§5 component table, §8 implementation order)

- [ ] **Step 1: Flip statuses in motion.md** (after PR merge)

§5 component-library additions table: `Skeleton` → `✅ shimmer variant shipped (default)`, `ProgressLine` → `✅ Shipped`, `StaggerReveal` → `✅ Shipped` (TypewriterStream stays ❌, Phase 4). §8 implementation order: item 2 → `✅ *(shipped — component-library PR #<n>)*`; note `framer-motion` peer dependency landed.

- [ ] **Step 2: Wave close**

Move this checklist to `docs/brand/checklists/done/`, issue log to `docs/brand/issues/done/`.

- [ ] **Step 3: Run `claude-md-management:reflect`** (mandatory at wave close)

- [ ] **Step 4: Commit closure in claude-config** (user approval per policy)
