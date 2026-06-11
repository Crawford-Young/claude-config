<!-- ORCHESTRATOR ONLY — update checkboxes and Reflect Log as tasks complete. Subagents: read-only. -->
# Brand Motion — Phase 1: Tokens + Doc Migration — Implementation Plan
**Branch:** main (claude-config docs) · feat/motion-tokens (component-library)
**Workflow:** subagent-driven-development
**Model:** Fable (orch) · Opus (arch/review) · Sonnet (impl) · Haiku (recon)
**Spec:** docs/brand/specs/2026-06-10-motion-language-design.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/brand/motion.md` as the third living brand doc and ship motion tokens (CSS vars + TS constants) from `@crawfordyoung/ui`.

**Architecture:** Doc work happens in the `claude-config` repo (`workspace/docs/brand/` — the `~/code/docs/brand/` junction targets it; always edit the real `claude-config/workspace/...` path, Write/Edit refuse junctioned paths). Library work happens in `component-library` on a feature branch. Spec: `docs/brand/specs/2026-06-10-motion-language-design.md`.

**Tech Stack:** Markdown (docs), CSS custom properties, TypeScript + Vitest (library), Changesets.

**Issue log:** orchestrator creates `docs/brand/issues/2026-06-10-motion-phase1-issues.md` at execution start (orchestrator only — never subagents).

---

### Task 1: Create `motion.md`

**Files:**
- Create: `C:\Users\young\code\claude-config\workspace\docs\brand\motion.md`
- Read (sources): `C:\Users\young\code\claude-config\workspace\docs\brand\specs\2026-06-10-motion-language-design.md`, `C:\Users\young\code\claude-config\workspace\docs\brand\brand-identity.md` (lines 200–278)

Doc task — no TDD. Assemble `motion.md` from the approved spec. Content sources are exact — copy, don't paraphrase:

- [x] **Step 1: Write the doc header**

```markdown
# Motion — Crawford Young

Living reference for all motion: page transitions, scroll choreography, arrival, loading, micro-interactions. Re-verified against code and updated in place. Decision record: [`specs/2026-06-10-motion-language-design.md`](./specs/2026-06-10-motion-language-design.md).

**Code source of truth:** `component-library/src/styles/tokens.css` (CSS vars) + `component-library/src/lib/motion.ts` (TS constants) — if doc and code disagree, code wins; fix the doc.
```

- [x] **Step 2: Add sections 1–4 from the spec**

| motion.md section | Source (spec) | Action |
|---|---|---|
| `## 1. Principles` | Spec §3 (6 numbered principles) | Copy verbatim |
| `## 2. Motion Tokens` | Spec §4 (code block + TS constants note) | Copy verbatim, drop the "Values tokenize…" sentence (historical) |
| `## 3. Page Transitions` | Spec §5 (table + rules + reduced-motion line) | Copy verbatim |
| `## 4. Scroll Choreography` | Spec §6 (3 layers + reduced-motion line) | Copy verbatim |

- [x] **Step 3: Add section 5 — Arrival & Loading**

Open `brand-identity.md`, copy lines 202–278 (the §8 body: principle line, Patterns 1–5, fire-table, never-list, reduced-motion table, component-status table, Spinner divergence) verbatim under `## 5. Arrival & Loading`. Then append the two extensions from spec §7 as `### Arrival is universal` and `### Transition/loading handoff` — copy spec text verbatim.

- [x] **Step 4: Add sections 6–8 from the spec**

| motion.md section | Source (spec) | Action |
|---|---|---|
| `## 6. Micro-interactions` | Spec §8 (table + rules) | Copy verbatim |
| `## 7. Surface Tiers` | Spec §9 (intro + ✅/❌ matrix + defaults) | Copy verbatim |
| `## 8. Library API & Implementation Order` | Spec §10 + §11 | Copy verbatim; mark phase 1 (tokens) as 🟡 in progress |

- [x] **Step 5: Verify completeness**

Run: `Grep` for `TBD|TODO` in `motion.md` — expect zero hits. Confirm all 8 sections present, Spinner divergence text carried over unchanged.

---

### Task 2: Shrink `brand-identity.md` §7–§8 to pointers

**Files:**
- Modify: `C:\Users\young\code\claude-config\workspace\docs\brand\brand-identity.md` (§7 lines 191–196, §8 lines 200–278, §10 lines 299–303)

