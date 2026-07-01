# CLAUDE.md — Master Development Standards

This file governs **all projects** in this workspace (`~/code`). Rules here apply to every repository unless a project-level `CLAUDE.md` explicitly overrides a specific rule.

> **Primary stack**: Next.js fullstack (App Router). Python/FastAPI for standalone backend services.

> **Companion references** — load on demand, not by default:
> - [`docs/STACK.md`](./docs/STACK.md) — full stack tables, Published Package setup (load when scaffolding or choosing tools)
> - [`docs/PATTERNS.md`](./docs/PATTERNS.md) — copy-paste-ready code patterns (load when implementing a feature)
> - [`docs/TEMPLATES.md`](./docs/TEMPLATES.md) — project boilerplate: CI yaml, Justfile, security headers, project structure (load when scaffolding)
> - [`docs/ENV.md`](./docs/ENV.md) — environment variable conventions (load when setting up env or .env.example)
> - [`docs/COMPONENT-LIBRARY.md`](./docs/COMPONENT-LIBRARY.md) — Radix+CVA component guide (load when building UI)
> - [`docs/TYPESCRIPT-STYLE.md`](./docs/TYPESCRIPT-STYLE.md) — full TypeScript style guide with real-world examples
> - [`docs/brand/`](./docs/brand/) — brand identity + design system + motion (load `brand-identity.md` for tokens/colors, `design-system.md` for layout/states/composition, `motion.md` for transitions/loading/animation)
> - **Predefined subagents** — `claude-config/agents/` (junctioned to `~/.claude/agents/`): dispatch via `subagent_type` — `recon`, `implementer`, `reviewer`, `manager`, `component-agent`, `new-repo-agent`, `docs-agent`, `wave-release-agent`. Tool access + model defaults enforced by frontmatter; routing overrides live in the `orchestrate` skill
> - **Orchestration** (tiers T1–T4, model routing, plan profiles, dispatch, metrics) → invoke the `orchestrate` skill when orchestrating — canonical home is `claude-config/skills/orchestrate/SKILL.md`
> - [`docs/SKILLS.md`](./docs/SKILLS.md) — canonical situation→skill routing, trigger discipline, cost notes (load when unsure which skill applies)

> **Canonical location:** this file and the workspace reference docs (`docs/*.md`, `docs/brand/`) live in the `claude-config` repo under `workspace/` and are symlinked/junctioned into `~/code`; agent definitions live in `claude-config/agents/` junctioned to `~/.claude/agents/`. Edit through either path — same file. Commit changes in `claude-config`.

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

> Full tool list with notes → [`docs/STACK.md`](./docs/STACK.md)

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

## Project Planning Docs

Specs and checklists live in `~/code/docs/<project-name>/`. Workspace-level reference docs live in `~/code/docs/` root. Ambiguous or historical docs go to `~/code/docs/archive/`.

`~/code/docs` is its own **local-private git repo** (no remote — initialized 2026-06-11). Commit planning docs there at wave boundaries: spec approval, checklist completion, reflect close. Junctioned workspace files (`brand/`, root reference MDs) are gitignored — their history lives in `claude-config`.

**claude-config is config + reference docs only.** Never write project working artifacts (specs, checklists, issues, screenshots, continuation handoffs, assets) into junctioned dirs — they land in the claude-config repo. Brand/design-system project work uses `docs/brand-design/` as its project dir; junctioned `docs/brand/` holds only the living reference MDs + README.

**Structure per project:**
```
~/code/docs/<project-name>/
  specs/          # brainstorming output: <date>-<topic>-design.md
  checklists/
    active/       # current phase checklist (one at a time)
    done/         # completed phase checklists
  issues/
    <date>-<wave>-issues.md   # open issue log (created at wave start)
    done/                     # closed after reflect
  screenshots/
    <issue-or-checklist-slug>/   # scoped to one issue/checklist/wave
      <timestamp>-<description>.png
  continuation/
    <YYYY-MM-DD-HH-MM>-handoff.md   # written by `continuation` skill before /clear; delete after resumed
```

**Screenshots convention:**
- Always save to `docs/<project>/screenshots/<slug>/` — never to the project root or a generic folder
- `<slug>` matches the active issue log name or checklist name (e.g. `2026-06-01-splash-debug`, `cyrein-core-wave1`)
- Name each file `<timestamp>-<description>.png` (e.g. `14-40-02-home-broken.png`)
- Pass the full path as the `filename` parameter when using the Playwright MCP screenshot tool
- Each debugging session / issue gets its own subfolder so screenshots from parallel processes never collide

