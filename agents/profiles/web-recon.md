# web-recon — profile

## Strengths
- Docs-page fetch and report with URL citations (seed — P1 issue #1: docs-sweep dispatches previously forced onto Explore/general-purpose, both near-full toolsets)
- Claim-vs-source verification for doc-cited facts (seed)

## Weaknesses
- No Bash by design (severs fetched-content injection from execution) — cannot run commands or check local build state; pair with recon when a dispatch needs local AND web facts
- No WebSearch initially — the brief must supply or derive URLs; add WebSearch only on demonstrated need

## Model sweet spot
- Default **haiku**; consider sonnet for multi-page synthesis briefs (5+ pages or cross-page contradiction hunting) — unvalidated, confirm at first reflect
- Effort: frontmatter-pinned "low" (G31, 2026-08-08, provisional-UNVERIFIED) — enumeration/read-report shape; probe rows carried no `effort` attr (frontmatter-unsupported vs haiku-not-reporting undecidable — P4c issue log); frontmatter kept to self-activate; raise only on profile evidence at reflect

## Spawn-worthiness
- Earns its cost whenever the spawner would otherwise burn context fetching pages, or when web content should be sandboxed away from an execution-capable session — injection isolation is part of why the type exists

## Open questions
- Haiku ceiling on multi-page briefs?
- n=1 (2026-08-07 P4a T6.6, haiku): single-page fetch + citation PASS — exact quote, section heading, corroborated gap-report fact; refused local-git question explicitly with no fabrication (used plain refusal prose, not the NEEDS_CONTEXT tag — acceptable, watch whether tag discipline matters at n>1). Grade 5. 38k tokens / 4 tool uses / 17s.
