# CLAUDE.md — Web Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules — workflow, git, planning discipline, security). This file adds the web stack on top and overrides it only where explicitly stated.

Applies to every repo under `~/code/web/`.

> **Primary stack**: Next.js fullstack (App Router). Python/FastAPI for standalone backend services.

> **Companion references** — load on demand, not by default:
> - [`../docs/web/STACK.md`](../docs/web/STACK.md) — full stack tables, Published Package setup (load when scaffolding or choosing tools)
> - [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) — copy-paste-ready code patterns (load when implementing a feature)
> - [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md) — project boilerplate: CI yaml, Justfile, security headers, project structure (load when scaffolding)
> - [`../docs/web/ENV.md`](../docs/web/ENV.md) — environment variable conventions (load when setting up env or .env.example)
> - [`../docs/web/COMPONENT-LIBRARY.md`](../docs/web/COMPONENT-LIBRARY.md) — Radix+CVA component guide (load when building UI)
> - [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md) — full TypeScript style guide with real-world examples
> - [`../docs/brand/`](../docs/brand/) — brand identity + design system + motion (cross-domain; load `brand-identity.md` for tokens/colors, `design-system.md` for layout/states/composition, `motion.md` for transitions/loading/animation)

---

## Stack (key decisions)

| Concern | Tool |
|---|---|
| Framework | Next.js (App Router) — Server Components by default |
| Language | TypeScript strict — no `any`, no `@ts-ignore` without justification |
| Styling | Tailwind CSS — no CSS modules or styled-components |
| Dark mode | next-themes — `defaultTheme="dark"`, `darkMode: "class"` |
| UI primitives | Radix UI + CVA — custom component library, shadcn/ui-inspired |
| Package manager | pnpm — never npm or yarn |
| Task runner | Justfile — required in every repo |
| Database | Neon + Drizzle (relational) or MongoDB native driver (document) |
| Auth | Auth.js v5 — free, self-hosted, Drizzle adapter |
| Testing | Vitest (100% coverage) + Playwright E2E (`webServer: pnpm dev` — never `pnpm build && pnpm start`, unreliable cross-platform) |
| Logging | Pino — never `console.log` |
| Error monitoring | Sentry — required for production |
| Deployment | Vercel |
| Commits | Conventional Commits — enforced by commitlint |

> Full tool list with notes → [`../docs/web/STACK.md`](../docs/web/STACK.md)

---

## Architecture Principles

- **No monorepos** — every service in its own repo; shared code is a published package
- **Server-first** — default RSC; `"use client"` only for browser APIs or interactivity
- **Server Actions for mutations** — API Routes only for externally-consumed endpoints
- **TanStack Query for client async state** — all client-side fetching, polling, pagination
- **Zustand for UI state only** — never as a data cache
- **Zod at all system boundaries** — Server Actions, API routes, forms, env vars, DB docs, external API responses
- **Dark mode by default** — every component designed and tested in dark mode first

---

## Custom Component Library

Built on Radix UI + Tailwind via CVA. Components are owned by the project (copied in, not installed as a black box). Every `ui/` component requires 100% test coverage, axe pass, and a Storybook story before it ships.

```
src/components/
  ui/               # Radix-based primitive components
  [feature]/        # Composed feature components
stories/
  ui/               # One .stories.tsx per ui/ component
```

> Full guide → [`../docs/web/COMPONENT-LIBRARY.md`](../docs/web/COMPONENT-LIBRARY.md)

---

## Workflow

### 2. Visual / Token Work — Preview Gate

For any color, token, or design system change: open Storybook first, verify dark + light mode visually, then write tests. Token changes are visual — they need eyes before engineering.

**Playwright screenshots taken before hydration completes can fabricate React hydration-mismatch console errors** — `screenshot()` defaults `caret: 'hide'`, injecting `caret-color: transparent` into focusable inputs mid-SSR; React then reports a mismatch that no real browser produces. Console-cleanliness assertions in capture scripts must screenshot only after `networkidle`, or pass `caret: 'initial'`. (2026-07-21 motion-pass: flaky error perfectly correlated with screenshot-during-load across 5 runs; cost a full root-cause hunt.)

A running-app Preview Gate starts with **apply pending DB migrations to the dev database** — a wave that added a migration but never ran it opens the gate on an error page and burns a debugging cycle on a non-bug. (2026-07-01 cybond: migration 0010 unapplied → "Failed to load calendar" at gate open.) On Windows, `drizzle-kit migrate` can die silently (websocket driver, no error output) — fall back to a one-off script using drizzle-orm's `neon-http` migrator, which updates the journal identically.

