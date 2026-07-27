# Profile: claude-code-guide (built-in type)

Docs-research lane for Claude Code / Agent SDK / API platform questions. Read-only (Glob/Grep/Read/WebFetch/WebSearch).

## Evidence

- 2026-07-27 harness-upgrades pre-wave (n=4 dispatches, 1 wave — all provisional):
  - Docs sweeps: 3/3 PASS, grades 4–5. ~110–130k tokens, ~2–3min each, zero redos. Findings came with URLs + GA/beta status + harness-fit lines; brief's "already-uses" exclusion list honored.
  - Verify recon over sweep output: PASS grade 5, ~150s — caught 2 sweep errors (undocumented flag value, imprecise hook-vs-deny ordering).

## Routing guidance (provisional, n=1 wave)

- **Strength:** parallel docs fan-out with a filtering brief; structured findings tables.
- **Weakness:** asserts version-level detail (v2.1.x feature claims, hook names) confidently beyond verifiability — treat sweep output as leads, not facts.
- **Standard pattern:** sweep dispatches + one cheap verify-pass dispatch over their combined claims before any spec consumes them.
- **Model:** default (no override needed).
