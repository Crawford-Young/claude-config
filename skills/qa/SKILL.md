---
name: qa
description: Use when running quality gates — tests, lint, typecheck, e2e, coverage — for any repo, or when verifying work before calling it done. Runs the repo's own gates with honest exit codes and compact output via qa.mjs.
---

# QA

Run gates through the script — it keeps output honest and small:

```
node ~/code/claude-config/scripts/qa.mjs [repo]          # all discovered gates
node ~/code/claude-config/scripts/qa.mjs [repo] --list   # show what would run
node ~/code/claude-config/scripts/qa.mjs [repo] --gate e2e
```

Gates come from the repo itself (justfile `check` recipe, else package.json scripts). Each runs foreground and unpiped; full output goes to `~/.claude/qa-logs/`, the console gets `EXIT:<code>` per gate, failure lines on red, and all four coverage metrics on green.

## Rules

- The exit line is the verdict — never a piped summary, never a remembered threshold. Read the repo's `vitest.config.ts` for its actual coverage numbers before quoting one.
- `just check` composition differs per repo — `--list` shows what a gate actually covers; don't quote it as covering e2e when it doesn't.
- Before e2e: the script warns when :3000/:3001 have listeners — `reuseExistingServer` silently drives whatever answers the port. Kill stale holders first (`cleanup.mjs --kill-port N`).
- The domain CLAUDE.md's Definition of Done is the gate list for "done" — including the manual pass (playtest for games, hands-on browser QA for UI waves).
- `/code-review`'s effort level (`low` through `max`) is sticky across sessions — it reuses the last level you typed, even from an earlier session, until you type a new one. At `low`/`medium` it reports only high-confidence findings. Any coverage-first review pass must pass `high` explicitly rather than relying on the (unknown, possibly stale) default.
