---
name: worktree
description: New branch, worktree, or session isolation — use when starting branch work in any code repo, when parallel sessions need isolation, or when a worktree must be removed. Creates/removes feature worktrees with env files copied automatically. All branch work happens in worktrees; main checkouts stay on main.
---

# Worktree

The main checkout of every code repo never leaves `main` — all branch work happens in a worktree under `~/code/.worktrees/`. The script does the mechanical part.

## Create

```
node ~/code/claude-config/scripts/worktree.mjs new <repo> <slug> [--branch feat/x] [--install]
```

Cuts `feat/<slug>` from `origin/main` (warns if the cut isn't clean), copies env files per the repo's `.worktreeinclude` (default `.env` + `.env.local`), and optionally runs `pnpm install`.

After creating:
- Web repos need Playwright browsers before their first e2e — `pnpm exec playwright install chromium`.
- Give the dev server its own port; never reuse another session's. Verify who holds a port before trusting any URL or e2e run against it.

## Remove

```
node ~/code/claude-config/scripts/worktree.mjs remove <path>
```

Encodes the Windows-safe sequence (git remove → force → recursive delete → prune). Remove the worktree BEFORE deleting its branch — a checked-out branch can't be deleted.

## Rules

- `claude agents --cwd <repo>` (or `claude.exe agents --cwd <repo>` on this Windows setup) answers "is another session already active on this repo?" — run it before starting concurrent/multi-session branch work, not just before land.
- Two concurrent sessions on one repo always use separate worktrees.
- claude-config commits never happen on its main checkout — use the `git-ops` skill (`land.mjs`).
- `worktree.mjs list` shows every registered worktree across the workspace.
