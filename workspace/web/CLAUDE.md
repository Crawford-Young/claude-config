# CLAUDE.md — Web Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules). Adds the web stack; overrides only where explicitly stated. Applies to every repo under `~/code/web/`.

> **Primary stack**: Next.js fullstack (App Router). Python/FastAPI for standalone backend services.

> **Companion references** — load on demand, not by default:
> - [`../docs/web/STACK.md`](../docs/web/STACK.md) — full stack tables, Published Package setup (scaffolding/tool choice)
> - [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) — copy-paste-ready code patterns (feature implementation)
> - [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md) — CI yaml, Justfile, security headers, project structure (scaffolding)
> - [`../docs/web/ENV.md`](../docs/web/ENV.md) — env var conventions
> - [`../docs/web/COMPONENT-LIBRARY.md`](../docs/web/COMPONENT-LIBRARY.md) — Radix+CVA component guide (UI work)
> - [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md) — full TypeScript style guide
> - [`../docs/claude-api-reference.md`](../docs/claude-api-reference.md) — Claude API capabilities (LLM features)
> - [`../docs/brand/`](../docs/brand/) — brand identity + design system + motion (`brand-identity.md` tokens/colors, `design-system.md` layout/states, `motion.md` transitions/animation)
> - `visual-asset-gates` skill — preview gate, asset pipelines, theme work
> - `live-qa-traps` skill — unit-green/live-broken bug family (before tests/QA for interactive UI)

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
| Testing | Vitest (thresholds PER-REPO — read `vitest.config.ts`, see Definition of Done) + Playwright E2E (`webServer: pnpm dev` — never `build && start`, unreliable cross-platform) |
| Logging | Pino — never `console.log` |
| Error monitoring | Sentry — required for production |
| Deployment | Vercel |
| Commits | Conventional Commits — enforced by commitlint |

> Full tool list → [`../docs/web/STACK.md`](../docs/web/STACK.md)

---

## Architecture Principles

- **No monorepos** — every service in its own repo; shared code is a published package
- **Server-first** — default RSC; `"use client"` only for browser APIs or interactivity
- **Server Actions for mutations** — API Routes only for externally-consumed endpoints
- **TanStack Query for client async state** — all client-side fetching, polling, pagination
- **Zustand for UI state only** — never as a data cache
- **Zod at all system boundaries** — Server Actions, API routes, forms, env vars, DB docs, external API responses
- **Dark mode by default** — every component designed and tested in dark mode first

