---
name: new-repo
description: "Use when bootstrapping a repo from scratch — 'new project', 'create a repo', 'scaffold a project', 'start a new app'. Carries the 24-step Next.js production setup (git, tooling, testing, Storybook, dark mode, CI, data layer, services) plus a Tauri desktop path (Bun + Rust), both hard-gated in order."
disable-model-invocation: true
---

# New Repository Scaffolding

You are setting up a brand-new production-quality repository. Every step in this checklist exists for a reason — skipping any of them means the project starts below standard and the gap will compound over time.

Read `~/code/CLAUDE.md` for universal security/git standards, then the domain file for the chosen Type: `~/code/web/CLAUDE.md` for Next.js/FastAPI/library (also pulls CI/Justfile/security-header templates from `~/code/docs/web/TEMPLATES.md`), or `~/code/apps/CLAUDE.md` for Tauri.

<HARD-GATE>
Commit `.gitignore` before any other file, on every path. Never commit secrets, node_modules, .env, or build artifacts. If you are unsure whether a file should be gitignored, gitignore it.
</HARD-GATE>

---

## Step 0 — Gather Requirements

Ask the user:

1. **Project name** — this becomes the repo name and package name
2. **Type** — Next.js fullstack, Python/FastAPI, published package library, or Tauri desktop?
3. **Database** — Neon/Drizzle (relational), MongoDB (non-relational), or none?
4. **Auth** — Auth.js v5, Clerk, or none?
5. **Payments** — Stripe needed?
6. **Real-time** — Pusher Channels needed?
7. **Background jobs** — Trigger.dev needed?
8. **Published package?** — will this be published to npm? (adds tsup + changesets)

Skip services that are not needed — do not scaffold unused infrastructure.

---

## Who does what (#99)

Scaffolding touches dozens of files, so it is dispatched, never typed inline. The orchestrator (this session) runs Step 0, then briefs an `implementer` (agent-factory dispatch block) per checklist section: Goal = the section's checkboxes, Scope = the files they name, Prior context = the Step 0 answers. Dependent sections run in checklist order; independent ones in parallel worktrees. Implementers create files and run the section's checks; they never commit or push.

The orchestrator holds only the gates and git: the HARD-GATE `.gitignore` commit first, each section's commit, the final gate, and the push approval.

## Checklist

Work through the chosen path in order. Check each off as it completes.

### Next.js

#### Foundation
- [ ] `git init` in the project directory
- [ ] Create and switch to branch `feat/initial-setup`
- [ ] Create `.gitignore` — commit this as the **very first commit** before any other files
  - Include: `node_modules/`, `.env`, `.env.local`, `.env.*.local`, `dist/`, `.next/`, `out/`, `coverage/`, `.DS_Store`, `*.log`, `pnpm-debug.log*`
- [ ] Create `.env.example` — document all required vars with placeholder values, no actual secrets

#### Configuration Files
- [ ] `package.json` with correct name, version `0.0.1`, scripts for dev/build/test/lint/typecheck
- [ ] `tsconfig.json` — `strict: true`, `baseUrl: "."`, `paths: { "@/*": ["./src/*"] }`
- [ ] `next.config.ts` with security headers (full set from `~/code/docs/web/TEMPLATES.md`)
- [ ] `tailwind.config.ts` — `darkMode: "class"`, content paths including `node_modules/@username/ui/src/**` if consuming the component library
- [ ] `src/env.ts` — t3-env with Zod validation for all env vars
- [ ] `justfile` — full set of commands from `~/code/docs/web/TEMPLATES.md`
- [ ] `drizzle.config.ts` (if using Neon/Drizzle)

#### Code Quality
- [ ] ESLint config — `@typescript-eslint`, `eslint-config-next`, `eslint-plugin-jsx-a11y`
- [ ] Prettier config — consistent formatting rules
- [ ] Husky init — three hooks:
  - `pre-commit`: lint-staged on staged TS/TSX files
  - `commit-msg`: commitlint
  - `pre-push`: `tsc --noEmit`
- [ ] `commitlint.config.ts` — extends `@commitlint/config-conventional`
- [ ] `lint-staged` config in `package.json`

#### Testing
- [ ] Vitest config — `environment: "happy-dom"`, setup file, 100% coverage thresholds enforced, `vite-tsconfig-paths` plugin
- [ ] `tests/setup.ts` — imports `@testing-library/jest-dom/vitest`, MSW server setup
- [ ] `tests/mocks/handlers.ts` — empty handlers array to start
- [ ] `tests/mocks/server.ts` — MSW node server
- [ ] Playwright config — `@axe-core/playwright` for accessibility checks

