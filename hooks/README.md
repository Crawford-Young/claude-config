# Hooks

Cross-platform Node hooks (2026-08 restructure — the old PowerShell set is in
git history). A rule that must hold every time lives here or in a deny rule,
never as CLAUDE.md prose. All hooks are **fail-open**: errors append to
`~/.claude/hook-errors.log` and exit 0 — check that log first when a hook
seems silent.

| Script | Event (matcher) | Does |
|---|---|---|
| `bash-guard.mjs` | PreToolUse (`Bash\|PowerShell`) | Blocks: `git add -A/--all` in any flag order; staging/committing `.env` files (`.env.example` allowed); gate commands piped to `tail`/`head`; PS `Set-Content`/`Out-File`/`Add-Content` (mojibake); `git commit` on main/master in code repos (docs repo + worktrees exempt); branch switches on the claude-config main checkout. |

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
| `agent-model-guard.mjs` | PreToolUse (`Agent`) | Blocks model-omitted dispatches on frontmatter-less types; blocks fable dispatches without a live clearance marker. Ledger: `~/.claude/fable-dispatch.log`. |
| `fable-clearance-grant.mjs` | UserPromptSubmit | `FABLE OK` in the user's own prompt writes the single-use 30-min marker the Agent guard consumes. Speed bump + audit trail, not a hard gate. |
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
  "UserPromptSubmit": [ { "hooks": [{ "type": "command", "command": "node \"C:/Users/young/code/claude-config/hooks/fable-clearance-grant.mjs\"" }] } ],
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

Keep the settings `deny` rules for `git add -A` forms — the two layers
(deny rule + guard regex) deliberately overlap; change both or neither.

## Conventions

- Exit-code semantics: 0 = proceed, 2 = block (stderr is the reason), other = non-blocking error. A hook allow does NOT skip deny rules.
- Unit-test by piping JSON to stdin: `echo '{"tool_input":{"command":"git add -A"}}' | node hooks/bash-guard.mjs` — tests live in `scripts/test/`, run `node --test scripts/test/*.test.mjs`.
- Hook wiring reloads live — no session restart needed to verify new wiring.
- Env overrides for tests/remotes: `CLAUDE_WORKSPACE_ROOT`, `CLAUDE_CONFIG_REPO`, `STOP_GATE_DOCS_ROOT`.
