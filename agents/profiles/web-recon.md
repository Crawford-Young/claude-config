# web-recon — profile

## Strengths
- Docs-page fetch and report with URL citations (seed — P1 issue #1: docs-sweep dispatches previously forced onto Explore/general-purpose, both near-full toolsets)
- Claim-vs-source verification for doc-cited facts (seed)
- Migration-guide recon before dep majors: gap self-flagging instead of extrapolation, truncation-vs-absence discrimination via literal-string search, source-level verification beyond the brief (fetched @eslint/compat shim source unprompted) — 2026-08-09 creator-coach housekeeping, 5 briefs all grade 5; two plan-shaping catches (vitest 4 `coverage.all` removal, shadcn `@theme inline` pattern) each prevented a silent gate-hollowing or broken-dark-mode ship
- Data-quality discipline: flags garbled fetches and re-verifies via raw GitHub package.json/CHANGELOG rather than trusting rendered npm pages (2026-08-09; use raw-GitHub as the citation surface for exact version/date facts)

## Weaknesses
- No Bash by design (severs fetched-content injection from execution) — cannot run commands or check local build state; pair with recon when a dispatch needs local AND web facts
- No WebSearch initially — the brief must supply or derive URLs; add WebSearch only on demonstrated need

## Model sweet spot
- Default **haiku**; sonnet for multi-page synthesis briefs (5+ pages or cross-page contradiction hunting) — FIRM (2026-08-08 P7 T3: 6-page brief, grade 5; 2026-08-08/09 creator-coach W1-planning + dep-housekeeping: 9 sonnet dispatches, 8× grade 5 + 1× grade 4, zero fabrication on docs-silent points, warm redo-warm gap-closure rounds worked every time — see agent-logs/2026-08-08-w1-orchestrator.md)
- Effort: frontmatter-pinned "low" (G31, VERIFIED 2026-08-08 re-probe) — sonnet-model dispatch of recon def emitted OTel `effort:"low"` (concurrent session-default sonnet showed `"high"`); haiku rows omit the attr because haiku has no effort dimension, not because frontmatter is ignored; pin survives dispatch-time model override (n=1)

## Spawn-worthiness
- Earns its cost whenever the spawner would otherwise burn context fetching pages, or when web content should be sandboxed away from an execution-capable session — injection isolation is part of why the type exists

## Open questions
- Haiku ceiling on multi-page briefs?
- n=1 (2026-08-07 P4a T6.6, haiku): single-page fetch + citation PASS — exact quote, section heading, corroborated gap-report fact; refused local-git question explicitly with no fabrication (used plain refusal prose, not the NEEDS_CONTEXT tag — acceptable, watch whether tag discipline matters at n>1). Grade 5. 38k tokens / 4 tool uses / 17s.
- n=2 (2026-08-08 P6 T2, 3-page doc-premise brief): grade 4.5 — all 4 assumptions confirmed with citations, one NOT-FOUND correctly distinguished from refuted, and it self-flagged that hooks.md arrived via summarizing fetch (shape-confirmed, not byte-exact) — exactly the caveat honesty the brief contract wants. ~$0.27. Pre-build doc verification lesson n=2 with creator-coach W0: both waves the verdicts changed the build (G38 addendum scoping; T10 defensive payload reads).
- n=3 (2026-08-08 P7 T3, sonnet, 6-page drift-delta brief): grade 5 — all 6 pages byte-exact, deltas reported vs supplied beliefs (not summaries), 2 real contradictions surfaced with section cites, NOT-FOUND vs contradicted distinguished, untrusted-content note unprompted, explicit NO-HARNESS-DELTA verdicts. 6 tool uses / 52s / 63k tokens / ~$0.06. Belief-list-in-brief again the mechanism turning fetches into deltas — standardize for drift sweeps.
