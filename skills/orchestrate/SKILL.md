---
name: orchestrate
description: Use when executing any multi-task plan or checklist, starting a wave, choosing an execution workflow, dispatching subagents, choosing a model for an Agent() call, or selecting a plan profile after writing-plans. Covers tier selection (T1–T4), adaptive model routing, escalation, and orchestration metrics.
---

# Orchestrate

## Overview

Canonical orchestration standards. Replaces `docs/ORCHESTRATOR.md`. Two entry points:

1. **Plan time** (end of `superpowers:writing-plans`): compute tier from the formula, select a plan profile, record both in the checklist header.
2. **Execution time** (wave start / dispatch decisions): follow tier structure, route models, log every dispatch, escalate and pivot per the rules below.

Never load this skill as a subagent below manager level — the `manager` agent definition carries the rules it needs (dispatch template, routing signals, redo economics), not this file.

---

## Tier Ladder

| Tier | Shape | When |
|---|---|---|
| **T1** | Inline agent — no dispatch; route to `inline-execute` skill | Docs/config/small code, ≤2 files per task |
| **T2** | Orchestrator + flat subagents (impl/recon/review) via `superpowers:subagent-driven-development` | Code waves, single workstream |
| **T3** | Director + managers + subagents — each manager owns a workstream, dispatches its own impl/review agents, reports summaries only | 2+ independent workstreams |
| **T4** | T3 + managers dispatched with `isolation: "worktree"` + `run_in_background: true`, merged at wave end | Disjoint file sets + wall-clock matters |

Ladder is capped at 4 — deeper nesting never amortizes its cold-start context cost. Managers are the `manager` agent (`subagent_type: manager` — has the Agent tool); each nesting level costs a cold start, so the formula must justify it before it is incurred.

## Tier Formula

Computed at plan-writing time from measurable plan properties; declared in the checklist header **with its inputs**:

1. Task count ≤3 AND ≤2 files/task AND no architecture decisions → **T1**
2. Else, 1 workstream → **T2**
3. Else, 2+ independent workstreams (no shared files, no sequential dependency between them) → **T3**
4. T3 AND workstreams touch disjoint file sets AND wall-clock matters → **T4**