- [x] **Step 1: Replace §7 body (lines 191–196)**

Replace the `## 7. Motion` section body with:

```markdown
## 7. Motion

Moved → [`motion.md`](./motion.md). All motion — timing tokens, easing, transitions, scroll, micro-interactions — lives there.
```

- [x] **Step 2: Replace §8 body (lines 200–278)**

Replace the entire `## 8. Loading & Transition States — Cinematic Model` section (heading through the Spinner divergence paragraph) with:

```markdown
## 8. Loading & Transition States

Moved → [`motion.md`](./motion.md) §5 (Arrival & Loading). Patterns, fire-table, never-list, reduced-motion behavior, and the open Spinner divergence all live there.
```

- [x] **Step 3: Update §10 Phases 3–4**

In `## 10. Implementation Order`, replace the Phase 3 and Phase 4 blocks with:

```markdown
### Phase 3 — Visual components 🟡 Partial
### Phase 4 — Cinematic loading ❌ Not started

Both phases absorbed into [`motion.md`](./motion.md) §8 implementation order — track status there.
```

- [x] **Step 4: Verify no orphaned references**

Run: `Grep` for `§8|Pattern [1-5]` in `brand-identity.md` — fix any remaining internal references to the moved content (expected: none outside §10 pointer).

---

### Task 3: Update indexes

**Files:**
- Modify: `C:\Users\young\code\claude-config\workspace\docs\brand\README.md` (doc table, lines 5–8)
- Modify: `C:\Users\young\code\claude-config\workspace\CLAUDE.md` (companion-references `docs/brand/` line)

- [x] **Step 1: Add motion.md row to brand README table**

After the `design-system.md` row, add:

```markdown
| [`motion.md`](./motion.md) | Page transitions, scroll choreography, arrival, loading, micro-interactions, motion tokens | Animating anything — transitions, loading states, hover/press |
```

Also update the README intro sentence "Two living references below" → "Three living references below". Update the `brand-identity.md` row's "Covers" cell to drop "motion timing, cinematic loading patterns" (now in motion.md): `Identity, color tokens, typography, surface language`.

- [x] **Step 2: Update workspace CLAUDE.md brand line**

Replace the `docs/brand/` companion-references line with:

```markdown
> - [`docs/brand/`](./docs/brand/) — brand identity + design system + motion (load `brand-identity.md` for tokens/colors, `design-system.md` for layout/states/composition, `motion.md` for transitions/loading/animation)
```

---

### Task 4: Commit doc wave (claude-config)

- [x] **Step 1: Review the diff**

Run: `git -C C:\Users\young\code\claude-config status --short` and `git -C C:\Users\young\code\claude-config diff`
Expected: `motion.md` new; `brand-identity.md`, `README.md`, `CLAUDE.md` modified; checklist + issue log new.

- [x] **Step 2: Commit**

```bash
git -C C:\Users\young\code\claude-config add workspace/docs/brand/ workspace/CLAUDE.md
git -C C:\Users\young\code\claude-config commit -m "docs(brand): create motion.md living doc, shrink brand-identity §7-8 to pointers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> Done — commit `10888d4` (also carries user's own CLAUDE.md "Plan premise verification" line edit, present in working tree at commit time).

<!-- COMPACT POINT -->

---

### Task 5: Motion CSS vars in tokens.css

**Files:**
- Modify: `C:\Users\young\code\component-library\src\styles\tokens.css` (insert after the Radius block, line 48)

Preview-gate note: these vars render nothing until consumed — no visual diff exists to check in Storybook. Gate satisfied by inspection.

- [x] **Step 1: Create feature branch**

```bash
git -C C:\Users\young\code\component-library checkout main
git -C C:\Users\young\code\component-library pull --rebase
git -C C:\Users\young\code\component-library checkout -b feat/motion-tokens
```

- [x] **Step 2: Add motion vars to `:root`**

Insert after the Radius block (mode-independent — `:root` only, do NOT add to `.dark`):

```css
  /* Motion — durations + easing (see docs/brand/motion.md) */
  --motion-instant: 100ms;
  --motion-fast: 150ms;
  --motion-base: 250ms;
  --motion-slow: 400ms;
  --motion-hero: 600ms;
  --ease-out: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-exit: cubic-bezier(0.5, 0, 0.75, 0);
