# Stack Reference

Full tool list for all projects in `~/code`. Load this when scaffolding a new repo, choosing a tool, or comparing options.

---

## Frontend / Fullstack (primary)

| Concern | Tool | Notes |
|---|---|---|
| Framework | Next.js (App Router) | Server Components by default |
| Language | TypeScript (strict) | No `any`, no `@ts-ignore` without justification |
| Styling | Tailwind CSS | Utility-first; no CSS modules or styled-components |
| Dark mode | next-themes | `defaultTheme="dark"`; Tailwind `darkMode: "class"` |
| UI primitives | Radix UI | Foundation for the custom component library |
| Component library | Custom (Radix-based) | Owned per-project, shadcn/ui-inspired; developed in Storybook |
| Component docs | Storybook | Every `ui/` component has a story before it ships |
| Icons | Lucide React | Default icon library across all projects |
| Notifications | Sonner | Toast notifications; integrates with Radix portals |
| Validation | Zod | Runtime validation at all system boundaries |
| Env validation | t3-env | Type-safe env vars with Zod; crashes loudly on missing vars |
| Forms (simple) | Server Actions + Zod | Single-step forms with no complex client validation UX |
| Forms (complex) | React Hook Form + Zod resolver | Multi-step, conditional, or heavy client-side validation |
| Date utilities | date-fns | Lightweight, tree-shakeable; no global state |
| Client state | Zustand | Only for truly global UI state |
| Server/async state | TanStack Query | All async data fetching and mutation on the client |
| API layer | Server Actions (mutations) + RSC (queries) | API Routes only for externally-consumed endpoints |
| Fonts | next/font | Self-hosted; eliminates layout shift; required on all projects |
| Logging | Pino | Structured JSON logging; never `console.log` |
| Package manager | pnpm | Never npm or yarn |
| Task runner | Justfile | Required in every repo |
| Path alias | `@/` → `src/` | Standard in every project; configured in `tsconfig.json` and `next.config.ts` |
| Pre-commit hooks | Husky + lint-staged + commitlint | Lint, format, typecheck, enforce commit format |
| Commit format | Conventional Commits | `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `ci:`, `docs:` |
| Dependency updates | Dependabot | `.github/dependabot.yml` in every repo |

---

## Database & Auth

| Concern | Tool | Notes |
|---|---|---|
| Relational DB | Neon (serverless PostgreSQL) | Free tier generous; native Vercel integration |
| Non-relational DB | MongoDB (native driver) | Native driver + Zod for schema validation |
| ORM (relational) | Drizzle ORM | Type-safe, lightweight, zero runtime overhead |
| Auth | Auth.js v5 (NextAuth) | Free, self-hosted, Drizzle adapter available |
| Auth (alt) | Clerk | Free up to 10k MAU; faster to prototype with |

> **Relational vs non-relational**: Neon/Drizzle for structured relational data; MongoDB for document-oriented, schema-flexible, or deeply nested data. Never use both in the same service without a clear architectural reason.

> When a project is not expected to generate revenue, prefer the free tier of every service. Re-evaluate pricing tiers before launch when revenue is expected.

---

## Services & Infrastructure

| Concern | Tool | Notes |
|---|---|---|
| Rate limiting + caching | Upstash (Redis) | Free tier; one client for both concerns; Vercel Edge-compatible |
| Payments | Stripe | Standard for all monetized projects |
| Email | Resend + React Email | Free tier: 3k emails/month; templates as React components |
| Error monitoring | Sentry | Free tier sufficient for personal projects; required for production |
| Analytics | Vercel Analytics + Speed Insights | Free with Vercel; enable on all Vercel deployments |
| Real-time | Pusher Channels | Free: 200k messages/day, 100 concurrent connections |
| Background jobs | Trigger.dev v3 | Free tier; native Next.js integration; type-safe job definitions |

---

## Deployment & CI

| Concern | Tool |
|---|---|
| Hosting | Vercel (preferred) / GitHub Pages (static only) |
| CI/CD | GitHub Actions |
| Environment secrets | Vercel environment variables / GitHub Secrets |
| Dependency updates | Dependabot (weekly) |

---

## Backend (Python — secondary, standalone services only)

| Concern | Tool |
|---|---|
| Framework | FastAPI |
| Language | Python 3.12+ with full type annotations |
| Package manager | uv |
| Linting | Ruff |
| Type checking | mypy (strict) |
| Testing | pytest + pytest-cov |

Each Python service lives in its own repository — never bundled into a Next.js repo. All services are independently deployable and scalable.

---

## Testing

| Concern | Tool | Notes |
|---|---|---|
| Unit / integration | Vitest | |
| Component testing | @testing-library/react + @testing-library/user-event | |
| DOM matchers | @testing-library/jest-dom | Works with Vitest; import `/vitest` entry |
| Test environment | happy-dom | Faster than jsdom; same API |
| API mocking | MSW (Mock Service Worker) | Node handler for Vitest; browser handler for dev |
| E2E | Playwright | |
| Coverage | Vitest v8, 100% thresholds enforced | |
| Accessibility | axe-core via `@axe-core/playwright` | |
| Component isolation | Storybook | |
| Path aliases in tests | vite-tsconfig-paths | Resolves `@/` alias in Vitest config |

---

## Animations

- Tailwind transitions are the default for all motion
- Framer Motion is opt-in only — for things Tailwind can't do
- React Bits is portfolio/showcase projects only: Lighthouse Performance relaxes to 90+ (axe stays at zero violations); always dynamic import + `prefers-reduced-motion` gated

---

## Not Used

Monorepos, Pages Router, API Routes for internal mutations, CSS modules, styled-components, npm/yarn, Mongoose, tRPC.

---

## Published Package Libraries

When a project is a reusable library published to npm (e.g., the component library), the setup diverges from a standard Next.js app.

### Additional tools

| Concern | Tool | Notes |
|---|---|---|
| Bundler | tsup | Outputs ESM + CJS + `.d.ts`; tree-shakeable |
| Versioning + changelog | Changesets | Creates release PRs; publishes to npm |
| Docs / demo | Storybook → deployed to Vercel | Public-facing component showcase |

### Local dev — consuming library before publishing

The portfolio (`~/code/Crawford-Young.github.io`) installs `@crawfordyoung/ui` from npm. To test library changes locally without publishing:

```bash
# 1. Build the library
cd ~/code/component-library && pnpm build

