---
name: harness-editing
description: Use before editing the workspace harness — the CLAUDE.md chain, claude-config, hooks, skills, agent defs, or settings.json. Carries the layout map, the live-vs-commit rule, and verification discipline for harness changes.
disable-model-invocation: true
---

# Harness Editing

## Layout — what lives where

| Artifact | Location |
|---|---|
| Root + domain CLAUDE.md, reference docs | `claude-config/workspace/` — junctioned into `~/code` |
| Skills | `claude-config/skills/` — one junction per skill into `~/.claude/skills/` (a new skill needs `setup.ps1`/`setup.sh` re-run or a hand-made junction) |
| Agent defs + ROUTING.md | `claude-config/agents/` — whole-directory junction to `~/.claude/agents/` |
| Hooks | `claude-config/hooks/*.mjs` — wiring in `~/.claude/settings.json` |
| Workflow scripts | `claude-config/scripts/*.mjs` (tests in `scripts/test/`, run `node --test scripts/test/*.test.mjs` — the bare directory form fails on Windows Node 24) |
| Specs, tracking, bugs | GitHub issues — harness/cross-repo in claude-config, project work in its repo |
| Screenshots, harness-evolution archive | `~/code/docs/` (private repo) — never in junctioned claude-config dirs |

**Wiring map:** `claude-config/harness-map.json` names every part and what it calls, gates or feeds — read it before sweeping files. Adding, removing or rewiring a skill, hook, agent or script means updating its node and edges in the same change, or CI (`scripts/harness-map.mjs check`) fails.

## Where a rule lives — the ladder

Stop at the first rung that fits. Each rung down is cheaper context than the next.

1. **Already covered** by a hook, script or resident rule → add nothing. A recurrence despite a rule means pruning or mechanizing it, not restating it.
2. **Deterministic** → a hook or script (with a test), not prose.
3. **Rare procedure or fact** → an on-demand doc, with a one-line pointer at the trigger that needs it.
4. **Must hold on every turn** → a resident line in a CLAUDE.md. This is the last resort.

- **Every resident line carries evidence or goes.** Evidence means a transcript count (`node scripts/audit.mjs`: invocations, blocks, $), a cited incident, or a measurement. Anything without evidence is a deletion candidate at the next trim.
- **Every pinned tool, model or vendor choice carries `verified: YYYY-MM`.** A stale stamp gets re-checked against current docs, not trusted.
- **Resident bytes are capped in CI** (#63). Growing past a cap means cutting elsewhere first.

## Edit rules

- **Junctions load the MAIN checkout only.** Live edits land on its disk (Edit tool needs the real `claude-config/...` path — it refuses symlinks); commits go through `git-ops` (`land.mjs` — ephemeral worktree from `origin/main`, path-scoped diff). Never commit on the main checkout (hook-enforced).
- **Mid-session CLAUDE.md edits are inert** until the next `/clear`, `/compact`, or restart. Hook wiring changes, by contrast, apply live.
- **A rule that must hold every time is a hook or deny rule, not prose** — extend `hooks/bash-guard.mjs` (with a test) instead of adding a "never X" line.
- Separately from whether a rule becomes a hook: **scaffolding that prevents an irreversible mistake stays even when it duplicates something stated elsewhere** (ordering constraints like "commit `.gitignore` before any other file" or "no changeset before verification passes") — scaffolding that only restates a habit or a default behavior the executing agent already follows (e.g. the TDD chain the implementer agent definition already enforces) is a deletion candidate.
- **`/rewind`'s code-restore is a no-op on claude-config's live-edited harness files** — junctioned/symlinked into `~/code` and `~/.claude`, so `/rewind` can't see through the link to what changed; git via `land.mjs` is the only real undo path.
- **New rules are one imperative line that names its reason** (why, not when) — a rule stripped of its reason is the one the next audit prunes. The incident story goes to `docs/harness-evolution/archive/rule-history.md`. Recurrence despite a rule = prune or mechanize, never restate louder.
- Skill frontmatter: an unquoted `: ` in `description` silently unpublishes the skill (`verify-frontmatter.mjs` gates it in CI); lead descriptions with discriminating keywords. Every skill carries `disable-model-invocation: true` and a trigger line in `skills/INDEX.md` (injected by session-start; CI fails a skill missing from it).

## Verification

- Routing/behavior claims are verified by **probe** (a fresh session, an uncontaminated prompt, a near negative control), not by inspection — and audited by tool trace, not the announce line. A session cannot probe its own routing.
- Known-broken description routing: `docs/web/TESTING-TRAPS.md` and games diagnostics are hand-loaded via domain CLAUDE.md pointer lines — don't re-attempt description rewrites for them.
- The `claude` CLI is `~/.local/bin/claude.exe`, which is not on Git Bash's PATH, and subagent shells lack it too. CLI probes (`--help`, `plugin eval`) call it by path from the orchestrator.
- Hooks are fail-open: errors go to `~/.claude/hook-errors.log` — check it first when a hook seems silent. Unit-test hooks by piping JSON to stdin.
- Harness itself suspected: `claude --safe-mode` disables every harness customization at once to confirm the harness is the cause (it won't name the hook); `/doctor` runs a general checkup.
