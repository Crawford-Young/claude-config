---
name: orchestrate
description: Use when executing any multi-task plan or checklist, starting a wave, choosing an execution workflow, dispatching subagents, choosing a model for an Agent() call, or selecting a plan profile after writing-plans. Covers tier selection (T1–T4), adaptive model routing, escalation, and orchestration metrics.
---

# Orchestrate

## Overview

Canonical orchestration standards. Replaces `docs/ORCHESTRATOR.md`. Two entry points:

1. **Plan time** (end of `superpowers:writing-plans`): compute tier from the formula, select a plan profile, record both in the checklist header.
2. **Execution time** (wave start / dispatch decisions): follow tier structure, route models, log every dispatch, escalate and pivot per the rules below.

Never load this skill as a subagent below manager level — managers at T3+ receive relevant excerpts in their briefing, not this file.

---

## Tier Ladder

| Tier | Shape | When |
|---|---|---|
| **T1** | Inline agent — no dispatch; route to `inline-execute` skill | Docs/config/small code, ≤2 files per task |
| **T2** | Orchestrator + flat subagents (impl/recon/review) via `superpowers:subagent-driven-development` | Code waves, single workstream |
| **T3** | Director + managers + subagents — each manager owns a workstream, dispatches its own impl/review agents, reports summaries only | 2+ independent workstreams |
| **T4** | T3 + managers in background with isolated git worktrees (`superpowers:using-git-worktrees`), merged at wave end | Disjoint file sets + wall-clock matters |

Ladder is capped at 4 — deeper nesting never amortizes its cold-start context cost. Managers are `general-purpose` agents (they have the Agent tool); each nesting level costs a cold start, so the formula must justify it before it is incurred.

## Tier Formula

Computed at plan-writing time from measurable plan properties; declared in the checklist header **with its inputs**:

1. Task count ≤3 AND ≤2 files/task AND no architecture decisions → **T1**
2. Else, 1 workstream → **T2**
3. Else, 2+ independent workstreams (no shared files, no sequential dependency between them) → **T3**
4. T3 AND workstreams touch disjoint file sets AND wall-clock matters → **T4**

