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

## Session Summary
<!-- What happened this session in 3-5 bullets -->
- 
- 

## Current State

**Checklist:** `docs/<project>/checklists/active/<file>.md`
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

## Key Files Modified This Session
- `<path>` — <what changed>

## Open Decisions / Blockers
<!-- Anything unresolved that the next session must address -->
- 

## Gotchas Discovered
<!-- Non-obvious things: bugs found, workarounds, wrong assumptions corrected -->
- 

## Exact Next Step
<!-- Copy-paste ready instruction for the next session -->
<Specific command or task to run first>
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
