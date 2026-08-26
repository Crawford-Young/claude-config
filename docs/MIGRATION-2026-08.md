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

**Uninstall only what an owned skill actually replaces.** A plugin whose
capability nothing here reproduces is a capability loss, not a simplification —
check `claude plugin list` and sort before running anything.

Replaced — safe to uninstall:

```
claude plugin uninstall superpowers claude-md-management sentry stripe code-simplifier github custom-skills
```

- brainstorming / writing-plans → plan mode + the `plan` skill
- reflect → the owned `reflect` skill
- using-git-worktrees → the `worktree` skill
- TDD / systematic-debugging / verification-before-completion → domain DoD gates
- requesting/receiving-code-review → built-in `/code-review`
- code-simplifier → built-in `/simplify`
- writing-skills → built-in `skill-creator` (leave it installed — it IS the replacement)
- sentry / stripe knowledge → `web-recon` + provider docs (distill a one-pager
  into `workspace/docs/web/` only if a real gap shows)

Not replaced — decide before touching, and keep by default:

| Plugin | Why it survives the restructure |
|---|---|
| `caveman` | Active output mode with a live SessionStart hook. Nothing here reproduces it — uninstalling silently ends caveman mode. |
| `vercel` | Deep platform reference (Next.js, AI SDK, deployments, storage) for the primary web stack. Plugin skills cost only their description line until invoked. |
| `frontend-design` | No owned equivalent; `visual-asset-gates` covers assets and gates, not aesthetic direction. |
| `playwright`, `typescript-lsp` | Tooling, not guidance — unaffected. |

The `overrides/` junction into the plugin cache is gone; if the cache dir for
claude-md-management is still a junction into this repo, remove the junction
before uninstalling. Remove any `skillOverrides` entries in settings.json.

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
