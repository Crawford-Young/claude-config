---
name: continuation
description: Use whenever anything remains to be done after a session ends — wave close, spec approval, heavy-session boundary. Produces a paste-ready prompt (never a file) so the next session resumes without loss.
disable-model-invocation: true
---

# Continuation

Produce a **copy-paste prompt** the user pastes into a fresh session. Print it directly, with no question first. To keep going in this session, the user ignores it, so end the reply with one line saying so. No handoff file — the GitHub issue and the last commit body already record durable state; the prompt points at them and carries only what exists nowhere on disk.

A continuation is either a fresh director window or an agent spawn. For a fresh window, get its name from `node ~/code/claude-config/scripts/session-name.mjs director topic <words…>` (or `director repo|epic|issue|pr …` for a charge) and title it with `/rename`, or in the desktop app with `mcp__ccd_session_mgmt__set_session_title` or `start_session`'s title, so the user relaunches nothing; the user pastes the block below as its first message. For an agent spawn, name it `<role>_<kind>_<target>` from the same CLI and pass the block as the prompt. Work on one issue continues as an agent spawned into its worktree (`worktree.mjs new` made it), never a pasted ticket session.

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
Blockers first: <uncommitted work, unmerged branch, unrun migration, background runs still live: wait for them, or post what's pending to the issue (10-16 strate window ended with gates unreported)>
===== CONTINUATION END =====
```
````

Every line must pass one test: does the next session need this to **act**? Mission briefing, not session diary.

Auto-compact thrashing despite the context gauge (e.g. one huge paste): recover via chunked reads → focused `/compact` → subagent offload → fresh session.
