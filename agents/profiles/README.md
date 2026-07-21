# Agent Type Profiles

**Profiles are the routing authority; type definitions (`../*.md`) are general guidance.** Before spawning, the assigner reads the candidate type's profile, routes on its evidence, and distills fit guidance into the child's brief. Children never read profiles.

## Structure (every profile)

1. **Strengths** — task types with win evidence
2. **Weaknesses** — loss evidence
3. **Model sweet spot** — default + override conditions
4. **Spawn-worthiness** — does this type earn its cold start, and for what
5. **Open questions** — what the data can't answer yet

## Rules

- Every claim carries date + wave evidence. **n=1 → mark `(provisional)`**; firm claims need n≥2.
- Reflect owns updates: sweeps `docs/<project>/agent-logs/` at wave end, updates profiles, discounts grades not grounded in verifiable outcomes (gates passed, redo counts).
- Seed rows (2026-07-15) migrated from the retired Layer-2 routing table + fable lanes — original evidence dates preserved.
- Staged types get a profile stub at promotion, never before.
