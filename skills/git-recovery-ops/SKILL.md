---
name: git-recovery-ops
description: Use when a git operation fails in a way the normal rebase-only workflow does not cover — a branch that conflicts on every file when rebased onto main, or a Windows worktree that refuses to be removed. Load at the moment the failure appears, not preventively; these are recovery procedures for two specific failure signatures, not part of the routine branch flow.
---

# Git Recovery Ops

Relocated from `~/code/CLAUDE.md` on 2026-07-30 (`/doctor` check 4). Both
procedures are single-signature recoveries: they fire when a specific failure
appears, so they were paying always-loaded context cost in every session of
every domain to be read almost never. The routine rules they hang off —
rebase-only, PR merge method, worktree-per-session — stay in `~/code/CLAUDE.md`.

## Signature 1: a rebase onto main conflicts on every touched file

Canonical rule, verbatim from `~/code/CLAUDE.md` §3 (relocated 2026-07-30):

> **A branch built on a SQUASH-merged base, when main has diverged, must be SQUASH-integrated onto fresh main — not `rebase --onto`.** (HISTORICAL-BASE CASE ONLY as of 2026-07-21 — PRs merged before then were squashed, so branches based on that history still need this; rebase-merged PRs keep their commits as true ancestors and plain rebase works.) When the base was squash-merged, the previous wave's individual commits are NOT ancestors of main (only the squashed commit is), so `git rebase --onto origin/main <old-base>` replays the already-merged work and conflicts on every touched file. Instead: `git checkout -B <branch> origin/main`, bring the new wave's files (`git diff --name-only <wave-base> <wave-head> | grep -vxF <files-main-also-changed> | xargs git checkout <wave-head> --`), 3-way-merge (`git merge-file`) only the handful of files main independently changed (docs, schema), REGENERATE any colliding migration via `drizzle-kit generate` (never hand-edit the snapshot JSON), `pnpm install`, full gate, one integration commit. History loss is fine — the PR squash-merges anyway. (2026-07-17 chat wave B: 30 commits on a squash-merged base; main +4 PRs incl. a ui major bump + a migration-number collision; `rebase --onto` conflicted on commit 1/30, squash-integration was clean.)

Expanded as steps:

HISTORICAL-BASE CASE ONLY as of 2026-07-21: PRs merged before that date were
squashed, so branches based on that history still need this. Rebase-merged PRs
keep their commits as true ancestors, and plain `git rebase origin/main` works.

When the base was squash-merged, the previous wave's individual commits are NOT
ancestors of main — only the squashed commit is — so
`git rebase --onto origin/main <old-base>` replays already-merged work and
conflicts on every touched file.

Instead:

1. `git checkout -B <branch> origin/main`
2. Bring the new wave's files:
   `git diff --name-only <wave-base> <wave-head> | grep -vxF <files-main-also-changed> | xargs git checkout <wave-head> --`
3. 3-way-merge (`git merge-file`) only the handful of files main independently
   changed (docs, schema)
4. REGENERATE any colliding migration via `drizzle-kit generate` — never
   hand-edit the snapshot JSON
5. `pnpm install`, full gate, one integration commit

History loss is fine — the PR squash-merges anyway.

(2026-07-17 chat wave B: 30 commits on a squash-merged base; main +4 PRs incl. a
ui major bump + a migration-number collision. `rebase --onto` conflicted on
commit 1/30; squash-integration was clean.)

## Signature 2: `git worktree remove` fails on Windows

Canonical rule, verbatim from `~/code/CLAUDE.md` §3 (relocated 2026-07-30):

> **Windows worktree removal:** `git worktree remove` reliably fails on a worktree with `node_modules` (file locks, then >260-char long paths in react-server-dom). Working sequence: `git worktree remove --force` → `Remove-Item -Recurse -Force` from a shell whose cwd is OUTSIDE the worktree → robocopy `/MIR` empty-dir mirror for long-path remnants → `git worktree prune`. (2026-07-16: hit 2× in one day, w16 + eb2 worktrees.)

Expanded as steps:

1. `git worktree remove --force`
2. `Remove-Item -Recurse -Force` from a shell whose cwd is OUTSIDE the worktree
3. robocopy `/MIR` empty-dir mirror for long-path remnants
4. `git worktree prune`

(2026-07-16: hit 2× in one day, w16 + eb2 worktrees.)

## Checkpoint coverage gap (G15, 2026-08-08)

`/rewind` checkpoints cover the main session's own file edits only — NOT subagent edits, NOT Bash-side file operations (`mv`, `sed -i`, script writes). A subagent wave gone wrong is git-only recovery: branch state + this skill's procedures. `/rewind` can recover conversation state from before a `/clear`.
