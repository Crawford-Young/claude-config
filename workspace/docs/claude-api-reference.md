# Claude API Reference — App-Side Capabilities

> Claude-side companion to the AI-SDK stack docs; check current docs before adopting — statuses drift. (Compiled 2026-07-27 from platform.claude.com docs sweep; verified links + capability claims in `docs/claude-config/specs/2026-07-27-harness-upgrades-design.md`. Extended 2026-09-04 by P10 WS-E — every added entry is a fetched or skill-authoritative fact, not recall; claims that would not verify were left out rather than softened.)

Use this when building AI features in app repos. Each entry: what it is, when to reach for it, docs URL.

`platform.claude.com` is the canonical docs host — `docs.anthropic.com` and `docs.claude.com` both 302-redirect to it.

## Structured outputs

Grammar-constrained generation — the API guarantees the response matches a supplied JSON schema; no parse-and-retry loops. Set `output_config: {format: {...}}` on `messages.create()`; the older top-level `output_format` is deprecated, and `client.messages.parse()` validates for you.
Use for any LLM feature that returns JSON to app code: extraction, classification, form fill. Incompatible with document `citations` — the pair returns a 400.
https://platform.claude.com/docs/en/build-with-claude/structured-outputs

## Strict tool use — a separate feature from structured outputs

Not the same thing, and routinely conflated. `strict: true` is a top-level field on the **tool definition** (beside `name`/`description`/`input_schema`) — **not** on `tool_choice` — and guarantees `tool_use.input` validates against the tool's schema. Requires `additionalProperties: false` plus `required`. Structured outputs constrains the *response*; strict constrains *tool arguments*. Either may be what you want; they are not interchangeable.
Use strict when a tool's arguments must be schema-valid; use structured outputs when the reply itself must be. No beta header for either.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use

## Forced tool use is removed on Claude Fable 5.1 and Mythos 5.1

A hard incompatibility, not a degradation. `tool_choice: {type: "any"}` and `{type: "tool", name: ...}` return a **400** on Claude Fable 5.1 and Claude Mythos 5.1 — on `count_tokens` and the Batch API too, not just `messages.create`. `{type: "none"}` is unaffected, and `disable_parallel_tool_use` still works alongside `auto` (at most one call).
Porting code that forces a tool: use `auto` plus an explicit instruction naming the tool, add `strict: true` to keep arguments schema-valid, or switch to structured outputs when the forced call only existed to get JSON back.
https://platform.claude.com/docs/en/about-claude/models/migrating-to-claude-fable-5-1

## Tool search — defer loading a large tool catalogue

Server tools that let Claude search its own tool list instead of loading all of it into the prompt: `tool_search_tool_regex_20251119` or `tool_search_tool_bm25_20251119`, with the tools you want withheld marked `defer_loading: true`.
Use when a large tool array is dominating your input tokens. Two rules: the search tool itself must never be `defer_loading: true`, and at least one tool must stay non-deferred, or the API returns 400 `All tools have defer_loading set`.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool

## Programmatic tool calling

Claude calls your custom tool from inside the code execution sandbox rather than round-tripping each call through your loop. Declare `{"type": "code_execution_20260120", "name": "code_execution"}` **and** set `"allowed_callers": ["code_execution_20260120"]` on the custom tool. Opus 4.5+ / Sonnet 4.5+, no beta header.
**Reach for it when the tool array is large, not when calls are sequential.** Documented results: a 75-tool agent benchmark saw billed input tokens fall ~38% with no accuracy change, and production traffic with 10–49 tool definitions sees 20–40% token savings. On τ²-bench, where each turn makes one or two sequential calls, scores were unchanged and it **cost roughly 8% more** — the docs state plainly that "sequential single-call workflows do not benefit". Latency is described only qualitatively: the model is not re-sampled between calls inside one execution.
Incompatible with `strict: true`, `disable_parallel_tool_use`, forced `tool_choice`, and MCP tools. When replying to a pending programmatic call, the user message must contain **only** `tool_result` blocks — no text.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling

