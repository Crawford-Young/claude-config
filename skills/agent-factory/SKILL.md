---
name: agent-factory
description: Use when executing a multi-task plan or checklist, deciding whether to spawn a subagent, choosing a model for a dispatch, or proposing a Workflow fan-out. Carries the spawn posture, the dispatch template, and model routing.
---

# Agent Factory

Orchestration for multi-task work. Trust the models: dispatch when it helps, keep briefs short and pointed, judge results by gates.

## Spawn posture

- **Orchestrator (main session):** dispatch readily. Parallel-safe clusters, cross-repo work, and gate-heavy tasks are cheaper in a child than in your own context. Small docs/config tasks (≤2 files) run inline.
- **Spawned agents:** inline is the default; spawn only when the task exceeds what you can do well (missing tools/skills, context blowout, real parallelism). Agents may spawn their own subagents when the situation calls for it.
- **Worktree isolation** (`isolation: "worktree"`) when parallel children mutate files — disjoint file sets required.
- **Workflow tool** for enumeration-shaped fan-outs (consumer sweeps, adversarial verify rounds, migrations over a file list). User opt-in: propose it in one line (agent count, rough cost), wait for the go.

## Model routing

See [`agents/ROUTING.md`](../../agents/ROUTING.md) for the evidence-distilled table. Short form:

- **haiku** — recon, existence checks, single-fact read-and-report, doc fetches.
- **sonnet** — scoped implementation with a clear brief; verbatim/mechanical batches; adjudication-style reviews with enumerated probes.
- **opus** — reviews the orchestrator can't pre-frame; 3+ file integration; novel patterns; high-stakes code (auth, payments, migrations).
- **fable** — usage-billed; per-run user clearance required (the Agent hook enforces it — user replies `FABLE OK`). Reserve for diagnostics after an opus failure or exceptional-stakes review.

Set `model:` explicitly on every dispatch of a type without a frontmatter default (hook-enforced). Opus briefs: no "verify your work" scaffolding (causes over-verification); add a scope-discipline line.

## Dispatch template

Dynamic fields only — role, standards, and the ISSUE/NEEDS_CONTEXT contract live in the agent definition:

```
Goal:           <what to produce and why — one sentence>
Scope:          <exact files/dirs — end with: "if the constraint blocks the correct fix, report NEEDS_CONTEXT">
Prior context:  <what's been tried or ruled out; cite verified file:line for any premise the brief asserts>
Output format:  <diff, report, file list>
Constraints:    <task-specific only — omit if none>
```

- Never restate brief contents in dispatch prose — point at the brief.
- No commit steps in implementer briefs — the orchestrator owns git.
- Verify any reviewer finding you act on against source first; when a reviewer contests an implementer's empirical claim, re-run the experiment — neither report is authority.
- Fixable failure → message the SAME agent with findings (warm redo). Capability-shaped failure → escalate the model, fresh dispatch.

## Checklist execution

The checklist (created by the `plan` skill via `checklist.mjs`) is the source of truth across sessions. Tick tasks as they complete (`checklist.mjs tick` — real stamps), append one Log line per dispatch/deviation/decision at the moment it happens, and stop at `<!-- COMPACT POINT -->` markers: state on disk → hand a continuation prompt and suggest `/clear`. At wave close run the `reflect` skill, then `checklist.mjs done`.
