---
name: git-ops
description: Use for workspace git conventions — landing claude-config changes, finishing a branch, syncing after a merge, recovering from a failed rebase or stuck worktree, or sweeping the workspace at end-of-wave. Carries the land.mjs commit lane, cleanup.mjs, and the recovery signatures.
disable-model-invocation: true
---

# Git Ops

## Conventions (all repos)

- Branch per feature/fix (`feat/` `fix/` `chore/` `refactor/`), always in a worktree.
- Rebase-only history — `git pull --rebase`, never merge commits; PRs merge via "Rebase and merge", never squash.
- Conventional Commits (commitlint enforces).
- Explicit paths always — `git add <paths>` then `git commit --only <paths>` in shared repos (the bash-guard hook blocks `add -A` and env files).
- Docs repo (`~/code/docs`) commits directly to `master`.
- Board: PR open → Review, merge → Done, by itself. A `prod`-topic merge runs `node ~/code/claude-config/scripts/board.mjs set <repo>#N qa`, a QA pass `set … done`.
- Auto-fix (`/autofix-pr` on the PR branch, or the toggle at claude.ai/code; needs the Claude GitHub App on the repo) is the unattended lane for "watch checks until green" when a session will end first — the user turning it on is push approval for that one PR only, because it pushes fixes without asking. It gets no webhook for a base-branch conflict, so zero check runs still means check mergeability yourself.
- A multi-repo ship asks once per repo — one approving answer covers one branch's push, PR create, CI-fix pushes and merge, so the second repo's push needs its own `AskUserQuestion`.
- Ultrareview (`/code-review ultra`, user-launched): offer it only for high-stakes PRs (auth, payments, migrations, anything that deletes refs, branches or data), because the free runs are few and extra usage is off.

## claude-config commit lane

The main checkout is the live junction surface — it never leaves `main` and never commits. The script runs the whole lane:

```
node ~/code/claude-config/scripts/land.mjs start <slug> -m "msg" -- <paths...>
# → ephemeral worktree from origin/main, path-scoped diff applied, committed
# → user approval → push, PR, rebase-merge
node ~/code/claude-config/scripts/land.mjs sync                  # after merge; with live edits on main: sync -- <landed paths...>
node ~/code/claude-config/scripts/land.mjs finish <slug>         # remove worktree
```

Live edits land on the main checkout's disk (that's what junctions load); `land.mjs` carries only YOUR paths into the commit, so concurrent sessions' in-flight edits stay behind.

## End-of-wave sweep

```
node ~/code/claude-config/scripts/cleanup.mjs                       # report: dirty repos, worktrees, board drift
node ~/code/claude-config/scripts/cleanup.mjs --kill-port 3000      # kill a dev-server port holder
node ~/code/claude-config/scripts/cleanup.mjs --remove-worktree <p> # safe worktree removal
```

Gates green (Read `skills/qa/SKILL.md`), then `cleanup.mjs` — resolve everything it reports: commit-or-explain uncommitted files, remove finished worktrees, kill stale servers, fix board drift (command printed). Anything left for a next session → Read `skills/continuation/SKILL.md` before ending the session.

## Recovery signatures

Load [`recovery.md`](./recovery.md) only when one of these actually fires:

- A rebase onto main conflicts on **every** touched file → squash-based-branch integration.
- `git worktree remove` fails on Windows → `worktree.mjs remove` already encodes the sequence.
