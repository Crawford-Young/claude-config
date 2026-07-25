# recon — profile

## Strengths
- Existence checks, pattern lookups, test/build output verification, reviewer-claim verification — cheap and fast (seed — routing-table default)
- Single-fact read-and-report on haiku as a depth-2 child: verbatim answer, no padding, 1 tool use / ~26k tokens; manager-graded 5/5 (provisional, n=1 — 2026-07-15 agent-factory bootstrap smoke test)
- Root-cause classification after repeated failure: plan defect vs wrong assumption vs environment (seed — diagnostic lane)

## Strengths (cont.)
- sonnet surface-extraction recon: exact file:line anchors across 10-item briefs, both grade 4 (2026-07-16 w3L, n=2 one wave); gs-p1 12-item brief graded 5 — "if absent, find where it lives" clause returned absent items WITH where-they-live evidence plus 2 unprompted discrepancy flags + 1 ISSUE line (2026-07-22, n=3); slot-W2 both grade 5 (n=5): contract-surface enum found 2 unmocked real-lib test files the spec missed + flagged a stale foreign checklist premise as ISSUE; lib-premise recon handled a git-show-vs-working-tree split cleanly when briefed "report against origin/main via git show" — repeat that instruction verbatim whenever the checkout holds a parked branch (2026-07-22)
- **"Flag don't guess" instruction pays measurably (wid phase-3a T5 gap-table, 2026-07-25, grade 4):** ~30-node tscn extent extraction otherwise exact (implementer later verified all five spans to 0.0 m delta); the one mis-attribution was flagged AS unresolved ("could not resolve confidently") instead of silently guessed — cost one orchestrator grep to resolve, not a wrong plank. Keep the clause in geometry/table recon briefs. (n=1 provisional)

## Weaknesses
- "Confirm X exists on component Y" briefs: reports absence without locating where X actually lives — brief must add "if absent, find where it lives" (w3L recon 1). Mitigation proven grade-5 at gs-p1 (2026-07-22) — keep the clause in every recon brief
- "Consumers of table X" briefs: greps app/server dirs, misses trigger/ jobs — brief must say whole src tree (w3L recon 2)

## Model sweet spot
- Default **haiku**
- **fable** for the diagnostic lane after an opus implementation failure (systematic-debugging framing; per-run user clearance) (seed fable lane)
- Ladder unchanged structurally, but the opus rung is now Opus 5 — fable diagnostics fire only after an Opus-5 failure; expected fable volume drops accordingly (release-note 2026-07-24, unvalidated — confirm at first reflect)

## Spawn-worthiness
- Earns its cost whenever the spawner would otherwise read >10 files or burn context on fan-out fact-finding (seed — efficiency playbook)

## Open questions
- Haiku ceiling: which recon dispatches actually needed sonnet?
- Does actual fable diagnostic-dispatch volume drop post-Opus-5, as predicted? First-wave count should confirm. (release-note 2026-07-24, unvalidated — confirm at first reflect)
