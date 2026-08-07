# Session Lifecycle Protocol

Reference file for the `agent-factory` skill. Read at session start, when
approaching a compact boundary, or when launching a background session.

---

## Session Overflow Lane

`claude --bg "<prompt>"` spawns a full background Claude Code session with its own depth-5 tree — for whole-wave parallelism (e.g. two repos at once). **Orchestrator-only, user-cleared per launch** — it runs unattended and bills independently. Results come back via files/repo, not conversation.

- `claude --bg` dispatches prefer `--output-format json --json-schema <schema-file>` when the result feeds orchestration (typed results, no prose parsing), and `--bare` for reproducible gate runs (skips hooks/skills/MCP/CLAUDE.md discovery — no local-config bleed). Background-task grace at exit is capped (~10 min default); raise via `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` if a `--bg` wave legitimately outlives it. (Docs-verified 2026-07-27.)

- **Background-agent hygiene: after a background agent's result is received, stop/clear its task registration** (TaskList → TaskStop) — finished agents accumulate silently across compactions and clutter the task list until the user clears them by hand, and a stale registration is indistinguishable from a hung agent. (2026-08-06 harness-evolution: 11 registrations from P1's sweep fan-out survived two waves and a compaction; user stopped them manually at P2 close.)

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
5. **Hand them a focus string with the prompt.** `/compact` takes free-form instructions that steer what the summary keeps. Write them for the NEXT task, not the finished one
6. After compaction: re-orient by reading the checklist only

The checklist is the sole source of truth across compaction boundaries. Marker stop is absolute — blanket task approval never waives it.

### Compact focus strings

Left unfocused, the summarizer weights the turns it just read — a long finished task crowds out the two lines the next one needs, and the resume session pays a re-derivation pass. The focus string is the cheapest fix: one line, pasted with the command.

Give the user the literal string to paste, in a copyable block. It carries four things:

- the **next task** by number and name — what the summary is FOR
- the **files and paths** that task touches, so their state survives
- **open blockers** and their close conditions
- **deviations and decisions** already taken that the next task must not re-litigate

Drop the finished task's mechanics — the checklist and git history hold those.

```
/compact Focus on Task 13 (claude-config gate): the harness gate command + its
EXIT line, byte accounting for the 4 rightsized files, and the open issue-#5
blocker (main unpushed, push-don't-rebase). Keep the Task 11 frontmatter
deviation. Drop the Task 10 slicing mechanics — the script is on disk.
```

Same duty at a `continuation` handoff and at any ad-hoc compact the user calls mid-task.

## Continuation Handoff

When the `continuation` skill writes a handoff, the Current State block includes the `**Factory:**` line (spawn tree summary + open perf-MD paths) and a pointer to the Orchestration Log so the next session re-enters without re-deriving.
