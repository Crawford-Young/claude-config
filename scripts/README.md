# `claude-config/scripts/`

Workflow scripts (`.mjs`, Node builtins only, cross-platform). Each script's
header comment is the authority on its flags; tests live in `test/` and run
with `node --test scripts/test/*.test.mjs`.

| Script | Purpose |
| --- | --- |
| `worktree.mjs` | Create/remove/list feature worktrees — branch from `origin/main`, env copy per `.worktreeinclude`, Windows-safe removal |
| `qa.mjs` | Run the repo's own gates foreground + unpiped; full logs to `~/.claude/qa-logs/`, compact honest summary to the console |
| `land.mjs` | The claude-config commit lane — ephemeral worktree from `origin/main`, path-scoped diff, post-merge sync |
| `cleanup.mjs` | End-of-wave sweep — dirty repos, worktrees; `--kill-port`, `--remove-worktree` |
| `reflect-gather.mjs` | One-pass reflect payload: a unit's evidence via `audit.mjs --session <name>` plus per-repo git activity |
| `audit.mjs` (+ `audit-lib.mjs`, `prices.json`) | Transcript-replay audit over `~/.claude/projects`: $ and context depth per day/session, per-agent-type cost, skill/slash/doc invocation counts (a Read of `skills/<name>/SKILL.md` counts as a skill invocation), hook blocks and timings, cross-checked against Claude Code's own `cost-state`. Time beside the $ (#97): wall vs active (`--idle-gap`, default 10 min), the model/tools/user/other split per day/session/name, wall time per agent run and type, tool and command latency p50/p95, retry and block cost per hook or gate. Inline Edit/Write calls vs Agent dispatches per main session (#99). Re-verify `prices.json` when it warns |
| `lib.mjs` | Shared helpers (workspace root, git, argv) |
| `harness-map.mjs` | `check` (CI): `harness-map.json` has a node for every skill, hook, agent, script and CLAUDE.md, and nothing dangles. `render <out>` builds the diagram page from `harness-map.template.html` |
| `guard-replay.mjs` | `node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--files N] [--days D]` (#106) — replays unique Bash/PowerShell commands and AskUserQuestion answers from recent local transcripts (`$CLAUDE_CONFIG_DIR` or `~/.claude`, newest 30 files by default) through both checkouts' `staticCheck`/`gatedVerbs`/`browserCommand`/`isApproving`/`isBrowserApproving`; one line per changed verdict plus a summary. Run before a guard or approval PR. Report only, exit 0 |
| `verify-frontmatter.mjs` | CI gate — every SKILL.md publishes a usable name + description (the unquoted `: ` YAML trap silently unpublishes a skill); also enforces resident-byte caps on descriptions (skills flagged `disable-model-invocation` excluded), `skills/INDEX.md` (which must list every skill, #64) and each `CLAUDE.md` (issue #63) so resident context can't silently re-bloat |
| `export-harness.ps1` / `import-harness.ps1` | Move harness config between machines |
| `open-admin-shells.ps1` | Elevated shells for junction work |

**Retention:** `audit.mjs` replays transcripts, and Claude Code deletes them after `cleanupPeriodDays` (default 30). `~/.claude/settings.json` (user-level, untracked) sets `"cleanupPeriodDays": 365` (#62, 2026-10-08) - keep it, or the audit loses its data. The OTel receiver that once captured cost was deleted (#76, #104).

Env overrides (tests/remotes): `CLAUDE_WORKSPACE_ROOT` (default `~/code`),
`CLAUDE_CONFIG_REPO`.

Retired 2026-10 (#72, tracking moved to GitHub issues): `checklist.mjs`, `session-state.mjs`.

Retired 2026-08: `verify-relocation.mjs` + `baseline/` (the relocation gate —
byte-tracking of relocated prose ended with the restructure; text history
lives in git and `docs/harness-evolution/archive/`).
