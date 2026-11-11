# CLAUDE.md — Web Domain Standards

Applies to every repo under `~/code/web/`. Primary stack is Next.js fullstack (App Router); Python/FastAPI for standalone backend services.

> **Companion references** — load on demand, not by default:
> - [`../docs/web/STACK.md`](../docs/web/STACK.md) — full stack tables, Published Package setup
> - [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) — copy-paste-ready code patterns
> - [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md) — CI yaml, Justfile, security headers, structure
> - [`../docs/web/ENV.md`](../docs/web/ENV.md) — env var conventions
> - [`../docs/web/COMPONENT-LIBRARY.md`](../docs/web/COMPONENT-LIBRARY.md) — Radix+CVA component guide
> - [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md) — full TypeScript style guide
> - [`../docs/brand/`](../docs/brand/) — brand identity, design system, motion; load before any artifact or design output — tokens, type and radius in `brand-identity.md`, spacing, elevation and icons in `design-system.md`

## Stack (verified: 2026-10, #80)

| Concern | Tool |
|---|---|
| Framework | Next.js (App Router) — Server Components by default |
| Language | TypeScript 5→6 til #111; TS7 waits on typescript-eslint <6.1.0 strict — no `any`, no `@ts-ignore` without justification |
| Styling | Tailwind CSS; UI primitives Radix UI + CVA (shadcn-inspired, owned) |
| Dark mode | next-themes — `defaultTheme="dark"`, `darkMode: "class"` |
| Package manager | Bun (pm+runtime); `pnpm-lock.yaml`→pnpm til #110 · Task runner Justfile (required per repo) |
| Database | Neon + Drizzle (relational) or MongoDB native driver |
| Auth | Auth.js v5 |
| Testing | Vitest (`bun run test`, not `bun test` — its thresholds skip branches/statements) + Playwright E2E |
| Logging / errors | Pino (never `console.log`) · Sentry in production |
| Deploy | Vercel · Conventional Commits via commitlint |

## Architecture principles

- **No monorepos** — shared code is a published package.
- **Server-first** — RSC by default; `"use client"` only for browser APIs or interactivity; Server Actions for mutations, API routes only for external consumers.
- **TanStack Query for client async state; Zustand for UI state only.**
- `@/` path alias — never deep relative imports. Run the `simplify` skill after every implementation pass.

## Server boundaries (security-critical)

- `'use server'` files export ONLY async functions; every export is a client-callable POST endpoint — identity derives from `auth()` INSIDE the function, never from parameters. State this threat model in any brief touching those files.
- A client component never VALUE-imports a module transitively reaching server-only env (`import type` is safe) — extract client-shared primitives into a pure module.
- **Canonical origin is a published fact, not an env knob:** hardcode `SITE_URL` in a coverage-counted module, pin `metadataBase` to it, ship an `openGraph` block, and e2e-assert `og:url === SITE_URL` — the three are one unit, and absence has nothing to grep. Env-derived origins survive only in outbound third-party redirects.

## Definition of Done

- [ ] Vitest at the repo's own `vitest.config.ts` thresholds, all four metrics
- [ ] Playwright E2E green · TypeScript zero errors · ESLint + Prettier clean
- [ ] Storybook builds; every `ui/` component has a story
- [ ] Lighthouse 100×4 (dark + light) against a production build; documented deviations carry, don't re-litigate. Attribute a low score before treating it as wave scope — rerun on an untouched route.
- [ ] axe zero violations in BOTH themes — per-surface jest-axe AND one browser-axe sweep per new/reshaped route (component-level green is not page-level green)
- [ ] Manual hands-on pass for interactive UI — drive the real feature in a browser
- [ ] Sentry reporting · Dependabot present

## Gates in practice

- After any rebase touching `package.json`: reinstall via the repo's package manager.
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
- Windows: killing a backgrounded dev-server wrapper leaves the child process serving the stale build — kill the port holder.
