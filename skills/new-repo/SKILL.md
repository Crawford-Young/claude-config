---
name: new-repo
description: "Use when bootstrapping a repo from scratch — 'new project', 'create a repo', 'scaffold a project', 'start a new app'. Carries the 24-step production setup (git, tooling, testing, Storybook, dark mode, CI, data layer, services), hard-gated in order."
disable-model-invocation: true
---

# New Repository Scaffolding

You are setting up a brand-new production-quality repository. Every step in this checklist exists for a reason — skipping any of them means the project starts below standard and the gap will compound over time.

Read `~/code/CLAUDE.md` for universal security/git standards, `~/code/web/CLAUDE.md` for architecture and server-boundary standards, and `~/code/docs/web/TEMPLATES.md` for CI/Justfile/security-header templates.

<HARD-GATE>
Step 3 (commit .gitignore) must happen before any other files are committed. Never commit secrets, node_modules, .env, or build artifacts. If you are unsure whether a file should be gitignored, gitignore it.
</HARD-GATE>

---

## Step 0 — Gather Requirements

Ask the user:

1. **Project name** — this becomes the repo name, package name, and docs folder name
2. **Type** — Next.js fullstack, Python/FastAPI, or published package library?
3. **Database** — Neon/Drizzle (relational), MongoDB (non-relational), or none?
4. **Auth** — Auth.js v5, Clerk, or none?
5. **Payments** — Stripe needed?
6. **Real-time** — Pusher Channels needed?
7. **Background jobs** — Trigger.dev needed?
8. **Published package?** — will this be published to npm? (adds tsup + changesets)

Skip services that are not needed — do not scaffold unused infrastructure.

---

## Checklist

Work through these in order. Check each off as it completes.

### Foundation
- [ ] Create `~/code/docs/<project-name>/` for planning docs
- [ ] `git init` in the project directory
- [ ] Create and switch to branch `feat/initial-setup`
- [ ] Create `.gitignore` — commit this as the **very first commit** before any other files
  - Include: `node_modules/`, `.env`, `.env.local`, `.env.*.local`, `dist/`, `.next/`, `out/`, `coverage/`, `.DS_Store`, `*.log`, `pnpm-debug.log*`
- [ ] Create `.env.example` — document all required vars with placeholder values, no actual secrets

### Configuration Files
- [ ] `package.json` with correct name, version `0.0.1`, scripts for dev/build/test/lint/typecheck
- [ ] `tsconfig.json` — `strict: true`, `baseUrl: "."`, `paths: { "@/*": ["./src/*"] }`
- [ ] `next.config.ts` with security headers (full set from `~/code/docs/web/TEMPLATES.md`)
- [ ] `tailwind.config.ts` — `darkMode: "class"`, content paths including `node_modules/@username/ui/src/**` if consuming the component library
- [ ] `src/env.ts` — t3-env with Zod validation for all env vars
- [ ] `justfile` — full set of commands from `~/code/docs/web/TEMPLATES.md`
- [ ] `drizzle.config.ts` (if using Neon/Drizzle)

### Code Quality
- [ ] ESLint config — `@typescript-eslint`, `eslint-config-next`, `eslint-plugin-jsx-a11y`
- [ ] Prettier config — consistent formatting rules
- [ ] Husky init — three hooks:
  - `pre-commit`: lint-staged on staged TS/TSX files
  - `commit-msg`: commitlint
  - `pre-push`: `tsc --noEmit`
- [ ] `commitlint.config.ts` — extends `@commitlint/config-conventional`
- [ ] `lint-staged` config in `package.json`

### Testing
- [ ] Vitest config — `environment: "happy-dom"`, setup file, 100% coverage thresholds enforced, `vite-tsconfig-paths` plugin
- [ ] `tests/setup.ts` — imports `@testing-library/jest-dom/vitest`, MSW server setup
- [ ] `tests/mocks/handlers.ts` — empty handlers array to start
- [ ] `tests/mocks/server.ts` — MSW node server
- [ ] Playwright config — `@axe-core/playwright` for accessibility checks

### UI & Theme
- [ ] Storybook config — `@storybook/nextjs`, `@storybook/addon-a11y`, `@storybook/addon-interactions`
- [ ] `src/app/layout.tsx` — `ThemeProvider` with `defaultTheme="dark"`, `attribute="class"`
- [ ] `src/lib/utils.ts` — `cn()` helper using `clsx` + `tailwind-merge`
- [ ] `src/components/ui/` directory — empty, ready for components

### Infrastructure
- [ ] `src/lib/logger.ts` — Pino logger instance
- [ ] `src/lib/redis.ts` — Upstash Redis client (if using rate limiting or caching)
- [ ] `src/lib/stripe.ts` — Stripe server client (if monetized)
- [ ] `src/db/` — Drizzle schema + client (if relational) or MongoDB client + schemas (if non-relational)
- [ ] Auth.js v5 setup — `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `middleware.ts` (if auth needed)
- [ ] Sentry — `instrumentation.ts` with `register()` function
- [ ] Vercel Analytics — `<Analytics />` and `<SpeedInsights />` in root layout (if deploying to Vercel)

### CI & Publishing
- [ ] `.github/workflows/ci.yml` — check job + e2e job, see TEMPLATES.md's 'GitHub Actions CI' section
- [ ] `.github/dependabot.yml` — npm + github-actions, weekly schedule
- [ ] If published package: `tsup.config.ts`, Changesets init, `src/index.ts` barrel export

### Published Package Extra (if applicable)
- [ ] `tsup.config.ts` — ESM + CJS + dts, external react/react-dom
- [ ] `pnpm changeset init`
- [ ] `.github/workflows/release.yml` — Changesets action
- [ ] Update `package.json` exports map and `files: ["dist", "src"]`

---

## Final Steps

1. Run `just check` — must pass before the branch is ready
2. Write the first failing test for the first real feature
3. Commit everything on `feat/initial-setup` (do not push until user approves)
4. Present a summary of what was created and what the user needs to fill in (env vars, etc.)

---

## Report

```
Project: <name>
Branch: feat/initial-setup

Setup complete:
✓/✗ Foundation (git, gitignore, env.example)
✓/✗ Config files (tsconfig, next.config, tailwind, t3-env, justfile)
✓/✗ Code quality (ESLint, Prettier, Husky, commitlint)
✓/✗ Testing (Vitest, Playwright, MSW, Storybook)
✓/✗ UI & theme (dark mode, cn(), components dir)
✓/✗ Infrastructure (logger, [db], [auth], [sentry], [analytics])
✓/✗ CI/CD (ci.yml, dependabot.yml)
✓/✗ just check passing

Action required from user:
- Fill in .env with: <list required env vars>
- <any other manual steps like Neon DB creation, Vercel linking, etc.>
```