If formula inputs are ambiguous (can't tell whether workstreams are independent): default to the **lower** tier — pivoting up is cheaper than a wasted manager cold start.

**Design-in-context exception (2026-07-01):** when the wave's content was authored in the orchestrator's own context (config/docs waves — agent definitions, skill rewrites, workspace MDs), T1 inline-execute is permitted regardless of task count. Dispatch re-briefing cost dominates when every fact a subagent would need already sits in orchestrator context. Evidence: native-agents wave, 11 tasks formula-T2, ran T1 — 0 redos, 0 escalations.

**Pivot rule:** the orchestrator may move up or down a tier mid-wave when reality diverges from the plan (workstreams merge/split, tasks balloon/collapse). Every pivot is appended to the checklist header `**Tier:**` line and logged in the Orchestration Log with a one-line reason. A pivot means the formula missed — the Wave Scorecard says why.

## Plan Profiles

Selected at the end of `superpowers:writing-plans`; recorded in the checklist header. Present the recommended profile plus a one-line trade-off for each alternative — user confirms with plan approval.

| Profile | Task granularity | Review depth | Tier bias | Verification |
|---|---|---|---|---|
| **Precision** | Verbatim code in plan | Full two-stage (spec + quality) | Sequential T2 | Full DoD per task |
| **Standard** (default) | Mixed — verbatim where risk, goal-level where routine | Combined single-pass on verbatim tasks; two-stage on judgment tasks | Formula | DoD per task |
| **Velocity** | Goal-level | Spot-check risky tasks only | Formula, parallel allowed | DoD at wave end |

Guidance: **Precision** for auth, payments, data migrations. **Velocity** for scaffolds, docs waves, low-risk UI. **Standard** otherwise. Reflect scores profile fit — a Velocity wave needing 3 redos should have been Standard.

## Predefined Agents (2026-07-01)

Every dispatch uses a predefined agent via `subagent_type` — never `general-purpose` with a briefing MD in the prompt. Definitions live in `claude-config/agents/` (junctioned to `~/.claude/agents/`, workspace-wide). Tool access is ENFORCED by each agent's `tools:` frontmatter — the old honor-system Tool Access Matrix is retired. Edits to roster, tools, or model defaults go to the agent files; reflect owns them like it owns this file.

| subagent_type | Role | tools | model default |
|---|---|---|---|
| `recon` | Reads/greps/existence checks/output verification; fable diagnostic lane | read-only + Bash | haiku |
| `implementer` | ONE scoped task via TDD | full edit, no Agent | sonnet |
| `reviewer` | Spec + quality review of a diff | read-only + Bash | opus |
| `manager` | T3+ workstream owner, dispatches own agents | all incl. Agent | opus |
| `component-agent` | One library component end-to-end | implementer set | sonnet |
| `new-repo-agent` | Full 24-step repo bootstrap | implementer set | sonnet |
| `docs-agent` | Pure doc/MD work | edit, no Bash | haiku |
| `wave-release-agent` | Wave DoD verify + changeset + PR prep | implementer set | sonnet |

New `subagent_type` values hot-load mid-session (verified 2026-07-01 — all 8 seed agents resolved without a fresh session; validated by live dispatch same day: 4/4 core agents, tool enforcement exact).

Orchestrator's own lane is unchanged: writes checklist + docs only, never source; reads summaries only — recon reads source.

## Model Routing — Two Layers (living data — reflect edits this)

**Layer 1 — frontmatter defaults.** The 80% case. No `model:` param on the dispatch; the agent's own default applies (table above).

**Layer 2 — dispatch-time override.** Orchestrator (or manager) sets `model:` on the Agent call only when a signal fires. Signals are checked BEFORE dispatch — pay the stronger model upfront instead of after a failed round:

| Signal at dispatch time | Override | Since | Evidence |
|---|---|---|---|
| 3+ files, shared state, integration flavor | implementer → opus | seed | promoted from post-failure escalation signals |
| Novel pattern — nothing in repo to copy | implementer → opus | seed | — |
| Precision-profile task (auth/payments/migration) | implementer → opus | seed | — |
| Mechanical spec-verbatim task | reviewer → sonnet | seed | byte-compare needs no opus |

**Fable lanes** (fable is otherwise banned below the orchestrator — never bounded implementation):

| Lane | Dispatch | Since | Evidence |
|---|---|---|---|
| Diagnostic after opus failure | recon → fable, systematic-debugging framing | seed | replaces bare "surface to user" |
| High-stakes design review (Precision spec) | reviewer → fable | seed | — |
| Coupled-wave manager (independence on paper, coupling risk flagged in plan) | manager → fable | seed | — |

Reflect appends or amends rows (with date + evidence) when a Wave Scorecard shows a misroute, and prunes fable lanes that don't earn their cost.

## Escalation Ladder (anti-thrash)

Route right upfront (Layer 2). Then, on failure:

1. **Sonnet fails, signals present** (3+ files · integration/architecture flavor · review fault at design level) → escalate to opus immediately. No sonnet retry.
2. **Sonnet fails, no signals** → one retry, then opus.
3. **Opus fails** → ONE fable `recon` diagnostic dispatch (read-only): classify plan defect vs wrong assumption vs environment → surface to user WITH the diagnosis. Never a third implementation attempt.

Log every escalation: `task · sonnet FAIL×n → opus · outcome · signal that fired`. Escalations are routing-table candidates at reflect.

## Redo Protocol

- **Fixable failure, same model** → `SendMessage` to the SAME agent with the review findings — warm context, no cold re-brief. Log tag: `redo-warm`.
- **Escalation to a stronger model** → fresh dispatch — fresh eyes are the point. Log tag: `redo-cold`.
- Scorecard tracks warm-vs-cold outcomes; if warm redos regress (agent anchored on its mistake), reflect narrows the warm lane.

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
<!-- reflect fills: tier accuracy · model accuracy (escalations + overrides) · fable-dispatch value · redo warm/cold · profile fit · context % at wave end (/context) · /usage summary -->

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
- **Model accuracy** — escalation count + which signals fired; Layer-2 overrides that proved unnecessary
- **Fable-dispatch value** — each fable dispatch (diagnostic/design-review/manager lane): did it earn its cost? Prune lanes that don't.
- **Redo economics** — `redo-warm` vs `redo-cold` counts and outcomes
- **Profile fit** — redo/defect rate vs what the profile predicted
- **Context efficiency** — `/context` % at wave end · `/usage` totals

Scorecard evidence drives reflect Phase 4/5 proposals: routing-table rows, formula adjustments, profile-guidance edits — all applied to THIS skill file (it lives in `claude-config`, edits persist). The scorecard travels with the checklist to `done/` as the historical record.

---

## Session Start Protocol

1. Scan `docs/<project>/checklists/active/` — each file is an in-flight phase
2. Read the checklist header: branch, tier, profile, spec path
3. **Worktree check (mandatory at T2+, 2026-06-12):** before the first dispatch, check whether the target repo has another branch in flight — if so, work in a worktree (`superpowers:using-git-worktrees`). Skipping this switched a repo mid-wave once; user had to catch it.
4. Find the first unchecked task — resume there
5. Do not re-read specs or full plan prose unless a specific task requires design decisions

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

Dynamic fields only — the static half (role, standards, ISSUE protocol, escape hatch, what-not-to-do) lives in the agent definition. Never write "based on your findings, implement X" — that delegates understanding.

```
Goal:           <what to produce and why — one sentence>
Scope:          <exact files, dirs, or modules>
Prior context:  <what has been tried or ruled out>
Output format:  <diff, report, file list, JSON, etc.>
Constraints:    <ONLY task-specific constraints — omit if none; stack rules are in the agent>
```

Every Scope line ends with the escape hatch: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it."

At T3+, `manager` dispatches additionally include: workstream definition and file-set boundary (the manager agent carries the template itself).

## Judgment Rules (earned 2026-06-10)

- **Verify reviewer Criticals before dispatching fixes.** Read the cited source lines yourself first — reviewers false-alarm; a wrong fix cycle costs a full dispatch + re-review.
- **Combined review for verbatim-code tasks.** When a plan task prescribes exact code byte-for-byte, collapse two-stage review into ONE Opus pass (spec byte-compare + quality). Tasks with implementer latitude keep the full two-stage flow.
- **Trivial-fix exception (widened 2026-06-12).** The orchestrator may hand-apply a ≤2-line mechanical change (typo, escaping, formatting artifact, user-requested addition like a nav entry) when the implementer agent is no longer reachable, provided it has no test impact and gets an Orchestration Log line. Anything requiring judgment or touching 2+ sites: re-dispatch.
- **Post-compaction log append (2026-06-12).** Before appending to the Orchestration Log after a compaction, re-read the log tail — the summary may claim lines were logged that sit outside your Read window; appending blind duplicates them.
- **Briefing escape hatch (2026-06-12; baked into all agent definitions 2026-07-01).** Every dispatch's scope constraint ends with: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it." (B6 shipped an overlay defect because the constraint had no exit; B7 with the hatch went clean.)
- **Per-component test entries only (2026-06-12; baked into `implementer` agent 2026-07-01).** Shared spec files (axe, e2e): "add ONLY entries for your component" — an A1 implementer bundled entries for unmerged components and broke a later task's e2e run.

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move checklist `active/` → `done/` (`Move-Item` / `mv`)
3. **Run `claude-md-management:reflect` — mandatory.** Fill the Wave Scorecard (protocol above)
4. Reflect Phase 6 prompts `/usage`, then `/clear` if the project is fully done

## T4 Merge Protocol

Managers get `isolation: "worktree"` on the Agent call — the harness creates and cleans up the worktree; no manual `git worktree` choreography. Worktrees must have disjoint file sets — that is a formula precondition, not a hope. A merge conflict at wave end = formula miss → log it, scorecard it. Merge order: smallest diff first; rebase-only (`git rebase origin/main`, never merge commits).

## Continuation Handoff

When the `continuation` skill writes a handoff, the Current State block includes the tier, profile, and a pointer to the Orchestration Log so the next session re-enters at the right tier without re-deriving.

## Skills Reference

Situation→skill routing lives in [`docs/SKILLS.md`](../../workspace/docs/SKILLS.md) — update that file when routing changes, not this one.
