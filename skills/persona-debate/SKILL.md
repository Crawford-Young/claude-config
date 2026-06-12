---
name: persona-debate
description: Use when brainstorming reaches a genuine design fork — 2+ viable approaches with materially different trade-offs — or when the user says "debate this". Personas with competing legitimate engineering claims argue the options, ending in a trade-off table and a recommendation the user picks from. Spec-phase only; never during plan execution.
---

# Persona Debate

## Overview

Adversarial pressure at spec-time design forks. Brainstorming's "propose 2-3 approaches" step produces one author's framing — the same model writes all options and its own recommendation, so trade-offs reflect a single value system. This skill replaces that step's output shape when the fork is genuine: personas argue, disagreements become an explicit trade-off table, and the user picks the path.

Original goal (verbatim, 2026-06-11): "different personas argue with each other when writing a spec to show the trade-offs and the best path to take."

## Core Principle

**Every persona has a legitimate claim to the approach of a problem.** Best practice is the baseline, not a debate position — "skip best practice to move fast" is never a legitimate stance, so there is no velocity persona. Real debates happen between engineers who all follow best practice but optimize different, genuinely conflicting dimensions. A persona arguing for cutting corners is a strawman; remove it.

## Trigger Discipline

- Fires inside `superpowers:brainstorming` at the "propose 2-3 approaches" step, when the fork is genuine: 2+ viable approaches with materially different trade-offs.
- One-obvious-path specs skip the debate entirely — present the single approach as normal.
- Manual override: the user says "debate this" at any decision point during brainstorming.
- Never fires during writing-plans or wave execution. Spec-phase only.

## Persona Roster (living data — reflect maintains)

| Persona | Optimizes for | Legitimate claim | Joins when |
|---|---|---|---|
| **architect** | Long-term structure, extensibility, clean boundaries | Today's shortcut is tomorrow's rewrite; boundaries decide what change costs later | Always candidate |
| **minimalist** | Smallest correct solution, YAGNI | Every component not built is zero bugs and zero maintenance; speculative generality is real debt | Always candidate |
| **operator** | Failure modes, observability, production debugging | A design that can't be debugged in production isn't done; errors, logging, rollback are design inputs | Infra, services, data flows |
| **security-engineer** | Attack surface, data exposure, least privilege | Breach cost is asymmetric — one miss outweighs years of convenience | Auth, payments, user input, secrets |
| **user-advocate** | User value, friction, perceived performance | A technically perfect spec that frustrates users has failed; latency and friction are correctness criteria | UI/UX-facing specs |
| **maintainer** | Cognitive load for the next reader, dependency hygiene | Code is read 10× more than written; a clever design nobody else can modify is a liability | Always candidate |

Cost-consciousness is not a separate persona — it folds into minimalist (maintenance cost) and operator (infra cost).

Reflect appends or amends rows (date + evidence) when a wave scorecard or spec retrospective shows a missing voice — same approval gate as the orchestrate routing table.

## Lineup Selection

Pick the 2–4 personas most relevant to the fork. State the lineup with a one-line reason for each before round 1. More than 4 relevant → cap at 4, note the dropped voice in the spec.

## Debate Protocol (inline role-play, max 2 rounds)

1. **Frame.** Restate the user's goal **verbatim** — the exact quote, never a paraphrase — then state the fork. This is the anti-flattening guard; it is mandatory. No verbatim quote on record → quote the nearest recorded user wording and flag the absence; never paraphrase silently.
2. **Round 1 — positions.** Each persona: 2–4 sentences, must cite a concrete consequence in THIS spec ("if we pick X, then Y breaks/costs/blocks"). No generic platitudes.
3. **Round 2 — rebuttals.** Each persona attacks the strongest rival point. No persona may concede in round 2 — concessions appear only in synthesis.
4. **Synthesis.** Drop the persona voices; write the trade-off table and recommendation.

All rounds visible in chat — the user sees the arguments, not just the verdict.

## Output

Per disagreement, a trade-off table:

```markdown
| Option | <persona A> | <persona B> | … | Cost | Risk |
|---|---|---|---|---|---|
```

Then a synthesized recommendation with reasoning, then AskUserQuestion — the user picks the path. Record every pick in the spec:

```markdown
## Debate Resolutions

- **Fork:** <what was contested>
  **Lineup:** <personas + one-line why each>
  **Options:** <A vs B vs C>
  **Pick:** <user's choice> — <one-line rationale>
```

## Early Exits

- **Round-1 convergence** (no real disagreement): state the consensus, skip the table, proceed. Debate cost stops there.
- **Fork turns trivial mid-debate:** cut straight to synthesis, note why in the spec.

## Reflect Hooks

At reflect, score each debate that ran: did it change the outcome vs the default single-author recommendation? Was the lineup right? Missing voice → propose a roster row (date + evidence).