**Order for any new feature or project:**
1. `superpowers:brainstorming` → at a genuine approach fork, `persona-debate` skill debates the options before approaches are presented → write spec to `docs/<project>/specs/<date>-<topic>-design.md` → user approves
2. `superpowers:writing-plans` → write checklist to `docs/<project>/checklists/active/<project>-<phase>.md` → `orchestrate` skill selects tier + profile, recorded in checklist header → user approves
3. Create issue log at `docs/<project>/issues/<date>-<wave>-issues.md` (orchestrator only — never subagents)
4. Write code — execute fully without approval on each change once plan is approved
5. Pause only when: checklist complete, blocked, or plan revision required

**Issue log** (`docs/<project>/issues/<date>-<wave>-issues.md`) is a living log of wrong assumptions, missing behaviors, and bugs discovered during the wave. Orchestrator logs entries proactively at four triggers: (1) user corrects built behavior, (2) same feature needs >1 correction, (3) missing behavior found mid-build, (4) design rethink from test failure. User can also request logging anytime. Reviewed together at reflect, then moved to `done/`. Full spec → `docs/superpowers/specs/2026-05-31-issue-log-workflow-design.md`.

**Checklist** (`docs/<project>/checklists/active/<project>-<phase>.md`) is the session resume file and live progress tracker. Scan `docs/<project>/checklists/active/` at session start — it is the source of truth across sessions and compaction. On phase complete, move to `docs/<project>/checklists/done/`. Full orchestration rules → `orchestrate` skill.

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

> Full guide → [`docs/COMPONENT-LIBRARY.md`](./docs/COMPONENT-LIBRARY.md)

---

## Workflow

### 1. Planning Phase

Always write and commit the spec before producing an implementation plan. No exceptions.

`superpowers:brainstorming` applies to **feature evolution on existing components**, not just new builds. If a request adds non-trivial behavior to an existing component (new interaction model, new data flow, new state machine branch), treat it as a new feature — brainstorm first.

**Uncertainty rule:** Before starting any multi-step feature, Claude must surface its top assumptions explicitly and confirm them with the user before writing code. Wrong assumptions presented as correct are the primary cause of wasted iteration cycles.

**Plan path verification:** Every file path listed in a plan must be verified to exist (Glob) at plan-writing time — stale grep results are not evidence.

