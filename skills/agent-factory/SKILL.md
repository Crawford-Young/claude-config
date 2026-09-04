---
name: agent-factory
description: Use when executing a multi-task plan or checklist, deciding whether to spawn a subagent, choosing a model for a dispatch, or proposing a Workflow fan-out. Carries the spawn posture, the dispatch template, and model routing.
---

# Agent Factory

Orchestration for multi-task work. Trust the models: dispatch when it helps, keep briefs short and pointed, judge results by gates.

## Spawn posture

- **Orchestrator (main session):** dispatch readily — but sweep effort on the current model first (raise your own effort/thinking level before reaching for a child). Dispatch pays off when (a) the pieces are independent, ideally more than one context window each, or (b) there's a long cost tail on routine work. Parallel-safe clusters, cross-repo work, and gate-heavy tasks are cheaper in a child than in your own context. Small docs/config tasks (≤2 files) run inline.
- **`ultrathink`** deepens reasoning for one turn at unchanged API effort — the cheapest escalation available (cheaper than switching models or dispatching a child). "think", "think hard", "think more" are casual English, not recognized keywords with any effect.
- **Spawned agents:** inline is the default; spawn only when the task exceeds what you can do well (missing tools/skills, context blowout, real parallelism). Agents may spawn their own subagents when the situation calls for it.
- **Depth limit:** the default subagent spawn depth is 3 — a depth-3 wall, where the terminal layer at that depth loses the `Agent` tool outright, except for a `fork`, which skips the tool filters ordinary subagents get and always inherits the parent's exact tool pool. Depth is about nesting, not foreground vs background, and an agent cannot observe its own current depth from inside itself. Before planning any spawn, confirm `Agent` is in your tool list. If it is absent, report `NEEDS_CONTEXT: no Agent tool in this dispatch` — do not plan around it. If present, spawn only when the situation genuinely calls for it (missing tools, context blowout, real parallelism).
- **No self-verification:** a reviewer (or any agent) must not judge or validate its own prior output — that's a fresh-context subagent's job. Objective gates the orchestrator can run itself (tests, lint, typecheck — read by exit line) are unaffected.
- **Worktree isolation** (`isolation: "worktree"`) when parallel children mutate files — disjoint file sets required.
- **Workflow tool** for enumeration-shaped fan-outs (consumer sweeps, adversarial verify rounds, migrations over a file list). User opt-in: propose it in one line (agent count, rough cost), wait for the go.
- **`ultracode`** is an automatic Workflow-planning lane set via Claude Code's `ultracode` effort setting (a setting, not a prompt keyword), distinct from manually proposing Workflow — it carries the same user-opt-in rule as Workflow, a stronger gate to respect since it's session-wide rather than per-proposal.
- **Workflow limits:** 1,000-agent hard cap on a single run. If an agent mid-run fails, resuming reruns every agent started after the failed one, including ones that already finished successfully — resume is not free.
- **Workflow-lane settings** `workflowSizeGuideline` and `subagentPromptCacheTtl` exist as knobs — no decided value yet; set them when a Workflow run is actually proposed.

## Model routing

See [`agents/ROUTING.md`](../../agents/ROUTING.md) for the evidence-distilled table. Short form:

- **sonnet at `effort: low`** — recon, existence checks, single-fact read-and-report, doc fetches, verbatim batches. We do not route to haiku (2026-09-04): effort is silently dropped there, so those dispatches forfeited the axis this table is built on. Lower the effort, not the model.
- **sonnet** — scoped implementation with a clear brief; verbatim/mechanical batches; adjudication-style reviews with enumerated probes.
- **opus** — reviews the orchestrator can't pre-frame; 3+ file integration; novel patterns; high-stakes code (auth, payments, migrations).
- **fable** — usage-billed; per-run user clearance required (the Agent hook enforces it — user replies `FABLE OK`). Reserve for diagnostics after an opus failure or exceptional-stakes review.

Set `model:` explicitly on every dispatch of a type without a frontmatter default (hook-enforced). Any brief, any model: omit "verify your work" scaffolding (over-verification — the harness's verifier is a fresh-context subagent regardless of which model wrote the brief); add one scope-discipline line; cap delegation explicitly when the dispatched type carries the `Agent` tool.

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

The checklist (created by the `plan` skill via `checklist.mjs`) is the source of truth across sessions. Tick tasks as they complete (`checklist.mjs tick` — real stamps), append one Log line per dispatch/deviation/decision at the moment it happens, and stop at `<!-- COMPACT POINT -->` markers: state on disk → hand a continuation prompt and suggest `/clear`. Dispatches run in the background — keep working the checklist while children are in flight, and only block when the next task genuinely depends on a still-pending result. At wave close run the `reflect` skill, then `checklist.mjs done`.
