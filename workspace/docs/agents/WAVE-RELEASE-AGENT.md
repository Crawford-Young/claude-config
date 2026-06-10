# WAVE-RELEASE-AGENT.md

Context for subagents handling a library wave release in `~/code/component-library`.

> Orchestration rules: `~/code/docs/ORCHESTRATOR.md` — read if you are unsure how to scope or hand off work.

---

## What a Wave Is

A wave is a named batch of new components shipped together as a minor version bump. Example: wave-2 shipped Alert, Checkbox, Progress, Popover, RadioGroup, Select, Switch, Tooltip → `v0.2.0`.

---

## Repo Location

`~/code/component-library/`

---

## Wave Release Steps (in order)

### 1. Verify all components in the wave are complete

Every component must satisfy the Definition of Done in `~/code/CLAUDE.md`:
- 100% Vitest coverage
- Storybook story in `stories/ui/<name>.stories.tsx` — **required, not optional**
- E2E entry in `tests/e2e/accessibility.spec.ts` — **required, not optional**
- axe zero violations
- TypeScript clean
- ESLint clean
- Barrel export in `src/index.ts`

Do not proceed if anything is incomplete. Stories and e2e entries are commonly missed when an agent runs out of context or hits a rate limit — always verify they exist before committing.

### 2. Create a changeset

Write the changeset file directly — do not run the interactive `pnpm changeset` CLI. Pick a unique kebab-case filename:

```bash
# File: .changeset/<adjective>-<noun>-<verb>.md  (any unique name works)
```

```md
---
"@crawfordyoung/ui": minor
---

Wave N — <describe what shipped>

New components:
- `ComponentA` — one-line description
- `ComponentB` — one-line description
```

Commit it:
```
chore: add changeset for wave N
```

### 3. Create the PR

Branch: `feat/wave-N`

PR title: `feat: wave N — <ComponentA>, <ComponentB>, ...`

PR body:
- List all new components
- Link to relevant Storybook stories
- Note any breaking changes (should be none for a wave)

### 4. After PR merges

- Changesets CI action opens a "Version Packages" PR automatically
- Merge that PR → CI publishes to npm as `@crawfordyoung/ui@X.Y.0`
- Update portfolio (`~/code/Crawford-Young.github.io`) to consume the new version

### 5. Run reflect

After the wave PR merges, run `claude-md-management:reflect`. This is mandatory — do not skip.

---

## Version Convention

| Change type | Bump |
|---|---|
| New components (wave) | `minor` |
| Bug fix to existing component | `patch` |
| Breaking API change | `major` |

---

## Files to Know

- `src/index.ts` — barrel exports (must include all new components)
- `.changeset/` — auto-generated changeset files
- `CHANGELOG.md` — auto-updated by Changesets on version bump
- `~/code/docs/component-library/` — wave plans and specs

---

## What NOT to Do

- Do not bump `major` for a wave — new components are always `minor`
- Do not merge the wave PR if any component is missing its Storybook story or E2E entry
- Do not publish to npm manually — Changesets CI handles it
- Do not commit or push without explicit user approval
- Do not skip running `claude-md-management:reflect` after the wave merges
