# Model Routing

Lightweight, evidence-distilled guide for choosing a model per dispatch.
Distilled 2026-08-21 from the retired per-type profiles (full text in
`docs/harness-evolution/archive/`). Append one-liners with dates when a
dispatch surprises; keep this file short.

| Situation | Model | Effort |
|---|---|---|
| Recon, existence checks, greps, single-fact read-and-report, doc fetches | **sonnet** | low |
| Multi-page doc synthesis (5+ pages, cross-page contradiction hunting) | **sonnet** | default |
| Scoped implementation with a clear brief; verbatim/mechanical batches (even many files); bundled QA fix rounds | **sonnet** | medium |
| Verbatim transcription where the brief carries complete byte-for-byte code | **sonnet** (orchestrator diff-verifies) | low |
| Review with enumerated probes / adjudication-style brief; byte-compare reviews | **sonnet** | high |
| Review the orchestrator cannot pre-frame; 3+ file integration; novel pattern with nothing in-repo to copy; high-stakes code (auth, payments, migrations) | **opus** | default |
| Doc/MD restructure with verbatim-preserve constraints | **sonnet** | default |
| Long-horizon sessions; multistep research; finished-artifact analysis; or Opus at `xhigh`/`max` still falling short | **fable** — per-run user clearance (`FABLE OK`), hook-enforced | default |

Levels: `low` / `medium` / `high` / `xhigh` / `max`; default when unset is `high`. Effort names are not comparable across models — `high` on one model is not `high` on another.

Rules that survived the profile system:

- Set `model:` explicitly on any dispatch of a type without a frontmatter default (hook-enforced) — an omitted model silently inherits the session default.
- Raise effort before switching models — escalating within a model is cheaper than escalating across one; the exception is the Escalation rule's integration/architecture signals, which go straight to opus.
- Subagent model precedence (since v2.1.251): dispatch parameter → agent frontmatter `model:` (`inherit` = the session's model) → `CLAUDE_CODE_SUBAGENT_MODEL` → session default. We do not use `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` — it pins every subagent to one model, overriding per-dispatch model selection, which is the entire mechanism this file describes.
- A `fork` runs on the parent's model, with the parent's context, and the parent's exact tool pool (it skips the tool filters ordinary subagents get). Use only when a guaranteed sub-spawn capability is required **and** the session model is not fable — a fork inherits the session model, so a fork from a fable session *is* a fable dispatch: `agent-model-guard.mjs` resolves the live session model for forks (so `fork model: sonnet` cannot launder one) and blocks without `FABLE OK` clearance. The `Agent` tool is withheld by spawn depth, not by backgrounding — a background subagent below the depth limit keeps it.
- Briefs: omit "verify your work" scaffolding (over-verification — the harness's verifier is a fresh-context subagent regardless of the model that wrote the work); add one scope-discipline line; cap delegation explicitly if the type has the Agent tool.
- We do not route to haiku (user decision, 2026-09-04). The reason is coherence, not risk: effort is silently dropped on haiku — measured across 49 haiku assistant messages, absent in every one, with `web-recon` as a same-def control — so every haiku dispatch forfeited the tuning axis this whole table is built on, and the "raise effort before switching models" rung was a no-op there. Cost was not the argument either way: haiku was 0.87% of measured subagent spend, and moving all of it to sonnet cost $0.86. Retirement was **not** the reason — every active model carries a floor (Sonnet 5 Jun 30 2027, Opus 5 Jul 24 2027; haiku's Oct 15 2026 was merely nearest, Active, no notice issued). Re-open this only with a quality argument, not a retirement one.
- Gate-checkable work (a test suite, a typecheck — not prose or judgment) dispatches at lower effort first, re-running failures at default; only worth it for short tasks, where the re-run costs less than the effort saved.
- Escalation: sonnet fails with integration/architecture signals → opus immediately; no signals → one sonnet retry first. Opus fails → one read-only fable diagnostic (classify plan defect vs wrong assumption vs environment), then surface to the user — never a third implementation attempt.
- Warm redo beats cold re-dispatch for fixable same-model failures — message the same agent with the findings. Escalations are always fresh dispatches.
- Zero-output death with a session-limit message is infra, not failure — re-dispatch once after the limit resets.