**Plan premise verification:** Any plan step that says "follow the existing pattern in X" must cite a verified `file:line` confirmed at plan-writing time. Unverifiable premises are written as assumptions to confirm, never as facts. (2026-06-10: a plan asserted e2e session mocking existed — it didn't; cost a full task to deferral.)

### 2. Visual / Token Work — Preview Gate

For any color, token, or design system change: open Storybook first, verify dark + light mode visually, then write tests. Token changes are visual — they need eyes before engineering.

If Playwright MCP is unavailable or wedged (calls timing out): verify generated SVGs/images textually instead — grep output for `NaN|Infinity|undefined`, inspect the header (width/height/viewBox) and key coordinates — and note the deviation rather than fighting the browser. (2026-06-10: MCP wedged mid-session; textual verification caught everything the eyeball pass would have.)

### 3. Branch Strategy

- New branch per feature/fix — never commit to `main`
- Names mirror Conventional Commits: `feat/`, `fix/`, `chore/`, `refactor/`
- Use `superpowers:using-git-worktrees` for isolated parallel work
- **Two concurrent sessions on one repo MUST use separate worktrees.** A shared checkout is one working tree: a second session switching branches corrupts the first session's in-flight gate. This includes `claude-config` and the docs repo — a session touching junctioned workspace files commits into whatever branch claude-config's working tree is on. (2026-06-12: working tree flipped to `feat/wave-9-token-components` mid-e2e-gate → motion stories absent, false timeouts, a blocked task. 2026-07-01: concurrent session committed `motion.md` onto another wave's open `feat/native-subagents` branch.)
- **Rebase-only workflow — linear history is required:**
  - Sync with main: `git fetch origin && git rebase origin/main` — never `git merge main`
  - Pull remote changes to same branch: `git pull --rebase` — never `git pull`
  - Set as default: `git config --global pull.rebase true`
  - Merge commits in a branch break GitHub's "Rebase and merge" PR strategy

### 4. Commit & Push Policy

- **Do not commit or push without explicit user approval**
- Stage changes, present a clear summary, wait for approval
- Co-Authored-By trailer required on all commits
- Conventional Commits format enforced by commitlint
- **After every push to a PR branch, verify CI passes:** `gh pr checks <number> --watch` — do not move on until all checks are green or explicitly dismissed by the user
- **Zero check runs on a PR ≠ passing — it may mean conflicts.** GitHub runs no `pull_request` CI on a conflicting PR (only deploy checks like Vercel appear). If `gh pr checks` shows only Vercel/no test jobs, check `mergeStateStatus` — rebase onto `origin/main` before trusting the PR. (2026-06-12: PR #55 opened conflicting after a same-day merge to main; looked check-clean, ran no CI.)

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
- [ ] axe — zero violations
- [ ] Manual playthrough — for interactive/game UI, drive the real feature end-to-end in the browser before calling it done. Automated coverage + axe + Lighthouse all passed a missing HUD, two copy bugs, and a contrast regression that a 2-minute playtest caught (2026-06-30, duel)
- [ ] Sentry — integrated and reporting (production deployments)
- [ ] Dependabot — `.github/dependabot.yml` present
- [ ] No dead code, unused imports, or commented-out blocks
- [ ] `.gitignore` up to date; `.env.example` current
- [ ] `docs/checklists/active/` checklist current; completed phase moved to `docs/checklists/done/`
- [ ] README.md + CLAUDE.md in the repo updated
- [ ] `~/code/CLAUDE.md` + `~/code/docs/` updated if workspace conventions changed
- [ ] Phase boundary: **run `claude-md-management:reflect` — mandatory at every wave merge, milestone, or branch close**
- [ ] **Repo-level doc edits land in the wave branch BEFORE merge — never in a second PR.** If a QA round or reflect surfaces a repo-file change (repo `README.md`/`CLAUDE.md`, tests, config), commit it to the still-open wave branch. Reserve a doc-review beat right before requesting merge; reflect's *repo* proposals get drafted then, not after. Only workspace/`claude-config` edits (junctioned `~/code/CLAUDE.md`, `docs/`) land separately — they're a different repo with no bearing on the wave PR. (2026-07-01: reflect's `component-library/CLAUDE.md` notes surfaced after PR #65 merged → forced a follow-up docs PR.)

Run `superpowers:verification-before-completion` before declaring anything done.

### 7. Context Hygiene

- Orchestrator stops at `<!-- COMPACT POINT -->` markers and prompts the user to run `/compact` (the agent cannot invoke it) — not ad-hoc
- **Marker stop is absolute.** Blanket task approval ("i trust you, go for it") never waives it — only an explicit user instruction to skip compaction itself does. (2026-07-01: two markers passed under a blanket go-ahead; user corrected.)
- **If no checklist exists, compact at every major task boundary** — a 5h+ uncompacted session is unacceptable regardless of marker presence
- **Any checklist with 8+ tasks MUST include `<!-- COMPACT POINT -->` markers every 3–4 tasks** — writing the checklist without them is incomplete
- `/clear` prompted by `reflect` skill at project end only — not mid-phase
- Always `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- >10 files read → offload remaining research to a focused subagent
- Do not re-read files already summarised in the conversation

---

## TDD Requirement

1. Write failing test
2. Write minimum code to pass
3. Refactor → run `simplify` skill
4. Repeat

**Never write implementation code before its test.**

**Vitest patterns:**
- Mocking `auth()` returning null: `vi.mocked(auth).mockResolvedValueOnce(null as never)` — `null as never` required because `auth` has middleware + callback overloads; plain `null` fails type-check.
- Component mocks (dialogs especially) must render the DATA props they receive (dates, times, ids as visible text/attrs), not just component identity — identity-only mocks have hidden real contract bugs (2026-06-10: full datetime passed where date-only was required; test passed, save silently wiped data).
- Structurally unreachable guard statements (e.g. `if (!x) return` where render conditions guarantee `x`) block the 100%-statements gate — restructure as a statement-free JSX inline guard (`{x && handler(x)}`); the untaken branch then falls under the DoD branch exemption.
- Tests for user-facing copy must assert the INTENDED wording, written independently — not whatever the component currently renders. A test written to match the rendered output locks in the bug: "P1 's turn" (stray space) was asserted by 3 unit tests + 1 e2e, all green, and only a manual playtest caught it (2026-06-30). When changing any user-facing string, grep ALL test directories for the old text including `e2e/` — `src/__tests__` alone misses Playwright specs.

---

## TypeScript Style

The four rules most commonly violated — check on every PR:

1. **Interfaces over type aliases** for object shapes — `interface Foo {}` not `type Foo = {}`
2. **`readonly` on immutable properties** — if it's never reassigned, mark it `readonly`
3. **Explicit return types on exported functions** — callers should not need to hover
4. **No magic numbers** — every numeric literal used in logic gets a named constant

Prettier owns formatting — when Prettier conflicts with the Google style guide, Prettier wins.

> Full guide → [`docs/TYPESCRIPT-STYLE.md`](./docs/TYPESCRIPT-STYLE.md)

---

## Code Quality

**Universal rules:**
- No `any` — use `unknown` and narrow it
- No `@ts-ignore` / `eslint-disable` without a comment explaining why
- No dead code, no commented-out code, no `console.log`
- Never use Tailwind opacity modifiers (`/40`–`/70`) on text to create visual hierarchy — at small sizes they drop below the WCAG AA 4.5:1 floor and fail axe/Lighthouse. Use the full token (e.g. `text-muted-foreground`, ~7.9:1 on dark) or a defined darker step. Opacity on non-text decoration (gauge ticks, bar tracks) is fine. (Hit 3× in one feature, 2026-06-30 duel.)
- Always use `@/` path alias — never relative paths traversing more than one level
- Run `simplify` skill after every implementation pass
- **Never round-trip UTF-8 (no BOM) MD files through PS 5.1 `Get-Content`/`Set-Content`** — PS 5.1 reads no-BOM UTF-8 as ANSI and mojibakes em-dashes/arrows on write-back. Use the Edit/Write tools for file mutations (checklist ticks especially). (2026-07-01: a `-replace` pass corrupted a checklist; full rewrite required.)
- **A local-only lint/format failure may be a line-ending checkout artifact, not real drift.** Before mass-rewriting (`prettier --write .`), check `git diff --numstat` (empty = EOL-only) and the committed blob's EOL (`git show HEAD:<file> | cat -A`); on Windows with `core.autocrlf=true` + no `.gitattributes`, CRLF-on-disk trips prettier's default `endOfLine:lf` while CI (Linux, LF) is already green. Fix at the source (`.gitattributes` `* text=auto eol=lf` + `.prettierrc` `endOfLine:"auto"`), don't churn files. (2026-06-30: a "repo-wide prettier drift, run prettier --write" flag was carried across two sessions as a blocker — it was a no-op CRLF artifact.)
- **When a library component generalizes app-local code, port the ACTUAL source's staging/timing verbatim — read the shipped file, not the spec's paraphrase.** The spec may describe intent ("Cy's bond" with a space) while the working code achieves it differently (gap from a CSS translate, no space char). Re-tune pixel/duration constants for the library's context (product `text-4xl` → library `text-7xl` needed the split translate to go ±12px→±32px or glyphs overlap). (2026-07-01: BrandSplash first port paraphrased the spec — wrong `'s` staging, dropped quote fade, an `animate-pulse` the product never had; cost a full re-QA round.)
- **SVG geometry attributes (`<rect width/height>`, `<circle r>`, `x`/`y`/`cx`/`cy`) silently reject CSS `calc()` — the element just doesn't render.** Use percentage or numeric lengths (`width="100%"`, `r="50%"` on an `overflow-visible` svg so the stroke straddles the edge). jsdom renders no SVG layout and axe checks only a11y, so 100% coverage + axe + tsc all pass a component that draws nothing — add a unit assertion that geometry attrs are `%`/number (not `calc`), and always visually verify SVG components. (2026-07-01: TraceBorder trace invisible on a button, every gate green.)

**Dependencies:**
- Always use the latest stable major version — stale majors are a blocker, not deferred debt
- Upgrading a major dependency mid-feature-PR is a bug: do it in a standalone housekeeping PR before the feature starts
- devDependency upgrades that land in the same commit as feature/coverage work can break release workflows — keep them separate
- **`file:` workspace packages + gitignored `dist/`:** pnpm copies dist at install time, not a live symlink. After adding exports to a library: `just build` in the library → `pnpm install` in the consuming repo.

**Security:**
- OWASP Top 10 mitigations
- `.gitignore` is the first commit in every new repo
- Never commit `.env`, credentials, API keys, or tokens
- `.env.example` documents all required vars — committed and kept current
- `t3-env` validates all env vars at startup
- Hardened security headers in `next.config.ts`
- Zod validates all inputs at system boundaries
- Rate limit all user-facing endpoints via Upstash
- `pnpm audit` in CI — no high/critical vulnerabilities
- **Transitive vuln override pattern:** `npm show <pkg> version` → pin exact latest in `pnpm.overrides` → `pnpm install` → `pnpm audit` to confirm zero remaining; never use a range (`>=x`) in overrides. A red audit gate may be caused by an advisory published the same day, not by the PR's changes - check the advisory publish date before hunting the diff (2026-06-12: esbuild GHSA landed mid-PR)

> Implementation patterns → [`docs/PATTERNS.md`](./docs/PATTERNS.md) | ESLint setup, CI yaml, Justfile, project structure → [`docs/TEMPLATES.md`](./docs/TEMPLATES.md)

---

## Orchestration

Tier ladder T1–T4, adaptive model routing, escalation, plan profiles, dispatch template — all in the `orchestrate` skill. Invoke it for any multi-task plan execution or `Agent()` dispatch decision. Every `Agent()` call sets `model:` explicitly from the skill's routing table.

---

## When Stuck

Ask one focused question at a time. Surface uncertainty before writing code.
