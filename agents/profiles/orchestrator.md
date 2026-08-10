# orchestrator — profile (NOT a dispatchable type)

**Special case: this profile governs the MAIN session's model choice, not a spawnable agent.** There is no `agents/orchestrator.md` type definition and no `Agent(subagent_type: orchestrator)` — the orchestrator is the session itself. Read via the root CLAUDE.md §Orchestration pointer at wave planning time.

## Strengths
- Opus 5 as the orchestration default: plan execution, dispatch judgment, checklist/QA loops — the routine orchestration workload does not need fable-class capability (2026-08-10 P8, user directive; cost asymmetry is the driver — fable is usage-billed credits, opus is plan-covered)

## Weaknesses
- No measured head-to-head opus-vs-fable orchestration data yet — the default is cost-motivated, not loss-evidenced; first opus-default waves should scorecard redo counts vs the fable-era baseline (2026-08-10, provisional)

## Model sweet spot
- Default **Opus 5** for orchestration waves — session model pin `"opus"` in `~/.claude/settings.json`
- Elevate to **Fable 5 [1m]** via explicit `/model`, never silent, when: (a) projected context > ~180k tokens (1M window headroom), or (b) the repeated-failure diagnostic lane (2 failed correction rounds on one problem). (2026-08-10 P8, user directive — n=1 provisional on the 180k threshold.)
- Budget signal for elevation decisions: the fable rate window is NOT exported in the CLI statusline contract (`rate_limits` = `five_hour`/`seven_day` only — P8 T2 capture v2.1.225 + statusline.md doc agree; fable = usage-billed credits). Use the claude.ai usage page or the `~/.claude/usage-history/` cost trail instead.

## Spawn-worthiness
- N/A — never spawned. The inverse question (when does the orchestrator delegate at all) belongs to the `agent-factory` skill's spawn protocol.
- Fable SUBAGENT dispatch gating, stated truthfully: `Agent(model:fable)` rules sit in `permissions.ask`, which is **INERT under auto mode** (n=5, root CLAUDE.md §Orchestration — build bug, /feedback filed 2026-08-07). The live gate is conversational (per-run user clearance: present lane, turn count, expected writes) plus the dormant ask rules, which self-activate if the build bug is fixed. **NO deny rule exists for fable dispatch — do not claim or rely on one.** `agent-model-guard.ps1` covers only model-OMITTED dispatches, not explicit fable ones.

## Open questions
- Is a hard backstop for explicit fable dispatch worth adding? Deny can't be selectively lifted (would block cleared runs too); a PreToolUse hook could block-with-clearance-keyword. Recorded as P8 issue log #4 — not built this wave (2026-08-10).
- Does the ~180k elevation threshold hold, or do opus waves degrade earlier/later? n=1 user directive — validate against real wave outcomes at reflect.
