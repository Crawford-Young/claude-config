# Session Lifecycle Protocol

Reference file for the `agent-factory` skill. Read at session start, when
approaching a compact boundary, or when launching a background session.

---

## Session Overflow Lane

`claude --bg "<prompt>"` spawns a full background Claude Code session with its own depth-5 tree — for whole-wave parallelism (e.g. two repos at once). **Orchestrator-only, user-cleared per launch** — it runs unattended and bills independently. Results come back via files/repo, not conversation.

- `claude --bg` dispatches prefer `--output-format json --json-schema <schema-file>` when the result feeds orchestration (typed results, no prose parsing), and `--bare` for reproducible gate runs (skips hooks/skills/MCP/CLAUDE.md discovery — no local-config bleed). Background-task grace at exit is capped (~10 min default); raise via `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` if a `--bg` wave legitimately outlives it. (Docs-verified 2026-07-27.)

## Session Start Protocol

1. Scan `docs/<project>/checklists/active/` — each file is an in-flight phase
2. Read the checklist header: branch, factory line, spec path
3. **Worktree check (mandatory before first spawn that edits code, 2026-06-12):** if the target repo has another branch in flight, work in a worktree (`superpowers:using-git-worktrees`)
4. Find the first unchecked task — resume there
5. Do not re-read specs or full plan prose unless a specific task requires design decisions

## Compact Discipline

At every `<!-- COMPACT POINT -->` marker:

1. Read subagent result
2. Extract lessons → append ≤3 bullets to Reflect Log if anything surfaced
3. Discard full subagent output — never accumulate raw responses in context
4. Stop and prompt the user to run `/compact` — do not continue past the marker until compaction or explicit go-ahead
5. After compaction: re-orient by reading the checklist only

The checklist is the sole source of truth across compaction boundaries. Marker stop is absolute — blanket task approval never waives it.

## Continuation Handoff

When the `continuation` skill writes a handoff, the Current State block includes the `**Factory:**` line (spawn tree summary + open perf-MD paths) and a pointer to the Orchestration Log so the next session re-enters without re-deriving.
