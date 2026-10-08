# statusline/ — Statusline

`statusline.mjs` is the Claude Code `statusLine` entry point and `subagent.mjs` the `subagentStatusLine` one (#77). Both are wired in `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node C:/Users/young/code/claude-config/statusline/statusline.mjs" },
"subagentStatusLine": { "type": "command", "command": "node C:/Users/young/code/claude-config/statusline/subagent.mjs" }
```

`statusLine` has no exec form, so it always runs through `bash -c`. **Render cost** on that path is p50 49.1 ms. A bare `node -e 0` costs 46.1 ms through the same wrapper, and the old `usage-statusline.ps1` cost 367.8 ms (measured 2026-10-08). The hot path spawns nothing: git state comes from `.git` files, and spend comes from a cache.

## Display

```
claude-config-77 · claude-config@feat/77-statusline wt · Opus 5.5 · high · $3.41 · day $48
ctx ▰▱▱▱▱▱▱▱▱▱ 102k/1M 8% · cache warm 91% · 5h ▰▰▰▱▱▱▱▱▱▱ 27%→14:00 · 7d ▰▱▱▱▱▱▱▱▱▱ 5%→Wed
```

Pieces are joined with `·`, and an absent piece is dropped. A fully empty render prints `[statusline]`, because a blank row looks like a crash.

- **Session name:** comes from `~/.claude/sessions/<pid>.json` `.name`, matched on `sessionId`, with control and bidi characters stripped. `nameSource` `user` (`/rename`) or `peer` (`claude --bg -n`) renders bold. Anything else is an auto title, rendered dim with a `~` prefix and cut to 24 chars, so an un-renamed session stands out. With no registry entry, the name falls back to the payload's `session_name`, marked the same way.
- **Location:** `repo@branch` for the checkout being edited.
  - The repo comes from the active-repo record (below) when one exists, otherwise from `workspace.current_dir`.
  - A linked worktree shows its owning repo plus a dim `wt`.
  - On `main`/`master` the label turns yellow.
  - A detached HEAD shows its short SHA. Outside git, the folder name shows.
- **Model, effort, `fast`** (shown only when `fast_mode` is true), and **session cost**.
- **`day $X`:** today's spend (local day) across every transcript, subagents included, at `scripts/prices.json` API rates. It has no target and no color (user decision, #77). It is absent until the first refresh.
- **Row 2:** context (10-cell bar, token counts, %), prompt cache (`warm`/`cold`, hit ratio, `miss:<cause>`; absent until the first API response), and the five-hour and seven-day windows (bar, %, reset time).
  - Bars ceiling-round, so any nonzero usage shows at least one cell. Fill is green below 70%, yellow from 70%, red from 90%.

### Subagent rows

```
review diff · sonnet · 42k · 1m12s
! fix tests · opus · high · 180k · 4m03s
```

Each row shows label · model tier · effort · tokens · elapsed. Effort appears only when the dispatch set it; an absent effort means the subagent inherits the session's. A red `!` marks opus or fable at `high`/`xhigh`/`max`, the expensive dispatch worth catching live. A task with no resolved model gets no output line and keeps the CLI's default row. The contract is described at code.claude.com/docs/en/statusline § Subagent status lines (verified 2026-10).

## Active repo

`hooks/active-repo.mjs` is a PostToolUse hook (matcher `Write|Edit|MultiEdit|NotebookEdit`). It writes `{ top, ts }` for the edited file's checkout to `~/.claude/active-repo/<session_id>.json`, and prunes records older than a week. The hook records only the toplevel; the render reads branch and worktree from `.git`, so a branch switch after the last edit still shows. Wiring:

```json
"PostToolUse": [ { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/active-repo.mjs"] }] } ]
```

## Day spend

`spend.mjs` prices today's assistant records with `audit-lib.priceUsage`. For each requestId it keeps the max-output record, deduped across files so a resumed session's replay counts once.
- Per-file byte offsets live in `~/.claude/spend/day-<date>.state.json`, so a refresh reads only appended bytes: cold 121 ms, warm 12 ms over 46 transcripts.
- The render reads only `day-<date>.json`. When that file is over 60 s old, the render spawns the worker detached under `refresh.lock` (stale after 120 s), so a render never waits on it.
- Earlier days' files are deleted on refresh.
- **Credits:** no documented account-credits source exists. The documented `rate_limits.spend_limit` (Claude apps gateway only) has never appeared in this account's payloads, so it is not rendered.

## History log

The render appends at most one sample per 60 s per session to `~/.claude/usage-history/yyyy-MM.jsonl`. The throttle state is in `claude-usage-throttle-<session_id>.txt` under `%TEMP%`. `hooks/context-gauge.mjs` reads `context_window_size` from this log.

**Reflect agents:** the log is best-effort, not a complete session record. Concurrent appends can collide, and a missing sample proves nothing.

| Field | Source |
|---|---|
| `ts` | local ISO-8601 timestamp |
| `session_id` | `session_id` (sample skipped without it) |
| `cwd`, `model_id`, `effort`, `fast_mode` | `cwd`, `model.id`, `effort.level`, `fast_mode` |
| `five_hour_pct`, `five_hour_resets_at`, `seven_day_pct`, `seven_day_resets_at` | `rate_limits.*` |
| `cost_usd` | `cost.total_cost_usd` |
| `context_pct`, `context_window_size` | `context_window.*` |
| `cache_read_tokens`, `cache_creation_tokens` | `context_window.current_usage.*` |
| `cache_warm`, `cache_hit_ratio`, `cache_miss_cause` | `prompt_cache.*` |
| `exceeds_200k` | `exceeds_200k_tokens` |

Every field is present on every sample; it is `null` when its source is absent.

## Env overrides (tests)

| Variable | Default |
|---|---|
| `CLAUDE_SESSIONS_DIR` | `~/.claude/sessions` |
| `CLAUDE_ACTIVE_REPO_DIR` | `~/.claude/active-repo` |
| `CLAUDE_SPEND_DIR` | `~/.claude/spend` |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` (spend worker) |
| `CLAUDE_SPEND_NO_REFRESH` | unset; any value stops the render spawning the worker |
| `CLAUDE_USAGE_HISTORY_DIR` | `~/.claude/usage-history` |
| `CLAUDE_USAGE_THROTTLE_DIR` | `%TEMP%` |

## Tests

`node --test scripts/test/statusline.test.mjs` covers render and hook. The fixtures are in `tests/fixtures/`. Render a payload by hand with `node statusline/statusline.mjs < statusline/tests/fixtures/full.json`.

## Rollback

`git show 731142c:statusline/usage-statusline.ps1` recovers the PowerShell version. Point `statusLine.command` back at it with `powershell -NoProfile -ExecutionPolicy Bypass -File <path>`. settings.json hot-reloads.
