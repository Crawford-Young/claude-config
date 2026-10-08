---
name: continuation
description: Use whenever anything remains to be done after a `/clear` — wave close, spec approval, heavy-session boundary. Produces a paste-ready prompt (never a file) so the next session resumes without loss.
disable-model-invocation: true
---

# Continuation

Ask first, with one AskUserQuestion: clear or continue. Emit the block only if the user picks clear — never in the same reply as the ask, and never unprompted.

## If continue

Say so in one line. No block.

## If clear

Produce a **copy-paste prompt** the user pastes after `/clear`. No handoff file — the GitHub issue and the last commit body already record durable state; the prompt points at them and carries only what exists nowhere on disk.

Tell the user to type `/rename <repo>-<issue>` as its own message first (agents can't run slash commands), then paste the block below as a second message.

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

Auto-compact thrashing despite the context-gauge gate (e.g. one huge paste): recover via chunked reads → focused `/compact` → subagent offload → `/clear`.