**Playwright MCP is single-instance across concurrent sessions** — a second session gets "Browser is already in use". Fallback that keeps real eyes + real artifacts: eyeball via claude-in-chrome, then capture PNGs with a small `chromium` script (`import { chromium } from '@playwright/test'`, `addInitScript` for theme localStorage) placed INSIDE the target repo (e.g. `node_modules/.cache/`) so module resolution works — save to the docs screenshots path, delete the script after. (2026-07-16 eb3: full preview gate ran this way, both themes verified.)

### 3. Branch Strategy

- **After any rebase that changes `package.json`/lockfile, run `pnpm install` before gates** — stale node_modules type-checks against the old dep and fails tsc on APIs the rebased code consumes. (2026-07-14: wave-A rebase brought main's 0.21.0 consume code; installed 0.20.0 lacked `recurrenceEditMode`, one wasted gate run.)

### 5. Pre-commit Hooks (Husky)

- **pre-commit**: lint-staged — ESLint + Prettier on staged TS/TSX
- **commit-msg**: commitlint
- **pre-push**: `tsc --noEmit`

### 6. Definition of Done

Nothing is "done" until all pass at 100%:

- [ ] Vitest — 100% coverage (statements, functions, lines); branches ≥97% acceptable when gap is JSX inline arrow functions or TypeScript-enforced defensive fallbacks that are structurally unreachable
- [ ] Playwright E2E — all scenarios passing
- [ ] TypeScript — zero errors (`tsc --noEmit`)
- [ ] ESLint + Prettier — zero errors or formatting diffs
- [ ] Storybook — builds; all `ui/` components have stories
- [ ] Lighthouse — 100 in all four categories (dark + light mode), run against a production build (`pnpm build && pnpm start`, never dev). Accepted documented deviations: localhost-only artifacts (e.g. `/_vercel/insights/*` 404s cap Best Practices ~96 — they resolve on Vercel deploys) and LCP cost of intentional entry animations. When Lighthouse can't toggle theme (next-themes localStorage), light-mode contrast is covered by axe instead — note the deviation in the checklist, don't re-litigate it per wave.
- [ ] axe — zero violations **in both themes** (dark-first development lets light-theme contrast debt accumulate silently — 2026-07-18: first-ever light sweep found 3 pre-existing failures incl. a library token consumed as text at ~2.5:1)
- [ ] Manual playthrough — for interactive/game UI, drive the real feature end-to-end in the browser before calling it done. Automated coverage + axe + Lighthouse all passed a missing HUD, two copy bugs, and a contrast regression that a 2-minute playtest caught (2026-06-30, duel)
- [ ] Sentry — integrated and reporting (production deployments)
- [ ] Dependabot — `.github/dependabot.yml` present
- [ ] No dead code, unused imports, or commented-out blocks
- [ ] `.gitignore` up to date; `.env.example` current
- [ ] `docs/checklists/active/` checklist current; completed phase moved to `docs/checklists/done/`
- [ ] README.md + CLAUDE.md in the repo updated
- [ ] `~/code/CLAUDE.md` + `~/code/docs/` updated if workspace conventions changed
- [ ] Phase boundary: **run `claude-md-management:reflect` — mandatory at every wave close, BEFORE requesting push/PR** (after final task + user QA, wave branch still open). Reflect's repo-doc proposals commit to the wave branch and ship in the wave PR. (Reordered 2026-07-16 w3L: post-merge reflect forced micro-docs PR #96.)
- [ ] **Repo-level doc edits land in the wave branch BEFORE merge — never in a second PR.** If a QA round or reflect surfaces a repo-file change (repo `README.md`/`CLAUDE.md`, tests, config), commit it to the still-open wave branch — reflect IS the pre-merge doc beat. Wave-table status flips are written in the wave branch as the post-merge truth ("Merged to main (vX)") — they become true at merge; verify the version at publish and correct in the next wave's branch if a concurrent wave stole it. Only workspace/`claude-config` edits (junctioned `~/code/CLAUDE.md`, `docs/`) land separately — they're a different repo with no bearing on the wave PR. (2026-07-01: reflect's `component-library/CLAUDE.md` notes surfaced after PR #65 merged → forced a follow-up docs PR. 2026-07-16: repeat — PR #96.)

Run `superpowers:verification-before-completion` before declaring anything done.

---

## TDD Requirement

**Vitest patterns:**
- Mocking `auth()` returning null: `vi.mocked(auth).mockResolvedValueOnce(null as never)` — `null as never` required because `auth` has middleware + callback overloads; plain `null` fails type-check.
- Component mocks (dialogs especially) must render the DATA props they receive (dates, times, ids as visible text/attrs), not just component identity — identity-only mocks have hidden real contract bugs (2026-06-10: full datetime passed where date-only was required; test passed, save silently wiped data).
- Structurally unreachable guard statements (e.g. `if (!x) return` where render conditions guarantee `x`) block the 100%-statements gate — restructure as a statement-free JSX inline guard (`{x && handler(x)}`); the untaken branch then falls under the DoD branch exemption.
- Tests for user-facing copy must assert the INTENDED wording, written independently — not whatever the component currently renders. A test written to match the rendered output locks in the bug: "P1 's turn" (stray space) was asserted by 3 unit tests + 1 e2e, all green, and only a manual playtest caught it (2026-06-30). When changing any user-facing string, grep ALL test directories for the old text including `e2e/` — `src/__tests__` alone misses Playwright specs.
- Any widget that fetches-and-caches state on mount AND unmounts on close (popups, drawers, panels) needs an explicit close→reopen test asserting FRESH data renders after reopen. First-open tests alone pass a load-once guard that serves stale state on every reopen — 18 green tests + a clean review shipped exactly that; only live browser QA caught it (2026-07-15, chat popup `hasLoadedRef`).
- **Drag/pointer-capture UIs are a live-QA-only bug class.** happy-dom/jsdom click simulation does not reproduce pointer-capture click retargeting (a captured drag's release click targets the common ancestor of the pointerdown and pointerup targets — the capture element, not the button — so the button's `onClick` never fires after a real drag). Any consume-flag or click-gating logic keyed to that click passes unit tests while broken in every real browser; stale one-shot flags need their reset on the NEXT interaction's start (pointerdown), not in the click they gate. Live browser QA is the only gate for this class (2026-07-22, fab `pendingConsumeRef` — 4th user-caught bug of the "unit green, live broken" family with `hasLoadedRef`).

---

## TypeScript Style

The four rules most commonly violated — check on every PR:

1. **Interfaces over type aliases** for object shapes — `interface Foo {}` not `type Foo = {}`
2. **`readonly` on immutable properties** — if it's never reassigned, mark it `readonly`
3. **Explicit return types on exported functions** — callers should not need to hover
4. **No magic numbers** — every numeric literal used in logic gets a named constant

Prettier owns formatting — when Prettier conflicts with the Google style guide, Prettier wins.

> Full guide → [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md)

---

## Code Quality

**Universal rules:**
- **Browser e2e that renders time-sensitive UI pins `timezoneId` in the Playwright config** — host/CI TZ is never an assumption. CI (ubuntu) runs UTC; a fixture whose instants straddle UTC midnight renders differently there than on a local non-UTC machine, so gates pass locally and fail in CI (or vice versa). (2026-07-08, lib w2.4L C6: overnight story split in UTC viewers and failed axe contrast — local green was Eastern-TZ luck; fixed by `use.timezoneId` pin.)
- Never use Tailwind opacity modifiers (`/40`–`/70`) on text to create visual hierarchy — at small sizes they drop below the WCAG AA 4.5:1 floor and fail axe/Lighthouse. Use the full token (e.g. `text-muted-foreground`, ~7.9:1 on dark) or a defined darker step. Opacity on non-text decoration (gauge ticks, bar tracks) is fine. (Hit 3× in one feature, 2026-06-30 duel.)
- Always use `@/` path alias — never relative paths traversing more than one level
- Run `simplify` skill after every implementation pass
- **`'use server'` files may export ONLY async functions** — a non-async export (const, type re-export with value) passes vitest (module boundary mocked), tsc, and unauthenticated e2e, then 500s EVERY authenticated page importing it at runtime. Constants/types shared with a `'use server'` module live in a schema/lib file. Waves touching `'use server'` files get a non-async-export grep at review. (w2.6 S3→S9: `export const SERIES_SHARED_FIELDS` 500'd /calendar; no gate caught it.)
- **Every exported async function of a `'use server'` file is a client-callable POST endpoint: identity derives from `auth()` INSIDE the function, never from parameters.** The non-async-export grep checks form, not auth — a `doThing(userId)` signature is an unauthenticated cross-user RPC even though every syntactic rule passes. Plans and briefs for `'use server'` tasks state this threat model explicitly; review probes check it semantically. (2026-07-17 w3 A3: the PLAN specified `generateEvents(userId)`; implementer shipped it faithfully plus an exported helper trusting a caller-supplied row for DB writes — tsc, tests, and the async-only grep all green. Stating "every async export is a POST endpoint" in the A4 brief produced correct auth-scoped code with zero redo.)
- **A client component must never VALUE-import a module that transitively reaches server-only env** (e.g. `@/lib/ai` → `ANTHROPIC_API_KEY`). A `import type {...}` is erased and safe; a value import (`import { normalizeTier }`) pulls the whole module graph into the CLIENT bundle and crashes every page at render ("Attempted to access a server-side environment variable on the client"). Extract client-shared primitives (tier/config constants, schemas, normalizers) into a PURE core module (zod-only) that the server-env module re-exports; client components import from the core. A brief that adds a client value-import of a config primitive MUST route it through the pure module, and any brief touching a module already flagged as an eager-env trap MUST cite that trap (the orchestrate "Trap citations" rule). (2026-07-17 chat wave B: a Minor-fix brief value-imported `normalizeTier` from the `@/lib/ai`-importing `model-tiers.ts` into `ChatPopup` → crashed the app; the eager-env trap was a known-flagged housekeeping candidate the brief ignored. Fix: `model-tier-core.ts` pure module + a purity test with no env mock.)
- **SVG geometry attributes (`<rect width/height>`, `<circle r>`, `x`/`y`/`cx`/`cy`) silently reject CSS `calc()` — the element just doesn't render.** Use percentage or numeric lengths (`width="100%"`, `r="50%"` on an `overflow-visible` svg so the stroke straddles the edge). jsdom renders no SVG layout and axe checks only a11y, so 100% coverage + axe + tsc all pass a component that draws nothing — add a unit assertion that geometry attrs are `%`/number (not `calc`), and always visually verify SVG components. (2026-07-01: TraceBorder trace invisible on a button, every gate green.)
- **An inline-style position override displaces the library component's WHOLE class bundle for those concerns — inventory every property the classes carried, z-index especially.** Rendering a lib component `static` inside a custom-positioned wrapper (or overriding `position/left/top` inline) silently drops the stacking context its `fixed` variant's classes provided (`z-30` etc.), and the element paints under app overlays. Same family as twMerge re-sorting a copied className token set: replacing a class-carried style path always changes more than the property you targeted. (n=2 in one wave, 2026-07-22 slot-w1: fab under sleep shading + T12 token re-sort.)
- **Mocked-component prop assertions cannot catch a library overriding those props internally.** When wiring a library component whose props interact (an enable flag that changes how other props are read — e.g. `sleepEnabled=true` makes `WeekCalendarView` force a 24h grid and IGNORE `hourStart`/`hourCount`), read the shipped dist source for the interaction at plan time and verify the *visible behavior* at the Preview Gate. Unit tests against a mock only prove props were passed, not that they do anything. (2026-07-01 cybond: inverted sleep window shipped through 100% coverage + green two-stage reviews; only the Preview Gate caught it.)

**Dependencies:**
- **`@ai-sdk/codemod` is unusable on Windows** (spawnSync ENOBUFS on every invocation — 5 attempts, 2026-07-21 GS-P0 T2). Plan AI SDK major bumps as 100% manual migrations: verify the installed dist export surface (`dist/index.d.ts`) per consumed API at bump time, record a verification table, feed it to implementation briefs as pre-verified cites (zero NEEDS_CONTEXT across the GS-P0 4→7 triple-major this way).
- **`file:` workspace packages + gitignored `dist/`:** pnpm copies dist at install time, not a live symlink. After adding exports to a library: `just build` in the library → `pnpm install` in the consuming repo.

**Security:**
- Hardened security headers in `next.config.ts`
- `pnpm audit` in CI — no high/critical vulnerabilities
- **Transitive vuln override pattern:** `npm show <pkg> version` → pin exact latest in `pnpm.overrides` → `pnpm install` → `pnpm audit` to confirm zero remaining; never use a range (`>=x`) in overrides. A red audit gate may be caused by an advisory published the same day, not by the PR's changes - check the advisory publish date before hunting the diff (2026-06-12: esbuild GHSA landed mid-PR)
- **npm retired the classic audit endpoints 2026-07-14 (HTTP 410)** — `pnpm audit` on pnpm 10 fails in EVERY repo's CI regardless of diff. Interim CI fix: run the step as `pnpm dlx pnpm@11 audit --audit-level=high` (pnpm 11 uses the bulk advisory endpoint; applied scheduling-advisor ci.yml, ddd11a0). Proper fix per repo: standalone pnpm-11 housekeeping PR — pnpm 11 no longer reads the `package.json` `pnpm` field, so `pnpm.overrides` must migrate at the same time.

> Implementation patterns → [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) | ESLint setup, CI yaml, Justfile, project structure → [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md)
