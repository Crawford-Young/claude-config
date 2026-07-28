---
name: continuation
description: Use whenever anything remains to be done after a `/clear` — clearing a long session, ending a brainstorming phase, or closing a wave that leaves follow-ups. Produces a paste-ready prompt so the next session resumes without loss.
---

# Continuation

## Overview

Produces a **copy-paste prompt** the user pastes into a fresh session after `/clear`. No file is written.

The prompt is the whole deliverable. It goes in chat, fenced, ready to copy.

## No Handoff Files

**Do not write a handoff file.** (User directive, 2026-07-28: *"don't even have to give me a written file for handoffs. just give a copy and paste prompt."*)

A handoff file duplicated state that is already durable elsewhere — the checklist records progress, the issue log records carried work, git records what shipped. Duplicating it created a second source of truth that could drift, plus a file needing cleanup after resume.

**The prompt therefore points AT the durable artifacts rather than restating them.** Name the paths; let the next session read them. What the prompt must carry on its own is only what exists nowhere on disk: the mission, the unresolved decisions, and the traps.

## Auto-Trigger (Proactive)

**Invoke this skill automatically — without waiting for the user to ask — after any of these events:**

| Event | When to trigger |
|-------|----------------|
| `claude-md-management:reflect` completes | Immediately after reflect finishes — phase boundary = natural clear point |
| `superpowers:brainstorming` produces a spec | After spec is written and approved — heavy context accumulated |
| Phase checklist moved to `done/` | Wave boundary — next session starts fresh anyway |
| Issue log closed with carried/open issues | Carried issues ARE follow-up work — the prompt is how they survive the clear |
| User says "we're done for now" / "that's enough" | Explicit stopping signal |

**How:** After the triggering event finishes, say: "That's a natural break point — here's a resume prompt so you can `/clear` safely." Then produce the prompt.

**Do not** wait for the user to remember to ask. The whole point is they shouldn't have to.

## The Test — Is There Anything To Do After The Clear?

**Produce a prompt whenever there is something the next session should do.** That is the entire condition (user's framing, 2026-07-28: *"continuation is used whenever there is something we should do after a clear"*).

**"The wave is complete" is NOT a skip reason.** Wave status and forward-facing work are independent. A closed wave that leaves carried issues, a named next phase, a queued fix, or an agreed follow-up needs a prompt — the closure is not what matters, the remaining work is.

**Skip only when the answer is genuinely nothing:** phase closed, reflect run, no unchecked tasks, no carried issues, no agreed follow-up, nothing queued. Then say the phase is closed and list any open items (an unmerged branch, a pending decision) in one line.

Both failure directions are real and both have happened here:

- **Recap when nothing remains.** A post-reflect handoff for a completed wave that was pure session diary — "just saying what we are doing in this session." Worthless. (2026-06-11.)
- **Silence when something remains.** A wave closed with three logged follow-up issues and nothing produced, because "completed wave" had hardened into an absolute skip rule it never was. Two entries in the trigger table above fired that same session and neither was honored. (2026-07-28.)

The 2026-06-11 lesson is about **content** (forward-facing, not diary), not about **whether to produce one**. Do not let it collapse into a status check.

## Content Test — Forward-Facing Only

Every line must pass one test: **does the next session need this to act?** The prompt is a mission briefing, not a session diary.

- ❌ "What we did this session" — git log and the done checklist already record it
- ✅ "What the next session must do, decide, or avoid"
- ❌ Restating an issue log's contents — cite the path instead
- ✅ A trap or decision that exists in no file
- Lead with the next mission, not the past wave.

## Steps

1. **Locate state** — scan `docs/<project>/checklists/active/` for a current phase file; if empty, the phase is closed and the mission is the next wave.
2. **Check git** — `git status` + `git log --oneline -3` in every repo the work touched. Uncommitted work is a blocker the prompt must name.
3. **Reconcile the checklist** — if boxes don't match reality, tick them NOW. This is the reconciliation gate; never hand off a checklist that lies. (This survives the clear; the prompt does not.)
4. **Identify the exact next action** — the specific command, skill, or task to start on.
5. **Emit the prompt** — fenced, in chat, self-contained. No file.
6. **Tell the user** they can `/clear` and paste it.

## Prompt Template

Fenced so the user can copy it in one action. Adapt freely — the sections below are what the next session usually needs, not a form to fill.

````markdown
```
<One line: what this session is doing and why it exists.>

Read first:
- <path to issue log / spec / checklist — the durable record>
- <path to any reference doc that constrains the work>

<Mission. What to build, fix, or decide. Enough that the next session can
start without re-deriving the goal — but cite paths instead of restating
what is already written in them.>

Unresolved (decide before or during):
- <decision the next session must make, with the trade-off>

Traps:
- <thing that will silently go wrong, and why — especially anything that
  passes gates while being wrong>

Blockers to clear first:
- <uncommitted work, unmerged branch, unrun migration>

Sequence: <brainstorm / plan / execute — and which skills to load>
```
````

## After Emitting

Tell the user:

> "Safe to `/clear`. Paste the prompt above to resume."

## On Resume (Next Session)

When the user pastes the prompt:

1. Read the artifacts it cites — those are the source of truth, not the prompt
2. Scan `docs/<project>/checklists/active/` to verify current state
3. Check `git status` in the relevant repos to confirm no drift
4. Start at the named next action — no re-planning needed
