# ORCHESTRATOR.md — Orchestration Standards

> Load at session start when orchestrating. Never load as a subagent.

---

## Model Tiers

| Role | Model | When |
|---|---|---|
| Orchestrator | Fable | Plan management, dispatch decisions, checklist edits, reflect log |
| Architecture / Review | Opus | Design decisions, code review, architecture tasks |
| Implementation | Sonnet | Code, tests, config, PRs |
| Recon | Haiku | File reads, greps, existence checks, output verification |

Every `Agent()` call must set `model:` explicitly. Fable orchestrates only — never used for bounded implementation tasks. Opus handles architecture decisions and review. Haiku handles all reconnaissance before Sonnet begins implementation.

---

## Session Start Protocol

1. Scan `docs/<project>/checklists/active/` — each file is an in-flight phase (one folder per project)
2. Read the checklist header for the relevant project to confirm branch and spec path
3. Find the first unchecked task — that is where to resume
4. Do not re-read specs or full plan prose unless a specific task requires design decisions

---

## Checklist Editing Protocol

**Only the orchestrator writes to checklist files. Subagents are read-only.**

**Checklist header format** (required fields for every new checklist):

```markdown
<!-- ORCHESTRATOR ONLY — update checkboxes and Reflect Log as tasks complete. Subagents: read-only. -->
# <project> — <Phase/Wave Name>
**Branch:** feat/<name>
**Workflow:** inline-execute | subagent-driven-development
**Model:** Fable (orch) · Opus (arch/review) · Sonnet (impl) · Haiku (recon)
**Spec:** docs/<project>/specs/<spec-file>.md

---

## Tasks

- [ ] **Task 1** — ...

<!-- COMPACT POINT -->

---

- [ ] **Reflect** — Run `claude-md-management:reflect` · orchestrator

---

## Reflect Log
```

- Tick `- [x]` immediately after a task completes
- Add `> ⚠️ NOTE FOR TASK N:` inline below a completed task only when the outcome changes how a future task should be approached
- Append to `## Reflect Log` when lessons surface — format: `- YYYY-MM-DD: <lesson>`
- On phase complete: move checklist `docs/<project>/checklists/active/<file>.md` → `docs/<project>/checklists/done/<file>.md`; then run `claude-md-management:reflect`

---

## Compact Discipline

**At every `<!-- COMPACT POINT -->` marker in the checklist:**

1. Read subagent result
2. Extract lessons → append ≤3 bullets to Reflect Log if anything surfaced
3. Discard full subagent output — never accumulate raw responses in context
4. Stop and prompt the user to run `/compact` — the agent cannot invoke it; do not continue past the marker until compaction or explicit user go-ahead
5. After compaction: re-orient by reading checklist only (not spec, not full plan prose)

The checklist is the sole source of truth across compaction boundaries.

---

## Dispatch Template

Every subagent prompt must include all five fields. Never write "based on your findings, implement X" — that delegates understanding.

```
Goal:           <what to produce and why — one sentence>
Scope:          <exact files, dirs, or modules>
Prior context:  <what has been tried or ruled out>
Output format:  <diff, report, file list, JSON, etc.>
Constraints:    <stack rules, patterns to follow, things to avoid>
```

Include `model: "fable"`, `model: "opus"`, `model: "sonnet"`, or `model: "haiku"` in every `Agent()` call.

---

## Lazy Spec Loading

Include spec content in a subagent briefing only when the task requires design decisions. Most implementation tasks need only: file path + interface contract + test expectations. Loading the full spec into every subagent wastes tokens.

---

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move `docs/<project>/checklists/active/<file>.md` → `docs/<project>/checklists/done/<file>.md` (PowerShell: `Move-Item`; bash: `mv`)
3. **Run `claude-md-management:reflect` — mandatory. Do not skip, even if the phase feels obvious.**
4. Reflect Phase 6 will prompt `/usage` then (if project fully done) `/clear`

---

## Workflow Selection

Read the checklist and match against these signals. Use the first matching row.

| Signal | Workflow | Executor model |
|---|---|---|
| All tasks are docs, config, or file edits | `inline-execute` | sonnet |
| Code tasks, ≤2 files per task, spec complete | `inline-execute` | sonnet |
| Code tasks, 3+ files per task or integration concerns | `superpowers:subagent-driven-development` | sonnet impl / haiku recon |
| Any task requires architecture decisions | `superpowers:subagent-driven-development` | opus arch/review |
| Mixed plan (docs wave + code wave) | `inline-execute` per docs wave · `subagent-driven-development` per code wave | — |

**Applying the decision:**
- `inline-execute`: tell user to run `/inline-execute` in the current session
- `subagent-driven-development`: invoke via Skill tool; Fable orchestrates, dispatches Opus/Sonnet/Haiku per task
- Record the chosen workflow in the checklist header `**Workflow:**` line before execution begins

---

## Skills Reference

Moved → [`docs/SKILLS.md`](./SKILLS.md) — canonical situation→skill routing for all skills (custom, plugin, harness), plus trigger discipline and cost notes. Update SKILLS.md when routing changes — not this file.
