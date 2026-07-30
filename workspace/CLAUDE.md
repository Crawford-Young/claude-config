# CLAUDE.md — Universal Development Standards

This file governs **every project in this workspace**, across all domains. It carries the rules that do not depend on language or stack: workflow order, planning discipline, git and branch strategy, commit policy, context hygiene, orchestration, and security baselines.

**Stack-specific rules live in the domain file.** Claude Code loads every `CLAUDE.md` from your working directory upward, root first, so a session in `~/code/web/scheduling-advisor` gets this file, then `web/CLAUDE.md`, then the repo's own — each overriding the last on conflict.

## Domains

| Folder | Domain | Stack | Rules |
|---|---|---|---|
| `~/code/web/` | Web | Next.js (App Router), TypeScript, Tailwind, Radix+CVA, Vitest, Playwright, Vercel | [`web/CLAUDE.md`](./web/CLAUDE.md) |
| `~/code/games/` | Games | Godot 4, GDScript, GUT | [`games/CLAUDE.md`](./games/CLAUDE.md) |
| `~/code/apps/` | Apps | Expo (React Native) mobile, Tauri v2 desktop, TypeScript, Jest+RNTL, Maestro | [`apps/CLAUDE.md`](./apps/CLAUDE.md) |

Workspace infrastructure stays at the root: `claude-config/` (this file's source + agents + skills), `docs/` (private planning-docs repo), `.claude/`, `.agents/`.

> **Predefined subagents** — `claude-config/agents/` (junctioned to `~/.claude/agents/`): dispatch via `subagent_type` — `recon`, `implementer`, `reviewer`, `manager`, `docs-agent` are domain-neutral and inherit rules from their working directory's CLAUDE.md chain; `component-agent`, `new-repo-agent`, `wave-release-agent` are web-only. Tool access + model defaults enforced by frontmatter; routing authority = `claude-config/agents/profiles/`.
> **Orchestration** (agent factory: spawn protocol, profiles, performance MDs) → invoke the `agent-factory` skill when orchestrating — canonical home is `claude-config/skills/agent-factory/SKILL.md`. Skills and agents live at user level (`~/.claude/`), so they load in every domain.
> [`docs/SKILLS.md`](./docs/SKILLS.md) — canonical situation→skill routing, trigger discipline, cost notes (load when unsure which skill applies).

> **Canonical location:** this file, the domain files, and the workspace reference docs live in the `claude-config` repo under `workspace/` and are symlinked/junctioned into `~/code`. Edit through either path — same file. Commit changes in `claude-config`.

---

## Project Planning Docs

Specs and checklists live in `~/code/docs/<domain>/<project-name>/`. Workspace-level reference docs live in `~/code/docs/` root. Ambiguous or historical docs go to `~/code/docs/archive/`.

`~/code/docs` is its own **local-private git repo** (no remote — initialized 2026-06-11). Commit planning docs there at wave boundaries: spec approval, checklist completion, reflect close. Junctioned workspace files (`brand/`, root reference MDs) are gitignored — their history lives in `claude-config`. **Commit with explicit paths, never `git add -A`** — the repo is shared by concurrent sessions; `-A` sweeps another session's in-flight checklists/issues into your commit (2026-07-01: 2a spike commit swept w2.2L + cybond-w2.2 files). (`git add -A`/`--all` deny-ruled + hook-enforced since 2026-07-27.)

**Correction 2026-07-28 — `~/code/docs` DOES have a remote.** The line above says "no remote"; that has not been true for some time. `Crawford-Young/docs` exists and is private, and the local repo had drifted **227 commits** ahead of it before anyone checked — the stale line is why nobody thought to look. Push at wave close alongside the commit, not "eventually". (Left as an addendum rather than an edit because the paragraph above is a frozen baseline; rewriting it in place would read as a lost rule.)

**claude-config is config + reference docs only.** Never write project working artifacts (specs, checklists, issues, screenshots, assets) into junctioned dirs — they land in the claude-config repo. Brand/design-system project work uses `docs/brand-design/` as its project dir; junctioned `docs/brand/` holds only the living reference MDs + README.

**Structure per project:**
```
~/code/docs/<domain>/<project-name>/
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
```

`<domain>` is `web`, `games`, or `apps`, mirroring `~/code`. Meta/workspace projects (agent-factory, superpowers, claude-config, brand-design, workspace-restructure) live at `docs/` root with no domain folder.

**Screenshots convention:**
- Always save to `docs/<domain>/<project>/screenshots/<slug>/` — never to the project root or a generic folder
- `<slug>` matches the active issue log name or checklist name (e.g. `2026-06-01-splash-debug`, `cyrein-core-wave1`)
- Name each file `<timestamp>-<description>.png` (e.g. `14-40-02-home-broken.png`)
- Pass the full path as the `filename` parameter when using the Playwright MCP screenshot tool
- Each debugging session / issue gets its own subfolder so screenshots from parallel processes never collide

**Order for any new feature or project:**
1. `superpowers:brainstorming` → at a genuine approach fork, `persona-debate` skill debates the options before approaches are presented → write spec to `docs/<domain>/<project>/specs/<date>-<topic>-design.md` → user approves
2. `superpowers:writing-plans` → write checklist to `docs/<domain>/<project>/checklists/active/<project>-<phase>.md` → `agent-factory` skill: `**Factory:**` header line, spawn decisions at execution time → user approves
3. Create issue log at `docs/<domain>/<project>/issues/<date>-<wave>-issues.md` (orchestrator only — never subagents)
4. Write code — execute fully without approval on each change once plan is approved
5. Pause only when: checklist complete, blocked, or plan revision required

**Issue log** (`docs/<domain>/<project>/issues/<date>-<wave>-issues.md`) is a living log of wrong assumptions, missing behaviors, and bugs discovered during the wave. Orchestrator logs entries proactively at four triggers: (1) user corrects built behavior, (2) same feature needs >1 correction, (3) missing behavior found mid-build, (4) design rethink from test failure. User can also request logging anytime. Reviewed together at reflect, then moved to `done/`. Full spec → `docs/superpowers/specs/2026-05-31-issue-log-workflow-design.md`.

**Checklist** (`docs/<domain>/<project>/checklists/active/<project>-<phase>.md`) is the session resume file and live progress tracker. Scan `docs/<domain>/<project>/checklists/active/` at session start — it is the source of truth across sessions and compaction. On phase complete, move to `docs/<domain>/<project>/checklists/done/`. Full orchestration rules → `agent-factory` skill.

---

## Workflow

> **Situational rule skills** — load when the situation applies, not by default:
> - `plan-premises` — plan-time verification: premise checking, contract-surface and invariant-consumer enumeration, verbatim-code checks, spec-time user questions. **Load before writing or reviewing any plan or checklist.**
> - `visual-asset-gates` — brand/asset/theme work, image pipelines, preview gates. **Load before any visual, asset, or preview-gate task.**
> - `live-qa-traps` — the unit-green/live-broken bug family and Vitest mocking traps. **Load before writing tests or QA for interactive UI.**
> - `games-diagnostics` — Godot telemetry, probes, feel-gate tuning. **Load for games diagnostic or tuning work.**

**Two of those skills do not load themselves at scope time — load them by hand.** Scoping UI
interaction work (drag, reorder, dialogs, popovers, keyboard/pointer input) → load
`live-qa-traps` before choosing an approach. Scoping Godot movement, physics, or feel work →
load `games-diagnostics` before shaping the wave. The table above is a routing table: it works
only if the harness matches the request against a skill's `description`, and for these two that
matching is measured broken — 10 fresh probe sessions, ladder rungs 0 and 1, zero fires on
build-shaped prompts. The load is therefore the orchestrator's job, not the router's. Do not
"fix" this by rewriting their descriptions; that was rung 1 and it failed. (2026-07-28
description-audit, ladder TERMINAL. Full evidence in `docs/SKILLS.md` §Writing a Skill
`description`.)

### 1. Planning Phase

Always write and commit the spec before producing an implementation plan. No exceptions.

`superpowers:brainstorming` applies to **feature evolution on existing components**, not just new builds. If a request adds non-trivial behavior to an existing component (new interaction model, new data flow, new state machine branch), treat it as a new feature — brainstorm first.

**Uncertainty rule:** Before starting any multi-step feature, Claude must surface its top assumptions explicitly and confirm them with the user before writing code. Wrong assumptions presented as correct are the primary cause of wasted iteration cycles.

### 2. Visual / Token Work — Preview Gate

**All rules for this section now live in the `visual-asset-gates` skill** — load it before any visual, asset, image-pipeline, or preview-gate task.

### 3. Branch Strategy

- New branch per feature/fix — never commit to `main`
- Names mirror Conventional Commits: `feat/`, `fix/`, `chore/`, `refactor/`
- **Cut every branch from `origin/main`, and verify: `git log origin/main..HEAD` must be empty at branch creation.** A branch cut from another branch's tip silently drags foreign commits into the PR range — re-check the range before requesting merge. (2026-07-01: precision-foundation was cut from a fix branch's tip; stray commit found only at PR-prep, fixed with `git rebase --onto origin/main <stray>`.)
- Use `superpowers:using-git-worktrees` for isolated parallel work
- **New worktree setup copies `.env.local` AND `.env` from the main checkout** (gitignored, never staged) before the first dev/test run — real secrets typically live in `.env.local`; copying only `.env` ships stale values and the env-validation crash surfaces at the worst time (QA dev-server spin-up). Port collision is also expected: a concurrent session's dev server usually holds `:3000`, and running the worktree on `:3001` is fine for cookie-based QA (localhost cookies are port-agnostic) — only fresh OAuth sign-in needs the registered `:3000`. (2026-07-14, activities-grouping wave.) Check the port holder (`netstat`) BEFORE launching any gate suite that includes e2e — `reuseExistingServer: !process.env.CI` silently runs e2e against the OTHER session's dev server/branch; apply the temp `:3001` playwright edit first, revert pre-commit. (2026-07-16 eb3: gate launched before check → TaskStop + relaunch.) A wave that ADDS an env var makes every pre-wave dev server stale by definition — its process env lacks the var, so pages importing the new env crash at runtime while redirects still pass, masquerading as a page regression; kill the holder before gates. And enumerate EVERY env-injection surface at the task that adds the var: `.env.local`, `.env.example`, Vercel, AND playwright `webServer.env` dummies — local e2e reads `.env.local` so the missing dummy passes locally and fails only in CI's env-file-less container. (2026-07-26/27 oauth: stale server cost one gate run; missing `TOKEN_ENC_KEY` webServer dummy cost one CI e2e round on PR #46; n=1 each, provisional.)
- **Windows worktree removal:** `git worktree remove` reliably fails on a worktree with `node_modules` (file locks, then >260-char long paths in react-server-dom). Working sequence: `git worktree remove --force` → `Remove-Item -Recurse -Force` from a shell whose cwd is OUTSIDE the worktree → robocopy `/MIR` empty-dir mirror for long-path remnants → `git worktree prune`. (2026-07-16: hit 2× in one day, w16 + eb2 worktrees.)
- **Two concurrent sessions on one repo MUST use separate worktrees.** A shared checkout is one working tree: a second session switching branches corrupts the first session's in-flight gate. This includes `claude-config` and the docs repo — a session touching junctioned workspace files commits into whatever branch claude-config's working tree is on. (2026-06-12: working tree flipped to `feat/wave-9-token-components` mid-e2e-gate → motion stories absent, false timeouts, a blocked task. 2026-07-01: concurrent session committed `motion.md` onto another wave's open `feat/native-subagents` branch.)
- **claude-config working tree on a foreign branch → defer junctioned-file commits.** Edit on disk (junction edits persist), log the deferral in the active checklist + a memory entry, revisit at wave close; commit with explicit paths only once the tree is back on main. Never commit onto another session's open branch. (2026-07-02: wave-15 brand-MD + reflect edits deferred past `docs/agent-validation`.)
- **Rebase-only workflow — linear history is required:**
  - Sync with main: `git fetch origin && git rebase origin/main` — never `git merge main`
  - Pull remote changes to same branch: `git pull --rebase` — never `git pull`
  - Set as default: `git config --global pull.rebase true`
  - Merge commits in a branch break GitHub's "Rebase and merge" PR strategy
  - **PR merge method: "Rebase and merge" ONLY — never squash-merge** (user directive 2026-07-21, after motion-pass PR #35 was squashed following the then-established squash practice). Branch commits land individually on main, staying true ancestors — so plain `git rebase origin/main` works for every follow-on branch. `gh pr merge <n> --rebase --delete-branch`.
  - **A branch built on a SQUASH-merged base, when main has diverged, must be SQUASH-integrated onto fresh main — not `rebase --onto`.** (HISTORICAL-BASE CASE ONLY as of 2026-07-21 — PRs merged before then were squashed, so branches based on that history still need this; rebase-merged PRs keep their commits as true ancestors and plain rebase works.) When the base was squash-merged, the previous wave's individual commits are NOT ancestors of main (only the squashed commit is), so `git rebase --onto origin/main <old-base>` replays the already-merged work and conflicts on every touched file. Instead: `git checkout -B <branch> origin/main`, bring the new wave's files (`git diff --name-only <wave-base> <wave-head> | grep -vxF <files-main-also-changed> | xargs git checkout <wave-head> --`), 3-way-merge (`git merge-file`) only the handful of files main independently changed (docs, schema), REGENERATE any colliding migration via `drizzle-kit generate` (never hand-edit the snapshot JSON), `pnpm install`, full gate, one integration commit. History loss is fine — the PR squash-merges anyway. (2026-07-17 chat wave B: 30 commits on a squash-merged base; main +4 PRs incl. a ui major bump + a migration-number collision; `rebase --onto` conflicted on commit 1/30, squash-integration was clean.)

**`claude-config` cannot take the worktree escape hatch for LIVE edits, but it can for COMMITS.** `skills/` junctions into `~/.claude/skills/` and `workspace/` into `~/code`, so the copy every session actually loads is the main checkout — a worktree edit changes files nothing reads. Consequence: check `git branch --show-current` before **any** claude-config edit, not only before committing, because a file already in another session's dirty set blocks the EDIT too. When blocked, the fix is not to wait: edit the live file on disk so routing stays correct, then cut a worktree from `origin/main`, apply the same change there, and PR it independently — the junction governs what loads, never where content is committed. Never commit onto another session's open branch; their PR stops describing its own contents. (2026-07-28: two payloads deferred against one branch in a day, with `/context` showing 50% of recent usage at 4+ parallel sessions — this is the steady state, not bad luck. The worktree route is what actually unblocked it.)
**A port scan is a snapshot, and a dead server frees its port to whoever asks next — so "checked the holder before launching" does not survive the launch.** The existing check-before-gates rule fires at the right moment and is still not enough: the scan can pass honestly, the server can then die (see the detached-launch rule under Code Quality), and a concurrent session's dev server can claim the freed port before anyone looks again. What the user then opens is a different repo on a different branch, served from the URL you handed them — and the mismatch reads as a defect in YOUR wave. Re-verify the holder (`Get-NetTCPConnection -LocalPort N -State Listen` → `Get-CimInstance Win32_Process -Filter "ProcessId=$pid"` → `CommandLine`) immediately before handing any URL to a user or a gate, and again after any restart. Pin every server to a session-unique port and hand over a **port→repo map**, never bare URLs; claim `:3000` only when an OAuth callback requires it, and claim it first if so. With 4+ parallel sessions the normal case (40% of usage, 2026-07-29 `/usage`), port ownership is contended by default. (2026-07-29 AdSense W1 QA: :3000 scanned free, cybond took it, cybond died, `scheduling-advisor-friends` claimed it, user QA'd that host's `/login`, correctly reported the wave's legal links missing — one QA round plus an in-repo re-diagnosis of a non-bug. Third recurrence of the port family, first where the pre-launch check had genuinely passed.)

### 4. Commit & Push Policy

- **Do not commit or push without explicit user approval**
- **User QA gate before PR (UI-facing waves):** when the wave's final task completes, spin up local dev fresh (`:3000` for apps with OAuth callbacks; wipe `.next`/build caches first if dependencies changed mid-wave — turbopack's persistent cache serves stale Tailwind CSS otherwise, 2026-07-08) and prompt the user to QA the feature hands-on BEFORE requesting push/PR approval. Proceed to the push request only after the user finishes QA or explicitly waives it (a blanket "go for it" on push counts as a waive for that wave, not permanently).
- Stage changes, present a clear summary, wait for approval
- **Before presenting any commit batch, re-read the task's unticked steps.** A step neither ticked nor represented in the staged diff is a stop signal — resolve it (do it, or mark deferred with reason) before the batch goes to the user. Reflect-timing rules don't catch this class; the omission happens at batch assembly. (2026-07-17 eb4: Step 2.4 wave-table row skipped at batch time → micro PR #99; third occurrence of the forced-follow-up-docs-PR class after #65, #96.)
- Co-Authored-By trailer required on all commits
- Conventional Commits format enforced by commitlint
- **Checklist ticks + orchestration-log lines land in the same action batch as the commit they record.** A session dying between commit and tick leaves disk truth ahead of checklist claims ("drafted uncommitted" that was committed; commits with no log line) — resume sessions burn a re-verification pass. (w2.6 S10 + wave-A Task 9, found 2026-07-12/14.)
- **After every push to a PR branch, verify CI passes:** `gh pr checks <number> --watch` — do not move on until all checks are green or explicitly dismissed by the user
- **Zero check runs on a PR ≠ passing — it may mean conflicts.** GitHub runs no `pull_request` CI on a conflicting PR (only deploy checks like Vercel appear). If `gh pr checks` shows only Vercel/no test jobs, check `mergeStateStatus` — rebase onto `origin/main` before trusting the PR. (2026-06-12: PR #55 opened conflicting after a same-day merge to main; looked check-clean, ran no CI.)

**A QA round that REOPENS a closed wave sweeps the CLOSURE claims the pre-QA close already wrote, not just the mechanic claims its own changes invalidate.** Status lines, wave tables, "checklist archived at `done/`" pointers — all written in anticipation of a close the QA round cancelled, and no task in the reopened wave owns them, because the task that wrote them is ticked. The reopening is itself the trigger to re-read them. (2026-07-28 dog-eat-dog wave 3a QA-R2d: repo `CLAUDE.md` said the wave was `DONE 2026-07-28` with its checklist in `done/` — neither was true, playtest still open and checklist still in `active/`. The step list that caught it named three invariant lines and the test count; both false closure claims sat outside its scope and would have shipped.)

### 6. Definition of Done

Every domain defines its own gate list — see the domain's `CLAUDE.md`. Universal to all: nothing is "done" until the domain gates pass at 100%, the repo's `README.md` + `CLAUDE.md` are updated, `.gitignore` and `.env.example` are current, no dead code or commented-out blocks remain, and `claude-md-management:reflect` has run at the wave close **before** requesting push/PR. Repo-level doc edits land in the wave branch, never a second PR.

Run `superpowers:verification-before-completion` before declaring anything done.

### 7. Context Hygiene

- Orchestrator stops at `<!-- COMPACT POINT -->` markers and prompts the user to run `/compact` (the agent cannot invoke it) — not ad-hoc
- **Every marker prompt hands the user a `/compact <focus>` string to paste.** `/compact` accepts free-form instructions that steer what the summary keeps; write them for the NEXT task, not the finished one — task name, files it touches, open blockers, deviations the summary must not drop. Unfocused, the summarizer over-weights the turns it just read, so a long finished task crowds out the two lines the next one needs. Full form → `agent-factory` `session-protocol.md`.
- **Marker stop is absolute.** Blanket task approval ("i trust you, go for it") never waives it — only an explicit user instruction to skip compaction itself does. (2026-07-01: two markers passed under a blanket go-ahead; user corrected.)
- **If no checklist exists, compact at every major task boundary** — a 5h+ uncompacted session is unacceptable regardless of marker presence
- **Any checklist with 8+ tasks MUST include `<!-- COMPACT POINT -->` markers every 3–4 tasks** — writing the checklist without them is incomplete. **A finalization task (full gates + preview + Lighthouse + docs + reflect + release tails) gets its own marker immediately BEFORE it** — those tails run long and unmarked; motion-pass ran T7+T8 on one context stretch and `/usage` showed 68% of spend at >150k context (2026-07-21).
- **Appending tasks to an active checklist re-triggers the marker rule.** Mid-wave additions (QA-driven fixes, feature extensions with their own spec) get a `<!-- COMPACT POINT -->` written at the end of the appended block, and the orchestrator prompts `/compact` at the spec→plan and plan→dispatch boundaries of the addition — the spec/plan are durably on disk; context doesn't need to carry the authoring turns. (2026-07-05: L10–L12 appended post-plan with no marker → 222k-token session; user flagged.)
- **User-QA rounds count as task boundaries.** Each QA round that ends in a commit is a boundary — after logging it, prompt `/compact` before starting the next round once the session has crossed ~2 such rounds. (2026-07-17 chat wave B: QA-R1→R5 + the integration ran with ONE early compaction; `/usage` showed 61% of spend at >150k context and the session ran 3 days — the single biggest cost driver. Re-prompt `/compact` EVERY ~2 QA rounds, not once per wave; a long QA tail is exactly when this slips.)
- **The marker CADENCE is per-task, so a task that is itself multi-round gets its markers written INSIDE it at plan time.** The two rules above fire at run time and both did their job on a 4-task wave that still spent 50% of its budget above 150k context — because a browser-QA task is one checklist entry and three-plus rounds of screenshots, measurement scripts, and fix cycles, and "every 3–4 tasks" places exactly zero markers inside it. When writing a plan, any task whose deliverable is a QA/gate LOOP rather than a single deliverable carries `<!-- COMPACT POINT -->` per round, not per task. (2026-07-28 settings-tabs: T3 ran 3 QA rounds under one marker.)
- **Visual-gate waves prompt `/compact` after EVERY gate pass**, not every 3–4 tasks — gate turns carry image reads (screenshots, contact sheets, rendered references) that are dead context weight the moment the user says pass. (2026-07-22 carsickyak P3: 3 compactions still left 38% of spend at >150k context.)
- `/clear` prompted by `reflect` skill at project end only — not mid-phase
- PreCompact hook archives the full transcript to `~/.claude/compact-archives/` before every compaction (safety net; marker discipline unchanged). (Added 2026-07-27.)
- `/rewind` partial summarize ("summarize from/up to here") available as a manual context tool — optional, never replaces markers. (2026-07-27.)
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

---

## Code Quality

**Universal rules:**
- No `any` — use `unknown` and narrow it
- No `@ts-ignore` / `eslint-disable` without a comment explaining why
- No dead code, no commented-out code, no `console.log`
- **Never round-trip UTF-8 (no BOM) text files through PowerShell `Get-Content`/`Set-Content` — ANY edition, pwsh 7 included, source files included** — the round-trip mojibakes em-dashes/arrows and/or stamps a BOM on write-back. Use the Edit/Write tools for file mutations (checklist ticks especially). Briefs for bulk rename/replace tasks must carry this rule explicitly — agents reach for the PS one-liner otherwise. (2026-07-01: a `-replace` pass corrupted a checklist. 2026-07-23 slot-W2 QA-R2: recurred under pwsh — implementer mojibaked + BOM'd a test file, self-recovered via git checkout + Edit redo.) (Hook-enforced since 2026-07-27 — PreToolUse guard blocks these calls; rule text stays as the why.)
- **A pipe after a gate command reports the pipe's exit code, not the gate's.** `just check 2>&1 | tail -60` in background reported "completed (exit 0)" while lint had FAILED — `tail` exits 0. Run gates unpiped with `; echo EXIT:$?` appended, and read the output before trusting completion. (2026-07-01: splash-handoff gate.) Same trap via background tasks: a background command ending in `; echo EXIT:$?` ALWAYS completes "exit 0" — the harness notification is the echo's exit, never the gate's. Grep the output file for the `EXIT:` line before trusting any background gate. (2026-07-14: two "completed (exit 0)" notifications hid EXIT:1 lint and EXIT:2 tsc failures.) Coverage claims read ALL FOUR metric lines from the vitest summary block (Statements/Branches/Functions/Lines) — tailing just Functions/Lines hid a 99.94% statements figure behind a "100% coverage" claim (2026-07-15). Dependency installs are gates too: run scratchpad/dep installs unpiped in the foreground — a backgrounded `npm install --silent 2>&1 | tail` reported clean while the install had failed (exit 128, transitive git-ssh dep); MODULE_NOT_FOUND right after a "clean" install means suspect a hidden install failure first. (2026-07-22 carsickyak P2: png-to-ico.) (Hook-enforced since 2026-07-27 for `| tail/head` on gate commands.)
- **Live LLM rounds on the user's API keys require per-run user clearance** — present lane, turn count, and expected writes first; read-only recon (code, logs, DB SELECTs) is always fine. Applies to orchestrator AND subagents: never dispatch a task whose steps fire live AI calls without the clearance recorded in the brief. (2026-07-14: wave-A Task 8 verification turns run unasked; user corrected.)
- **Bash cwd persists across tool calls.** After committing in another repo (claude-config, docs), the next git command runs THERE — a fetch+rebase once targeted claude-config instead of the working worktree, blocked only by a foreign dirty file. Multi-repo git ops use `git -C <path>` or re-`cd` in the same call. (2026-07-01.)
- **A local-only lint/format failure may be a line-ending checkout artifact, not real drift.** Before mass-rewriting (`prettier --write .`), check `git diff --numstat` (empty = EOL-only) and the committed blob's EOL (`git show HEAD:<file> | cat -A`); on Windows with `core.autocrlf=true` + no `.gitattributes`, CRLF-on-disk trips prettier's default `endOfLine:lf` while CI (Linux, LF) is already green. Fix at the source (`.gitattributes` `* text=auto eol=lf` + `.prettierrc` `endOfLine:"auto"`), don't churn files. (2026-06-30: a "repo-wide prettier drift, run prettier --write" flag was carried across two sessions as a blocker — it was a no-op CRLF artifact.)
- **When a library component generalizes app-local code, port the ACTUAL source's staging/timing verbatim — read the shipped file, not the spec's paraphrase.** The spec may describe intent ("Cy's bond" with a space) while the working code achieves it differently (gap from a CSS translate, no space char). Re-tune pixel/duration constants for the library's context (product `text-4xl` → library `text-7xl` needed the split translate to go ±12px→±32px or glyphs overlap). (2026-07-01: BrandSplash first port paraphrased the spec — wrong `'s` staging, dropped quote fade, an `animate-pulse` the product never had; cost a full re-QA round.)

**The Edit tool refuses to write through a symlink — pass the real target path.** `docs/SKILLS.md` and the other junctioned reference MDs resolve into `claude-config/workspace/`, and an edit aimed at the link is rejected rather than silently followed. The refusal is a guard, not a bug: writing through the link would land the change in a repo that does not track the file. (2026-07-28 description-audit.)
**A long-lived process launches through a plain `run_in_background` call — never `nohup … & sleep N; echo started`.** Same root as the pipe/echo rule above, one step worse: the reported exit code belongs to the `echo`, AND the detached child is orphaned, so it can die minutes later with nothing watching and no notification. The four servers launched as ordinary `run_in_background` calls in the same session all survived; the one wrapped in `nohup … & echo` reported "exit 0" and was gone by the time the user opened it. **Liveness-check before handing any URL over** — `curl -s -o /dev/null -w '%{http_code}' <url>` — because a dead server and a foreign server on the same port are indistinguishable from the URL alone. (2026-07-29 AdSense W1 QA; pairs with the port-ownership block under Branch Strategy.)

**Dependencies:**
- Always use the latest stable major version — stale majors are a blocker, not deferred debt
- Upgrading a major dependency mid-feature-PR is a bug: do it in a standalone housekeeping PR before the feature starts
- devDependency upgrades that land in the same commit as feature/coverage work can break release workflows — keep them separate

**Security:**
- OWASP Top 10 mitigations
- `.gitignore` is the first commit in every new repo
- Never commit `.env`, credentials, API keys, or tokens
- **Secrets never in request URLs** — OAuth client-credentials/token params go in the POST body, never the query string. Request URLs are not secret-safe: framework error messages (Next DYNAMIC_SERVER_USAGE embeds the fetch URL), access logs, and Sentry captures all echo them, and no coverage/tsc/axe gate catches it. Review grep: fetch calls interpolating URLSearchParams built from env secrets into a URL. (2026-07-24 carsickyak: real Twitch client_secret printed in the prod build log; POST-body fix + regression test.)
- `.env.example` documents all required vars — committed and kept current
- `t3-env` validates all env vars at startup
- Zod validates all inputs at system boundaries
- Rate limit all user-facing endpoints via Upstash
- **Advisory-parity sweep:** a security-advisory fix (pin/override/ignore) landed in one workspace repo gets its siblings checked the same session — same dep tree, same advisory, and CI on the sibling's next PR goes red otherwise. (2026-07-25 GHSA-mh99-v99m-4gvg: lib fix `fb6ac9f`, then the identical advisory re-diagnosed from scratch in the app repo a session later — `8a4ed89` mirrored the same pin + ignore.)

**A new audit rule born mid-wave re-sweeps what already shipped under the old rule — not just the case that spawned it.** The trigger case gets fixed because it is in hand; everything built before the rule existed keeps its pre-rule verdict silently, and no gate re-examines it. Sweep at rule birth, or write the deferral down with the target list. (2026-07-27/28 what-is-dark 3b: issue #23 — "audit gap and width JOINTLY, the compound case is what kills" — was born at E3; its remediation re-tuned only the strips that triggered it, and `Sh5FloorA`, shipped at E2 under the old separate-checks rule, reached the whole-branch review un-swept. Accepted on merits at #33, but by margin luck, not by process. Generalizes the advisory-parity sweep above from deps to any rule.)

---

## Orchestration

Agent factory: spawn protocol, dispatch template, performance-MD duty, escalation, type authoring — all in the `agent-factory` skill. Invoke it for any multi-task plan execution or `Agent()` dispatch decision.
Routing authority is `claude-config/agents/profiles/<type>.md` — type defs are general guidance only.
Every `Agent()` call sets `model:` explicitly from the profile's model sweet spot.
Auto permission mode is the default (`permissions.defaultMode: "auto"`, set 2026-07-28); deny rules + PreToolUse hooks are the hard backstop. Reverses the 2026-07-27 per-session-only decision.

- Dispatch prose never restates brief contents — point at the brief file; a paraphrase that drifts ("both-vars gate" vs the brief's client-only snippet) makes the implementer + reviewer burn a round reconciling the contradiction. (2026-07-04.) This binds REVIEWER constraint blocks too, and the copy source is the brief/plan — not the spec — when the two differ: a reviewer dispatch quoted the spec's "series rows only" while the brief carried the plan's `recurrence !== null`; the reviewer burned a round adjudicating a contradiction the orchestrator created. (2026-07-14, activities-grouping task 4.)

---

## When Stuck

Ask one focused question at a time. Surface uncertainty before writing code.
