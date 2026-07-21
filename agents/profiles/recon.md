# recon — profile

## Strengths
- Existence checks, pattern lookups, test/build output verification, reviewer-claim verification — cheap and fast (seed — routing-table default)
- Single-fact read-and-report on haiku as a depth-2 child: verbatim answer, no padding, 1 tool use / ~26k tokens; manager-graded 5/5 (provisional, n=1 — 2026-07-15 agent-factory bootstrap smoke test)
- Root-cause classification after repeated failure: plan defect vs wrong assumption vs environment (seed — diagnostic lane)

## Strengths (cont.)
- sonnet surface-extraction recon: exact file:line anchors across 10-item briefs, both grade 4 (2026-07-16 w3L, n=2 one wave)

## Weaknesses
- "Confirm X exists on component Y" briefs: reports absence without locating where X actually lives — brief must add "if absent, find where it lives" (w3L recon 1)
- "Consumers of table X" briefs: greps app/server dirs, misses trigger/ jobs — brief must say whole src tree (w3L recon 2)

## Model sweet spot
- Default **haiku**
- **fable** for the diagnostic lane after an opus implementation failure (systematic-debugging framing; per-run user clearance) (seed fable lane)

## Spawn-worthiness
- Earns its cost whenever the spawner would otherwise read >10 files or burn context on fan-out fact-finding (seed — efficiency playbook)

## Open questions
- Haiku ceiling: which recon dispatches actually needed sonnet?