```

- [x] **Step 3: Commit**

```bash
git -C C:\Users\young\code\component-library add src/styles/tokens.css
git -C C:\Users\young\code\component-library commit -m "feat(tokens): add motion duration and easing CSS vars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> Done — commit `d36a9e9`. Spec review ✅, quality review ✅ (Approved, no changes).

---

### Task 6: TS motion constants (TDD)

**Files:**
- Test: `C:\Users\young\code\component-library\src\lib\motion.test.ts`
- Create: `C:\Users\young\code\component-library\src\lib\motion.ts`

Style notes: repo uses no semicolons, single quotes (match `src/lib/utils.ts`). `as const` objects, no interfaces needed.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { EASE, EASE_CSS, MOTION, SPRING_MAGNETIC, STAGGER } from './motion'

describe('MOTION', () => {
  it('defines the five duration tokens in ms', () => {
    expect(MOTION).toEqual({ instant: 100, fast: 150, base: 250, slow: 400, hero: 600 })
  })
})

describe('EASE', () => {
  it('defines the three brand bezier curves', () => {
    expect(EASE.out).toEqual([0.25, 1, 0.5, 1])
    expect(EASE.inOut).toEqual([0.65, 0, 0.35, 1])
    expect(EASE.exit).toEqual([0.5, 0, 0.75, 0])
  })
})

describe('EASE_CSS', () => {
  it('derives cubic-bezier strings matching the EASE arrays', () => {
    expect(EASE_CSS.out).toBe('cubic-bezier(0.25, 1, 0.5, 1)')
    expect(EASE_CSS.inOut).toBe('cubic-bezier(0.65, 0, 0.35, 1)')
    expect(EASE_CSS.exit).toBe('cubic-bezier(0.5, 0, 0.75, 0)')
  })
})

describe('STAGGER', () => {
  it('defines word/card stagger and item cap', () => {
    expect(STAGGER).toEqual({ wordMs: 30, cardMs: 40, capItems: 5 })
  })
})

