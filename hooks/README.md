# Hooks

Cross-platform Node hooks (2026-08 restructure — the old PowerShell set is in
git history). A rule that must hold every time lives here or in a deny rule,
never as CLAUDE.md prose. **Fail-open is the default**: errors append to
`~/.claude/hook-errors.log` and exit 0 — check that log first when a hook
seems silent. **Guards opt into fail-closed** (`bash-guard.mjs`,
`agent-model-guard.mjs`, `pre-model-switch.mjs`, via `run(..., { failClosed:
true })`): a fail-open guard failure is silent and unbounded (a crashed
`bash-guard` waves through `git add -A`; a crashed `agent-model-guard` waves
through an unclearanced usage-billed dispatch), while a fail-closed failure
is loud, immediate, and recoverable — the Edit tool is not gated by
`bash-guard`, so a guard can never lock anyone in.

| Script | Event (matcher) | Does |
|---|---|---|
| `bash-guard.mjs` | PreToolUse (`Bash\|PowerShell`) | Blocks: `git add -A/--all` in any flag order; staging/committing `.env` files (`.env.example` allowed); gate commands piped to `tail`/`head`; PS `Set-Content`/`Out-File`/`Add-Content` (mojibake); `git commit` on main/master in code repos (docs repo + worktrees exempt); branch switches on the claude-config main checkout. |

**Text matcher, not intent matcher** — `bash-guard.mjs` matches command *text*,
so it blocks any command that merely mentions a banned pattern as data (a
`node -e` script or heredoc carrying `git add .`/`git commit` in a test-fixture
array, a compound command reading `settings.json`), not just as an action.
Working as designed, same as the pre-existing `git add -A` rule. Workaround:
Write the content to a file, then run the file, instead of passing it through
a shell command line.

**Guard scoping** — three rules about *what a rule is allowed to read*, each one a
fixed false verdict; change them only with a test:

- Quoted `-m`/`--message` payloads are stripped first. A commit message is prose:
  `git commit -m "handle .env loading"` stages nothing and must not block.
- Flag rules are scanned **per clause**, so `git add -p a.ts && grep -A 3 x a.ts`
  is not a `git add -A`.
- The repo a git command targets is the payload cwd **walked through any leading
  `cd`**. The workspace root is not itself a repo, so `cd <repo> && git commit` is
  the shape the branch rules actually have to see — reading `payload.cwd` alone
  makes the commit-on-main rule a no-op in normal use.
| `agent-model-guard.mjs` | PreToolUse (`Agent`) | Blocks model-omitted dispatches on frontmatter-less types; blocks `fable\|mythos` dispatches without a live clearance marker; blocks forks on a live (or undeterminable) fable/mythos session. Ledger: `~/.claude/fable-dispatch.log`. Fails closed. |
| `fable-clearance-grant.mjs` | UserPromptSubmit | `FABLE OK` in the user's own prompt writes the single-use 30-min marker the Agent guard consumes. Speed bump + audit trail, not a hard gate. |
| `pre-model-switch.mjs` | PreModelSwitch | Blocks a `/model` switch **to** fable/mythos without a live `FABLE OK` marker (exit 2), consuming the same single-use 30-minute marker as the Agent guard. Switching away is never gated and never spends clearance. Ledger: `~/.claude/fable-dispatch.log`. Fails closed. |
| `post-model-switch.mjs` | PostModelSwitch | Records which model each session is on to `~/.claude/current-model.json`, keyed by `session_id`, newest 50 kept. Not a gate — it is the data `agent-model-guard.mjs` reads to catch a fork on a live fable session. Fires on Claude Code's own switches too (e.g. session resume), which is why records are never expired by age. |
| `permission-denied.mjs` | PermissionDenied | Logs denials to `~/.claude/permission-denials.log`. **This event cannot block** — its exit code and stderr are ignored by Claude Code and the denial stands regardless. |
| `context-gauge.mjs` | UserPromptSubmit | Reads the live context size from the transcript and forces a deliberate checkpoint before auto-compact can silently compact a wave boundary. Bands are fractions of the **live window** — note at 0.40, louder at 0.70 (once each), **blocks at 0.94**; 400k / 700k / 940k on today's 1M window, and silent when no source can name the window (thresholds section below). Escapes: any `/`-prefixed prompt, or `CONTEXT OK`. Bands re-arm when context drops back under the nudge line. Tune with `CLAUDE_CTX_WINDOW`, or per band with `CLAUDE_CTX_NUDGE` / `CLAUDE_CTX_WARN` / `CLAUDE_CTX_BLOCK`. |
| `stop-reflect-gate.mjs` | Stop | **Relaxed (2026-08-21):** when a recently-touched active checklist is all-ticked except reflect, blocks ONCE with "prompt the user to run reflect", then lets the retry pass (`stop_hook_active`). Reflect is prompted, never forced. |
| `session-start.mjs` | SessionStart | Emits active checklists (+ first unchecked task) into context; after a compaction adds the re-orientation reminder (domain CLAUDE.md reload). |
| `precompact-archive.mjs` | PreCompact | Copies the transcript to `~/.claude/compact-archives/` before every compaction. |
| `subagentstop-log.mjs` | SubagentStop | One line per stop to `~/.claude/subagent-stops.log` (self-trims: 512KB → last 200 lines). |
| `otel-receiver-spawn.mjs` | SessionStart | Lazy-spawns `telemetry/otel-receiver.mjs` on :4318 when nothing is listening. |
| `notification-toast.ps1` | Notification | Windows WinRT toast (WezTerm has no native notifications). Stays PowerShell — Windows-only integration. |

