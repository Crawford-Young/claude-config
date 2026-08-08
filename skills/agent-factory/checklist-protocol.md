# Checklist & Logging Protocol

Reference file for the `agent-factory` skill. Read when authoring or updating a
checklist, appending to a log, or closing a wave — not on every dispatch decision.

---

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

Every marker prompt also asks the user to paste `/usage` output; the orchestrator records the number on the marker line (`<!-- COMPACT POINT — usage: NNNk -->`). Deltas between markers = a live in-session cross-check; authoritative per-task attribution comes from the OTel pipeline (`claude-config/telemetry/usage-report.mjs`, OTel wave 2026-08-07) — run the report at reflect. The `/usage` paste stays optional at markers as a sanity check.

## Orchestration Log Protocol

Append one line per spawn, escalation, and structural change — at the moment it happens, not retroactively:

```
- spawn: orchestrator → implementer/sonnet · task3 · PASS
- spawn: orchestrator → manager/opus · workstream-B · PASS · perf-MD: docs/<project>/agent-logs/2026-07-15-wB-manager.md
- escalate: task4 impl · sonnet FAIL×2 → opus · PASS · signal: integration-heavy
- inline: task3 · docs-only 2-file edit — inline-execute lane, dispatch overhead exceeds task (G6 justification)
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

0. Run `node claude-config/telemetry/usage-report.mjs <wave checklist>` — this is the reflect's context-efficiency data, replacing the `/usage` paste (2026-08-08 OTel wave). `/usage` remains the only source for sessions that predate the telemetry env config (env binds at session launch, G8).
1. Sweep `docs/<project>/agent-logs/` (entries since last reflect)
2. Update `claude-config/agents/profiles/<type>.md` — new claims carry date + wave evidence; n=1 marked provisional; firm claims need n≥2; discount grades not grounded in verifiable outcomes
3. Promote or delete staged types (`~/.claude/agents/staged-*`) per their performance entries
4. Move swept logs to `docs/<project>/agent-logs/done/`
5. **Retirement pass (G18, 2026-08-08):** for each MD file this wave TOUCHED, re-verify its dated rules — a rule that has never re-fired since birth and sits at n=1 is a prune candidate (retract, or fold into a sibling); a rule whose class carries a "second occurrence" note is a prune-or-hook trigger, NOT an expand trigger (best-practices doc: recurrence despite a rule = file too long, not rule too weak). Scope is the wave's touched files only — never a whole-base audit in one pass. Log outcomes in the Reflect Log: `retired: <rule> — <why>` / `kept: <rule> — <re-fire evidence>`. Relocated-baseline text is append-only (plan-premises) — retire those via dated addendum + INTENTIONAL_EDITS, not deletion.

## Checklist Editing Protocol

**Only the orchestrator writes to checklist files. Spawned agents are read-only.**

- Tick `- [x]` immediately after a task completes; ticks + log lines land in the same action batch as the commit they record. Every tick carries a completion stamp as the LAST content on the line: `<!-- done 2026-08-07T22:30:00-04:00 -->` (ISO 8601 with offset, written in the same edit that ticks; annotations go BEFORE the stamp). The OTel usage report joins these stamps against metric timestamps — an unstamped tick is invisible to per-task attribution. The parser counts stamps only on ticked `- [x]` lines, at end-of-line, outside code fences (so example stamps in prose or fixtures never pollute attribution). Three rules from the OTel wave's own dogfood (2026-08-08, all three failure modes hit in one wave): **stamps come from `date -u +%Y-%m-%dT%H:%M:%SZ`, never estimated** (a future-dated estimate makes later tasks non-monotonic — report skips them loudly); **an annotation on a sibling line does not tick a step** — every completed step-line gets its own `- [x]`, even "done same pass" steps; **a deferred step ticked in a later task gets NO stamp** (the work belongs to the window where it happened — stamping it "now" folds intervening tasks into one window and skips the rest). Fourth rule from P4c (2026-08-08): **batch-ticking several tasks with one stamp collapses their attribution windows** — the report's monotonicity guard skips every task sharing a stamp (6 of 10 skipped in the wave that landed this rule); when per-task attribution matters, tick each task at its own completion moment.
- **Before ticking a step, grep the wave issue log for `Owner:` lines naming it** — issue entries accrete deliverables onto later steps mid-wave, and a tick written from the plan text alone misses them. The step's annotation cites the issue-owned deliverable explicitly. (2026-07-31 what-is-dark 4.0: issue #11 assigned Step 11.1 a correction to a 3b log entry; 11.1 ticked without it, caught only by the whole-branch close review — MAJ-2, wave issue #25.)
- Add `> ⚠️ NOTE FOR TASK N:` inline below a completed task only when the outcome changes how a future task should be approached
- Append to `## Reflect Log` when lessons surface — format: `- YYYY-MM-DD: <lesson>`
- On phase complete: move checklist to `done/`, then run `claude-md-management:reflect`

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move checklist `active/` → `done/`
3. **Run `claude-md-management:reflect` — mandatory.** Fill the Wave Scorecard; run the profile rollup (§Reflect Integration)
4. Reflect Phase 6 prompts `/usage`, then `/clear` if the project is fully done
