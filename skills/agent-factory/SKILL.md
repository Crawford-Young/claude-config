---
name: agent-factory
description: Use when executing any multi-task plan or checklist, deciding whether to spawn a subagent (at any nesting depth), choosing which agent type or model to dispatch, authoring a new agent type, or logging subagent performance. Carries the spawn protocol, dispatch template, performance-MD duty, and escalation rules. Every spawning agent reads this file before its first spawn.
---

# Agent Factory

## Overview

Canonical orchestration standards. Supersedes the `orchestrate` skill (tier ladder T1–T4, plan profiles, and the Layer-2 routing table are retired — 2026-07-15).

The model: **demand-driven recursive spawning.** Any agent holding a task may spawn subagents when the task exceeds what it can do well inline — and those subagents may spawn further (platform wall: depth 5 below the main session; levels 1–4 can spawn, level 5 cannot). Every managing agent judges its children and logs performance; reflect aggregates those logs into global per-type profiles that drive future routing.

Two audiences:

1. **The orchestrator** (main session) — follows everything here.
2. **Any spawned agent about to spawn its own children** — reads this file first (your definition's pointer line sent you here), then follows §Spawn Model through §Performance MDs.

## Spawn Model

**Default is inline.** Spawning is the exception that must argue for itself. Justified triggers:

- (a) the task needs skills or tools you lack,
- (b) your context would blow past useful size,
- (c) parallelism wins wall-clock.

Rules:

- Each spawn gets a one-line justification — recorded in your performance MD entry for that child.
- No plan-time tier or structure prediction. The checklist header carries a `**Factory:**` line; the actual spawn tree is recorded in the Orchestration Log as it happens.
- Depth-5 platform wall. Soft economics keep real trees shallower — a tree pressing the wall is a planning smell.
- `isolation: "worktree"` survives as a per-dispatch option when spawned agents mutate files in parallel. Disjoint file sets are required; a merge conflict at wave end = routing miss → log it, scorecard it. Merge order: smallest diff first; rebase-only.
- **Fable rules, at every depth:** fable is usage-billed and never runs below the orchestrator without per-run user clearance. Live LLM rounds on the user's API keys require per-run user clearance regardless of model — present lane, turn count, expected writes first.

## Assignment Routing

**Profiles are the routing authority; type definitions are general guidance.**

Before spawning:

1. Read the candidate type's profile: `~/code/claude-config/agents/profiles/<type>.md`.
2. Route on profile evidence (strengths, weaknesses, model sweet spot, spawn-worthiness). The def's description is fallback only when no profile data exists.
3. Claims marked **provisional** (n=1) are hints, not authority.
4. Distill the relevant fit guidance into the child's brief — children never read profiles themselves.
5. Set `model:` on the Agent call per the profile's sweet spot; omit only when the profile says the frontmatter default is right.

Profiles never auto-load. Task-specific context flows through the **brief**; learned routing through **profiles read by the assigner**; definitions carry identity only.

## Dispatch Template

Dynamic fields only — the static half (role, standards, ISSUE protocol, escape hatch) lives in the agent definition. Never write "based on your findings, implement X" — that delegates understanding.

```
Goal:           <what to produce and why — one sentence>
Scope:          <exact files, dirs, or modules>
Prior context:  <what has been tried or ruled out + profile-derived fit guidance>
Output format:  <diff, report, file list, JSON, etc.>
Constraints:    <ONLY task-specific constraints — omit if none; stack rules are in the agent>
```

Every Scope line ends with the escape hatch: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it."

**Trap citations (2026-07-14):** when the task's touched files carry a documented trap in the repo's AGENTS.md, the brief's Prior-context line CITES that entry by anchor/keyword and requires the implementer AND reviewer to state how the change interacts with it. Documented knowledge does not transfer by existing — w2.6 S14: opus impl + opus review both missed the AGENTS.md:32 mocked-lib trap; the redo cost a full round.

**Dispatch prose never restates brief contents** — point at the brief; a paraphrase that drifts makes the implementer + reviewer burn a round reconciling the contradiction. Copy source is the brief/plan, not the spec, when the two differ. (2026-07-04; 2026-07-14.)

**Pre-verified API cites (2026-07-21, w3):** when a task consumes a library API, the brief cites the installed dist (`dist/index.d.ts` file:line for each shape) verified by the orchestrator at dispatch time — removes the implementer's whole assumption-risk class for free (A13: zero API re-derivation, zero redos). Corollary for verification-only gate-suite briefs: carry the FULL prior-run exemption record verbatim (every accepted gap's file:line), not a paraphrase — a line-shift plus one undocumented-to-the-agent gap cost an adjudication round-trip (w3 A9-close).

