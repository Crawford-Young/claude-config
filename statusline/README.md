# statusline/ — Usage Statusline

`usage-statusline.ps1` is the Claude Code `statusLine` entry point (wired in `~/.claude/settings.json`). It renders a two-row status display from the statusline stdin JSON and appends a throttled usage sample to a monthly history log.

Targets Windows PowerShell 5.1. ASCII-only source; display glyphs built from `[char]` code points. Output encoding is forced to BOM-less UTF-8 — PS 5.1's default OEM code page (CP437) mangles the arrow/dot glyphs on redirected stdout.

## Display

Two rows, empty pieces dropped, pieces joined with `·`:

```
claude-config@feat/usage-statusline · Fable 5 · high · $22.96
ctx ▰▱▱▱▱▱▱▱▱▱ 102k/1M 8% · 5h ▰▰▰▱▱▱▱▱▱▱ 27%→14:00 · 7d ▰▱▱▱▱▱▱▱▱▱ 5%→Wed
```

- **Row 1 — identity:** location `repo@branch` (git toplevel basename + current branch; worktrees show their own dir name; detached HEAD shows short SHA; non-git dirs show the folder name), model display name, effort level, session cost `$0.00`.
- **Row 2 — usage:** context window (10-cell fill bar, used/total token counts, percent), five-hour window (bar, percent, `→HH:mm` local reset), seven-day window (bar, percent, `→ddd` reset day).
- **Bars:** 10 cells, 1 cell = 10%, ceiling-rounded so any nonzero usage shows at least one cell. Filled cells colored by threshold — green < 70%, yellow ≥ 70%, red ≥ 90% — empty cells dim. The percent number carries the same color.
- Git runs through `cmd /c "git ... 2>nul"` — under `$ErrorActionPreference = 'Stop'`, a PowerShell-level stderr redirect of a native command throws (`NativeCommandError`); the cmd-level redirect avoids it.

## Fail-open guarantees

- Malformed or empty stdin → `$Status = $null` → display degrades piece-by-piece; a fully empty render emits the sentinel `[statusline]` instead of a blank line (a blank statusline is indistinguishable from a crashed one).
- The history block is wrapped in a blanket `try/catch`; logging failure never breaks the display.
- The script always `exit 0`.

## History log

One JSON object per line, appended to `~/.claude/usage-history/yyyy-MM.jsonl` (monthly files). Throttled to at most one sample per 60 s per session via a state file `claude-usage-throttle-<session_id>.txt` holding the last-write epoch.

**Reflect agents: read `~/.claude/usage-history/*.jsonl`, one JSON object per line — best-effort log, not a complete session record.** Concurrent-session appends can collide and are swallowed by design; absence of a sample proves nothing.

### Sample schema

| Field | Source | Null when |
|---|---|---|
| `ts` | ISO-8601 local timestamp | never |
| `session_id` | `session_id` | never (sample skipped without it) |
| `cwd` | `cwd` | absent in stdin |
| `model_id` | `model.id` | no `model` |
| `effort` | `effort.level` | no `effort` |
| `five_hour_pct` | `rate_limits.five_hour.used_percentage` | no `rate_limits` |
| `five_hour_resets_at` | `rate_limits.five_hour.resets_at` (unix epoch) | no `rate_limits` |
| `seven_day_pct` | `rate_limits.seven_day.used_percentage` | no `rate_limits` |
| `seven_day_resets_at` | `rate_limits.seven_day.resets_at` (unix epoch) | no `rate_limits` |
| `cost_usd` | `cost.total_cost_usd` | no `cost` |
| `context_pct` | `context_window.used_percentage` | no `context_window` |
| `context_window_size` | `context_window.context_window_size` | no `context_window` |
| `cache_read_tokens` | `context_window.current_usage.cache_read_input_tokens` | no `current_usage` |
| `cache_creation_tokens` | `context_window.current_usage.cache_creation_input_tokens` | no `current_usage` |
| `exceeds_200k` | `exceeds_200k_tokens` | absent in stdin |

## Env overrides (tests)

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_USAGE_HISTORY_DIR` | `~/.claude/usage-history` | history log directory |
| `CLAUDE_USAGE_THROTTLE_DIR` | `$env:TEMP` | throttle state-file directory |

## Tests

`tests/run-tests.ps1` — self-contained runner (no framework), fixtures in `tests/fixtures/`. Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

Covers display layout (ANSI-stripped exact-line asserts + raw color asserts), bar arithmetic/thresholds, location resolution (temp git repo + plain folder), malformed-input sentinel, history schema, throttle suppress/allow, and null-field degradation. The runner forces UTF-8 `OutputEncoding` to match the script.

## Rollback

Restore the previous statusline by setting `statusLine.command` in `~/.claude/settings.json` back to:

```json
"command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\young\\.claude\\plugins\\cache\\caveman\\caveman\\c2ed24b3e5d4\\hooks\\caveman-statusline.ps1\""
```

settings.json hot-reloads; no restart needed.

## History

Spec: `docs/harness-evolution/specs/2026-08-06-usage-monitor-design.md`. The spec's display section (caveman badge + wrapper child process, plain `pct→reset` text) was superseded at the T3 live QA gate — badge removed entirely, display redesigned across 4 QA rounds (tick bars, token counts, location piece, two-row split). This README documents the shipped code; issue log `docs/harness-evolution/issues/2026-08-06-p2-usage-monitor-issues.md` #3 has the round-by-round record.