If formula inputs are ambiguous (can't tell whether workstreams are independent): default to the **lower** tier — pivoting up is cheaper than a wasted manager cold start.

**Pivot rule:** the orchestrator may move up or down a tier mid-wave when reality diverges from the plan (workstreams merge/split, tasks balloon/collapse). Every pivot is appended to the checklist header `**Tier:**` line and logged in the Orchestration Log with a one-line reason. A pivot means the formula missed — the Wave Scorecard says why.

## Plan Profiles

Selected at the end of `superpowers:writing-plans`; recorded in the checklist header. Present the recommended profile plus a one-line trade-off for each alternative — user confirms with plan approval.

| Profile | Task granularity | Review depth | Tier bias | Verification |
|---|---|---|---|---|
| **Precision** | Verbatim code in plan | Full two-stage (spec + quality) | Sequential T2 | Full DoD per task |
| **Standard** (default) | Mixed — verbatim where risk, goal-level where routine | Combined single-pass on verbatim tasks; two-stage on judgment tasks | Formula | DoD per task |
| **Velocity** | Goal-level | Spot-check risky tasks only | Formula, parallel allowed | DoD at wave end |

Guidance: **Precision** for auth, payments, data migrations. **Velocity** for scaffolds, docs waves, low-risk UI. **Standard** otherwise. Reflect scores profile fit — a Velocity wave needing 3 redos should have been Standard.

## Model Routing Table (living data — reflect edits this)

Every `Agent()` call sets `model:` explicitly, chosen from this table. Reflect appends or amends rows (with date + evidence) when a Wave Scorecard shows a misroute.

| Signal | Model | Since | Evidence |
|---|---|---|---|
| Orchestration, dispatch decisions, checklist edits | fable | seed | — |
| Architecture decisions, design review, code review | opus | seed | — |
| Implementation: single component, complete spec | sonnet | seed | — |
| Recon: file reads, greps, existence checks, output verification | haiku | seed | — |
| Cross-file integration (3+ files, shared state) | opus | seed | — |

Fable orchestrates only — never used for bounded implementation tasks.

## Escalation Rule (anti-thrash)

On first Sonnet failure, check complexity signals: **3+ files touched · integration/architecture flavor · review fault at design level (not typo level)**.

- Signals present → escalate to Opus immediately. Do not retry Sonnet.
- No signals → one Sonnet retry, then escalate.
- Escalated task fails on Opus too → stop dispatching; surface to user. That is a plan-level problem, not a model problem.

Log every escalation: `task · sonnet FAIL×n → opus · outcome · signal that fired`. Escalations are routing-table candidates at reflect.

## Tool Access Matrix

Activates at T2+ (T1 inline agent does everything itself).

| Role | Agent tool | Write/Edit | Read scope |
|---|---|---|---|
| Orchestrator | yes | checklist + docs only — never source | summaries only — recon reads source, not the orchestrator |
| Manager (T3+) | yes | no | own workstream + own dispatch results |
| Implementer | no | yes | task scope only |
| Recon | no | no | read-only |
| Reviewer | no | no | read-only + diff |

## Efficiency Playbook

Mandatory for the top agent at every tier:

- `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- ToolSearch for deferred tools — never guess schemas
- `Explore` agent for fan-out searches across many files
- Lazy spec loading: subagent briefings get file path + interface contract + test expectations — full spec only when the task requires design decisions
- Background tasks (`run_in_background`) for long-running commands
- Compact discipline at every `<!-- COMPACT POINT -->` marker (see below)
- More than 10 files read → offload remaining research to a focused subagent

## Checklist Template

```markdown
<!-- ORCHESTRATOR ONLY — update checkboxes, Orchestration Log, and Reflect Log. Subagents: read-only. -->
# <project> — <Phase/Wave Name>
**Branch:** feat/<name>
**Tier:** T2 (formula: <inputs>) [· pivots appended inline: "→ T3 @ task N: <reason>"]
**Profile:** Standard
**Spec:** docs/<project>/specs/<spec-file>.md

---

## Tasks

- [ ] **Task 1** — ...

<!-- COMPACT POINT -->

---

- [ ] **Reflect** — Run `claude-md-management:reflect` · orchestrator

---

## Orchestration Log
<!-- one line per dispatch: task · role · model · outcome · redo/escalation/pivot -->

## Wave Scorecard
<!-- reflect fills: tier accuracy · model accuracy (escalations) · profile fit · context % at wave end (/context) · /usage summary -->

## Reflect Log
```

The `**Tier:**` and `**Profile:**` lines replace the old `**Workflow:**` and `**Model:**` lines — tier implies workflow, the routing table owns models. Any checklist with 8+ tasks MUST include `<!-- COMPACT POINT -->` markers every 3–4 tasks.

## Orchestration Log Protocol

Append one line per dispatch, escalation, and pivot — at the moment it happens, not retroactively:

```
- T2 dispatch: task3 impl · sonnet · PASS
- T2 dispatch: task4 impl · sonnet · FAIL×2 → redo opus · PASS · signal: integration-heavy
- PIVOT → T3 @ task5: workstreams diverged
```

One line each. Never paste raw subagent output into the log.

## Wave Scorecard Protocol (at reflect)

Reflect Phase 1 reads the checklist and finds the Orchestration Log + empty Scorecard. During reflect Phase 3, before the `/usage` prompt, also ask the user to run `/context` and paste both. Then fill:

- **Tier accuracy** — formula tier vs actual; each pivot = a miss, with reason
- **Model accuracy** — escalation count + which signals fired
- **Profile fit** — redo/defect rate vs what the profile predicted
- **Context efficiency** — `/context` % at wave end · `/usage` totals

Scorecard evidence drives reflect Phase 4/5 proposals: routing-table rows, formula adjustments, profile-guidance edits — all applied to THIS skill file (it lives in `claude-config`, edits persist). The scorecard travels with the checklist to `done/` as the historical record.

---

## Session Start Protocol

1. Scan `docs/<project>/checklists/active/` — each file is an in-flight phase
2. Read the checklist header: branch, tier, profile, spec path
3. Find the first unchecked task — resume there
4. Do not re-read specs or full plan prose unless a specific task requires design decisions

## Checklist Editing Protocol

**Only the orchestrator writes to checklist files. Subagents are read-only.**

- Tick `- [x]` immediately after a task completes
- Add `> ⚠️ NOTE FOR TASK N:` inline below a completed task only when the outcome changes how a future task should be approached
- Append to `## Reflect Log` when lessons surface — format: `- YYYY-MM-DD: <lesson>`
- On phase complete: move checklist to `done/`, then run `claude-md-management:reflect`

## Compact Discipline

At every `<!-- COMPACT POINT -->` marker:

1. Read subagent result
2. Extract lessons → append ≤3 bullets to Reflect Log if anything surfaced
3. Discard full subagent output — never accumulate raw responses in context
4. Stop and prompt the user to run `/compact` — do not continue past the marker until compaction or explicit go-ahead
5. After compaction: re-orient by reading the checklist only

The checklist is the sole source of truth across compaction boundaries.

## Dispatch Template

Every subagent prompt includes all five fields. Never write "based on your findings, implement X" — that delegates understanding.

```
Goal:           <what to produce and why — one sentence>
Scope:          <exact files, dirs, or modules>
Prior context:  <what has been tried or ruled out>
Output format:  <diff, report, file list, JSON, etc.>
Constraints:    <stack rules, patterns to follow, things to avoid>
```

At T3+, manager briefings additionally include: workstream definition, file-set boundary, and the dispatch template itself (managers dispatch with it too).

## Judgment Rules (earned 2026-06-10)

- **Verify reviewer Criticals before dispatching fixes.** Read the cited source lines yourself first — reviewers false-alarm; a wrong fix cycle costs a full dispatch + re-review.
- **Combined review for verbatim-code tasks.** When a plan task prescribes exact code byte-for-byte, collapse two-stage review into ONE Opus pass (spec byte-compare + quality). Tasks with implementer latitude keep the full two-stage flow.
- **Trivial-fix exception.** The orchestrator may hand-apply a ~1-line mechanical fix (typo, escaping, formatting artifact) when the implementer agent is no longer reachable. Anything requiring judgment or touching 2+ sites: re-dispatch.

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move checklist `active/` → `done/` (`Move-Item` / `mv`)
3. **Run `claude-md-management:reflect` — mandatory.** Fill the Wave Scorecard (protocol above)
4. Reflect Phase 6 prompts `/usage`, then `/clear` if the project is fully done

## T4 Merge Protocol

Manager worktrees must have disjoint file sets — that is a formula precondition, not a hope. A merge conflict at wave end = formula miss → log it, scorecard it. Merge order: smallest diff first; rebase-only (`git rebase origin/main`, never merge commits).

## Continuation Handoff

When the `continuation` skill writes a handoff, the Current State block includes the tier, profile, and a pointer to the Orchestration Log so the next session re-enters at the right tier without re-deriving.

## Skills Reference

Situation→skill routing lives in [`docs/SKILLS.md`](../../workspace/docs/SKILLS.md) — update that file when routing changes, not this one.