describe('SPRING_MAGNETIC', () => {
  it('defines the magnetic spring config', () => {
    expect(SPRING_MAGNETIC).toEqual({ stiffness: 300, damping: 25 })
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/motion.test.ts`
Expected: FAIL — `Cannot find module './motion'`

- [x] **Step 3: Write the implementation**

```ts
/* src/lib/motion.ts
   Motion design tokens — TS mirror of the motion CSS vars in styles/tokens.css.
   Durations in ms. EASE arrays are Framer Motion cubic-bezier points;
   EASE_CSS are the equivalent CSS strings. See docs/brand/motion.md. */

export const MOTION = {
  instant: 100,
  fast: 150,
  base: 250,
  slow: 400,
  hero: 600,
} as const

type BezierCurve = readonly [number, number, number, number]

export const EASE = {
  out: [0.25, 1, 0.5, 1],
  inOut: [0.65, 0, 0.35, 1],
  exit: [0.5, 0, 0.75, 0],
} as const satisfies Record<string, BezierCurve>

const toCubicBezier = (curve: BezierCurve): string => `cubic-bezier(${curve.join(', ')})`

export const EASE_CSS = {
  out: toCubicBezier(EASE.out),
  inOut: toCubicBezier(EASE.inOut),
  exit: toCubicBezier(EASE.exit),
} as const

export const STAGGER = {
  wordMs: 30,
  cardMs: 40,
  capItems: 5,
} as const

export const SPRING_MAGNETIC = {
  stiffness: 300,
  damping: 25,
} as const
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --dir C:\Users\young\code\component-library vitest run src/lib/motion.test.ts`
Expected: PASS, 5 tests

- [x] **Step 5: Commit**

```bash
git -C C:\Users\young\code\component-library add src/lib/motion.ts src/lib/motion.test.ts
git -C C:\Users\young\code\component-library commit -m "feat(tokens): add MOTION, EASE, STAGGER, SPRING_MAGNETIC TS constants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> Done — commit `7b39b5b`. TDD verified (fail → pass, 5/5). Spec review ✅, quality review ✅ (Approved). Quality note adopted into T7: Framer `ease` prop needs spread (`[...EASE.out]`) — add doc-comment line.

---

### Task 7: Export constants + Tailwind preset mapping

**Files:**
- Modify: `C:\Users\young\code\component-library\src\index.ts` (append at end)
- Modify: `C:\Users\young\code\component-library\src\tailwind\preset.ts` (theme.extend, after `fontFamily` block ~line 77)

- [x] **Step 1: Export from library entry**

Append to `src/index.ts`:

```ts
export * from './lib/motion'
```

- [x] **Step 2: Map motion vars in the Tailwind preset**

In `preset.ts` `theme.extend`, after the `fontFamily` block, add (preset.ts has no test file — config is not unit-tested, keep that):

```ts
      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
        hero: 'var(--motion-hero)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        exit: 'var(--ease-exit)',
      },
```

- [x] **Step 3: Typecheck + full unit suite**

Run: `pnpm --dir C:\Users\young\code\component-library exec tsc --noEmit` then `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library test`
Expected: zero TS errors; coverage stays 100% (motion.ts fully covered by its test)

- [x] **Step 4: Commit**

```bash
git -C C:\Users\young\code\component-library add src/index.ts src/tailwind/preset.ts
git -C C:\Users\young\code\component-library commit -m "feat(tokens): export motion constants and map motion vars in Tailwind preset

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> Done — commit `e3d8c28` (also carries the Framer-spread doc-comment line from T6 review). tsc clean; 996 tests pass, coverage 100% across the board. Spec review ✅ (1-deletion = benign `*/` reflow), quality review ✅ (Approved). Quality note → T8: add one-line comment on `transitionTimingFunction` block — `ease-out`/`ease-in-out` intentionally shadow Tailwind defaults with brand curves.

<!-- COMPACT POINT -->

---

### Task 8: Full check, changeset, PR

- [x] **Step 1: Full check**

Run: `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library check`
Expected: lint + typecheck + test + e2e all green

- [x] **Step 2: Changeset**

Run: `just --justfile C:\Users\young\code\component-library\Justfile --working-directory C:\Users\young\code\component-library changeset` — choose **minor** (new exports: motion constants + preset keys). Summary: `Add motion design tokens: CSS vars (--motion-*, --ease-*), MOTION/EASE/EASE_CSS/STAGGER/SPRING_MAGNETIC constants, and Tailwind preset duration/easing mappings.`

- [x] **Step 3: Update repo MDs on the branch**

Per component-library MD rule: update `component-library/README.md` (document `MOTION`/`EASE`/`EASE_CSS`/`STAGGER`/`SPRING_MAGNETIC` exports + Tailwind `duration-fast`/`ease-exit`-style utilities) and `component-library/CLAUDE.md` (add motion-tokens note to file structure section: `src/lib/motion.ts`).

```bash
git -C C:\Users\young\code\component-library add README.md CLAUDE.md
git -C C:\Users\young\code\component-library commit -m "docs: document motion token exports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 4: Commit changeset, push, open PR**

```bash
git -C C:\Users\young\code\component-library add .changeset
git -C C:\Users\young\code\component-library commit -m "chore: changeset for motion tokens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git -C C:\Users\young\code\component-library push -u origin feat/motion-tokens
gh pr create --repo Crawford-Young/component-library --title "feat(tokens): motion design tokens" --fill
```

- [x] **Step 5: Watch CI**

Run: `gh pr checks <number> --watch`
Expected: all green — do not move on until green or user dismisses.

> Done — commits `a3ae6a3` (docs: README Motion-tokens section, CLAUDE.md file structure, preset.ts shadowing comment), `d3927bc` (changeset, minor), `8a12bfd` (fix: Prettier mangled `*` globs to `_` in changeset — backtick-wrapped). PR #51 open, all 6 CI checks green. Spec review ✅ (compliant, no scope creep), quality review ✅ (Approved; minors noted: duration values duplicated comment+table, no EASE_CSS usage example — polish, deferred). Motion.mdx foundation story deferred to Phase 2 per user.

---

### Task 9: Wave close

- [x] **Step 1:** Move this checklist to `docs/brand/checklists/done/`, issue log to `docs/brand/issues/done/`
- [x] **Step 2:** Run `claude-md-management:reflect` (mandatory at wave close)
- [x] **Step 3:** Commit closure in claude-config (user approval per policy)

> Done — reflect run with user. Adopted: component-library changeset rules (write file directly, backtick globs), ORCHESTRATOR.md trivial-fix exception, motion.md Phase 2 scope (preset animation easing alignment + Motion.mdx). Issue log closed empty — zero issues logged this wave. Session: $43.37, orchestrator = 85% of cost.
