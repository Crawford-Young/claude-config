# wave-release-agent — profile

## Strengths
- Wave-end DoD sweep across components + changeset + PR prep in `~/code/web/component-library` (seed — definition scope)
- Catches the stories/e2e entries component-agents drop (seed — definition note)

## Weaknesses
- Never publishes to npm manually — release workflow owns that (seed — hard boundary)
- Backgrounds gates then idles — a sync subagent's "wait" ends its turn; cost 2 resume rounds w3L. Def now carries Execution Constraints (foreground gates, 2026-07-16)
- Own README/CLAUDE.md edits are the likeliest lint failure in the release — must prettier-check them before the full gate (w3L: first gate EXIT:1 on exactly this)
- End-loaded reporting loses everything to session death — artifacts survived w3L only because they were files; report evidence incrementally (grade 3, n=1, 2026-07-16 w3L)

## Model sweet spot
- Default **sonnet**; verification-heavy procedural work
- w3L ran **opus**: artifact quality high (changeset shipped zero-edit) but the failures were procedural discipline, not capability — no evidence opus needed here (n=1)

## Spawn-worthiness
- High at library wave close; pointless elsewhere (seed)
- If unresumable mid-release, orchestrator finishes the mechanical tail inline per agent-factory §Agent Unresumable (w3L precedent)

## Strengths (added 2026-07-21, cybond w3)
- **Single-fix release prep is a valid dispatch shape** (n=1, A12/PR #106: changeset patch + PR + CI watch, wave-table skip decision evidence-based vs git log) — no def change needed for "not a full wave" scoping
- **Grade-3 gaps CLOSED post-Execution-Constraints** (n=2, both grade 5: L2/PR #101 full release prep, A12/PR #106): no idle stalls, prettier-checked own doc edits pre-commit, mergeStateStatus verified (not the zero-checks trap), trusted prior gate evidence per brief instead of redundant re-runs

## Open questions
- ~~Does sonnet + the new Execution Constraints section close the grade-3 gaps?~~ ANSWERED yes, n=2 (2026-07-18/20, cybond w3)
