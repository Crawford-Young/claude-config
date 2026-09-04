---
name: reflect
description: Use when a development phase ends — branch merged, wave finished, milestone complete — to review what happened with the user and update the harness. Owned replacement for the old plugin reflect; gathers inputs via reflect-gather.mjs.
---

# Reflect

End-of-phase dialogue: self-reflect, hear the user, land agreed harness edits. Prompted at wave close (the stop gate reminds once); the user can decline.

## 1. Gather

```
node ~/code/claude-config/scripts/reflect-gather.mjs <project-docs-dir> --repo <path> [--repo <path>...]
```

One payload: the wave checklist, open issue logs, per-repo git activity. Skim the skills and agent defs the wave actually used only if something felt off with them.

## 2. Self-reflect

A short freeform report — only sections with something genuine to say:

- **Adherence** — where harness guidance was followed, deviated from, ambiguous, or missing.
- **Friction** — what was slow, clunky, or needed unnecessary back-and-forth.
- **Proposed changes** — each tied to an observation: which file, what edit, why (one line).

## 3. Dialogue

Present the report, then ask what the user noticed that you missed — corrections, frustrations, patterns worth codifying. Don't finalize until they've had a real chance to respond.

## 4. Update

Apply agreed edits with the Edit tool, showing each diff. **Pruning bias — every addition names a deletion candidate.** The harness got bloated by accreting dated incident rules; the fix discipline:

- A new rule is one imperative line that names its reason (why, not when) — a rule stripped of its reason is the one the next audit prunes. The incident story goes to `docs/harness-evolution/archive/rule-history.md` (date + one line), not into the live file.
- A rule that must hold every time becomes a hook or deny rule, not prose (`hooks/bash-guard.mjs` is the pattern) — then the prose is deleted.
- Recurrence despite a rule means the file is too long, not the rule too weak — prune or mechanize, never restate louder.
- Model-routing observations (a dispatch that surprised, a misroute) go to `agents/ROUTING.md` as a one-liner with date.
- claude-config edits land live on the main checkout, commit via `git-ops` (`land.mjs`).

## 5. Close the boundary

Wave done with more work ahead: `continuation` skill → verify checklist ticked and archived → suggest `/clear`. Project fully done: just suggest `/clear`.