# 2. Link it into the portfolio
cd ~/code/Crawford-Young.github.io && pnpm add ~/code/component-library
```

Revert by running `pnpm add @crawfordyoung/ui@latest` after the real version is published.

### `package.json` shape

```json
{
  "name": "@username/ui",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "sideEffects": false,
  "peerDependencies": {
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19",
    "tailwindcss": "^3 || ^4"
  }
}
```

### Tailwind CSS in published packages

Tailwind scans source files at build time in the **consuming project**. The library must ship its `src/` alongside `dist/` so consumers can add it to their content config:

```ts
// In the consuming project's tailwind.config.ts
content: [
  './src/**/*.{ts,tsx}',
  './node_modules/@username/ui/src/**/*.{ts,tsx}',
]
```

Never bundle or inline CSS into the library — Tailwind is a peer dependency.

### Changesets workflow

```bash
pnpm changeset          # describe the change and bump type (patch/minor/major)
git commit              # commit the changeset file
# CI opens a "Version Packages" PR automatically
# Merge it → CI publishes to npm
```

### `tsup.config.ts`

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom'],
})
```

### Additional Justfile commands for libraries

```just
build:
    pnpm tsup

changeset:
    pnpm changeset

version:
    pnpm changeset version

publish:
    pnpm changeset publish
```

### GitHub Actions — Release workflow (libraries only)

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: latest }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: just check
      - run: just build
      - uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```