**A canonical origin is a published fact about the host, not a per-env knob.** Hardcode `SITE_URL` in a coverage-counted `src/lib/site-routes.ts`, pin `metadataBase` to it, assert `og:url === SITE_URL` in e2e — the only gate that catches this class, since locally the env value IS correct and every other gate passes while production advertises `og:url = http://localhost:3000`. **ABSENT canonical metadata is the same defect disguised** — an empty `curl | grep og:url` reads as clean. Env-derived origins survive only in OUTBOUND third-party redirects (Stripe `success_url` etc.), which differ per deployment — those become dashboard-verification items in the issue log, never silent assumptions. **Enumerate every consumer of an app-origin env var, not just metadata.** (2026-07-28/29 AdSense W1: localhost `og:url` shipped to production in one repo, no `metadataBase` at all in another; n=2 firm.) **`metadataBase` alone is NOT the fix — it only resolves RELATIVE URLs inside other metadata fields; with no `openGraph` block Next emits no `og:` tags and no canonical link at all.** The pin, the `openGraph` block, and the `og:url === SITE_URL` e2e assertion are one unit — a repo missing any of the three has not met this rule, and absence has nothing to grep. (W1b addendum: portfolio + tuner shipped pinned `metadataBase` + zero canonical metadata; caught by W1's own post-merge production verification.)

---

## Custom Component Library

Radix UI + Tailwind via CVA. Components are owned by the project (copied in, not a black box). Every `ui/` component: 100% test coverage, axe pass, Storybook story before it ships.

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

All rules in the `visual-asset-gates` skill — load before any visual/asset/preview-gate task.

### 3. Branch Strategy

- **After any rebase touching `package.json`/lockfile, `pnpm install` before gates** — stale node_modules type-checks against the old dep (2026-07-14: one wasted gate run).
- **A fresh worktree has no Playwright browsers** — `pnpm exec playwright install chromium` (~294 MB) before its first e2e, alongside the `.env`/`.env.local` copy. Budget per worktree (2026-07-28: hit in 4 of 5 clusters).
- **`just check` composition differs per repo — read the recipe before quoting a gate as coverage for anything.** Verified 2026-07-28: `instrumenttuner` = `typecheck lint test`, NO e2e (a new e2e spec never runs in its gate); `carsickyak-site` = the only repo running Storybook build + e2e; the portfolio's e2e passes no `PORT`, so `reuseExistingServer` drives a foreign dev server. Run every e2e segment with explicit `PORT=`; record each repo's actual gate in that repo's `CLAUDE.md`. **`reuseExistingServer` tests whatever answers the port — including YOUR OWN prod server left up from a preceding Lighthouse step**, not just foreign dev servers; kill the holder before `pnpm e2e`, and treat an implausibly fast suite (3–4× faster than usual) as the tell that the gate never drove the server it claims (2026-07-30 adsense-w2: prod server on the e2e port produced a fake green in 5.2s; n=1, provisional).

### 5. Pre-commit Hooks (Husky)

- **pre-commit**: lint-staged — ESLint + Prettier on staged TS/TSX
- **commit-msg**: commitlint
- **pre-push**: `tsc --noEmit`

### 6. Definition of Done

Nothing is "done" until all pass at 100%:

- [ ] Vitest — coverage at the repo's OWN thresholds. **`vitest.config.ts` is the authority — read it before quoting a number into a plan or brief.** Most repos are 100/100/100/100, but scheduling-advisor is 99/97/100/99 and creator-coach runs branches at 97. Read all four metric lines from the summary block. Where branches <100, the accepted gap is JSX inline arrows or structurally-unreachable TS-enforced fallbacks. (2026-07-27/28 username-w1 issue #2: a flat-100 claim here propagated into three agent briefs.)
- [ ] Playwright E2E — all scenarios passing
- [ ] TypeScript — zero errors (`tsc --noEmit`)
- [ ] ESLint + Prettier — zero errors or formatting diffs
- [ ] Storybook — builds; all `ui/` components have stories
- [ ] Lighthouse — 100 in all four categories (dark + light), against a production build (`pnpm build && pnpm start`, never dev). Accepted documented deviations: localhost-only artifacts (`/_vercel/insights/*` 404s cap Best Practices ~96) and LCP cost of intentional entry animations. When Lighthouse can't toggle theme, light-mode contrast is covered by axe — note the deviation, don't re-litigate per wave. **Attribute a sub-target perf score before treating it as a wave defect:** rerun Lighthouse against a route the wave never touched — a baseline at or below the wave's pages makes it pre-existing site debt to log and carry, not wave scope (2026-07-31 adsense-w3: untouched `/` scored 71 vs wave pages 74–77; n=1, provisional).
- [ ] axe — zero violations **in both themes** (dark-first development accumulates light-theme contrast debt silently — 2026-07-18: first light sweep found 3 pre-existing failures)
- [ ] Manual playthrough — for interactive/game UI, drive the real feature in the browser before calling it done (2026-06-30 duel: automation passed a missing HUD, two copy bugs, a contrast regression; a 2-minute playtest caught all four)
- [ ] Sentry — integrated and reporting (production deployments)
- [ ] Dependabot — `.github/dependabot.yml` present
- [ ] No dead code, unused imports, or commented-out blocks
- [ ] `.gitignore` up to date; `.env.example` current
- [ ] `docs/checklists/active/` checklist current; completed phase → `done/`
- [ ] README.md + CLAUDE.md in the repo updated
- [ ] `~/code/CLAUDE.md` + `~/code/docs/` updated if workspace conventions changed
- [ ] Phase boundary: **run `claude-md-management:reflect` at every wave close, BEFORE requesting push/PR** — reflect's repo-doc proposals commit to the wave branch and ship in the wave PR (reordered 2026-07-16 after a forced micro-docs PR).
- [ ] **Repo-level doc edits land in the wave branch BEFORE merge — never a second PR.** Wave-table status flips are written in the wave branch as post-merge truth; verify the version at publish. Only workspace/claude-config edits land separately — different repo, no bearing on the wave PR. (2026-07-01 PR #65; repeat 2026-07-16 PR #96.)

**A scaffold-era repo runs one full first-boot gate battery BEFORE its first feature wave** — `pnpm build`, a `pnpm dev` boot, typecheck, lint, test, e2e, Storybook build, and CI on a trivial PR (enumerate — `just check` composition differs per repo and omits gates). A gate that has never run hides its entire blocker stack, and the stack surfaces at the worst time (the final DoD task). n=2, single repo (provisional across repos): creator-coach SP1 (`.env` never populated — invisible until the first boot attempt at the last task) and W0 2026-08-08 (five never-exercised-gate blockers stacked at T7: eslint scanning `.next/`, dead Upstash env validation, dead Storybook scaffold, no `just` installer in CI, `AUTH_SECRET` missing in CI).

**A per-component jest-axe pass is not a page-level zero** — component tests are structurally blind to shared chrome (topbar, sidebar, landmarks), theme-dependent contrast in tokens the component doesn't own, and ARIA references crossing component boundaries. A wave adding or reshaping a user-facing surface owes BOTH: (1) a per-surface jest-axe test — real child components, not mocked stand-ins, rendered inside the landmark the page actually uses (a bare fragment trips `region` on the harness, not the component); and (2) one browser-axe sweep of the new route in both themes — the only gate that sees what (1) cannot. Sweep lane: inject `node_modules/.pnpm/axe-core@<ver>/node_modules/axe-core/axe.min.js` into real Chromium (the plain `node_modules/axe-core/…` path ENOENTs under pnpm); the sweep script itself must sit INSIDE the repo — its `@playwright/test` import resolves from the script's own location, so a scratchpad copy ERR_MODULE_NOT_FOUNDs — delete it before commit (2026-07-31 adsense-w3). **Theme flip in a sweep: with next-themes `enableSystem={false}` (the workspace default), Playwright `colorScheme` emulation is inert — both "themes" audit the default class.** Flip via `localStorage.setItem('theme', …)` in an init script and ASSERT the applied `html.class` per run; a sweep that can't show the class it audited proves nothing about the other theme (2026-07-30 adsense-w2: pre-existing `axe-duel.mjs` light pass audited dark its whole life — structural fact of the library, not a flake). Sweep hits on untouched routes are pre-existing debt, not wave scope: confirm on a route the wave never touched, log, carry. (2026-07-29 friends-w1 issue #6: a critical `aria-valid-attr-value` on every `(app)` page + two light-theme contrast failures survived several waves of green component-level axe.)

Run `superpowers:verification-before-completion` before declaring anything done.

---

## TDD Requirement

**Vitest patterns and the unit-green/live-broken bug family** live in the `live-qa-traps` skill — load before writing tests or QA for any interactive UI.

---

## TypeScript Style

The four rules most commonly violated — check on every PR:

1. **Interfaces over type aliases** for object shapes — `interface Foo {}` not `type Foo = {}`
2. **`readonly` on immutable properties**
3. **Explicit return types on exported functions**
4. **No magic numbers** — every numeric literal used in logic gets a named constant

Prettier owns formatting — when Prettier conflicts with the Google style guide, Prettier wins.

> Full guide → [`../docs/web/TYPESCRIPT-STYLE.md`](../docs/web/TYPESCRIPT-STYLE.md)

---

## Code Quality

**Universal rules:**
- **Browser e2e rendering time-sensitive UI pins `timezoneId` in the Playwright config** — CI runs UTC; fixtures straddling UTC midnight render differently there, so gates pass locally and fail in CI or vice versa (2026-07-08 lib w2.4L).
- **No Tailwind opacity modifiers (`/40`–`/70`) on text for hierarchy** — drops below WCAG AA 4.5:1 at small sizes, fails axe/Lighthouse. Use full tokens (`text-muted-foreground`) or a defined darker step. Opacity on non-text decoration is fine. (3× in one feature, 2026-06-30.)
- **Next 16 `next/image`: `priority` alone no longer emits `fetchpriority="high"`** — pass `fetchPriority="high"` explicitly on the LCP image (2026-07-24: perf 72→88 from this one attr; SSR keeps the camelCase attr — case-sensitive greps miss it). Feed/grid pages whose first card is the LCP need an above-fold `priority` window from the start. Audit `next/font` registrations against actual usage at scaffold review — an unused font preloads ~49KB on every page forever.
- **Windows: `TaskStop` on a backgrounded `pnpm start` kills the pnpm wrapper, NOT the node child** — the port keeps serving the STALE build (EADDRINUSE on restart is the tell). Kill the port holder first: `netstat -ano | findstr :PORT` → `taskkill //F //PID <pid>` (2026-07-24: one stale Lighthouse run burned).
- Always `@/` path alias — never relative paths traversing more than one level.
- Run `simplify` skill after every implementation pass.
- **`'use server'` files may export ONLY async functions** — a non-async export passes vitest/tsc/unauthenticated e2e, then 500s every authenticated page importing it at runtime. Shared constants/types live in a schema/lib file. Waves touching `'use server'` files get a non-async-export grep at review (w2.6 S3→S9).
- **Every exported async function of a `'use server'` file is a client-callable POST endpoint: identity derives from `auth()` INSIDE the function, never from parameters.** The grep checks form, not auth — `doThing(userId)` is an unauthenticated cross-user RPC that passes every syntactic rule. Plans and briefs for `'use server'` tasks state this threat model explicitly (2026-07-17 w3 A3: stating it in the brief produced correct auth-scoped code with zero redo).
- **A client component must never VALUE-import a module transitively reaching server-only env** — `import type` is erased and safe; a value import pulls the module graph into the client bundle and crashes every page ("Attempted to access a server-side environment variable on the client"). Extract client-shared primitives into a PURE core module (zod-only) that the server-env module re-exports. Briefs touching a module already flagged as an eager-env trap MUST cite the trap. (2026-07-17 chat wave B: fixed via pure module + a purity test with no env mock.)
- **SVG geometry attributes (`width`/`height`/`r`/`x`/`y`/`cx`/`cy`) silently reject CSS `calc()` — the element just doesn't render.** Use `%`/numeric lengths. jsdom renders no SVG layout, so all gates pass a component that draws nothing — add a unit assertion that geometry attrs are `%`/number, and always visually verify SVG components (2026-07-01 TraceBorder).
- **An inline-style position override displaces the library component's WHOLE class bundle for those concerns — inventory every property the classes carried, z-index especially.** Rendering a lib component `static` in a custom wrapper drops the stacking context its `fixed` classes provided; same family as twMerge re-sorting a copied token set (n=2, 2026-07-22 slot-w1).
- **Mocked-component prop assertions cannot catch a library overriding those props internally.** For interacting props (an enable flag changing how other props are read), read the shipped dist source at plan time and verify visible behavior at the Preview Gate — unit tests against a mock prove only that props were passed (2026-07-01 cybond: inverted sleep window through 100% coverage + two green reviews).
- **OIDC providers: overriding `authorization.params.scope` REPLACES the default scope set** — omit `openid` and the provider returns no `id_token`, so the OAuth callback 500s ("id_token property must be a string"). Any scope customization re-includes the provider's OIDC defaults, and a config test asserts `openid` survives the override (2026-08-08 creator-coach W0 T7, Twitch; n=1, provisional — Google et al. by extrapolation).
- **Chrome enforces CSP `form-action` across a form POST's WHOLE redirect chain, and the console error names the ORIGINAL action URL, never the violating hop** — an OAuth sign-in form needs every chain host allow-listed (Twitch: `id.twitch.tv`, `www.twitch.tv`, `auth.twitch.tv`), and the misdirecting error sends the fix to the wrong host. Client-side `signIn()` (fetch + JS navigation) is not governed by `form-action` — prefer it for OAuth entry points. After any CSP edit: restart the dev server AND confirm the served header (`curl -sI <url> | grep -i content-security-policy`) before the QA round — a round against an unverified header proves nothing (Next 15.5 dev served a stale policy post-edit; 2026-08-08 creator-coach W0 T7: 3 QA rounds, 2 partly against a stale server. n=1, provisional).

**Dependencies:**
- **`@ai-sdk/codemod` unusable on Windows** (spawnSync ENOBUFS, 5 attempts 2026-07-21). AI SDK major bumps = 100% manual: verify installed `dist/index.d.ts` export surface per consumed API, record a verification table, feed briefs pre-verified cites.
- **`file:` workspace packages + gitignored `dist/`:** pnpm copies dist at install time. After adding library exports: `just build` in the library → `pnpm install` in the consumer.
- **pnpm `minimumReleaseAge` silently skips same-day publishes** — `pnpm update` reports "Already up to date". Consuming a same-day lib release needs BOTH the exact version in `minimumReleaseAgeExclude` AND a `^<new>` floor in package.json, so a skip fails loudly (2026-07-22: skipped twice).

**Security:**
- Hardened security headers in `next.config.ts`
- `pnpm audit` in CI — no high/critical vulnerabilities
- **Transitive vuln override:** `npm show <pkg> version` → pin exact latest in `pnpm.overrides` (never a range) → `pnpm install` → `pnpm audit` to confirm. A red audit gate may be a same-day advisory, not the PR — check the advisory publish date before hunting the diff (2026-06-12).
- **npm retired classic audit endpoints 2026-07-14 (HTTP 410)** — pnpm 10 `pnpm audit` fails in every CI. Interim: `pnpm dlx pnpm@11 audit --audit-level=high`. Proper fix per repo: standalone pnpm-11 housekeeping PR (pnpm 11 drops the `package.json` `pnpm` field — `pnpm.overrides` must migrate with it).

> Implementation patterns → [`../docs/web/PATTERNS.md`](../docs/web/PATTERNS.md) | ESLint/CI/Justfile/structure → [`../docs/web/TEMPLATES.md`](../docs/web/TEMPLATES.md)