#### UI & Theme
- [ ] Storybook config — `@storybook/nextjs`, `@storybook/addon-a11y`, `@storybook/addon-interactions`
- [ ] `src/app/layout.tsx` — `ThemeProvider` with `defaultTheme="dark"`, `attribute="class"`
- [ ] `src/lib/utils.ts` — `cn()` helper using `clsx` + `tailwind-merge`
- [ ] `src/components/ui/` directory — empty, ready for components

#### Infrastructure
- [ ] `src/lib/logger.ts` — Pino logger instance
- [ ] `src/lib/redis.ts` — Upstash Redis client (if using rate limiting or caching)
- [ ] `src/lib/stripe.ts` — Stripe server client (if monetized)
- [ ] `src/db/` — Drizzle schema + client (if relational) or MongoDB client + schemas (if non-relational)
- [ ] Auth.js v5 setup — `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `middleware.ts` (if auth needed)
- [ ] Sentry — `instrumentation.ts` with `register()` function
- [ ] Vercel Analytics — `<Analytics />` and `<SpeedInsights />` in root layout (if deploying to Vercel)

#### CI & Publishing
- [ ] `.github/workflows/ci.yml` — check job + e2e job, see TEMPLATES.md's 'GitHub Actions CI' section
- [ ] `.github/dependabot.yml` — npm + github-actions, weekly schedule
- [ ] `gh label create in-progress` once the GitHub repo exists — tracking runs on its issues
- [ ] If published package: `tsup.config.ts`, Changesets init, `src/index.ts` barrel export

#### Published Package Extra (if applicable)
- [ ] `tsup.config.ts` — ESM + CJS + dts, external react/react-dom
- [ ] `pnpm changeset init`
- [ ] `.github/workflows/release.yml` — Changesets action
- [ ] Update `package.json` exports map and `files: ["dist", "src"]`

### Tauri (desktop)

Derived from strate's scaffold (strate#9, PR #28). Package manager + runtime is Bun (#80) — never npm, yarn, or pnpm.

- [ ] `git init`; branch `feat/initial-setup`; `.gitignore` (`node_modules/`, `.env`, `.env.local`, `.env.*.local`, `dist/`, `coverage/`, `target/`, `*.log`); `.env.example`
- [ ] `bun init` → `package.json` (`packageManager: "bun@<pinned>"`, `engines.bun`, `trustedDependencies: []`); `bunfig.toml` with `[install] minimumReleaseAge = 86400` (supply-chain hold) and `[run] bun = true` so every script/bin runs on Bun, no Node needed
- [ ] Vite + React; `tsconfig.json` strict; Tailwind v4 via `@tailwindcss/vite` on the `@crawfordyoung/ui` preset
- [ ] `vitest.config.ts` — 100% coverage thresholds; `@testing-library/react` + `happy-dom`
- [ ] `src-tauri/` — `Cargo.toml`, `tauri.conf.json` (set `identifier`, CSP), `build.rs`, `capabilities/`, `icons/`
- [ ] Root `Cargo.toml`: `[workspace]` (`members`, `resolver = "3"`) + `[workspace.package]` (`edition = "2024"`, `rust-version = "1.90"`); `rust-toolchain.toml` (`channel = "stable"`, components `rustfmt`, `clippy`)
- [ ] ESLint + Prettier; Husky (`pre-commit` lint-staged, `commit-msg` commitlint — no `pre-push` hook); `commitlint.config.ts`
- [ ] `.github/workflows/ci.yml` on `windows-latest`: `oven-sh/setup-bun@v2`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2` → `bun ci`, `bun audit --audit-level=high`, typecheck, lint, test, **`bun run build` before any cargo step** (`generate_context!` embeds `dist/`), `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- [ ] `.github/dependabot.yml` — bun + cargo + github-actions

**Final gate (Tauri):** `bun run typecheck && bun run lint && bun run test && bun run build && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && bun run tauri build --debug --no-bundle`

---

## Final Steps

1. Run `just check` (Next.js) or the Tauri final gate above — must pass before the branch is ready
2. Write the first failing test for the first real feature
3. Commit everything on `feat/initial-setup` (do not push until user approves)
4. Present a summary of what was created and what the user needs to fill in (env vars, etc.)

---

## Report

```
Project: <name>
Type: <Next.js | FastAPI | published package | Tauri desktop>
Branch: feat/initial-setup

Setup complete:
✓/✗ Foundation (git, gitignore, env.example)
✓/✗ Config files (see the chosen path's checklist)
✓/✗ Code quality (lint, format, git hooks, commitlint)
✓/✗ Testing (see the chosen path's checklist)
✓/✗ CI/CD (ci.yml, dependabot.yml)
✓/✗ Final gate passing (`just check` for Next.js; the Tauri final gate for Tauri)

Action required from user:
- Fill in .env with: <list required env vars>
- <any other manual steps like Neon DB creation, Vercel linking, etc.>
```