## Performance MDs

Every agent that spawned children writes ONE performance MD: `docs/<project>/agent-logs/<date>-<wave>-<agent-role>.md`. Project working artifact — never in junctioned claude-config dirs.

- **Write-as-you-go (mandatory):** append the child's entry immediately after it returns — never batch at the end. An agent death then loses at most one entry.
- **The managing agent is the sole judge.** Record effort from your own observation: redo count, escalations, dispatch duration, output quality. Grades anchor to verifiable outcomes (gates passed, redo count), not impressions.
- **The orchestrator is a managing agent too** — it writes its own performance MD (`docs/<project>/agent-logs/<date>-<wave>-orchestrator.md`) for every dispatch it makes, write-as-you-go, same as any manager. IN ADDITION, its top-level dispatch outcomes get one-line grades in the checklist Orchestration Log (e.g. `· PASS · grade 5`) so the checklist stays self-contained. The log line never replaces the MD entry. (2026-07-15 bootstrap reflect; ambiguity killed 2026-07-16 after an orchestrator skipped the MD citing this line.)

Entry format:

```markdown
## <child-type> · <model> · task: <one-line>
- why spawned: <one line>
- effort: <observed: turns/duration/redos/escalations>
- outcome: PASS / FAIL / redo-warm / redo-cold / NEEDS_CONTEXT
- grade: <1-5> — <one-line: fit for this task type?>
- lesson: <optional — misroute signal, surprise strength/weakness>
```

- Nested managers pass their performance MD path upward in their summary; the orchestrator's log links them all — a tree of MDs, one per managing agent.
- **ISSUE / NEEDS_CONTEXT lines pass upward VERBATIM** — never summarized, at every hop.

## Type Authoring

When no roster or staged type fits:

1. Write a new definition to `~/.claude/agents/staged-<wave-slug>-<role>.md` (wave slug guards concurrent-session collisions). Hot-loads within seconds.
2. Frontmatter: `name`, `description` (dispatch criteria), minimum-needed `tools` (include `Agent`), `model` default, `staged-by: <agent-role>` + wave.
3. Body: skeleton only — role identity, boundaries, output contract, ISSUE/NEEDS_CONTEXT block, and the factory pointer line.
4. **Proliferation guard:** prefer briefing a general type; author a new type only when the specialization would repeat.
5. `staged-*` is gitignored in claude-config. At reflect: promote (rename into `claude-config/agents/`, commit, create profile stub) or delete, per its performance-MD entries.

## Escalation Ladder (anti-thrash)

Route right upfront via profiles. Then, on failure:

1. **Sonnet fails, signals present** (3+ files · integration/architecture flavor · review fault at design level) → escalate to opus immediately. No sonnet retry.
2. **Sonnet fails, no signals** → one retry, then opus.
3. **Opus fails** → ONE fable `recon` diagnostic dispatch (read-only, orchestrator clearance rules apply): classify plan defect vs wrong assumption vs environment → surface to user WITH the diagnosis. Never a third implementation attempt.

Log every escalation: `task · sonnet FAIL×n → opus · outcome · signal that fired`. Escalations are profile-update candidates at reflect.

## Redo Protocol

- **Fixable failure, same model** → `SendMessage` to the SAME agent with the review findings — warm context, no cold re-brief. Log tag: `redo-warm`.
- **Escalation to a stronger model** → fresh dispatch — fresh eyes are the point. Log tag: `redo-cold`.
- Profiles track warm-vs-cold outcomes; if warm redos regress (agent anchored on its mistake), reflect narrows the warm lane in the profile.

## Agent Unresumable Mid-Task (added 2026-07-16, w3L)

If a subagent's transcript is lost (session death, post-compaction resume failure) with its task partially done:

- **Remaining steps are MECHANICAL** (run a command, commit prepared files, draft prose from existing evidence — no source code, no design decisions) → orchestrator finishes them inline, logging each in the Orchestration Log with an `agent unresumable → inline` tag. Verify the dead agent's on-disk artifacts before building on them.
- **Remaining steps need implementation or judgment** → fresh spawn; the brief carries the dead agent's evidence-so-far (file paths, EXIT lines, commit shas), never a paraphrase of its lost reasoning.
- Grade the dead agent on artifacts delivered, not the missing report. Session death is infra, not FAIL — but repeated idle-death from backgrounding gates is a def gap to fix at reflect.

