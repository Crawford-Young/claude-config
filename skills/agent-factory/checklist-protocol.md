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

## Checklist Editing Protocol

**Only the orchestrator writes to checklist files. Spawned agents are read-only.**

- Tick `- [x]` immediately after a task completes; ticks + log lines land in the same action batch as the commit they record
- Add `> ⚠️ NOTE FOR TASK N:` inline below a completed task only when the outcome changes how a future task should be approached
- Append to `## Reflect Log` when lessons surface — format: `- YYYY-MM-DD: <lesson>`
- On phase complete: move checklist to `done/`, then run `claude-md-management:reflect`

## Phase Complete Protocol

1. All checklist tasks ticked `[x]`
2. Move checklist `active/` → `done/`
3. **Run `claude-md-management:reflect` — mandatory.** Fill the Wave Scorecard; run the profile rollup (§Reflect Integration)
4. Reflect Phase 6 prompts `/usage`, then `/clear` if the project is fully done
