# Explore — profile

Override def created 2026-08-07 (G43): pins built-in Explore to haiku (built-in inherits session model since v2.1.198 — fable-billed here).

## Model sweet spot
- **haiku** — the frontmatter default is right; OMIT `model:` at dispatch (factory rule 5 omit-clause applies). Fan-out search needs breadth, not depth.

## Open questions
- No performance data yet — scorecard first dispatches at reflect.
