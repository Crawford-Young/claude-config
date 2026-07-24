# manager — profile

## Strengths
- Owning a delegated workstream end-to-end: spawns own recon/implementer/reviewer, reports summaries only (seed — T3/T4 history)
- Stalled-dispatch recovery: work-on-disk verification + report-only resume recovered a full task at zero rework (2026-07-08, cybond w2.4 A4)
- Factory protocol adherence on opus (provisional, n=1 — 2026-07-15 agent-factory bootstrap smoke test): read the skill via pointer before first spawn unprompted, followed dispatch template, wrote perf MD write-as-you-go in correct entry format, and self-verified the child's answer against source before grading — the sole-judge behavior wanted, undirected

## Weaknesses
- Cold-start cost is real — ambiguous workstream independence historically resolved to NOT spawning a manager, and pivoting up later was cheaper than a wasted cold start (seed — tier-formula history)

## Model sweet spot
- Default **opus**
- **fable** when the wave has coupling risk (independence on paper, shared invariants underneath) — per-run user clearance (seed fable lane)
- Try Opus 5 manager first (release notes cite strong multi-agent coordination and low subagent collision) — fable clearance only when Opus 5 proves insufficient for the coupling (release-note 2026-07-24, unvalidated — confirm at first reflect)

## Spawn-worthiness
- Earns its cold start ONLY for genuinely independent workstreams with a clean file-set boundary; anything less → spawner runs the tasks itself (seed)
- With worktree isolation when parallel mutation is the point — disjoint file sets are a precondition, not a hope (seed — T4 merge history)

## Open questions
- Depth-3+ management chains (manager under manager) — zero data; first factory waves should scorecard any occurrence
- Smoke test (2026-07-15) proved depth-2 mechanics only — no data yet on manager judgment quality under a real multi-task workstream
- Does Opus 5's cited multi-agent coordination strength hold on a real coupled-workstream manager task, or does fable still earn its clearance? First Opus-5 manager wave should scorecard this. (release-note 2026-07-24, unvalidated — confirm at first reflect)
