# `claude-config/scripts/`

Workflow scripts (`.mjs`, Node builtins only, cross-platform). Each script's
header comment is the authority on its flags; tests live in `test/` and run
with `node --test scripts/test/*.test.mjs`.

| Script | Purpose |
| --- | --- |
| `worktree.mjs` | Create/remove/list feature worktrees — branch from `origin/main`, env copy per `.worktreeinclude`, Windows-safe removal |
| `checklist.mjs` | Scaffold/tick/archive wave checklists (real UTC done-stamps keep OTel attribution working) |
| `qa.mjs` | Run the repo's own gates foreground + unpiped; full logs to `~/.claude/qa-logs/`, compact honest summary to the console |
| `land.mjs` | The claude-config commit lane — ephemeral worktree from `origin/main`, path-scoped diff, post-merge sync |
| `cleanup.mjs` | End-of-wave sweep — dirty repos, worktrees, active checklists; `--kill-port`, `--remove-worktree` |
| `reflect-gather.mjs` | One-pass reflect payload: checklist, issue logs, per-repo git activity |
| `session-state.mjs` | Mechanical half of a continuation prompt: active checklists + repo states |
| `lib.mjs` | Shared helpers (workspace root, git, checklist discovery, argv) |
| `verify-frontmatter.mjs` | CI gate — every SKILL.md publishes a usable name + description (the unquoted `: ` YAML trap silently unpublishes a skill) |
| `export-harness.ps1` / `import-harness.ps1` | Move harness config between machines |
| `open-admin-shells.ps1` | Elevated shells for junction work |

Env overrides (tests/remotes): `CLAUDE_WORKSPACE_ROOT` (default `~/code`),
`CLAUDE_CONFIG_REPO`, `STOP_GATE_DOCS_ROOT`.

Retired 2026-08: `verify-relocation.mjs` + `baseline/` (the relocation gate —
byte-tracking of relocated prose ended with the restructure; text history
lives in git and `docs/harness-evolution/archive/`).
