# Migration — 2026-08 harness restructure

One-time steps on each machine after pulling the restructure branch. Everything
else (skills, docs, agents) re-links via `setup.ps1` / `setup.sh`.

## 1. Re-link skills

```powershell
.\setup.ps1   # links the new skills (plan, worktree, qa, git-ops, cleanup, reflect)
```

Then remove stale links for deleted skills in `~/.claude/skills/`:
`inline-execute`, `orchestrate`, `persona-debate`, `plan-premises`,
`git-recovery-ops`, `live-qa-traps`, `games-diagnostics`.

Also remove stale symlinks in `~/code/docs/` for `SKILLS.md` and
`ORCHESTRATOR.md` (their targets are gone).

## 2. Rewire hooks in ~/.claude/settings.json

Replace the whole `hooks` block with the one in `hooks/README.md` (Node
invocations of the `.mjs` set). Notes:

- `stop-reflect-gate` is now RELAXED — reminds once per stop, never hard-blocks.
- `sessionstart-compact-reminder.ps1` is replaced by `session-start.mjs` (also lists active checklists).
- `gate-output-filter` and `permissiondenied-log` entries are retired — delete them (`qa.mjs` supersedes the filter).
- Keep the `deny` rules for `git add -A` forms — deliberate two-layer with the guard.

## 3. Uninstall plugins

All vendored plugins are replaced by owned skills / built-ins:

```
claude plugin uninstall superpowers claude-md-management vercel sentry stripe frontend-design caveman skill-creator
```

(Names as installed — check `claude plugin list`.) The `overrides/` junction
into the plugin cache is gone; if the cache dir for claude-md-management is
still a junction into this repo, remove the junction before uninstalling.
Remove any `skillOverrides` entries in settings.json.

Replacements: brainstorming/writing-plans → plan mode + `plan` skill ·
reflect → owned `reflect` skill · worktrees → `worktree` skill ·
TDD/debugging/verification → domain DoD gates · code-review flows → built-in
`/code-review` · writing-skills → built-in `skill-creator` ·
vercel/sentry/stripe knowledge → web-recon + provider docs (distill a
one-pager into `workspace/docs/web/` only if a real gap shows).

## 4. Verify

```
node --test scripts/test/*.test.mjs        # all suites green
echo '{"tool_input":{"command":"git add -A"}}' | node hooks/bash-guard.mjs   # exit 2
```

In a fresh session: the session-start hook should list active checklists;
`/skills` should show the owned set and no plugin skills.

## 5. Archive (already done in the docs repo)

Retired text — old root/web CLAUDE.md, SKILLS.md, plan-premises case law,
agent profiles, agent-factory protocols — lives in
`~/code/docs/harness-evolution/archive/`. Nothing was deleted from history.
