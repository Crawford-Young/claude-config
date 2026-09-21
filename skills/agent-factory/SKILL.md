---
name: agent-factory
description: Use when executing a multi-task plan or checklist, deciding whether to spawn a subagent, choosing a model for a dispatch, or proposing a Workflow fan-out. Carries the spawn posture, the dispatch template, and model routing.
---

# Agent Factory

Orchestration for multi-task work. Trust the models: dispatch when it helps, keep briefs short and pointed, judge results by gates.

## Choosing a lane

The deciding question: who holds the plan? (Source: https://code.claude.com/docs/en/agents.md, lane comparison.)

| Lane | Who holds the plan | Shape | Status |
|---|---|---|---|
| subagent | Claude, turn by turn | results return to the caller | GA |
| teammate | the lead, turn by turn | shared task list plus direct teammate messaging | experimental, now on |
| Workflow | the script | results live in script variables; dozens to hundreds of agents | user opt-in |
| agent view (`claude agents`) | you | independent background sessions | research preview, on by default |
| cloud session / routine | you, or a schedule | unattended session on Anthropic infra (`claude --cloud`, `/schedule`) | research preview |

## Spawn posture

- **Orchestrator (main session):** dispatch readily — but sweep effort on the current model first (raise your own effort/thinking level before reaching for a child). Dispatch pays off when (a) the pieces are independent, ideally more than one context window each, or (b) there's a long cost tail on routine work. Parallel-safe clusters, cross-repo work, and gate-heavy tasks are cheaper in a child than in your own context. Small docs/config tasks (≤2 files) run inline.
- **`ultrathink`** deepens reasoning for one turn at unchanged API effort — the cheapest escalation available (cheaper than switching models or dispatching a child). "think", "think hard", "think more" are casual English, not recognized keywords with any effect.
- **Spawned agents:** inline is the default; spawn only when the task exceeds what you can do well (missing tools/skills, context blowout, real parallelism). Agents may spawn their own subagents when the situation calls for it.
- **Depth limit:** the default subagent spawn depth is 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; the pre-v2.1.219 default was 5) — at the wall a subagent loses the `Agent` tool outright, and a `fork` keeps it listed but the call errors, so no lane spawns past the wall. Depth is about nesting, not foreground vs background, and an agent cannot observe its own current depth from inside itself. Before planning any spawn, confirm `Agent` is in your tool list. If it is absent, report `NEEDS_CONTEXT: no Agent tool in this dispatch` — do not plan around it. If present, spawn only when the situation genuinely calls for it (missing tools, context blowout, real parallelism).
- **No self-verification:** a reviewer (or any agent) must not judge or validate its own prior output — that's a fresh-context subagent's job. Objective gates the orchestrator can run itself (tests, lint, typecheck — read by exit line) are unaffected.
- **Worktree isolation** (`isolation: "worktree"`) when parallel children mutate files — disjoint file sets required.
- **Workflow tool** for enumeration-shaped fan-outs (consumer sweeps, adversarial verify rounds, migrations over a file list). User opt-in: propose it in one line (agent count, rough cost), wait for the go.
- **`ultracode`** diverts a task into the Workflow tool around the factory's dispatch path two ways: (a) a typed prompt keyword — including the word in a prompt opts that turn into Workflow, governed by the `workflowKeywordTriggerEnabled` setting (default true); (b) the session setting `ultracode` / `/effort ultracode` — xhigh effort plus standing workflow orchestration. Both carry the same user-opt-in rule as manually proposing Workflow, a stronger gate to respect since either is session/prompt-wide rather than per-proposal.
- **Workflow limits:** 1,000-agent hard cap on a single run. If an agent mid-run fails, resuming reruns every agent started after the failed one, including ones that already finished successfully — resume is not free.
- **Workflow-lane settings:** `workflowSizeGuideline` is `medium` (<10 agents, platform default — user decision 2026-09-21, keeps runs inside the Max plan with no extra usage); `subagentPromptCacheTtl` stays unset until a Workflow run is actually proposed.

### Agent teams

Agent teams went on globally 2026-09-21 (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`).

- An Agent call with a `name` launches a teammate instead of a subagent, unless it's a `fork` or passes `isolation` — unnamed Agent calls stay plain subagents, so naming is the deliberate act that changes the lane.
- One team per session, lead fixed, no nested teams; in-process teammates can't be resumed by `/resume` or `/rewind` — don't plan a teammate dispatch across a session boundary.
- Teammates are NOT worktree-isolated — partition work by file, never by ticket, to avoid concurrent-write collisions.
- Teammate permission prompts surface in the lead's session — expect to answer them yourself, not the teammate.
- A named def keeps its `tools:`, `model:` and body but drops `effort:` — teammates inherit the lead's effort, so a named `recon`/`Explore`/`web-recon` runs at the lead's level, not `low`; teammates also spawn foreground subagents only. Final text still reaches the lead, in the idle notification.
- Name an agent (make it a teammate) only when workers must exchange results mid-task via shared task list or direct messaging — independent work stays an unnamed subagent, cheaper and simpler.
- Fable clearance is hook-enforced on every lane — teammates and subagents (Agent tool, `agent-model-guard.mjs`), `/model` switches (`pre-model-switch.mjs`), and shell-launched sessions (`claude -p`/`--bg`/`agents --model fable`, `bash-guard.mjs`) — all spending the same single-use marker and writing the same dispatch log.

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

### Report shape

Every dispatch's `Output format` inherits this shape by default — the brief's own Output format still decides what fills RESULT:

- `RESULT:` the deliverable, or a pointer to it
- `NOT CHECKED:` what was skipped, read only in excerpt, or unverifiable — required; "none" if none; goes before RESULT when RESULT is long
- `CONFIDENCE:` high/medium/low, one clause why
- `CONTRADICTIONS:` file:line pairs only, both sides actually read — else "none"
- `ISSUE:` / `NEEDS_CONTEXT:` — existing conventions, unchanged

- Never restate brief contents in dispatch prose — point at the brief.
- No commit steps in implementer briefs — the orchestrator owns git.
- Verify any agent report you act on — reviewer finding or teammate status — against source first, because a teammate's report can describe a file state that has since changed; when a reviewer contests an implementer's empirical claim, re-run the experiment — neither report is authority.
- Fixable failure → message the SAME agent with findings (warm redo). Capability-shaped failure → escalate the model, fresh dispatch.

## Checklist execution

The checklist (created by the `plan` skill via `checklist.mjs`) is the source of truth across sessions. Tick tasks as they complete (`checklist.mjs tick` — real stamps), append one Log line per dispatch/deviation/decision at the moment it happens, and stop at `<!-- COMPACT POINT -->` markers: state on disk → hand a continuation prompt and suggest `/clear`. Dispatches run in the background — keep working the checklist while children are in flight, and only block when the next task genuinely depends on a still-pending result. At wave close run the `reflect` skill, then `checklist.mjs done`.
