---
name: continuation
description: Use whenever anything remains to be done after a session ends — wave close, spec approval, heavy-session boundary. Produces a paste-ready prompt (never a file) so the next session resumes without loss.
disable-model-invocation: true
---

# Continuation

Ask first, with one AskUserQuestion: fresh session (`/exit`, run the launch line, paste) or continue. Emit the block only if the user picks the fresh session — never in the same reply as the ask, and never unprompted.

## If continue

Say so in one line. No block.

## If fresh session

Produce a **copy-paste prompt** the user pastes into the fresh session. No handoff file — the GitHub issue and the last commit body already record durable state; the prompt points at them and carries only what exists nowhere on disk.

Print the launch line from `node ~/code/claude-config/scripts/session-name.mjs <type> <args>` (type: `ticket` for an issue unit, `epic` for an epic, `director` for a director, else `general`). The user runs it from the repo root in a fresh terminal, then pastes the block below as the first message (an agent can't run `/rename`, and `-n` names the session at launch).

Emit the prompt, fenced, self-contained, first and last lines the literal markers below — the terminal renders fences invisibly, so the markers are the only visible copy boundary:

````markdown
```
===== CONTINUATION START =====
<One line: what the next session is for.>

Read first:
- GitHub issue #<issue> — its Done-when checkboxes
- `git log -1`'s `Next:` line

<Mission — enough to start without re-deriving the goal; cite the issue and commit instead of restating their contents.>

Unresolved: <decisions the next session must make, with the trade-off>
Traps: <what will silently go wrong — especially anything that passes gates while wrong>
Blockers first: <uncommitted work, unmerged branch, unrun migration>
===== CONTINUATION END =====
```
````

Every line must pass one test: does the next session need this to **act**? Mission briefing, not session diary.

Auto-compact thrashing despite the context gauge (e.g. one huge paste): recover via chunked reads → focused `/compact` → subagent offload → fresh session.
