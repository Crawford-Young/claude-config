---
name: inline-execute
description: Use when executing a checklist plan inline in the current session without subagent overhead. Applies to docs, config, or code tasks with two or fewer files per task. Do NOT use for tasks requiring integration across many files or architecture decisions.
---

# Inline Execute

**Announce at start:** "I'm using inline-execute to execute this plan."

## Overview

Execute a checklist from `docs/<project>/checklists/active/` task-by-task in the current session. Self-review after each task. Compact at every `<!-- COMPACT POINT -->` marker. No subagents dispatched.

Use `superpowers:subagent-driven-development` instead when tasks touch 3+ files, require integration judgment, or involve architecture decisions.

## Process

### Step 1: Load

1. Scan `docs/<project>/checklists/active/` — if multiple files, ask user which to execute
2. Read target checklist in full
3. Critical review: flag tasks with missing paths, undefined dependencies, or ambiguous steps
   - Gaps found → surface to user, stop. Do not guess.
   - No gaps → proceed

### Step 2: Execute

For each unchecked task (top to bottom):

1. Execute every step exactly as written
2. Run all verifications the task specifies
3. **Inline self-review** before ticking:

   | Check | Pass condition |
   |---|---|
   | Completeness | Every step done — no partial work |
   | Verification | All expected outputs matched |
   | Scope | Nothing added beyond what the task specifies (YAGNI) |
   | Tests | If threshold specified, it is met and no regressions |

4. Passes → tick `- [x]` in checklist, continue
   Fails → fix inline, re-verify, then tick

### Step 3: Compact Points

At every `<!-- COMPACT POINT -->` in the checklist:

1. Ensure all completed tasks are ticked in the checklist file
2. Stop — marker stop is absolute. Then choose per root CLAUDE.md §Context Hygiene (2026-08-10 P8 audit): state fully on disk (checklist ticked, issue log current, live edits enumerated) → hand a continuation prompt + `/clear`; unrecorded conversational state remains → hand a focused `/compact` string. Pre-finalization markers default to `/clear`+continuation. Do not continue past the marker until the user acts or gives explicit go-ahead.
3. After compaction or `/clear`+resume: read checklist only to re-orient — find first unchecked task, resume

The checklist is the sole state that survives the boundary. Do not re-read specs or plan prose.

### Step 4: Complete

All tasks ticked:
1. Move checklist: `docs/<project>/checklists/active/<file>.md` → `docs/<project>/checklists/done/<file>.md`
2. Run `claude-md-management:reflect`

## BLOCKED Condition

Stop and surface to user when:
- Dependency missing (file not found, command unavailable, env var unset)
- Verification fails after inline fix attempts
- Instruction is ambiguous and guessing risks incorrect state
- Task requires architecture decision not covered by spec

Never guess past a blocker.

## Workflow Routing

See the `agent-factory` skill — orchestrator judges at execution time: no spawns needed → this skill.
