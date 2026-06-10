# Daily Tech Update Prompt

> **STATUS (2026-06-09): LIVE as cloud routine** `trig_01STLPYK4poTF6mJTNkG3H4v` (https://claude.ai/code/routines/trig_01STLPYK4poTF6mJTNkG3H4v) — daily 13:07 UTC (~9:07am ET). Cloud agents cannot reach this machine, so the routine clones the GitHub repos (claude-config, scheduling-advisor, component-library, portfolio-website; local-only repos skipped) and **commits reports to the claude-config repo at `docs/daily-updates/YYYY-MM-DD.md`** — `git pull` in `~/code/claude-config` to read them. The prompt below is the original local version, kept as reference; the routine carries an adapted self-contained copy.

---

## Prompt

```
You are running a daily tech update for Crawford Young's ~/code workspace.
Today's date: {{DATE}}
Report output path: ~/code/docs/daily-updates/{{DATE}}.md

## Setup

**Step 1 — Discover projects.**
Scan ~/code/ for any directory containing a package.json or pnpm-lock.yaml.
Exclude: docs/, node_modules/, dist/, .git/, any file (not directory).
This list is your project scope for all sections below. Do not hardcode project names.

**Step 2 — Load yesterday's report.**
Read ~/code/docs/daily-updates/{{YESTERDAY}}.md if it exists.
Use it for the Trend section. If missing, skip trend diff — do not error.

**Step 3 — Read all CLAUDE.md files.**
For each discovered project, read its CLAUDE.md if present.
Also read ~/code/CLAUDE.md (workspace root).
Extract: current stack versions noted, known constraints, in-progress decisions.
Use this as context for all sections — flag deviations between CLAUDE.md and actual code.

Produce a structured report. Be terse — facts only, no padding.
Flag anything needing action with [ACTION REQUIRED].
Save the completed report to ~/code/docs/daily-updates/{{DATE}}.md when done.

---

## 1. Dependency Health

For each discovered project:

**a) Outdated packages** — run `pnpm outdated`:
   - MAJOR version gaps — [ACTION REQUIRED], list migration guide URL if known
   - MINOR version gaps — list, note any that unlock significant features
   - PATCH version gaps — list security-relevant patches only

**b) Security audit** — run `pnpm audit --audit-level=moderate`:
   - HIGH / CRITICAL: package name, CVE, fix command [ACTION REQUIRED]
   - MODERATE: list only, no action flag

**c) Dependabot** — confirm `.github/dependabot.yml` exists.
   Missing = [ACTION REQUIRED].

**d) Lock file** — confirm `pnpm-lock.yaml` is committed and not dirty.

---

## 2. Build & Type Health

For each discovered project:

**a)** `pnpm tsc --noEmit` — zero errors or list all.
**b)** `pnpm eslint . --max-warnings 0` — zero warnings or list all.
**c)** `pnpm prettier --check .` — clean or list unformatted files.
**d)** If project has `tsup.config.ts`: verify build output exists in `dist/` and is current.
**e)** Cross-check: any type in use that CLAUDE.md forbids (e.g. `any`, `@ts-ignore` without comment)?
   Grep for these patterns. List occurrences [ACTION REQUIRED].

---

## 3. Test Coverage

For each discovered project:

**a)** Run `pnpm vitest run --coverage` — report all four metrics (statements, branches, functions, lines).
   Any metric below 100% = [ACTION REQUIRED]. List offending files.

**b)** Run `pnpm playwright test` if `playwright.config.ts` exists.
   Report: total tests, passed, failed, skipped.

**c)** Grep all test files for `.skip(`, `.todo(`, `.only(` — must be zero [ACTION REQUIRED].

**d)** Confirm MSW handlers exist at `tests/mocks/handlers.ts` if the project fetches external APIs.

---

## 4. Storybook (component-library and any project with `stories/`)

**a)** Run `pnpm storybook build` — success or errors.
**b)** List all components in `src/components/ui/` with no matching `.stories.tsx` [ACTION REQUIRED].
**c)** List any `.stories.tsx` files that import a component path that no longer exists.
**d)** Confirm every story renders in both dark and light mode (check for `decorators` with ThemeProvider or equivalent).

---

## 5. Git & Branch Status

For each discovered project:

**a)** Current branch.
**b)** Commits ahead of `main` (unpushed).
**c)** Uncommitted changes — staged and unstaged file list.
**d)** Last commit: message + author + timestamp.
**e)** Branches older than 7 days that are not `main` — list + suggest cleanup.
**f)** Any branch name that does not follow `feat/`, `fix/`, `chore/`, `refactor/` convention [ACTION REQUIRED].

---

## 6. Deployment & Vercel

**a)** Run `vercel ls` — list latest deployment per project, status, URL, age.
**b)** Any deployment in ERROR or BUILDING state > 10 min [ACTION REQUIRED].
**c)** Confirm production alias points to latest `main` commit.
**d)** Check `NEXT_PUBLIC_APP_URL` in `.env.example` matches actual Vercel production domain.
**e)** Confirm Vercel Analytics and Speed Insights are present in root layout (`<Analytics />`, `<SpeedInsights />`).

---

## 7. Performance & Accessibility

**a)** Report last known Lighthouse scores (from CI artifacts or last manual run):
   - Performance ≥ 100 (or ≥ 90 if React Bits is in use)
   - Accessibility = 100
   - Best Practices = 100
   - SEO = 100
   - Flag any category below threshold [ACTION REQUIRED]
   - Note if scores are stale (not run since last deployment) [ACTION REQUIRED]

**b)** Last axe scan — zero violations required [ACTION REQUIRED if any].

**c)** Check for `motion-safe:` / `motion-reduce:` usage wherever CSS transitions or Framer Motion appear.
   Missing reduced-motion guards = [ACTION REQUIRED].

---

## 8. Error Monitoring (Sentry — aspirational)

**a)** For each project, confirm:
   - `SENTRY_DSN` present in `.env.example`
   - `instrumentation.ts` exists
   - `Sentry.captureException` used in catch blocks (grep `src/` for bare `catch` blocks without it)

**b)** Flag any project missing Sentry setup [ACTION REQUIRED — aspirational].

**c)** If Sentry CLI is authenticated, query unresolved errors from last 24h.
   Otherwise, note: "Sentry live query skipped — not authenticated."

---

## 9. In-Progress Work & Docs

**a)** List all `plan-*.md` files in `~/code/docs/` — for each:
   - Last modified date
   - Whether any wave/milestone is marked incomplete
   - Stale if not touched in >3 days [ACTION REQUIRED]

**b)** List all `spec-*.md` and `adr-*.md` files — note any without a corresponding plan.

**c)** List `~/code/docs/agents/` briefing MDs — note any not updated this week.

**d)** Cross-check open `feat/*` / `fix/*` branches against plan files.
   Branch with no plan file = undocumented work [ACTION REQUIRED].

---

## 10. Security Checklist

For each discovered project:

**a)** `.env` in `.gitignore` — yes/no.
**b)** `git ls-files | grep -E "\.env$"` — must return empty [ACTION REQUIRED if not].
**c)** `.env.example` committed — yes/no [ACTION REQUIRED if missing].
**d)** `next.config.ts` contains all required security headers:
   `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`
   Missing any = [ACTION REQUIRED].
**e)** `middleware.ts` present and protects authenticated routes.
**f)** Grep Server Actions for Upstash rate limiting — flag any unprotected public-facing actions [ACTION REQUIRED].
**g)** Grep for hardcoded secrets (patterns: `sk_`, `pk_`, `whsec_`, `Bearer `, passwords in string literals) [ACTION REQUIRED if found].

---

## 11. Stack Version Tracking

For each discovered project, report current installed vs npm latest for core packages.
Resolve "latest" via `npm view <pkg> version`.

| Package | Installed | Latest | Gap | Flag |
|---|---|---|---|---|
| next | | | | |
| react | | | | |
| react-dom | | | | |
| typescript | | | | |
| tailwindcss | | | | |
| @radix-ui/react-* (representative) | | | | |
| drizzle-orm | | | | |
| drizzle-kit | | | | |
| @auth/core | | | | |
| next-auth | | | | |
| @tanstack/react-query | | | | |
| zustand | | | | |
| zod | | | | |
| @upstash/redis | | | | |
| @upstash/ratelimit | | | | |
| @neondatabase/serverless | | | | |
| vitest | | | | |
| @playwright/test | | | | |
| @testing-library/react | | | | |
| msw | | | | |
| pino | | | | |
| lucide-react | | | | |
| sonner | | | | |
| date-fns | | | | |
| next-themes | | | | |
| react-hook-form | | | | |
| tsup | | | | |
| @trigger.dev/sdk | | | | |
| resend | | | | |
| stripe | | | | |
| pusher / pusher-js | | | | |
| t3-env | | | | |
| class-variance-authority | | | | |

MAJOR gap = [ACTION REQUIRED].
MINOR gap = note only.

---

## 12. Ecosystem & Tech Radar

Search npm, GitHub releases, and official changelogs for announcements in the last 7 days relevant to this stack.
Focus on: Next.js, React, TypeScript, Tailwind CSS, Radix UI, Drizzle ORM, Auth.js, TanStack Query, Vitest, Playwright, Vercel platform.

For each noteworthy item report:
- What changed / was released
- Why it matters to this stack specifically
- Whether it requires a version bump or config change
- Whether it introduces a better pattern that replaces something in CLAUDE.md

Also surface:
- Any new tooling that could replace a current stack item (e.g. new test runner, better bundler)
- Any deprecation warnings for packages in use
- Any RFC or proposal in active discussion that will affect future architecture decisions

Label each: [UPGRADE NOW], [WATCH], [CONSIDER], or [DEPRECATION WARNING].

---

## 13. CLAUDE.md Drift Detection

Compare actual project code against CLAUDE.md rules:

**a)** Imports using relative paths traversing more than one level — must use `@/` alias [ACTION REQUIRED].
**b)** `console.log` in committed code — must use Pino [ACTION REQUIRED].
**c)** `any` type without justification comment [ACTION REQUIRED].
**d)** CSS modules or styled-components imports — forbidden, use Tailwind [ACTION REQUIRED].
**e)** Pages Router files (`pages/`) — forbidden, App Router only [ACTION REQUIRED].
**f)** API Routes used for internal mutations — should be Server Actions [note only].
**g)** Hardcoded color values (hex/rgb) instead of semantic Tailwind tokens [ACTION REQUIRED].
**h)** `pnpm` not used as package manager (check for `package-lock.json`, `yarn.lock`) [ACTION REQUIRED].

---

## 14. Summary

### [ACTION REQUIRED] — Must fix today
(pull all ACTION REQUIRED items from above, grouped by project)

### Ecosystem — Act on this week
(pull [UPGRADE NOW] and [DEPRECATION WARNING] items from Section 12)

### Watch list
(pull [WATCH] and [CONSIDER] items from Section 12)

### All clear
(list every section with zero issues)

### Trend vs {{YESTERDAY}}
New issues (appear today, absent yesterday):
Resolved issues (absent today, present yesterday):
Net delta: +N issues / -N issues
```

---

## How to run

### Scheduled (daily)
```
/schedule daily at 8:00am — run the daily tech update prompt from ~/code/docs/daily-update-prompt.md and save output to ~/code/docs/daily-updates/$(date +%Y-%m-%d).md
```

### Manual trigger
```
/schedule once now — run the daily tech update prompt from ~/code/docs/daily-update-prompt.md
```

### Output location
```
~/code/docs/daily-updates/
  2026-04-22.md
  2026-04-23.md
  ...
```
Reports accumulate. Each reads the prior day's file for trend diffing.
