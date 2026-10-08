---
name: reflect
description: Use when an issue's PR merges or a phase closes — review the unit's evidence with the user and land agreed harness edits in place. Gathers every session window of the unit via reflect-gather.mjs (audit joined on the /rename session name).
disable-model-invocation: true
---

# Reflect

Run when an issue's PR merges or a phase closes. The user can decline.

## 1. Gather

```
node ~/code/claude-config/scripts/reflect-gather.mjs <repo>-<issue> --repo <path> [--repo <path>...]
```

One payload: `audit.mjs --session <repo>-<issue>` over every window renamed to the unit's name (cost, depth, agents, skill reads, hook blocks), plus each repo's commits since the first window. A window never renamed is invisible to it: say so instead of guessing. Add the issue thread (`gh issue view N --comments`) for wrong assumptions logged mid-unit.

## 2. Answer three questions

1. **What cost us time?**
2. **What nearly shipped wrong?**
3. **What should become a rule?**

**Evidence or delete:** every bullet cites a transcript (session id + what happened), an audit row, or a commit SHA. A bullet without one is dropped, not softened. An empty answer is fine.

## 3. Dialogue

Present the answers, then ask what the user saw that you missed. Don't finalize until they've had a real chance to respond.

## 4. Edit the harness in place

Apply agreed edits with the Edit tool, showing each diff. Place each per the `harness-editing` ladder. Every addition names a deletion candidate.

- A new rule is one imperative line naming its reason. Where the reason depends on posture, domain or version, carry that condition into the line, else it reads as a false standing claim. The incident goes to `docs/harness-evolution/archive/rule-history.md` (date + one line).
- Recurrence despite a rule means prune or mechanize (a hook with a test), never restate louder.
- Routing surprises go to `agents/ROUTING.md` as a dated one-liner.
- claude-config edits land live on the main checkout and commit via `git-ops` (`land.mjs`).

No ledger: the commits and the issue thread are the record. Then suggest `/clear`.
