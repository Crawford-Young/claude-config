---
name: continuation
description: Use when the user wants to clear a long session, end a heavy brainstorming phase, or hand off work to a fresh context window. Generates a structured handoff file so the next session resumes without loss.
---

# Continuation

## Overview

Writes a handoff file capturing session state before `/clear`. The next session reads the handoff to resume exactly.

## Auto-Trigger (Proactive)

**Invoke this skill automatically — without waiting for the user to ask — after any of these events:**

| Event | When to trigger |
|-------|----------------|
| `claude-md-management:reflect` completes | Immediately after reflect finishes — phase boundary = natural clear point |
| `superpowers:brainstorming` produces a spec | After spec is written and approved — heavy context accumulated |
| Phase checklist moved to `done/` | Wave boundary — next session starts fresh anyway |
| User says "we're done for now" / "that's enough" | Explicit stopping signal |

**How:** After the triggering event finishes, say: "That's a natural break point — writing a handoff file so you can `/clear` safely." Then run this skill.

**Do not** wait for the user to remember to ask. The whole point is they shouldn't have to.

**Skip condition — nothing to resume:** If the phase is fully closed (checklist in `done/`, reflect run, no unchecked tasks) AND no follow-up work is agreed, do NOT write a handoff — a session recap has no resume value. Say the phase is closed and list any open items (e.g. unmerged branch) in one line. If follow-up work IS agreed (next phase named, pending decision, approved feature), write the handoff — but forward-facing (see content test below). (2026-06-11: post-reflect handoff for a completed wave was pure session recap — user called it worthless.)

## Content Test — Forward-Facing Only

Every line in a handoff must pass one test: **does the next session need this to act?** The handoff is a mission briefing, not a session diary.

- ❌ "What we did this session" — git log and the done checklist already record it
- ✅ "What the next session must do, decide, or avoid"
- Session Summary: max 3 bullets, and only ones that change future action (a gotcha that recurs, a decision that constrains the next phase). Zero bullets is fine.
- Lead the file with the next mission, not the past wave.

## When to Use (User-Triggered)

- User says "let's clear" / "save context" / "handoff" / "continuation"
- Session approaching context limit
- Any point where continuity across a `/clear` matters

## Steps

1. **Locate active checklist** — scan `docs/<project>/checklists/active/` for the current phase file
2. **Check git state** — `git status` + `git log --oneline -5` from the project dir
3. **Read last N completed tasks** from checklist (or infer from code present vs checklist). **If checklist boxes don't match reality, tick them now before writing the handoff** — the handoff is the reconciliation gate; never hand off a checklist that lies.
4. **Identify next unchecked task** — the exact step to start on resume
5. **Write handoff file** to `docs/<project>/continuation/<YYYY-MM-DD-HH-MM>-handoff.md`
6. **Tell the user** the handoff path and what to say at session start

## Handoff File Template

```markdown
# Handoff — <Project> — <Timestamp>

## Resume Instruction
At the start of the next session, say:
> "Continue <project>. Read docs/<project>/continuation/<this-file>.md first."

## Next Mission
<!-- THE reason this handoff exists. Copy-paste ready first action + the goal it serves. -->
<Specific command, skill invocation, or task to run first — and why>

## Open Decisions / Blockers
<!-- Anything unresolved the next session must address before or during the mission -->
- 

## Current State

**Checklist:** `docs/<project>/checklists/active/<file>.md` (or: phase closed, next checklist not yet written)
**Tier / Profile:** <from checklist header, incl. any pivots> — Orchestration Log in checklist
**Last completed task:** Task N — <name>
**Next task:** Task N+1 — <name>, Step <X>

## Git State
**Branch:** <branch>
**Uncommitted:** <yes/no — list files if yes>
**Last 3 commits:**
```
<git log output>
```

## Carry-Forward Notes
<!-- ONLY items that change future action: recurring gotchas, constraints on the next phase. Max 3. Zero is fine. -->
- 
```

## After Writing

Tell the user:
> "Handoff written to `docs/<project>/continuation/<file>`. Safe to `/clear`. At session start, paste: 'Continue <project>. Read docs/<project>/continuation/<file> first.'"

## On Resume (Next Session)

When user pastes the resume instruction:
1. Read the handoff file
2. Scan the active checklist to verify current state
3. Check git status to confirm no drift
4. Start at "Exact Next Step" — no re-planning needed
