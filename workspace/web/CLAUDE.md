# CLAUDE.md — Web Domain Standards

**Inherits:** `~/code/CLAUDE.md`. Applies to every repo under `~/code/web/`. Primary stack is Next.js fullstack (App Router); Python/FastAPI for standalone backend services.

> **Companion references** — load on demand, not by default:
> - [`../docs/web/STACK.md`](../docs/web/STACK.md) — full stack tables, Published Package setup
> - [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) — copy-paste-ready code patterns
> - [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md) — CI yaml, Justfile, security headers, structure
> - [`../docs/web/ENV.md`](../docs/web/ENV.md) — env var conventions
> - [`../docs/web/COMPONENT-LIBRARY.md`](../docs/web/COMPONENT-LIBRARY.md) — Radix+CVA component guide
> - [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md) — full TypeScript style guide
> - [`../docs/web/TESTING-TRAPS.md`](../docs/web/TESTING-TRAPS.md) — **hand-load before writing tests or QA for interactive UI** (the unit-green/live-broken bug family)
> - [`../docs/brand/`](../docs/brand/) — brand identity, design system, motion
> - `visual-asset-gates` skill — preview gate, asset pipelines, theme work

## Stack (key decisions)

| Concern | Tool |
|---|---|
| Framework | Next.js (App Router) — Server Components by default |
| Language | TypeScript strict — no `any`, no `@ts-ignore` without justification |
| Styling | Tailwind CSS; UI primitives Radix UI + CVA (shadcn-inspired, owned) |
| Dark mode | next-themes — `defaultTheme="dark"`, `darkMode: "class"` |
| Package manager | pnpm · Task runner Justfile (required per repo) |
| Database | Neon + Drizzle (relational) or MongoDB native driver |
| Auth | Auth.js v5 |
| Testing | Vitest + Playwright E2E (`webServer: pnpm dev`) |
| Logging / errors | Pino (never `console.log`) · Sentry in production |
| Deploy | Vercel · Conventional Commits via commitlint |

## Architecture principles

- **No monorepos** — shared code is a published package.
- **Server-first** — RSC by default; `"use client"` only for browser APIs or interactivity; Server Actions for mutations, API routes only for external consumers.
- **TanStack Query for client async state; Zustand for UI state only; Zod at all system boundaries.**
- **Dark mode by default** — designed and tested dark-first, both themes verified.
- `@/` path alias — never deep relative imports. Run the `simplify` skill after every implementation pass.

## Server boundaries (security-critical)

- `'use server'` files export ONLY async functions; every export is a client-callable POST endpoint — identity derives from `auth()` INSIDE the function, never from parameters. State this threat model in any brief touching those files.
- A client component never VALUE-imports a module transitively reaching server-only env (`import type` is safe) — extract client-shared primitives into a pure module.
- **Canonical origin is a published fact, not an env knob:** hardcode `SITE_URL` in a coverage-counted module, pin `metadataBase` to it, ship an `openGraph` block, and e2e-assert `og:url === SITE_URL` — the three are one unit, and absence has nothing to grep. Env-derived origins survive only in outbound third-party redirects.

## Definition of Done

- [ ] Vitest at the repo's OWN thresholds — **`vitest.config.ts` is the authority; read it before quoting a number.** Read all four metric lines.
- [ ] Playwright E2E green · TypeScript zero errors · ESLint + Prettier clean
- [ ] Storybook builds; every `ui/` component has a story
- [ ] Lighthouse 100×4 (dark + light) against a production build; documented deviations carry, don't re-litigate. Attribute a low score before treating it as wave scope — rerun on an untouched route.
- [ ] axe zero violations in BOTH themes — per-surface jest-axe AND one browser-axe sweep per new/reshaped route (component-level green is not page-level green — TESTING-TRAPS.md)
- [ ] Manual hands-on pass for interactive UI — drive the real feature in a browser
- [ ] Sentry reporting · Dependabot present · no dead code · `.gitignore`/`.env.example` current
- [ ] Repo README + CLAUDE.md updated; reflect prompted at wave close

**A scaffold-era repo runs one full first-boot gate battery before its first feature wave** (build, dev boot, every gate, CI on a trivial PR) — a gate that has never run hides its whole blocker stack.

## Gates in practice

- `just check` composition differs per repo — read the recipe (or `qa.mjs --list`) before quoting a gate as covering anything; run e2e with an explicit `PORT` and verify the port holder first.
- After any rebase touching `package.json`: `pnpm install` before gates. A fresh worktree needs `pnpm exec playwright install chromium` before its first e2e.
- Browser e2e rendering time-sensitive UI pins `timezoneId` — CI runs UTC.

## TypeScript style (the four rules checked on every PR)

1. Interfaces over type aliases for object shapes
2. `readonly` on immutable properties
3. Explicit return types on exported functions
4. No magic numbers — named constants for literals used in logic

Prettier owns formatting. Full guide → TYPESCRIPT-STYLE.md.

## Recurring trap one-liners

- No Tailwind text-opacity modifiers for hierarchy (fails WCAG AA) — full tokens or a defined darker step.
- Next `next/image`: pass `fetchPriority="high"` explicitly on the LCP image; audit `next/font` registrations against use.
- SVG geometry attrs reject CSS `calc()` silently — `%`/numeric only, and visually verify SVG components.
- OIDC scope overrides REPLACE the default set — re-include `openid`, and test that it survives.
- CSP `form-action` covers the whole redirect chain and the console error names the wrong host — prefer client-side `signIn()`; verify the served header after any CSP edit.
- Windows: killing a backgrounded `pnpm start` wrapper leaves the node child serving the stale build — kill the port holder.

## Dependencies

- Policy: `~/code/.claude/rules/dependencies.md` (latest-stable-major, standalone housekeeping PRs).
- `pnpm audit` in CI, no high/critical. Transitive overrides: pin EXACT inside the consumer's declared range, why-comment the GHSA + drop condition (pnpm 11: overrides live in `pnpm-workspace.yaml`).
- Toolchain majors: check the Node floor against CI's `node-version` AND `engines`; read the host tool's migration guide, not just peer ranges — bundled plugins break independently.
- Playwright bumps pin new browser builds — `playwright install chromium` is part of the bump.

## Design system

Compact token reference for artifact/design output. Authority: `docs/brand/design-system.md` — on conflict, that file wins.

- Accent (emerald, both modes): `--accent #10b981` · hover `#34d399` · active `#6ee7b7` · subtle `#d1fae5` light / `#022c22` dark.
- Neutrals (zinc): light `--background #ffffff` / `--surface #fafafa` / `--surface-raised #f4f4f5` / `--border #e4e4e7` / `--foreground #09090b`; dark `#09090b` / `#18181b` / `#27272a` / `#27272a` / `#fafafa`.
- Status: `--destructive #dc2626` · `--success #22c55e` · `--warning #f59e0b` · `--info #0ea5e9`.
- Type: Geist Sans (UI), Geist Mono (code/stats/dates). Display `text-7xl–9xl font-bold -0.04em`; Headline `text-3xl–4xl font-semibold -0.02em`; Body `text-base leading-relaxed`; Micro `text-xs font-medium uppercase 0.04em`.
- Radius: `--radius-sm 0.25rem` · `--radius 0.5rem` · `--radius-lg 0.75rem` · `--radius-xl 1rem` · full `9999px`.
- Spacing: component internals `1 1.5 2 3 4`; layout gaps `4 6 8 12 16 24` — nothing off-scale.
- Elevation = surface step + shadow together. Icons: Lucide only, 16px dominant. Dark-first, semantic tokens only, no true `#000`/`#fff` surfaces.
