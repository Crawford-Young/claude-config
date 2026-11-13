# Model Routing

Evidence-distilled guide for choosing a model per dispatch. When a dispatch surprises, add a rule here as one imperative line naming its reason, and put the incident in `~/code/docs/harness-evolution/archive/rule-history.md` (the retired per-type profiles sit beside it in `2026-08-21-agent-profiles.md`). Keep this file short.

Roster: `implementer` (code via TDD, docs/prose edits), `implementer-opus` (the same at opus and high), `reviewer` (review; Write only for scratch probe files), `recon` (read-only local and web lookups). Built-in types without a frontmatter `model:` (e.g. `Explore`, `general-purpose`) get `model: sonnet` filled when a dispatch omits it.

| Situation | Model | Effort | Evidence: n runs, $/run (31 days to 2026-10-13) |
|---|---|---|---|
| Recon, existence checks, greps, single-fact read-and-report, doc fetches | **sonnet** | low | recon · sonnet-5-5 · low: n=15, $0.10 (sonnet-5: n=21, $0.20); redo ≤7% (n=28, 31 days to 2026-11-10; upper bound — follow-on assignments count) |
| Multi-page doc synthesis (5+ pages, cross-page contradiction hunting) | **sonnet** | default | unmeasured: no type × model × effort isolates it |
| Scoped implementation with a clear brief; verbatim/mechanical batches (even many files); bundled QA fix rounds | **sonnet** | medium | implementer · sonnet-5-5 · medium: n=54, $0.31 (sonnet-5: n=11, $2.09); redo ≤22% (n=83, 31 days to 2026-11-10; upper bound — follow-on assignments count) |
| Verbatim transcription where the brief carries complete byte-for-byte code | **sonnet** (orchestrator diff-verifies) | low | unmeasured: no implementer run at low |
| Review with enumerated probes / adjudication-style brief; byte-compare reviews | **sonnet** | high | reviewer · sonnet-5-5 · high: n=3, $0.15 (sonnet-5: n=4, $0.43); thin; not rated (re-runs follow implementer fixes) |
| Review the orchestrator cannot pre-frame; 3+ file integration; novel pattern with nothing in-repo to copy; high-stakes code (auth, payments, migrations, and anything that deletes refs, branches or data — the is-it-safe-to-delete check is the part a scoped task gets wrong, and it cannot be undone) | **opus** | high (implementer: dispatch `implementer-opus`, named; reviewer: its frontmatter) | implementer · opus-5-5 · medium (frontmatter, no override; n=53, $2.44) is the pre-#195 baseline, redo ≤59% (n=39, 31 days to 2026-11-10; upper bound — follow-on assignments count); implementer-opus · opus-5-5 · high: redo ≤36% (n=53, same window and caveat); reviewer · opus-5-5 · high (frontmatter): n=31, $1.07, not rated (re-runs follow implementer fixes) |
| Doc/MD restructure with verbatim-preserve constraints | **sonnet** | default | unmeasured: runs carry no task kind to tell it from implementation |
| Long-horizon sessions; multistep research; finished-artifact analysis; or Opus at `xhigh`/`max` still falling short | **fable** — per-run user clearance (`FABLE OK`), hook-enforced | default | unmeasured: one fable run, a recon at low ($0.18) |

Levels: `low` / `medium` / `high` / `xhigh` / `max`; the unset default is the *model's* own, not a constant — `high` on most (Opus 4.7 included), but `medium` on Opus 5.5 and Haiku 5.5. Effort names are not comparable across models — `high` on one model is not `high` on another.

Rules:

- Dispatch an opus implementer as `implementer-opus`, named `<role>_<kind>_<target>` from `session-name.mjs`, because a named call drops only its own `effort` param — the frontmatter's `effort: high` still holds.
- Set `model:` explicitly when sonnet isn't the pick for a type without a frontmatter default — an omitted one gets sonnet filled in (hook-enforced), or is blocked on a billed or unknown session, because a child that didn't get the fill would inherit the session model.
- Raise effort before switching models — escalating within a model is cheaper than escalating across one; the exception is the Escalation rule's integration/architecture signals, which go straight to opus.
- Subagent model precedence (since v2.1.251): dispatch parameter → agent frontmatter `model:` (`inherit` = the session's model) → `CLAUDE_CODE_SUBAGENT_MODEL` → session default.
- We do not use `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` — it pins every subagent to one model, overriding per-dispatch model selection, which is the entire mechanism this file describes.
- Use a `fork` only when the child needs the parent's full context or exact tool pool **and** the session model is not fable — a fork runs on the parent's model, context and tool pool (skipping ordinary subagents' tool filters), so a fork from a fable session *is* a fable dispatch: `agent-model-guard.mjs` resolves the live session model for forks (a `model: sonnet` cannot launder one) and blocks it without `FABLE OK`.
- Never fork to get past the depth limit — at the wall a fork's `Agent` call errors.
- The `Agent` tool is withheld by spawn depth, not by backgrounding — a background subagent below the depth limit keeps it.
- Do not route to haiku (user decision 2026-09-04): effort was silently dropped on every measured Haiku 4.5 message, forfeiting the tuning axis this table is built on; Haiku 5.5 documents all five effort levels, so the exclusion is pending a re-test (verified: 2026-10, Haiku 5.5).
- Dispatch gate-checkable work (a test suite, a typecheck — not prose or judgment) at lower effort first and re-run failures at default — only for short tasks, where the re-run costs less than the effort saved.
- Escalation: sonnet fails with integration/architecture signals → opus immediately; no signals → one sonnet retry first. Opus fails → one read-only fable diagnostic (classify plan defect vs wrong assumption vs environment), then surface to the user — never a third implementation attempt.
- Start Fable 5.2 at its `high` default and do not route to `medium` or `low` on the doc's word alone — effort names don't carry across models, so Fable 5's sweep does not transfer. 5.2 has no Priority Tier and its own rate-limit pool, apart from the one Fable 5 and 5.1 share, at the same limits (verified: 2026-11, Fable 5.2).
- Read every **opus** row as Opus 5.5 and every **sonnet** row as Sonnet 5.5 — the picks were carried over when the aliases moved, so the Evidence column measures their cost on 5.5, not their fit, and a surprising 5.5 dispatch is new evidence, not a table error (verified: 2026-10, Opus 5.5 + Sonnet 5.5 defaults).
- Opus 5.5's unset effort is `medium`; `modelSettings.claude-opus-5-5.effortLevel` pins the session to `high` (user decision 2026-09-22: hold the known-good baseline so the model is the only variable), and a dispatch's frontmatter `effort:` still wins. Do not route to its `medium` or `xhigh` on the doc's word alone — unmeasured here.
- Re-derive the Evidence column from `node scripts/audit.mjs --since 2026-09-13`, section *Per agent type × model × effort*: n is runs, $/run API-equivalent, each run filed under the model and effort most of its requests used. It measures cost, not fit — $/run follows the task mix as much as the model, so the picks rest on the dispatch notes, and a row the audit can't isolate is marked unmeasured. Per-type blended over the same 31 days: implementer $1.43 (118 runs), reviewer $0.93 (40), recon $0.16 (39).
- Warm-redo a fixable same-model failure — message the same agent by its agent id via SendMessage with the findings, which beats a cold re-dispatch. Escalations are always fresh dispatches.
- Treat a zero-output death with a session-limit message as infra, not failure — re-dispatch once after the limit resets.
- Fix the brief before escalating a sonnet implementer on a scoped harness task — its redos there traced to the brief or the agent def, not to capability.
- A fix-round message restates red→green — a brief saying only "same scope, same gates" let a sonnet implementer skip the red step.
