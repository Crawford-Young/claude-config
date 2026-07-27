# Claude API Reference — App-Side Capabilities

> Claude-side companion to the AI-SDK stack docs; check current docs before adopting — statuses drift. (Compiled 2026-07-27 from platform.claude.com docs sweep; verified links + capability claims in `docs/claude-config/specs/2026-07-27-harness-upgrades-design.md`.)

Use this when building AI features in app repos. Each entry: what it is, when to reach for it, docs URL.

## Structured outputs + strict tool use

Grammar-constrained generation — the API guarantees the response (or tool call) matches a supplied JSON schema; no parse-and-retry loops.
Use for any LLM feature that returns JSON to app code: extraction, classification, form fill, tool-calling agents.
https://platform.claude.com/docs/en/build-with-claude/structured-outputs

## Prompt caching (5m / 1h TTL)

Server-side cache of static prompt prefixes (system prompt, tool defs, big context blocks) — cached reads bill ~10% of input price.
Use whenever a system prompt or tool set repeats across calls; pick the 1h TTL for agentic sessions whose turns are >5 min apart.
https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## Batch API (50% discount, stacks with caching)

Async bulk endpoint — submit up to thousands of requests, results within 24h, half price, cache discounts stack on top.
Use for bulk/eval/offline jobs: nightly re-embeddings, dataset labeling, eval sweeps, digest generation.
https://platform.claude.com/docs/en/build-with-claude/batch-processing

## Files API

Upload a file once, reference it by ID across requests and sessions — no re-encoding attachments per call.
Use when the same screenshot/PDF/dataset feeds multiple requests (multi-turn document review, screenshot-driven QA loops).
https://platform.claude.com/docs/en/build-with-claude/files

## Context editing

Server-side context management — the API compacts/clears old tool results in long conversations per your config.
Use for long-running app agents (support bots, background workers) that would otherwise overflow context or pay for dead turns.
https://platform.claude.com/docs/en/build-with-claude/context-editing

## Effort + adaptive thinking

Per-call reasoning-depth control (`effort`) with the model adapting how long it thinks — replaces manual thinking-token budgets.
Use to tier cost/latency per feature: low effort for classification/autocomplete, high for planning/analysis endpoints.
https://platform.claude.com/docs/en/build-with-claude/extended-thinking

## Tool Runner

SDK-managed agentic loop (`client.beta.messages.tool_runner`) over your own tools, with hooks into each iteration.
Use before hand-rolling a while-loop around Messages + tool_use blocks — it handles the loop, you keep per-step control.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner

## MCP connector

Call remote MCP servers directly from the Messages API — server-side tool fetching/execution, no client-side MCP plumbing.
Use when an app feature needs an existing MCP server's tools (internal services, third-party connectors) without embedding an MCP client.
https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