## Code execution pricing

Free when paired with `web_search_20260209`+ or `web_fetch_20260209`+ — those carry no code-execution charge beyond normal token costs. Used on its own it bills by **execution time, not tokens**: a 5-minute minimum per call, **1,550 free hours per organization per month**, then **$0.05/hour per container**. Attaching files bills execution time even if the tool is never called, because files are preloaded onto the container.
Budget for it separately from token spend — it is the one tool whose cost does not appear in `usage`. Managed Agents replaces this model with session-runtime billing at $0.08 per session-hour; you are not billed container hours on top.
https://platform.claude.com/docs/en/about-claude/pricing

## Browser use vs computer use vs Claude in Chrome

Three different things that get confused. All three are **driven by your side**, so hosting is not the distinction — the distinction is what Claude manipulates and who is watching.

- **Browser use** (`browser_toolset_20260801`) — an Anthropic-defined *client* toolset for structured browser control: accessibility trees, page text, console and network entries, not raw pixels. One entry gives 27 member tools (`navigate`, `read_page`, `left_click`, `screenshot`, tab management…) plus four opt-in (`javascript_exec`, `file_upload`, `read_console`, `read_network`). "Your application runs every call against its own browser automation; nothing runs on Anthropic's side." Reach for it when the target is a *web page* and you want semantic access. Declaring it with default members adds ~6,600 input tokens per request. Claude API and Google Cloud only — not Claude Platform on AWS, Bedrock, or Foundry, and not in Managed Agents.
- **Computer use** (`computer_toolset_20260801`; older `computer_20251124`, `computer_20250124`) — 17 member tools driving a whole desktop by screenshots and mouse/keyboard. "Your application runs every call in an environment you control." Reach for it when the target is an *application or OS*, not a page — it is the heavier, lower-level option.
- **Claude in Chrome** — **not an API tool at all.** A Chrome extension a person installs, which "reads the page you're signed in to, then clicks, types, and fills forms while you decide what happens next", usable interactively or connected to Claude Code development workflows. Permissions Mode grants access one site at a time; it stops before sensitive actions such as purchases. Available on all paid plans. Reach for it when a *human* wants Claude acting in their own signed-in browser — it is a product, not something you call from app code.

**Status is not documented.** The Compatibility blocks for both API toolsets state ZDR eligibility, supported models and platforms, but carry no GA/beta/preview label and no beta-header string. Absence of a beta tag is not a GA claim — check before depending on stability.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool
https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
https://www.claude.com/claude-in-chrome (product page, not API docs)

## Advisor tool — the pairing rule that 400s

Lets a cheaper executor model consult a more capable advisor mid-request. The advisor's `model` must be **at least as capable as the request's top-level model** — executor `claude-sonnet-5` with advisor `claude-opus-5` is valid; the inverse returns a 400. Some advisors return plaintext advice, others an encrypted `advisor_redacted_result`.
In Claude Code the companion setting is the `advisorModel` key (`{"advisorModel": "opus"}`) — confirmed against a live config, 2026-09-04.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool

## `stop_reason: "refusal"` — check it before reading content

A safety classifier declining a request is **HTTP 200**, not an error: the response carries `stop_reason: "refusal"` and a `stop_details` object (`type`, a `category` from an open set such as `cyber`, `bio`, `reasoning_extraction`, `frontier_llm`, and an `explanation`). Reading `content` without checking `stop_reason` silently yields nothing useful.
`stop_details` is populated **only** for `refusal` and is `null` for every other stop reason (`end_turn`, `max_tokens`, `tool_use`, `pause_turn`) — always guard before reading it.
Handle it with server-side fallbacks rather than a hand-maintained model list: `betas: ["server-side-fallback-2026-07-01"]` plus `fallbacks: "default"` routes by refusal category. The older array form (`server-side-fallback-2026-06-01` with `fallbacks: [{"model": ...}]`) still works. On Bedrock, Vertex and Foundry use the SDKs' client-side `BetaRefusalFallbackMiddleware` + `BetaFallbackState` instead.
https://platform.claude.com/docs/en/api/handling-stop-reasons

