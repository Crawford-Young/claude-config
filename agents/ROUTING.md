# Model Routing

Lightweight, evidence-distilled guide for choosing a model per dispatch.
Distilled 2026-08-21 from the retired per-type profiles (full text in
`docs/harness-evolution/archive/`). Append one-liners with dates when a
dispatch surprises; keep this file short.

| Situation | Model |
|---|---|
| Recon, existence checks, greps, single-fact read-and-report, doc fetches | **haiku** |
| Multi-page doc synthesis (5+ pages, cross-page contradiction hunting) | **sonnet** |
| Scoped implementation with a clear brief; verbatim/mechanical batches (even many files); bundled QA fix rounds | **sonnet** |
| Verbatim transcription where the brief carries complete byte-for-byte code | **haiku** (orchestrator diff-verifies) |
| Review with enumerated probes / adjudication-style brief; byte-compare reviews | **sonnet** |
| Review the orchestrator cannot pre-frame; 3+ file integration; novel pattern with nothing in-repo to copy; high-stakes code (auth, payments, migrations) | **opus** |
| Doc/MD restructure with verbatim-preserve constraints | **sonnet** |
| Diagnostics after an opus failure; exceptional-stakes design review | **fable** — per-run user clearance (`FABLE OK`), hook-enforced |

Rules that survived the profile system:

- Set `model:` explicitly on any dispatch of a type without a frontmatter default (hook-enforced) — an omitted model silently inherits the session default.
- Opus briefs: omit "verify your work" scaffolding (over-verification); add one scope-discipline line; cap delegation explicitly if the type has the Agent tool.
- Escalation: sonnet fails with integration/architecture signals → opus immediately; no signals → one sonnet retry first. Opus fails → one read-only fable diagnostic (classify plan defect vs wrong assumption vs environment), then surface to the user — never a third implementation attempt.
- Warm redo beats cold re-dispatch for fixable same-model failures — message the same agent with the findings. Escalations are always fresh dispatches.
- Zero-output death with a session-limit message is infra, not failure — re-dispatch once after the limit resets.