## Parallel Dispatch via Worktrees (added 2026-07-16, w3L)

Worktree-parallelize ONLY task clusters the plan explicitly annotates `**Parallel-safe with:**` (no shared files, no Consumes/Produces edge). Unannotated tasks run serial — most plans are dependency chains where parallelism buys nothing, and Windows worktree overhead (removal fights, per-worktree install + `.env` copies, gate CPU contention) makes speculative parallelism a net loss. Cross-repo parallel dispatches (disjoint repos) need no worktrees.

## Session Overflow Lane

`claude --bg "<prompt>"` spawns a full background Claude Code session with its own depth-5 tree — for whole-wave parallelism (e.g. two repos at once). **Orchestrator-only, user-cleared per launch** — it runs unattended and bills independently. Results come back via files/repo, not conversation.

## Efficiency Playbook

Mandatory for every managing agent:

- `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- ToolSearch for deferred tools — never guess schemas
- `Explore` agent for fan-out searches across many files
- Lazy spec loading: briefs get file path + interface contract + test expectations — full spec only when the task requires design decisions
- Background tasks (`run_in_background`) for long-running commands — **orchestrator only.** Synchronous subagents cannot await background completions (their "wait" ends the turn → idle until resumed); brief any gate-running subagent to run gates FOREGROUND, unpiped, `; echo EXIT:$?` appended (w3L: two wasted resume rounds)
- More than 10 files read → offload remaining research to a focused subagent

## Checklist Template

```markdown
<!-- ORCHESTRATOR ONLY — update checkboxes, Orchestration Log, and Reflect Log. Subagents: read-only. -->
# <project> — <Phase/Wave Name>
**Branch:** feat/<name>
**Factory:** <starting shape — e.g. "inline until spawn triggers fire"; spawn tree lives in the Orchestration Log>
**Spec:** docs/<project>/specs/<spec-file>.md

---

## Tasks

- [ ] **Task 0 — Issue log created** at `docs/<project>/issues/<date>-<wave>-issues.md` (orchestrator, same breath as checklist approval — never optional; missed 3× when left to memory, last 2026-07-15)

- [ ] **Task 1** — ...

<!-- COMPACT POINT -->

---

- [ ] **Reflect** — Run `claude-md-management:reflect` · orchestrator

---

## Orchestration Log
<!-- one line per spawn/escalation: parent → child-type/model · task · outcome · perf-MD path for managing children -->

## Wave Scorecard
<!-- reflect fills: spawn-tree review (justification quality · depth · count) · routing accuracy vs profiles · perf-MD completeness · redo warm/cold · context % at wave end (/context) · /usage summary -->

