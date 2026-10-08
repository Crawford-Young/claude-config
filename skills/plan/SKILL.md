---
name: plan
description: Use when planning any feature, fix, or refactor — before writing implementation code. Adds the issue-as-spec convention, the five plan-time checks, and the trade-off debate for genuine design forks.
disable-model-invocation: true
---

# Plan

Plan mode is the default surface. This skill adds where the spec lives, what's verified first, and when to slow down for a design decision.

## Flow

1. **The spec is the issue body**, this template, compact:
   ```
   ## Goal
   <one or two sentences>
   ## Done when
   - [ ] <observable criterion>
   ## Out of scope
   - <explicitly excluded>
   ```
   Oversize spec → sub-issue or linked in-repo doc, never a loose file. There is always an issue; user approves. When the shape is obvious, Goal and Done when can each collapse to one line.
2. **Plan in plan mode; execute the approved plan.** No plan file persists: a cold session resumes from the last commit's `Next:` plus the issue's Done-when.
3. **Every green step is its own commit**, body written so a cold session can resume from it alone:
   ```
   What: <mechanism, not just the symptom>
   Verified: <exact cmd> → rc=<n>, or the observation that showed it
   Next: <the next step, and anything left unfinished>
   Ruled out: <anything tried and dropped, with its evidence>
   ```
   One step per commit, never batched. Plan-doc upkeep measured at 23% of spend for 5% of active time across 24 sessions (`coe-skills/skills/writing-plans/README.md`) — the commit body replaces it.
4. **A scaffold-era repo runs one full first-boot gate battery before its first feature wave** (build, dev boot, every gate, CI on a trivial PR) — a never-run gate hides the whole blocker stack.
5. **Task granularity is a function of the executing model, not a constant** — a model that holds a long session can take larger, less-decomposed steps.

## Five checks before a plan is trusted

1. Verify every cited path, export, and API at plan time (Glob/grep/read the installed dist) — unverifiable premises are assumptions to confirm, never facts.
2. Enumerate consumers of anything the plan changes — a shared payload field, a predicate's meaning, a deleted symbol, a schema column. Grep at plan time; fixtures count as consumers.
3. Run verbatim code blocks through the repo's real tooling (prettier, eslint, tsc) before they enter the plan — a byte-faithful implementer reproduces drift.
4. Value-judgment choices go to the user at spec time — anything encoding product feel (archetype, motion, display semantics) is a question with options, never a plan walk-rule.
5. **Process/context-change waves get a cold-session plan review before execution** — the author cannot see their own premises (n=13, 0 self-caught lifetime, 2026-08-09 — `docs/harness-evolution/archive/2026-08-21-agent-profiles.md`). Hand a fresh session the plan, ask for defects, no summary of intent.

## Design forks — argue the trade-offs

When 2+ viable approaches have materially different trade-offs (or the user says "debate this"): present each through the lens that genuinely champions it — structure, smallest-correct-solution, failure modes, security, user friction — with a concrete consequence in THIS design per lens, then a trade-off table and recommendation. The user picks; record the pick and rationale in the issue. Skip when one path is obviously right.

## Specs that describe visible output

A spec section describing user-visible output (UI, terminal, statusline) carries a rendered mock at approval — prose approval of a visual surface isn't approval.
