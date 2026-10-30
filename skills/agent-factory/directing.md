# Directing — on-demand doc, not a skill

Read on demand when directing several tickets at once. `skills/INDEX.md` points here.

## What you are

The one director: you decompose, brief, spawn, ask the user, and own all git. Every other worker is an agent that you or another agent spawned (lanes and names: `SKILL.md`). In-session subagents are the default, because you ask every question once and keep one view of the batch. Questions from any agent bubble up to you, since AskUserQuestion is absent in subagents (#272 probes).

## Decompose into units, one GitHub issue each

One issue per unit: `## Goal` / `## Done when` (checkboxes) / `## Out of scope`. A unit resumes from its own commit bodies plus the issue's Done-when, never a roster file. Two candidates touching the same file are one unit, serial.

## Allocate the singleton table up front

Assign every shared, exclusive resource before briefing: a distinct **dev-server port per unit** per web repo (never a repo's shared default), **one Godot editor at a time**, **one emulator/device per unit**, **one Playwright MCP browser profile**. QA serializes even when implementation parallelizes; that is the real concurrency cap.

## Run each unit

- Start each ticket with `node ~/code/claude-config/scripts/board.mjs start <repo>#<N>` (also `set <ref> <todo|in-progress|review|qa|done>`, `sweep [--apply]`), then `node ~/code/claude-config/scripts/worktree.mjs new <repo> <slug> --branch chore/<slug>` (`feat/`/`fix/` by kind; harness work is `chore/`), so the board and the worktree never drift.
- Brief each unit with Goal / Scope / Done-when and its singleton; forbid `git stash`, `reset --hard`, push and PR, because a stash in a shared repo can take another unit's work.
- Keep rules every unit shares in one file beside the batch state, never in a scratchpad, and name the commit-message folder in each brief, because a scratchpad path dies with its session (the philosophy-audit batch's unit-rules.md named a dead one for two windows).
- Name every spawn `<role>_<kind>_<target>` from `session-name.mjs`, so audit and reflect group an issue's agents under it. Redo an existing name by SendMessage first; a fresh dispatch picks a new role label (`review-2`), so the name you dispatch is the name you address.
- Units leave work uncommitted plus a commit-message file (`What:` / `Verified:` (cmd → rc) / `Next:` / `Ruled out:`) and you commit, because the auto-mode classifier blocks a subagent's `git commit` (3 blocks + 1 bypass in wave 5; 0 once units stopped committing).
- Cap each unit's final report at about 2k characters, detail in its commit-message file and gate logs, because a longer result is cut off and costs a SendMessage round-trip, and Claude Code refuses a subagent's `report-*.md` write (2026-10-15 to 10-19).
- Post each review verdict, and the worktree's uncommitted state, to the issue as soon as it arrives, because a window can end without a handoff (3b14fba3's #243 PASS and #214 rounds were lost; the next window paid to review both again).

## Ship

- Ask one ship question (AskUserQuestion) per PR, covering all its gated verbs (push, PR, merge), and make its first gated call a lone `git push <remote> <branch>` (nothing chained; shapes in hooks/README.md rule 8), because that binds the answer to the branch until its merge — CI-fix pushes ride on it — while any other first call leaves it one push, one PR and one merge (#305). One gated verb per Bash call.
- Rebase a branch cut before another PR merged and re-run its gates before its ship question, because a rule that landed in between can fail it (#275's mkdtemp ban vs the #271 A/B tests, 116f2c0).
- After a merge, sync main: claude-config runs plain `land.mjs sync` (it fast-forwards a clean main and refuses live edits; then name the landed paths), any other repo `git -C <repo> merge --ff-only origin/main`, because land.mjs only syncs claude-config (strate stayed 66 behind under its "synced" line, 2026-10-19).
- A change to a guard gets a bounded fresh-context re-review after each fix round, because green gates and the first review missed the #167 round-1 false allow. Bound each round to its listed items and file the rest; from round 2 on, list only regressions against main and unticked Done-when items, because 3 of #249's 4 fix-round regressions came from fixing false allows main also had. After 3 NEEDS-FIX reviews, ship the regression-free subset (revert what still regresses) and file the rest (#249 took 6). Units probe the guard by piping JSON to the hook, never by running the command, and write probe files with Write (reviewers too), never a heredoc or double-quoted script, because a #239 reviewer's heredoc ran a real `git push` on main and a #249 implementer's backticks ran `rm -f`.
- Tick a Done-when item that asks for a reproduction only with one; otherwise ask the user to accept the residual before merging, because #250 shipped (PR #251) on a probable cause with that box ticked.
- After a merge, verify from git/GitHub, then queue the next file-disjoint ticket in the same turn without asking, so no unit idles (memory: director-keeps-units-busy).

## Closing audit

Audit once from git and GitHub, never prose: each PR's state (`gh pr view <n> --json state`, confirmed by an empty `git diff --stat origin/main <branch-head>`) and each issue's closed state (`gh issue view <n> --json state`). No roster file or tooling.

Then Read `~/code/claude-config/skills/reflect/SKILL.md` and run it once for the batch.
