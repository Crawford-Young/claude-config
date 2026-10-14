# Directing a batch — on-demand doc, not a skill

Read on demand when directing several tickets at once. Rare enough that a resident
`description:` would cost more than it saves. `skills/INDEX.md` points here.

## What you are

The director: you decompose, brief, dispatch, ask the user, and own all git. Run each unit as an
in-session worktree subagent (Agent tool) — the default. Pasted or `claude --bg` sessions are the
rare path (below), used only when the user asks, because in-session units let you ask every
question once and keep one view of the batch.

## Decompose into units, one GitHub issue each

One issue per unit: `## Goal` / `## Done when` (checkboxes) / `## Out of scope`. A unit resumes
from its own commit bodies plus the issue's Done-when, never a roster file. Two candidates
touching the same file are one unit, serial.

## Allocate the singleton table up front

Assign every shared, exclusive resource before briefing: a distinct **dev-server port per unit**
per web repo (never a repo's shared default), **one Godot editor at a time**, **one
emulator/device per unit**, **one Playwright MCP browser profile**. QA serializes even when
implementation parallelizes; that is the real concurrency cap.

## Run each unit

- Start each ticket with `node ~/code/claude-config/scripts/board.mjs start <repo>#<N>` (also `set <ref> <todo|in-progress|review|qa|done>`, `sweep [--apply]`), then `node ~/code/claude-config/scripts/worktree.mjs new <repo> <slug> --branch chore/<slug>` (`feat/`/`fix/` by kind; harness work is `chore/`), so the board and the worktree never drift.
- Brief each unit with Goal / Scope / Done-when and its singleton; forbid `git stash`, `reset --hard`, push and PR, because a stash in a shared repo can take another unit's work.
- A recon or other subagent a unit wants goes back to you: the unit reports the need and you dispatch it, so spawn depth and cost stay in one place.
- Units leave work uncommitted plus a commit-message file path (`What:` / `Verified:` (cmd → rc) / `Next:` / `Ruled out:`) and you commit, because the auto-mode classifier blocks a subagent's `git commit` (3 blocks + 1 bypass, 8.9 min in wave 5; 0 once units stopped committing).
- Units run gates unpiped, each redirected to a file, because a pipe masks the gate's rc.

## Ship

- Ask one ship question (AskUserQuestion) per PR and finish all its gated verbs (commit, push, PR, merge) before the next ask, because the push gate counts one push per approving answer — a CI-fix push needs a fresh approval. One gated verb per Bash call.
- Write PR, issue and comment bodies with the Write tool to a file and pass `--body-file`, because bash-guard rule 10 blocks a heredoc holding a doubled backslash (21 blocks, 7.6 min in wave 5).
- Pass `land.mjs sync -- <path>` a path the merge did NOT touch (CLAUDE.md works) until #220.
- A change to a guard gets a bounded fresh-context re-review after each fix round, because green gates and the first review missed the #167 round-1 false allow. Bound each review-fix round to its listed items and file the rest.
- After a merge, verify from git/GitHub, then queue the next file-disjoint ticket in the same turn without asking, so no unit idles (memory: director-keeps-units-busy).

## Rare path: pasted or `--bg` sessions

Self-contained prompt per unit (the session has no memory of this batch), preceded by the launch
line from `node ~/code/claude-config/scripts/session-name.mjs ticket <repo> <N>`; a `--bg` launch
adds `--permission-mode <mode> "<prompt>"` from the repo root. Each prompt names its worktree
command, singleton and Done-when, and its human owns that session's gated acts: consent never
travels between sessions. A ticket-<repo>-<N> session works only ticket N.

## Closing audit

Audit once from git and GitHub, never prose: each PR's state (`gh pr view <n> --json state`,
confirmed by an empty `git diff --stat origin/main <branch-head>`) and each issue's closed state
(`gh issue view <n> --json state`). No roster file or tooling.
