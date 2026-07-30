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

## Reference files

- `checklist-protocol.md` — checklist template, orchestration log, wave scorecard, reflect integration, checklist editing, phase complete. **Read when authoring or updating a checklist, or at wave close.**
- `session-protocol.md` — session start, compact discipline, continuation handoff, overflow lane. **Read at session start or when approaching a compact boundary.**

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

**Trigger (c) fires hardest on a plan whose clusters live in SEPARATE REPOS with no shared files — and inline default has silently overridden it.** Cross-repo clusters are the cleanest possible fan-out: zero file overlap by construction, no worktree isolation needed beyond the one each repo already gets, and each cluster carries its own gate. When a checklist declares N such clusters, the spawn justification is written per cluster and the decision to run them inline gets its OWN one-line justification in the Orchestration Log — silence is not a decision. The cost of getting this wrong is not a wrong answer, it is context: one orchestrator carrying five repos' file trees, gate outputs, and per-repo config differences is exactly the >150k-context spend the usage report flags (65% of last-24h usage at >150k, 2026-07-29). (2026-07-28/29 AdSense W1: 5 parallel-safe cross-repo clusters, `**Factory:**` header present, `agent-logs/` empty — zero dispatches, whole wave inline across a multi-day session with repeated compactions.)

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

**Pre-verified API cites (2026-07-21, w3):** when a task consumes a library API, the brief cites the installed dist (`dist/index.d.ts` file:line for each shape) verified by the orchestrator at dispatch time — removes the implementer's whole assumption-risk class for free (A13: zero API re-derivation, zero redos). Corollary for verification-only gate-suite briefs: carry the FULL prior-run exemption record verbatim (every accepted gap's file:line), not a paraphrase — a line-shift plus one undocumented-to-the-agent gap cost an adjudication round-trip (w3 A9-close). **Symmetry rule (2026-07-24, carsickyak T14):** EVERY fact a brief labels "pre-verified" gets the same dispatch-time verification — dep presence, config values, not just API shapes. A dep-presence claim recalled from memory (not verified) cost a NEEDS_CONTEXT round-trip while the dist-verified API cites in the SAME brief ran clean. Verify all, or write it as an assumption to confirm.

**Name the FAILURE MODE a mechanical step defends against, not just the step (2026-07-28, dog-eat-dog QA-R2a):** an implementer prioritizes steps by apparent value, and a bare grep/sweep instruction reads as busywork next to the code it accompanies. Stating what goes wrong if it is skipped converts it into a check worth running. The brief's Step 4 read "a survivor is a silent `nil` read on a `Resource`, NOT a parse error, so no gate in this repo catches it" — the grep was run and quoted verbatim in the report, on a task whose other seven files were pure verbatim transcription. (n=1, provisional. Cheap to apply: one clause.)