## Reflect Log
```

Any checklist with 8+ tasks MUST include `<!-- COMPACT POINT -->` markers every 3–4 tasks.

Markers go at genuine sync points. When tasks will execute as one parallel batch (fan-out installs/gates across repos), place the marker AFTER the batch completes, never between batched tasks — a marker inside a parallel batch gets blown past structurally. (2026-07-16 eb2 w2.)

## Orchestration Log Protocol

Append one line per spawn, escalation, and structural change — at the moment it happens, not retroactively:

```
- spawn: orchestrator → implementer/sonnet · task3 · PASS
- spawn: orchestrator → manager/opus · workstream-B · PASS · perf-MD: docs/<project>/agent-logs/2026-07-15-wB-manager.md
- escalate: task4 impl · sonnet FAIL×2 → opus · PASS · signal: integration-heavy
```

One line each. Never paste raw subagent output into the log.

## Wave Scorecard Protocol (at reflect)

Reflect Phase 1 reads the checklist and finds the Orchestration Log + empty Scorecard. During reflect Phase 3, before the `/usage` prompt, also ask the user to run `/context` and paste both. Then fill:

- **Spawn-tree review** — every spawn's justification: did it earn its cold start? Depth and count vs what the work needed
- **Routing accuracy** — dispatches that matched profile guidance vs misroutes; escalation count + signals fired
- **Perf-MD completeness** — every managing agent wrote one, write-as-you-go honored, grades outcome-anchored
- **Redo economics** — `redo-warm` vs `redo-cold` counts and outcomes
- **Context efficiency** — `/context` % at wave end · `/usage` totals

Scorecard evidence drives profile updates at reflect. The scorecard travels with the checklist to `done/` as the historical record.

## Reflect Integration

**Timing (2026-07-16, w3L):** reflect runs at wave close BEFORE requesting push/PR — after the final task + user QA, while the wave branch is still open. Its repo-level doc proposals (README/CLAUDE.md rules, wave-table status flip written as the post-merge truth) commit to the wave branch and ship in the wave PR — never a follow-up micro-docs PR. Only post-publish corrections (e.g. a version number stolen by a concurrent wave) go in a later branch. Workspace/claude-config edits are unaffected — different repo, any time.

At every wave-end reflect:

1. Sweep `docs/<project>/agent-logs/` (entries since last reflect)
2. Update `claude-config/agents/profiles/<type>.md` — new claims carry date + wave evidence; n=1 marked provisional; firm claims need n≥2; discount grades not grounded in verifiable outcomes
3. Promote or delete staged types (`~/.claude/agents/staged-*`) per their performance entries
4. Move swept logs to `docs/<project>/agent-logs/done/`

## Session Start Protocol

1. Scan `docs/<project>/checklists/active/` — each file is an in-flight phase
2. Read the checklist header: branch, factory line, spec path
3. **Worktree check (mandatory before first spawn that edits code, 2026-06-12):** if the target repo has another branch in flight, work in a worktree (`superpowers:using-git-worktrees`)
4. Find the first unchecked task — resume there
5. Do not re-read specs or full plan prose unless a specific task requires design decisions

## Checklist Editing Protocol

**Only the orchestrator writes to checklist files. Spawned agents are read-only.**

- Tick `- [x]` immediately after a task completes; ticks + log lines land in the same action batch as the commit they record
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

The checklist is the sole source of truth across compaction boundaries. Marker stop is absolute — blanket task approval never waives it.

## Judgment Rules

- **Verify reviewer Criticals before dispatching fixes.** Read the cited source lines yourself first — reviewers false-alarm; a wrong fix cycle costs a full dispatch + re-review. (2026-06-10)
- **Combined review for verbatim-code tasks AND small behavioral patches.** When a plan task prescribes exact code byte-for-byte, collapse two-stage review into ONE pass (spec byte-compare + quality). Same lane for small behavioral patches with implementer latitude — one combined pass covering spec compliance + adjudication of the implementer's flagged decisions; two-stage buys nothing at this size. (2026-06-10; widened 2026-07-21 w3 — n=2 clean: A12 lib patch, A13 multi-part app consume, both zero-finding PASSes with mechanism-level adjudications.) Large integration tasks keep the full two-stage flow.
- **Trivial-fix exception.** A managing agent may hand-apply a ≤2-line mechanical change (typo, escaping, formatting artifact, selector disambiguation, user-requested addition) when dispatch cost clearly exceeds the change — provided it has no behavioral test impact and gets an Orchestration Log line. Anything requiring judgment or touching 2+ sites: dispatch. (widened 2026-06-12, 2026-07-07)
- **Post-compaction log append.** Before appending to the Orchestration Log after a compaction, re-read the log tail — the summary may claim lines were logged that sit outside your Read window. (2026-06-12)
- **Briefing escape hatch.** Every dispatch's scope constraint ends with: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it." (2026-06-12)
- **Per-component test entries only.** Shared spec files (axe, e2e): "add ONLY entries for your component." (2026-06-12)
- **Zero-output dispatch death = infra failure, not FAIL.** A dispatch returning 0 tokens with a session-limit message is not a model failure: re-dispatch identical once the limit resets — do not count it toward escalation. Log as `dispatch died (session limit) → re-dispatch clean`. (2026-07-02)
- **Stalled-agent recovery.** A watchdog-killed dispatch whose work is already on disk is also infra, not FAIL: verify the claimed artifacts hands-on, then resume the SAME agent with a report-only message — never redo the work or re-dispatch cold. (2026-07-08)

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move checklist `active/` → `done/`
3. **Run `claude-md-management:reflect` — mandatory.** Fill the Wave Scorecard; run the profile rollup (§Reflect Integration)
4. Reflect Phase 6 prompts `/usage`, then `/clear` if the project is fully done

## Continuation Handoff

When the `continuation` skill writes a handoff, the Current State block includes the `**Factory:**` line (spawn tree summary + open perf-MD paths) and a pointer to the Orchestration Log so the next session re-enters without re-deriving.

## Skills Reference

Situation→skill routing lives in [`docs/SKILLS.md`](../../workspace/docs/SKILLS.md) — update that file when routing changes, not this one.
