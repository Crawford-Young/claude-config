# Explore — profile

Override def created 2026-08-07 (G43): pins built-in Explore to haiku (built-in inherits session model since v2.1.198 — fable-billed here).

## Model sweet spot
- **haiku** — the frontmatter default is right; OMIT `model:` at dispatch (factory rule 5 omit-clause applies). Fan-out search needs breadth, not depth.

## Strengths
- Fan-out search with concise file:line conclusions — P4b T6 probe: model-omitted dispatch passed agent-model-guard via the new frontmatter pin and returned the correct wiring answer (statusline command + settings lines + doc refs) in one dispatch, grade 5. Also confirmed built-in overrides register live on write (whole-dir junction). Provisional n=1 (2026-08-07).

## Open questions
- Billed-model confirmation still open — SubagentStop log has no model field; watch usage statusline after first real Explore dispatches (P4b issue #1). Fable-priced Explore persisting = harness ignored the frontmatter pin → escalate.
