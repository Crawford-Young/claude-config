## Goal
Let the ROUTING table be rebuilt from cost data, and let stale model stamps fail loudly. This covers the two open boxes of #79 (user, 2026-10-08: "One audit issue").

**Gap (#79 recon, 2026-10-08):**
- `audit.mjs` breaks spend down by agent type × model, but inside a mixed-model type it gives only request counts per model, with no $ per model. Implementer spend ($38.10 over 22 runs in 30 days) mixes sonnet-5, opus-5.5 and sonnet-5.5, so the sonnet-medium and opus-default rows can't be told apart.
- Effort isn't captured at all: `audit-lib.mjs` has no `effort` field. The 2026-09-04 haiku measurement did read effort from transcripts, so the data exists.

## Done when
- [ ] `audit.mjs` reports $ and runs per type × model × effort, with a test.
- [ ] A check (audit, or a CI script) flags any `verified: YYYY-MM (model)` stamp in the CLAUDE.md chain, `agents/` or `skills/` that names a model older than the current generation of its line (the line list comes from `scripts/prices.json`), with a test.
- [ ] ROUTING.md's table is re-derived from the new view (each row cites n and $/run), or rows the data can't support are marked unmeasured.

## Out of scope
The haiku trial, which has its own issue.

Part of #81. Decided in #79.
