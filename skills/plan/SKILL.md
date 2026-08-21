---
name: plan
description: Use when planning any feature, fix, or refactor — before writing implementation code. Plan mode is the planning surface; this skill adds the workspace's spec/checklist conventions, the five plan-time verification checks, and the trade-off debate for genuine design forks.
---

# Plan

Plan mode is the default planning surface. This skill carries what plan mode doesn't know: where plans persist, what gets verified before a plan is trusted, and when to slow down for a design decision.

## Flow

1. **Design work first when the shape is genuinely open.** Write a short spec to `docs/<domain>/<project>/specs/<date>-<topic>-design.md` and get approval before planning tasks. Skip the spec for work whose shape is obvious.
2. **Plan in plan mode.** For single-session work the approved plan is enough — execute it.
3. **Multi-session / wave work persists as a checklist:**
   ```
   node ~/code/claude-config/scripts/checklist.mjs new <project-docs-dir> <slug> --branch feat/x --spec <path>
   ```
   Fill the tasks from the approved plan. The checklist is the resume file across sessions — tick via `checklist.mjs tick` (real UTC stamps), archive via `checklist.mjs done`.

## Five checks before a plan is trusted

1. **Verify every cited path, export, and API at plan time** (Glob/grep/read the installed dist) — unverifiable premises are written as assumptions to confirm, never as facts.
2. **Enumerate consumers of anything the plan changes** — a shared payload field, a predicate's meaning, a deleted symbol, a schema column. Grep at plan time; test fixtures count as consumers.
3. **Run verbatim code blocks through the repo's real tooling** (prettier, eslint, tsc) before they enter the plan — a byte-faithful implementer reproduces the drift.
4. **Value-judgment choices go to the user at spec time** — anything encoding product feel (presentation archetype, motion, semantics of a display) is a question with options, never a plan walk-rule.
5. **Process/context-change waves get a cold-session plan review before execution** — the author cannot see their own premises (measured: 6 runs, 0 self-caught). Hand a fresh session the plan, ask for defects, no summary of intent.

## Design forks — argue the trade-offs

When a complex problem has 2+ viable approaches with materially different trade-offs (or the user says "debate this"): present each approach through the lens that genuinely champions it — long-term structure, smallest-correct-solution, production failure modes, security, user friction — with a concrete consequence in THIS design per lens, then a trade-off table and a recommendation. The user picks; record the pick and rationale in the spec. Skip entirely when one path is obviously right.

## Specs that describe visible output

A spec section describing user-visible output (UI, terminal, statusline) carries a rendered mock at approval — prose approval of a visual surface is not approval.
