# `claude-config/scripts/`

Workflow scripts (`.mjs`, Node builtins only, cross-platform). Each script's
header comment is the authority on its flags; tests live in `test/` and run
with `node --test scripts/test/*.test.mjs`.

| Script | Purpose |
| --- | --- |
| `worktree.mjs` | Create/remove/list feature worktrees — branch from `origin/main`, env copy per `.worktreeinclude`, Windows-safe removal that first stops the serve-port listener; `prepush` runs commitlint over `origin/<base>..HEAD`; `new` prints the session launch line and warns on a mismatched session name |
| `session-name.mjs` | Prints the `claude -n <name>` launch line for a session: `director <scope>`, `epic <repo> <N>`, `ticket <repo> <N> [role] [--round K]`, or `general <topic words…>`; or an in-session subagent's bare tree name, `tree <dir> <repo> [--epic N] [--ticket N] [--worker impl\|review\|recon [--round K]]` (#272). Spend and reflect join on the parsed name |
| `qa.mjs` | Run the repo's own gates (justfile, package.json, or marker files like `scripts/test/*.test.mjs`) foreground + unpiped; full logs to `~/.claude/qa-logs/`, compact honest summary to the console |
| `land.mjs` | The claude-config commit lane — ephemeral worktree from `origin/main`, path-scoped diff, post-merge sync |
| `cleanup.mjs` | End-of-wave sweep — dirty repos, worktrees, board drift (via `board.mjs sweep`); `--kill-port`, `--remove-worktree` |
| `board.mjs` | Issue status on the "All tickets" board (user project 7, #149): `start <ref>` (grab: `in-progress` label + In Progress), `set <ref> <todo\|in-progress\|review\|qa\|done>` (refuses Done on an open issue), `sweep [--apply]` (adds open issues of `board`-topic repos, reports drift; `--apply` fixes it). `BOARD_GH` stubs `gh` in tests |
| `reflect-gather.mjs` | One-pass reflect payload: a unit's evidence via `audit.mjs --session <name>` plus per-repo git activity limited to commits naming the issue of a ticket or epic session (`(#N)` or `<repo>#N`) and the open `debt` issues (via `gh`) naming files those commits touched |
| `audit.mjs` (+ `audit-lib.mjs`, `prices.json`) | Transcript-replay audit over `~/.claude/projects`: $ and context depth per day/session (a session row per named window: a file splits at each name change, #115; a named subagent's spend and time join its own `meta.json` name's row instead of its window's, #272), per-agent-type cost and its split per type × model × effort (#113: each run filed under the setting most of its requests used; effort read from the records), skill/slash/doc invocation counts (a Read of `skills/<name>/SKILL.md` counts as a skill invocation), hook blocks and timings, beside Claude Code's own `cost-state` total, which runs ~10% higher because it counts requests and subagent output the transcripts don't record (#116). Time beside the $ (#97): wall vs active (`--idle-gap`, default 10 min), the model/tools/user/other split per day/session/name, wall time per agent run and type, tool and command latency p50/p95, retry and block cost per hook or gate. Inline Edit/Write calls vs Agent dispatches per main session (#99). Re-verify `prices.json` when it warns. `--stamps` (no transcripts read) lists each `verified: YYYY-MM` stamp in the CLAUDE.md chain, `workspace/docs/`, `agents/` or `skills/` that names a model older than its line's newest in `prices.json`, exit 1 if any (#113); a normal run warns on them too |
| `lib.mjs` | Shared helpers (workspace root, git, argv) and the session-name format (`sessionName` / `parseSessionName` / `isChosenName`), tree names included |
| `harness-map.mjs` | `check` (CI): `harness-map.json` has a node for every skill, hook, agent, script and CLAUDE.md, and nothing dangles. `render <out>` builds the diagram page from `harness-map.template.html` |
| `guard-replay.mjs` | `node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--branch] [--full] [--files N] [--days D]` (#106) — replays unique Bash/PowerShell commands (each under the tool that ran it, #171) and AskUserQuestion answers from recent local transcripts, main and subagent (`$CLAUDE_CONFIG_DIR` or `~/.claude`, last 7 days by default) through both checkouts' `staticCheck`/`gatedVerbs`/`browserCommand`/`isApproving`/`isBrowserApproving`; one line per changed verdict plus a summary. `--branch` (#165) adds a per-call `gitCalls` diff and `branchRules` allow/BLOCK changes on a temp unborn and a temp born repo (~15s over 5k commands). `--full` (#168) follows each changed line with the whole command (redacted) and branchRules' new block reason. Run before a guard or approval PR. Report only, exit 0 |
| `verify-frontmatter.mjs` | CI gate — every SKILL.md publishes a usable name + description (the unquoted `: ` YAML trap silently unpublishes a skill); also enforces resident-byte caps on descriptions (skills flagged `disable-model-invocation` excluded), `skills/INDEX.md` (which must list every skill, #64) and each `CLAUDE.md` (issue #63) so resident context can't silently re-bloat; also reports (no cap, never fails) the description bytes of synced claude.ai skills and plugin skills under `~/.claude` (#124; `--synced-skills` / `--synced-plugins` override the dirs) |
| `export-harness.ps1` / `import-harness.ps1` | Move harness config between machines |
| `open-admin-shells.ps1` | Elevated shells for junction work |

**Retention:** `audit.mjs` replays transcripts, and Claude Code deletes them after `cleanupPeriodDays` (default 30). `~/.claude/settings.json` (user-level, untracked) sets `"cleanupPeriodDays": 365` (#62, 2026-10-08) - keep it, or the audit loses its data. The OTel receiver that once captured cost was deleted (#76, #104).

Env overrides (tests/remotes): `CLAUDE_WORKSPACE_ROOT` (default `~/code`),
`CLAUDE_CONFIG_REPO`.

Retired 2026-10 (#72, tracking moved to GitHub issues): `checklist.mjs`, `session-state.mjs`.

Retired 2026-08: `verify-relocation.mjs` + `baseline/` (the relocation gate —
byte-tracking of relocated prose ended with the restructure; text history
lives in git and `docs/harness-evolution/archive/`).
