---
name: continuation
description: Use whenever anything remains to be done after a session ends — wave close, spec approval, heavy-session boundary. Produces a paste-ready prompt (never a file) so the next session resumes without loss.
disable-model-invocation: true
---

# Continuation

Produce a **copy-paste prompt** the user pastes into a fresh session. Print it directly, with no question first. To keep going in this session, the user ignores it, so end the reply with one line saying so. No handoff file — the GitHub issue and the last commit body already record durable state; the prompt points at them and carries only what exists nowhere on disk.

Get the name from `node ~/code/claude-config/scripts/session-name.mjs <type> <args>` (type: `ticket` for an issue unit, `epic` for an epic, `director` for a director, else `general`). In the desktop app, title the session yourself with `mcp__ccd_session_mgmt__set_session_title`, or start the fresh session with `start_session` and that title, so the user relaunches nothing. For a CLI session, print the launch line: the user runs it in a fresh terminal, then pastes the block below as the first message. A ticket's line starts the session in its worktree, where session-start names it (#344): `worktree.mjs new`'s `launch:` line, or `cd <worktree>; claude` when the worktree exists. Every other line is `claude -n <name>`, run from the repo root.

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
