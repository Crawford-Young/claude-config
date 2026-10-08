# Model Routing

Lightweight, evidence-distilled guide for choosing a model per dispatch.
Distilled 2026-08-21 from the retired per-type profiles (full text in
`docs/harness-evolution/archive/`). Append one-liners with dates when a
dispatch surprises; keep this file short.

Roster (2026-10-08, #66): `implementer` (code via TDD, docs/prose edits), `reviewer` (read-only review), `recon` (read-only local and web lookups). Built-in types without a frontmatter `model:` (e.g. `Explore`, `general-purpose`) get `model: sonnet` filled when a dispatch omits it (#74).

| Situation | Model | Effort |
|---|---|---|
| Recon, existence checks, greps, single-fact read-and-report, doc fetches | **sonnet** | low |
| Multi-page doc synthesis (5+ pages, cross-page contradiction hunting) | **sonnet** | default |
| Scoped implementation with a clear brief; verbatim/mechanical batches (even many files); bundled QA fix rounds | **sonnet** | medium |
| Verbatim transcription where the brief carries complete byte-for-byte code | **sonnet** (orchestrator diff-verifies) | low |
| Review with enumerated probes / adjudication-style brief; byte-compare reviews | **sonnet** | high |
| Review the orchestrator cannot pre-frame; 3+ file integration; novel pattern with nothing in-repo to copy; high-stakes code (auth, payments, migrations, and anything that deletes refs, branches or data — the is-it-safe-to-delete check is the part a scoped task gets wrong, and it cannot be undone) | **opus** | default |
| Doc/MD restructure with verbatim-preserve constraints | **sonnet** | default |
| Long-horizon sessions; multistep research; finished-artifact analysis; or Opus at `xhigh`/`max` still falling short | **fable** — per-run user clearance (`FABLE OK`), hook-enforced | default |

Levels: `low` / `medium` / `high` / `xhigh` / `max`; the unset default is the *model's* own, not a constant — `high` on most (Opus 4.7 included), but `medium` on Opus 5.5 and Haiku 5.5. Effort names are not comparable across models — `high` on one model is not `high` on another.

Rules that survived the profile system:

- Set `model:` explicitly when sonnet isn't the pick for a type without a frontmatter default. An omitted one gets sonnet filled in (hook-enforced), or is blocked on a billed or unknown session, because a child that didn't get the fill would inherit the session model.
- Raise effort before switching models — escalating within a model is cheaper than escalating across one; the exception is the Escalation rule's integration/architecture signals, which go straight to opus.
- Subagent model precedence (since v2.1.251): dispatch parameter → agent frontmatter `model:` (`inherit` = the session's model) → `CLAUDE_CODE_SUBAGENT_MODEL` → session default. We do not use `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` — it pins every subagent to one model, overriding per-dispatch model selection, which is the entire mechanism this file describes.
- A `fork` runs on the parent's model, with the parent's context, and the parent's exact tool pool (it skips the tool filters ordinary subagents get). Use only when the child needs the parent's full context or tools — not to spawn past the depth limit, where a fork's `Agent` call errors — **and** the session model is not fable — a fork inherits the session model, so a fork from a fable session *is* a fable dispatch: `agent-model-guard.mjs` resolves the live session model for forks (so `fork model: sonnet` cannot launder one) and blocks without `FABLE OK` clearance. The `Agent` tool is withheld by spawn depth, not by backgrounding — a background subagent below the depth limit keeps it.
- Briefs: omit "verify your work" scaffolding (over-verification — the harness's verifier is a fresh-context subagent regardless of the model that wrote the work); add one scope-discipline line; cap delegation explicitly if the type has the Agent tool.
- We do not route to haiku (user decision 2026-09-04; re-test pending #112, 2026-10-08): effort was silently dropped on all 49 measured Haiku 4.5 assistant messages, forfeiting the tuning axis this table is built on. Cost/retirement were never the argument. Haiku 5.5 now documents support for all five effort levels, so #112 re-tests the exclusion (verified: 2026-10, Haiku 5.5).
- Gate-checkable work (a test suite, a typecheck — not prose or judgment) dispatches at lower effort first, re-running failures at default; only worth it for short tasks, where the re-run costs less than the effort saved.
- Escalation: sonnet fails with integration/architecture signals → opus immediately; no signals → one sonnet retry first. Opus fails → one read-only fable diagnostic (classify plan defect vs wrong assumption vs environment), then surface to the user — never a third implementation attempt.
- Fable's effort tuning is stale on 5.1 (2026-09-14) — effort names do not carry across models, so Fable 5's sweep does not transfer. Start at the `high` default; `medium` and `low` are both plausible cost rungs but unmeasured here, so do not route to them on the doc's word alone. Fixed facts: 5.1 has no Priority Tier (Fable 5 does; new purchases are closed platform-wide), and 5.1 still shares Fable 5's rate-limit pool, so recorded headroom holds (verified: 2026-10, Fable 5.1).
- Opus 5.5 released 2026-09-22 and the `opus` alias moved to it at CLI v2.1.280, so every **opus** row above now means 5.5 — the rows were carried over, not re-derived, so a 5.5 dispatch that surprises is new evidence, not a table error. Its unset effort default is `medium`, pinned back to `high` for the session by `modelSettings.claude-opus-5-5.effortLevel` (user decision 2026-09-22: hold the known-good baseline so the model is the only variable); per-dispatch frontmatter `effort:` still wins. Medium and xhigh are plausible cost/quality rungs but unmeasured here — same standing as Fable 5.1 above, so do not route to them on the doc's word alone. The `sonnet` alias moved the same way (v2.1.295 → claude-sonnet-5-5, still claude-sonnet-5 at v2.1.280); every **sonnet** row above is carried over too, unmeasured on 5.5, same standing (verified: 2026-10, Opus 5.5 + Sonnet 5.5 defaults).
- This table's rows are carried over, not cost-derived — `audit.mjs` has no per-model $ within a type and no effort axis yet (#113). 30-day blended $/run to 2026-10-08: recon $0.17 (26 runs), reviewer $0.92 (7), implementer $1.73 (22).
- Warm redo beats cold re-dispatch for fixable same-model failures — message the same agent with the findings. Escalations are always fresh dispatches.
- Zero-output death with a session-limit message is infra, not failure — re-dispatch once after the limit resets.
- sonnet implementer on scoped harness tasks (2026-10-08, #63 and #75): both had correct behavior, $1.68/run. Each needed one warm redo, and both redos traced to the brief or the agent def, not to capability. Fix the brief before escalating.
