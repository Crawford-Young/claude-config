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
- Active or recently completed checklist in `~/code/docs/checklists/active/` or `done/` — what was planned vs delivered (the checklist IS the plan; look here first, not `docs/<project-name>/phases/`)
- All existing agent-facing MDs:
  - `~/code/CLAUDE.md` (workspace level)
  - Repo-level `CLAUDE.md`
  - All files in `~/code/docs/agents/` (subagent-specific MDs)
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

Present the self-reflect report to the user. Before asking for input, prompt:

> "Type `/usage` to check this session's token consumption — then tell me what you noticed that I missed."

Wait for the `/usage` output and user response together before moving to Phase 4.

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

New subagent MDs live in `~/code/docs/agents/`. Name them descriptively: `REVIEW-AGENT.md`, `MIGRATION-AGENT.md`, etc.

### Phase 5: Update

Apply all agreed changes using the Edit tool. Order:

1. `~/code/CLAUDE.md` (workspace level — highest impact)
2. Repo-level `CLAUDE.md`
3. Existing `~/code/docs/agents/` MDs
4. New subagent MDs in `~/code/docs/agents/`
5. Skill files in `~/.claude/plugins/` if skill gaps were identified

Show each diff to the user as it is applied. Do not batch silently.

### Phase 6: Context Cleanup

After all file updates are applied:

**Context clear (project end only)** — If this reflect marks the end of the full project (all phases complete, not just one phase):
> "Project complete. Type `/clear` to start a fresh context for your next work."
If only a phase ended (more work ahead): skip — orchestrator will `/compact` at the next wave boundary instead.

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
