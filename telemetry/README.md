# telemetry/ — Claude Code OTel usage capture

Local pipeline for per-phase/per-task token+cost attribution (OTel wave 2026-08-07).
Claude Code exports OTLP http/json to a minimal local receiver; the receiver writes
flat NDJSON rows; the report CLI joins those rows against checklist tick stamps to
produce per-task/phase/agent/source/skill usage tables. Everything is local-only and
fail-open — a dead receiver never blocks a session.

## Row schema v1

One JSON object per line in `~/.claude/otel/YYYY-MM.ndjson` (month file keyed by
receive-time UTC). Schema changes bump `v` and update this file — the report CLI and
the deferred statusline reader are the consumers of this contract.

| Field | Type | Meaning |
|---|---|---|
| `v` | number | Schema version — `1` |
| `ts` | string | Datapoint/event time, ISO 8601 UTC (from `timeUnixNano`; receive time if absent) |
| `sid` | string | `session.id` attr, lifted out of `attrs` |
| `kind` | string | `metric` (from `/v1/metrics`) or `event` (from `/v1/logs`) |
| `name` | string | Metric name (`claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session.count`) or event name (`eventName` field, falling back to the `event.name` attr, else `unknown_event`) |
| `val` | number | Metric value; always `1` for events |
| `attrs` | object | All remaining attributes, flattened; string values truncated to 256 chars |
| `agg` | number? | Metrics only, when present: OTLP `aggregationTemporality` — `1` = delta, `2` = cumulative. Live-verified 2026-08-08: Claude Code honors the delta preference (all rows `agg: 1`); the report SUMS values and assumes delta |
| `st` | string? | Metrics only, when present: datapoint `startTimeUnixNano` as ISO |

Only the three `KEPT_METRICS` above are stored; all log-record events pass through.

**`type` attr is camelCase** on token rows: `input`, `output`, `cacheRead`,
`cacheCreation` — live-wire truth (2026-08-08 probe), NOT the docs' snake_case
(`cache_read`/`cache_creation`). Report `TOKEN_TYPES` matches the wire.

**PII note:** `attrs` passes through `user.email`, `user.id`, `organization.id`,
`user.account_uuid`. Data files are local-only (`~/.claude/otel/` is outside every
repo) — never copy rows into commits, issues, or shared docs without scrubbing.

## Data location & cleanup

- Data: `~/.claude/otel/YYYY-MM.ndjson` (override dir: `OTEL_RECEIVER_DATA_DIR`)
- Errors: `~/.claude/otel/receiver-errors.log` (fail-open convention — check here first when rows go missing)

**Cleanup rule (G42 class, manual):** monthly files and the error log are
unbounded-by-convention — at wave closes, delete month files older than ~6 months
and truncate the error log if large. No rotation is automated; this line is the
documented bound.

## Env config (reproducible record)

`~/.claude/settings.json` is user-level and untracked — this block is the
reproducible record of the telemetry env vars it carries:

```json
"env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp",
  "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
  "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta",
  "OTEL_LOG_TOOL_DETAILS": "1",
  "OTEL_METRIC_EXPORT_INTERVAL": "10000"
}
```

Env edits are inert mid-session (G8) — a fresh session is required for changes to bind.

## Receiver lifecycle

`otel-receiver.mjs` — spawned lazily by the SessionStart hook
(`hooks/otel-receiver-spawn.ps1`, wired in settings.json). Binds `127.0.0.1:4318`
(override: `OTEL_RECEIVER_PORT`); a second instance exits 0 on EADDRINUSE — port
bind IS the single-instance lock. Parse errors → 400 + error log; disk-write errors
are logged once and swallowed — the exporter never sees a disk problem. Import-safe:
listens only when run as the main module.

## Report CLI

```
node telemetry/usage-report.mjs <checklist.md> [--from <iso>]
node telemetry/usage-report.mjs --from <iso> --to <iso>
```

Joins checklist tick stamps (`<!-- done <ISO8601> -->` as last content on ticked
`- [x]` lines, outside code fences — protocol in
`skills/agent-factory/checklist-protocol.md`) against NDJSON rows. Task windows
chain previous-done → done; the first window defaults to 4h before the first stamp
(pass `--from` to widen — a stderr note fires). Outputs markdown tables: per-task,
per-phase (COMPACT POINT markers delimit phases), per-agent, per-source, per-skill
(`skill_activated` events), plus gap warnings (no-rows vs events-without-cost).

## Eval runner (G72)

`eval.mjs` — stored eval set for harness routing/adherence evidence. Registry:
`../evals/evals.json` (JSON, zero-dep). Reports: `~/code/docs/harness-evolution/evals/runs/`
(MD + JSON sidecar per run; `report` reads the sidecars, never re-parses MD).

```
node telemetry/eval.mjs run [--id X] [--tag Y] [--class Z] [--all] [--max-sessions N] [--yes]
node telemetry/eval.mjs mine [--logs <root>]
node telemetry/eval.mjs report [--logs <root>]
```

- `run` — spawns headless probe sessions (`claude -p --output-format json`), grades
  the transcript trace/final text per eval, writes a run report. **Bills real
  sessions: requires `--yes` AND per-run user clearance (root CLAUDE.md Live-LLM
  rule); without `--yes` it prints a dry preview.** Aborts if `ANTHROPIC_API_KEY`
  is set (would bill the key lane), if the registry is invalid, or if the selection
  exceeds `--max-sessions` (default 12). Mined-grader evals are never runnable.
  `--all` is user-invoked only — never a reflect default. Exit 1 on any non-PASS.
- `mine` — free, local. Walks `~/code/docs` (both depths: `docs/*/agent-logs` and
  `docs/*/*/agent-logs`, `done/` included) for `- row:` grade lines in performance
  MDs (format: `skills/agent-factory/SKILL.md` entry block) and aggregates by
  type|model|class.
- `report` — free, local. Merges latest probe verdict per eval id with mined
  aggregates. Provenance stamps: `(probed, run <id>)` / `(mined, n=<count>)` —
  mined counts never promote a profile claim to firm alone (probed n≥2, or
  probed+mined, can — `agents/profiles/README.md`).

Never-tune-to-probe: registry prompts are frozen; any prompt edit = new id
(`-v2`), history resets. Reflect wiring: `claude-md-management:reflect` Phase 5.5
step 0 runs `mine` every reflect and proposes a probe subset on user clearance.

## Tests

Windows Node 24 `node --test <dir>/` MODULE_NOT_FOUNDs — always the explicit file list:

```
node --test telemetry/test/otel-parse.test.mjs telemetry/test/otel-receiver.test.mjs telemetry/test/report-lib.test.mjs telemetry/test/eval-lib.test.mjs
```

Or glob form from repo root: `node --test telemetry/test/*.test.mjs`.