**No commit steps in implementer briefs (2026-07-23, slot-W2):** the implementer definition assigns git to the orchestrator — a brief instructing a commit creates a def/brief conflict the agent correctly refuses, burning a round-trip beat. Orchestrator verifies, then commits. (QA-R1: opus implementer refused the brief's commit step per role boundary; second occurrence of the class.)

## Performance MDs

Every agent that spawned children writes ONE performance MD: `docs/<project>/agent-logs/<date>-<wave>-<agent-role>.md`. Project working artifact — never in junctioned claude-config dirs.

- **Write-as-you-go (mandatory):** append the child's entry immediately after it returns — never batch at the end. An agent death then loses at most one entry. **The wave's FIRST spawn creates the perf-MD file in the same action batch as the dispatch itself** — file existence survives compaction; a remembered duty does not. (2026-07-21 restructure w1: 2 early spawns in a long inline wave, Orchestration Log lines written, MD skipped until reflect — second recurrence of this class after the 2026-07-16 ambiguity kill.)
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
6. Agent frontmatter also supports `memory:` (user/project/local scopes), per-agent `hooks:`, and `skills:` preload (docs-verified 2026-07-27). Adopt per-type only on profile evidence at reflect — no blanket adoption.

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

## Workflow Lane (added 2026-07-27)

The Workflow tool runs deterministic JS orchestration (`agent()`, `pipeline()`, up to 16 concurrent, resumable, per-agent `schema` for validated structured outputs). It stays USER OPT-IN — never auto-run. The orchestrator's duty is to PROPOSE it when work is enumeration-shaped:

- contract-surface consumer sweeps (grep every emitter/importer, verify each)
- invariant-consumer verification (one verifier per consumer)
- adversarial verify rounds over a findings list
- migration/transform fan-outs over a file list

Proposal format: one line — expected agent count, per-agent schema, rough cost — then wait for the user's go. On approval, prefer `pipeline()` over barriers, `schema` on every result-bearing agent.

## Efficiency Playbook

Mandatory for every managing agent:

- `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- ToolSearch for deferred tools — never guess schemas
- `Explore` agent for fan-out searches across many files
- Lazy spec loading: briefs get file path + interface contract + test expectations — full spec only when the task requires design decisions
- Background tasks (`run_in_background`) for long-running commands — **orchestrator only.** Synchronous subagents cannot await background completions (their "wait" ends the turn → idle until resumed); brief any gate-running subagent to run gates FOREGROUND, unpiped, `; echo EXIT:$?` appended (w3L: two wasted resume rounds)
- More than 10 files read → offload remaining research to a focused subagent

## Judgment Rules

- **Verify reviewer Criticals before dispatching fixes.** Read the cited source lines yourself first — reviewers false-alarm; a wrong fix cycle costs a full dispatch + re-review. (2026-06-10)
- **Verify reviewer REMEDIES from source too — same discipline as Criticals.** A reviewer that nails the finding can still prescribe an unsound remedy while claiming "verified": one clean remedy (T5b, fix went trivial-lane) made remedy-trust tempting; the next round's prescribed strip would have destroyed the exact jump it protected (T5c). Findings and remedies are separate claims; check both. (what-is-dark phase 2, 2026-07-22.) **Reviewer NUMERIC CORRECTIONS to plan arithmetic are claims too** — re-derive before ledgering as "correct X": a T1 review's "8.64 not 8.63" was itself a double-rounding artifact (exact = 8.6232, shipped 8.63 fine); the wrong "correction" rode the ledger all wave until the close review refuted it. (what-is-dark phase-3a, 2026-07-25; n=1 provisional.)
- **Combined review for verbatim-code tasks AND small behavioral patches.** When a plan task prescribes exact code byte-for-byte, collapse two-stage review into ONE pass (spec byte-compare + quality). Same lane for small behavioral patches with implementer latitude — one combined pass covering spec compliance + adjudication of the implementer's flagged decisions; two-stage buys nothing at this size. (2026-06-10; widened 2026-07-21 w3 — n=2 clean: A12 lib patch, A13 multi-part app consume, both zero-finding PASSes with mechanism-level adjudications.) Large integration tasks keep the full two-stage flow.
- **Trivial-fix exception.** A managing agent may hand-apply a ≤2-line mechanical change (typo, escaping, formatting artifact, selector disambiguation, user-requested addition) when dispatch cost clearly exceeds the change — provided it has no behavioral test impact and gets an Orchestration Log line. Anything requiring judgment or touching 2+ sites: dispatch. (widened 2026-06-12, 2026-07-07)
- **Orchestrator diff-verify may replace the reviewer dispatch for warm QA fixes.** Condition: the fix brief was authored by the orchestrator from its OWN root-cause recon (mechanism + exact fix + test sequence), and the returned diff byte-matches that brief with gates EXIT:0 in the report. The orchestrator already holds the full review context — a reviewer would re-derive it. Anything with implementer latitude beyond the brief still gets a review. (2026-07-22 slot-w1: n=2 clean — QA-R2 zIndex, QA-R3 stale flag; ~4.5–6.5 min round-trips.)
- **Stagger warm-redo and review rounds sharing one worktree.** A reviewer's independent gate re-run sees the concurrent implementer's uncommitted edits — benign only when the next round's gates re-certify; if certification isolation matters, serialize. (2026-07-22 slot-w1 QA-R1 probe-7 contamination.)
- **Post-compaction log append.** Before appending to the Orchestration Log after a compaction, re-read the log tail — the summary may claim lines were logged that sit outside your Read window. (2026-06-12)
- **Briefing escape hatch.** Every dispatch's scope constraint ends with: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it." (2026-06-12)
- **Per-component test entries only.** Shared spec files (axe, e2e): "add ONLY entries for your component." (2026-06-12)
- **Zero-output dispatch death = infra failure, not FAIL.** A dispatch returning 0 tokens with a session-limit message is not a model failure: re-dispatch identical once the limit resets — do not count it toward escalation. Log as `dispatch died (session limit) → re-dispatch clean`. (2026-07-02)
- **Stalled-agent recovery.** A watchdog-killed dispatch whose work is already on disk is also infra, not FAIL: verify the claimed artifacts hands-on, then resume the SAME agent with a report-only message — never redo the work or re-dispatch cold. (2026-07-08)
- **Value-judgment changes ride before review.** When a landed change encodes a product-feel judgment the user may reject on sight (tuning constant, parity break, presentation choice), get the user verdict BEFORE dispatching its review — reviewing a value the user rejects wastes the round. Log the review debt explicitly in the Orchestration Log with its close condition ("bundle into next stack review after user verdict") and close it at the stated point; the deferred review still runs at full rigor (momentum-lab close review caught a real Major). (2026-07-24 momentum-lab, n=1 provisional.)

## Skills Reference

Situation→skill routing lives in [`docs/SKILLS.md`](../../workspace/docs/SKILLS.md) — update that file when routing changes, not this one.
