---
name: harness-editing
description: Use before editing the workspace harness — the CLAUDE.md chain, claude-config, hooks, skills, agent defs, or settings.json. Carries the layout map, the live-vs-commit rule, and verification discipline for harness changes.
---

# Harness Editing

## Layout — what lives where

| Artifact | Location |
|---|---|
| Root + domain CLAUDE.md, reference docs | `claude-config/workspace/` — junctioned into `~/code` |
| Skills | `claude-config/skills/` — one junction per skill into `~/.claude/skills/` (a new skill needs `setup.ps1`/`setup.sh` re-run or a hand-made junction) |
| Agent defs + ROUTING.md | `claude-config/agents/` — whole-directory junction to `~/.claude/agents/` |
| Hooks | `claude-config/hooks/*.mjs` — wiring in `~/.claude/settings.json` |
| Workflow scripts | `claude-config/scripts/*.mjs` (tests in `scripts/test/`, run `node --test`) |
| Specs, checklists, issues, archives | `~/code/docs/` (private repo) — never in junctioned claude-config dirs |

## Edit rules

- **Junctions load the MAIN checkout only.** Live edits land on its disk (Edit tool needs the real `claude-config/...` path — it refuses symlinks); commits go through `git-ops` (`land.mjs` — ephemeral worktree from `origin/main`, path-scoped diff). Never commit on the main checkout (hook-enforced).
- **Mid-session CLAUDE.md edits are inert** until the next `/clear`, `/compact`, or restart. Hook wiring changes, by contrast, apply live.
- **A rule that must hold every time is a hook or deny rule, not prose** — extend `hooks/bash-guard.mjs` (with a test) instead of adding a "never X" line.
- **New rules are one imperative line**; the incident story goes to `docs/harness-evolution/archive/rule-history.md`. Recurrence despite a rule = prune or mechanize, never restate louder.
- Skill frontmatter: an unquoted `: ` in `description` silently unpublishes the skill (`verify-frontmatter.mjs` gates it in CI); lead descriptions with discriminating keywords.

## Verification

- Routing/behavior claims are verified by **probe** (a fresh session, an uncontaminated prompt, a near negative control), not by inspection — and audited by tool trace, not the announce line. A session cannot probe its own routing.
- Known-broken description routing: `docs/web/TESTING-TRAPS.md` and games diagnostics are hand-loaded via domain CLAUDE.md pointer lines — don't re-attempt description rewrites for them.
- Hooks are fail-open: errors go to `~/.claude/hook-errors.log` — check it first when a hook seems silent. Unit-test hooks by piping JSON to stdin.
