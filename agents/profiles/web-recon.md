# web-recon — profile

## Strengths
- Docs-page fetch and report with URL citations (seed — P1 issue #1: docs-sweep dispatches previously forced onto Explore/general-purpose, both near-full toolsets)
- Claim-vs-source verification for doc-cited facts (seed)

## Weaknesses
- No Bash by design (severs fetched-content injection from execution) — cannot run commands or check local build state; pair with recon when a dispatch needs local AND web facts
- No WebSearch initially — the brief must supply or derive URLs; add WebSearch only on demonstrated need

## Model sweet spot
- Default **haiku**; consider sonnet for multi-page synthesis briefs (5+ pages or cross-page contradiction hunting) — unvalidated, confirm at first reflect

## Spawn-worthiness
- Earns its cost whenever the spawner would otherwise burn context fetching pages, or when web content should be sandboxed away from an execution-capable session — injection isolation is part of why the type exists

## Open questions
- Haiku ceiling on multi-page briefs?
- n=0 — no performance data yet; grade first dispatches