## settings.json wiring

Invoke via `node` with a forward-slash absolute path (backslashes get eaten by
JSON+shell). Adjust the repo path per machine:

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/bash-guard.mjs\"" }] },
    { "matcher": "Agent", "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/agent-model-guard.mjs\"" }] }
  ],
  "UserPromptSubmit": [ { "hooks": [
    { "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/fable-clearance-grant.mjs\"" },
    { "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/context-gauge.mjs\"" }
  ] } ],
  "Stop": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/stop-reflect-gate.mjs\"" }] } ],
  "SessionStart": [ { "hooks": [
    { "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/session-start.mjs\"" },
    { "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/otel-receiver-spawn.mjs\"" }
  ] } ],
  "PreCompact": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/precompact-archive.mjs\"" }] } ],
  "SubagentStop": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/subagentstop-log.mjs\"" }] } ],
  "Notification": [ { "hooks": [{ "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/young/code/claude-config/hooks/notification-toast.ps1\"" }] } ]
}
```

**Not yet wired** (director-owned `settings.json` — this table describes the
target wiring, not necessarily what is live; check the live file before
assuming these fire):

```json
"PermissionDenied": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/permission-denied.mjs\"" }] } ],
"PostModelSwitch": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/post-model-switch.mjs\"" }] } ],
"PreModelSwitch": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/pre-model-switch.mjs\"" }] } ]
```

None of the three events take a matcher.

Keep the settings `deny` rules for `git add -A` forms — the two layers
(deny rule + guard regex) deliberately overlap; change both or neither.

## Conventions

- Exit-code semantics: 0 = proceed, 2 = block (stderr is the reason), other = non-blocking error. A hook allow does NOT skip deny rules.
- Unit-test by piping JSON to stdin: `echo '{"tool_input":{"command":"git add -A"}}' | node hooks/bash-guard.mjs` — tests live in `scripts/test/`, run `node --test scripts/test/*.test.mjs`.
- Hook wiring reloads live — no session restart needed to verify new wiring.
- Env overrides for tests/remotes: `CLAUDE_WORKSPACE_ROOT`, `CLAUDE_CONFIG_REPO`, `STOP_GATE_DOCS_ROOT`.
- A hook that a test imports must guard its `run()` behind an `import.meta.url === pathToFileURL(process.argv[1]).href` check — an unguarded import blocks forever reading stdin.

## Context-gauge thresholds

The bands are **fractions of the live context window**, not fixed token counts:
`0.40` nudge, `0.70` warn, `0.94` block. On the 1M window in use today that is
400k / 700k / **940k**; on a 250k window it is the 100k / 175k / 235k this hook
shipped with — the ratios are unchanged, only the baked-in assumption that the
window *is* 250k is gone.

The window is resolved in this order: `CLAUDE_CTX_WINDOW`, then a
`contextGaugeWindow` key in `settings.json`, then the newest
`context_window_size` in `~/.claude/usage-history/<YYYY-MM>.jsonl` — the CLI's
own statusline figure, written there by `statusline/usage-statusline.ps1` on
every render (live value `1000000`; honours `CLAUDE_USAGE_HISTORY_DIR` the same
way the statusline does). If none of the three answers, the gauge stays **silent**
rather than invent a window. It never hardcodes one; that hardcoded 250k is what
made every band and every message wrong once the window became 1M.

Why the top band is the only real gate: auto-compact fires as the window fills
and compacts silently, doing exactly what the doctrine forbids (a wave boundary
is a `/clear`, never a compact). Re-derived from `~/.claude/usage-history` on
2026-09-04 (10 sessions, the `2026-09` log, which starts 2026-09-02):
peak-context p25 = 90k, p50 = 180k, max = 210k; 7 of 10 sessions cross 100k, 2
cross 200k, **none cross 400k**. So under current habits the two advisory bands
rarely fire and the block never does — right for a gate that exists for the
outlier session actually approaching the window, not for a nag on every wave.

Re-derive from the history log before changing the fractions; the sample is
small. Per-band absolute overrides (`CLAUDE_CTX_NUDGE` / `CLAUDE_CTX_WARN` /
`CLAUDE_CTX_BLOCK`) still win wherever they are set.
