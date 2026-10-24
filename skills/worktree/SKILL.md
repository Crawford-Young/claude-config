---
name: worktree
description: New branch, worktree, or session isolation — use when starting branch work in any code repo, when parallel sessions need isolation, or when a worktree must be removed. Creates/removes feature worktrees with env files copied automatically. All branch work happens in worktrees; main checkouts stay on main.
disable-model-invocation: true
---

# Worktree

The main checkout of every code repo never leaves `main` — all branch work happens in a worktree under `~/code/.worktrees/`. The script does the mechanical part.

## Create

```
node ~/code/claude-config/scripts/worktree.mjs new <repo-path> <slug> [--branch feat/x] [--install]
```

`<repo-path>` resolves against the cwd (`claude-config` from `~/code`), not a repo name.

Cuts `feat/<slug>` from `origin/main` (warns if the cut isn't clean), copies env files per the repo's `.worktreeinclude` (default `.env` + `.env.local`), and optionally runs the install (`bun install` when `bun.lock`/`bun.lockb` exists, else `pnpm install`). In a husky repo it copies the main checkout's git-ignored `.husky/_/` stubs so `commit-msg` runs (a warning names the fix when there are none to copy); the hooks still need `node_modules`, so pass `--install` for a worktree you will commit from.

After creating:
- Web repos need Playwright browsers before their first e2e — `pnpm exec playwright install chromium`.
- Give the dev server its own port; never reuse another session's. Verify who holds a port before trusting any URL or e2e run against it.

## Push

```
node ~/code/claude-config/scripts/worktree.mjs prepush <path> && git -C <path> push -u origin <branch>
```

Runs commitlint over `origin/<base>..HEAD` when the repo has a commitlint config and fails the chain on a bad subject, so CI is never the first place it surfaces. The worktree's own `node_modules` wins; without one it borrows the main checkout's install, and with neither it fails closed. Reword, then re-run. The push stays a separate command, so its approval gate still applies.

## Remove

```
node ~/code/claude-config/scripts/worktree.mjs remove <path> [--port <n>] [--dry-run]
```

First stops whatever listens on the worktree's serve port, read from a serve/dev/start/preview recipe in the Justfile or package.json (`-p`, `--port` or `PORT=`), plus any `--port`. Stopping a `just serve` wrapper can leave its server alive and holding the directory. `--dry-run` names what it would stop and remove. Then it runs the Windows-safe sequence (git remove → force → recursive delete → prune). Remove the worktree BEFORE deleting its branch — a checked-out branch can't be deleted. Move the session out first: a Bash call that `cd`s into the worktree makes it the session's tracked cwd, which holds the directory (EPERM/EBUSY) — run a separate `cd ~/code` call before `remove`. A re-run finishes a half-removed (empty, pointer-less) directory.

## Session name

Lead the slug with the issue number (e.g. `72-issues-tracker`): on a branch that leads with it, session-start names any session started in the worktree `ticket-<repo>-<N>` unless it already has a title (#344), so `worktree.mjs new` prints `cd <worktree>; claude` as the ticket's launch line. With no issue number it prints a `claude -n general-<slug>` line and, when the current session has no chosen name, warns in the CLI or tells a desktop session to call `mcp__ccd_session_mgmt__set_session_title` (never blocks).

## Rules

- `claude agents --cwd <repo>` (or `claude.exe agents --cwd <repo>` on this Windows setup) answers "is another session already active on this repo?" — run it before starting concurrent/multi-session branch work, not just before land.
- Two concurrent sessions on one repo always use separate worktrees.
- claude-config commits never happen on its main checkout — Read `skills/git-ops/SKILL.md` (`land.mjs`).
- `worktree.mjs list` shows every registered worktree across the workspace.
