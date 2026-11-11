# bug(core): teammates record their own name as agent type

Found by #54's review (2026-10-15).

Every `kind='teammate'` agent stores its own name as `agents.agent_type`: 112 of 112 teammates in a dev-store copy, giving 101 distinct values (`ticket-strate-69`, `unit-167`, …). Plain subagents have 8 types. The source is Claude Code's `agent-*.meta.json` field `agentType`, which holds the teammate name for teammates (`crates/strate-core/src/discovery/scan.rs:241`, `crates/strate-core/src/store/ingest.rs:393`). In #54's By-agent-type column, about 23% of $ folded into Other. #54 groups teammates as `teammate` in the interim.

## Goal

A teammate's agent type is the type it was spawned as (e.g. `implementer-opus`, `reviewer`), not its name.

## Done when

- [ ] A recon confirms where the real type is recorded for teammates (e.g. the spawning Agent `tool_use` input's `subagent_type`, joined through the meta's `toolUseId`) and how often it's present on a dev-store copy.
- [ ] Ingest stores that type for teammates and falls back to `teammate` when it's absent. Red first, against a synthetic fixture.
- [ ] #54's interim `teammate` grouping is removed, and the Audit's By-agent-type column shows the real types.
- [ ] All strate gates.

## Out of scope

- Plain subagents' agent type, which is already right
- Teammate names
