---
name: agent-factory
description: Use when executing any multi-task plan or checklist, deciding whether to spawn a subagent (at any nesting depth), choosing which agent type or model to dispatch, authoring a new agent type, or logging subagent performance. Carries the spawn protocol, dispatch template, performance-MD duty, and escalation rules. Every spawning agent reads this file before its first spawn.
---

# Agent Factory

## Overview

Canonical orchestration standards. Supersedes the `orchestrate` skill (tier ladder T1–T4, plan profiles, and the Layer-2 routing table are retired — 2026-07-15).

The model: **demand-driven recursive spawning.** For the orchestrator, dispatch is the default posture (see §Spawn Model); below the main session, agents spawn only when the task exceeds what they can do well inline — and those subagents may spawn further (platform wall: depth 3 below the main session by default — v2.1.219+, env lever CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH; the deepest layer cannot spawn). Every managing agent judges its children and logs performance; reflect aggregates those logs into global per-type profiles that drive future routing.

Two audiences:

1. **The orchestrator** (main session) — follows everything here.
2. **Any spawned agent about to spawn its own children** — reads this file first (your definition's pointer line sent you here), then follows §Spawn Model through §Performance MDs.

## Reference files

- `checklist-protocol.md` — checklist template, orchestration log, wave scorecard, reflect integration, checklist editing, phase complete. **Read when authoring or updating a checklist, or at wave close.**
- `session-protocol.md` — session start, compact discipline, continuation handoff, overflow lane. **Read at session start or when approaching a compact boundary.**

## Spawn Model

**The orchestrator delegates readily; damping applies to children (G6 rewrite, 2026-08-08).** The old "default is inline" opening was tuned for model generations that under-spawned; the current generation delegates well, and the rule measurably counteracted correct behavior (AdSense W1, 2026-07-28/29: five parallel-safe cross-repo clusters, `**Factory:**` header present, zero dispatches — whole wave inline across a multi-day session with repeated compactions, the >150k-context spend the usage report flags).

- **Orchestrator (main session):** dispatch is the default posture for checklist execution. A parallel-safe cluster, a gate-heavy task, or any task a child can carry with a clean brief SHOULD be dispatched; choosing inline gets its OWN one-line justification in the Orchestration Log — silence is not a decision. The `inline-execute` skill's lane (docs/config tasks, ≤2 files) is a legitimate justification — write it down, per task.
- **Cross-repo clusters are the cleanest possible fan-out** — zero file overlap by construction, no worktree isolation needed beyond the one each repo already gets, each cluster carries its own gate. Justification is per CLUSTER. The cost of wrongly inlining is context, not correctness: one orchestrator carrying five repos' file trees and gate outputs is exactly the >150k-context spend the usage report flags (65% of last-24h usage at >150k, 2026-07-29).
- **Spawned agents (any depth below main):** inline is the default; spawning is the exception that must argue for itself. Justified triggers: (a) the task needs skills or tools you lack, (b) your context would blow past useful size, (c) parallelism wins wall-clock.

Rules:

- Each spawn gets a one-line justification — recorded in your performance MD entry for that child.
- No plan-time tier or structure prediction. The checklist header carries a `**Factory:**` line; the actual spawn tree is recorded in the Orchestration Log as it happens.
- Depth-3 platform wall (default, v2.1.219+; env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH). Soft economics keep real trees shallower — a tree pressing the wall is a planning smell, and a manager-under-manager's children now sit at the terminal layer (level 3, cannot spawn), not a middle rung.
- `isolation: "worktree"` survives as a per-dispatch option when spawned agents mutate files in parallel. Disjoint file sets are required; a merge conflict at wave end = routing miss → log it, scorecard it. Merge order: smallest diff first; rebase-only.
- **Fable rules, at every depth:** fable is usage-billed and never runs below the orchestrator without per-run user clearance. Live LLM rounds on the user's API keys require per-run user clearance regardless of model — present lane, turn count, expected writes first. Emergency cost-stop: `CLAUDE_CODE_SUBAGENT_MODEL` env overrides ALL subagent model resolution, profiles included (code:sub-agents.md, P5 G44).

## Assignment Routing

**Profiles are the routing authority; type definitions are general guidance.**

Before spawning:

1. Read the candidate type's profile: `~/code/claude-config/agents/profiles/<type>.md`.
2. Route on profile evidence (strengths, weaknesses, model sweet spot, spawn-worthiness). The def's description is fallback only when no profile data exists.
3. Claims marked **provisional** (n=1) are hints, not authority.
4. Distill the relevant fit guidance into the child's brief — children never read profiles themselves.
5. Set `model:` on the Agent call per the profile's sweet spot; omit only when the profile says the frontmatter default is right. Effort rides the TYPE, not the call: the Agent tool has no effort param (verified 2026-08-08) — a profile's effort note is implemented as def-frontmatter `effort:`; per-dispatch effort exists only in the Workflow lane (`opts.effort`). Effort changes invalidate prompt cache — another reason it lives in frontmatter, not ad-hoc variance.

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

**A brief shipping byte-exact code states explicitly that TEST-FIRST STILL BINDS (2026-07-29, friends-w1 T9).** "Verbatim block provided" reads to an implementer as a TDD carve-out — the code already exists, so writing a failing test first feels like theater rather than the gate it is. One wave's implementer wrote `friend-row.tsx`'s implementation before its test and cited the combined-review lane as authorization; that lane governs REVIEWER structure (one pass instead of two for verbatim tasks), never implementer TDD order. Two cheap clauses in every verbatim brief: test-first is not waived by a provided block, and the combined-review lane is not an implementer permission. (n=1, provisional. Same family as the failure-mode rule above — a mechanical step needs its reason attached or it reads as skippable.)

**Destructive DDL and DB-recovery steps are ORCHESTRATOR-OWNED at plan time, and the command must name its target table in its own text (2026-07-26/29, friends-w1, n=2).** The permission classifier hard-blocks destructive DDL from a subagent even through a sanctioned migrator flow — correct escalation on the agent's part, but it strands the task mid-apply, and the recovery gets improvised. Plan the recovery as an orchestrator step from the start. It blocks the orchestrator too when the target is indirect: a script whose `DROP TABLE` sits inside a file the classifier cannot see reads as an unbounded mass delete, and blanket user clearance ("fine with destructive") does not clear it because the clearance names no table. Either put the table name in the command text, or hand the user a `! node <script>.mjs` line to run themselves — the fastest unblock, and the user's own hands on the destructive beat is the right default anyway.

**A reviewer that RE-RUNS the implementer's gates catches report-vs-reality drift for ~3 extra tool uses (2026-07-29, friends-w1 T9).** Make it standard on delete/recreate diffs and any diff over ~1000 lines, where a moved file's tests can pass in the report and dangle in the tree. The T9 reviewer re-ran all three gates rather than trusting the report, byte-compared 4 blocks, and grepped both test trees for dangling refs, in 22 tool uses / 3.4 min total. Cheap enough that trusting a report on this diff class is the expensive choice. (n=1, provisional.)

**No commit steps in implementer briefs (2026-07-23, slot-W2):** the implementer definition assigns git to the orchestrator — a brief instructing a commit creates a def/brief conflict the agent correctly refuses, burning a round-trip beat. Orchestrator verifies, then commits. (QA-R1: opus implementer refused the brief's commit step per role boundary; second occurrence of the class.)

**Model-scoped verification instructions (G19, 2026-08-08):** Opus-5 child briefs get NO "verify your work" / "double-check before returning" boilerplate — the Opus 5 prompting doc (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-opus-5) reports it causes over-verification. The reviewer-as-separate-verifier lane is unchanged (Fable-5 doc-endorsed for long runs, n≥4 local evidence): verification lives in a separate reviewer dispatch, never in the implementer's own brief. Two things this does NOT touch: command gates (foreground, unpiped, `; echo EXIT:$?`) stay in every brief regardless of model; and `superpowers:verification-before-completion` still binds every agent's own completion CLAIMS — G19 governs brief authoring, not the done-gate.

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
- row: type=<type> model=<model> grade=<1-5> class=<task-class> gates=<pass|fail|na> redos=<n> wave=<slug> date=<yyyy-mm-dd>
```

The `- row:` line is the machine row for `eval.mjs mine` (G72) — write it at reflect backfill if not during the wave; prose lines stay free-form.

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

0. **Effort rung (G31, 2026-08-08) — Workflow lane only:** before a model jump, one retry at `xhigh` effort on the same model is the cheaper rung (`opts.effort`). Skip it when the failure signal is capability-shaped (design-level review fault, integration/architecture flavor) rather than care-shaped. Agent-lane dispatches have no per-call effort — for them the ladder starts at rung 1 unchanged.
1. **Sonnet fails, signals present** (3+ files · integration/architecture flavor · review fault at design level) → escalate to opus immediately. No sonnet retry.
2. **Sonnet fails, no signals** → one retry, then opus.
3. **Opus fails** → ONE fable `recon` diagnostic dispatch (read-only, orchestrator clearance rules apply): classify plan defect vs wrong assumption vs environment → surface to user WITH the diagnosis. Never a third implementation attempt.

Log every escalation: `task · sonnet FAIL×n → opus · outcome · signal that fired`. Escalations are profile-update candidates at reflect.

**Haiku rung (G32, 2026-08-08):** below sonnet for existence-checks, greps, file-list, single-fact read-and-report shapes — route via profile sweet spot, not the failure ladder (recon defaults haiku already, n=2 grade 5). Failure escalation from haiku: one sonnet retry, then the ladder above unchanged. Evidence duty: one wave of profile rows per newly-haiku'd dispatch shape.

## Redo Protocol

- **Fixable failure, same model** → `SendMessage` to the SAME agent with the review findings — warm context, no cold re-brief. Log tag: `redo-warm`.
- **Escalation to a stronger model** → fresh dispatch — fresh eyes are the point. Log tag: `redo-cold`.
- Profiles track warm-vs-cold outcomes; if warm redos regress (agent anchored on its mistake), reflect narrows the warm lane in the profile.
- **Warm re-dispatch extends to SIBLING mechanical tasks** — `SendMessage` to the same agent for an adjacent mechanical task in the same repo area; the agent carries the repo map plus its own prior-round lessons forward. Log tag: `warm-sibling`. (2026-08-08 creator-coach W0 T7: upstash-removal agent warm re-dispatched to storybook removal, grade 5, closed by orchestrator diff-verify; n=1, provisional.)

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

**Standing review-result schema (G49, 2026-08-08):** reviewer contract breaks are FIRM at n=5 (inline-vs-file; silent idle ×4 — profile 2026-08-08, phrasing mitigation INVALIDATED). Workflow-lane reviewer dispatches pass this as `schema:` — validation at the tool-call layer retries on mismatch. `issues` carries ISSUE / NEEDS_CONTEXT lines VERBATIM (they pass upward unsummarized at every hop — §Performance MDs); a NEEDS_CONTEXT verdict puts what is needed there. `line` is optional — file-level findings have none; never fabricate one. `gates_rerun` lists what was actually re-run (empty when the diff class didn't warrant it):

```json
{
  "type": "object",
  "required": ["verdict", "findings", "issues", "gates_rerun"],
  "properties": {
    "verdict": { "enum": ["PASS", "FAIL", "NEEDS_CONTEXT"] },
    "findings": { "type": "array", "items": {
      "type": "object",
      "required": ["file", "severity", "confidence", "summary"],
      "properties": {
        "file": { "type": "string" },
        "line": { "type": "integer" },
        "severity": { "enum": ["Critical", "Major", "Minor"] },
        "confidence": { "enum": ["verified", "plausible"] },
        "summary": { "type": "string" }
      } } },
    "issues": { "type": "array", "items": { "type": "string" } },
    "gates_rerun": { "type": "array", "items": { "type": "string" } }
  }
}
```

**Lane honesty:** every recorded silent-idle occurrence is in the AGENT lane, which this schema cannot reach (the Agent tool has no schema param) — there the shape is restated in the Output-format line as a prose contract, and the profile's named escalation (SubagentStop hook detecting an empty final message) stays the open candidate. Composes with the G5 reviewer rewrite (P4b).

- Caps (code:workflows.md, P5 G66): 1,000-agent lifetime total per workflow; stop/resume re-runs EVERY agent STARTED after the first unfinished one (replay follows start order) — stopping a long fan-out mid-flight re-bills its tail, so let a nearly-done stage finish before stopping.

## Agent Teams Lane (added 2026-08-08, G37)

The agent-teams flag is ON in settings with zero dispatches so far. Ground rules before the first real use:

- **Teams vs subagents:** teammates communicate bidirectionally (SendMessage, shared task list) and hold long-lived context; subagents are fire-and-forget with one return value. Reach for a team only when members must exchange intermediate results mid-task — otherwise subagents are cheaper and simpler.
- **Cost:** ≈7× tokens vs a plain session in plan mode (https://code.claude.com/docs/en/costs.md). Propose a team the way the Workflow lane is proposed: one line — size, purpose, rough cost — then wait for the user's go. Never auto-spawn a team.
- **Defaults:** small teams; sonnet teammates unless a profile argues otherwise; no nested teams (unsupported per https://code.claude.com/docs/en/agent-teams.md, verified in `docs/harness-evolution/research/` 2026-08-06); explicit shutdown when done — an idle teammate keeps holding context.
- Fable rules bind every seat: a fable teammate needs per-run user clearance, same as any fable dispatch.

## Efficiency Playbook

Mandatory for every managing agent:

- `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- ToolSearch for deferred tools — never guess schemas
- `Explore` agent for fan-out searches across many files
- Lazy spec loading: briefs get file path + interface contract + test expectations — full spec only when the task requires design decisions
- Background tasks (`run_in_background`) for long-running commands — **orchestrator only.** Synchronous subagents cannot await background completions (their "wait" ends the turn → idle until resumed); brief any gate-running subagent to run gates FOREGROUND, unpiped, `; echo EXIT:$?` appended (w3L: two wasted resume rounds)
- **Addendum (G38, 2026-08-08, doc-verified):** subagents themselves are background-default since v2.1.198 (results arrive as completion notifications; pre-v2.1.211 premature-result bug fixed) — the "cannot await" constraint above is LOCAL w3L evidence about a subagent's own background SHELLS and stands; foreground-gates briefing unchanged. Warm-`SendMessage` lane extends beyond redos to SEQUENTIAL RELATED tasks (cache reads: same repo area, same files) — see §Redo Protocol warm-sibling.
- More than 10 files read → offload remaining research to a focused subagent

## Judgment Rules

- **Verify ANY reviewer finding you act on — Minors included, not just Criticals.** Read the cited source lines yourself first — reviewers false-alarm; a wrong fix cycle costs a full dispatch + re-review (2026-06-10). When a reviewer contests an implementer's empirically-confirmed claim, adjudication = RE-RUN the experiment — neither report is authority; both are self-reports and both are documented to drift (see the reviewer-re-runs-gates rule in §Dispatch Template). Acting on a wrong reviewer Minor without re-running the implementer's experiment cost a red gate round (2026-08-08 creator-coach W0 issue #3; n=1 provisional).
- **Verify reviewer REMEDIES from source too — same discipline as Criticals.** A reviewer that nails the finding can still prescribe an unsound remedy while claiming "verified": one clean remedy (T5b, fix went trivial-lane) made remedy-trust tempting; the next round's prescribed strip would have destroyed the exact jump it protected (T5c). Findings and remedies are separate claims; check both. (what-is-dark phase 2, 2026-07-22.) **Reviewer NUMERIC CORRECTIONS to plan arithmetic are claims too** — re-derive before ledgering as "correct X": a T1 review's "8.64 not 8.63" was itself a double-rounding artifact (exact = 8.6232, shipped 8.63 fine); the wrong "correction" rode the ledger all wave until the close review refuted it. (what-is-dark phase-3a, 2026-07-25; n=1 provisional.)
- **Combined review for verbatim-code tasks AND small behavioral patches.** When a plan task prescribes exact code byte-for-byte, collapse two-stage review into ONE pass (spec byte-compare + quality). Same lane for small behavioral patches with implementer latitude — one combined pass covering spec compliance + adjudication of the implementer's flagged decisions; two-stage buys nothing at this size. (2026-06-10; widened 2026-07-21 w3 — n=2 clean: A12 lib patch, A13 multi-part app consume, both zero-finding PASSes with mechanism-level adjudications.) Large integration tasks keep the full two-stage flow.
- **Trivial-fix exception.** A managing agent may hand-apply a ≤2-line mechanical change (typo, escaping, formatting artifact, selector disambiguation, user-requested addition) when dispatch cost clearly exceeds the change — provided it has no behavioral test impact and gets an Orchestration Log line. Anything requiring judgment or touching 2+ sites: dispatch. (widened 2026-06-12, 2026-07-07)
- **Orchestrator diff-verify may replace the reviewer dispatch for warm QA fixes.** Condition: the fix brief was authored by the orchestrator from its OWN root-cause recon (mechanism + exact fix + test sequence), and the returned diff byte-matches that brief with gates EXIT:0 in the report. The orchestrator already holds the full review context — a reviewer would re-derive it. Anything with implementer latitude beyond the brief still gets a review. (2026-07-22 slot-w1: n=2 clean — QA-R2 zIndex, QA-R3 stale flag; ~4.5–6.5 min round-trips.)
- **Stagger warm-redo and review rounds sharing one worktree.** A reviewer's independent gate re-run sees the concurrent implementer's uncommitted edits — benign only when the next round's gates re-certify; if certification isolation matters, serialize. (2026-07-22 slot-w1 QA-R1 probe-7 contamination.)
- **Post-compaction log append.** Before appending to the Orchestration Log after a compaction, re-read the log tail — the summary may claim lines were logged that sit outside your Read window. (2026-06-12)
- **Briefing escape hatch.** Every dispatch's scope constraint ends with: "if the constraint blocks the correct fix, report NEEDS_CONTEXT — do not work around it." (2026-06-12)
- **Per-component test entries only.** Shared spec files (axe, e2e): "add ONLY entries for your component." (2026-06-12)
- **Zero-output dispatch death = infra failure, not FAIL.** A dispatch returning 0 tokens with a session-limit message is not a model failure: re-dispatch identical once the limit resets — do not count it toward escalation. Log as `dispatch died (session limit) → re-dispatch clean`. (2026-07-02)
- **Typed-error classification beats inference (G69, 2026-08-08, doc-verified):** in `--bg`/headless lanes, `system/api_retry` events in the stream-json output classify infra-vs-real failure precisely — read them before ruling a zero-output death "session limit". Fields: `attempt` (from 1), `max_retries`, `retry_delay_ms`, `error_status` (HTTP int or null), `error` category (`rate_limit`, `billing_error`, `overloaded`, `server_error`, `authentication_failed`, `invalid_request`, `model_not_found`, `max_output_tokens`, `oauth_org_not_allowed`, `unknown`). Conversation-lane dispatches (Agent tool) have no event stream — the zero-output rule above stands unchanged there.
- **Stalled-agent recovery.** A watchdog-killed dispatch whose work is already on disk is also infra, not FAIL: verify the claimed artifacts hands-on, then resume the SAME agent with a report-only message — never redo the work or re-dispatch cold. (2026-07-08)
- **Value-judgment changes ride before review.** When a landed change encodes a product-feel judgment the user may reject on sight (tuning constant, parity break, presentation choice), get the user verdict BEFORE dispatching its review — reviewing a value the user rejects wastes the round. Log the review debt explicitly in the Orchestration Log with its close condition ("bundle into next stack review after user verdict") and close it at the stated point; the deferred review still runs at full rigor (momentum-lab close review caught a real Major). (2026-07-24 momentum-lab, n=1 provisional.)

## Skills Reference

Situation→skill routing lives in [`docs/SKILLS.md`](../../workspace/docs/SKILLS.md) — update that file when routing changes, not this one.
