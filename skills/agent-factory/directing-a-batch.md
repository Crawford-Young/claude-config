# Directing a batch — on-demand doc, not a skill

Read on demand when coordinating several human-pasted parallel sessions. Rare enough that a
resident `description:` would cost more than it saves. `skills/INDEX.md` points here; nothing
else invokes it for you.

## What you are

A team lead, not a worker. **No worktree, no unit of your own.** Decompose the work, allocate
shared singletons, write one paste-ready prompt per unit, run one closing audit at the end. Not a
polling loop or re-verifier of a unit's own claims — each unit's human is already in its session
and owns its own push/PR consent. Consent never travels between sessions: that's why the human
pastes each prompt rather than you spawning the unit yourself.

## Decompose into units, one GitHub issue each

One issue per unit: `## Goal` / `## Done when` (checkboxes) / `## Out of scope`. A unit resumes
from its own commit bodies (`What:` / `Verified:` / `Next:`) plus the issue's Done-when, never a
roster or checklist file. Two candidates touching the same file are one unit, serial.

## Allocate the singleton table up front

Assign every shared, exclusive resource before writing any prompt: a distinct **dev-server port
per unit** per web repo (never a repo's shared default), **one Godot editor at a time** (others
queue), **one emulator/device per unit**, and **one Playwright MCP browser profile** — QA
serializes even when implementation parallelizes; that's the real cap on concurrency, not
file-set independence.

## Write one paste-ready prompt per unit

Self-contained — the receiving session has no memory of this batch. Tell the human to type
`/rename <repo>-<issue>` as its own message first (an agent can't type a slash command, so this
is the human's keystroke), then paste the prompt below as a second message. Each prompt names its
worktree command (`node ~/code/claude-config/scripts/worktree.mjs new <repo> <slug> --branch
feat/<slug>`), states its allocated port/device/profile from the singleton table, and quotes its
Done-when from the issue.

### Example unit prompt

Human types first: `/rename web-142`

Then pastes:

```text
Worktree: node ~/code/claude-config/scripts/worktree.mjs new web checkout-retry --branch feat/checkout-retry
Port: 3002 (3000/3001 held)
Issue: Crawford-Young/web#142
Done when: checkout retries a failed payment once before surfacing the error; test covers it.

Report back when claimed, and again if blocked on anything.
```

## Ask for two checkpoints back

Only two: **`claimed`** and **`blocked on <X>`** (may reorder the batch). Everything else —
gates green, review verdict, PR opening — goes to the unit's own human. Don't chase or
transcribe it.

## Shape: front-loaded, plus one closing audit

Everything expensive is decided before units start. After that you're on call for cross-lane
questions only, not polling. When done, audit once from git and GitHub, never prose: each unit's
PR state (`gh pr view <n> --json state`, confirmed by an empty `git diff --stat origin/main
<branch-head>`) and each issue's closed state (`gh issue view <n> --json state`). No roster file
or tooling.