## Thinking blocks are bound to the model that produced them

Not a caching nicety — a correctness rule. A thinking block belongs to the model that generated it: pass blocks back unchanged while continuing on the **same** model, and other models drop them silently and unbilled (Claude Mythos 5.1 reads them instead). This is why switching the session model mid-conversation invalidates the cached context and re-reads everything uncached: the old model's thinking is no longer usable.
Editing earlier turns invalidates thinking blocks too ("preserved thinking"). Accounts created on or after 2026-08-31 get a **400** on edited history, and later models enforce it for everyone — so make any agent harness **append-only** rather than rewriting history in place.
Practical consequence: treat a model downgrade as a session boundary, not a knob to turn mid-task.
https://platform.claude.com/docs/en/build-with-claude/extended-thinking

## Prompt caching (5m / 1h TTL)

Server-side cache of static prompt prefixes (system prompt, tool defs, big context blocks) — cached reads bill ~10% of input price.
Use whenever a system prompt or tool set repeats across calls; pick the 1h TTL for agentic sessions whose turns are >5 min apart. Verify it is working with `usage.cache_read_input_tokens` — a persistent zero means a silent invalidator (a timestamp in the system prompt, unsorted JSON, a varying tool set) is defeating the prefix match.
https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## Batch API (50% discount, stacks with caching)

Async bulk endpoint — submit up to thousands of requests, results within 24h, half price, cache discounts stack on top.
Use for bulk/eval/offline jobs: nightly re-embeddings, dataset labeling, eval sweeps, digest generation. Results arrive in **any order** — key them by `custom_id`, never by position.
https://platform.claude.com/docs/en/build-with-claude/batch-processing

## Files API

Upload a file once, reference it by ID across requests and sessions — no re-encoding attachments per call.
Use when the same screenshot/PDF/dataset feeds multiple requests (multi-turn document review, screenshot-driven QA loops). Now out of beta — `client.files.*`, no beta header; older `client.beta.files.*` code needs migrating.
https://platform.claude.com/docs/en/build-with-claude/files

## Context editing

Server-side context management — the API **clears** old tool results or thinking blocks per your config. Distinct from compaction, which summarizes; do not reach for `compact_20260112` here.
Use for long-running app agents (support bots, background workers) that would otherwise overflow context or pay for dead turns.
https://platform.claude.com/docs/en/build-with-claude/context-editing

## Effort + adaptive thinking

Per-call reasoning-depth control (`output_config.effort`, inside `output_config` — not top-level) with the model adapting how long it thinks; replaces manual thinking-token budgets, and `budget_tokens` is rejected with a 400 on current models.
Use to tier cost/latency per feature: low effort for classification/autocomplete, high or xhigh for planning and agentic endpoints. Effort is the first quality-trading lever after caching — measure per route before raising a default.
https://platform.claude.com/docs/en/build-with-claude/extended-thinking

## Tool Runner

SDK-managed agentic loop (`client.beta.messages.tool_runner`) over your own tools, with hooks into each iteration.
Use before hand-rolling a while-loop around Messages + tool_use blocks — it handles the loop, you keep per-step control. Not the same thing as the Claude Agent SDK: the Tool Runner loops over tools you define and ships no built-in tools.
https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner

## MCP connector

Call remote MCP servers directly from the Messages API — server-side tool fetching/execution, no client-side MCP plumbing.
Use when an app feature needs an existing MCP server's tools (internal services, third-party connectors) without embedding an MCP client. Needs **both** halves: `mcp_servers=[{type:"url", url, name}]` alone is a validation error — add `tools=[{type:"mcp_toolset", mcp_server_name:<same name>}]` with beta `mcp-client-2025-11-20`.
https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
