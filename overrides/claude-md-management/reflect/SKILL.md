---
name: reflect
description: Use when a development phase ends — branch merged, milestone complete, or wave finished — to reflect on agent performance, MD adherence, orchestration gaps, and improvements across all agent-facing markdown files
---

# Reflect

## Overview

A structured end-of-phase dialogue between Claude and the user. Claude self-reflects first on its own performance and MD adherence, then opens the floor to the user, and together they update all agent-facing MD files — including discovering new subagent MDs that should exist.

## Phases (follow in order, no skipping)

### Phase 1: Gather

Read everything relevant to the phase that just ended:

- `git log` since phase start — what was built, what changed
- Active or recently completed checklist in `~/code/docs/<project>/checklists/active/` or `done/` — what was planned vs delivered (the checklist IS the plan)
- Performance MDs in `~/code/docs/<project>/agent-logs/` — every managing agent's judged record of its subagents this wave (grades, effort, lessons)
- All existing agent-facing MDs:
  - `~/code/CLAUDE.md` (workspace level)
  - Repo-level `CLAUDE.md`
  - Agent definitions used this phase in `claude-config/agents/` (junctioned to `~/.claude/agents/`)
  - Skill files used this phase in `~/.claude/plugins/` — did they guide behavior well, or did they have gaps?

### Phase 2: Self-Reflect

Write a freeform report. Only include sections where there is something genuine to say — skip any section with nothing worth reporting.

**Optional sections:**

**MD Adherence**
Where did I follow the MD files faithfully? Where did I deviate, and why? Where were instructions ambiguous or missing?

**Performance**
What went smoothly? What was slow, clunky, or required unnecessary back-and-forth?

**Gaps Discovered**
Recurring processes or patterns that have no MD coverage. Subprocesses that would benefit from a dedicated subagent MD. Skills that were invoked but had unclear or missing guidance.

**Stack / Practice Updates**
New tools, libraries, or patterns that emerged this phase and are worth codifying into the workspace standards.

**Proposed Changes**
Specific, concrete edits — each tied to an observation above. Include:
- Which file to update
- What to add, change, or remove
- Why (one line)

### Phase 3: Dialogue

Present the self-reflect report to the user, then ask what they noticed that was missed. Token data comes from the statusline and the OTel usage report (`node claude-config/telemetry/usage-report.mjs <wave checklist>`) — do not prompt `/usage` (retired 2026-08-08 P3 reflect; statusline + telemetry supersede it; `/usage` remains only for sessions predating the telemetry env config).

Actively invite:
- Corrections to Claude's self-assessment
- Patterns or practices Claude missed
- Frustrations or inefficiencies the user observed
- Feedback on where MD instructions were unclear or wrong
- New tools or approaches worth standardizing

Do not move to Phase 4 until the user has had a full opportunity to respond.

### Phase 4: Finalize

Agree on the complete change set before touching any file. For each proposed change confirm:
- Which file it goes into
- The exact content
- Whether a new subagent MD should be created vs updating an existing one

New agent definitions live in `claude-config/agents/` (kebab-case: `migration-agent.md`) with frontmatter: `name`, `description` (dispatch criteria), `tools` allowlist, `model` default. New `subagent_type` values hot-load mid-session (verified 2026-07-01 — all 8 seed agents resolved without a fresh session). Profile updates (with date + evidence, n≥2 for firm claims) go to `claude-config/agents/profiles/<type>.md`; staged agents (`~/.claude/agents/staged-*`) get promoted (rename into `claude-config/agents/`, commit, profile stub) or deleted per their performance-MD entries.

### Phase 5: Update

Apply all agreed changes using the Edit tool. Order:

1. `~/code/CLAUDE.md` (workspace level — highest impact)
2. Repo-level `CLAUDE.md`
3. Existing agent definitions in `claude-config/agents/`
4. New agent definitions in `claude-config/agents/` + staged-agent promotions/deletions (`~/.claude/agents/staged-*`)
5. Agent profiles in `claude-config/agents/profiles/`
6. Skill files in `~/.claude/plugins/` if skill gaps were identified

Show each diff to the user as it is applied. Do not batch silently.

### Phase 5.5: Performance Rollup

Sweep every performance MD in `~/code/docs/<project>/agent-logs/` for the wave:

1. For each agent type graded in the logs, fold the evidence into `claude-config/agents/profiles/<type>.md` — strengths, weaknesses, model sweet spot, spawn-worthiness, each entry stamped with date + wave. One wave's data is provisional (n=1); mark it so. A claim goes firm only at n≥2 across waves.
2. Promote or delete staged types (`~/.claude/agents/staged-*`) per their performance-MD entries — promotion = rename into `claude-config/agents/`, commit, seed a profile stub.
3. Move processed logs to `~/code/docs/<project>/agent-logs/done/`.

### Phase 6: Context Cleanup

After all file updates are applied:

**Context boundary (P3 rule, root CLAUDE.md §7)** — Wave/phase reflect complete with more work ahead: emit the continuation prompt (`continuation` skill), verify checklist ticks + deviations + gate-baseline SHA on disk, then:
> "Wave closed. `/clear` and paste the continuation prompt to resume."
Full project end (all phases complete):
> "Project complete. Type `/clear` to start a fresh context for your next work."
`/compact` is mid-wave only — never the boundary default.

## What to Look For

**MD adherence failures worth capturing:**
- Rules that were followed in letter but not spirit
- Rules that conflicted with each other
- Rules that were ignored because they were buried or ambiguous
- Gaps where no rule existed but one was clearly needed

**Subagent MD candidates:**
- Any subprocess Claude repeated more than once (code review, migration, data seeding)
- Any task where Claude had to re-derive context it should have been given upfront
- Any task that would clearly benefit from tighter, scoped instructions

**Skill improvements worth making:**
- A skill was invoked but its guidance was vague, incomplete, or contradicted itself
- A skill's trigger conditions caused it to be missed when it should have fired
- A phase repeatedly needed guidance that no skill covers — candidate for a new skill

**Stack/practice updates worth codifying:**
- A new library that replaced something in the existing stack
- A pattern that emerged organically and proved effective
- A tool or command that wasn't in the Justfile but should be

## Common Mistakes

- Skipping Phase 3 because the self-reflect feels complete — the user will always see things Claude missed
- Creating a subagent MD for a one-off task — only codify recurring processes
- Updating CLAUDE.md with project-specific details that belong in the repo-level file
- Proposing changes without tying them to a specific observation — every change needs a reason
