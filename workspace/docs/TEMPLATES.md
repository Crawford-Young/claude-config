# Project Templates

Boilerplate files and standards that go into every new repo. Load this when scaffolding a project or setting up tooling. For code patterns (library usage, implementation snippets), see `docs/PATTERNS.md`.

---

## Commitlint Config

```ts
// commitlint.config.ts
import type { UserConfig } from '@commitlint/types'

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
}

export default config
```

Husky `commit-msg` hook:
```sh
# .husky/commit-msg
pnpm commitlint --edit $1
```

Husky `pre-push` hook:
```sh
# .husky/pre-push
pnpm tsc --noEmit
```

---

## ESLint Setup

Every project installs and configures:
- `@typescript-eslint/eslint-plugin` — TypeScript-aware rules
- `eslint-config-next` — Next.js best practices (includes React, React Hooks, import rules)
- `eslint-plugin-jsx-a11y` — catches accessibility violations at lint time, before axe runs

`eslint-plugin-jsx-a11y` is non-negotiable — it is the first line of accessibility defence during development (immediate feedback, not just at test time).

**Required rules** (enforce style-guide items mechanically instead of by review):

```js
// eslint.config.mjs — add to the rules block of every repo
{
  rules: {
    // Type-only imports/exports are erased at compile time — keeps builds fast
    // and works with verbatimModuleSyntax
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/consistent-type-exports': 'error',
    // Record<string, T> over {[key: string]: T}
    '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
    // Throw/reject only Error instances
    '@typescript-eslint/only-throw-error': 'error',
    '@typescript-eslint/prefer-promise-reject-errors': 'error',
    // Every switch has a default; non-empty cases must terminate
    'default-case': 'error',
    'no-fallthrough': 'error',
    // const enum breaks isolatedModules; use string literal unions instead
    'no-restricted-syntax': [
      'error',
      {
        selector: 'TSEnumDeclaration[const=true]',
        message: 'const enum is banned — use a string literal union.',
      },
    ],
  },
}
```

Style-guide rationale for these → `docs/TYPESCRIPT-STYLE.md` §13–15.

---

## Next.js App Router Rules

Project-level rules that apply to every Next.js repo:

- App Router only — never Pages Router
- Co-locate route-specific components inside `app/` alongside their page
- Shared/reusable components go in `src/components/`
- Server Components fetch their own data — do not prop-drill server data into Client Components
- Keep Client Components small and push them to the leaves of the component tree
- `loading.tsx` and `error.tsx` required for every meaningful route segment
- Fonts loaded via `next/font` only — never a `<link>` tag to an external font CDN

---

## Dark Mode Standards

- All projects use `next-themes` with `defaultTheme="dark"`
- Tailwind config: `darkMode: "class"`
- `ThemeProvider` wraps the root layout (see `docs/PATTERNS.md` — next-themes section for code)
- Design and QA dark mode first; light mode is the secondary pass
- Never hardcode colors — always use semantic Tailwind tokens (`bg-background`, `text-foreground`, etc.)
- Storybook stories render both themes; Lighthouse tested in both
- When React Bits is in use, Lighthouse Performance relaxes to 90+ (not 100); all other categories remain 100

---

## `next.config.ts` Security Headers

```ts
import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
```

Tighten CSP `script-src` per project once the full set of third-party scripts is known.

---

## GitHub Actions CI

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: latest }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: just lint
      - run: just typecheck
      - run: just test
      - run: just storybook-build
      - run: pnpm audit --audit-level=high

  e2e:
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: latest }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm playwright install --with-deps
      - run: just e2e
```

---

## Dependabot Config

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dependencies:
        patterns: ['*']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

---

## Justfile

```just
install:
    pnpm install

dev:
    pnpm dev

test:
    pnpm vitest run --coverage

e2e:
    pnpm playwright test

lint:
    pnpm eslint . && pnpm prettier --check .

typecheck:
    pnpm tsc --noEmit

check: lint typecheck test e2e

storybook:
    pnpm storybook dev -p 6006

storybook-build:
    pnpm storybook build

migrate:
    pnpm drizzle-kit migrate

migrate-gen:
    pnpm drizzle-kit generate

db-studio:
    pnpm drizzle-kit studio

trigger-dev:
    pnpm trigger dev

email-preview:
    pnpm email preview
```

---

## Project Structure

```
src/
  app/                    # App Router — pages, layouts, loading, error
  components/
    ui/                   # Radix-based primitive components
    [feature]/            # Composed feature components
  db/
    schema.ts             # Drizzle schema (relational)
    index.ts              # DB client(s)
    indexes.ts            # MongoDB index definitions
    schemas/              # Zod schemas for MongoDB collections
    migrations/           # Auto-generated by drizzle-kit
  emails/                 # React Email templates
  lib/
    logger.ts             # Pino logger
    redis.ts              # Upstash Redis client
    stripe.ts             # Stripe server-side client
    schemas/              # Shared Zod schemas
    utils.ts              # cn() and pure utilities
  hooks/                  # Custom React hooks (client-side only)
  server/
    actions/              # Server Actions
    queries/              # Server-side data fetching
    services/             # Business logic (email, stripe, etc.)
  trigger/                # Trigger.dev job definitions
  types/                  # Shared TypeScript types
  env.ts                  # t3-env validated environment variables
  middleware.ts           # Auth + route protection + rate limiting
stories/
  ui/                     # Storybook stories
tests/
  unit/                   # Vitest unit & integration tests
  e2e/                    # Playwright tests
  mocks/
    handlers.ts           # MSW request handlers
    server.ts             # MSW server setup
.github/
  workflows/
    ci.yml
  dependabot.yml
.husky/
  pre-commit              # lint-staged
  commit-msg              # commitlint
  pre-push                # tsc --noEmit
.env.example
.gitignore
commitlint.config.ts
justfile
next.config.ts
drizzle.config.ts
```
