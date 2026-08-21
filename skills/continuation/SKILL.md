---
name: continuation
description: Use whenever anything remains to be done after a `/clear` — wave close, spec approval, heavy-session boundary. Produces a paste-ready prompt (never a file) so the next session resumes without loss.
---

# Continuation

Produce a **copy-paste prompt** the user pastes after `/clear`. No handoff file — the checklist, issue log, and git already record durable state; the prompt points at them and carries only what exists nowhere on disk.

**Produce one whenever something remains to do after the clear** — a closed wave with carried issues or a named next phase still needs one. Skip only when genuinely nothing remains; then say so in one line.

## Steps

1. Gather the mechanical state:
   ```
   node ~/code/claude-config/scripts/session-state.mjs
   ```
   (active checklists with next task, repos that are dirty or off-main)
2. Reconcile: if checklist boxes don't match reality, tick them now — never hand off a checklist that lies.
3. Emit the prompt, fenced, self-contained:

````markdown
```
<One line: what the next session is for.>

Read first:
- <checklist / issue log / spec paths — the durable record>

<Mission — enough to start without re-deriving the goal; cite paths instead of restating their contents.>

Unresolved: <decisions the next session must make, with the trade-off>
Traps: <what will silently go wrong — especially anything that passes gates while wrong>
Blockers first: <uncommitted work, unmerged branch, unrun migration>
```
````

4. Tell the user: "Safe to `/clear`. Paste the prompt above to resume."

Every line must pass one test: does the next session need this to **act**? Mission briefing, not session diary.
