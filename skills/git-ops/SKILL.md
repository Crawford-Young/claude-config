---
name: git-ops
description: Use for workspace git conventions — landing claude-config changes, finishing a branch, syncing after a merge, or recovering from a failed rebase or stuck worktree. Carries the land.mjs commit lane and the recovery signatures.
---

# Git Ops

## Conventions (all repos)

- Rebase-only history — `git pull --rebase`, never merge commits; PRs merge via "Rebase and merge", never squash.
- No commit or push without user approval. Conventional Commits (commitlint enforces).
- Explicit paths always — `git add <paths>` then `git commit --only <paths>` in shared repos (the bash-guard hook blocks `add -A` and env files).
- Docs repo (`~/code/docs`) commits directly to `master`; code repos branch via the `worktree` skill.
- Auto-fix (`/autofix-pr` on the PR branch, or the toggle at claude.ai/code; needs the Claude GitHub App on the repo) is the unattended lane for "watch checks until green" when a session will end first — the user turning it on is push approval for that one PR only, because it pushes fixes without asking. It gets no webhook for a base-branch conflict, so zero check runs still means check mergeability yourself.
- Ultrareview (`/code-review ultra`, user-launched): offer it only for high-stakes PRs (auth, payments, migrations, anything that deletes refs, branches or data), because the free runs are few and extra usage is off.

## claude-config commit lane

The main checkout is the live junction surface — it never leaves `main` and never commits. The script runs the whole lane:

```
node ~/code/claude-config/scripts/land.mjs start <slug> -m "msg" -- <paths...>
# → ephemeral worktree from origin/main, path-scoped diff applied, committed
# → user approval → push, PR, rebase-merge
node ~/code/claude-config/scripts/land.mjs sync -- <paths...>    # after merge
node ~/code/claude-config/scripts/land.mjs finish <slug>         # remove worktree
```

Live edits land on the main checkout's disk (that's what junctions load); `land.mjs` carries only YOUR paths into the commit, so concurrent sessions' in-flight edits stay behind.

## Recovery signatures

Load [`recovery.md`](./recovery.md) only when one of these actually fires:

- A rebase onto main conflicts on **every** touched file → squash-based-branch integration.
- `git worktree remove` fails on Windows → `worktree.mjs remove` already encodes the sequence.
- `merge --ff-only` refuses over an untracked file identical to an incoming one → byte-verify, delete local copy, re-merge.
