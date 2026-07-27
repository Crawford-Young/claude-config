# Hooks

Harness enforcement scripts, wired in `~/.claude/settings.json` (2026-07-27, harness-upgrades-w1).

| Script | Event | Does |
|---|---|---|
| `pretooluse-guard.ps1` | PreToolUse (`Bash\|PowerShell`) | Blocks 3 CLAUDE.md incident classes: PS `Set-Content`/`Out-File`/`Add-Content` on text files, gate commands piped to `tail`/`head`, `git add -A`/`--all`. Block = exit 2 + stderr reason. |
| `precompact-archive.ps1` | PreCompact | Copies transcript to `~/.claude/compact-archives/<sid>-<stamp>.jsonl` before every compaction. |
| `subagentstop-log.ps1` | SubagentStop | Appends line to `~/.claude/subagent-stops.log`. |

## Rules (learned the hard way — issue log 2026-07-27)

- **Command paths: forward-slash, wrapped in escaped quotes.** Lone backslashes get stripped before execution (JSON `\\` → `\` → shell eats it); PreCompact once fired with `C:Usersyoung...` and errored. Working form:
  `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/young/code/claude-config/hooks/<script>.ps1"`
- **Fail-open design.** Script errors append to `~/.claude/hook-errors.log` and exit 0 — CLAUDE.md prose rules stay the backstop. Hook seems silent? Check that log first, then suspect path mangling — fired-but-errored is indistinguishable from silent.
- **Unit-test via direct stdin pipe:** `'{"tool_input":{"command":"..."}}' | powershell -File <script>` — check exit code + stderr. Live verification only in interactive sessions.
- **`claude -p` child sessions:** settings hooks unverified there (possibly the path bug; not re-tested). Don't rely on hooks firing in headless children — use unit tests.
- **Extend the guard, don't add prose-only rules** for mechanically blockable incident classes.
