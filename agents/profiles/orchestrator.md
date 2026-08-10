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
- Fable SUBAGENT dispatch gating, stated truthfully: `Agent(model:fable)` rules sit in `permissions.ask`, which is **INERT under auto mode** (n=5, root CLAUDE.md §Orchestration — build bug, /feedback filed 2026-08-07). The live gate is conversational (per-run user clearance: present lane, turn count, expected writes) plus the dormant ask rules, which self-activate if the build bug is fixed. **NO deny rule exists for fable dispatch — do not claim or rely on one.** Since P9 (2026-08-10) `agent-model-guard.ps1` covers BOTH branches: model-OMITTED dispatches on frontmatter-less types, AND explicit fable dispatches lacking a live user clearance (exit 2 + stderr reason). Every fable dispatch is logged either way to `~/.claude/fable-dispatch.log` (`ALLOW`/`BLOCK`, type, model, prompt head). It is a **speed bump plus audit trail, never a hard gate** — the clearance marker is a file and this model holds `Write`/`Bash`; the asymmetry is that the normal grant path runs off a `UserPromptSubmit` payload, which only the user's own typing produces.

## Open questions
- ~~Is a backstop for explicit fable dispatch worth adding?~~ **ANSWERED — built in P9, 2026-08-10** (P8 issue log #4). Deny was rejected because it can't be selectively lifted (it would block cleared runs too); the shipped design is the `PreToolUse`/`Agent` guard's second branch plus a `UserPromptSubmit` clearance grant. **How to use it:** present the lane, turn count, expected writes and cost, then ask the user to reply with the token `FABLE OK`. One token clears ONE dispatch and expires after 30 minutes. The clearance is consumed at guard time, so a dispatch later denied by a permission decision, or one that errors on spawn, has still burned the single use — ask for a fresh token.
- Does the ~180k elevation threshold hold, or do opus waves degrade earlier/later? n=1 user directive — validate against real wave outcomes at reflect.
